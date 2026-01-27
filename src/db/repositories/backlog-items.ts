import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logging/index.js';

const log = logger.child('Database.BacklogItemRepo');

export type BacklogItemType =
  | 'feature'
  | 'enhancement'
  | 'architecture'
  | 'infrastructure'
  | 'documentation'
  | 'security'
  | 'testing'
  | 'maintenance'
  | 'research';

export type BacklogItemPriority = 'high' | 'medium' | 'low';

export type BacklogItemStatus =
  | 'proposed'
  | 'in_review'
  | 'accepted'
  | 'rejected'
  | 'in_progress'
  | 'implemented'
  | 'archived';

export type BacklogItemComplexity = 'small' | 'medium' | 'large' | 'x-large';

export type BacklogItemSource = 'user' | 'agent' | 'imported';

export interface BacklogItem {
  id: string;
  project_id: string | null;
  title: string;
  description: string;
  type: BacklogItemType;
  priority: BacklogItemPriority;
  impact_score: 'high' | 'medium' | 'low' | null;
  complexity_estimate: BacklogItemComplexity | null;
  estimated_sessions_opus: number;
  estimated_sessions_sonnet: number;
  status: BacklogItemStatus;
  reasoning: string | null;
  acceptance_criteria: string | null;
  tags: string[];
  related_items: string[];
  proposal_ids: string[];
  task_ids: string[];
  source: BacklogItemSource;
  source_file: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  implemented_at: string | null;
}

export interface CreateBacklogItemInput {
  project_id?: string;
  title: string;
  description: string;
  type: BacklogItemType;
  priority?: BacklogItemPriority;
  impact_score?: 'high' | 'medium' | 'low';
  complexity_estimate?: BacklogItemComplexity;
  estimated_sessions_opus?: number;
  estimated_sessions_sonnet?: number;
  reasoning?: string;
  acceptance_criteria?: string;
  tags?: string[];
  related_items?: string[];
  source?: BacklogItemSource;
  source_file?: string;
}

export interface UpdateBacklogItemInput {
  title?: string;
  description?: string;
  type?: BacklogItemType;
  priority?: BacklogItemPriority;
  impact_score?: 'high' | 'medium' | 'low' | null;
  complexity_estimate?: BacklogItemComplexity | null;
  estimated_sessions_opus?: number;
  estimated_sessions_sonnet?: number;
  status?: BacklogItemStatus;
  reasoning?: string | null;
  acceptance_criteria?: string | null;
  tags?: string[];
  related_items?: string[];
  reviewed_at?: string | null;
  implemented_at?: string | null;
}

export interface BacklogItemFilter {
  project_id?: string;
  status?: BacklogItemStatus;
  priority?: BacklogItemPriority;
  type?: BacklogItemType;
  tags?: string[];
}

export class BacklogItemRepository {
  constructor(private client: SupabaseClient) {}

  async create(input: CreateBacklogItemInput): Promise<BacklogItem> {
    log.time('create-backlog-item');
    const { data, error } = await this.client
      .from('tc_backlog_items')
      .insert({
        project_id: input.project_id ?? null,
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority ?? 'medium',
        impact_score: input.impact_score ?? null,
        complexity_estimate: input.complexity_estimate ?? null,
        estimated_sessions_opus: input.estimated_sessions_opus ?? 0,
        estimated_sessions_sonnet: input.estimated_sessions_sonnet ?? 0,
        reasoning: input.reasoning ?? null,
        acceptance_criteria: input.acceptance_criteria ?? null,
        tags: input.tags ?? [],
        related_items: input.related_items ?? [],
        source: input.source ?? 'user',
        source_file: input.source_file ?? null
      })
      .select()
      .single();

    log.timeEnd('create-backlog-item', { table: 'tc_backlog_items', operation: 'insert' });

    if (error) {
      log.error('Failed to create backlog item', { operation: 'insert', table: 'tc_backlog_items', error: error.message });
      throw new Error(`Failed to create backlog item: ${error.message}`);
    }
    log.debug('Backlog item created', { itemId: data.id, title: input.title });
    return data as BacklogItem;
  }

  async getById(id: string): Promise<BacklogItem | null> {
    log.time('get-backlog-item-by-id');
    const { data, error } = await this.client
      .from('tc_backlog_items')
      .select()
      .eq('id', id)
      .single();

    log.timeEnd('get-backlog-item-by-id', { table: 'tc_backlog_items', operation: 'select', itemId: id });

    if (error && error.code !== 'PGRST116') {
      log.error('Failed to get backlog item', { operation: 'select', table: 'tc_backlog_items', itemId: id, error: error.message });
      throw new Error(`Failed to get backlog item: ${error.message}`);
    }
    log.debug('Backlog item fetched', { itemId: id, found: !!data });
    return data as BacklogItem | null;
  }

  async list(filter?: BacklogItemFilter): Promise<BacklogItem[]> {
    log.time('list-backlog-items');
    let query = this.client.from('tc_backlog_items').select();

    if (filter?.project_id) {
      query = query.eq('project_id', filter.project_id);
    }
    if (filter?.status) {
      query = query.eq('status', filter.status);
    }
    if (filter?.priority) {
      query = query.eq('priority', filter.priority);
    }
    if (filter?.type) {
      query = query.eq('type', filter.type);
    }
    if (filter?.tags && filter.tags.length > 0) {
      // Match any of the provided tags
      for (const tag of filter.tags) {
        query = query.contains('tags', [tag]);
      }
    }

    const { data, error } = await query.order('priority', { ascending: false }).order('created_at', { ascending: false });

    log.timeEnd('list-backlog-items', { table: 'tc_backlog_items', operation: 'select', rowCount: data?.length });

    if (error) {
      log.error('Failed to list backlog items', { operation: 'select', table: 'tc_backlog_items', error: error.message });
      throw new Error(`Failed to list backlog items: ${error.message}`);
    }
    log.debug('Backlog items listed', { count: data.length, filter });
    return data as BacklogItem[];
  }

  async update(id: string, input: UpdateBacklogItemInput): Promise<BacklogItem> {
    log.time('update-backlog-item');
    const { data, error } = await this.client
      .from('tc_backlog_items')
      .update({
        ...input,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('update-backlog-item', { table: 'tc_backlog_items', operation: 'update', itemId: id });

    if (error) {
      log.error('Failed to update backlog item', { operation: 'update', table: 'tc_backlog_items', itemId: id, error: error.message });
      throw new Error(`Failed to update backlog item: ${error.message}`);
    }
    log.debug('Backlog item updated', { itemId: id });
    return data as BacklogItem;
  }

  async updateStatus(id: string, status: BacklogItemStatus): Promise<BacklogItem> {
    log.time('update-backlog-item-status');
    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'in_review') {
      updates.reviewed_at = new Date().toISOString();
    }
    if (status === 'implemented') {
      updates.implemented_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('tc_backlog_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('update-backlog-item-status', { table: 'tc_backlog_items', operation: 'update', itemId: id, status });

    if (error) {
      log.error('Failed to update backlog item status', { operation: 'update', table: 'tc_backlog_items', itemId: id, status, error: error.message });
      throw new Error(`Failed to update backlog item status: ${error.message}`);
    }
    log.info('Backlog item status updated', { itemId: id, status });
    return data as BacklogItem;
  }

  async delete(id: string): Promise<void> {
    log.time('delete-backlog-item');
    const { error } = await this.client
      .from('tc_backlog_items')
      .delete()
      .eq('id', id);

    log.timeEnd('delete-backlog-item', { table: 'tc_backlog_items', operation: 'delete', itemId: id });

    if (error) {
      log.error('Failed to delete backlog item', { operation: 'delete', table: 'tc_backlog_items', itemId: id, error: error.message });
      throw new Error(`Failed to delete backlog item: ${error.message}`);
    }
    log.debug('Backlog item deleted', { itemId: id });
  }

  async linkProposal(itemId: string, proposalId: string): Promise<BacklogItem> {
    log.time('link-proposal');
    const item = await this.getById(itemId);
    if (!item) {
      throw new Error(`Backlog item not found: ${itemId}`);
    }

    const proposalIds = [...item.proposal_ids, proposalId];
    const updated = await this.update(itemId, { proposal_ids: proposalIds } as UpdateBacklogItemInput);

    log.timeEnd('link-proposal', { itemId, proposalId });
    log.debug('Proposal linked to backlog item', { itemId, proposalId });
    return updated;
  }

  async linkTask(itemId: string, taskId: string): Promise<BacklogItem> {
    log.time('link-task');
    const item = await this.getById(itemId);
    if (!item) {
      throw new Error(`Backlog item not found: ${itemId}`);
    }

    const taskIds = [...item.task_ids, taskId];
    const updated = await this.update(itemId, { task_ids: taskIds } as UpdateBacklogItemInput);

    log.timeEnd('link-task', { itemId, taskId });
    log.debug('Task linked to backlog item', { itemId, taskId });
    return updated;
  }

  async getBySourceFile(sourceFile: string): Promise<BacklogItem | null> {
    log.time('get-backlog-item-by-source-file');
    const { data, error } = await this.client
      .from('tc_backlog_items')
      .select()
      .eq('source_file', sourceFile)
      .single();

    log.timeEnd('get-backlog-item-by-source-file', { table: 'tc_backlog_items', operation: 'select', sourceFile });

    if (error && error.code !== 'PGRST116') {
      log.error('Failed to get backlog item by source file', { operation: 'select', table: 'tc_backlog_items', sourceFile, error: error.message });
      throw new Error(`Failed to get backlog item by source file: ${error.message}`);
    }
    log.debug('Backlog item fetched by source file', { sourceFile, found: !!data });
    return data as BacklogItem | null;
  }

  async getByStatus(status: BacklogItemStatus): Promise<BacklogItem[]> {
    return this.list({ status });
  }

  async getByPriority(priority: BacklogItemPriority): Promise<BacklogItem[]> {
    return this.list({ priority });
  }

  async getByType(type: BacklogItemType): Promise<BacklogItem[]> {
    return this.list({ type });
  }

  async getByProject(projectId: string): Promise<BacklogItem[]> {
    return this.list({ project_id: projectId });
  }

  async getByTag(tag: string): Promise<BacklogItem[]> {
    return this.list({ tags: [tag] });
  }
}
