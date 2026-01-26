import { SupabaseClient } from '@supabase/supabase-js';
import type {
  Retrospective,
  RetrospectiveRow,
  CreateRetrospectiveInput,
  UpdateRetrospectiveInput,
  RetrospectiveTriggerType,
  Learning
} from './types.js';

/**
 * Repository for managing retrospectives in the database.
 * Handles CRUD operations and queries for the tc_retrospectives table.
 */
export class RetrospectiveRepository {
  constructor(private client: SupabaseClient) {}

  /**
   * Converts a database row to a Retrospective domain object
   */
  private rowToRetrospective(row: RetrospectiveRow): Retrospective {
    const learning: Learning | null =
      row.learning_category && row.learning_pattern && row.learning_rule
        ? {
            category: row.learning_category,
            pattern: row.learning_pattern,
            rule: row.learning_rule
          }
        : null;

    return {
      id: row.id,
      taskId: row.task_id,
      sessionId: row.session_id,
      projectId: row.project_id,
      title: row.title,
      triggerType: row.trigger_type,
      whatHappened: row.what_happened,
      rootCause: row.root_cause,
      correctApproach: row.correct_approach,
      learning,
      createdAt: new Date(row.created_at),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null
    };
  }

  /**
   * Creates a new retrospective
   */
  async create(input: CreateRetrospectiveInput): Promise<Retrospective> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .insert({
        task_id: input.taskId ?? null,
        session_id: input.sessionId ?? null,
        project_id: input.projectId,
        title: input.title,
        trigger_type: input.triggerType,
        what_happened: input.whatHappened,
        root_cause: input.rootCause ?? null,
        correct_approach: input.correctApproach ?? null,
        learning_category: input.learning?.category ?? null,
        learning_pattern: input.learning?.pattern ?? null,
        learning_rule: input.learning?.rule ?? null
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create retrospective: ${error.message}`);
    return this.rowToRetrospective(data as RetrospectiveRow);
  }

  /**
   * Gets a retrospective by ID
   */
  async getById(id: string): Promise<Retrospective | null> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get retrospective: ${error.message}`);
    }

    if (!data) return null;
    return this.rowToRetrospective(data as RetrospectiveRow);
  }

  /**
   * Gets all retrospectives for a task
   */
  async getByTask(taskId: string): Promise<Retrospective[]> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .select()
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get retrospectives by task: ${error.message}`);
    return (data as RetrospectiveRow[]).map(row => this.rowToRetrospective(row));
  }

  /**
   * Gets all retrospectives for a project
   */
  async getByProject(projectId: string): Promise<Retrospective[]> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .select()
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get retrospectives by project: ${error.message}`);
    return (data as RetrospectiveRow[]).map(row => this.rowToRetrospective(row));
  }

  /**
   * Gets all retrospectives by trigger type
   */
  async getByTriggerType(triggerType: RetrospectiveTriggerType): Promise<Retrospective[]> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .select()
      .eq('trigger_type', triggerType)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get retrospectives by trigger type: ${error.message}`);
    return (data as RetrospectiveRow[]).map(row => this.rowToRetrospective(row));
  }

  /**
   * Gets all unresolved retrospectives
   */
  async getUnresolved(): Promise<Retrospective[]> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .select()
      .is('resolved_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get unresolved retrospectives: ${error.message}`);
    return (data as RetrospectiveRow[]).map(row => this.rowToRetrospective(row));
  }

  /**
   * Updates a retrospective
   */
  async update(id: string, input: UpdateRetrospectiveInput): Promise<Retrospective> {
    const updates: Record<string, unknown> = {};

    if (input.title !== undefined) updates.title = input.title;
    if (input.whatHappened !== undefined) updates.what_happened = input.whatHappened;
    if (input.rootCause !== undefined) updates.root_cause = input.rootCause;
    if (input.correctApproach !== undefined) updates.correct_approach = input.correctApproach;
    if (input.resolvedAt !== undefined) updates.resolved_at = input.resolvedAt.toISOString();

    if (input.learning !== undefined) {
      updates.learning_category = input.learning.category;
      updates.learning_pattern = input.learning.pattern;
      updates.learning_rule = input.learning.rule;
    }

    const { data, error } = await this.client
      .from('tc_retrospectives')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update retrospective: ${error.message}`);
    return this.rowToRetrospective(data as RetrospectiveRow);
  }

  /**
   * Marks a retrospective as resolved
   */
  async resolve(id: string): Promise<Retrospective> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to resolve retrospective: ${error.message}`);
    return this.rowToRetrospective(data as RetrospectiveRow);
  }

  /**
   * Deletes a retrospective
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('tc_retrospectives')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete retrospective: ${error.message}`);
  }

  /**
   * Gets recent retrospectives that have learnings, ordered by creation date
   */
  async getRecentLearnings(limit: number = 10): Promise<Retrospective[]> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .select()
      .not('learning_category', 'is', null)
      .not('learning_pattern', 'is', null)
      .not('learning_rule', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to get recent learnings: ${error.message}`);
    return (data as RetrospectiveRow[]).map(row => this.rowToRetrospective(row));
  }

  /**
   * Gets all retrospectives with learnings in a specific category
   */
  async getLearningsByCategory(category: string): Promise<Retrospective[]> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .select()
      .eq('learning_category', category)
      .not('learning_pattern', 'is', null)
      .not('learning_rule', 'is', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get learnings by category: ${error.message}`);
    return (data as RetrospectiveRow[]).map(row => this.rowToRetrospective(row));
  }

  /**
   * Gets retrospectives for a session
   */
  async getBySession(sessionId: string): Promise<Retrospective[]> {
    const { data, error } = await this.client
      .from('tc_retrospectives')
      .select()
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get retrospectives by session: ${error.message}`);
    return (data as RetrospectiveRow[]).map(row => this.rowToRetrospective(row));
  }
}
