import { CapacityStats } from '../scheduler/capacity-tracker.js';

/**
 * Statistics for a project's resource usage.
 */
export interface ProjectStats {
  projectId: string;
  projectName: string;
  currentOpusSessions: number;
  currentSonnetSessions: number;
  queuedTasks: number;
  blockedTasks: number;
  inProgressTasks: number;
  completedToday: number;
  completedThisWeek: number;
  avgTaskDuration: number; // minutes
}

/**
 * Recommended resource allocation for a project.
 */
export interface ResourceAllocation {
  projectId: string;
  projectName: string;
  currentOpusSessions: number;
  currentSonnetSessions: number;
  queuedTasks: number;
  blockedTasks: number;
  recommendedOpusPercent: number;
  recommendedSonnetPercent: number;
  reasoning: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Task complexity distribution.
 */
export interface TaskComplexityDistribution {
  high: number;
  medium: number;
  low: number;
}

/**
 * Context for resource allocation calculations.
 */
export interface AllocationContext {
  capacityStats: CapacityStats;
  allProjectStats: ProjectStats[];
  totalQueuedTasks: number;
  taskComplexityDistribution?: TaskComplexityDistribution;
}

/**
 * Optimal model mix recommendation.
 */
export interface ModelMix {
  opusPercent: number;
  sonnetPercent: number;
  reasoning: string;
}

/**
 * Resource gap analysis result.
 */
export interface ResourceGap {
  hasGap: boolean;
  estimatedQueueTime: number; // minutes
  recommendedAdditionalOpus: number;
  recommendedAdditionalSonnet: number;
  reasoning: string;
}

/**
 * Thresholds for priority classification.
 */
const BLOCKED_TASK_THRESHOLD = 1;
const HIGH_QUEUE_THRESHOLD = 10;
const LOW_ACTIVITY_THRESHOLD = 3;

/**
 * ResourceAllocator recommends how to distribute compute resources across projects.
 */
export class ResourceAllocator {
  /**
   * Calculate resource allocation for a single project.
   */
  calculateProjectAllocation(
    projectStats: ProjectStats,
    context: AllocationContext
  ): ResourceAllocation {
    const reasoning: string[] = [];
    let priority: ResourceAllocation['priority'] = 'medium';

    // Determine priority based on project state
    if (projectStats.blockedTasks >= BLOCKED_TASK_THRESHOLD) {
      priority = 'critical';
      reasoning.push(`${projectStats.blockedTasks} blocked task(s) require immediate attention`);
    } else if (projectStats.queuedTasks >= HIGH_QUEUE_THRESHOLD) {
      priority = 'high';
      reasoning.push(`High queue depth: ${projectStats.queuedTasks} tasks waiting`);
    } else if (
      projectStats.queuedTasks <= LOW_ACTIVITY_THRESHOLD &&
      projectStats.completedToday === 0 &&
      projectStats.inProgressTasks === 0
    ) {
      priority = 'low';
      reasoning.push('Low activity project with minimal queue');
    }

    // Calculate share of resources based on queue proportion
    let queueProportion = 0;
    if (context.totalQueuedTasks > 0) {
      queueProportion = projectStats.queuedTasks / context.totalQueuedTasks;
    } else if (context.allProjectStats.length === 1) {
      queueProportion = 1;
    }

    // Base allocation on queue proportion
    let recommendedOpusPercent = Math.round(queueProportion * 100);
    let recommendedSonnetPercent = Math.round(queueProportion * 100);

    // Boost allocation for critical projects
    if (priority === 'critical') {
      recommendedOpusPercent = Math.min(100, recommendedOpusPercent + 20);
      recommendedSonnetPercent = Math.min(100, recommendedSonnetPercent + 20);
      reasoning.push('Allocation boosted due to critical priority');
    }

    // Add reasoning about current state
    if (projectStats.currentOpusSessions > 0 || projectStats.currentSonnetSessions > 0) {
      reasoning.push(
        `Currently using ${projectStats.currentOpusSessions} Opus and ${projectStats.currentSonnetSessions} Sonnet sessions`
      );
    }

    if (projectStats.queuedTasks > 0) {
      reasoning.push(`${projectStats.queuedTasks} tasks in queue`);
    }

    return {
      projectId: projectStats.projectId,
      projectName: projectStats.projectName,
      currentOpusSessions: projectStats.currentOpusSessions,
      currentSonnetSessions: projectStats.currentSonnetSessions,
      queuedTasks: projectStats.queuedTasks,
      blockedTasks: projectStats.blockedTasks,
      recommendedOpusPercent,
      recommendedSonnetPercent,
      reasoning,
      priority,
    };
  }

  /**
   * Distribute resources across all projects.
   */
  distributeResources(context: AllocationContext): ResourceAllocation[] {
    if (context.allProjectStats.length === 0) {
      return [];
    }

    const allocations: ResourceAllocation[] = [];

    for (const projectStats of context.allProjectStats) {
      const allocation = this.calculateProjectAllocation(projectStats, context);
      allocations.push(allocation);
    }

    // Normalize to ensure totals are 100%
    this.normalizeAllocations(allocations);

    return allocations;
  }

  /**
   * Normalize allocations so they sum to 100%.
   */
  private normalizeAllocations(allocations: ResourceAllocation[]): void {
    if (allocations.length === 0) return;

    const totalOpus = allocations.reduce((sum, a) => sum + a.recommendedOpusPercent, 0);
    const totalSonnet = allocations.reduce((sum, a) => sum + a.recommendedSonnetPercent, 0);

    if (totalOpus > 0) {
      for (const allocation of allocations) {
        allocation.recommendedOpusPercent = Math.round(
          (allocation.recommendedOpusPercent / totalOpus) * 100
        );
      }
    }

    if (totalSonnet > 0) {
      for (const allocation of allocations) {
        allocation.recommendedSonnetPercent = Math.round(
          (allocation.recommendedSonnetPercent / totalSonnet) * 100
        );
      }
    }
  }

  /**
   * Get projects ordered by priority (highest first).
   */
  getPriorityOrder(context: AllocationContext): ResourceAllocation[] {
    const allocations = this.distributeResources(context);

    const priorityOrder: Record<ResourceAllocation['priority'], number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    allocations.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Within same priority, sort by recommended allocation
      return b.recommendedSonnetPercent - a.recommendedSonnetPercent;
    });

    return allocations;
  }

  /**
   * Calculate utilization recommendations based on current state.
   */
  calculateUtilizationRecommendations(context: AllocationContext): string[] {
    const recommendations: string[] = [];
    const { capacityStats, totalQueuedTasks } = context;

    // Check for underutilization
    if (capacityStats.opus.utilization < 0.5 && totalQueuedTasks > 0) {
      recommendations.push(
        `Opus is underutilized at ${Math.round(capacityStats.opus.utilization * 100)}%. ` +
          `${capacityStats.opus.available} slots available with ${totalQueuedTasks} tasks queued.`
      );
    }

    if (capacityStats.sonnet.utilization < 0.5 && totalQueuedTasks > 0) {
      recommendations.push(
        `Sonnet is underutilized at ${Math.round(capacityStats.sonnet.utilization * 100)}%. ` +
          `${capacityStats.sonnet.available} slots available with ${totalQueuedTasks} tasks queued.`
      );
    }

    // Check for capacity constraints
    if (capacityStats.opus.utilization >= 1.0 && totalQueuedTasks > 0) {
      recommendations.push(
        `Opus is at full capacity. ${totalQueuedTasks} tasks queued, consider increasing limit.`
      );
    }

    if (capacityStats.sonnet.utilization >= 1.0 && totalQueuedTasks > 0) {
      recommendations.push(
        `Sonnet is at full capacity. ${totalQueuedTasks} tasks queued, consider increasing limit.`
      );
    }

    // Healthy state
    if (
      recommendations.length === 0 &&
      capacityStats.opus.utilization >= 0.5 &&
      capacityStats.opus.utilization < 1.0 &&
      capacityStats.sonnet.utilization >= 0.5 &&
      capacityStats.sonnet.utilization < 1.0
    ) {
      recommendations.push('Resource utilization is healthy and balanced.');
    }

    return recommendations;
  }

  /**
   * Get optimal model mix based on task complexity distribution.
   */
  getOptimalModelMix(context: AllocationContext): ModelMix {
    const distribution = context.taskComplexityDistribution;

    if (!distribution) {
      // Default 40/60 split favoring Sonnet for cost efficiency
      return {
        opusPercent: 40,
        sonnetPercent: 60,
        reasoning: 'Default mix: favoring Sonnet for cost efficiency',
      };
    }

    const total = distribution.high + distribution.medium + distribution.low;
    if (total === 0) {
      return {
        opusPercent: 40,
        sonnetPercent: 60,
        reasoning: 'No tasks to analyze, using default mix',
      };
    }

    // High complexity tasks need Opus, others can use Sonnet
    const highPercent = (distribution.high / total) * 100;
    const mediumPercent = (distribution.medium / total) * 100;
    const lowPercent = (distribution.low / total) * 100;

    // Opus should handle high complexity + half of medium
    const opusPercent = Math.round(highPercent + mediumPercent * 0.3);
    const sonnetPercent = 100 - opusPercent;

    let reasoning: string;
    if (highPercent > 50) {
      reasoning = `High complexity tasks dominant (${highPercent.toFixed(0)}%), allocating more Opus`;
    } else if (lowPercent > 50) {
      reasoning = `Low complexity tasks dominant (${lowPercent.toFixed(0)}%), favoring Sonnet for efficiency`;
    } else {
      reasoning = `Balanced complexity distribution, using mixed allocation`;
    }

    return {
      opusPercent,
      sonnetPercent,
      reasoning,
    };
  }

  /**
   * Calculate if there's a resource gap and what's needed.
   */
  calculateResourceGap(context: AllocationContext): ResourceGap {
    const { capacityStats, totalQueuedTasks, allProjectStats } = context;

    // Calculate average task duration
    const avgDuration =
      allProjectStats.length > 0
        ? allProjectStats.reduce((sum, p) => sum + p.avgTaskDuration, 0) / allProjectStats.length
        : 30; // Default 30 minutes

    // Calculate current throughput (tasks/hour)
    const totalCurrentSessions = capacityStats.opus.current + capacityStats.sonnet.current;
    const tasksPerHour = totalCurrentSessions > 0 ? (60 / avgDuration) * totalCurrentSessions : 0;

    // Estimate queue time
    const estimatedQueueTime = tasksPerHour > 0 ? (totalQueuedTasks / tasksPerHour) * 60 : Infinity;

    // Check if at capacity with significant queue
    const atCapacity =
      capacityStats.opus.utilization >= 1.0 && capacityStats.sonnet.utilization >= 1.0;
    const hasSignificantQueue = totalQueuedTasks >= HIGH_QUEUE_THRESHOLD;

    const hasGap = atCapacity && hasSignificantQueue;

    // Calculate recommended additional capacity
    let recommendedAdditionalOpus = 0;
    let recommendedAdditionalSonnet = 0;
    let reasoning: string;

    if (hasGap) {
      // Estimate sessions needed to clear queue in 2 hours
      const targetHours = 2;
      const sessionsNeeded = Math.ceil(totalQueuedTasks / (60 / avgDuration) / targetHours);
      const additionalNeeded = Math.max(0, sessionsNeeded - totalCurrentSessions);

      // Split additional capacity 30% Opus, 70% Sonnet for cost efficiency
      recommendedAdditionalOpus = Math.ceil(additionalNeeded * 0.3);
      recommendedAdditionalSonnet = Math.ceil(additionalNeeded * 0.7);

      reasoning = `At full capacity with ${totalQueuedTasks} queued tasks. ` +
        `Estimated ${Math.round(estimatedQueueTime)} minutes to clear queue. ` +
        `Recommend adding ${recommendedAdditionalOpus} Opus and ${recommendedAdditionalSonnet} Sonnet sessions.`;
    } else if (atCapacity) {
      reasoning = 'At capacity but queue is manageable.';
    } else if (hasSignificantQueue) {
      reasoning = `${totalQueuedTasks} tasks queued but capacity available. ` +
        `Consider scheduling more tasks.`;
    } else {
      reasoning = 'Resources are sufficient for current workload.';
    }

    return {
      hasGap,
      estimatedQueueTime: estimatedQueueTime === Infinity ? -1 : Math.round(estimatedQueueTime),
      recommendedAdditionalOpus,
      recommendedAdditionalSonnet,
      reasoning,
    };
  }
}
