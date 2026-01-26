import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EstimateTracker, EstimateRecord, CreateEstimateInput } from './estimate-tracker.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { ProjectRepository } from '../db/repositories/projects.js';
import { createSupabaseClient } from '../db/client.js';

describe('EstimateTracker', () => {
  let tracker: EstimateTracker;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let testProjectId: string;
  let testTaskId: string;
  let testEstimateId: string;

  beforeAll(async () => {
    const client = createSupabaseClient();
    tracker = new EstimateTracker(client);
    taskRepo = new TaskRepository(client);
    projectRepo = new ProjectRepository(client);

    // Create test project and task
    const project = await projectRepo.create({ name: 'Estimate Tracker Test Project' });
    testProjectId = project.id;

    const task = await taskRepo.create({
      project_id: testProjectId,
      title: 'Test Task for Estimates',
      description: 'A task for testing estimate tracking',
      estimated_sessions_opus: 2,
      estimated_sessions_sonnet: 3,
      complexity_estimate: 'medium'
    });
    testTaskId = task.id;
  });

  afterAll(async () => {
    // Clean up test estimates first, then task, then project
    if (testEstimateId) {
      await tracker.delete(testEstimateId);
    }
    if (testTaskId) {
      await taskRepo.delete(testTaskId);
    }
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  describe('recordEstimate', () => {
    it('should record an estimate for a task', async () => {
      const input: CreateEstimateInput = {
        taskId: testTaskId,
        estimatedSessionsOpus: 2,
        estimatedSessionsSonnet: 3,
        estimatedImpactScore: 'high',
        estimatedInterventionMinutes: 30,
        estimator: 'system',
        notes: 'Initial estimate'
      };

      const estimate = await tracker.recordEstimate(input);
      testEstimateId = estimate.id;

      expect(estimate.id).toBeDefined();
      expect(estimate.taskId).toBe(testTaskId);
      expect(estimate.estimatedSessionsOpus).toBe(2);
      expect(estimate.estimatedSessionsSonnet).toBe(3);
      expect(estimate.estimatedImpactScore).toBe('high');
      expect(estimate.estimatedInterventionMinutes).toBe(30);
      expect(estimate.estimator).toBe('system');
      expect(estimate.notes).toBe('Initial estimate');
      expect(estimate.recordedAt).toBeInstanceOf(Date);
    });

    it('should record estimate with minimal fields', async () => {
      const input: CreateEstimateInput = {
        taskId: testTaskId,
        estimatedSessionsOpus: 1,
        estimatedSessionsSonnet: 2
      };

      const estimate = await tracker.recordEstimate(input);

      expect(estimate.estimatedSessionsOpus).toBe(1);
      expect(estimate.estimatedSessionsSonnet).toBe(2);
      expect(estimate.estimator).toBe('system'); // default value

      // Clean up
      await tracker.delete(estimate.id);
    });
  });

  describe('getByTaskId', () => {
    it('should retrieve all estimates for a task', async () => {
      const estimates = await tracker.getByTaskId(testTaskId);

      expect(estimates.length).toBeGreaterThan(0);
      expect(estimates[0].taskId).toBe(testTaskId);
    });

    it('should return estimates ordered by recordedAt descending', async () => {
      // Add another estimate
      const newEstimate = await tracker.recordEstimate({
        taskId: testTaskId,
        estimatedSessionsOpus: 5,
        estimatedSessionsSonnet: 6
      });

      const estimates = await tracker.getByTaskId(testTaskId);

      // Most recent should be first
      expect(estimates[0].estimatedSessionsOpus).toBe(5);

      // Clean up
      await tracker.delete(newEstimate.id);
    });
  });

  describe('getById', () => {
    it('should retrieve a specific estimate by id', async () => {
      const estimate = await tracker.getById(testEstimateId);

      expect(estimate).toBeDefined();
      expect(estimate?.id).toBe(testEstimateId);
      expect(estimate?.taskId).toBe(testTaskId);
    });

    it('should return null for non-existent estimate', async () => {
      const estimate = await tracker.getById('00000000-0000-0000-0000-000000000000');
      expect(estimate).toBeNull();
    });
  });

  describe('getLatestByTaskId', () => {
    it('should retrieve the most recent estimate for a task', async () => {
      const latest = await tracker.getLatestByTaskId(testTaskId);

      expect(latest).toBeDefined();
      expect(latest?.taskId).toBe(testTaskId);
    });

    it('should return null for task with no estimates', async () => {
      // Create a task without estimates
      const newTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Task without estimates'
      });

      const latest = await tracker.getLatestByTaskId(newTask.id);
      expect(latest).toBeNull();

      // Clean up
      await taskRepo.delete(newTask.id);
    });
  });

  describe('getEstimateHistory', () => {
    it('should retrieve estimate history with task details', async () => {
      const history = await tracker.getEstimateHistory(testProjectId);

      expect(history.length).toBeGreaterThan(0);
      expect(history[0].taskId).toBe(testTaskId);
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const history = await tracker.getEstimateHistory(testProjectId, {
        startDate: yesterday,
        endDate: tomorrow
      });

      expect(history.length).toBeGreaterThan(0);
    });

    it('should filter by estimator', async () => {
      const history = await tracker.getEstimateHistory(testProjectId, {
        estimator: 'system'
      });

      expect(history.length).toBeGreaterThan(0);
      expect(history.every(e => e.estimator === 'system')).toBe(true);
    });
  });

  describe('captureTaskEstimate', () => {
    it('should capture current estimate from task', async () => {
      const estimate = await tracker.captureTaskEstimate(testTaskId, 'Initial capture');

      expect(estimate.taskId).toBe(testTaskId);
      expect(estimate.estimatedSessionsOpus).toBe(2);
      expect(estimate.estimatedSessionsSonnet).toBe(3);
      expect(estimate.notes).toBe('Initial capture');

      // Clean up
      await tracker.delete(estimate.id);
    });
  });
});
