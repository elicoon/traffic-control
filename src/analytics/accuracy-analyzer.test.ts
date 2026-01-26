import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AccuracyAnalyzer, AccuracyMetrics, AccuracyBreakdown } from './accuracy-analyzer.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { ProjectRepository } from '../db/repositories/projects.js';
import { createSupabaseClient } from '../db/client.js';

describe('AccuracyAnalyzer', () => {
  let analyzer: AccuracyAnalyzer;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let testProjectId: string;
  const testTaskIds: string[] = [];

  beforeAll(async () => {
    const client = createSupabaseClient();
    analyzer = new AccuracyAnalyzer(client);
    taskRepo = new TaskRepository(client);
    projectRepo = new ProjectRepository(client);

    // Create test project
    const project = await projectRepo.create({ name: 'Accuracy Analyzer Test Project' });
    testProjectId = project.id;

    // Create test tasks with different complexities and actual vs estimated values
    const tasksData = [
      // Low complexity - slight underestimate
      { complexity: 'low', estOpus: 1, estSonnet: 1, actOpus: 2, actSonnet: 1 },
      { complexity: 'low', estOpus: 1, estSonnet: 2, actOpus: 1, actSonnet: 2 },
      { complexity: 'low', estOpus: 2, estSonnet: 2, actOpus: 2, actSonnet: 3 },
      { complexity: 'low', estOpus: 1, estSonnet: 1, actOpus: 1, actSonnet: 1 },
      { complexity: 'low', estOpus: 2, estSonnet: 2, actOpus: 2, actSonnet: 2 },
      // Medium complexity - some overestimate
      { complexity: 'medium', estOpus: 3, estSonnet: 4, actOpus: 2, actSonnet: 3 },
      { complexity: 'medium', estOpus: 4, estSonnet: 5, actOpus: 4, actSonnet: 4 },
      { complexity: 'medium', estOpus: 3, estSonnet: 3, actOpus: 3, actSonnet: 3 },
      { complexity: 'medium', estOpus: 5, estSonnet: 6, actOpus: 4, actSonnet: 5 },
      { complexity: 'medium', estOpus: 4, estSonnet: 4, actOpus: 4, actSonnet: 4 },
      // High complexity - significant underestimate
      { complexity: 'high', estOpus: 5, estSonnet: 6, actOpus: 8, actSonnet: 10 },
      { complexity: 'high', estOpus: 6, estSonnet: 7, actOpus: 9, actSonnet: 11 },
      { complexity: 'high', estOpus: 7, estSonnet: 8, actOpus: 10, actSonnet: 12 },
      { complexity: 'high', estOpus: 6, estSonnet: 8, actOpus: 8, actSonnet: 10 },
      { complexity: 'high', estOpus: 5, estSonnet: 7, actOpus: 7, actSonnet: 9 }
    ];

    for (const data of tasksData) {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: `Test Task - ${data.complexity}`,
        complexity_estimate: data.complexity,
        estimated_sessions_opus: data.estOpus,
        estimated_sessions_sonnet: data.estSonnet
      });

      // Mark as complete and set actual values
      await taskRepo.updateStatus(task.id, 'complete');
      await taskRepo.recordUsage(task.id, {
        sessions_opus: data.actOpus,
        sessions_sonnet: data.actSonnet
      });

      testTaskIds.push(task.id);
    }
  });

  afterAll(async () => {
    // Clean up test data
    for (const taskId of testTaskIds) {
      await taskRepo.delete(taskId);
    }
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  describe('calculateAccuracyMetrics', () => {
    it('should calculate accuracy metrics for a project', async () => {
      const metrics = await analyzer.calculateAccuracyMetrics(testProjectId);

      expect(metrics.projectId).toBe(testProjectId);
      expect(metrics.sampleSize).toBe(15);
      expect(typeof metrics.meanSessionError).toBe('number');
      expect(typeof metrics.sessionErrorStdDev).toBe('number');
      expect(typeof metrics.sessionAccuracyPercent).toBe('number');
    });

    it('should break down accuracy by complexity', async () => {
      const metrics = await analyzer.calculateAccuracyMetrics(testProjectId);

      expect(metrics.byComplexity.low).toBeDefined();
      expect(metrics.byComplexity.medium).toBeDefined();
      expect(metrics.byComplexity.high).toBeDefined();

      // Low complexity should have 5 samples
      expect(metrics.byComplexity.low.sampleSize).toBe(5);
      // Medium complexity should have 5 samples
      expect(metrics.byComplexity.medium.sampleSize).toBe(5);
      // High complexity should have 5 samples
      expect(metrics.byComplexity.high.sampleSize).toBe(5);
    });

    it('should detect underestimation in high complexity tasks', async () => {
      const metrics = await analyzer.calculateAccuracyMetrics(testProjectId);

      // High complexity tasks were designed to be underestimated
      // Mean error should be negative (actual > estimated)
      expect(metrics.byComplexity.high.meanError).toBeLessThan(0);
    });

    it('should detect overestimation in medium complexity tasks', async () => {
      const metrics = await analyzer.calculateAccuracyMetrics(testProjectId);

      // Medium complexity tasks were designed to be slightly overestimated
      // Mean error should be close to 0 or slightly positive
      expect(metrics.byComplexity.medium.meanError).toBeGreaterThanOrEqual(-1);
    });
  });

  describe('calculateTaskAccuracy', () => {
    it('should calculate accuracy for a single task', async () => {
      // Get a task with known values
      const task = await taskRepo.getById(testTaskIds[0]);
      expect(task).toBeDefined();

      const accuracy = await analyzer.calculateTaskAccuracy(testTaskIds[0]);

      expect(accuracy).not.toBeNull();
      expect(accuracy!.taskId).toBe(testTaskIds[0]);
      expect(accuracy!.estimatedSessions).toBeDefined();
      expect(accuracy!.actualSessions).toBeDefined();
      expect(typeof accuracy!.sessionError).toBe('number');
      expect(typeof accuracy!.errorPercent).toBe('number');
    });

    it('should return null for incomplete task', async () => {
      // Create an incomplete task
      const incompleteTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Incomplete Task',
        estimated_sessions_opus: 3
      });

      const accuracy = await analyzer.calculateTaskAccuracy(incompleteTask.id);
      expect(accuracy).toBeNull();

      // Clean up
      await taskRepo.delete(incompleteTask.id);
    });
  });

  describe('identifyEstimationPatterns', () => {
    it('should identify systematic estimation patterns', async () => {
      const patterns = await analyzer.identifyEstimationPatterns(testProjectId);

      expect(patterns.overallTendency).toBeDefined();
      expect(['overestimate', 'underestimate', 'accurate']).toContain(patterns.overallTendency);

      expect(patterns.byComplexity).toBeDefined();
      expect(patterns.byComplexity.high).toBeDefined();
    });

    it('should identify high complexity underestimation pattern', async () => {
      const patterns = await analyzer.identifyEstimationPatterns(testProjectId);

      // High complexity tasks were designed to be underestimated
      expect(patterns.byComplexity.high).toBeDefined();
      expect(patterns.byComplexity.high!.tendency).toBe('underestimate');
    });
  });

  describe('getCompletedTasksWithEstimates', () => {
    it('should return completed tasks with both estimates and actuals', async () => {
      const tasks = await analyzer.getCompletedTasksWithEstimates(testProjectId);

      expect(tasks.length).toBeGreaterThan(0);
      tasks.forEach(task => {
        expect(task.status).toBe('complete');
        expect(task.estimated_sessions_opus).toBeDefined();
        expect(task.actual_sessions_opus).toBeDefined();
      });
    });

    it('should filter by complexity', async () => {
      const tasks = await analyzer.getCompletedTasksWithEstimates(testProjectId, {
        complexity: 'high'
      });

      expect(tasks.length).toBe(5);
      tasks.forEach(task => {
        expect(task.complexity_estimate).toBe('high');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle project with no completed tasks', async () => {
      const emptyProject = await projectRepo.create({ name: 'Empty Project' });

      const metrics = await analyzer.calculateAccuracyMetrics(emptyProject.id);

      expect(metrics.sampleSize).toBe(0);
      expect(metrics.meanSessionError).toBe(0);
      expect(metrics.sessionAccuracyPercent).toBe(100);

      await projectRepo.delete(emptyProject.id);
    });

    it('should handle task with zero estimates', async () => {
      const zeroTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Zero Estimate Task',
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 0
      });

      await taskRepo.updateStatus(zeroTask.id, 'complete');
      await taskRepo.recordUsage(zeroTask.id, {
        sessions_opus: 2,
        sessions_sonnet: 2
      });

      const accuracy = await analyzer.calculateTaskAccuracy(zeroTask.id);
      expect(accuracy).toBeDefined();
      expect(accuracy?.errorPercent).toBeDefined();

      await taskRepo.delete(zeroTask.id);
    });
  });
});
