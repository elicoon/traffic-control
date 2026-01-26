import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MetricsCollector, ProjectMetrics, SystemMetrics } from './metrics-collector.js';
import { createSupabaseClient } from '../db/client.js';
import { ProjectRepository } from '../db/repositories/projects.js';
import { TaskRepository } from '../db/repositories/tasks.js';

describe('MetricsCollector', () => {
  let metricsCollector: MetricsCollector;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let testProjectId: string;
  let testTaskIds: string[] = [];

  beforeAll(async () => {
    const client = createSupabaseClient();
    metricsCollector = new MetricsCollector(client);
    projectRepo = new ProjectRepository(client);
    taskRepo = new TaskRepository(client);

    // Create a test project
    const project = await projectRepo.create({
      name: 'Metrics Test Project',
      priority: 1
    });
    testProjectId = project.id;

    // Create tasks in different states
    const queuedTask = await taskRepo.create({
      project_id: testProjectId,
      title: 'Queued Task',
      priority: 1
    });
    testTaskIds.push(queuedTask.id);

    const inProgressTask = await taskRepo.create({
      project_id: testProjectId,
      title: 'In Progress Task',
      priority: 2
    });
    await taskRepo.updateStatus(inProgressTask.id, 'in_progress');
    testTaskIds.push(inProgressTask.id);

    const blockedTask = await taskRepo.create({
      project_id: testProjectId,
      title: 'Blocked Task',
      priority: 3
    });
    await taskRepo.updateStatus(blockedTask.id, 'blocked');
    testTaskIds.push(blockedTask.id);

    const completedTask = await taskRepo.create({
      project_id: testProjectId,
      title: 'Completed Task',
      priority: 4,
      estimated_sessions_opus: 2
    });
    await taskRepo.updateStatus(completedTask.id, 'complete');
    await taskRepo.recordUsage(completedTask.id, {
      tokens_opus: 5000,
      tokens_sonnet: 1000,
      sessions_opus: 1
    });
    testTaskIds.push(completedTask.id);
  });

  afterAll(async () => {
    // Cleanup: delete tasks first (foreign key constraint)
    for (const taskId of testTaskIds) {
      await taskRepo.delete(taskId);
    }
    // Then delete project
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  describe('collectProjectMetrics', () => {
    it('should collect metrics for a specific project', async () => {
      const metrics = await metricsCollector.collectProjectMetrics(testProjectId);

      expect(metrics).toBeDefined();
      expect(metrics.projectId).toBe(testProjectId);
      expect(metrics.projectName).toBe('Metrics Test Project');
    });

    it('should count tasks by status correctly', async () => {
      const metrics = await metricsCollector.collectProjectMetrics(testProjectId);

      expect(metrics.tasksQueued).toBe(1);
      expect(metrics.tasksInProgress).toBe(1);
      expect(metrics.tasksBlocked).toBe(1);
      expect(metrics.tasksCompletedToday).toBeGreaterThanOrEqual(1);
    });

    it('should track token usage', async () => {
      const metrics = await metricsCollector.collectProjectMetrics(testProjectId);

      expect(metrics.tokensOpus).toBeGreaterThanOrEqual(5000);
      expect(metrics.tokensSonnet).toBeGreaterThanOrEqual(1000);
    });

    it('should calculate completion rate', async () => {
      const metrics = await metricsCollector.collectProjectMetrics(testProjectId);

      // 1 completed out of 4 total = 25%
      expect(metrics.completionRate).toBeGreaterThan(0);
    });
  });

  describe('collectAllProjectMetrics', () => {
    it('should collect metrics for all active projects', async () => {
      const allMetrics = await metricsCollector.collectAllProjectMetrics();

      expect(Array.isArray(allMetrics)).toBe(true);
      // Should include our test project
      const testProjectMetrics = allMetrics.find(m => m.projectId === testProjectId);
      expect(testProjectMetrics).toBeDefined();
    }, 15000);
  });

  describe('collectSystemMetrics', () => {
    it('should collect overall system metrics', async () => {
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      expect(systemMetrics).toBeDefined();
      expect(systemMetrics.totalProjects).toBeGreaterThanOrEqual(1);
      expect(systemMetrics.totalTasksQueued).toBeGreaterThanOrEqual(1);
      expect(systemMetrics.totalTasksInProgress).toBeGreaterThanOrEqual(1);
      expect(systemMetrics.totalTasksBlocked).toBeGreaterThanOrEqual(1);
    });

    it('should calculate total token usage across all projects', async () => {
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      expect(systemMetrics.totalTokensOpus).toBeGreaterThanOrEqual(5000);
      expect(systemMetrics.totalTokensSonnet).toBeGreaterThanOrEqual(1000);
    });

    it('should count total sessions', async () => {
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      expect(typeof systemMetrics.totalSessions).toBe('number');
    });

    it('should calculate utilization percentages', async () => {
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      expect(typeof systemMetrics.opusUtilization).toBe('number');
      expect(systemMetrics.opusUtilization).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.opusUtilization).toBeLessThanOrEqual(100);
    });
  });

  describe('getTasksCompletedInPeriod', () => {
    it('should return tasks completed today', async () => {
      const count = await metricsCollector.getTasksCompletedInPeriod('today');
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('should return tasks completed this week', async () => {
      const count = await metricsCollector.getTasksCompletedInPeriod('week');
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('compareEstimatesVsActuals', () => {
    it('should compare estimated vs actual sessions', async () => {
      const comparison = await metricsCollector.compareEstimatesVsActuals(testProjectId);

      expect(comparison).toBeDefined();
      expect(typeof comparison.estimatedSessionsOpus).toBe('number');
      expect(typeof comparison.actualSessionsOpus).toBe('number');
      expect(typeof comparison.variance).toBe('number');
    });
  });
});
