import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PriorityScorer, PriorityScore, PriorityFactor, ScoringConfig } from './priority-scorer.js';
import { Task } from '../db/repositories/tasks.js';
import { CapacityStats } from '../scheduler/capacity-tracker.js';

// Helper to create a mock task
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    project_id: 'project-1',
    title: 'Test Task',
    description: 'A test task',
    status: 'queued',
    priority: 5,
    complexity_estimate: 'medium',
    estimated_sessions_opus: 1,
    estimated_sessions_sonnet: 2,
    actual_tokens_opus: 0,
    actual_tokens_sonnet: 0,
    actual_sessions_opus: 0,
    actual_sessions_sonnet: 0,
    assigned_agent_id: null,
    requires_visual_review: false,
    parent_task_id: null,
    tags: [],
    acceptance_criteria: null,
    source: 'user',
    blocked_by_task_id: null,
    eta: null,
    started_at: null,
    completed_at: null,
    priority_confirmed: false,
    priority_confirmed_at: null,
    priority_confirmed_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create mock capacity stats
function createMockCapacityStats(overrides: Partial<CapacityStats> = {}): CapacityStats {
  return {
    opus: {
      current: 2,
      limit: 5,
      available: 3,
      utilization: 0.4,
    },
    sonnet: {
      current: 5,
      limit: 10,
      available: 5,
      utilization: 0.5,
    },
    ...overrides,
  };
}

describe('PriorityScorer', () => {
  let scorer: PriorityScorer;

  beforeEach(() => {
    scorer = new PriorityScorer();
  });

  describe('constructor', () => {
    it('should use default weights', () => {
      const config = scorer.getConfig();
      expect(config.impactWeight).toBe(0.40);
      expect(config.urgencyWeight).toBe(0.25);
      expect(config.efficiencyWeight).toBe(0.20);
      expect(config.dependencyWeight).toBe(0.15);
    });

    it('should accept custom weights', () => {
      const customConfig: ScoringConfig = {
        impactWeight: 0.50,
        urgencyWeight: 0.20,
        efficiencyWeight: 0.15,
        dependencyWeight: 0.15,
      };
      const customScorer = new PriorityScorer(customConfig);
      const config = customScorer.getConfig();
      expect(config.impactWeight).toBe(0.50);
      expect(config.urgencyWeight).toBe(0.20);
    });
  });

  describe('calculateImpactScore', () => {
    it('should return 100 for high complexity tasks', () => {
      const task = createMockTask({ complexity_estimate: 'high' });
      const score = scorer.calculateImpactScore(task);
      expect(score).toBe(100);
    });

    it('should return 60 for medium complexity tasks', () => {
      const task = createMockTask({ complexity_estimate: 'medium' });
      const score = scorer.calculateImpactScore(task);
      expect(score).toBe(60);
    });

    it('should return 30 for low complexity tasks', () => {
      const task = createMockTask({ complexity_estimate: 'low' });
      const score = scorer.calculateImpactScore(task);
      expect(score).toBe(30);
    });

    it('should return 60 for tasks with no complexity estimate', () => {
      const task = createMockTask({ complexity_estimate: null });
      const score = scorer.calculateImpactScore(task);
      expect(score).toBe(60);
    });
  });

  describe('calculateUrgencyScore', () => {
    it('should return higher score for older tasks', () => {
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ago
      const newDate = new Date().toISOString();

      const oldTask = createMockTask({ created_at: oldDate });
      const newTask = createMockTask({ created_at: newDate });

      const oldScore = scorer.calculateUrgencyScore(oldTask);
      const newScore = scorer.calculateUrgencyScore(newTask);

      expect(oldScore).toBeGreaterThan(newScore);
    });

    it('should factor in task priority', () => {
      const highPriorityTask = createMockTask({ priority: 10 });
      const lowPriorityTask = createMockTask({ priority: 1 });

      const highScore = scorer.calculateUrgencyScore(highPriorityTask);
      const lowScore = scorer.calculateUrgencyScore(lowPriorityTask);

      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('should cap urgency score at 100', () => {
      const veryOldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const task = createMockTask({ created_at: veryOldDate, priority: 10 });
      const score = scorer.calculateUrgencyScore(task);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateEfficiencyScore', () => {
    it('should return higher score for tasks with accurate historical estimates', () => {
      // High accuracy tasks should score high
      const accurateHistory = [
        { estimated: 2, actual: 2 },
        { estimated: 3, actual: 3 },
      ];
      const inaccurateHistory = [
        { estimated: 2, actual: 5 },
        { estimated: 3, actual: 8 },
      ];

      const accurateScore = scorer.calculateEfficiencyScore(createMockTask(), accurateHistory);
      const inaccurateScore = scorer.calculateEfficiencyScore(createMockTask(), inaccurateHistory);

      expect(accurateScore).toBeGreaterThan(inaccurateScore);
    });

    it('should return default score when no history available', () => {
      const score = scorer.calculateEfficiencyScore(createMockTask(), []);
      expect(score).toBe(50); // Default middle score
    });
  });

  describe('calculateDependencyScore', () => {
    it('should return higher score for tasks blocking other work', () => {
      const blockingTask = createMockTask({ id: 'blocker-task' });
      const blockedTasks = [
        createMockTask({ blocked_by_task_id: 'blocker-task' }),
        createMockTask({ blocked_by_task_id: 'blocker-task' }),
        createMockTask({ blocked_by_task_id: 'blocker-task' }),
      ];
      const nonBlockingTask = createMockTask({ id: 'regular-task' });

      const blockingScore = scorer.calculateDependencyScore(blockingTask, blockedTasks);
      const nonBlockingScore = scorer.calculateDependencyScore(nonBlockingTask, []);

      expect(blockingScore).toBeGreaterThan(nonBlockingScore);
    });

    it('should return 0 for tasks not blocking anything', () => {
      const task = createMockTask();
      const score = scorer.calculateDependencyScore(task, []);
      expect(score).toBe(0);
    });

    it('should cap dependency score at 100', () => {
      const blockingTask = createMockTask({ id: 'mega-blocker' });
      const manyBlockedTasks = Array.from({ length: 50 }, (_, i) =>
        createMockTask({ id: `blocked-${i}`, blocked_by_task_id: 'mega-blocker' })
      );

      const score = scorer.calculateDependencyScore(blockingTask, manyBlockedTasks);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('calculatePriorityScore', () => {
    it('should calculate weighted total score', () => {
      const task = createMockTask({ complexity_estimate: 'high', priority: 8 });
      const context = {
        allTasks: [task],
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats(),
        projectBacklogSize: 5,
      };

      const result = scorer.calculatePriorityScore(task, context);

      expect(result.taskId).toBe(task.id);
      expect(result.totalScore).toBeGreaterThan(0);
      expect(result.totalScore).toBeLessThanOrEqual(100);
      expect(result.impactScore).toBe(100); // High complexity
      expect(result.factors).toHaveLength(4);
      expect(result.calculatedAt).toBeInstanceOf(Date);
    });

    it('should include all factor breakdowns', () => {
      const task = createMockTask();
      const context = {
        allTasks: [task],
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats(),
        projectBacklogSize: 5,
      };

      const result = scorer.calculatePriorityScore(task, context);

      const factorNames = result.factors.map(f => f.name);
      expect(factorNames).toContain('impact');
      expect(factorNames).toContain('urgency');
      expect(factorNames).toContain('efficiency');
      expect(factorNames).toContain('dependency');

      for (const factor of result.factors) {
        expect(factor.weight).toBeGreaterThan(0);
        expect(factor.rawValue).toBeGreaterThanOrEqual(0);
        expect(factor.normalizedValue).toBeGreaterThanOrEqual(0);
        expect(factor.normalizedValue).toBeLessThanOrEqual(100);
        expect(factor.explanation).toBeTruthy();
      }
    });
  });

  describe('applyAdjustments', () => {
    it('should add +20 for low backlog projects', () => {
      const task = createMockTask();
      const baseScore = 50;
      const context = {
        allTasks: [task],
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats(),
        projectBacklogSize: 2, // Low backlog
      };

      const adjustedScore = scorer.applyAdjustments(baseScore, task, context);
      expect(adjustedScore).toBe(70); // 50 + 20
    });

    it('should add +10 for underutilized project', () => {
      const task = createMockTask();
      const baseScore = 50;
      const context = {
        allTasks: [task],
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats({
          opus: { current: 0, limit: 5, available: 5, utilization: 0 },
          sonnet: { current: 1, limit: 10, available: 9, utilization: 0.1 },
        }),
        projectBacklogSize: 10,
        isUnderutilizedProject: true,
      };

      const adjustedScore = scorer.applyAdjustments(baseScore, task, context);
      expect(adjustedScore).toBe(60); // 50 + 10
    });

    it('should subtract -10 for complex tasks when Opus is at capacity', () => {
      const task = createMockTask({ complexity_estimate: 'high' });
      const baseScore = 50;
      const context = {
        allTasks: [task],
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats({
          opus: { current: 5, limit: 5, available: 0, utilization: 1.0 },
        }),
        projectBacklogSize: 10,
      };

      const adjustedScore = scorer.applyAdjustments(baseScore, task, context);
      expect(adjustedScore).toBe(40); // 50 - 10
    });

    it('should cap adjusted score at 100', () => {
      const task = createMockTask();
      const baseScore = 95;
      const context = {
        allTasks: [task],
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats(),
        projectBacklogSize: 1, // Very low backlog, +20
        isUnderutilizedProject: true, // +10
      };

      const adjustedScore = scorer.applyAdjustments(baseScore, task, context);
      expect(adjustedScore).toBe(100); // Capped at 100
    });

    it('should not go below 0', () => {
      const task = createMockTask({ complexity_estimate: 'high' });
      const baseScore = 5;
      const context = {
        allTasks: [task],
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats({
          opus: { current: 5, limit: 5, available: 0, utilization: 1.0 },
        }),
        projectBacklogSize: 20,
      };

      const adjustedScore = scorer.applyAdjustments(baseScore, task, context);
      expect(adjustedScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('scoreTasks', () => {
    it('should score and sort multiple tasks by priority', () => {
      const highPriorityTask = createMockTask({
        id: 'high',
        complexity_estimate: 'high',
        priority: 10,
      });
      const lowPriorityTask = createMockTask({
        id: 'low',
        complexity_estimate: 'low',
        priority: 1,
      });
      const mediumPriorityTask = createMockTask({
        id: 'medium',
        complexity_estimate: 'medium',
        priority: 5,
      });

      const tasks = [lowPriorityTask, highPriorityTask, mediumPriorityTask];
      const context = {
        allTasks: tasks,
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats(),
        projectBacklogSize: 5,
      };

      const scores = scorer.scoreTasks(tasks, context);

      expect(scores).toHaveLength(3);
      // Should be sorted by score descending
      expect(scores[0].totalScore).toBeGreaterThanOrEqual(scores[1].totalScore);
      expect(scores[1].totalScore).toBeGreaterThanOrEqual(scores[2].totalScore);
    });

    it('should handle empty task list', () => {
      const context = {
        allTasks: [],
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats(),
        projectBacklogSize: 0,
      };

      const scores = scorer.scoreTasks([], context);
      expect(scores).toHaveLength(0);
    });
  });

  describe('getTopPriorityTasks', () => {
    it('should return top N tasks by score', () => {
      const tasks = Array.from({ length: 10 }, (_, i) =>
        createMockTask({
          id: `task-${i}`,
          priority: i,
          complexity_estimate: i > 7 ? 'high' : i > 4 ? 'medium' : 'low',
        })
      );

      const context = {
        allTasks: tasks,
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats(),
        projectBacklogSize: 10,
      };

      const topTasks = scorer.getTopPriorityTasks(tasks, context, 3);

      expect(topTasks).toHaveLength(3);
      // Verify they are the highest scoring tasks
      expect(topTasks[0].totalScore).toBeGreaterThanOrEqual(topTasks[1].totalScore);
      expect(topTasks[1].totalScore).toBeGreaterThanOrEqual(topTasks[2].totalScore);
    });

    it('should return all tasks if N exceeds task count', () => {
      const tasks = [createMockTask({ id: 'task-1' }), createMockTask({ id: 'task-2' })];
      const context = {
        allTasks: tasks,
        historicalAccuracy: [],
        capacityStats: createMockCapacityStats(),
        projectBacklogSize: 2,
      };

      const topTasks = scorer.getTopPriorityTasks(tasks, context, 10);
      expect(topTasks).toHaveLength(2);
    });
  });
});
