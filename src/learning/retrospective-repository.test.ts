import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RetrospectiveRepository } from './retrospective-repository.js';
import { ProjectRepository } from '../db/repositories/projects.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { createSupabaseClient } from '../db/client.js';
import type { Retrospective, RetrospectiveTriggerType } from './types.js';

describe('RetrospectiveRepository', () => {
  let retrospectiveRepo: RetrospectiveRepository;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let testProjectId: string;
  let testTaskId: string;
  let testRetrospectiveId: string;

  beforeAll(async () => {
    const client = createSupabaseClient();
    retrospectiveRepo = new RetrospectiveRepository(client);
    projectRepo = new ProjectRepository(client);
    taskRepo = new TaskRepository(client);

    // Create test project
    const project = await projectRepo.create({ name: 'Retrospective Test Project' });
    testProjectId = project.id;

    // Create test task
    const task = await taskRepo.create({
      project_id: testProjectId,
      title: 'Test Task for Retrospective'
    });
    testTaskId = task.id;
  });

  afterAll(async () => {
    // Clean up in reverse order of dependencies
    if (testRetrospectiveId) {
      await retrospectiveRepo.delete(testRetrospectiveId);
    }
    if (testTaskId) {
      await taskRepo.delete(testTaskId);
    }
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  describe('create', () => {
    it('should create a retrospective with required fields', async () => {
      const retro = await retrospectiveRepo.create({
        projectId: testProjectId,
        taskId: testTaskId,
        title: 'Test Retrospective',
        triggerType: 'validation_failures',
        whatHappened: 'Task failed validation 3 times due to TypeScript errors'
      });

      testRetrospectiveId = retro.id;

      expect(retro.id).toBeDefined();
      expect(retro.title).toBe('Test Retrospective');
      expect(retro.triggerType).toBe('validation_failures');
      expect(retro.whatHappened).toBe('Task failed validation 3 times due to TypeScript errors');
      expect(retro.projectId).toBe(testProjectId);
      expect(retro.taskId).toBe(testTaskId);
      expect(retro.createdAt).toBeInstanceOf(Date);
      expect(retro.resolvedAt).toBeNull();
    });

    it('should create a retrospective with learning data', async () => {
      const retro = await retrospectiveRepo.create({
        projectId: testProjectId,
        title: 'Retrospective with Learning',
        triggerType: 'blocker',
        whatHappened: 'Agent blocked on missing API key',
        rootCause: 'Environment variable not set',
        correctApproach: 'Check for required env vars before starting task',
        learning: {
          category: 'configuration',
          pattern: 'missing_env_var',
          rule: 'Always verify required environment variables exist before executing tasks',
          appliesTo: ['api-tasks', 'integration-tasks']
        }
      });

      expect(retro.learning).toBeDefined();
      expect(retro.learning?.category).toBe('configuration');
      expect(retro.learning?.pattern).toBe('missing_env_var');
      expect(retro.learning?.rule).toBe('Always verify required environment variables exist before executing tasks');

      // Clean up
      await retrospectiveRepo.delete(retro.id);
    });

    it('should create a retrospective without a task', async () => {
      const retro = await retrospectiveRepo.create({
        projectId: testProjectId,
        title: 'Project-level Retrospective',
        triggerType: 'manual',
        whatHappened: 'Manual retrospective for project review'
      });

      expect(retro.taskId).toBeNull();
      expect(retro.projectId).toBe(testProjectId);

      // Clean up
      await retrospectiveRepo.delete(retro.id);
    });
  });

  describe('getById', () => {
    it('should get a retrospective by id', async () => {
      const retro = await retrospectiveRepo.getById(testRetrospectiveId);

      expect(retro).toBeDefined();
      expect(retro?.id).toBe(testRetrospectiveId);
      expect(retro?.title).toBe('Test Retrospective');
    });

    it('should return null for non-existent id', async () => {
      const retro = await retrospectiveRepo.getById('00000000-0000-0000-0000-000000000000');
      expect(retro).toBeNull();
    });
  });

  describe('getByTask', () => {
    it('should get retrospectives for a task', async () => {
      const retros = await retrospectiveRepo.getByTask(testTaskId);

      expect(retros.length).toBeGreaterThan(0);
      expect(retros.some(r => r.id === testRetrospectiveId)).toBe(true);
    });

    it('should return empty array for task with no retrospectives', async () => {
      const newTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Task without retrospectives'
      });

      const retros = await retrospectiveRepo.getByTask(newTask.id);
      expect(retros).toEqual([]);

      await taskRepo.delete(newTask.id);
    });
  });

  describe('getByProject', () => {
    it('should get retrospectives for a project', async () => {
      const retros = await retrospectiveRepo.getByProject(testProjectId);

      expect(retros.length).toBeGreaterThan(0);
      expect(retros.every(r => r.projectId === testProjectId)).toBe(true);
    });
  });

  describe('getByTriggerType', () => {
    it('should get retrospectives by trigger type', async () => {
      const retros = await retrospectiveRepo.getByTriggerType('validation_failures');

      expect(retros.some(r => r.id === testRetrospectiveId)).toBe(true);
      expect(retros.every(r => r.triggerType === 'validation_failures')).toBe(true);
    });
  });

  describe('getUnresolved', () => {
    it('should get unresolved retrospectives', async () => {
      const retros = await retrospectiveRepo.getUnresolved();

      expect(retros.some(r => r.id === testRetrospectiveId)).toBe(true);
      expect(retros.every(r => r.resolvedAt === null)).toBe(true);
    });
  });

  describe('update', () => {
    it('should update retrospective fields', async () => {
      const updated = await retrospectiveRepo.update(testRetrospectiveId, {
        rootCause: 'Incorrect type annotations in function signatures',
        correctApproach: 'Use strict TypeScript settings and validate types before commit'
      });

      expect(updated.rootCause).toBe('Incorrect type annotations in function signatures');
      expect(updated.correctApproach).toBe('Use strict TypeScript settings and validate types before commit');
    });

    it('should update learning data', async () => {
      const updated = await retrospectiveRepo.update(testRetrospectiveId, {
        learning: {
          category: 'typescript',
          pattern: 'type_mismatch',
          rule: 'Always run tsc --noEmit before committing TypeScript changes'
        }
      });

      expect(updated.learning?.category).toBe('typescript');
      expect(updated.learning?.pattern).toBe('type_mismatch');
    });
  });

  describe('resolve', () => {
    it('should mark a retrospective as resolved', async () => {
      // Create a new one to resolve
      const retro = await retrospectiveRepo.create({
        projectId: testProjectId,
        title: 'Retrospective to Resolve',
        triggerType: 'test_regression',
        whatHappened: 'Tests failed after refactoring'
      });

      const resolved = await retrospectiveRepo.resolve(retro.id);

      expect(resolved.resolvedAt).toBeInstanceOf(Date);
      expect(resolved.resolvedAt).not.toBeNull();

      // Clean up
      await retrospectiveRepo.delete(retro.id);
    });
  });

  describe('getRecentLearnings', () => {
    it('should get recent learnings with limit', async () => {
      // Create retrospectives with learnings
      const retro1 = await retrospectiveRepo.create({
        projectId: testProjectId,
        title: 'Learning 1',
        triggerType: 'validation_failures',
        whatHappened: 'Test 1',
        learning: {
          category: 'testing',
          pattern: 'missing_tests',
          rule: 'Rule 1'
        }
      });

      const retro2 = await retrospectiveRepo.create({
        projectId: testProjectId,
        title: 'Learning 2',
        triggerType: 'blocker',
        whatHappened: 'Test 2',
        learning: {
          category: 'architecture',
          pattern: 'coupling',
          rule: 'Rule 2'
        }
      });

      const learnings = await retrospectiveRepo.getRecentLearnings(10);

      expect(learnings.length).toBeGreaterThanOrEqual(2);
      expect(learnings.every(l => l.learning !== null)).toBe(true);

      // Clean up
      await retrospectiveRepo.delete(retro1.id);
      await retrospectiveRepo.delete(retro2.id);
    });
  });

  describe('getLearningsByCategory', () => {
    it('should get learnings filtered by category', async () => {
      const retro = await retrospectiveRepo.create({
        projectId: testProjectId,
        title: 'Categorized Learning',
        triggerType: 'review_rejected',
        whatHappened: 'Code review failed',
        learning: {
          category: 'code_quality',
          pattern: 'naming_convention',
          rule: 'Use consistent naming conventions'
        }
      });

      const learnings = await retrospectiveRepo.getLearningsByCategory('code_quality');

      expect(learnings.length).toBeGreaterThan(0);
      expect(learnings.every(l => l.learning?.category === 'code_quality')).toBe(true);

      // Clean up
      await retrospectiveRepo.delete(retro.id);
    });
  });

  describe('getBySession', () => {
    const testSessionId = 'a0000000-0000-0000-0000-000000000001';

    it('should get retrospectives by session id', async () => {
      const retro = await retrospectiveRepo.create({
        projectId: testProjectId,
        taskId: testTaskId,
        sessionId: testSessionId,
        title: 'Session Retrospective',
        triggerType: 'blocker',
        whatHappened: 'Agent blocked during session'
      });

      const retros = await retrospectiveRepo.getBySession(testSessionId);

      expect(retros.length).toBeGreaterThan(0);
      expect(retros.some(r => r.id === retro.id)).toBe(true);
      expect(retros.every(r => r.sessionId === testSessionId)).toBe(true);

      // Clean up
      await retrospectiveRepo.delete(retro.id);
    });

    it('should return empty array for session with no retrospectives', async () => {
      const retros = await retrospectiveRepo.getBySession('b0000000-0000-0000-0000-000000000099');
      expect(retros).toEqual([]);
    });
  });

  describe('update edge cases', () => {
    it('should update title and whatHappened fields', async () => {
      const updated = await retrospectiveRepo.update(testRetrospectiveId, {
        title: 'Updated Title',
        whatHappened: 'Updated description of what happened'
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.whatHappened).toBe('Updated description of what happened');
    });

    it('should update resolvedAt field', async () => {
      const resolveDate = new Date('2026-01-15T12:00:00Z');
      const updated = await retrospectiveRepo.update(testRetrospectiveId, {
        resolvedAt: resolveDate
      });

      expect(updated.resolvedAt).toBeInstanceOf(Date);
      expect(updated.resolvedAt!.toISOString()).toBe(resolveDate.toISOString());
    });
  });

  describe('error handling with mocked client', () => {
    const mockError = { message: 'connection refused', code: '500', details: '', hint: '' };

    function createErrorMockClient() {
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: mockError }),
        then: undefined as unknown,
      };

      // Make chainable methods resolve with error for list queries
      const listResult = { data: null, error: mockError };
      chainChain(mockChain.order, listResult);
      chainChain(mockChain.limit, listResult);

      const mockClient = {
        from: vi.fn().mockReturnValue(mockChain),
      } as unknown as ReturnType<typeof createSupabaseClient>;

      return { mockClient, mockChain };
    }

    function chainChain(fn: ReturnType<typeof vi.fn>, result: unknown) {
      fn.mockImplementation(() => {
        const proxy = new Proxy({}, {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (val: unknown) => void) => {
                resolve(result);
                return Promise.resolve(result);
              };
            }
            return vi.fn().mockReturnValue(proxy);
          }
        });
        return proxy;
      });
    }

    it('should throw on non-PGRST116 error in getById', async () => {
      const { mockClient } = createErrorMockClient();
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.getById('some-id')).rejects.toThrow(
        'Failed to get retrospective: connection refused'
      );
    });

    it('should throw on error in create', async () => {
      const { mockClient } = createErrorMockClient();
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.create({
        projectId: 'proj-1',
        title: 'Test',
        triggerType: 'manual',
        whatHappened: 'test'
      })).rejects.toThrow('Failed to create retrospective: connection refused');
    });

    it('should throw on error in getByTask', async () => {
      const { mockClient, mockChain } = createErrorMockClient();
      // For list queries, make order return error result
      mockChain.order.mockResolvedValue({ data: null, error: mockError });
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.getByTask('task-1')).rejects.toThrow(
        'Failed to get retrospectives by task: connection refused'
      );
    });

    it('should throw on error in getByProject', async () => {
      const { mockClient, mockChain } = createErrorMockClient();
      mockChain.order.mockResolvedValue({ data: null, error: mockError });
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.getByProject('proj-1')).rejects.toThrow(
        'Failed to get retrospectives by project: connection refused'
      );
    });

    it('should throw on error in getByTriggerType', async () => {
      const { mockClient, mockChain } = createErrorMockClient();
      mockChain.order.mockResolvedValue({ data: null, error: mockError });
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.getByTriggerType('blocker')).rejects.toThrow(
        'Failed to get retrospectives by trigger type: connection refused'
      );
    });

    it('should throw on error in getUnresolved', async () => {
      const { mockClient, mockChain } = createErrorMockClient();
      mockChain.order.mockResolvedValue({ data: null, error: mockError });
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.getUnresolved()).rejects.toThrow(
        'Failed to get unresolved retrospectives: connection refused'
      );
    });

    it('should throw on error in update', async () => {
      const { mockClient } = createErrorMockClient();
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.update('id-1', { title: 'new' })).rejects.toThrow(
        'Failed to update retrospective: connection refused'
      );
    });

    it('should throw on error in resolve', async () => {
      const { mockClient } = createErrorMockClient();
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.resolve('id-1')).rejects.toThrow(
        'Failed to resolve retrospective: connection refused'
      );
    });

    it('should throw on error in delete', async () => {
      const { mockClient, mockChain } = createErrorMockClient();
      mockChain.eq.mockResolvedValue({ error: mockError });
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.delete('id-1')).rejects.toThrow(
        'Failed to delete retrospective: connection refused'
      );
    });

    it('should throw on error in getRecentLearnings', async () => {
      const { mockClient, mockChain } = createErrorMockClient();
      mockChain.limit.mockResolvedValue({ data: null, error: mockError });
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.getRecentLearnings()).rejects.toThrow(
        'Failed to get recent learnings: connection refused'
      );
    });

    it('should throw on error in getLearningsByCategory', async () => {
      const { mockClient, mockChain } = createErrorMockClient();
      mockChain.order.mockResolvedValue({ data: null, error: mockError });
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.getLearningsByCategory('testing')).rejects.toThrow(
        'Failed to get learnings by category: connection refused'
      );
    });

    it('should throw on error in getBySession', async () => {
      const { mockClient, mockChain } = createErrorMockClient();
      mockChain.order.mockResolvedValue({ data: null, error: mockError });
      const repo = new RetrospectiveRepository(mockClient);

      await expect(repo.getBySession('session-1')).rejects.toThrow(
        'Failed to get retrospectives by session: connection refused'
      );
    });
  });
});
