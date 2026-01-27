import { SupabaseClient } from '@supabase/supabase-js';
import { Task, TaskRepository } from '../db/repositories/tasks.js';
import { CostTracker, CostEstimate } from '../analytics/cost-tracker.js';
import { sendMessage, SlackMessage } from '../slack/bot.js';
import { logger } from '../logging/index.js';

const log = logger.child('PreFlight');

/**
 * Pre-flight check warning types
 */
export type WarningType =
  | 'test_data'
  | 'unconfirmed_priority'
  | 'high_opus_limit'
  | 'high_sonnet_limit'
  | 'no_tasks'
  | 'missing_estimates';

/**
 * A warning detected during pre-flight checks
 */
export interface PreFlightWarning {
  type: WarningType;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  taskIds?: string[];
}

/**
 * Task summary for display in Slack
 */
export interface TaskSummary {
  id: string;
  title: string;
  priority: number;
  priorityConfirmed: boolean;
  estimatedSessionsOpus: number;
  estimatedSessionsSonnet: number;
  source: string;
  isTestData: boolean;
}

/**
 * Result of pre-flight checks
 */
export interface PreFlightResult {
  passed: boolean;
  queuedTaskCount: number;
  tasks: TaskSummary[];
  warnings: PreFlightWarning[];
  costEstimate: CostEstimate | null;
  capacityLimits: {
    opus: number;
    sonnet: number;
  };
  testDataDetected: boolean;
  unconfirmedPriorityCount: number;
  timestamp: Date;
}

/**
 * Configuration for pre-flight checks
 */
export interface PreFlightConfig {
  /** Slack channel ID for sending summaries */
  slackChannelId: string;
  /** Capacity limit warning threshold for opus */
  opusLimitWarningThreshold: number;
  /** Capacity limit warning threshold for sonnet */
  sonnetLimitWarningThreshold: number;
  /** Whether to skip Slack integration (for testing) */
  skipSlack: boolean;
  /** Timeout for waiting for user confirmation (ms) */
  confirmationTimeoutMs: number;
}

/**
 * Default pre-flight configuration
 */
export const DEFAULT_PREFLIGHT_CONFIG: PreFlightConfig = {
  slackChannelId: process.env.TC_SLACK_CHANNEL || '',
  opusLimitWarningThreshold: 2,
  sonnetLimitWarningThreshold: 5,
  skipSlack: false,
  confirmationTimeoutMs: 300000, // 5 minutes
};

/**
 * Patterns indicating test data in task names
 */
const TEST_DATA_PATTERNS = [
  /\btest\b/i,
  /\bdummy\b/i,
  /\bmock\b/i,
  /\bfake\b/i,
  /\bsample\b/i,
  /\bexample\b/i,
  /\bfoo\b/i,
  /\bbar\b/i,
  /\bbaz\b/i,
  /^\[TEST\]/i,
  /^\[DEMO\]/i,
];

/**
 * Dependencies that can be injected into PreFlightChecker for testing
 */
export interface PreFlightDependencies {
  taskRepository: TaskRepository;
  costTracker: CostTracker;
  sendMessage: typeof sendMessage;
}

/**
 * PreFlightChecker runs mandatory checks before the orchestrator starts.
 *
 * Responsibilities:
 * - Query database for all queued tasks
 * - Check for test data (tasks with 'test' in name, source='test', etc.)
 * - Calculate estimated total cost for all queued tasks
 * - Verify all tasks have priority_confirmed = true
 * - Check capacity limits are reasonable
 * - Send Slack summary
 * - Wait for explicit user confirmation before proceeding
 */
export class PreFlightChecker {
  private config: PreFlightConfig;
  private taskRepository: TaskRepository;
  private costTracker: CostTracker;
  private sendMessageFn: typeof sendMessage;
  private lastResult: PreFlightResult | null = null;
  private confirmationResolver: ((confirmed: boolean) => void) | null = null;
  private confirmationThreadTs: string | null = null;

  constructor(
    client: SupabaseClient,
    config?: Partial<PreFlightConfig>,
    deps?: Partial<PreFlightDependencies>
  ) {
    this.config = { ...DEFAULT_PREFLIGHT_CONFIG, ...config };
    this.taskRepository = deps?.taskRepository ?? new TaskRepository(client);
    this.costTracker = deps?.costTracker ?? new CostTracker(client);
    this.sendMessageFn = deps?.sendMessage ?? sendMessage;
  }

  /**
   * Run all pre-flight checks
   */
  async runChecks(): Promise<PreFlightResult> {
    log.info('Starting pre-flight checks');
    log.time('pre-flight-checks');

    const warnings: PreFlightWarning[] = [];
    const timestamp = new Date();

    // Get capacity limits from environment
    const capacityLimits = {
      opus: this.parseEnvInt('OPUS_SESSION_LIMIT', 5),
      sonnet: this.parseEnvInt('SONNET_SESSION_LIMIT', 10),
    };

    // Query all queued tasks
    let queuedTasks: Task[];
    try {
      queuedTasks = await this.taskRepository.getQueued();
      log.info('Fetched queued tasks', { count: queuedTasks.length });
    } catch (error) {
      log.error('Failed to fetch queued tasks', error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Failed to fetch queued tasks: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Check for no tasks
    if (queuedTasks.length === 0) {
      warnings.push({
        type: 'no_tasks',
        message: 'No queued tasks found. The orchestrator will have nothing to work on.',
        severity: 'warning',
      });
    }

    // Transform tasks to summaries and detect issues
    const taskSummaries: TaskSummary[] = [];
    const testDataTaskIds: string[] = [];
    const unconfirmedTaskIds: string[] = [];
    const missingEstimateTaskIds: string[] = [];

    for (const task of queuedTasks) {
      const isTestData = this.isTestData(task);
      if (isTestData) {
        testDataTaskIds.push(task.id);
      }

      if (!task.priority_confirmed) {
        unconfirmedTaskIds.push(task.id);
      }

      if (task.estimated_sessions_opus === 0 && task.estimated_sessions_sonnet === 0) {
        missingEstimateTaskIds.push(task.id);
      }

      taskSummaries.push({
        id: task.id,
        title: task.title,
        priority: task.priority,
        priorityConfirmed: task.priority_confirmed,
        estimatedSessionsOpus: task.estimated_sessions_opus,
        estimatedSessionsSonnet: task.estimated_sessions_sonnet,
        source: task.source,
        isTestData,
      });
    }

    // Sort by priority (descending)
    taskSummaries.sort((a, b) => b.priority - a.priority);

    // Add warnings for detected issues
    if (testDataTaskIds.length > 0) {
      warnings.push({
        type: 'test_data',
        message: `Found ${testDataTaskIds.length} task(s) that appear to be test data`,
        severity: 'warning',
        taskIds: testDataTaskIds,
      });
    }

    if (unconfirmedTaskIds.length > 0) {
      warnings.push({
        type: 'unconfirmed_priority',
        message: `Found ${unconfirmedTaskIds.length} task(s) without confirmed priority`,
        severity: 'warning',
        taskIds: unconfirmedTaskIds,
      });
    }

    if (missingEstimateTaskIds.length > 0) {
      warnings.push({
        type: 'missing_estimates',
        message: `Found ${missingEstimateTaskIds.length} task(s) without session estimates`,
        severity: 'info',
        taskIds: missingEstimateTaskIds,
      });
    }

    // Check capacity limits
    if (capacityLimits.opus > this.config.opusLimitWarningThreshold) {
      warnings.push({
        type: 'high_opus_limit',
        message: `Opus session limit (${capacityLimits.opus}) exceeds recommended threshold (${this.config.opusLimitWarningThreshold})`,
        severity: 'warning',
      });
    }

    if (capacityLimits.sonnet > this.config.sonnetLimitWarningThreshold) {
      warnings.push({
        type: 'high_sonnet_limit',
        message: `Sonnet session limit (${capacityLimits.sonnet}) exceeds recommended threshold (${this.config.sonnetLimitWarningThreshold})`,
        severity: 'warning',
      });
    }

    // Calculate estimated cost
    let costEstimate: CostEstimate | null = null;
    try {
      const totalOpusSessions = taskSummaries.reduce((sum, t) => sum + t.estimatedSessionsOpus, 0);
      const totalSonnetSessions = taskSummaries.reduce((sum, t) => sum + t.estimatedSessionsSonnet, 0);

      if (totalOpusSessions > 0 || totalSonnetSessions > 0) {
        costEstimate = await this.costTracker.estimateCost({
          opusSessions: totalOpusSessions,
          sonnetSessions: totalSonnetSessions,
        });
        log.info('Cost estimate calculated', { totalCost: costEstimate.totalCost });
      }
    } catch (error) {
      log.warn('Failed to calculate cost estimate', { error: String(error) });
      // Don't fail pre-flight checks if cost estimation fails
    }

    // Determine if checks passed (no critical warnings)
    const criticalWarnings = warnings.filter(w => w.severity === 'critical');
    const passed = criticalWarnings.length === 0;

    const result: PreFlightResult = {
      passed,
      queuedTaskCount: queuedTasks.length,
      tasks: taskSummaries,
      warnings,
      costEstimate,
      capacityLimits,
      testDataDetected: testDataTaskIds.length > 0,
      unconfirmedPriorityCount: unconfirmedTaskIds.length,
      timestamp,
    };

    this.lastResult = result;
    log.timeEnd('pre-flight-checks');
    log.info('Pre-flight checks completed', {
      passed,
      taskCount: queuedTasks.length,
      warningCount: warnings.length,
      testDataCount: testDataTaskIds.length,
      unconfirmedCount: unconfirmedTaskIds.length,
    });

    return result;
  }

  /**
   * Send pre-flight summary to Slack
   */
  async sendSummaryToSlack(): Promise<string | undefined> {
    // Always validate that checks were run first, even if Slack is disabled
    if (!this.lastResult) {
      throw new Error('Must run pre-flight checks before sending summary');
    }

    if (this.config.skipSlack) {
      log.info('Slack integration disabled, skipping summary');
      return undefined;
    }

    if (!this.config.slackChannelId) {
      log.warn('No Slack channel configured, skipping summary');
      return undefined;
    }

    const message = this.formatSlackSummary(this.lastResult);
    log.info('Sending pre-flight summary to Slack', { channelId: this.config.slackChannelId });

    try {
      const threadTs = await this.sendMessageFn({
        channel: this.config.slackChannelId,
        text: message,
      });
      this.confirmationThreadTs = threadTs || null;
      log.info('Pre-flight summary sent to Slack', { threadTs });
      return threadTs;
    } catch (error) {
      log.error('Failed to send Slack summary', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Wait for explicit user confirmation
   */
  async waitForConfirmation(): Promise<boolean> {
    if (this.config.skipSlack) {
      log.info('Slack integration disabled, auto-confirming');
      return true;
    }

    log.info('Waiting for user confirmation', { timeoutMs: this.config.confirmationTimeoutMs });

    return new Promise<boolean>((resolve) => {
      this.confirmationResolver = resolve;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        log.warn('Confirmation timeout reached', { timeoutMs: this.config.confirmationTimeoutMs });
        this.confirmationResolver = null;
        resolve(false);
      }, this.config.confirmationTimeoutMs);

      // Store timeout reference for cleanup
      (this as any)._confirmationTimeoutId = timeoutId;
    });
  }

  /**
   * Confirm the pre-flight checks (called externally, e.g., from Slack handler)
   */
  confirm(approved: boolean): void {
    if (this.confirmationResolver) {
      log.info('Confirmation received', { approved });

      // Clear timeout
      const timeoutId = (this as any)._confirmationTimeoutId;
      if (timeoutId) {
        clearTimeout(timeoutId);
        delete (this as any)._confirmationTimeoutId;
      }

      this.confirmationResolver(approved);
      this.confirmationResolver = null;
    }
  }

  /**
   * Get all warnings from the last check
   */
  getWarnings(): string[] {
    if (!this.lastResult) {
      return [];
    }
    return this.lastResult.warnings.map(w => w.message);
  }

  /**
   * Get the last pre-flight result
   */
  getLastResult(): PreFlightResult | null {
    return this.lastResult;
  }

  /**
   * Get the confirmation thread timestamp
   */
  getConfirmationThreadTs(): string | null {
    return this.confirmationThreadTs;
  }

  /**
   * Check if a task appears to be test data
   */
  private isTestData(task: Task): boolean {
    // Note: TaskSource doesn't include 'test' as a valid value,
    // so we rely on pattern matching for title, description, and tags

    // Check title against patterns
    for (const pattern of TEST_DATA_PATTERNS) {
      if (pattern.test(task.title)) {
        return true;
      }
    }

    // Check description if present
    if (task.description) {
      for (const pattern of TEST_DATA_PATTERNS) {
        if (pattern.test(task.description)) {
          return true;
        }
      }
    }

    // Check tags
    if (task.tags && task.tags.includes('test')) {
      return true;
    }

    return false;
  }

  /**
   * Format the Slack summary message
   */
  private formatSlackSummary(result: PreFlightResult): string {
    const lines: string[] = [];

    // Header
    lines.push('*TrafficControl Pre-Flight Check*');
    lines.push(`_${result.timestamp.toLocaleString()}_`);
    lines.push('');

    // Summary stats
    lines.push('*Summary*');
    lines.push('```');
    lines.push(`Queued Tasks:      ${result.queuedTaskCount}`);
    lines.push(`Test Data Found:   ${result.testDataDetected ? 'Yes' : 'No'}`);
    lines.push(`Unconfirmed Tasks: ${result.unconfirmedPriorityCount}`);
    lines.push(`Warnings:          ${result.warnings.length}`);
    lines.push('```');
    lines.push('');

    // Capacity limits
    lines.push('*Capacity Limits*');
    lines.push('```');
    lines.push(`Opus:   ${result.capacityLimits.opus} concurrent sessions`);
    lines.push(`Sonnet: ${result.capacityLimits.sonnet} concurrent sessions`);
    lines.push('```');
    lines.push('');

    // Cost estimate
    if (result.costEstimate) {
      lines.push('*Estimated Cost Range*');
      lines.push('```');
      for (const item of result.costEstimate.breakdown) {
        lines.push(`${item.model}: $${item.cost.toFixed(2)} (${item.sessions} sessions)`);
      }
      lines.push(`Total:  $${result.costEstimate.totalCost.toFixed(2)}`);
      lines.push('```');
      lines.push('');
    }

    // Task list (priority ordering)
    if (result.tasks.length > 0) {
      lines.push('*Task Queue (by priority)*');
      const maxTasks = 10;
      const displayTasks = result.tasks.slice(0, maxTasks);

      for (const task of displayTasks) {
        const flags: string[] = [];
        if (task.isTestData) flags.push('[TEST]');
        if (!task.priorityConfirmed) flags.push('[!priority]');
        const flagStr = flags.length > 0 ? ` ${flags.join(' ')}` : '';
        lines.push(`  ${task.priority}. ${task.title}${flagStr}`);
      }

      if (result.tasks.length > maxTasks) {
        lines.push(`  _...and ${result.tasks.length - maxTasks} more tasks_`);
      }
      lines.push('');
    }

    // Warnings
    if (result.warnings.length > 0) {
      lines.push('*Warnings*');
      for (const warning of result.warnings) {
        const icon = warning.severity === 'critical' ? '[!]' : warning.severity === 'warning' ? '[~]' : '[i]';
        lines.push(`${icon} ${warning.message}`);
      }
      lines.push('');
    }

    // Confirmation prompt
    lines.push('---');
    lines.push('*Reply to confirm:*');
    lines.push('`confirm` - Start the orchestrator');
    lines.push('`abort` - Cancel startup');
    lines.push('');
    lines.push('_Waiting for confirmation..._');

    return lines.join('\n');
  }

  /**
   * Parse an integer from environment variable with default
   */
  private parseEnvInt(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Execute pre-flight checks in dry-run mode (no Slack, no confirmation wait)
   */
  async dryRun(): Promise<PreFlightResult> {
    log.info('Executing pre-flight checks in dry-run mode');
    const result = await this.runChecks();

    // Print summary to console in dry-run mode
    console.log('\n' + '='.repeat(60));
    console.log('PRE-FLIGHT CHECK RESULTS (DRY RUN)');
    console.log('='.repeat(60));
    console.log(`\nTimestamp: ${result.timestamp.toISOString()}`);
    console.log(`Status: ${result.passed ? 'PASSED' : 'FAILED'}`);
    console.log(`\nQueued Tasks: ${result.queuedTaskCount}`);
    console.log(`Test Data Detected: ${result.testDataDetected}`);
    console.log(`Unconfirmed Priorities: ${result.unconfirmedPriorityCount}`);
    console.log(`\nCapacity Limits:`);
    console.log(`  Opus: ${result.capacityLimits.opus}`);
    console.log(`  Sonnet: ${result.capacityLimits.sonnet}`);

    if (result.costEstimate) {
      console.log(`\nEstimated Cost: $${result.costEstimate.totalCost.toFixed(2)}`);
      for (const item of result.costEstimate.breakdown) {
        console.log(`  ${item.model}: $${item.cost.toFixed(2)} (${item.sessions} sessions)`);
      }
    }

    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const warning of result.warnings) {
        console.log(`  [${warning.severity.toUpperCase()}] ${warning.message}`);
      }
    }

    if (result.tasks.length > 0) {
      console.log('\nTask Queue (top 10):');
      for (const task of result.tasks.slice(0, 10)) {
        const flags: string[] = [];
        if (task.isTestData) flags.push('TEST');
        if (!task.priorityConfirmed) flags.push('UNCONFIRMED');
        const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
        console.log(`  ${task.priority}. ${task.title}${flagStr}`);
      }
      if (result.tasks.length > 10) {
        console.log(`  ...and ${result.tasks.length - 10} more`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('DRY RUN COMPLETE - No changes made, orchestrator not started');
    console.log('='.repeat(60) + '\n');

    return result;
  }
}

/**
 * Factory function to create a PreFlightChecker with dependencies
 */
export function createPreFlightChecker(
  client: SupabaseClient,
  config?: Partial<PreFlightConfig>
): PreFlightChecker {
  return new PreFlightChecker(client, config);
}
