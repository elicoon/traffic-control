import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ProjectRepository } from './projects.js';
import { createSupabaseClient } from '../client.js';
import { SupabaseClient } from '@supabase/supabase-js';

describe('ProjectRepository', () => {
  let repo: ProjectRepository;
  let testProjectId: string;

  beforeAll(() => {
    repo = new ProjectRepository(createSupabaseClient());
  });

  afterAll(async () => {
    if (testProjectId) {
      await repo.delete(testProjectId);
    }
  });

  it('should create a project', async () => {
    const project = await repo.create({
      name: 'Test Project',
      description: 'A test project',
      priority: 1
    });

    testProjectId = project.id;
    expect(project.name).toBe('Test Project');
    expect(project.status).toBe('active');
  });

  it('should get a project by id', async () => {
    const project = await repo.getById(testProjectId);
    expect(project).toBeDefined();
    expect(project?.name).toBe('Test Project');
  });

  it('should list active projects', async () => {
    const projects = await repo.listActive();
    expect(projects.length).toBeGreaterThan(0);
  });

  it('should update a project', async () => {
    const updated = await repo.update(testProjectId, {
      name: 'Updated Project Name',
      priority: 5
    });
    expect(updated.name).toBe('Updated Project Name');
    expect(updated.priority).toBe(5);
  });

  it('should update project status', async () => {
    const updated = await repo.updateStatus(testProjectId, 'paused');
    expect(updated.status).toBe('paused');

    // Reset to active so listActive test works
    await repo.updateStatus(testProjectId, 'active');
  });
});

describe('ProjectRepository unit error paths', () => {
  function createChain(result: { data: unknown; error: { message: string } | null }): any {
    const obj: any = {
      select: () => createChain(result),
      insert: () => createChain(result),
      delete: () => createChain(result),
      update: () => createChain(result),
      eq: () => createChain(result),
      order: () => createChain(result),
      single: () => Promise.resolve(result),
      then: (resolve: (v: unknown) => void, reject: (v: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return obj;
  }

  function createErrorClient(errorMessage: string) {
    const result = { data: null, error: { message: errorMessage } };
    return { from: () => createChain(result) } as unknown as SupabaseClient;
  }

  it('should throw when create returns an error (lines 46-47)', async () => {
    const repo = new ProjectRepository(createErrorClient('insert failed'));
    await expect(repo.create({ name: 'Test' })).rejects.toThrow(
      'Failed to create project: insert failed'
    );
  });

  it('should throw when getById returns a non-PGRST116 error (lines 64-65)', async () => {
    const repo = new ProjectRepository(createErrorClient('query failed'));
    await expect(repo.getById('proj-1')).rejects.toThrow(
      'Failed to get project: query failed'
    );
  });

  it('should throw when listActive returns an error (lines 82-83)', async () => {
    const repo = new ProjectRepository(createErrorClient('list failed'));
    await expect(repo.listActive()).rejects.toThrow(
      'Failed to list projects: list failed'
    );
  });

  it('should throw when update returns an error (lines 104-105)', async () => {
    const repo = new ProjectRepository(createErrorClient('update failed'));
    await expect(repo.update('proj-1', { name: 'New Name' })).rejects.toThrow(
      'Failed to update project: update failed'
    );
  });

  it('should throw when updateStatus returns an error (lines 126-127)', async () => {
    const repo = new ProjectRepository(createErrorClient('status failed'));
    await expect(repo.updateStatus('proj-1', 'paused')).rejects.toThrow(
      'Failed to update project status: status failed'
    );
  });

  it('should throw when delete returns an error (lines 143-144)', async () => {
    const repo = new ProjectRepository(createErrorClient('delete failed'));
    await expect(repo.delete('proj-1')).rejects.toThrow(
      'Failed to delete project: delete failed'
    );
  });
});
