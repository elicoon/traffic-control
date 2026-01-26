import { SupabaseClient } from '@supabase/supabase-js';
import { CostTracker } from './cost-tracker.js';

/**
 * ROI metrics for a task, project, or overall
 */
export interface ROIMetrics {
  taskId?: string;
  projectId?: string;
  estimatedSessions: number;
  estimatedCost: number;
  actualSessions: number;
  actualCost: number;
  actualTokens: { input: number; output: number };
  costVariance: number; // (actual - estimated) / estimated
  sessionVariance: number; // (actual - estimated) / estimated
  efficiency: number; // estimated / actual (>1 = more efficient)
  totalDurationMinutes: number;
  interventionMinutes: number;
  automatedMinutes: number;
}

/**
 * Input for task ROI calculation
 */
export interface TaskROIInput {
  taskId: string;
}

/**
 * Input for project ROI calculation
 */
export interface ProjectROIInput {
  projectId: string;
  completedOnly?: boolean;
}

/**
 * Input for overall ROI calculation
 */
export interface OverallROIInput {
  startDate?: Date;
  endDate?: Date;
  completedOnly?: boolean;
}

/**
 * Estimate accuracy statistics
 */
export interface EstimateAccuracy {
  totalTasks: number;
  totalEstimatedSessions: number;
  totalActualSessions: number;
  averageVariance: number;
  underestimatedCount: number;
  overestimatedCount: number;
  accurateCount: number; // Within 10% variance
  accuracyPercentage: number;
}

/**
 * Detailed comparison of estimate vs actual
 */
export interface EstimateComparison {
  taskId: string;
  taskTitle: string;
  sessions: {
    estimated: { opus: number; sonnet: number; total: number };
    actual: { opus: number; sonnet: number; total: number };
    variance: { opus: number; sonnet: number; total: number };
  };
  cost: {
    estimated: number;
    actual: number;
    variance: number;
  };
  duration: {
    estimatedMinutes: number;
    actualMinutes: number;
    variance: number;
  };
}

/**
 * Database row types
 */
interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
  estimated_sessions_opus: number;
  estimated_sessions_sonnet: number;
  actual_sessions_opus: number;
  actual_sessions_sonnet: number;
  actual_tokens_opus: number;
  actual_tokens_sonnet: number;
  started_at: string | null;
  completed_at: string | null;
}

interface UsageLogRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface InterventionRow {
  duration_seconds: number;
}

/**
 * ROI Calculator - Calculates return on investment metrics
 *
 * Compares estimated vs actual sessions and costs to measure
 * estimation accuracy and overall efficiency.
 */
export class ROICalculator {
  private costTracker: CostTracker;

  constructor(private client: SupabaseClient) {
    this.costTracker = new CostTracker(client);
  }

  /**
   * Calculate ROI metrics for a specific task
   */
  async calculateTaskROI(taskId: string): Promise<ROIMetrics> {
    // Get task data
    const { data: taskData, error: taskError } = await this.client
      .from('tc_tasks')
      .select('*')
      .eq('id', taskId);

    if (taskError) {
      throw new Error(`Failed to get task: ${taskError.message}`);
    }

    const tasks = taskData as TaskRow[];
    if (!tasks || tasks.length === 0) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const task = tasks[0];
    return this.calculateMetricsForTask(task);
  }

  /**
   * Calculate ROI metrics for a project
   */
  async calculateProjectROI(
    projectId: string,
    options: { completedOnly?: boolean } = {}
  ): Promise<ROIMetrics> {
    let query = this.client.from('tc_tasks').select('*').eq('project_id', projectId);

    if (options.completedOnly) {
      query = query.eq('status', 'complete');
    }

    const { data: taskData, error: taskError } = await query;

    if (taskError) {
      throw new Error(`Failed to get tasks: ${taskError.message}`);
    }

    const tasks = (taskData as TaskRow[]) || [];
    const completedTasks = options.completedOnly
      ? tasks
      : tasks.filter(t => t.status === 'complete');

    return this.aggregateMetrics(completedTasks, { projectId });
  }

  /**
   * Calculate overall ROI across all projects
   */
  async calculateOverallROI(options: OverallROIInput = {}): Promise<ROIMetrics> {
    let query = this.client.from('tc_tasks').select('*');

    if (options.startDate) {
      query = query.gte('completed_at', options.startDate.toISOString());
    }

    if (options.endDate) {
      query = query.lte('completed_at', options.endDate.toISOString());
    }

    const { data: taskData, error: taskError } = await query;

    if (taskError) {
      throw new Error(`Failed to get tasks: ${taskError.message}`);
    }

    const tasks = (taskData as TaskRow[]) || [];
    const completedTasks =
      options.completedOnly !== false ? tasks.filter(t => t.status === 'complete') : tasks;

    return this.aggregateMetrics(completedTasks);
  }

  /**
   * Get estimate accuracy statistics
   */
  async getEstimateAccuracy(options: OverallROIInput = {}): Promise<EstimateAccuracy> {
    let query = this.client.from('tc_tasks').select('*').eq('status', 'complete');

    if (options.startDate) {
      query = query.gte('completed_at', options.startDate.toISOString());
    }

    if (options.endDate) {
      query = query.lte('completed_at', options.endDate.toISOString());
    }

    const { data: taskData, error: taskError } = await query;

    if (taskError) {
      throw new Error(`Failed to get tasks: ${taskError.message}`);
    }

    const tasks = (taskData as TaskRow[]) || [];

    let totalEstimated = 0;
    let totalActual = 0;
    let underestimated = 0;
    let overestimated = 0;
    let accurate = 0;

    for (const task of tasks) {
      const estimated =
        (task.estimated_sessions_opus || 0) + (task.estimated_sessions_sonnet || 0);
      const actual = (task.actual_sessions_opus || 0) + (task.actual_sessions_sonnet || 0);

      totalEstimated += estimated;
      totalActual += actual;

      if (estimated === 0) continue;

      const variance = (actual - estimated) / estimated;

      if (variance > 0.1) {
        underestimated++;
      } else if (variance < -0.1) {
        overestimated++;
      } else {
        accurate++;
      }
    }

    const totalTasks = tasks.length;
    const averageVariance = totalEstimated > 0 ? (totalActual - totalEstimated) / totalEstimated : 0;

    return {
      totalTasks,
      totalEstimatedSessions: totalEstimated,
      totalActualSessions: totalActual,
      averageVariance,
      underestimatedCount: underestimated,
      overestimatedCount: overestimated,
      accurateCount: accurate,
      accuracyPercentage: totalTasks > 0 ? (accurate / totalTasks) * 100 : 0,
    };
  }

  /**
   * Get detailed comparison of estimate vs actual for a task
   */
  async compareEstimateVsActual(taskId: string): Promise<EstimateComparison> {
    const { data: taskData, error: taskError } = await this.client
      .from('tc_tasks')
      .select('*')
      .eq('id', taskId);

    if (taskError) {
      throw new Error(`Failed to get task: ${taskError.message}`);
    }

    const tasks = taskData as TaskRow[];
    if (!tasks || tasks.length === 0) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const task = tasks[0];

    // Get cost estimates
    const estimatedCost = await this.estimateCostForSessions(
      task.estimated_sessions_opus || 0,
      task.estimated_sessions_sonnet || 0
    );

    const actualCost = await this.calculateActualCost(task);

    // Calculate session metrics
    const estimatedOpus = task.estimated_sessions_opus || 0;
    const estimatedSonnet = task.estimated_sessions_sonnet || 0;
    const actualOpus = task.actual_sessions_opus || 0;
    const actualSonnet = task.actual_sessions_sonnet || 0;

    const sessionVarianceOpus = estimatedOpus > 0 ? (actualOpus - estimatedOpus) / estimatedOpus : 0;
    const sessionVarianceSonnet =
      estimatedSonnet > 0 ? (actualSonnet - estimatedSonnet) / estimatedSonnet : 0;

    const totalEstimated = estimatedOpus + estimatedSonnet;
    const totalActual = actualOpus + actualSonnet;
    const totalVariance = totalEstimated > 0 ? (totalActual - totalEstimated) / totalEstimated : 0;

    // Calculate duration
    let actualMinutes = 0;
    if (task.started_at && task.completed_at) {
      actualMinutes =
        (new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000;
    }

    // Estimate based on average session duration (placeholder)
    const estimatedMinutes = totalEstimated * 30; // Assume 30 min per session
    const durationVariance =
      estimatedMinutes > 0 ? (actualMinutes - estimatedMinutes) / estimatedMinutes : 0;

    return {
      taskId,
      taskTitle: task.title,
      sessions: {
        estimated: { opus: estimatedOpus, sonnet: estimatedSonnet, total: totalEstimated },
        actual: { opus: actualOpus, sonnet: actualSonnet, total: totalActual },
        variance: {
          opus: sessionVarianceOpus,
          sonnet: sessionVarianceSonnet,
          total: totalVariance,
        },
      },
      cost: {
        estimated: estimatedCost,
        actual: actualCost,
        variance: estimatedCost > 0 ? (actualCost - estimatedCost) / estimatedCost : 0,
      },
      duration: {
        estimatedMinutes,
        actualMinutes,
        variance: durationVariance,
      },
    };
  }

  /**
   * Calculate metrics for a single task
   */
  private async calculateMetricsForTask(task: TaskRow): Promise<ROIMetrics> {
    const estimatedSessions =
      (task.estimated_sessions_opus || 0) + (task.estimated_sessions_sonnet || 0);
    const actualSessions = (task.actual_sessions_opus || 0) + (task.actual_sessions_sonnet || 0);

    // Get interventions for this task
    const { data: interventionsData } = await this.client
      .from('tc_interventions')
      .select('duration_seconds')
      .eq('task_id', task.id);

    const interventions = (interventionsData as InterventionRow[]) || [];
    const interventionMinutes = interventions.reduce(
      (sum, i) => sum + (i.duration_seconds || 0) / 60,
      0
    );

    // Calculate duration
    let totalDurationMinutes = 0;
    if (task.started_at && task.completed_at) {
      totalDurationMinutes =
        (new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000;
    }

    // Calculate costs
    const estimatedCost = await this.estimateCostForSessions(
      task.estimated_sessions_opus || 0,
      task.estimated_sessions_sonnet || 0
    );

    const actualCost = await this.calculateActualCost(task);

    // Calculate variances
    const sessionVariance =
      estimatedSessions > 0 ? (actualSessions - estimatedSessions) / estimatedSessions : 0;
    const costVariance = estimatedCost > 0 ? (actualCost - estimatedCost) / estimatedCost : 0;

    // Efficiency is how well we performed vs estimate
    const efficiency = actualSessions > 0 ? estimatedSessions / actualSessions : 1;

    return {
      taskId: task.id,
      projectId: task.project_id,
      estimatedSessions,
      estimatedCost,
      actualSessions,
      actualCost,
      actualTokens: {
        input: (task.actual_tokens_opus || 0) + (task.actual_tokens_sonnet || 0),
        output: 0, // Not tracked separately in task
      },
      costVariance,
      sessionVariance,
      efficiency,
      totalDurationMinutes,
      interventionMinutes,
      automatedMinutes: totalDurationMinutes - interventionMinutes,
    };
  }

  /**
   * Aggregate metrics across multiple tasks
   */
  private async aggregateMetrics(
    tasks: TaskRow[],
    identifiers: { taskId?: string; projectId?: string } = {}
  ): Promise<ROIMetrics> {
    let totalEstimatedSessions = 0;
    let totalActualSessions = 0;
    let totalEstimatedCost = 0;
    let totalActualCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalDurationMinutes = 0;
    let totalInterventionMinutes = 0;

    for (const task of tasks) {
      const metrics = await this.calculateMetricsForTask(task);

      totalEstimatedSessions += metrics.estimatedSessions;
      totalActualSessions += metrics.actualSessions;
      totalEstimatedCost += metrics.estimatedCost;
      totalActualCost += metrics.actualCost;
      totalInputTokens += metrics.actualTokens.input;
      totalDurationMinutes += metrics.totalDurationMinutes;
      totalInterventionMinutes += metrics.interventionMinutes;
    }

    const sessionVariance =
      totalEstimatedSessions > 0
        ? (totalActualSessions - totalEstimatedSessions) / totalEstimatedSessions
        : 0;
    const costVariance =
      totalEstimatedCost > 0 ? (totalActualCost - totalEstimatedCost) / totalEstimatedCost : 0;
    const efficiency = totalActualSessions > 0 ? totalEstimatedSessions / totalActualSessions : 1;

    return {
      ...identifiers,
      estimatedSessions: totalEstimatedSessions,
      estimatedCost: totalEstimatedCost,
      actualSessions: totalActualSessions,
      actualCost: totalActualCost,
      actualTokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
      costVariance,
      sessionVariance,
      efficiency,
      totalDurationMinutes,
      interventionMinutes: totalInterventionMinutes,
      automatedMinutes: totalDurationMinutes - totalInterventionMinutes,
    };
  }

  /**
   * Estimate cost based on number of sessions
   */
  private async estimateCostForSessions(
    opusSessions: number,
    sonnetSessions: number
  ): Promise<number> {
    try {
      const estimate = await this.costTracker.estimateCost({
        opusSessions,
        sonnetSessions,
      });
      return estimate.totalCost;
    } catch {
      // If pricing not available, return 0
      return 0;
    }
  }

  /**
   * Calculate actual cost from task tokens
   */
  private async calculateActualCost(task: TaskRow): Promise<number> {
    let cost = 0;

    if (task.actual_tokens_opus > 0) {
      try {
        // Assume 80% input, 20% output ratio for tokens
        const inputTokens = Math.round(task.actual_tokens_opus * 0.8);
        const outputTokens = Math.round(task.actual_tokens_opus * 0.2);
        const opusCost = await this.costTracker.calculateCost('opus', inputTokens, outputTokens);
        cost += opusCost.totalCost;
      } catch {
        // Ignore pricing errors
      }
    }

    if (task.actual_tokens_sonnet > 0) {
      try {
        const inputTokens = Math.round(task.actual_tokens_sonnet * 0.8);
        const outputTokens = Math.round(task.actual_tokens_sonnet * 0.2);
        const sonnetCost = await this.costTracker.calculateCost(
          'sonnet',
          inputTokens,
          outputTokens
        );
        cost += sonnetCost.totalCost;
      } catch {
        // Ignore pricing errors
      }
    }

    return cost;
  }
}
