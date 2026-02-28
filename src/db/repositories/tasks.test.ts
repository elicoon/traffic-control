import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TaskRepository, type Task } from './tasks.js';
import { ProjectRepository } from './projects.js';
import { createSupabaseClient } from '../client.js';
import { TEST_PREFIX, deleteTasksByIds } from '../test-cleanup.js';
import { SupabaseClient } from '@supabase/supabase-js';

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

describe('TaskRepository unit tests', () => {
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

  function createSuccessClient(data: unknown) {
    const result = { data, error: null };
    return { from: () => createChain(result) } as unknown as SupabaseClient;
  }

  describe('getEtaDelta', () => {
    const baseTask = {
      id: 't1', project_id: 'p1', title: 'Task', description: null,
      status: 'complete' as const, priority: 0, complexity_estimate: null,
      estimated_sessions_opus: 0, estimated_sessions_sonnet: 0,
      actual_tokens_opus: 0, actual_tokens_sonnet: 0,
      actual_sessions_opus: 0, actual_sessions_sonnet: 0,
      assigned_agent_id: null, requires_visual_review: false,
      parent_task_id: null, tags: [], acceptance_criteria: null,
      source: 'user' as const, blocked_by_task_id: null,
      priority_confirmed: true, priority_confirmed_at: null, priority_confirmed_by: null,
      started_at: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    };

    it('should return null when eta is missing (line 552)', () => {
      const repo = new TaskRepository(createSuccessClient(null));
      const task: Task = { ...baseTask, eta: null, completed_at: '2024-01-02T00:00:00Z' };
      expect(repo.getEtaDelta(task)).toBeNull();
    });

    it('should return null when completed_at is missing (line 552)', () => {
      const repo = new TaskRepository(createSuccessClient(null));
      const task: Task = { ...baseTask, eta: '2024-01-02T00:00:00Z', completed_at: null };
      expect(repo.getEtaDelta(task)).toBeNull();
    });

    it('should return positive delta when task completed late (lines 553-554)', () => {
      const repo = new TaskRepository(createSuccessClient(null));
      const task: Task = {
        ...baseTask,
        eta: '2024-01-02T00:00:00Z',
        completed_at: '2024-01-03T00:00:00Z',
      };
      expect(repo.getEtaDelta(task)).toBe(86400000); // 1 day in ms
    });

    it('should return negative delta when task completed early (lines 553-554)', () => {
      const repo = new TaskRepository(createSuccessClient(null));
      const task: Task = {
        ...baseTask,
        eta: '2024-01-03T00:00:00Z',
        completed_at: '2024-01-02T00:00:00Z',
      };
      expect(repo.getEtaDelta(task)).toBe(-86400000); // -1 day in ms
    });
  });

  describe('error paths', () => {
    it('should throw when confirmPriority returns an error (lines 518-519)', async () => {
      const repo = new TaskRepository(createErrorClient('confirm failed'));
      await expect(repo.confirmPriority('task-1', 'user')).rejects.toThrow(
        'Failed to confirm priority: confirm failed'
      );
    });

    it('should throw when getUnconfirmedPriorityTasks returns an error (lines 539-541)', async () => {
      const repo = new TaskRepository(createErrorClient('query failed'));
      await expect(repo.getUnconfirmedPriorityTasks()).rejects.toThrow(
        'Failed to get unconfirmed priority tasks: query failed'
      );
    });

    it('should return tasks from getUnconfirmedPriorityTasks on success (lines 529-544)', async () => {
      const repo = new TaskRepository(createSuccessClient([]));
      const tasks = await repo.getUnconfirmedPriorityTasks();
      expect(tasks).toEqual([]);
    });
  });
});
