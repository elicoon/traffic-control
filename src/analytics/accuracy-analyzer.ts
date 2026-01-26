import { SupabaseClient } from '@supabase/supabase-js';
import { Task } from '../db/repositories/tasks.js';

export interface AccuracyBreakdown {
  sampleSize: number;
  meanError: number;
  stdDev: number;
  accuracy: number;
  tendency: 'overestimate' | 'underestimate' | 'accurate';
}

export interface AccuracyMetrics {
  projectId?: string;
  sampleSize: number;
  meanSessionError: number;
  sessionErrorStdDev: number;
  sessionAccuracyPercent: number;
  meanInterventionError: number;
  interventionAccuracyPercent: number;
  byComplexity: {
    low: AccuracyBreakdown;
    medium: AccuracyBreakdown;
    high: AccuracyBreakdown;
  };
}

export interface TaskAccuracy {
  taskId: string;
  complexity?: string;
  estimatedSessions: { opus: number; sonnet: number };
  actualSessions: { opus: number; sonnet: number };
  sessionError: number;
  errorPercent: number;
}

export interface EstimationPatterns {
  overallTendency: 'overestimate' | 'underestimate' | 'accurate';
  overallMagnitude: number;
  byComplexity: {
    low?: { tendency: 'overestimate' | 'underestimate' | 'accurate'; magnitude: number };
    medium?: { tendency: 'overestimate' | 'underestimate' | 'accurate'; magnitude: number };
    high?: { tendency: 'overestimate' | 'underestimate' | 'accurate'; magnitude: number };
  };
  recommendations: string[];
}

export interface CompletedTaskFilter {
  complexity?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Analyzes estimation accuracy by comparing estimates to actual results.
 * Provides metrics, patterns, and breakdowns by complexity.
 */
export class AccuracyAnalyzer {
  constructor(private client: SupabaseClient) {}

  /**
   * Calculates comprehensive accuracy metrics for a project.
   */
  async calculateAccuracyMetrics(projectId: string): Promise<AccuracyMetrics> {
    const tasks = await this.getCompletedTasksWithEstimates(projectId);

    if (tasks.length === 0) {
      return this.emptyMetrics(projectId);
    }

    // Calculate overall session errors
    const sessionErrors = tasks.map(task => this.calculateSessionError(task));
    const meanSessionError = this.mean(sessionErrors);
    const sessionErrorStdDev = this.standardDeviation(sessionErrors);

    // Calculate accuracy percentage
    const accuracies = tasks.map(task => this.calculateAccuracyPercent(task));
    const sessionAccuracyPercent = this.mean(accuracies);

    // Calculate by complexity
    const byComplexity = this.calculateByComplexity(tasks);

    return {
      projectId,
      sampleSize: tasks.length,
      meanSessionError,
      sessionErrorStdDev,
      sessionAccuracyPercent,
      meanInterventionError: 0, // Placeholder for intervention tracking
      interventionAccuracyPercent: 100,
      byComplexity
    };
  }

  /**
   * Calculates accuracy for a single task.
   */
  async calculateTaskAccuracy(taskId: string): Promise<TaskAccuracy | null> {
    const { data: task, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('id', taskId)
      .single();

    if (error || !task) return null;
    if (task.status !== 'complete') return null;

    const estimated = {
      opus: task.estimated_sessions_opus ?? 0,
      sonnet: task.estimated_sessions_sonnet ?? 0
    };
    const actual = {
      opus: task.actual_sessions_opus ?? 0,
      sonnet: task.actual_sessions_sonnet ?? 0
    };

    const totalEstimated = estimated.opus + estimated.sonnet;
    const totalActual = actual.opus + actual.sonnet;
    const sessionError = totalEstimated - totalActual;

    // Calculate error percent (handle division by zero)
    let errorPercent: number;
    if (totalEstimated === 0 && totalActual === 0) {
      errorPercent = 0;
    } else if (totalEstimated === 0) {
      errorPercent = -100; // Severe underestimate
    } else {
      errorPercent = (sessionError / totalEstimated) * 100;
    }

    return {
      taskId,
      complexity: task.complexity_estimate,
      estimatedSessions: estimated,
      actualSessions: actual,
      sessionError,
      errorPercent
    };
  }

  /**
   * Identifies systematic estimation patterns.
   */
  async identifyEstimationPatterns(projectId: string): Promise<EstimationPatterns> {
    const metrics = await this.calculateAccuracyMetrics(projectId);
    const recommendations: string[] = [];

    // Determine overall tendency
    const overallTendency = this.determineTendency(metrics.meanSessionError);
    const overallMagnitude = Math.abs(metrics.meanSessionError);

    // Analyze by complexity
    const byComplexity: EstimationPatterns['byComplexity'] = {};

    for (const [complexity, breakdown] of Object.entries(metrics.byComplexity)) {
      if (breakdown.sampleSize > 0) {
        byComplexity[complexity as 'low' | 'medium' | 'high'] = {
          tendency: breakdown.tendency,
          magnitude: Math.abs(breakdown.meanError)
        };

        // Generate recommendations
        if (breakdown.tendency === 'underestimate' && Math.abs(breakdown.meanError) > 1) {
          recommendations.push(
            `${complexity.charAt(0).toUpperCase() + complexity.slice(1)} complexity tasks are consistently underestimated by ~${Math.abs(breakdown.meanError).toFixed(1)} sessions. Consider increasing estimates by ${((Math.abs(breakdown.meanError) / (breakdown.meanError + 3)) * 100).toFixed(0)}%.`
          );
        } else if (breakdown.tendency === 'overestimate' && Math.abs(breakdown.meanError) > 1) {
          recommendations.push(
            `${complexity.charAt(0).toUpperCase() + complexity.slice(1)} complexity tasks are consistently overestimated by ~${Math.abs(breakdown.meanError).toFixed(1)} sessions. Consider reducing estimates by ${((Math.abs(breakdown.meanError) / (breakdown.meanError + 3)) * 100).toFixed(0)}%.`
          );
        }
      }
    }

    if (recommendations.length === 0 && metrics.sampleSize >= 5) {
      recommendations.push('Estimates are generally accurate. Continue current estimation practices.');
    }

    return {
      overallTendency,
      overallMagnitude,
      byComplexity,
      recommendations
    };
  }

  /**
   * Gets completed tasks with both estimates and actuals.
   */
  async getCompletedTasksWithEstimates(
    projectId: string,
    filter?: CompletedTaskFilter
  ): Promise<Task[]> {
    let query = this.client
      .from('tc_tasks')
      .select()
      .eq('project_id', projectId)
      .eq('status', 'complete')
      .not('completed_at', 'is', null);

    if (filter?.complexity) {
      query = query.eq('complexity_estimate', filter.complexity);
    }
    if (filter?.startDate) {
      query = query.gte('completed_at', filter.startDate.toISOString());
    }
    if (filter?.endDate) {
      query = query.lte('completed_at', filter.endDate.toISOString());
    }

    const { data, error } = await query;

    if (error) throw new Error(`Failed to get completed tasks: ${error.message}`);
    return (data as Task[]) || [];
  }

  /**
   * Returns empty metrics for projects with no data.
   */
  private emptyMetrics(projectId?: string): AccuracyMetrics {
    const emptyBreakdown: AccuracyBreakdown = {
      sampleSize: 0,
      meanError: 0,
      stdDev: 0,
      accuracy: 100,
      tendency: 'accurate'
    };

    return {
      projectId,
      sampleSize: 0,
      meanSessionError: 0,
      sessionErrorStdDev: 0,
      sessionAccuracyPercent: 100,
      meanInterventionError: 0,
      interventionAccuracyPercent: 100,
      byComplexity: {
        low: { ...emptyBreakdown },
        medium: { ...emptyBreakdown },
        high: { ...emptyBreakdown }
      }
    };
  }

  /**
   * Calculates breakdown by complexity level.
   */
  private calculateByComplexity(tasks: Task[]): AccuracyMetrics['byComplexity'] {
    const byComplexity: AccuracyMetrics['byComplexity'] = {
      low: this.emptyBreakdown(),
      medium: this.emptyBreakdown(),
      high: this.emptyBreakdown()
    };

    const complexities = ['low', 'medium', 'high'] as const;

    for (const complexity of complexities) {
      const complexityTasks = tasks.filter(t => t.complexity_estimate === complexity);

      if (complexityTasks.length > 0) {
        const errors = complexityTasks.map(t => this.calculateSessionError(t));
        const meanError = this.mean(errors);
        const stdDev = this.standardDeviation(errors);
        const accuracies = complexityTasks.map(t => this.calculateAccuracyPercent(t));
        const accuracy = this.mean(accuracies);

        byComplexity[complexity] = {
          sampleSize: complexityTasks.length,
          meanError,
          stdDev,
          accuracy,
          tendency: this.determineTendency(meanError)
        };
      }
    }

    return byComplexity;
  }

  /**
   * Returns an empty breakdown structure.
   */
  private emptyBreakdown(): AccuracyBreakdown {
    return {
      sampleSize: 0,
      meanError: 0,
      stdDev: 0,
      accuracy: 100,
      tendency: 'accurate'
    };
  }

  /**
   * Calculates session error (estimated - actual).
   * Positive = overestimate, Negative = underestimate
   */
  private calculateSessionError(task: Task): number {
    const estimated = (task.estimated_sessions_opus ?? 0) + (task.estimated_sessions_sonnet ?? 0);
    const actual = (task.actual_sessions_opus ?? 0) + (task.actual_sessions_sonnet ?? 0);
    return estimated - actual;
  }

  /**
   * Calculates accuracy percentage for a task.
   */
  private calculateAccuracyPercent(task: Task): number {
    const estimated = (task.estimated_sessions_opus ?? 0) + (task.estimated_sessions_sonnet ?? 0);
    const actual = (task.actual_sessions_opus ?? 0) + (task.actual_sessions_sonnet ?? 0);

    if (estimated === 0 && actual === 0) return 100;
    if (estimated === 0 || actual === 0) return 0;

    const error = Math.abs(estimated - actual);
    const max = Math.max(estimated, actual);
    return Math.max(0, (1 - error / max) * 100);
  }

  /**
   * Determines tendency based on mean error.
   */
  private determineTendency(meanError: number): 'overestimate' | 'underestimate' | 'accurate' {
    if (meanError > 0.5) return 'overestimate';
    if (meanError < -0.5) return 'underestimate';
    return 'accurate';
  }

  /**
   * Calculates mean of an array.
   */
  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculates standard deviation of an array.
   */
  private standardDeviation(values: number[]): number {
    if (values.length <= 1) return 0;
    const avg = this.mean(values);
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }
}
