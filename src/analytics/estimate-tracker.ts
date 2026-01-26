import { SupabaseClient } from '@supabase/supabase-js';

export type Estimator = 'system' | 'human' | 'calibrated';

export interface EstimateRecord {
  id: string;
  taskId: string;
  recordedAt: Date;
  estimatedSessionsOpus: number;
  estimatedSessionsSonnet: number;
  estimatedImpactScore?: string;
  estimatedInterventionMinutes?: number;
  estimator: Estimator;
  notes?: string;
}

export interface CreateEstimateInput {
  taskId: string;
  estimatedSessionsOpus: number;
  estimatedSessionsSonnet: number;
  estimatedImpactScore?: string;
  estimatedInterventionMinutes?: number;
  estimator?: Estimator;
  notes?: string;
}

export interface EstimateHistoryFilter {
  startDate?: Date;
  endDate?: Date;
  estimator?: Estimator;
}

interface DbEstimateRecord {
  id: string;
  task_id: string;
  recorded_at: string;
  estimated_sessions_opus: number;
  estimated_sessions_sonnet: number;
  estimated_impact_score: string | null;
  estimated_intervention_minutes: number | null;
  estimator: string;
  notes: string | null;
}

/**
 * Tracks and stores estimate history for tasks.
 * Provides methods to record, retrieve, and query estimate records.
 */
export class EstimateTracker {
  constructor(private client: SupabaseClient) {}

  /**
   * Records a new estimate for a task.
   */
  async recordEstimate(input: CreateEstimateInput): Promise<EstimateRecord> {
    const { data, error } = await this.client
      .from('tc_estimates_history')
      .insert({
        task_id: input.taskId,
        estimated_sessions_opus: input.estimatedSessionsOpus,
        estimated_sessions_sonnet: input.estimatedSessionsSonnet,
        estimated_impact_score: input.estimatedImpactScore ?? null,
        estimated_intervention_minutes: input.estimatedInterventionMinutes ?? null,
        estimator: input.estimator ?? 'system',
        notes: input.notes ?? null
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record estimate: ${error.message}`);
    return this.mapToEstimateRecord(data as DbEstimateRecord);
  }

  /**
   * Gets an estimate record by its ID.
   */
  async getById(id: string): Promise<EstimateRecord | null> {
    const { data, error } = await this.client
      .from('tc_estimates_history')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get estimate: ${error.message}`);
    }
    return data ? this.mapToEstimateRecord(data as DbEstimateRecord) : null;
  }

  /**
   * Gets all estimates for a specific task, ordered by recordedAt descending.
   */
  async getByTaskId(taskId: string): Promise<EstimateRecord[]> {
    const { data, error } = await this.client
      .from('tc_estimates_history')
      .select()
      .eq('task_id', taskId)
      .order('recorded_at', { ascending: false });

    if (error) throw new Error(`Failed to get estimates by task: ${error.message}`);
    return (data as DbEstimateRecord[]).map(d => this.mapToEstimateRecord(d));
  }

  /**
   * Gets the most recent estimate for a task.
   */
  async getLatestByTaskId(taskId: string): Promise<EstimateRecord | null> {
    const { data, error } = await this.client
      .from('tc_estimates_history')
      .select()
      .eq('task_id', taskId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get latest estimate: ${error.message}`);
    }
    return data ? this.mapToEstimateRecord(data as DbEstimateRecord) : null;
  }

  /**
   * Gets estimate history for a project with optional filters.
   */
  async getEstimateHistory(
    projectId: string,
    filter?: EstimateHistoryFilter
  ): Promise<EstimateRecord[]> {
    // First get all task IDs for the project
    const { data: tasks, error: tasksError } = await this.client
      .from('tc_tasks')
      .select('id')
      .eq('project_id', projectId);

    if (tasksError) throw new Error(`Failed to get project tasks: ${tasksError.message}`);
    if (!tasks || tasks.length === 0) return [];

    const taskIds = tasks.map(t => t.id);

    let query = this.client
      .from('tc_estimates_history')
      .select()
      .in('task_id', taskIds)
      .order('recorded_at', { ascending: false });

    if (filter?.startDate) {
      query = query.gte('recorded_at', filter.startDate.toISOString());
    }
    if (filter?.endDate) {
      query = query.lte('recorded_at', filter.endDate.toISOString());
    }
    if (filter?.estimator) {
      query = query.eq('estimator', filter.estimator);
    }

    const { data, error } = await query;

    if (error) throw new Error(`Failed to get estimate history: ${error.message}`);
    return (data as DbEstimateRecord[]).map(d => this.mapToEstimateRecord(d));
  }

  /**
   * Captures the current estimate from a task and stores it as a historical record.
   * Useful for tracking estimate changes over time.
   */
  async captureTaskEstimate(taskId: string, notes?: string): Promise<EstimateRecord> {
    // Get current task data
    const { data: task, error: taskError } = await this.client
      .from('tc_tasks')
      .select('estimated_sessions_opus, estimated_sessions_sonnet, complexity_estimate')
      .eq('id', taskId)
      .single();

    if (taskError) throw new Error(`Failed to get task: ${taskError.message}`);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    return this.recordEstimate({
      taskId,
      estimatedSessionsOpus: task.estimated_sessions_opus ?? 0,
      estimatedSessionsSonnet: task.estimated_sessions_sonnet ?? 0,
      estimator: 'system',
      notes
    });
  }

  /**
   * Deletes an estimate record.
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('tc_estimates_history')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete estimate: ${error.message}`);
  }

  /**
   * Maps database record to EstimateRecord interface.
   */
  private mapToEstimateRecord(data: DbEstimateRecord): EstimateRecord {
    return {
      id: data.id,
      taskId: data.task_id,
      recordedAt: new Date(data.recorded_at),
      estimatedSessionsOpus: data.estimated_sessions_opus,
      estimatedSessionsSonnet: data.estimated_sessions_sonnet,
      estimatedImpactScore: data.estimated_impact_score ?? undefined,
      estimatedInterventionMinutes: data.estimated_intervention_minutes ?? undefined,
      estimator: data.estimator as Estimator,
      notes: data.notes ?? undefined
    };
  }
}
