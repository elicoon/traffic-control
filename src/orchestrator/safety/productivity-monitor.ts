/**
 * Productivity Monitor
 *
 * Tracks agent productivity metrics like tasks completed, success rate,
 * and output quality indicators. Provides visibility into system performance.
 */

import { logger } from '../../logging/index.js';

const log = logger.child('Safety.ProductivityMonitor');

/**
 * Completion record for tracking output
 */
export interface CompletionRecord {
  sessionId: string;
  taskId: string;
  model: 'opus' | 'sonnet' | 'haiku';
  success: boolean;
  durationMs: number;
  tokensUsed: number;
  costUsd: number;
  timestamp: Date;
  summary?: string;
  errorReason?: string;
}

/**
 * Productivity statistics
 */
export interface ProductivityStats {
  tasksCompleted: number;
  tasksSuccessful: number;
  tasksFailed: number;
  successRate: number;
  averageDurationMs: number;
  averageTokensPerTask: number;
  averageCostPerTask: number;
  byModel: {
    [key in 'opus' | 'sonnet' | 'haiku']: {
      completed: number;
      successful: number;
      failed: number;
      avgDurationMs: number;
    };
  };
  hourlyRate: number; // tasks per hour
  lastUpdated: Date;
}

/**
 * Productivity alert types
 */
export type ProductivityAlertType =
  | 'low_success_rate'
  | 'slow_completion'
  | 'high_failure_streak'
  | 'no_completions';

/**
 * Productivity alert
 */
export interface ProductivityAlert {
  type: ProductivityAlertType;
  message: string;
  metric: number;
  threshold: number;
  timestamp: Date;
}

/**
 * Configuration for productivity monitoring
 */
export interface ProductivityMonitorConfig {
  /** Success rate threshold below which to alert (percentage) */
  successRateThreshold: number;
  /** Average duration threshold above which to alert (ms) */
  slowDurationThresholdMs: number;
  /** Number of consecutive failures before alerting */
  failureStreakThreshold: number;
  /** Time window for productivity calculations (ms) */
  windowMs: number;
  /** Minimum completions required before calculating rates */
  minimumCompletions: number;
}

const DEFAULT_CONFIG: ProductivityMonitorConfig = {
  successRateThreshold: 70, // Alert if below 70%
  slowDurationThresholdMs: 30 * 60 * 1000, // 30 minutes
  failureStreakThreshold: 3,
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  minimumCompletions: 3,
};

/**
 * Callback for productivity alerts
 */
export type ProductivityAlertCallback = (alert: ProductivityAlert) => void;

/**
 * Productivity Monitor
 */
export class ProductivityMonitor {
  private config: ProductivityMonitorConfig;
  private completions: CompletionRecord[] = [];
  private consecutiveFailures: number = 0;
  private alertCallbacks: ProductivityAlertCallback[] = [];
  private alertsSent: Set<string> = new Set();

  constructor(config: Partial<ProductivityMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register an alert callback
   */
  onAlert(callback: ProductivityAlertCallback): () => void {
    this.alertCallbacks.push(callback);
    return () => {
      const index = this.alertCallbacks.indexOf(callback);
      if (index >= 0) {
        this.alertCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Record a task completion
   */
  recordCompletion(record: CompletionRecord): void {
    this.completions.push(record);

    log.debug('Completion recorded', {
      taskId: record.taskId,
      success: record.success,
      durationMs: record.durationMs,
      model: record.model,
    });

    // Track consecutive failures
    if (record.success) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
    }

    // Check for alerts
    this.checkAlerts();

    // Prune old records outside window
    this.pruneOldRecords();
  }

  /**
   * Record an agent completion with full details
   */
  recordAgentCompletion(
    sessionId: string,
    taskId: string,
    model: 'opus' | 'sonnet' | 'haiku',
    success: boolean,
    durationMs: number,
    tokensUsed: number,
    costUsd: number,
    summary?: string,
    errorReason?: string
  ): void {
    this.recordCompletion({
      sessionId,
      taskId,
      model,
      success,
      durationMs,
      tokensUsed,
      costUsd,
      timestamp: new Date(),
      summary,
      errorReason,
    });
  }

  /**
   * Get productivity statistics
   */
  getStats(): ProductivityStats {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.config.windowMs);
    const recentCompletions = this.completions.filter(
      (c) => c.timestamp >= windowStart
    );

    const successful = recentCompletions.filter((c) => c.success);
    const failed = recentCompletions.filter((c) => !c.success);

    const successRate =
      recentCompletions.length > 0
        ? (successful.length / recentCompletions.length) * 100
        : 0;

    const avgDuration =
      recentCompletions.length > 0
        ? recentCompletions.reduce((sum, c) => sum + c.durationMs, 0) /
          recentCompletions.length
        : 0;

    const avgTokens =
      recentCompletions.length > 0
        ? recentCompletions.reduce((sum, c) => sum + c.tokensUsed, 0) /
          recentCompletions.length
        : 0;

    const avgCost =
      recentCompletions.length > 0
        ? recentCompletions.reduce((sum, c) => sum + c.costUsd, 0) /
          recentCompletions.length
        : 0;

    // Calculate by model
    const byModel = {
      opus: this.calculateModelStats(recentCompletions, 'opus'),
      sonnet: this.calculateModelStats(recentCompletions, 'sonnet'),
      haiku: this.calculateModelStats(recentCompletions, 'haiku'),
    };

    // Calculate hourly rate
    const hoursInWindow = this.config.windowMs / (60 * 60 * 1000);
    const hourlyRate = recentCompletions.length / hoursInWindow;

    return {
      tasksCompleted: recentCompletions.length,
      tasksSuccessful: successful.length,
      tasksFailed: failed.length,
      successRate,
      averageDurationMs: avgDuration,
      averageTokensPerTask: avgTokens,
      averageCostPerTask: avgCost,
      byModel,
      hourlyRate,
      lastUpdated: now,
    };
  }

  /**
   * Calculate stats for a specific model
   */
  private calculateModelStats(
    completions: CompletionRecord[],
    model: 'opus' | 'sonnet' | 'haiku'
  ): { completed: number; successful: number; failed: number; avgDurationMs: number } {
    const modelCompletions = completions.filter((c) => c.model === model);
    const successful = modelCompletions.filter((c) => c.success);
    const failed = modelCompletions.filter((c) => !c.success);

    const avgDuration =
      modelCompletions.length > 0
        ? modelCompletions.reduce((sum, c) => sum + c.durationMs, 0) /
          modelCompletions.length
        : 0;

    return {
      completed: modelCompletions.length,
      successful: successful.length,
      failed: failed.length,
      avgDurationMs: avgDuration,
    };
  }

  /**
   * Check for productivity alerts
   */
  private checkAlerts(): void {
    const stats = this.getStats();

    // Only check if we have enough data
    if (stats.tasksCompleted < this.config.minimumCompletions) {
      return;
    }

    // Check success rate
    if (stats.successRate < this.config.successRateThreshold) {
      this.emitAlert({
        type: 'low_success_rate',
        message: `Success rate dropped to ${stats.successRate.toFixed(1)}%`,
        metric: stats.successRate,
        threshold: this.config.successRateThreshold,
        timestamp: new Date(),
      });
    }

    // Check average duration
    if (stats.averageDurationMs > this.config.slowDurationThresholdMs) {
      this.emitAlert({
        type: 'slow_completion',
        message: `Average completion time is ${(stats.averageDurationMs / 60000).toFixed(1)} minutes`,
        metric: stats.averageDurationMs,
        threshold: this.config.slowDurationThresholdMs,
        timestamp: new Date(),
      });
    }

    // Check failure streak
    if (this.consecutiveFailures >= this.config.failureStreakThreshold) {
      this.emitAlert({
        type: 'high_failure_streak',
        message: `${this.consecutiveFailures} consecutive task failures`,
        metric: this.consecutiveFailures,
        threshold: this.config.failureStreakThreshold,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Emit a productivity alert
   */
  private emitAlert(alert: ProductivityAlert): void {
    // Deduplicate alerts within a time window (1 hour)
    const alertKey = `${alert.type}-${Math.floor(alert.timestamp.getTime() / 3600000)}`;
    if (this.alertsSent.has(alertKey)) {
      return;
    }
    this.alertsSent.add(alertKey);

    log.warn('Productivity alert', {
      type: alert.type,
      message: alert.message,
      metric: alert.metric,
      threshold: alert.threshold,
    });

    for (const callback of this.alertCallbacks) {
      try {
        callback(alert);
      } catch (error) {
        log.error(
          'Error in productivity alert callback',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  /**
   * Prune records outside the time window
   */
  private pruneOldRecords(): void {
    const cutoff = new Date(Date.now() - this.config.windowMs);
    const before = this.completions.length;
    this.completions = this.completions.filter((c) => c.timestamp >= cutoff);
    const pruned = before - this.completions.length;
    if (pruned > 0) {
      log.debug('Pruned old completion records', { pruned, remaining: this.completions.length });
    }
  }

  /**
   * Get recent completions
   */
  getRecentCompletions(limit: number = 10): CompletionRecord[] {
    return [...this.completions]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get failed completions for analysis
   */
  getFailedCompletions(): CompletionRecord[] {
    return this.completions.filter((c) => !c.success);
  }

  /**
   * Format stats for Slack
   */
  formatForSlack(): string {
    const stats = this.getStats();
    const lines: string[] = [
      '*Productivity Monitor Status*',
      '',
      '```',
      `Completed: ${stats.tasksCompleted} tasks`,
      `Success:   ${stats.tasksSuccessful} (${stats.successRate.toFixed(1)}%)`,
      `Failed:    ${stats.tasksFailed}`,
      '',
      `Avg Duration: ${(stats.averageDurationMs / 60000).toFixed(1)} min`,
      `Avg Tokens:   ${Math.round(stats.averageTokensPerTask)}`,
      `Avg Cost:     $${stats.averageCostPerTask.toFixed(4)}`,
      '',
      `Hourly Rate:  ${stats.hourlyRate.toFixed(2)} tasks/hour`,
      '',
      'By Model:',
      `  Opus:   ${stats.byModel.opus.completed} (${stats.byModel.opus.successful} success)`,
      `  Sonnet: ${stats.byModel.sonnet.completed} (${stats.byModel.sonnet.successful} success)`,
      `  Haiku:  ${stats.byModel.haiku.completed} (${stats.byModel.haiku.successful} success)`,
      '```',
    ];

    if (stats.successRate < this.config.successRateThreshold) {
      lines.push('');
      lines.push(`*[!] Low success rate (threshold: ${this.config.successRateThreshold}%)*`);
    }

    if (this.consecutiveFailures >= this.config.failureStreakThreshold) {
      lines.push('');
      lines.push(`*[!] ${this.consecutiveFailures} consecutive failures*`);
    }

    return lines.join('\n');
  }

  /**
   * Reset state (for testing)
   */
  reset(): void {
    this.completions = [];
    this.consecutiveFailures = 0;
    this.alertsSent.clear();
  }
}
