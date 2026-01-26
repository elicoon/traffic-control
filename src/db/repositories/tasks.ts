import { SupabaseClient } from '@supabase/supabase-js';

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

    if (error) throw new Error(`Failed to create task: ${error.message}`);
    return data as Task;
  }

  async getById(id: string): Promise<Task | null> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get task: ${error.message}`);
    }
    return data as Task | null;
  }

  async getQueued(): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('status', 'queued')
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to get queued tasks: ${error.message}`);
    return data as Task[];
  }

  async getByProject(projectId: string): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('project_id', projectId)
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to get tasks by project: ${error.message}`);
    return data as Task[];
  }

  async getByStatus(status: Task['status']): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('status', status)
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to get tasks by status: ${error.message}`);
    return data as Task[];
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        ...input,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update task: ${error.message}`);
    return data as Task;
  }

  async updateStatus(id: string, status: Task['status']): Promise<Task> {
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

    if (error) throw new Error(`Failed to update task status: ${error.message}`);
    return data as Task;
  }

  async assignAgent(id: string, agentId: string): Promise<Task> {
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

    if (error) throw new Error(`Failed to assign agent: ${error.message}`);
    return data as Task;
  }

  async unassignAgent(id: string): Promise<Task> {
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

    if (error) throw new Error(`Failed to unassign agent: ${error.message}`);
    return data as Task;
  }

  async recordUsage(id: string, usage: RecordUsageInput): Promise<Task> {
    // First get current values to increment
    const current = await this.getById(id);
    if (!current) throw new Error(`Task not found: ${id}`);

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

    if (error) throw new Error(`Failed to record usage: ${error.message}`);
    return data as Task;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('tc_tasks')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete task: ${error.message}`);
  }

  // Task management helper methods

  async getSubtasks(parentTaskId: string): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('parent_task_id', parentTaskId)
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to get subtasks: ${error.message}`);
    return data as Task[];
  }

  async getBySource(source: TaskSource): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('source', source)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get tasks by source: ${error.message}`);
    return data as Task[];
  }

  async getBlockedTasks(): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('status', 'blocked')
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to get blocked tasks: ${error.message}`);
    return data as Task[];
  }

  async getByTag(tag: string): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .contains('tags', [tag])
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to get tasks by tag: ${error.message}`);
    return data as Task[];
  }

  async setBlocker(id: string, blockedByTaskId: string): Promise<Task> {
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

    if (error) throw new Error(`Failed to set blocker: ${error.message}`);
    return data as Task;
  }

  async clearBlocker(id: string): Promise<Task> {
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

    if (error) throw new Error(`Failed to clear blocker: ${error.message}`);
    return data as Task;
  }

  async setEta(id: string, eta: string): Promise<Task> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        eta,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to set ETA: ${error.message}`);
    return data as Task;
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
