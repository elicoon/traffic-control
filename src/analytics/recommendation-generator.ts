import { randomUUID } from 'node:crypto';
import { PriorityScore } from './priority-scorer.js';
import { ResourceAllocation } from './resource-allocator.js';
import { CapacityStats } from '../scheduler/capacity-tracker.js';
import { Task } from '../db/repositories/tasks.js';

/**
 * Types of recommendations the generator can produce.
 */
export type RecommendationType = 'rebalance' | 'pause' | 'accelerate' | 'investigate' | 'complete';

/**
 * Priority levels for recommendations.
 */
export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * A single actionable recommendation.
 */
export interface Recommendation {
  id: string;
  type: RecommendationType;
  priority: RecommendationPriority;
  title: string;
  description: string;
  affectedProjects: string[];
  suggestedAction: string;
  expectedImpact: string;
  createdAt: Date;
}

/**
 * Context needed for generating recommendations.
 */
export interface RecommendationContext {
  priorityScores: PriorityScore[];
  allocations: ResourceAllocation[];
  capacityStats: CapacityStats;
  tasks: Task[];
  projectCompletionRates?: Record<string, number>;
}

/**
 * Summary of recommendations for a report.
 */
export interface RecommendationSummary {
  totalRecommendations: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  topActions: string[];
}

/**
 * Thresholds for generating recommendations.
 */
const BLOCKED_CRITICAL_THRESHOLD = 3;
const HIGH_QUEUE_THRESHOLD = 15;
const STALE_TASK_DAYS = 5;
const HIGH_PRIORITY_SCORE_THRESHOLD = 80;
const COMPLETION_THRESHOLD = 90; // % complete to suggest finishing
const ALLOCATION_IMBALANCE_THRESHOLD = 30; // % difference considered uneven

/**
 * Generate a unique recommendation ID using crypto.randomUUID.
 */
function generateId(): string {
  return `rec-${randomUUID().slice(0, 8)}`;
}

/**
 * RecommendationGenerator creates actionable recommendations based on system state.
 */
export class RecommendationGenerator {
  /**
   * Generate recommendations for rebalancing resources across projects.
   */
  generateRebalanceRecommendations(context: RecommendationContext): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const { allocations } = context;

    if (allocations.length < 2) {
      return recommendations;
    }

    // Find projects with significant allocation differences
    const avgOpus =
      allocations.reduce((sum, a) => sum + a.recommendedOpusPercent, 0) / allocations.length;
    const avgSonnet =
      allocations.reduce((sum, a) => sum + a.recommendedSonnetPercent, 0) / allocations.length;

    const overAllocated = allocations.filter(
      a =>
        a.recommendedOpusPercent > avgOpus + ALLOCATION_IMBALANCE_THRESHOLD ||
        a.recommendedSonnetPercent > avgSonnet + ALLOCATION_IMBALANCE_THRESHOLD
    );

    const underAllocated = allocations.filter(
      a =>
        a.recommendedOpusPercent < avgOpus - ALLOCATION_IMBALANCE_THRESHOLD ||
        a.recommendedSonnetPercent < avgSonnet - ALLOCATION_IMBALANCE_THRESHOLD
    );

    if (overAllocated.length > 0 && underAllocated.length > 0) {
      const affectedProjects = [...overAllocated, ...underAllocated].map(a => a.projectName);

      recommendations.push({
        id: generateId(),
        type: 'rebalance',
        priority: overAllocated.some(a => a.priority === 'critical') ? 'high' : 'medium',
        title: 'Resource Allocation Imbalance Detected',
        description: `${overAllocated.length} project(s) have significantly higher allocation than others. ` +
          `Consider redistributing resources for better overall throughput.`,
        affectedProjects: Array.from(new Set(affectedProjects)),
        suggestedAction:
          `Review task queues and consider moving sessions from ${underAllocated[0]?.projectName || 'lower priority projects'} ` +
          `to ${overAllocated[0]?.projectName || 'higher priority projects'}`,
        expectedImpact: 'More balanced progress across projects and reduced queue wait times',
        createdAt: new Date(),
      });
    }

    return recommendations;
  }

  /**
   * Generate recommendations for pausing or deprioritizing problematic projects.
   */
  generatePauseRecommendations(context: RecommendationContext): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const { allocations } = context;

    for (const allocation of allocations) {
      if (allocation.blockedTasks >= BLOCKED_CRITICAL_THRESHOLD) {
        recommendations.push({
          id: generateId(),
          type: 'pause',
          priority: 'critical',
          title: `High Blocked Count: ${allocation.projectName}`,
          description:
            `Project "${allocation.projectName}" has ${allocation.blockedTasks} blocked tasks. ` +
            `Consider pausing new task assignment until blockers are resolved.`,
          affectedProjects: [allocation.projectName],
          suggestedAction:
            'Pause scheduling new tasks for this project and focus on resolving blockers',
          expectedImpact: 'Prevents resource waste on tasks that cannot proceed',
          createdAt: new Date(),
        });
      } else if (allocation.blockedTasks > 0) {
        recommendations.push({
          id: generateId(),
          type: 'investigate',
          priority: 'high',
          title: `Blocked Tasks in ${allocation.projectName}`,
          description:
            `Project "${allocation.projectName}" has ${allocation.blockedTasks} blocked task(s) ` +
            `that need attention.`,
          affectedProjects: [allocation.projectName],
          suggestedAction: 'Investigate and resolve the blocking issues',
          expectedImpact: 'Unblocks progress and improves throughput',
          createdAt: new Date(),
        });
      }
    }

    return recommendations;
  }

  /**
   * Generate recommendations for accelerating high-value tasks.
   */
  generateAccelerateRecommendations(context: RecommendationContext): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const { priorityScores, capacityStats, tasks } = context;

    // Check if there's capacity available
    const hasOpusCapacity = capacityStats.opus.available > 0;
    const hasSonnetCapacity = capacityStats.sonnet.available > 0;

    if (!hasOpusCapacity && !hasSonnetCapacity) {
      return recommendations;
    }

    // Find high-priority tasks
    const highPriorityScores = priorityScores.filter(
      s => s.totalScore >= HIGH_PRIORITY_SCORE_THRESHOLD
    );

    for (const score of highPriorityScores.slice(0, 3)) {
      const task = tasks.find(t => t.id === score.taskId);
      if (!task) continue;

      const isComplex =
        task.complexity_estimate?.toLowerCase() === 'high' ||
        task.complexity_estimate?.toLowerCase() === 'complex';

      if (isComplex && hasOpusCapacity) {
        recommendations.push({
          id: generateId(),
          type: 'accelerate',
          priority: 'high',
          title: `Accelerate High-Value Task: ${task.title}`,
          description:
            `Task "${task.title}" has a priority score of ${score.totalScore.toFixed(0)} ` +
            `and Opus capacity is available.`,
          affectedProjects: [task.project_id],
          suggestedAction: 'Assign Opus session to this task immediately',
          expectedImpact: 'Faster completion of high-impact work',
          createdAt: new Date(),
        });
      } else if (hasSonnetCapacity) {
        recommendations.push({
          id: generateId(),
          type: 'accelerate',
          priority: 'medium',
          title: `Accelerate Task: ${task.title}`,
          description:
            `Task "${task.title}" has a priority score of ${score.totalScore.toFixed(0)} ` +
            `and capacity is available.`,
          affectedProjects: [task.project_id],
          suggestedAction: 'Schedule this task for immediate processing',
          expectedImpact: 'Improved throughput on high-priority work',
          createdAt: new Date(),
        });
      }
    }

    return recommendations;
  }

  /**
   * Generate recommendations for investigating issues.
   */
  generateInvestigateRecommendations(context: RecommendationContext): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const { tasks, allocations } = context;

    // Check for stale tasks
    const now = Date.now();
    const staleTasks = tasks.filter(t => {
      if (t.status !== 'queued') return false;
      const age = (now - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24);
      return age >= STALE_TASK_DAYS;
    });

    if (staleTasks.length > 0) {
      const projectIds = Array.from(new Set(staleTasks.map(t => t.project_id)));
      const projectNames = allocations
        .filter(a => projectIds.includes(a.projectId))
        .map(a => a.projectName);

      recommendations.push({
        id: generateId(),
        type: 'investigate',
        priority: staleTasks.length >= 5 ? 'high' : 'medium',
        title: `${staleTasks.length} Stale Task(s) Detected`,
        description:
          `${staleTasks.length} task(s) have been queued for ${STALE_TASK_DAYS}+ days without progress. ` +
          `They may be blocked, poorly defined, or no longer relevant.`,
        affectedProjects: projectNames,
        suggestedAction:
          'Review stale tasks: update descriptions, add blockers, or remove if no longer needed',
        expectedImpact: 'Cleaner backlog and better visibility into actual work',
        createdAt: new Date(),
      });
    }

    // Check for blocked tasks
    const blockedTasks = tasks.filter(t => t.status === 'blocked');
    if (blockedTasks.length > 0) {
      const projectIds = Array.from(new Set(blockedTasks.map(t => t.project_id)));
      const projectNames = allocations
        .filter(a => projectIds.includes(a.projectId))
        .map(a => a.projectName);

      recommendations.push({
        id: generateId(),
        type: 'investigate',
        priority: blockedTasks.length >= 3 ? 'critical' : 'high',
        title: `${blockedTasks.length} Blocked Task(s) Need Attention`,
        description:
          `${blockedTasks.length} task(s) are currently blocked. ` +
          `Investigate the blocking issues to restore progress.`,
        affectedProjects: projectNames,
        suggestedAction:
          'Identify and resolve blockers or reassign blocked tasks',
        expectedImpact: 'Restored progress and improved resource utilization',
        createdAt: new Date(),
      });
    }

    return recommendations;
  }

  /**
   * Generate recommendations for completing near-finished projects.
   */
  generateCompleteRecommendations(context: RecommendationContext): Recommendation[] {
    const recommendations: Recommendation[] = [];
    const { allocations, projectCompletionRates } = context;

    if (!projectCompletionRates) {
      return recommendations;
    }

    for (const allocation of allocations) {
      const completionRate = projectCompletionRates[allocation.projectId];
      if (completionRate === undefined) continue;

      if (completionRate >= COMPLETION_THRESHOLD && allocation.queuedTasks <= 3) {
        recommendations.push({
          id: generateId(),
          type: 'complete',
          priority: 'medium',
          title: `Complete Project: ${allocation.projectName}`,
          description:
            `Project "${allocation.projectName}" is ${completionRate.toFixed(0)}% complete ` +
            `with only ${allocation.queuedTasks} task(s) remaining.`,
          affectedProjects: [allocation.projectName],
          suggestedAction:
            'Prioritize remaining tasks to finish this project and free up capacity',
          expectedImpact: 'Project completion and freed resources for other work',
          createdAt: new Date(),
        });
      }
    }

    return recommendations;
  }

  /**
   * Generate all recommendations based on context.
   */
  generateAllRecommendations(context: RecommendationContext): Recommendation[] {
    const allRecommendations: Recommendation[] = [
      ...this.generateRebalanceRecommendations(context),
      ...this.generatePauseRecommendations(context),
      ...this.generateAccelerateRecommendations(context),
      ...this.generateInvestigateRecommendations(context),
      ...this.generateCompleteRecommendations(context),
    ];

    // Sort by priority
    const priorityOrder: Record<RecommendationPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    allRecommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return allRecommendations;
  }

  /**
   * Get only actionable recommendations (critical and high priority).
   */
  getActionableRecommendations(context: RecommendationContext): Recommendation[] {
    const all = this.generateAllRecommendations(context);
    return all.filter(r => r.priority === 'critical' || r.priority === 'high');
  }

  /**
   * Format a recommendation for inclusion in a report.
   */
  formatRecommendationForReport(rec: Recommendation): string {
    const lines = [
      `[${rec.priority.toUpperCase()}] ${rec.title}`,
      ``,
      `${rec.description}`,
      ``,
      `Affected: ${rec.affectedProjects.join(', ')}`,
      `Action: ${rec.suggestedAction}`,
      `Expected Impact: ${rec.expectedImpact}`,
    ];

    return lines.join('\n');
  }

  /**
   * Generate a summary of all recommendations.
   */
  generateReportSummary(context: RecommendationContext): RecommendationSummary {
    const recommendations = this.generateAllRecommendations(context);

    const counts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const rec of recommendations) {
      counts[rec.priority]++;
    }

    // Extract top actions (critical and high priority)
    const topActions = recommendations
      .filter(r => r.priority === 'critical' || r.priority === 'high')
      .slice(0, 5)
      .map(r => r.suggestedAction);

    return {
      totalRecommendations: recommendations.length,
      criticalCount: counts.critical,
      highCount: counts.high,
      mediumCount: counts.medium,
      lowCount: counts.low,
      topActions,
    };
  }
}
