import { SupabaseClient } from '@supabase/supabase-js';

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

    if (error) throw new Error(`Failed to create proposal: ${error.message}`);
    return data as Proposal;
  }

  async getById(id: string): Promise<Proposal | null> {
    const { data, error } = await this.client
      .from('tc_proposals')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get proposal: ${error.message}`);
    }
    return data as Proposal | null;
  }

  async getPending(): Promise<Proposal[]> {
    const { data, error } = await this.client
      .from('tc_proposals')
      .select()
      .eq('status', 'proposed')
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Failed to get pending proposals: ${error.message}`);
    return data as Proposal[];
  }

  async getByProject(projectId: string): Promise<Proposal[]> {
    const { data, error } = await this.client
      .from('tc_proposals')
      .select()
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get proposals by project: ${error.message}`);
    return data as Proposal[];
  }

  async getByStatus(status: Proposal['status']): Promise<Proposal[]> {
    const { data, error } = await this.client
      .from('tc_proposals')
      .select()
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get proposals by status: ${error.message}`);
    return data as Proposal[];
  }

  async approve(id: string): Promise<Proposal> {
    const { data, error } = await this.client
      .from('tc_proposals')
      .update({
        status: 'approved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to approve proposal: ${error.message}`);
    return data as Proposal;
  }

  async reject(id: string, reason: string): Promise<Proposal> {
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

    if (error) throw new Error(`Failed to reject proposal: ${error.message}`);
    return data as Proposal;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('tc_proposals')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete proposal: ${error.message}`);
  }
}
