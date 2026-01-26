import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceAllocator, ResourceAllocation, AllocationContext, ProjectStats } from './resource-allocator.js';
import { CapacityStats } from '../scheduler/capacity-tracker.js';

// Helper to create mock project stats
function createMockProjectStats(overrides: Partial<ProjectStats> = {}): ProjectStats {
  return {
    projectId: 'project-1',
    projectName: 'Test Project',
    currentOpusSessions: 1,
    currentSonnetSessions: 2,
    queuedTasks: 5,
    blockedTasks: 0,
    inProgressTasks: 2,
    completedToday: 3,
    completedThisWeek: 10,
    avgTaskDuration: 30, // minutes
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

describe('ResourceAllocator', () => {
  let allocator: ResourceAllocator;

  beforeEach(() => {
    allocator = new ResourceAllocator();
  });

  describe('calculateProjectAllocation', () => {
    it('should allocate resources based on queued tasks', () => {
      const projectStats = createMockProjectStats({
        queuedTasks: 10,
        blockedTasks: 0,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [projectStats],
        totalQueuedTasks: 10,
      };

      const allocation = allocator.calculateProjectAllocation(projectStats, context);

      expect(allocation.projectId).toBe(projectStats.projectId);
      expect(allocation.projectName).toBe(projectStats.projectName);
      expect(allocation.recommendedOpusPercent).toBeGreaterThanOrEqual(0);
      expect(allocation.recommendedOpusPercent).toBeLessThanOrEqual(100);
      expect(allocation.recommendedSonnetPercent).toBeGreaterThanOrEqual(0);
      expect(allocation.recommendedSonnetPercent).toBeLessThanOrEqual(100);
      expect(allocation.reasoning).toBeInstanceOf(Array);
      expect(allocation.reasoning.length).toBeGreaterThan(0);
    });

    it('should prioritize projects with blocked tasks as critical', () => {
      const projectWithBlocked = createMockProjectStats({
        projectId: 'blocked-project',
        blockedTasks: 3,
        queuedTasks: 5,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [projectWithBlocked],
        totalQueuedTasks: 5,
      };

      const allocation = allocator.calculateProjectAllocation(projectWithBlocked, context);

      expect(allocation.priority).toBe('critical');
      expect(allocation.reasoning.some(r => r.toLowerCase().includes('blocked'))).toBe(true);
    });

    it('should mark projects with high queue as high priority', () => {
      const highQueueProject = createMockProjectStats({
        queuedTasks: 20,
        blockedTasks: 0,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [highQueueProject],
        totalQueuedTasks: 20,
      };

      const allocation = allocator.calculateProjectAllocation(highQueueProject, context);

      expect(['critical', 'high']).toContain(allocation.priority);
    });

    it('should mark low activity projects as low priority', () => {
      const lowActivityProject = createMockProjectStats({
        queuedTasks: 1,
        inProgressTasks: 0,
        blockedTasks: 0,
        completedToday: 0,
        completedThisWeek: 1,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [lowActivityProject],
        totalQueuedTasks: 1,
      };

      const allocation = allocator.calculateProjectAllocation(lowActivityProject, context);

      expect(allocation.priority).toBe('low');
    });
  });

  describe('distributeResources', () => {
    it('should distribute resources fairly across multiple projects', () => {
      const project1 = createMockProjectStats({
        projectId: 'project-1',
        projectName: 'Project 1',
        queuedTasks: 10,
      });
      const project2 = createMockProjectStats({
        projectId: 'project-2',
        projectName: 'Project 2',
        queuedTasks: 10,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [project1, project2],
        totalQueuedTasks: 20,
      };

      const allocations = allocator.distributeResources(context);

      expect(allocations).toHaveLength(2);

      // Total percentages should sum to approximately 100%
      const totalOpus = allocations.reduce((sum, a) => sum + a.recommendedOpusPercent, 0);
      const totalSonnet = allocations.reduce((sum, a) => sum + a.recommendedSonnetPercent, 0);

      expect(totalOpus).toBeCloseTo(100, -1); // Within 10%
      expect(totalSonnet).toBeCloseTo(100, -1);
    });

    it('should allocate more to projects with more queued tasks', () => {
      const busyProject = createMockProjectStats({
        projectId: 'busy',
        projectName: 'Busy Project',
        queuedTasks: 30,
      });
      const idleProject = createMockProjectStats({
        projectId: 'idle',
        projectName: 'Idle Project',
        queuedTasks: 5,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [busyProject, idleProject],
        totalQueuedTasks: 35,
      };

      const allocations = allocator.distributeResources(context);
      const busyAllocation = allocations.find(a => a.projectId === 'busy')!;
      const idleAllocation = allocations.find(a => a.projectId === 'idle')!;

      expect(busyAllocation.recommendedSonnetPercent).toBeGreaterThan(
        idleAllocation.recommendedSonnetPercent
      );
    });

    it('should handle single project allocation', () => {
      const singleProject = createMockProjectStats({
        queuedTasks: 15,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [singleProject],
        totalQueuedTasks: 15,
      };

      const allocations = allocator.distributeResources(context);

      expect(allocations).toHaveLength(1);
      expect(allocations[0].recommendedOpusPercent).toBe(100);
      expect(allocations[0].recommendedSonnetPercent).toBe(100);
    });

    it('should handle no projects gracefully', () => {
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [],
        totalQueuedTasks: 0,
      };

      const allocations = allocator.distributeResources(context);
      expect(allocations).toHaveLength(0);
    });
  });

  describe('getPriorityOrder', () => {
    it('should return projects sorted by priority', () => {
      const criticalProject = createMockProjectStats({
        projectId: 'critical',
        projectName: 'Critical Project',
        blockedTasks: 5,
        queuedTasks: 10,
      });
      const highProject = createMockProjectStats({
        projectId: 'high',
        projectName: 'High Project',
        blockedTasks: 0,
        queuedTasks: 20,
      });
      const lowProject = createMockProjectStats({
        projectId: 'low',
        projectName: 'Low Project',
        queuedTasks: 2,
        completedToday: 0,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [lowProject, criticalProject, highProject],
        totalQueuedTasks: 32,
      };

      const ordered = allocator.getPriorityOrder(context);

      expect(ordered[0].projectId).toBe('critical');
      expect(ordered[ordered.length - 1].projectId).toBe('low');
    });

    it('should order by recommended allocation within same priority', () => {
      const project1 = createMockProjectStats({
        projectId: 'project-1',
        queuedTasks: 15,
        blockedTasks: 0,
      });
      const project2 = createMockProjectStats({
        projectId: 'project-2',
        queuedTasks: 8,
        blockedTasks: 0,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [project2, project1],
        totalQueuedTasks: 23,
      };

      const ordered = allocator.getPriorityOrder(context);

      // Project with more queued tasks should come first when priorities are equal
      expect(ordered[0].projectId).toBe('project-1');
    });
  });

  describe('calculateUtilizationRecommendations', () => {
    it('should recommend increasing capacity usage when underutilized', () => {
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats({
          opus: { current: 1, limit: 5, available: 4, utilization: 0.2 },
          sonnet: { current: 2, limit: 10, available: 8, utilization: 0.2 },
        }),
        allProjectStats: [createMockProjectStats({ queuedTasks: 20 })],
        totalQueuedTasks: 20,
      };

      const recommendations = allocator.calculateUtilizationRecommendations(context);

      expect(recommendations.length).toBeGreaterThan(0);
      expect(
        recommendations.some(r => r.toLowerCase().includes('underutilized') || r.toLowerCase().includes('available'))
      ).toBe(true);
    });

    it('should note when at capacity with queued tasks', () => {
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats({
          opus: { current: 5, limit: 5, available: 0, utilization: 1.0 },
          sonnet: { current: 10, limit: 10, available: 0, utilization: 1.0 },
        }),
        allProjectStats: [createMockProjectStats({ queuedTasks: 15 })],
        totalQueuedTasks: 15,
      };

      const recommendations = allocator.calculateUtilizationRecommendations(context);

      expect(recommendations.length).toBeGreaterThan(0);
      expect(
        recommendations.some(r => r.toLowerCase().includes('capacity') || r.toLowerCase().includes('limit'))
      ).toBe(true);
    });

    it('should handle healthy utilization', () => {
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats({
          opus: { current: 3, limit: 5, available: 2, utilization: 0.6 },
          sonnet: { current: 6, limit: 10, available: 4, utilization: 0.6 },
        }),
        allProjectStats: [createMockProjectStats({ queuedTasks: 5 })],
        totalQueuedTasks: 5,
      };

      const recommendations = allocator.calculateUtilizationRecommendations(context);

      // Healthy utilization should either have no recommendations or positive ones
      expect(recommendations.every(r => !r.toLowerCase().includes('critical'))).toBe(true);
    });
  });

  describe('getOptimalModelMix', () => {
    it('should recommend Opus for complex tasks', () => {
      const projectStats = createMockProjectStats({
        queuedTasks: 10,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [projectStats],
        totalQueuedTasks: 10,
        taskComplexityDistribution: { high: 7, medium: 2, low: 1 },
      };

      const mix = allocator.getOptimalModelMix(context);

      expect(mix.opusPercent).toBeGreaterThan(mix.sonnetPercent / 2);
    });

    it('should recommend Sonnet for simple tasks', () => {
      const projectStats = createMockProjectStats({
        queuedTasks: 10,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [projectStats],
        totalQueuedTasks: 10,
        taskComplexityDistribution: { high: 1, medium: 2, low: 7 },
      };

      const mix = allocator.getOptimalModelMix(context);

      expect(mix.sonnetPercent).toBeGreaterThan(mix.opusPercent);
    });

    it('should provide balanced mix for mixed complexity', () => {
      const projectStats = createMockProjectStats({
        queuedTasks: 9,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [projectStats],
        totalQueuedTasks: 9,
        taskComplexityDistribution: { high: 3, medium: 3, low: 3 },
      };

      const mix = allocator.getOptimalModelMix(context);

      // Should be relatively balanced
      expect(Math.abs(mix.opusPercent - mix.sonnetPercent)).toBeLessThan(40);
    });

    it('should handle missing complexity distribution', () => {
      const projectStats = createMockProjectStats({
        queuedTasks: 10,
      });
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [projectStats],
        totalQueuedTasks: 10,
      };

      const mix = allocator.getOptimalModelMix(context);

      // Should return default values
      expect(mix.opusPercent + mix.sonnetPercent).toBeCloseTo(100);
    });
  });

  describe('calculateResourceGap', () => {
    it('should identify when more resources are needed', () => {
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats({
          opus: { current: 5, limit: 5, available: 0, utilization: 1.0 },
          sonnet: { current: 10, limit: 10, available: 0, utilization: 1.0 },
        }),
        allProjectStats: [createMockProjectStats({ queuedTasks: 30 })],
        totalQueuedTasks: 30,
      };

      const gap = allocator.calculateResourceGap(context);

      expect(gap.hasGap).toBe(true);
      expect(gap.estimatedQueueTime).toBeGreaterThan(0);
      expect(gap.recommendedAdditionalOpus).toBeGreaterThanOrEqual(0);
      expect(gap.recommendedAdditionalSonnet).toBeGreaterThanOrEqual(0);
    });

    it('should indicate no gap when resources are sufficient', () => {
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats({
          opus: { current: 1, limit: 5, available: 4, utilization: 0.2 },
          sonnet: { current: 2, limit: 10, available: 8, utilization: 0.2 },
        }),
        allProjectStats: [createMockProjectStats({ queuedTasks: 3 })],
        totalQueuedTasks: 3,
      };

      const gap = allocator.calculateResourceGap(context);

      expect(gap.hasGap).toBe(false);
    });

    it('should provide reasoning for resource recommendations', () => {
      const context: AllocationContext = {
        capacityStats: createMockCapacityStats(),
        allProjectStats: [createMockProjectStats({ queuedTasks: 20 })],
        totalQueuedTasks: 20,
      };

      const gap = allocator.calculateResourceGap(context);

      expect(gap.reasoning).toBeTruthy();
      expect(gap.reasoning.length).toBeGreaterThan(0);
    });
  });
});
