import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
});
