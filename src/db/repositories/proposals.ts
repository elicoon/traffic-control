import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logging/index.js';

const log = logger.child('Database.ProposalRepo');

export interface Proposal {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  impact_score: 'high' | 'medium' | 'low' | null;
  estimated_sessions_opus: number;
  estimated_sessions_sonnet: number;
  reasoning: string | null;
  status: 'proposed' | 'approved' | 'rejected';
  rejection_reason: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface CreateProposalInput {
  project_id: string;
  title: string;
  description?: string;
  impact_score?: 'high' | 'medium' | 'low';
  estimated_sessions_opus?: number;
  estimated_sessions_sonnet?: number;
  reasoning?: string;
}

export class ProposalRepository {
  constructor(private client: SupabaseClient) {}

  async create(input: CreateProposalInput): Promise<Proposal> {
    log.time('create-proposal');
    const { data, error } = await this.client
      .from('tc_proposals')
      .insert({
        project_id: input.project_id,
        title: input.title,
        description: input.description ?? null,
        impact_score: input.impact_score ?? null,
        estimated_sessions_opus: input.estimated_sessions_opus ?? 0,
        estimated_sessions_sonnet: input.estimated_sessions_sonnet ?? 0,
        reasoning: input.reasoning ?? null
      })
      .select()
      .single();

    log.timeEnd('create-proposal', { table: 'tc_proposals', operation: 'insert' });

    if (error) {
      log.error('Failed to create proposal', { operation: 'insert', table: 'tc_proposals', error: error.message });
      throw new Error(`Failed to create proposal: ${error.message}`);
    }
    log.debug('Proposal created', { proposalId: data.id, title: input.title });
    return data as Proposal;
  }

  async getById(id: string): Promise<Proposal | null> {
    log.time('get-proposal-by-id');
    const { data, error } = await this.client
      .from('tc_proposals')
      .select()
      .eq('id', id)
      .single();

    log.timeEnd('get-proposal-by-id', { table: 'tc_proposals', operation: 'select', proposalId: id });

    if (error && error.code !== 'PGRST116') {
      log.error('Failed to get proposal', { operation: 'select', table: 'tc_proposals', proposalId: id, error: error.message });
      throw new Error(`Failed to get proposal: ${error.message}`);
    }
    log.debug('Proposal fetched', { proposalId: id, found: !!data });
    return data as Proposal | null;
  }

  async getPending(): Promise<Proposal[]> {
    log.time('get-pending-proposals');
    const { data, error } = await this.client
      .from('tc_proposals')
      .select()
      .eq('status', 'proposed')
      .order('created_at', { ascending: true });

    log.timeEnd('get-pending-proposals', { table: 'tc_proposals', operation: 'select', rowCount: data?.length });

    if (error) {
      log.error('Failed to get pending proposals', { operation: 'select', table: 'tc_proposals', error: error.message });
      throw new Error(`Failed to get pending proposals: ${error.message}`);
    }
    log.debug('Pending proposals fetched', { count: data.length });
    return data as Proposal[];
  }

  async getByProject(projectId: string): Promise<Proposal[]> {
    log.time('get-proposals-by-project');
    const { data, error } = await this.client
      .from('tc_proposals')
      .select()
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    log.timeEnd('get-proposals-by-project', { table: 'tc_proposals', operation: 'select', projectId, rowCount: data?.length });

    if (error) {
      log.error('Failed to get proposals by project', { operation: 'select', table: 'tc_proposals', projectId, error: error.message });
      throw new Error(`Failed to get proposals by project: ${error.message}`);
    }
    log.debug('Proposals by project fetched', { projectId, count: data.length });
    return data as Proposal[];
  }

  async getByStatus(status: Proposal['status']): Promise<Proposal[]> {
    log.time('get-proposals-by-status');
    const { data, error } = await this.client
      .from('tc_proposals')
      .select()
      .eq('status', status)
      .order('created_at', { ascending: false });

    log.timeEnd('get-proposals-by-status', { table: 'tc_proposals', operation: 'select', status, rowCount: data?.length });

    if (error) {
      log.error('Failed to get proposals by status', { operation: 'select', table: 'tc_proposals', status, error: error.message });
      throw new Error(`Failed to get proposals by status: ${error.message}`);
    }
    log.debug('Proposals by status fetched', { status, count: data.length });
    return data as Proposal[];
  }

  async approve(id: string): Promise<Proposal> {
    log.time('approve-proposal');
    const { data, error } = await this.client
      .from('tc_proposals')
      .update({
        status: 'approved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('approve-proposal', { table: 'tc_proposals', operation: 'update', proposalId: id });

    if (error) {
      log.error('Failed to approve proposal', { operation: 'update', table: 'tc_proposals', proposalId: id, error: error.message });
      throw new Error(`Failed to approve proposal: ${error.message}`);
    }
    log.info('Proposal approved', { proposalId: id });
    return data as Proposal;
  }

  async reject(id: string, reason: string): Promise<Proposal> {
    log.time('reject-proposal');
    const { data, error } = await this.client
      .from('tc_proposals')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        resolved_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('reject-proposal', { table: 'tc_proposals', operation: 'update', proposalId: id });

    if (error) {
      log.error('Failed to reject proposal', { operation: 'update', table: 'tc_proposals', proposalId: id, error: error.message });
      throw new Error(`Failed to reject proposal: ${error.message}`);
    }
    log.info('Proposal rejected', { proposalId: id, reason });
    return data as Proposal;
  }

  async delete(id: string): Promise<void> {
    log.time('delete-proposal');
    const { error } = await this.client
      .from('tc_proposals')
      .delete()
      .eq('id', id);

    log.timeEnd('delete-proposal', { table: 'tc_proposals', operation: 'delete', proposalId: id });

    if (error) {
      log.error('Failed to delete proposal', { operation: 'delete', table: 'tc_proposals', proposalId: id, error: error.message });
      throw new Error(`Failed to delete proposal: ${error.message}`);
    }
    log.debug('Proposal deleted', { proposalId: id });
  }
}
