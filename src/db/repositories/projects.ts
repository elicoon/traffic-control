import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logging/index.js';

const log = logger.child('Database.ProjectRepo');

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
    log.time('create-project');
    const { data, error } = await this.client
      .from('tc_projects')
      .insert({
        name: input.name,
        description: input.description ?? null,
        priority: input.priority ?? 0
      })
      .select()
      .single();

    log.timeEnd('create-project', { table: 'tc_projects', operation: 'insert' });

    if (error) {
      log.error('Failed to create project', { operation: 'insert', table: 'tc_projects', error: error.message });
      throw new Error(`Failed to create project: ${error.message}`);
    }
    log.debug('Project created', { projectId: data.id, name: input.name });
    return data as Project;
  }

  async getById(id: string): Promise<Project | null> {
    log.time('get-project-by-id');
    const { data, error } = await this.client
      .from('tc_projects')
      .select()
      .eq('id', id)
      .single();

    log.timeEnd('get-project-by-id', { table: 'tc_projects', operation: 'select', projectId: id });

    if (error && error.code !== 'PGRST116') {
      log.error('Failed to get project', { operation: 'select', table: 'tc_projects', projectId: id, error: error.message });
      throw new Error(`Failed to get project: ${error.message}`);
    }
    log.debug('Project fetched', { projectId: id, found: !!data });
    return data as Project | null;
  }

  async listActive(): Promise<Project[]> {
    log.time('list-active-projects');
    const { data, error } = await this.client
      .from('tc_projects')
      .select()
      .eq('status', 'active')
      .order('priority', { ascending: false });

    log.timeEnd('list-active-projects', { table: 'tc_projects', operation: 'select', rowCount: data?.length });

    if (error) {
      log.error('Failed to list active projects', { operation: 'select', table: 'tc_projects', error: error.message });
      throw new Error(`Failed to list projects: ${error.message}`);
    }
    log.debug('Active projects listed', { count: data.length });
    return data as Project[];
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    log.time('update-project');
    const { data, error } = await this.client
      .from('tc_projects')
      .update({
        ...input,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('update-project', { table: 'tc_projects', operation: 'update', projectId: id });

    if (error) {
      log.error('Failed to update project', { operation: 'update', table: 'tc_projects', projectId: id, error: error.message });
      throw new Error(`Failed to update project: ${error.message}`);
    }
    log.debug('Project updated', { projectId: id });
    return data as Project;
  }

  async updateStatus(id: string, status: Project['status']): Promise<Project> {
    log.time('update-project-status');
    const { data, error } = await this.client
      .from('tc_projects')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('update-project-status', { table: 'tc_projects', operation: 'update', projectId: id, status });

    if (error) {
      log.error('Failed to update project status', { operation: 'update', table: 'tc_projects', projectId: id, status, error: error.message });
      throw new Error(`Failed to update project status: ${error.message}`);
    }
    log.debug('Project status updated', { projectId: id, status });
    return data as Project;
  }

  async delete(id: string): Promise<void> {
    log.time('delete-project');
    const { error } = await this.client
      .from('tc_projects')
      .delete()
      .eq('id', id);

    log.timeEnd('delete-project', { table: 'tc_projects', operation: 'delete', projectId: id });

    if (error) {
      log.error('Failed to delete project', { operation: 'delete', table: 'tc_projects', projectId: id, error: error.message });
      throw new Error(`Failed to delete project: ${error.message}`);
    }
    log.debug('Project deleted', { projectId: id });
  }
}
