import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TaskRepository } from './tasks.js';
import { ProjectRepository } from './projects.js';
import { createSupabaseClient } from '../client.js';
import { TEST_PREFIX, deleteTasksByIds } from '../test-cleanup.js';

describe('TaskRepository', () => {
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let testProjectId: string;
  let testTaskId: string;
  const createdTaskIds: string[] = [];

  beforeAll(async () => {
    const client = createSupabaseClient();
    taskRepo = new TaskRepository(client);
    projectRepo = new ProjectRepository(client);

    // Use TEST_PREFIX for easy identification during cleanup
    const project = await projectRepo.create({ name: `${TEST_PREFIX}TaskRepository_Project` });
    testProjectId = project.id;
  });

  afterAll(async () => {
    // Clean up all created tasks
    if (createdTaskIds.length > 0) {
      await deleteTasksByIds(createdTaskIds);
    }
    // Clean up test project
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  it('should create a task', async () => {
    const task = await taskRepo.create({
      project_id: testProjectId,
      title: `${TEST_PREFIX}TaskRepo_CreateTask`,
      description: 'A test task',
      priority: 1,
      estimated_sessions_opus: 1
    });

    testTaskId = task.id;
    createdTaskIds.push(task.id);
    expect(task.title).toBe(`${TEST_PREFIX}TaskRepo_CreateTask`);
    expect(task.status).toBe('queued');
    expect(task.project_id).toBe(testProjectId);
  });

  it('should get a task by id', async () => {
    const task = await taskRepo.getById(testTaskId);
    expect(task).toBeDefined();
    expect(task?.title).toBe(`${TEST_PREFIX}TaskRepo_CreateTask`);
  });

  it('should get queued tasks', async () => {
    const tasks = await taskRepo.getQueued();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some(t => t.id === testTaskId)).toBe(true);
  });

  it('should get tasks by project', async () => {
    const tasks = await taskRepo.getByProject(testProjectId);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].project_id).toBe(testProjectId);
  });

  it('should update task status', async () => {
    const task = await taskRepo.updateStatus(testTaskId, 'in_progress');
    expect(task.status).toBe('in_progress');
    expect(task.started_at).toBeDefined();
  });

  it('should assign agent to task', async () => {
    const task = await taskRepo.assignAgent(testTaskId, 'agent-123');
    expect(task.assigned_agent_id).toBe('agent-123');
    expect(task.status).toBe('assigned');
  });

  it('should update task to complete with timestamp', async () => {
    const task = await taskRepo.updateStatus(testTaskId, 'complete');
    expect(task.status).toBe('complete');
    expect(task.completed_at).toBeDefined();
  });

  it('should update task fields', async () => {
    const updated = await taskRepo.update(testTaskId, {
      title: 'Updated Task Title',
      priority: 10
    });
    expect(updated.title).toBe('Updated Task Title');
    expect(updated.priority).toBe(10);
  });

  it('should record token usage', async () => {
    const updated = await taskRepo.recordUsage(testTaskId, {
      tokens_opus: 1000,
      sessions_opus: 1
    });
    expect(updated.actual_tokens_opus).toBe(1000);
    expect(updated.actual_sessions_opus).toBe(1);
  });
});
