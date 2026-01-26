import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProjectRepository } from './projects.js';
import { createSupabaseClient } from '../client.js';

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
