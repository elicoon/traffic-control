import { SupabaseClient } from '@supabase/supabase-js';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  priority?: number;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  priority?: number;
}

export class ProjectRepository {
  constructor(private client: SupabaseClient) {}

  async create(input: CreateProjectInput): Promise<Project> {
    const { data, error } = await this.client
      .from('tc_projects')
      .insert({
        name: input.name,
        description: input.description ?? null,
        priority: input.priority ?? 0
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create project: ${error.message}`);
    return data as Project;
  }

  async getById(id: string): Promise<Project | null> {
    const { data, error } = await this.client
      .from('tc_projects')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get project: ${error.message}`);
    }
    return data as Project | null;
  }

  async listActive(): Promise<Project[]> {
    const { data, error } = await this.client
      .from('tc_projects')
      .select()
      .eq('status', 'active')
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to list projects: ${error.message}`);
    return data as Project[];
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const { data, error } = await this.client
      .from('tc_projects')
      .update({
        ...input,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update project: ${error.message}`);
    return data as Project;
  }

  async updateStatus(id: string, status: Project['status']): Promise<Project> {
    const { data, error } = await this.client
      .from('tc_projects')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update project status: ${error.message}`);
    return data as Project;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('tc_projects')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete project: ${error.message}`);
  }
}
