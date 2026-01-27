/**
 * Spend Monitor
 *
 * Tracks spending across sessions and provides budget alerts.
 * Monitors cost accumulation and emits warnings at thresholds.
 */

import { logger } from '../../logging/index.js';

const log = logger.child('Safety.SpendMonitor');

/**
 * Spending entry for tracking costs
 */
export interface SpendEntry {
  sessionId: string;
  taskId?: string;
  model: 'opus' | 'sonnet' | 'haiku';
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  timestamp: Date;
}

/**
 * Budget threshold configuration
 */
export interface BudgetThreshold {
  /** Amount in USD */
  amount: number;
  /** Whether this threshold has been triggered */
  triggered: boolean;
  /** Callback when threshold is reached */
  onReached?: () => void;
}

/**
 * Spend monitor configuration
 */
export interface SpendMonitorConfig {
  /** Daily budget limit in USD */
  dailyBudgetUsd: number;
  /** Weekly budget limit in USD */
  weeklyBudgetUsd: number;
  /** Alert thresholds as percentages (e.g., [50, 75, 90, 100]) */
  alertThresholds: number[];
  /** Whether to hard-stop at 100% budget */
  hardStopAtLimit: boolean;
}

const DEFAULT_CONFIG: SpendMonitorConfig = {
  dailyBudgetUsd: 50,
  weeklyBudgetUsd: 200,
  alertThresholds: [50, 75, 90, 100],
  hardStopAtLimit: false,
};

/**
 * Spend statistics
 */
export interface SpendStats {
  dailySpend: number;
  weeklySpend: number;
  totalSpend: number;
  dailyBudgetUsed: number; // percentage
  weeklyBudgetUsed: number; // percentage
  byModel: {
    opus: { spend: number; sessions: number };
    sonnet: { spend: number; sessions: number };
    haiku: { spend: number; sessions: number };
  };
  isOverBudget: boolean;
  lastUpdated: Date;
}

/**
 * Alert callback type
 */
export type SpendAlertCallback = (
  type: 'daily' | 'weekly',
  percentage: number,
  currentSpend: number,
  budget: number
) => void;

/**
 * Spend Monitor - tracks and alerts on spending
 */
export class SpendMonitor {
  private config: SpendMonitorConfig;
  private entries: SpendEntry[] = [];
  private dailyThresholds: Map<number, boolean> = new Map();
  private weeklyThresholds: Map<number, boolean> = new Map();
  private alertCallbacks: SpendAlertCallback[] = [];

  constructor(config: Partial<SpendMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize threshold tracking
    for (const threshold of this.config.alertThresholds) {
      this.dailyThresholds.set(threshold, false);
      this.weeklyThresholds.set(threshold, false);
    }
  }

  /**
   * Register an alert callback
   */
  onAlert(callback: SpendAlertCallback): () => void {
    this.alertCallbacks.push(callback);
    return () => {
      const index = this.alertCallbacks.indexOf(callback);
      if (index >= 0) {
        this.alertCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Record a new spending entry
   */
  recordSpend(entry: SpendEntry): void {
    this.entries.push(entry);

    log.debug('Spend recorded', {
      sessionId: entry.sessionId,
      model: entry.model,
      costUsd: entry.costUsd.toFixed(4),
      tokens: entry.inputTokens + entry.outputTokens,
    });

    // Check thresholds
    this.checkThresholds();
  }

  /**
   * Record cost from an agent completion
   */
  recordAgentCost(
    sessionId: string,
    taskId: string | undefined,
    model: 'opus' | 'sonnet' | 'haiku',
    inputTokens: number,
    outputTokens: number,
    costUsd: number
  ): void {
    this.recordSpend({
      sessionId,
      taskId,
      model,
      costUsd,
      inputTokens,
      outputTokens,
      timestamp: new Date(),
    });
  }

  /**
   * Get current spend statistics
   */
  getStats(): SpendStats {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const dailyEntries = this.entries.filter((e) => e.timestamp >= startOfDay);
    const weeklyEntries = this.entries.filter((e) => e.timestamp >= startOfWeek);

    const dailySpend = dailyEntries.reduce((sum, e) => sum + e.costUsd, 0);
    const weeklySpend = weeklyEntries.reduce((sum, e) => sum + e.costUsd, 0);
    const totalSpend = this.entries.reduce((sum, e) => sum + e.costUsd, 0);

    // Calculate by model
    const byModel = {
      opus: { spend: 0, sessions: new Set<string>() },
      sonnet: { spend: 0, sessions: new Set<string>() },
      haiku: { spend: 0, sessions: new Set<string>() },
    };

    for (const entry of this.entries) {
      byModel[entry.model].spend += entry.costUsd;
      byModel[entry.model].sessions.add(entry.sessionId);
    }

    const dailyBudgetUsed = (dailySpend / this.config.dailyBudgetUsd) * 100;
    const weeklyBudgetUsed = (weeklySpend / this.config.weeklyBudgetUsd) * 100;

    return {
      dailySpend,
      weeklySpend,
      totalSpend,
      dailyBudgetUsed,
      weeklyBudgetUsed,
      byModel: {
        opus: { spend: byModel.opus.spend, sessions: byModel.opus.sessions.size },
        sonnet: { spend: byModel.sonnet.spend, sessions: byModel.sonnet.sessions.size },
        haiku: { spend: byModel.haiku.spend, sessions: byModel.haiku.sessions.size },
      },
      isOverBudget: dailyBudgetUsed >= 100 || weeklyBudgetUsed >= 100,
      lastUpdated: now,
    };
  }

  /**
   * Check if we should stop due to budget limits
   */
  shouldStop(): boolean {
    if (!this.config.hardStopAtLimit) {
      return false;
    }

    const stats = this.getStats();
    return stats.isOverBudget;
  }

  /**
   * Check budget thresholds and emit alerts
   */
  private checkThresholds(): void {
    const stats = this.getStats();

    // Check daily thresholds
    for (const threshold of this.config.alertThresholds) {
      if (stats.dailyBudgetUsed >= threshold && !this.dailyThresholds.get(threshold)) {
        this.dailyThresholds.set(threshold, true);
        this.emitAlert('daily', threshold, stats.dailySpend, this.config.dailyBudgetUsd);
      }
    }

    // Check weekly thresholds
    for (const threshold of this.config.alertThresholds) {
      if (stats.weeklyBudgetUsed >= threshold && !this.weeklyThresholds.get(threshold)) {
        this.weeklyThresholds.set(threshold, true);
        this.emitAlert('weekly', threshold, stats.weeklySpend, this.config.weeklyBudgetUsd);
      }
    }
  }

  /**
   * Emit a spend alert
   */
  private emitAlert(
    type: 'daily' | 'weekly',
    percentage: number,
    currentSpend: number,
    budget: number
  ): void {
    log.warn('Budget threshold reached', {
      type,
      percentage,
      currentSpend: currentSpend.toFixed(2),
      budget: budget.toFixed(2),
    });

    for (const callback of this.alertCallbacks) {
      try {
        callback(type, percentage, currentSpend, budget);
      } catch (error) {
        log.error(
          'Error in spend alert callback',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  /**
   * Reset daily thresholds (call at start of new day)
   */
  resetDailyThresholds(): void {
    for (const threshold of this.config.alertThresholds) {
      this.dailyThresholds.set(threshold, false);
    }
    log.info('Daily spend thresholds reset');
  }

  /**
   * Reset weekly thresholds (call at start of new week)
   */
  resetWeeklyThresholds(): void {
    for (const threshold of this.config.alertThresholds) {
      this.weeklyThresholds.set(threshold, false);
    }
    log.info('Weekly spend thresholds reset');
  }

  /**
   * Format stats for Slack
   */
  formatForSlack(): string {
    const stats = this.getStats();
    const lines: string[] = [
      '*Spend Monitor Status*',
      '',
      '```',
      `Daily:  $${stats.dailySpend.toFixed(2)} / $${this.config.dailyBudgetUsd.toFixed(2)} (${stats.dailyBudgetUsed.toFixed(1)}%)`,
      `Weekly: $${stats.weeklySpend.toFixed(2)} / $${this.config.weeklyBudgetUsd.toFixed(2)} (${stats.weeklyBudgetUsed.toFixed(1)}%)`,
      `Total:  $${stats.totalSpend.toFixed(2)}`,
      '',
      'By Model:',
      `  Opus:   $${stats.byModel.opus.spend.toFixed(2)} (${stats.byModel.opus.sessions} sessions)`,
      `  Sonnet: $${stats.byModel.sonnet.spend.toFixed(2)} (${stats.byModel.sonnet.sessions} sessions)`,
      `  Haiku:  $${stats.byModel.haiku.spend.toFixed(2)} (${stats.byModel.haiku.sessions} sessions)`,
      '```',
    ];

    if (stats.isOverBudget) {
      lines.push('');
      lines.push('*[!] OVER BUDGET - Consider pausing operations*');
    }

    return lines.join('\n');
  }

  /**
   * Get configuration
   */
  getConfig(): SpendMonitorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<SpendMonitorConfig>): void {
    this.config = { ...this.config, ...updates };

    // Reinitialize threshold tracking if alert thresholds changed
    if (updates.alertThresholds) {
      this.dailyThresholds.clear();
      this.weeklyThresholds.clear();
      for (const threshold of this.config.alertThresholds) {
        this.dailyThresholds.set(threshold, false);
        this.weeklyThresholds.set(threshold, false);
      }
    }

    log.info('Spend monitor config updated', updates);
  }
}
