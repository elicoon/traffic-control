import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logging/index.js';

const log = logger.child('Database.TaskRepo');

export type TaskSource = 'user' | 'agent_proposal' | 'decomposition';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: 'queued' | 'assigned' | 'in_progress' | 'review' | 'complete' | 'blocked';
  priority: number;
  complexity_estimate: string | null;
  estimated_sessions_opus: number;
  estimated_sessions_sonnet: number;
  actual_tokens_opus: number;
  actual_tokens_sonnet: number;
  actual_sessions_opus: number;
  actual_sessions_sonnet: number;
  assigned_agent_id: string | null;
  requires_visual_review: boolean;
  // Task management fields
  parent_task_id: string | null;
  tags: string[];
  acceptance_criteria: string | null;
  source: TaskSource;
  blocked_by_task_id: string | null;
  eta: string | null;  // ISO timestamp (PST). Compare with completed_at for delta.
  // Priority confirmation fields
  priority_confirmed: boolean;
  priority_confirmed_at: string | null;
  priority_confirmed_by: string | null;
  // Timestamps
  started_at: string | null;
  completed_at: string | null;  // Actual completion. Delta = completed_at - eta
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  project_id: string;
  title: string;
  description?: string;
  priority?: number;
  complexity_estimate?: string;
  estimated_sessions_opus?: number;
  estimated_sessions_sonnet?: number;
  requires_visual_review?: boolean;
  // Task management fields
  parent_task_id?: string;
  tags?: string[];
  acceptance_criteria?: string;
  source?: TaskSource;
  blocked_by_task_id?: string;
  eta?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: number;
  complexity_estimate?: string;
  estimated_sessions_opus?: number;
  estimated_sessions_sonnet?: number;
  requires_visual_review?: boolean;
  // Task management fields
  parent_task_id?: string | null;
  tags?: string[];
  acceptance_criteria?: string | null;
  blocked_by_task_id?: string | null;
  eta?: string | null;
  // Priority confirmation fields
  priority_confirmed?: boolean;
  priority_confirmed_at?: string | null;
  priority_confirmed_by?: string | null;
}

export interface RecordUsageInput {
  tokens_opus?: number;
  tokens_sonnet?: number;
  sessions_opus?: number;
  sessions_sonnet?: number;
}

export class TaskRepository {
  constructor(private client: SupabaseClient) {}

  async create(input: CreateTaskInput): Promise<Task> {
    log.time('create-task');
    const { data, error } = await this.client
      .from('tc_tasks')
      .insert({
        project_id: input.project_id,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 0,
        complexity_estimate: input.complexity_estimate ?? null,
        estimated_sessions_opus: input.estimated_sessions_opus ?? 0,
        estimated_sessions_sonnet: input.estimated_sessions_sonnet ?? 0,
        requires_visual_review: input.requires_visual_review ?? false,
        // Task management fields
        parent_task_id: input.parent_task_id ?? null,
        tags: input.tags ?? [],
        acceptance_criteria: input.acceptance_criteria ?? null,
        source: input.source ?? 'user',
        blocked_by_task_id: input.blocked_by_task_id ?? null,
        eta: input.eta ?? null
      })
      .select()
      .single();

    log.timeEnd('create-task', { table: 'tc_tasks', operation: 'insert' });

    if (error) {
      log.error('Failed to create task', { operation: 'insert', table: 'tc_tasks', error: error.message });
      throw new Error(`Failed to create task: ${error.message}`);
    }
    log.debug('Task created', { taskId: data.id, title: input.title, projectId: input.project_id });
    return data as Task;
  }

  async getById(id: string): Promise<Task | null> {
    log.time('get-task-by-id');
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('id', id)
      .single();

    log.timeEnd('get-task-by-id', { table: 'tc_tasks', operation: 'select', taskId: id });

    if (error && error.code !== 'PGRST116') {
      log.error('Failed to get task', { operation: 'select', table: 'tc_tasks', taskId: id, error: error.message });
      throw new Error(`Failed to get task: ${error.message}`);
    }
    log.debug('Task fetched', { taskId: id, found: !!data });
    return data as Task | null;
  }

  async getQueued(): Promise<Task[]> {
    log.time('get-queued-tasks');
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('status', 'queued')
      .order('priority', { ascending: false });

    log.timeEnd('get-queued-tasks', { table: 'tc_tasks', operation: 'select', rowCount: data?.length });

    if (error) {
      log.error('Failed to get queued tasks', { operation: 'select', table: 'tc_tasks', error: error.message });
      throw new Error(`Failed to get queued tasks: ${error.message}`);
    }
    log.debug('Queued tasks fetched', { count: data.length });
    return data as Task[];
  }

  async getByProject(projectId: string): Promise<Task[]> {
    log.time('get-tasks-by-project');
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('project_id', projectId)
      .order('priority', { ascending: false });

    log.timeEnd('get-tasks-by-project', { table: 'tc_tasks', operation: 'select', projectId, rowCount: data?.length });

    if (error) {
      log.error('Failed to get tasks by project', { operation: 'select', table: 'tc_tasks', projectId, error: error.message });
      throw new Error(`Failed to get tasks by project: ${error.message}`);
    }
    log.debug('Tasks by project fetched', { projectId, count: data.length });
    return data as Task[];
  }

  async getByStatus(status: Task['status']): Promise<Task[]> {
    log.time('get-tasks-by-status');
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('status', status)
      .order('priority', { ascending: false });

    log.timeEnd('get-tasks-by-status', { table: 'tc_tasks', operation: 'select', status, rowCount: data?.length });

    if (error) {
      log.error('Failed to get tasks by status', { operation: 'select', table: 'tc_tasks', status, error: error.message });
      throw new Error(`Failed to get tasks by status: ${error.message}`);
    }
    log.debug('Tasks by status fetched', { status, count: data.length });
    return data as Task[];
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    log.time('update-task');
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        ...input,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('update-task', { table: 'tc_tasks', operation: 'update', taskId: id });

    if (error) {
      log.error('Failed to update task', { operation: 'update', table: 'tc_tasks', taskId: id, error: error.message });
      throw new Error(`Failed to update task: ${error.message}`);
    }
    log.debug('Task updated', { taskId: id });
    return data as Task;
  }

  async updateStatus(id: string, status: Task['status']): Promise<Task> {
    log.time('update-task-status');
    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'in_progress') {
      updates.started_at = new Date().toISOString();
    }
    if (status === 'complete') {
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('tc_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('update-task-status', { table: 'tc_tasks', operation: 'update', taskId: id, status });

    if (error) {
      log.error('Failed to update task status', { operation: 'update', table: 'tc_tasks', taskId: id, status, error: error.message });
      throw new Error(`Failed to update task status: ${error.message}`);
    }
    log.info('Task status updated', { taskId: id, status });
    return data as Task;
  }

  async assignAgent(id: string, agentId: string): Promise<Task> {
    log.time('assign-agent');
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        assigned_agent_id: agentId,
        status: 'assigned',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('assign-agent', { table: 'tc_tasks', operation: 'update', taskId: id, agentId });

    if (error) {
      log.error('Failed to assign agent', { operation: 'update', table: 'tc_tasks', taskId: id, agentId, error: error.message });
      throw new Error(`Failed to assign agent: ${error.message}`);
    }
    log.info('Agent assigned to task', { taskId: id, agentId });
    return data as Task;
  }

  async unassignAgent(id: string): Promise<Task> {
    log.time('unassign-agent');
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        assigned_agent_id: null,
        status: 'queued',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('unassign-agent', { table: 'tc_tasks', operation: 'update', taskId: id });

    if (error) {
      log.error('Failed to unassign agent', { operation: 'update', table: 'tc_tasks', taskId: id, error: error.message });
      throw new Error(`Failed to unassign agent: ${error.message}`);
    }
    log.info('Agent unassigned from task', { taskId: id });
    return data as Task;
  }

  async recordUsage(id: string, usage: RecordUsageInput): Promise<Task> {
    log.time('record-usage');
    // First get current values to increment
    const current = await this.getById(id);
    if (!current) {
      log.error('Task not found for usage recording', { taskId: id });
      throw new Error(`Task not found: ${id}`);
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (usage.tokens_opus !== undefined) {
      updates.actual_tokens_opus = (current.actual_tokens_opus ?? 0) + usage.tokens_opus;
    }
    if (usage.tokens_sonnet !== undefined) {
      updates.actual_tokens_sonnet = (current.actual_tokens_sonnet ?? 0) + usage.tokens_sonnet;
    }
    if (usage.sessions_opus !== undefined) {
      updates.actual_sessions_opus = (current.actual_sessions_opus ?? 0) + usage.sessions_opus;
    }
    if (usage.sessions_sonnet !== undefined) {
      updates.actual_sessions_sonnet = (current.actual_sessions_sonnet ?? 0) + usage.sessions_sonnet;
    }

    const { data, error } = await this.client
      .from('tc_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('record-usage', { table: 'tc_tasks', operation: 'update', taskId: id });

    if (error) {
      log.error('Failed to record usage', { operation: 'update', table: 'tc_tasks', taskId: id, error: error.message });
      throw new Error(`Failed to record usage: ${error.message}`);
    }
    log.debug('Usage recorded', { taskId: id, usage });
    return data as Task;
  }

  async delete(id: string): Promise<void> {
    log.time('delete-task');
    const { error } = await this.client
      .from('tc_tasks')
      .delete()
      .eq('id', id);

    log.timeEnd('delete-task', { table: 'tc_tasks', operation: 'delete', taskId: id });

    if (error) {
      log.error('Failed to delete task', { operation: 'delete', table: 'tc_tasks', taskId: id, error: error.message });
      throw new Error(`Failed to delete task: ${error.message}`);
    }
    log.debug('Task deleted', { taskId: id });
  }

  // Task management helper methods

  async getSubtasks(parentTaskId: string): Promise<Task[]> {
    log.time('get-subtasks');
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('parent_task_id', parentTaskId)
      .order('priority', { ascending: false });

    log.timeEnd('get-subtasks', { table: 'tc_tasks', operation: 'select', parentTaskId, rowCount: data?.length });

    if (error) {
      log.error('Failed to get subtasks', { operation: 'select', table: 'tc_tasks', parentTaskId, error: error.message });
      throw new Error(`Failed to get subtasks: ${error.message}`);
    }
    log.debug('Subtasks fetched', { parentTaskId, count: data.length });
    return data as Task[];
  }

  async getBySource(source: TaskSource): Promise<Task[]> {
    log.time('get-tasks-by-source');
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('source', source)
      .order('created_at', { ascending: false });

    log.timeEnd('get-tasks-by-source', { table: 'tc_tasks', operation: 'select', source, rowCount: data?.length });

    if (error) {
      log.error('Failed to get tasks by source', { operation: 'select', table: 'tc_tasks', source, error: error.message });
      throw new Error(`Failed to get tasks by source: ${error.message}`);
    }
    log.debug('Tasks by source fetched', { source, count: data.length });
    return data as Task[];
  }

  async getBlockedTasks(): Promise<Task[]> {
    log.time('get-blocked-tasks');
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('status', 'blocked')
      .order('priority', { ascending: false });

    log.timeEnd('get-blocked-tasks', { table: 'tc_tasks', operation: 'select', rowCount: data?.length });

    if (error) {
      log.error('Failed to get blocked tasks', { operation: 'select', table: 'tc_tasks', error: error.message });
      throw new Error(`Failed to get blocked tasks: ${error.message}`);
    }
    log.debug('Blocked tasks fetched', { count: data.length });
    return data as Task[];
  }

  async getByTag(tag: string): Promise<Task[]> {
    log.time('get-tasks-by-tag');
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .contains('tags', [tag])
      .order('priority', { ascending: false });

    log.timeEnd('get-tasks-by-tag', { table: 'tc_tasks', operation: 'select', tag, rowCount: data?.length });

    if (error) {
      log.error('Failed to get tasks by tag', { operation: 'select', table: 'tc_tasks', tag, error: error.message });
      throw new Error(`Failed to get tasks by tag: ${error.message}`);
    }
    log.debug('Tasks by tag fetched', { tag, count: data.length });
    return data as Task[];
  }

  async setBlocker(id: string, blockedByTaskId: string): Promise<Task> {
    log.time('set-blocker');
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        status: 'blocked',
        blocked_by_task_id: blockedByTaskId,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('set-blocker', { table: 'tc_tasks', operation: 'update', taskId: id, blockedByTaskId });

    if (error) {
      log.error('Failed to set blocker', { operation: 'update', table: 'tc_tasks', taskId: id, blockedByTaskId, error: error.message });
      throw new Error(`Failed to set blocker: ${error.message}`);
    }
    log.info('Task blocker set', { taskId: id, blockedByTaskId });
    return data as Task;
  }

  async clearBlocker(id: string): Promise<Task> {
    log.time('clear-blocker');
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        status: 'queued',
        blocked_by_task_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('clear-blocker', { table: 'tc_tasks', operation: 'update', taskId: id });

    if (error) {
      log.error('Failed to clear blocker', { operation: 'update', table: 'tc_tasks', taskId: id, error: error.message });
      throw new Error(`Failed to clear blocker: ${error.message}`);
    }
    log.info('Task blocker cleared', { taskId: id });
    return data as Task;
  }

  async setEta(id: string, eta: string): Promise<Task> {
    log.time('set-eta');
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        eta,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('set-eta', { table: 'tc_tasks', operation: 'update', taskId: id, eta });

    if (error) {
      log.error('Failed to set ETA', { operation: 'update', table: 'tc_tasks', taskId: id, error: error.message });
      throw new Error(`Failed to set ETA: ${error.message}`);
    }
    log.debug('Task ETA set', { taskId: id, eta });
    return data as Task;
  }

  /**
   * Confirm a task's priority placement.
   * @param id - The task ID
   * @param confirmedBy - User ID or Slack handle of person confirming
   */
  async confirmPriority(id: string, confirmedBy: string): Promise<Task> {
    log.time('confirm-priority');
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        priority_confirmed: true,
        priority_confirmed_at: new Date().toISOString(),
        priority_confirmed_by: confirmedBy,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('confirm-priority', { table: 'tc_tasks', operation: 'update', taskId: id, confirmedBy });

    if (error) {
      log.error('Failed to confirm priority', { operation: 'update', table: 'tc_tasks', taskId: id, error: error.message });
      throw new Error(`Failed to confirm priority: ${error.message}`);
    }
    log.info('Task priority confirmed', { taskId: id, confirmedBy });
    return data as Task;
  }

  /**
   * Get queued tasks that have not had their priority confirmed.
   */
  async getUnconfirmedPriorityTasks(): Promise<Task[]> {
    log.time('get-unconfirmed-priority-tasks');
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('status', 'queued')
      .eq('priority_confirmed', false)
      .order('priority', { ascending: false });

    log.timeEnd('get-unconfirmed-priority-tasks', { table: 'tc_tasks', operation: 'select', rowCount: data?.length });

    if (error) {
      log.error('Failed to get unconfirmed priority tasks', { operation: 'select', table: 'tc_tasks', error: error.message });
      throw new Error(`Failed to get unconfirmed priority tasks: ${error.message}`);
    }
    log.debug('Unconfirmed priority tasks fetched', { count: data.length });
    return data as Task[];
  }

  /**
   * Calculate ETA accuracy for completed tasks.
   * Returns delta in milliseconds (positive = late, negative = early)
   */
  getEtaDelta(task: Task): number | null {
    if (!task.eta || !task.completed_at) return null;
    return new Date(task.completed_at).getTime() - new Date(task.eta).getTime();
  }
}
