/**
 * Rolling Spend Monitor - Tracks spending in rolling time windows
 *
 * Monitors cost in rolling time windows (e.g., last 5 minutes) and can pause
 * agents or send alerts when spending exceeds configurable thresholds.
 *
 * This complements the safety/SpendMonitor which tracks daily/weekly budgets.
 * Use RollingSpendMonitor for short-term anomaly detection (e.g., runaway agent).
 */

import { EventBus } from '../events/event-bus.js';
import { logger } from '../logging/index.js';

const log = logger.child('RollingSpendMonitor');

/**
 * Record of a single spend event
 */
export interface SpendRecord {
  amount: number;
  taskId: string;
  model: string;
  timestamp: Date;
}

/**
 * Configuration for the rolling spend monitor
 */
export interface RollingSpendMonitorConfig {
  /** Threshold in USD that triggers an alert (default: $5) */
  alertThresholdUsd: number;
  /** Time window in minutes for tracking spend (default: 5) */
  windowMinutes: number;
  /** Hard limit in USD that stops all agents (default: $50) */
  hardLimitUsd: number;
  /** Optional callback when alert threshold is exceeded */
  onAlert?: (alert: SpendAlert) => Promise<void> | void;
  /** Optional callback when hard limit is exceeded */
  onHardLimit?: (alert: SpendAlert) => Promise<void> | void;
}

/**
 * Threshold check result
 */
export interface ThresholdCheckResult {
  /** Whether an alert should be sent */
  alert: boolean;
  /** Whether agents should be paused (alert threshold exceeded) */
  pause: boolean;
  /** Whether all agents should be stopped (hard limit exceeded) */
  stop: boolean;
  /** Current spend in the window */
  currentSpend: number;
  /** Window duration in minutes */
  windowMinutes: number;
}

/**
 * Spend alert information
 */
export interface SpendAlert {
  /** Amount spent in the current window */
  amountSpent: number;
  /** Duration of the window in minutes */
  windowMinutes: number;
  /** Threshold that was exceeded */
  threshold: number;
  /** Whether this is a hard limit (stop) vs soft limit (alert) */
  isHardLimit: boolean;
  /** Top spending tasks */
  topTasks: TaskSpend[];
  /** Timestamp of the alert */
  timestamp: Date;
}

/**
 * Spending by task
 */
export interface TaskSpend {
  taskId: string;
  model: string;
  amount: number;
  percentage: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: RollingSpendMonitorConfig = {
  alertThresholdUsd: parseFloat(process.env.SPEND_ALERT_THRESHOLD_USD || '5'),
  windowMinutes: parseInt(process.env.SPEND_ALERT_WINDOW_MINUTES || '5', 10),
  hardLimitUsd: parseFloat(process.env.SPEND_HARD_LIMIT_USD || '50'),
};

/**
 * RollingSpendMonitor - Tracks spending in rolling time windows and alerts on excessive consumption
 *
 * Features:
 * - Rolling time window tracking (configurable, default 5 minutes)
 * - Alert threshold for notifications (configurable, default $5)
 * - Hard limit for stopping all agents (configurable, default $50)
 * - Task-level spend tracking for identifying top consumers
 * - Pause/resume functionality
 */
export class RollingSpendMonitor {
  private config: RollingSpendMonitorConfig;
  private spendRecords: SpendRecord[] = [];
  private paused: boolean = false;
  private pausedAt: Date | null = null;
  private alertSentAt: Date | null = null;
  private hardLimitHitAt: Date | null = null;
  private eventBus: EventBus | null = null;

  constructor(config: Partial<RollingSpendMonitorConfig> = {}, eventBus?: EventBus) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = eventBus || null;

    log.info('RollingSpendMonitor initialized', {
      alertThresholdUsd: this.config.alertThresholdUsd,
      windowMinutes: this.config.windowMinutes,
      hardLimitUsd: this.config.hardLimitUsd,
    });
  }

  /**
   * Records a spend event
   * @param amount - Cost in USD
   * @param taskId - ID of the task that incurred the cost
   * @param model - Model used (opus, sonnet, haiku)
   */
  recordSpend(amount: number, taskId: string, model: string): void {
    const record: SpendRecord = {
      amount,
      taskId,
      model,
      timestamp: new Date(),
    };

    this.spendRecords.push(record);

    log.debug('Spend recorded', {
      amount,
      taskId,
      model,
      totalRecords: this.spendRecords.length,
    });

    // Clean up old records outside the window
    this.pruneOldRecords();
  }

  /**
   * Checks if any thresholds have been exceeded
   * @returns Threshold check result with alert, pause, and stop flags
   */
  checkThresholds(): ThresholdCheckResult {
    const currentSpend = this.getSpendInWindow(this.config.windowMinutes);

    const result: ThresholdCheckResult = {
      alert: false,
      pause: false,
      stop: false,
      currentSpend,
      windowMinutes: this.config.windowMinutes,
    };

    // Check hard limit first
    if (currentSpend >= this.config.hardLimitUsd) {
      result.alert = true;
      result.pause = true;
      result.stop = true;

      log.warn('HARD LIMIT EXCEEDED', {
        currentSpend,
        hardLimit: this.config.hardLimitUsd,
        windowMinutes: this.config.windowMinutes,
      });

      // Only trigger callback if we haven't already
      if (!this.hardLimitHitAt) {
        this.hardLimitHitAt = new Date();
        this.triggerHardLimitAlert(currentSpend);
      }

      return result;
    }

    // Check alert threshold
    if (currentSpend >= this.config.alertThresholdUsd) {
      result.alert = true;
      result.pause = true;

      log.warn('Alert threshold exceeded', {
        currentSpend,
        alertThreshold: this.config.alertThresholdUsd,
        windowMinutes: this.config.windowMinutes,
      });

      // Only trigger callback if we haven't sent an alert recently
      // (within the same window)
      const alertCooldown = this.config.windowMinutes * 60 * 1000;
      if (!this.alertSentAt || Date.now() - this.alertSentAt.getTime() > alertCooldown) {
        this.alertSentAt = new Date();
        this.triggerAlert(currentSpend, false);
      }
    }

    return result;
  }

  /**
   * Gets total spend within the specified time window
   * @param minutes - Number of minutes to look back
   * @returns Total spend in USD
   */
  getSpendInWindow(minutes: number): number {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    return this.spendRecords
      .filter(record => record.timestamp >= cutoff)
      .reduce((total, record) => total + record.amount, 0);
  }

  /**
   * Gets spending breakdown by task within the current window
   * @returns Array of task spending sorted by amount descending
   */
  getSpendByTask(): TaskSpend[] {
    const cutoff = new Date(Date.now() - this.config.windowMinutes * 60 * 1000);
    const relevantRecords = this.spendRecords.filter(record => record.timestamp >= cutoff);

    // Aggregate by task
    const taskMap = new Map<string, { amount: number; model: string }>();
    for (const record of relevantRecords) {
      const existing = taskMap.get(record.taskId);
      if (existing) {
        existing.amount += record.amount;
      } else {
        taskMap.set(record.taskId, { amount: record.amount, model: record.model });
      }
    }

    const totalSpend = this.getSpendInWindow(this.config.windowMinutes);

    // Convert to array and calculate percentages
    const tasks: TaskSpend[] = Array.from(taskMap.entries()).map(([taskId, data]) => ({
      taskId,
      model: data.model,
      amount: data.amount,
      percentage: totalSpend > 0 ? (data.amount / totalSpend) * 100 : 0,
    }));

    // Sort by amount descending
    tasks.sort((a, b) => b.amount - a.amount);

    return tasks;
  }

  /**
   * Pauses the spend monitor (typically called when alert threshold exceeded)
   */
  pause(): void {
    if (this.paused) {
      log.debug('RollingSpendMonitor already paused');
      return;
    }

    this.paused = true;
    this.pausedAt = new Date();

    log.info('RollingSpendMonitor paused', {
      pausedAt: this.pausedAt.toISOString(),
      currentSpend: this.getSpendInWindow(this.config.windowMinutes),
    });
  }

  /**
   * Resumes the spend monitor
   */
  resume(): void {
    if (!this.paused) {
      log.debug('RollingSpendMonitor not paused');
      return;
    }

    const pauseDuration = this.pausedAt ? Date.now() - this.pausedAt.getTime() : 0;

    this.paused = false;
    this.pausedAt = null;
    // Reset the hard limit flag so it can trigger again if needed
    this.hardLimitHitAt = null;

    log.info('RollingSpendMonitor resumed', {
      pauseDurationMs: pauseDuration,
      currentSpend: this.getSpendInWindow(this.config.windowMinutes),
    });
  }

  /**
   * Checks if the monitor is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Gets the current configuration
   */
  getConfig(): RollingSpendMonitorConfig {
    return { ...this.config };
  }

  /**
   * Updates the configuration
   */
  updateConfig(config: Partial<RollingSpendMonitorConfig>): void {
    this.config = { ...this.config, ...config };

    log.info('RollingSpendMonitor config updated', {
      alertThresholdUsd: this.config.alertThresholdUsd,
      windowMinutes: this.config.windowMinutes,
      hardLimitUsd: this.config.hardLimitUsd,
    });
  }

  /**
   * Gets monitoring statistics
   */
  getStats(): {
    currentSpend: number;
    alertThreshold: number;
    hardLimit: number;
    windowMinutes: number;
    isPaused: boolean;
    pausedAt: Date | null;
    recordCount: number;
    topTasks: TaskSpend[];
  } {
    return {
      currentSpend: this.getSpendInWindow(this.config.windowMinutes),
      alertThreshold: this.config.alertThresholdUsd,
      hardLimit: this.config.hardLimitUsd,
      windowMinutes: this.config.windowMinutes,
      isPaused: this.paused,
      pausedAt: this.pausedAt,
      recordCount: this.spendRecords.length,
      topTasks: this.getSpendByTask().slice(0, 5),
    };
  }

  /**
   * Resets all spend records and state
   */
  reset(): void {
    this.spendRecords = [];
    this.paused = false;
    this.pausedAt = null;
    this.alertSentAt = null;
    this.hardLimitHitAt = null;

    log.info('RollingSpendMonitor reset');
  }

  /**
   * Creates a spend alert object with current state
   */
  private createAlert(currentSpend: number, isHardLimit: boolean): SpendAlert {
    return {
      amountSpent: currentSpend,
      windowMinutes: this.config.windowMinutes,
      threshold: isHardLimit ? this.config.hardLimitUsd : this.config.alertThresholdUsd,
      isHardLimit,
      topTasks: this.getSpendByTask().slice(0, 5),
      timestamp: new Date(),
    };
  }

  /**
   * Triggers an alert callback
   */
  private async triggerAlert(currentSpend: number, isHardLimit: boolean): Promise<void> {
    const alert = this.createAlert(currentSpend, isHardLimit);

    if (this.config.onAlert) {
      try {
        await this.config.onAlert(alert);
      } catch (error) {
        log.error(
          'Error in alert callback',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  /**
   * Triggers a hard limit alert callback
   */
  private async triggerHardLimitAlert(currentSpend: number): Promise<void> {
    const alert = this.createAlert(currentSpend, true);

    if (this.config.onHardLimit) {
      try {
        await this.config.onHardLimit(alert);
      } catch (error) {
        log.error(
          'Error in hard limit callback',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    } else if (this.config.onAlert) {
      // Fall back to onAlert if no specific hard limit handler
      await this.triggerAlert(currentSpend, true);
    }
  }

  /**
   * Removes records outside the tracking window
   */
  private pruneOldRecords(): void {
    // Keep records for 2x the window to allow for some lookback
    const maxAge = this.config.windowMinutes * 2 * 60 * 1000;
    const cutoff = new Date(Date.now() - maxAge);

    const beforeCount = this.spendRecords.length;
    this.spendRecords = this.spendRecords.filter(record => record.timestamp >= cutoff);
    const afterCount = this.spendRecords.length;

    if (beforeCount !== afterCount) {
      log.debug('Pruned old spend records', {
        removed: beforeCount - afterCount,
        remaining: afterCount,
      });
    }
  }
}

/**
 * Formats a spend alert for Slack notification
 */
export function formatSpendAlert(alert: SpendAlert): string {
  const emoji = alert.isHardLimit ? ':rotating_light:' : ':warning:';
  const severity = alert.isHardLimit ? 'HARD LIMIT EXCEEDED' : 'Spending Alert';

  let message = `${emoji} *${severity}*\n\n`;
  message += `*Amount spent:* $${alert.amountSpent.toFixed(2)} in ${alert.windowMinutes} minutes\n`;
  message += `*Threshold:* $${alert.threshold.toFixed(2)}\n\n`;

  if (alert.topTasks.length > 0) {
    message += '*Top spending tasks:*\n';
    for (const task of alert.topTasks) {
      message += `  - \`${task.taskId}\` (${task.model}): $${task.amount.toFixed(2)} (${task.percentage.toFixed(1)}%)\n`;
    }
    message += '\n';
  }

  message += '*Options:*\n';
  message += '  - `continue` - Resume agents and continue monitoring\n';
  message += '  - `pause 10` - Pause agents for 10 minutes\n';
  message += '  - `stop` - Stop all agents immediately\n';

  return message;
}
