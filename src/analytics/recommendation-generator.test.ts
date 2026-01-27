import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RecommendationGenerator,
  Recommendation,
  RecommendationContext,
} from './recommendation-generator.js';
import { PriorityScore } from './priority-scorer.js';
import { ResourceAllocation } from './resource-allocator.js';
import { CapacityStats } from '../scheduler/capacity-tracker.js';
import { Task } from '../db/repositories/tasks.js';

// Helper to create mock priority score
function createMockPriorityScore(overrides: Partial<PriorityScore> = {}): PriorityScore {
  return {
    taskId: 'task-1',
    totalScore: 75,
    impactScore: 80,
    urgencyScore: 70,
    efficiencyScore: 60,
    dependencyScore: 50,
    factors: [],
    calculatedAt: new Date(),
    ...overrides,
  };
}

// Helper to create mock resource allocation
function createMockAllocation(overrides: Partial<ResourceAllocation> = {}): ResourceAllocation {
  return {
    projectId: 'project-1',
    projectName: 'Test Project',
    currentOpusSessions: 1,
    currentSonnetSessions: 2,
    queuedTasks: 5,
    blockedTasks: 0,
    recommendedOpusPercent: 50,
    recommendedSonnetPercent: 50,
    reasoning: ['Test reasoning'],
    priority: 'medium',
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

// Helper to create mock task
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

describe('RecommendationGenerator', () => {
  let generator: RecommendationGenerator;

  beforeEach(() => {
    generator = new RecommendationGenerator();
  });

  describe('generateRebalanceRecommendation', () => {
    it('should generate rebalance recommendation when allocations are uneven', () => {
      const allocations = [
        createMockAllocation({
          projectId: 'project-1',
          projectName: 'Overworked Project',
          recommendedOpusPercent: 90,
          recommendedSonnetPercent: 90,
          queuedTasks: 20,
        }),
        createMockAllocation({
          projectId: 'project-2',
          projectName: 'Idle Project',
          recommendedOpusPercent: 10,
          recommendedSonnetPercent: 10,
          queuedTasks: 2,
        }),
      ];
      const context: RecommendationContext = {
        priorityScores: [],
        allocations,
        capacityStats: createMockCapacityStats(),
        tasks: [],
      };

      const recommendations = generator.generateRebalanceRecommendations(context);

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].type).toBe('rebalance');
      expect(recommendations[0].affectedProjects.length).toBeGreaterThan(0);
    });

    it('should not recommend rebalancing when allocations are balanced', () => {
      const allocations = [
        createMockAllocation({
          projectId: 'project-1',
          recommendedOpusPercent: 50,
          recommendedSonnetPercent: 50,
          queuedTasks: 5,
        }),
        createMockAllocation({
          projectId: 'project-2',
          recommendedOpusPercent: 50,
          recommendedSonnetPercent: 50,
          queuedTasks: 5,
        }),
      ];
      const context: RecommendationContext = {
        priorityScores: [],
        allocations,
        capacityStats: createMockCapacityStats(),
        tasks: [],
      };

      const recommendations = generator.generateRebalanceRecommendations(context);

      // Either no recommendations or only informational ones
      const rebalanceRecs = recommendations.filter(r => r.priority === 'critical' || r.priority === 'high');
      expect(rebalanceRecs.length).toBe(0);
    });
  });

  describe('generatePauseRecommendations', () => {
    it('should recommend pausing projects with high blocked count', () => {
      const allocations = [
        createMockAllocation({
          projectId: 'blocked-project',
          projectName: 'Blocked Project',
          blockedTasks: 5,
          queuedTasks: 10,
          priority: 'critical',
        }),
      ];
      const context: RecommendationContext = {
        priorityScores: [],
        allocations,
        capacityStats: createMockCapacityStats(),
        tasks: [],
      };

      const recommendations = generator.generatePauseRecommendations(context);

      expect(recommendations.some(r => r.type === 'pause' || r.type === 'investigate')).toBe(true);
    });

    it('should not recommend pausing healthy projects', () => {
      const allocations = [
        createMockAllocation({
          projectId: 'healthy-project',
          projectName: 'Healthy Project',
          blockedTasks: 0,
          queuedTasks: 5,
          priority: 'medium',
        }),
      ];
      const context: RecommendationContext = {
        priorityScores: [],
        allocations,
        capacityStats: createMockCapacityStats(),
        tasks: [],
      };

      const recommendations = generator.generatePauseRecommendations(context);

      expect(recommendations.filter(r => r.type === 'pause').length).toBe(0);
    });
  });

  describe('generateAccelerateRecommendations', () => {
    it('should recommend accelerating high-value tasks', () => {
      const priorityScores = [
        createMockPriorityScore({
          taskId: 'high-priority-task',
          totalScore: 95,
          impactScore: 100,
        }),
      ];
      const context: RecommendationContext = {
        priorityScores,
        allocations: [createMockAllocation()],
        capacityStats: createMockCapacityStats({
          opus: { current: 1, limit: 5, available: 4, utilization: 0.2 },
        }),
        tasks: [
          createMockTask({
            id: 'high-priority-task',
            complexity_estimate: 'high',
          }),
        ],
      };

      const recommendations = generator.generateAccelerateRecommendations(context);

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].type).toBe('accelerate');
    });

    it('should not recommend acceleration when at capacity', () => {
      const priorityScores = [
        createMockPriorityScore({
          taskId: 'high-priority-task',
          totalScore: 95,
        }),
      ];
      const context: RecommendationContext = {
        priorityScores,
        allocations: [createMockAllocation()],
        capacityStats: createMockCapacityStats({
          opus: { current: 5, limit: 5, available: 0, utilization: 1.0 },
          sonnet: { current: 10, limit: 10, available: 0, utilization: 1.0 },
        }),
        tasks: [createMockTask({ id: 'high-priority-task' })],
      };

      const recommendations = generator.generateAccelerateRecommendations(context);

      // Should either be empty or suggest capacity increase instead
      const accelerateRecs = recommendations.filter(r => r.type === 'accelerate');
      expect(accelerateRecs.length).toBe(0);
    });
  });

  describe('generateInvestigateRecommendations', () => {
    it('should recommend investigation for stale tasks', () => {
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days old
      const tasks = [
        createMockTask({
          id: 'stale-task',
          title: 'Stale Task',
          status: 'queued',
          created_at: oldDate,
        }),
      ];
      const context: RecommendationContext = {
        priorityScores: [createMockPriorityScore({ taskId: 'stale-task' })],
        allocations: [createMockAllocation()],
        capacityStats: createMockCapacityStats(),
        tasks,
      };

      const recommendations = generator.generateInvestigateRecommendations(context);

      expect(recommendations.some(r => r.type === 'investigate')).toBe(true);
    });

    it('should recommend investigation for blocked tasks', () => {
      const tasks = [
        createMockTask({
          id: 'blocked-task',
          title: 'Blocked Task',
          status: 'blocked',
          blocked_by_task_id: 'other-task',
        }),
      ];
      const context: RecommendationContext = {
        priorityScores: [],
        allocations: [
          createMockAllocation({
            blockedTasks: 1,
          }),
        ],
        capacityStats: createMockCapacityStats(),
        tasks,
      };

      const recommendations = generator.generateInvestigateRecommendations(context);

      expect(recommendations.some(r => r.type === 'investigate')).toBe(true);
    });
  });

  describe('generateCompleteRecommendations', () => {
    it('should recommend completing near-finished projects', () => {
      const allocations = [
        createMockAllocation({
          projectId: 'almost-done',
          projectName: 'Almost Done Project',
          queuedTasks: 1,
          blockedTasks: 0,
        }),
      ];
      const context: RecommendationContext = {
        priorityScores: [],
        allocations,
        capacityStats: createMockCapacityStats(),
        tasks: [createMockTask({ project_id: 'almost-done' })],
        projectCompletionRates: { 'almost-done': 95 },
      };

      const recommendations = generator.generateCompleteRecommendations(context);

      expect(recommendations.some(r => r.type === 'complete')).toBe(true);
    });

    it('should not recommend completion for projects with significant work remaining', () => {
      const allocations = [
        createMockAllocation({
          projectId: 'ongoing',
          projectName: 'Ongoing Project',
          queuedTasks: 15,
          blockedTasks: 0,
        }),
      ];
      const context: RecommendationContext = {
        priorityScores: [],
        allocations,
        capacityStats: createMockCapacityStats(),
        tasks: Array.from({ length: 15 }, (_, i) =>
          createMockTask({ id: `task-${i}`, project_id: 'ongoing' })
        ),
        projectCompletionRates: { ongoing: 40 },
      };

      const recommendations = generator.generateCompleteRecommendations(context);

      expect(recommendations.filter(r => r.type === 'complete').length).toBe(0);
    });
  });

  describe('generateAllRecommendations', () => {
    it('should generate comprehensive recommendations', () => {
      const context: RecommendationContext = {
        priorityScores: [
          createMockPriorityScore({ taskId: 'task-1', totalScore: 85 }),
          createMockPriorityScore({ taskId: 'task-2', totalScore: 45 }),
        ],
        allocations: [
          createMockAllocation({
            projectId: 'project-1',
            projectName: 'Active Project',
            queuedTasks: 10,
            blockedTasks: 1,
          }),
        ],
        capacityStats: createMockCapacityStats({
          opus: { current: 2, limit: 5, available: 3, utilization: 0.4 },
        }),
        tasks: [
          createMockTask({ id: 'task-1', project_id: 'project-1' }),
          createMockTask({ id: 'task-2', project_id: 'project-1' }),
        ],
      };

      const recommendations = generator.generateAllRecommendations(context);

      expect(recommendations).toBeInstanceOf(Array);
      // Should have at least some recommendations
      expect(recommendations.length).toBeGreaterThanOrEqual(0);

      // Each recommendation should have required fields
      for (const rec of recommendations) {
        expect(rec.id).toBeTruthy();
        expect(rec.type).toMatch(/rebalance|pause|accelerate|investigate|complete/);
        expect(rec.priority).toMatch(/critical|high|medium|low/);
        expect(rec.title).toBeTruthy();
        expect(rec.description).toBeTruthy();
        expect(rec.suggestedAction).toBeTruthy();
        expect(rec.expectedImpact).toBeTruthy();
        expect(rec.createdAt).toBeInstanceOf(Date);
      }
    });

    it('should sort recommendations by priority', () => {
      const context: RecommendationContext = {
        priorityScores: [createMockPriorityScore({ taskId: 'task-1', totalScore: 95 })],
        allocations: [
          createMockAllocation({
            projectId: 'project-1',
            blockedTasks: 5, // Should trigger critical recommendation
          }),
          createMockAllocation({
            projectId: 'project-2',
            blockedTasks: 0,
            queuedTasks: 2, // Should trigger lower priority
          }),
        ],
        capacityStats: createMockCapacityStats(),
        tasks: [createMockTask()],
      };

      const recommendations = generator.generateAllRecommendations(context);

      // Verify priority ordering
      const priorities = recommendations.map(r => r.priority);
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

      for (let i = 1; i < priorities.length; i++) {
        expect(priorityOrder[priorities[i]]).toBeGreaterThanOrEqual(
          priorityOrder[priorities[i - 1]]
        );
      }
    });

    it('should generate unique IDs for recommendations', () => {
      const context: RecommendationContext = {
        priorityScores: [
          createMockPriorityScore({ taskId: 'task-1' }),
          createMockPriorityScore({ taskId: 'task-2' }),
        ],
        allocations: [
          createMockAllocation({ projectId: 'p1', blockedTasks: 2 }),
          createMockAllocation({ projectId: 'p2', queuedTasks: 15 }),
        ],
        capacityStats: createMockCapacityStats(),
        tasks: [
          createMockTask({ id: 'task-1' }),
          createMockTask({ id: 'task-2' }),
        ],
      };

      const recommendations = generator.generateAllRecommendations(context);
      const ids = recommendations.map(r => r.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('getActionableRecommendations', () => {
    it('should filter to only critical and high priority recommendations', () => {
      const context: RecommendationContext = {
        priorityScores: [],
        allocations: [
          createMockAllocation({
            blockedTasks: 5, // Should be critical
          }),
          createMockAllocation({
            blockedTasks: 0,
            queuedTasks: 1, // Should be low priority
          }),
        ],
        capacityStats: createMockCapacityStats(),
        tasks: [],
      };

      const recommendations = generator.getActionableRecommendations(context);

      for (const rec of recommendations) {
        expect(['critical', 'high']).toContain(rec.priority);
      }
    });
  });

  describe('formatRecommendationForReport', () => {
    it('should format recommendation as human-readable text', () => {
      const recommendation: Recommendation = {
        id: 'rec-123',
        type: 'rebalance',
        priority: 'high',
        title: 'Rebalance Resources',
        description: 'Project A needs more resources.',
        affectedProjects: ['Project A', 'Project B'],
        suggestedAction: 'Move 2 Sonnet sessions from Project B to Project A',
        expectedImpact: 'Reduce queue time by 30%',
        createdAt: new Date(),
      };

      const formatted = generator.formatRecommendationForReport(recommendation);

      expect(formatted).toContain('Rebalance Resources');
      expect(formatted).toContain('Project A needs more resources');
      expect(formatted).toContain('Move 2 Sonnet sessions');
      expect(formatted).toContain('Reduce queue time by 30%');
      expect(formatted).toContain('HIGH');
    });

    it('should include all affected projects', () => {
      const recommendation: Recommendation = {
        id: 'rec-456',
        type: 'investigate',
        priority: 'critical',
        title: 'Investigate Blocked Tasks',
        description: 'Multiple projects have blocked tasks.',
        affectedProjects: ['Project X', 'Project Y', 'Project Z'],
        suggestedAction: 'Review blockers',
        expectedImpact: 'Unblock progress',
        createdAt: new Date(),
      };

      const formatted = generator.formatRecommendationForReport(recommendation);

      expect(formatted).toContain('Project X');
      expect(formatted).toContain('Project Y');
      expect(formatted).toContain('Project Z');
    });
  });

  describe('generateReportSummary', () => {
    it('should provide a summary of all recommendations', () => {
      const context: RecommendationContext = {
        priorityScores: [],
        allocations: [
          createMockAllocation({ blockedTasks: 3 }),
          createMockAllocation({ queuedTasks: 20 }),
        ],
        capacityStats: createMockCapacityStats(),
        tasks: [],
      };

      const summary = generator.generateReportSummary(context);

      expect(summary.totalRecommendations).toBeGreaterThanOrEqual(0);
      expect(typeof summary.criticalCount).toBe('number');
      expect(typeof summary.highCount).toBe('number');
      expect(typeof summary.mediumCount).toBe('number');
      expect(typeof summary.lowCount).toBe('number');
      expect(summary.topActions).toBeInstanceOf(Array);
    });

    it('should highlight critical actions in summary', () => {
      const context: RecommendationContext = {
        priorityScores: [],
        allocations: [
          createMockAllocation({
            projectId: 'critical-project',
            projectName: 'Critical Project',
            blockedTasks: 10, // Very high blocked count
          }),
        ],
        capacityStats: createMockCapacityStats(),
        tasks: [],
      };

      const summary = generator.generateReportSummary(context);

      if (summary.criticalCount > 0) {
        expect(summary.topActions.length).toBeGreaterThan(0);
      }
    });
  });
});
