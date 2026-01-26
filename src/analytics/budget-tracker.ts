import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Budget period types
 */
export type BudgetPeriodType = 'daily' | 'weekly' | 'monthly';

/**
 * Budget configuration
 */
export interface Budget {
  id: string;
  projectId?: string;
  periodType: BudgetPeriodType;
  budgetUsd: number;
  alertThresholdPercent: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Budget status with spending info
 */
export interface BudgetStatus {
  budgetId: string;
  projectId?: string;
  periodType: BudgetPeriodType;
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
  projectedTotalUsd: number;
  onTrack: boolean;
  alertTriggered: boolean;
  alertThresholdPercent: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Input for creating a budget
 */
export interface CreateBudgetInput {
  projectId?: string;
  periodType: BudgetPeriodType;
  budgetUsd: number;
  alertThresholdPercent?: number;
}

/**
 * Input for updating a budget
 */
export interface UpdateBudgetInput {
  budgetUsd?: number;
  alertThresholdPercent?: number;
}

/**
 * Budget alert
 */
export interface BudgetAlert {
  budget: Budget;
  status: BudgetStatus;
  severity: 'warning' | 'critical';
  message: string;
}

/**
 * Database row for budget
 */
interface BudgetRow {
  id: string;
  project_id: string | null;
  period_type: string;
  budget_usd: string;
  alert_threshold_percent: number;
  created_at: string;
  updated_at: string;
}

/**
 * Database row for usage log
 */
interface UsageLogRow {
  cost_usd: number;
  created_at: string;
}

/**
 * BudgetTracker - Manages budgets and tracks spending
 *
 * Provides budget configuration, spending tracking, and alerts
 * when spending approaches or exceeds thresholds.
 */
export class BudgetTracker {
  constructor(private client: SupabaseClient) {}

  /**
   * Create a new budget
   */
  async createBudget(input: CreateBudgetInput): Promise<Budget> {
    const { data, error } = await this.client
      .from('tc_budgets')
      .insert({
        project_id: input.projectId ?? null,
        period_type: input.periodType,
        budget_usd: input.budgetUsd.toFixed(2),
        alert_threshold_percent: input.alertThresholdPercent ?? 80,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create budget: ${error.message}`);
    }

    return this.rowToBudget(data as BudgetRow);
  }

  /**
   * Get budget by ID
   */
  async getBudget(id: string): Promise<Budget | null> {
    const { data, error } = await this.client.from('tc_budgets').select('*').eq('id', id);

    if (error) {
      throw new Error(`Failed to get budget: ${error.message}`);
    }

    const rows = data as BudgetRow[];
    if (!rows || rows.length === 0) {
      return null;
    }

    return this.rowToBudget(rows[0]);
  }

  /**
   * Get budget for a specific project and period type
   */
  async getBudgetForProject(
    projectId: string,
    periodType: BudgetPeriodType
  ): Promise<Budget | null> {
    const { data, error } = await this.client
      .from('tc_budgets')
      .select('*')
      .eq('project_id', projectId)
      .eq('period_type', periodType);

    if (error) {
      throw new Error(`Failed to get budget for project: ${error.message}`);
    }

    const rows = data as BudgetRow[];
    if (!rows || rows.length === 0) {
      return null;
    }

    return this.rowToBudget(rows[0]);
  }

  /**
   * Get global budget (no project specified)
   */
  async getGlobalBudget(periodType: BudgetPeriodType): Promise<Budget | null> {
    const { data, error } = await this.client
      .from('tc_budgets')
      .select('*')
      .is('project_id', null)
      .eq('period_type', periodType);

    if (error) {
      throw new Error(`Failed to get global budget: ${error.message}`);
    }

    const rows = data as BudgetRow[];
    if (!rows || rows.length === 0) {
      return null;
    }

    return this.rowToBudget(rows[0]);
  }

  /**
   * Update a budget
   */
  async updateBudget(id: string, input: UpdateBudgetInput): Promise<Budget> {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.budgetUsd !== undefined) {
      updates.budget_usd = input.budgetUsd.toFixed(2);
    }

    if (input.alertThresholdPercent !== undefined) {
      updates.alert_threshold_percent = input.alertThresholdPercent;
    }

    const { data, error } = await this.client
      .from('tc_budgets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update budget: ${error.message}`);
    }

    return this.rowToBudget(data as BudgetRow);
  }

  /**
   * Delete a budget
   */
  async deleteBudget(id: string): Promise<void> {
    const { error } = await this.client.from('tc_budgets').delete().eq('id', id);

    if (error) {
      throw new Error(`Failed to delete budget: ${error.message}`);
    }
  }

  /**
   * Get all configured budgets
   */
  async getAllBudgets(): Promise<Budget[]> {
    const { data, error } = await this.client
      .from('tc_budgets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to get budgets: ${error.message}`);
    }

    return (data as BudgetRow[]).map(row => this.rowToBudget(row));
  }

  /**
   * Get budget status for a project
   */
  async getBudgetStatus(
    projectId: string,
    periodType: BudgetPeriodType,
    asOfDate?: Date
  ): Promise<BudgetStatus | null> {
    const budget = await this.getBudgetForProject(projectId, periodType);

    if (!budget) {
      return null;
    }

    return this.calculateBudgetStatus(budget, projectId, asOfDate);
  }

  /**
   * Get global budget status
   */
  async getGlobalBudgetStatus(
    periodType: BudgetPeriodType,
    asOfDate?: Date
  ): Promise<BudgetStatus | null> {
    const budget = await this.getGlobalBudget(periodType);

    if (!budget) {
      return null;
    }

    return this.calculateBudgetStatus(budget, undefined, asOfDate);
  }

  /**
   * Check all budgets for alerts
   */
  async checkBudgetAlerts(): Promise<BudgetAlert[]> {
    const budgets = await this.getAllBudgets();
    const alerts: BudgetAlert[] = [];

    for (const budget of budgets) {
      const status = await this.calculateBudgetStatus(budget, budget.projectId);

      if (status.alertTriggered) {
        const severity = status.percentUsed >= 100 ? 'critical' : 'warning';
        const message =
          severity === 'critical'
            ? `Budget exceeded! ${status.percentUsed.toFixed(1)}% of ${budget.periodType} budget used.`
            : `Budget alert: ${status.percentUsed.toFixed(1)}% of ${budget.periodType} budget used (threshold: ${budget.alertThresholdPercent}%).`;

        alerts.push({
          budget,
          status,
          severity,
          message,
        });
      }
    }

    return alerts;
  }

  /**
   * Calculate budget status
   */
  private async calculateBudgetStatus(
    budget: Budget,
    projectId?: string,
    asOfDate?: Date
  ): Promise<BudgetStatus> {
    const now = asOfDate ?? new Date();
    const { periodStart, periodEnd } = this.getPeriodBounds(budget.periodType, now);

    // Get spending for the period
    const spentUsd = await this.getSpendingForPeriod(projectId, periodStart, periodEnd);

    const remainingUsd = Math.max(0, budget.budgetUsd - spentUsd);
    const percentUsed = budget.budgetUsd > 0 ? (spentUsd / budget.budgetUsd) * 100 : 0;
    const alertTriggered = percentUsed >= budget.alertThresholdPercent;

    // Project spending based on current rate
    const projectedTotalUsd = this.projectSpending(spentUsd, periodStart, periodEnd, now);
    const onTrack = projectedTotalUsd <= budget.budgetUsd;

    return {
      budgetId: budget.id,
      projectId,
      periodType: budget.periodType,
      budgetUsd: budget.budgetUsd,
      spentUsd,
      remainingUsd,
      percentUsed,
      projectedTotalUsd,
      onTrack,
      alertTriggered,
      alertThresholdPercent: budget.alertThresholdPercent,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Get spending for a period
   */
  private async getSpendingForPeriod(
    projectId: string | undefined,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    let query = this.client
      .from('tc_usage_log')
      .select('cost_usd, created_at')
      .gte('created_at', periodStart.toISOString())
      .lte('created_at', periodEnd.toISOString());

    // If projectId specified, we'd need to join through sessions -> tasks
    // For now, we'll get all usage in the period (simplified implementation)
    // In production, this would need proper project filtering

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get spending: ${error.message}`);
    }

    const logs = data as UsageLogRow[];
    return logs.reduce((sum, log) => sum + (log.cost_usd || 0), 0);
  }

  /**
   * Project spending for the full period based on current rate
   */
  private projectSpending(
    currentSpent: number,
    periodStart: Date,
    periodEnd: Date,
    asOfDate: Date
  ): number {
    const totalPeriodMs = periodEnd.getTime() - periodStart.getTime();
    const elapsedMs = asOfDate.getTime() - periodStart.getTime();

    if (elapsedMs <= 0) {
      return currentSpent;
    }

    const percentElapsed = Math.min(1, elapsedMs / totalPeriodMs);

    if (percentElapsed === 0) {
      return currentSpent;
    }

    // Extrapolate current spending to full period
    return currentSpent / percentElapsed;
  }

  /**
   * Get period bounds based on period type
   */
  private getPeriodBounds(
    periodType: BudgetPeriodType,
    asOfDate: Date
  ): { periodStart: Date; periodEnd: Date } {
    const date = new Date(asOfDate);

    switch (periodType) {
      case 'daily': {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        return { periodStart: start, periodEnd: end };
      }

      case 'weekly': {
        // Week starts on Monday
        const dayOfWeek = date.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust for Monday start
        const start = new Date(date);
        start.setDate(date.getDate() - diff);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { periodStart: start, periodEnd: end };
      }

      case 'monthly': {
        const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
        return { periodStart: start, periodEnd: end };
      }

      default:
        throw new Error(`Unknown period type: ${periodType}`);
    }
  }

  /**
   * Convert database row to Budget
   */
  private rowToBudget(row: BudgetRow): Budget {
    return {
      id: row.id,
      projectId: row.project_id ?? undefined,
      periodType: row.period_type as BudgetPeriodType,
      budgetUsd: parseFloat(row.budget_usd),
      alertThresholdPercent: row.alert_threshold_percent,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
