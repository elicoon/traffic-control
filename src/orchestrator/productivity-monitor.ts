/**
 * Productivity Monitor - Detects token consumption without meaningful output
 *
 * Tracks per-agent:
 * - Tokens consumed
 * - Files modified
 * - Tests run/passed
 * - Tasks completed
 * - Tool calls made
 *
 * Alerts when tokens consumed exceed thresholds without meaningful output.
 */

import { EventBus } from '../events/event-bus.js';
import { createEvent, EventType, PayloadFor, TypedEvent } from '../events/event-types.js';
import { logger } from '../logging/index.js';

const log = logger.child('ProductivityMonitor');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Types of meaningful output an agent can produce
 */
export type OutputType = 'file' | 'test' | 'commit' | 'task';

/**
 * Productivity status levels
 */
export type ProductivityLevel = 'healthy' | 'warning' | 'critical';

/**
 * Productivity status returned by checkProductivity
 */
export interface ProductivityStatus {
  level: ProductivityLevel;
  tokensConsumed: number;
  hasOutput: boolean;
  outputCounts: OutputCounts;
  thresholdExceeded: 'none' | 'warning' | 'critical';
  recommendation: string;
  shouldPause: boolean;
}

/**
 * Output counts by type
 */
export interface OutputCounts {
  filesModified: number;
  testsRun: number;
  testsPassed: number;
  tasksCompleted: number;
  commitsCreated: number;
  toolCalls: number;
}

/**
 * Statistics for a single agent
 */
export interface AgentProductivityStats {
  agentId: string;
  taskId?: string;
  startedAt: Date;
  tokensConsumed: number;
  outputCounts: OutputCounts;
  lastOutputAt: Date | null;
  lastCheckAt: Date;
  warningIssuedAt: Date | null;
  criticalIssuedAt: Date | null;
  status: ProductivityStatus;
  currentActivity?: string;
}

/**
 * Alert data for Slack notifications
 */
export interface ProductivityAlert {
  agentId: string;
  taskId?: string;
  level: 'warning' | 'critical';
  tokensConsumed: number;
  outputProduced: OutputCounts;
  currentActivity?: string;
  options: ('continue' | 'nudge' | 'abort')[];
  timestamp: Date;
}

/**
 * Configuration for the productivity monitor
 */
export interface ProductivityMonitorConfig {
  /** Token threshold for first warning (default: 50000) */
  warningThreshold: number;
  /** Token threshold for pause and ask user (default: 100000) */
  criticalThreshold: number;
  /** Minimum time between alerts for same agent (ms) (default: 300000 = 5 minutes) */
  alertCooldownMs: number;
  /** Whether to automatically pause agents at critical threshold (default: true) */
  autoPauseAtCritical: boolean;
}

/**
 * Callback for when productivity alerts are generated
 */
export type AlertCallback = (alert: ProductivityAlert) => void | Promise<void>;

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ProductivityMonitorConfig = {
  warningThreshold: 50000,
  criticalThreshold: 100000,
  alertCooldownMs: 300000, // 5 minutes
  autoPauseAtCritical: true,
};

// ============================================================================
// ProductivityMonitor Class
// ============================================================================

/**
 * Monitors agent productivity by tracking token consumption vs meaningful output.
 *
 * Meaningful output is defined as:
 * - Files created or modified
 * - Tests passing
 * - Task marked complete
 * - Code committed
 *
 * @example
 * ```typescript
 * const monitor = new ProductivityMonitor();
 *
 * // Record activity
 * monitor.recordTokens('agent-1', 5000);
 * monitor.recordOutput('agent-1', 'file');
 *
 * // Check productivity
 * const status = monitor.checkProductivity('agent-1');
 * if (status.shouldPause) {
 *   // Pause agent and ask user
 * }
 * ```
 */
export class ProductivityMonitor {
  private config: ProductivityMonitorConfig;
  private agents: Map<string, AgentProductivityStats>;
  private eventBus: EventBus | null = null;
  private alertCallbacks: Set<AlertCallback>;
  private pausedAgents: Set<string>;

  constructor(config: Partial<ProductivityMonitorConfig> = {}, eventBus?: EventBus) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.agents = new Map();
    this.eventBus = eventBus || null;
    this.alertCallbacks = new Set();
    this.pausedAgents = new Set();

    log.info('ProductivityMonitor initialized', {
      warningThreshold: this.config.warningThreshold,
      criticalThreshold: this.config.criticalThreshold,
      autoPauseAtCritical: this.config.autoPauseAtCritical,
    });
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Gets the current configuration
   */
  getConfig(): ProductivityMonitorConfig {
    return { ...this.config };
  }

  /**
   * Updates configuration
   */
  updateConfig(updates: Partial<ProductivityMonitorConfig>): void {
    this.config = { ...this.config, ...updates };
    log.info('ProductivityMonitor config updated', updates);
  }

  // ==========================================================================
  // Agent Tracking
  // ==========================================================================

  /**
   * Starts tracking a new agent
   */
  startTracking(agentId: string, taskId?: string): void {
    const now = new Date();
    const stats: AgentProductivityStats = {
      agentId,
      taskId,
      startedAt: now,
      tokensConsumed: 0,
      outputCounts: this.createEmptyOutputCounts(),
      lastOutputAt: null,
      lastCheckAt: now,
      warningIssuedAt: null,
      criticalIssuedAt: null,
      status: this.createHealthyStatus(),
    };

    this.agents.set(agentId, stats);
    this.pausedAgents.delete(agentId);

    log.debug('Started tracking agent', { agentId, taskId });
  }

  /**
   * Stops tracking an agent
   */
  stopTracking(agentId: string): void {
    this.agents.delete(agentId);
    this.pausedAgents.delete(agentId);
    log.debug('Stopped tracking agent', { agentId });
  }

  /**
   * Checks if an agent is being tracked
   */
  isTracking(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Gets list of all tracked agent IDs
   */
  getTrackedAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  // ==========================================================================
  // Recording Methods
  // ==========================================================================

  /**
   * Records token consumption for an agent
   */
  recordTokens(agentId: string, tokens: number): void {
    const stats = this.getOrCreateStats(agentId);
    stats.tokensConsumed += tokens;
    stats.lastCheckAt = new Date();

    log.debug('Recorded tokens', { agentId, tokens, total: stats.tokensConsumed });

    // Check if we need to alert
    this.checkAndAlert(agentId);
  }

  /**
   * Records meaningful output from an agent
   */
  recordOutput(agentId: string, type: OutputType): void {
    const stats = this.getOrCreateStats(agentId);
    const now = new Date();

    switch (type) {
      case 'file':
        stats.outputCounts.filesModified++;
        break;
      case 'test':
        stats.outputCounts.testsRun++;
        stats.outputCounts.testsPassed++;
        break;
      case 'commit':
        stats.outputCounts.commitsCreated++;
        break;
      case 'task':
        stats.outputCounts.tasksCompleted++;
        break;
    }

    stats.lastOutputAt = now;
    stats.lastCheckAt = now;

    log.debug('Recorded output', { agentId, type, outputCounts: stats.outputCounts });
  }

  /**
   * Records a test result (can be pass or fail)
   */
  recordTestResult(agentId: string, passed: boolean): void {
    const stats = this.getOrCreateStats(agentId);
    stats.outputCounts.testsRun++;
    if (passed) {
      stats.outputCounts.testsPassed++;
    }
    stats.lastOutputAt = new Date();
    stats.lastCheckAt = new Date();

    log.debug('Recorded test result', { agentId, passed, testsRun: stats.outputCounts.testsRun, testsPassed: stats.outputCounts.testsPassed });
  }

  /**
   * Records a tool call made by an agent
   */
  recordToolCall(agentId: string): void {
    const stats = this.getOrCreateStats(agentId);
    stats.outputCounts.toolCalls++;
    stats.lastCheckAt = new Date();

    log.debug('Recorded tool call', { agentId, toolCalls: stats.outputCounts.toolCalls });
  }

  /**
   * Updates what the agent appears to be doing
   */
  updateActivity(agentId: string, activity: string): void {
    const stats = this.agents.get(agentId);
    if (stats) {
      stats.currentActivity = activity;
      log.debug('Updated activity', { agentId, activity });
    }
  }

  // ==========================================================================
  // Productivity Checking
  // ==========================================================================

  /**
   * Checks the productivity status of an agent
   */
  checkProductivity(agentId: string): ProductivityStatus {
    const stats = this.agents.get(agentId);

    if (!stats) {
      return this.createHealthyStatus();
    }

    const hasOutput = this.hasProducedMeaningfulOutput(stats.outputCounts);
    const level = this.calculateProductivityLevel(stats.tokensConsumed, hasOutput);
    const thresholdExceeded = this.getThresholdExceeded(stats.tokensConsumed, hasOutput);
    const shouldPause = this.shouldPauseAgent(stats.tokensConsumed, hasOutput, stats);

    const status: ProductivityStatus = {
      level,
      tokensConsumed: stats.tokensConsumed,
      hasOutput,
      outputCounts: { ...stats.outputCounts },
      thresholdExceeded,
      recommendation: this.getRecommendation(level, stats),
      shouldPause,
    };

    stats.status = status;
    stats.lastCheckAt = new Date();

    return status;
  }

  /**
   * Gets the full statistics for an agent
   */
  getStats(agentId: string): AgentProductivityStats | undefined {
    const stats = this.agents.get(agentId);
    if (!stats) {
      return undefined;
    }

    // Update status before returning
    stats.status = this.checkProductivity(agentId);

    return {
      ...stats,
      outputCounts: { ...stats.outputCounts },
      status: { ...stats.status, outputCounts: { ...stats.status.outputCounts } },
    };
  }

  /**
   * Gets statistics for all tracked agents
   */
  getAllStats(): AgentProductivityStats[] {
    return this.getTrackedAgents().map(agentId => this.getStats(agentId)!).filter(Boolean);
  }

  // ==========================================================================
  // Pause Management
  // ==========================================================================

  /**
   * Marks an agent as paused
   */
  pauseAgent(agentId: string): void {
    this.pausedAgents.add(agentId);
    log.info('Agent paused by productivity monitor', { agentId });
  }

  /**
   * Resumes a paused agent
   */
  resumeAgent(agentId: string): void {
    this.pausedAgents.delete(agentId);
    const stats = this.agents.get(agentId);
    if (stats) {
      // Reset warning/critical timestamps to avoid immediate re-alerts
      stats.warningIssuedAt = null;
      stats.criticalIssuedAt = null;
    }
    log.info('Agent resumed', { agentId });
  }

  /**
   * Checks if an agent is paused
   */
  isPaused(agentId: string): boolean {
    return this.pausedAgents.has(agentId);
  }

  /**
   * Gets list of paused agents
   */
  getPausedAgents(): string[] {
    return Array.from(this.pausedAgents);
  }

  // ==========================================================================
  // Alert Management
  // ==========================================================================

  /**
   * Registers a callback for productivity alerts
   */
  onAlert(callback: AlertCallback): () => void {
    this.alertCallbacks.add(callback);

    return () => {
      this.alertCallbacks.delete(callback);
    };
  }

  /**
   * Generates an alert for Slack notification
   */
  generateAlert(agentId: string, level: 'warning' | 'critical'): ProductivityAlert {
    const stats = this.agents.get(agentId);

    return {
      agentId,
      taskId: stats?.taskId,
      level,
      tokensConsumed: stats?.tokensConsumed || 0,
      outputProduced: stats?.outputCounts || this.createEmptyOutputCounts(),
      currentActivity: stats?.currentActivity,
      options: level === 'critical' ? ['continue', 'nudge', 'abort'] : ['continue', 'nudge'],
      timestamp: new Date(),
    };
  }

  /**
   * Formats an alert for Slack
   */
  formatAlertForSlack(alert: ProductivityAlert): string {
    const emoji = alert.level === 'critical' ? '[!!!]' : '[!]';
    const title = alert.level === 'critical'
      ? 'Agent Productivity Critical'
      : 'Agent Productivity Warning';

    const lines: string[] = [
      `${emoji} *${title}*`,
      '',
      `*Agent:* ${alert.agentId}`,
    ];

    if (alert.taskId) {
      lines.push(`*Task:* ${alert.taskId}`);
    }

    lines.push('');
    lines.push(`*Tokens Used:* ${alert.tokensConsumed.toLocaleString()}`);
    lines.push('');
    lines.push('*Output Produced:*');
    lines.push(`  - Files modified: ${alert.outputProduced.filesModified}`);
    lines.push(`  - Tests run: ${alert.outputProduced.testsRun} (${alert.outputProduced.testsPassed} passed)`);
    lines.push(`  - Commits: ${alert.outputProduced.commitsCreated}`);
    lines.push(`  - Tasks completed: ${alert.outputProduced.tasksCompleted}`);
    lines.push(`  - Tool calls: ${alert.outputProduced.toolCalls}`);

    if (alert.currentActivity) {
      lines.push('');
      lines.push(`*Current Activity:* ${alert.currentActivity}`);
    }

    lines.push('');
    lines.push('*Options:*');
    if (alert.options.includes('continue')) {
      lines.push('  `continue` - Keep running');
    }
    if (alert.options.includes('nudge')) {
      lines.push('  `nudge` - Send reminder to agent');
    }
    if (alert.options.includes('abort')) {
      lines.push('  `abort` - Stop the agent');
    }

    return lines.join('\n');
  }

  // ==========================================================================
  // Event Bus Integration
  // ==========================================================================

  /**
   * Sets up listeners on the event bus to automatically track agent activity
   */
  wireEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;

    // Track agent spawns
    eventBus.on('agent:spawned', (event) => {
      const payload = event.payload;
      this.startTracking(payload.agentId, payload.taskId);
    });

    // Track agent completions
    eventBus.on('agent:completed', (event) => {
      const payload = event.payload;
      if (payload.tokensUsed) {
        this.recordTokens(payload.agentId, payload.tokensUsed);
      }
      this.recordOutput(payload.agentId, 'task');
      this.stopTracking(payload.agentId);
    });

    // Track agent failures
    eventBus.on('agent:failed', (event) => {
      this.stopTracking(event.payload.agentId);
    });

    // Track task completions
    eventBus.on('task:completed', (event) => {
      const payload = event.payload;
      if (payload.agentId) {
        this.recordOutput(payload.agentId, 'task');
      }
    });

    log.info('Wired to event bus');
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clears all tracking data
   */
  clear(): void {
    this.agents.clear();
    this.pausedAgents.clear();
    log.debug('Cleared all tracking data');
  }

  /**
   * Destroys the monitor, clearing all data and callbacks
   */
  destroy(): void {
    this.clear();
    this.alertCallbacks.clear();
    this.eventBus = null;
    log.info('ProductivityMonitor destroyed');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Gets or creates stats for an agent
   */
  private getOrCreateStats(agentId: string): AgentProductivityStats {
    let stats = this.agents.get(agentId);
    if (!stats) {
      this.startTracking(agentId);
      stats = this.agents.get(agentId)!;
    }
    return stats;
  }

  /**
   * Creates an empty output counts object
   */
  private createEmptyOutputCounts(): OutputCounts {
    return {
      filesModified: 0,
      testsRun: 0,
      testsPassed: 0,
      tasksCompleted: 0,
      commitsCreated: 0,
      toolCalls: 0,
    };
  }

  /**
   * Creates a healthy status object
   */
  private createHealthyStatus(): ProductivityStatus {
    return {
      level: 'healthy',
      tokensConsumed: 0,
      hasOutput: false,
      outputCounts: this.createEmptyOutputCounts(),
      thresholdExceeded: 'none',
      recommendation: 'Agent is working normally.',
      shouldPause: false,
    };
  }

  /**
   * Checks if meaningful output has been produced
   */
  private hasProducedMeaningfulOutput(counts: OutputCounts): boolean {
    return (
      counts.filesModified > 0 ||
      counts.testsPassed > 0 ||
      counts.commitsCreated > 0 ||
      counts.tasksCompleted > 0
    );
  }

  /**
   * Calculates the productivity level based on tokens and output
   */
  private calculateProductivityLevel(tokens: number, hasOutput: boolean): ProductivityLevel {
    if (hasOutput) {
      return 'healthy';
    }

    if (tokens >= this.config.criticalThreshold) {
      return 'critical';
    }

    if (tokens >= this.config.warningThreshold) {
      return 'warning';
    }

    return 'healthy';
  }

  /**
   * Determines which threshold has been exceeded
   */
  private getThresholdExceeded(tokens: number, hasOutput: boolean): 'none' | 'warning' | 'critical' {
    if (hasOutput) {
      return 'none';
    }

    if (tokens >= this.config.criticalThreshold) {
      return 'critical';
    }

    if (tokens >= this.config.warningThreshold) {
      return 'warning';
    }

    return 'none';
  }

  /**
   * Determines if an agent should be paused
   */
  private shouldPauseAgent(tokens: number, hasOutput: boolean, stats: AgentProductivityStats): boolean {
    if (hasOutput) {
      return false;
    }

    if (!this.config.autoPauseAtCritical) {
      return false;
    }

    if (tokens >= this.config.criticalThreshold) {
      // Don't pause if already paused
      if (this.pausedAgents.has(stats.agentId)) {
        return false;
      }

      return true;
    }

    return false;
  }

  /**
   * Gets a recommendation message based on productivity level
   */
  private getRecommendation(level: ProductivityLevel, stats: AgentProductivityStats): string {
    switch (level) {
      case 'healthy':
        return 'Agent is working normally.';
      case 'warning':
        return `Agent has consumed ${stats.tokensConsumed.toLocaleString()} tokens without meaningful output. Consider checking its progress.`;
      case 'critical':
        return `Agent has consumed ${stats.tokensConsumed.toLocaleString()} tokens without meaningful output. Recommend pausing to review.`;
    }
  }

  /**
   * Checks if an alert should be issued and dispatches it
   */
  private checkAndAlert(agentId: string): void {
    const stats = this.agents.get(agentId);
    if (!stats) {
      return;
    }

    const hasOutput = this.hasProducedMeaningfulOutput(stats.outputCounts);
    const now = new Date();

    // Check for critical threshold
    if (stats.tokensConsumed >= this.config.criticalThreshold && !hasOutput) {
      const canAlert = this.canIssueAlert(stats.criticalIssuedAt, now);

      if (canAlert) {
        stats.criticalIssuedAt = now;
        const alert = this.generateAlert(agentId, 'critical');
        this.dispatchAlert(alert);

        if (this.config.autoPauseAtCritical) {
          this.pauseAgent(agentId);
        }
      }
      return;
    }

    // Check for warning threshold
    if (stats.tokensConsumed >= this.config.warningThreshold && !hasOutput) {
      const canAlert = this.canIssueAlert(stats.warningIssuedAt, now);

      if (canAlert) {
        stats.warningIssuedAt = now;
        const alert = this.generateAlert(agentId, 'warning');
        this.dispatchAlert(alert);
      }
    }
  }

  /**
   * Checks if enough time has passed since the last alert
   */
  private canIssueAlert(lastAlertAt: Date | null, now: Date): boolean {
    if (!lastAlertAt) {
      return true;
    }

    const elapsed = now.getTime() - lastAlertAt.getTime();
    return elapsed >= this.config.alertCooldownMs;
  }

  /**
   * Dispatches an alert to all registered callbacks
   */
  private dispatchAlert(alert: ProductivityAlert): void {
    log.warn('Productivity alert', {
      agentId: alert.agentId,
      level: alert.level,
      tokensConsumed: alert.tokensConsumed,
      outputCounts: alert.outputProduced,
    });

    Array.from(this.alertCallbacks).forEach(callback => {
      try {
        const result = callback(alert);
        if (result instanceof Promise) {
          result.catch(error => {
            log.error('Alert callback failed', error instanceof Error ? error : new Error(String(error)));
          });
        }
      } catch (error) {
        log.error('Alert callback failed', error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
