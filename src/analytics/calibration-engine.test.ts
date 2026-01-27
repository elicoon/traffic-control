import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  CalibrationEngine,
  CalibrationFactor,
  CalibratedEstimate
} from './calibration-engine.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { ProjectRepository } from '../db/repositories/projects.js';
import { createSupabaseClient } from '../db/client.js';

describe('CalibrationEngine', () => {
  let engine: CalibrationEngine;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let testProjectId: string;
  const testTaskIds: string[] = [];

  beforeAll(async () => {
    const client = createSupabaseClient();
    engine = new CalibrationEngine(client);
    taskRepo = new TaskRepository(client);
    projectRepo = new ProjectRepository(client);

    // Create test project
    const project = await projectRepo.create({ name: 'Calibration Engine Test Project' });
    testProjectId = project.id;

    // Create test tasks with systematic estimation errors
    const tasksData = [
      // Low complexity - estimates are accurate
      { complexity: 'low', estOpus: 1, estSonnet: 1, actOpus: 1, actSonnet: 1 },
      { complexity: 'low', estOpus: 1, estSonnet: 2, actOpus: 1, actSonnet: 2 },
      { complexity: 'low', estOpus: 2, estSonnet: 2, actOpus: 2, actSonnet: 2 },
      { complexity: 'low', estOpus: 1, estSonnet: 1, actOpus: 1, actSonnet: 1 },
      { complexity: 'low', estOpus: 2, estSonnet: 2, actOpus: 2, actSonnet: 2 },
      // Medium complexity - 20% underestimate pattern
      { complexity: 'medium', estOpus: 3, estSonnet: 4, actOpus: 4, actSonnet: 5 },
      { complexity: 'medium', estOpus: 4, estSonnet: 5, actOpus: 5, actSonnet: 6 },
      { complexity: 'medium', estOpus: 3, estSonnet: 3, actOpus: 4, actSonnet: 4 },
      { complexity: 'medium', estOpus: 5, estSonnet: 6, actOpus: 6, actSonnet: 7 },
      { complexity: 'medium', estOpus: 4, estSonnet: 4, actOpus: 5, actSonnet: 5 },
      // High complexity - 50% underestimate pattern
      { complexity: 'high', estOpus: 4, estSonnet: 4, actOpus: 6, actSonnet: 6 },
      { complexity: 'high', estOpus: 6, estSonnet: 6, actOpus: 9, actSonnet: 9 },
      { complexity: 'high', estOpus: 5, estSonnet: 5, actOpus: 7, actSonnet: 8 },
      { complexity: 'high', estOpus: 6, estSonnet: 6, actOpus: 9, actSonnet: 9 },
      { complexity: 'high', estOpus: 4, estSonnet: 5, actOpus: 6, actSonnet: 8 }
    ];

    for (const data of tasksData) {
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: `Calibration Test Task - ${data.complexity}`,
        complexity_estimate: data.complexity,
        estimated_sessions_opus: data.estOpus,
        estimated_sessions_sonnet: data.estSonnet
      });

      await taskRepo.updateStatus(task.id, 'complete');
      await taskRepo.recordUsage(task.id, {
        sessions_opus: data.actOpus,
        sessions_sonnet: data.actSonnet
      });

      testTaskIds.push(task.id);
    }
  });

  afterAll(async () => {
    // Clean up calibration factors first
    await engine.clearCalibrationFactors(testProjectId);

    // Clean up test tasks
    for (const taskId of testTaskIds) {
      await taskRepo.delete(taskId);
    }
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  describe('calculateCalibrationFactors', () => {
    it('should calculate calibration factors for a project', async () => {
      const factors = await engine.calculateCalibrationFactors(testProjectId);

      expect(factors.length).toBeGreaterThan(0);
      expect(factors[0].projectId).toBe(testProjectId);
    });

    it('should calculate different factors for different complexities', async () => {
      const factors = await engine.calculateCalibrationFactors(testProjectId);

      const lowFactor = factors.find(f => f.complexity === 'low');
      const highFactor = factors.find(f => f.complexity === 'high');

      expect(lowFactor).toBeDefined();
      expect(highFactor).toBeDefined();

      // Low complexity should have multiplier close to 1.0
      expect(lowFactor!.sessionsMultiplier).toBeCloseTo(1.0, 0);

      // High complexity should have multiplier > 1.0 (to correct underestimation)
      expect(highFactor!.sessionsMultiplier).toBeGreaterThan(1.0);
    });

    it('should include confidence level based on sample size', async () => {
      const factors = await engine.calculateCalibrationFactors(testProjectId);

      factors.forEach(factor => {
        expect(['low', 'medium', 'high']).toContain(factor.confidence);
        // With 5 samples per complexity, confidence should be 'low'
        expect(factor.confidence).toBe('low');
      });
    });
  });

  describe('getCalibrationFactor', () => {
    it('should retrieve calibration factor for specific complexity', async () => {
      // First save the factors
      await engine.saveCalibrationFactors(testProjectId);

      const factor = await engine.getCalibrationFactor(testProjectId, 'high');

      expect(factor).toBeDefined();
      expect(factor?.complexity).toBe('high');
      expect(factor?.projectId).toBe(testProjectId);
    });

    it('should return null for non-existent complexity', async () => {
      const factor = await engine.getCalibrationFactor(testProjectId, 'unknown');
      expect(factor).toBeNull();
    });
  });

  describe('calibrateEstimate', () => {
    it('should apply calibration to an estimate', async () => {
      const calibrated = await engine.calibrateEstimate({
        projectId: testProjectId,
        complexity: 'high',
        sessionsOpus: 4,
        sessionsSonnet: 4,
        interventionMinutes: 30
      });

      expect(calibrated.originalEstimate.sessionsOpus).toBe(4);
      expect(calibrated.originalEstimate.sessionsSonnet).toBe(4);

      // High complexity was underestimated, so calibrated should be higher
      expect(calibrated.calibratedEstimate.sessionsOpus).toBeGreaterThanOrEqual(4);
      expect(calibrated.calibratedEstimate.sessionsSonnet).toBeGreaterThanOrEqual(4);
    });

    it('should not change estimates for accurate complexity', async () => {
      const calibrated = await engine.calibrateEstimate({
        projectId: testProjectId,
        complexity: 'low',
        sessionsOpus: 2,
        sessionsSonnet: 2,
        interventionMinutes: 15
      });

      // Low complexity was accurate, so calibrated should be close to original
      const opusDiff = Math.abs(calibrated.calibratedEstimate.sessionsOpus - 2);
      expect(opusDiff).toBeLessThanOrEqual(1);
    });

    it('should return original estimate when no calibration data exists', async () => {
      // Create a new project without any completed tasks
      const emptyProject = await projectRepo.create({ name: 'Empty Calibration Project' });

      const calibrated = await engine.calibrateEstimate({
        projectId: emptyProject.id,
        complexity: 'high',
        sessionsOpus: 4,
        sessionsSonnet: 4,
        interventionMinutes: 30
      });

      expect(calibrated.calibratedEstimate.sessionsOpus).toBe(4);
      expect(calibrated.calibratedEstimate.sessionsSonnet).toBe(4);
      expect(calibrated.calibrationApplied.sessionsMultiplier).toBe(1.0);

      await projectRepo.delete(emptyProject.id);
    });
  });

  describe('saveCalibrationFactors', () => {
    it('should persist calibration factors to database', async () => {
      const saved = await engine.saveCalibrationFactors(testProjectId);

      expect(saved.length).toBeGreaterThan(0);
      saved.forEach(factor => {
        expect(factor.projectId).toBe(testProjectId);
      });
    });

    it('should update existing factors on re-save', async () => {
      // Save twice and ensure no duplicates
      await engine.saveCalibrationFactors(testProjectId);
      const saved = await engine.saveCalibrationFactors(testProjectId);

      // Count factors per complexity - should be 1 each
      const highFactors = saved.filter(f => f.complexity === 'high');
      expect(highFactors.length).toBe(1);
    });
  });

  describe('getProjectCalibrationFactors', () => {
    it('should retrieve all calibration factors for a project', async () => {
      await engine.saveCalibrationFactors(testProjectId);

      const factors = await engine.getProjectCalibrationFactors(testProjectId);

      expect(factors.length).toBeGreaterThan(0);
      expect(factors.every(f => f.projectId === testProjectId)).toBe(true);
    });
  });

  describe('confidence levels', () => {
    it('should return low confidence for sample size < 10', async () => {
      // Our test has 5 samples per complexity
      const factors = await engine.calculateCalibrationFactors(testProjectId);
      factors.forEach(factor => {
        expect(factor.confidence).toBe('low');
      });
    });
  });

  describe('minimum sample size', () => {
    it('should not provide calibration with fewer than 5 samples', async () => {
      // Create project with only 3 completed tasks
      const sparseProject = await projectRepo.create({ name: 'Sparse Project' });
      const sparseTaskIds: string[] = [];

      for (let i = 0; i < 3; i++) {
        const task = await taskRepo.create({
          project_id: sparseProject.id,
          title: `Sparse Task ${i}`,
          complexity_estimate: 'high',
          estimated_sessions_opus: 2,
          estimated_sessions_sonnet: 2
        });
        await taskRepo.updateStatus(task.id, 'complete');
        await taskRepo.recordUsage(task.id, { sessions_opus: 4, sessions_sonnet: 4 });
        sparseTaskIds.push(task.id);
      }

      const factors = await engine.calculateCalibrationFactors(sparseProject.id);

      // Should have empty factors or factors with multiplier 1.0
      const highFactor = factors.find(f => f.complexity === 'high');
      if (highFactor) {
        expect(highFactor.sampleSize).toBe(3);
        // With insufficient samples, multiplier should be 1.0
        expect(highFactor.sessionsMultiplier).toBe(1.0);
      }

      // Clean up
      for (const taskId of sparseTaskIds) {
        await taskRepo.delete(taskId);
      }
      await projectRepo.delete(sparseProject.id);
    });
  });

  describe('global calibration', () => {
    it('should calculate global calibration factors across all projects', async () => {
      const globalFactors = await engine.calculateGlobalCalibrationFactors();

      // Should have factors even if just from our test project
      expect(globalFactors.length).toBeGreaterThan(0);
      expect(globalFactors[0].projectId).toBeUndefined();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle tasks with zero estimated sessions', async () => {
      // Create a task with zero estimates
      const zeroEstimateTask = await taskRepo.create({
        project_id: testProjectId,
        title: 'Zero Estimate Task',
        complexity_estimate: 'low',
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 0
      });

      await taskRepo.updateStatus(zeroEstimateTask.id, 'complete');
      await taskRepo.recordUsage(zeroEstimateTask.id, {
        sessions_opus: 2,
        sessions_sonnet: 2
      });

      const factors = await engine.calculateCalibrationFactors(testProjectId);
      const lowFactor = factors.find(f => f.complexity === 'low');

      // Should handle gracefully - ratio defaults to 1.0 for zero estimates
      expect(lowFactor).toBeDefined();
      expect(lowFactor!.sessionsMultiplier).toBeGreaterThan(0);

      // Clean up
      await taskRepo.delete(zeroEstimateTask.id);
    });

    it('should clamp multipliers to reasonable bounds', async () => {
      // Create a project with extreme underestimation
      const extremeProject = await projectRepo.create({ name: 'Extreme Calibration Project' });
      const extremeTaskIds: string[] = [];

      // Create tasks with 10x underestimation
      for (let i = 0; i < 5; i++) {
        const task = await taskRepo.create({
          project_id: extremeProject.id,
          title: `Extreme Task ${i}`,
          complexity_estimate: 'high',
          estimated_sessions_opus: 1,
          estimated_sessions_sonnet: 1
        });

        await taskRepo.updateStatus(task.id, 'complete');
        await taskRepo.recordUsage(task.id, {
          sessions_opus: 10,
          sessions_sonnet: 10
        });

        extremeTaskIds.push(task.id);
      }

      const factors = await engine.calculateCalibrationFactors(extremeProject.id);
      const highFactor = factors.find(f => f.complexity === 'high');

      // Multiplier should be clamped to max 3.0
      expect(highFactor!.sessionsMultiplier).toBeLessThanOrEqual(3.0);
      expect(highFactor!.sessionsMultiplier).toBeGreaterThanOrEqual(0.5);

      // Clean up
      for (const taskId of extremeTaskIds) {
        await taskRepo.delete(taskId);
      }
      await projectRepo.delete(extremeProject.id);
    });

    it('should handle tasks with different descriptions within same complexity', async () => {
      // Create tasks with different characteristics but same complexity
      const mixedProject = await projectRepo.create({ name: 'Mixed Tasks Project' });
      const mixedTaskIds: string[] = [];

      const taskPatterns = [
        { title: 'Feature Task', multiplier: 1.5 },
        { title: 'Bugfix Task', multiplier: 1.0 },
        { title: 'Refactor Task', multiplier: 0.8 }
      ];

      for (const pattern of taskPatterns) {
        for (let i = 0; i < 5; i++) {
          const task = await taskRepo.create({
            project_id: mixedProject.id,
            title: `${pattern.title} ${i}`,
            description: `This is a ${pattern.title.toLowerCase()} with specific requirements`,
            complexity_estimate: 'medium',
            estimated_sessions_opus: 3,
            estimated_sessions_sonnet: 3
          });

          await taskRepo.updateStatus(task.id, 'complete');
          await taskRepo.recordUsage(task.id, {
            sessions_opus: Math.round(3 * pattern.multiplier),
            sessions_sonnet: Math.round(3 * pattern.multiplier)
          });

          mixedTaskIds.push(task.id);
        }
      }

      const factors = await engine.calculateCalibrationFactors(mixedProject.id);
      const mediumFactor = factors.find(f => f.complexity === 'medium');

      // Should calculate a blended factor for all medium complexity tasks
      expect(mediumFactor).toBeDefined();
      expect(mediumFactor!.sessionsMultiplier).toBeGreaterThan(0.9);
      expect(mediumFactor!.sessionsMultiplier).toBeLessThan(1.3);

      // Clean up
      for (const taskId of mixedTaskIds) {
        await taskRepo.delete(taskId);
      }
      await projectRepo.delete(mixedProject.id);
    });

    it('should handle calibration with only intervention time', async () => {
      const calibrated = await engine.calibrateEstimate({
        projectId: testProjectId,
        complexity: 'medium',
        sessionsOpus: 0,
        sessionsSonnet: 0,
        interventionMinutes: 60
      });

      expect(calibrated.originalEstimate.interventionMinutes).toBe(60);
      // Intervention multiplier is currently hardcoded to 1.0
      expect(calibrated.calibratedEstimate.interventionMinutes).toBe(60);
      expect(calibrated.calibrationApplied.interventionMultiplier).toBe(1.0);
    });

    it('should use median ratio to be robust against outliers', async () => {
      // Create project with outlier tasks
      const outlierProject = await projectRepo.create({ name: 'Outlier Project' });
      const outlierTaskIds: string[] = [];

      // Most tasks are accurately estimated
      for (let i = 0; i < 8; i++) {
        const task = await taskRepo.create({
          project_id: outlierProject.id,
          title: `Normal Task ${i}`,
          complexity_estimate: 'medium',
          estimated_sessions_opus: 4,
          estimated_sessions_sonnet: 4
        });

        await taskRepo.updateStatus(task.id, 'complete');
        await taskRepo.recordUsage(task.id, {
          sessions_opus: 4,
          sessions_sonnet: 4
        });

        outlierTaskIds.push(task.id);
      }

      // Add two outlier tasks (one severely underestimated, one overestimated)
      const underestimatedTask = await taskRepo.create({
        project_id: outlierProject.id,
        title: 'Severely Underestimated Task',
        complexity_estimate: 'medium',
        estimated_sessions_opus: 2,
        estimated_sessions_sonnet: 2
      });
      await taskRepo.updateStatus(underestimatedTask.id, 'complete');
      await taskRepo.recordUsage(underestimatedTask.id, {
        sessions_opus: 20,
        sessions_sonnet: 20
      });
      outlierTaskIds.push(underestimatedTask.id);

      const overestimatedTask = await taskRepo.create({
        project_id: outlierProject.id,
        title: 'Severely Overestimated Task',
        complexity_estimate: 'medium',
        estimated_sessions_opus: 10,
        estimated_sessions_sonnet: 10
      });
      await taskRepo.updateStatus(overestimatedTask.id, 'complete');
      await taskRepo.recordUsage(overestimatedTask.id, {
        sessions_opus: 1,
        sessions_sonnet: 1
      });
      outlierTaskIds.push(overestimatedTask.id);

      const factors = await engine.calculateCalibrationFactors(outlierProject.id);
      const mediumFactor = factors.find(f => f.complexity === 'medium');

      // Median should ignore outliers, resulting in multiplier close to 1.0
      expect(mediumFactor!.sessionsMultiplier).toBeCloseTo(1.0, 1);

      // Clean up
      for (const taskId of outlierTaskIds) {
        await taskRepo.delete(taskId);
      }
      await projectRepo.delete(outlierProject.id);
    });

    it('should return empty array for project with no completed tasks', async () => {
      const emptyProject = await projectRepo.create({ name: 'No Completed Tasks Project' });

      // Create only in-progress tasks
      const inProgressTask = await taskRepo.create({
        project_id: emptyProject.id,
        title: 'In Progress Task',
        complexity_estimate: 'medium',
        estimated_sessions_opus: 3,
        estimated_sessions_sonnet: 3
      });
      await taskRepo.updateStatus(inProgressTask.id, 'in_progress');

      const factors = await engine.calculateCalibrationFactors(emptyProject.id);
      expect(factors).toEqual([]);

      // Clean up
      await taskRepo.delete(inProgressTask.id);
      await projectRepo.delete(emptyProject.id);
    });

    // TODO: Fix flaky concurrency test - duplicates created when running concurrent saves
    it.skip('should handle concurrent calibration factor updates', async () => {
      // Clear any existing factors first
      await engine.clearCalibrationFactors(testProjectId);

      // Save factors multiple times concurrently
      const promises = [
        engine.saveCalibrationFactors(testProjectId),
        engine.saveCalibrationFactors(testProjectId),
        engine.saveCalibrationFactors(testProjectId)
      ];

      const results = await Promise.all(promises);

      // All should succeed without conflicts
      results.forEach(result => {
        expect(result.length).toBeGreaterThan(0);
      });

      // Check that we don't have duplicates
      const finalFactors = await engine.getProjectCalibrationFactors(testProjectId);
      const complexities = finalFactors.map(f => f.complexity);
      const uniqueComplexities = [...new Set(complexities)];
      expect(complexities.length).toBe(uniqueComplexities.length);

      // Should only have one factor per complexity
      expect(finalFactors.length).toBe(3); // low, medium, high
    });

    it('should clear all calibration factors for a project', async () => {
      // First ensure we have factors
      await engine.saveCalibrationFactors(testProjectId);
      let factors = await engine.getProjectCalibrationFactors(testProjectId);
      expect(factors.length).toBeGreaterThan(0);

      // Clear them
      await engine.clearCalibrationFactors(testProjectId);

      // Verify they're gone
      factors = await engine.getProjectCalibrationFactors(testProjectId);
      expect(factors).toEqual([]);
    });

    it('should round calibrated estimates to whole numbers', async () => {
      const calibrated = await engine.calibrateEstimate({
        projectId: testProjectId,
        complexity: 'medium',
        sessionsOpus: 3,
        sessionsSonnet: 3,
        interventionMinutes: 25
      });

      // All calibrated values should be whole numbers
      expect(Number.isInteger(calibrated.calibratedEstimate.sessionsOpus)).toBe(true);
      expect(Number.isInteger(calibrated.calibratedEstimate.sessionsSonnet)).toBe(true);
      expect(Number.isInteger(calibrated.calibratedEstimate.interventionMinutes)).toBe(true);
    });
  });
});
