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
});
