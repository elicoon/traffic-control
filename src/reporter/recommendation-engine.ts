import { ProjectMetrics, SystemMetrics } from './metrics-collector.js';

export interface RecommendationThresholds {
  blockedTasks: number;
  highVelocity: number;
  lowOpusUtilization: number;
  highBlockedSystem: number;
}

export type RecommendationType =
  | 'blocked_tasks'
  | 'empty_backlog'
  | 'high_velocity'
  | 'no_activity'
  | 'low_opus_utilization'
  | 'high_blocked_count'
  | 'empty_queues'
  | 'healthy_system'
  | 'high_completion';

export type RecommendationPriority = 'critical' | 'warning' | 'info' | 'positive';

export interface Recommendation {
  type: RecommendationType;
  message: string;
  priority: RecommendationPriority;
  projectId?: string;
  projectName?: string;
}

export interface RecommendationReport {
  projectRecommendations: Map<string, Recommendation[]>;
  systemRecommendations: Recommendation[];
  actionItems: string[];
}

export class RecommendationEngine {
  // Thresholds for recommendations (configurable via constructor)
  private readonly thresholds: RecommendationThresholds;

  constructor(thresholds?: Partial<RecommendationThresholds>) {
    this.thresholds = {
      blockedTasks: thresholds?.blockedTasks ?? 1,
      highVelocity: thresholds?.highVelocity ?? 5,
      lowOpusUtilization: thresholds?.lowOpusUtilization ?? 25,
      highBlockedSystem: thresholds?.highBlockedSystem ?? 5
    };
  }

  /**
   * Analyzes metrics for a single project and generates recommendations.
   */
  analyzeProjectMetrics(metrics: ProjectMetrics): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Check for blocked tasks
    if (metrics.tasksBlocked >= this.thresholds.blockedTasks) {
      recommendations.push({
        type: 'blocked_tasks',
        message: `Project "${metrics.projectName}" has ${metrics.tasksBlocked} blocked tasks - needs attention`,
        priority: 'critical',
        projectId: metrics.projectId,
        projectName: metrics.projectName
      });
    }

    // Check for empty backlog (when there's activity but no queued tasks)
    if (
      metrics.tasksQueued === 0 &&
      (metrics.tasksInProgress > 0 || metrics.tasksCompletedThisWeek > 0)
    ) {
      recommendations.push({
        type: 'empty_backlog',
        message: `Backlog for "${metrics.projectName}" is empty - consider adding more tasks`,
        priority: 'warning',
        projectId: metrics.projectId,
        projectName: metrics.projectName
      });
    }

    // Celebrate high velocity
    if (metrics.tasksCompletedToday >= this.thresholds.highVelocity) {
      recommendations.push({
        type: 'high_velocity',
        message: `Project "${metrics.projectName}" completed ${metrics.tasksCompletedToday} tasks today!`,
        priority: 'positive',
        projectId: metrics.projectId,
        projectName: metrics.projectName
      });
    }

    // Check for no activity
    if (
      metrics.tasksQueued > 0 &&
      metrics.tasksInProgress === 0 &&
      metrics.tasksCompletedThisWeek === 0 &&
      metrics.sessionsCount === 0
    ) {
      recommendations.push({
        type: 'no_activity',
        message: `Project "${metrics.projectName}" has no activity this week but has ${metrics.tasksQueued} queued tasks`,
        priority: 'warning',
        projectId: metrics.projectId,
        projectName: metrics.projectName
      });
    }

    // Check for high completion rate
    if (metrics.completionRate >= 80 && metrics.tasksCompletedThisWeek > 0) {
      recommendations.push({
        type: 'high_completion',
        message: `Project "${metrics.projectName}" is ${Math.round(metrics.completionRate)}% complete`,
        priority: 'positive',
        projectId: metrics.projectId,
        projectName: metrics.projectName
      });
    }

    return recommendations;
  }

  /**
   * Analyzes system-wide metrics and generates recommendations.
   */
  analyzeSystemMetrics(systemMetrics: SystemMetrics): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Check for low Opus utilization
    if (
      systemMetrics.opusUtilization > 0 &&
      systemMetrics.opusUtilization < this.thresholds.lowOpusUtilization
    ) {
      recommendations.push({
        type: 'low_opus_utilization',
        message: `Opus at ${Math.round(systemMetrics.opusUtilization)}% utilization - consider assigning more complex tasks`,
        priority: 'info'
      });
    }

    // Check for high blocked count system-wide
    if (systemMetrics.totalTasksBlocked >= this.thresholds.highBlockedSystem) {
      recommendations.push({
        type: 'high_blocked_count',
        message: `${systemMetrics.totalTasksBlocked} tasks blocked across all projects - immediate attention required`,
        priority: 'critical'
      });
    }

    // Check for empty queues
    if (systemMetrics.totalTasksQueued === 0 && systemMetrics.totalProjects > 0) {
      recommendations.push({
        type: 'empty_queues',
        message: 'All task queues are empty - add more work to keep agents productive',
        priority: 'warning'
      });
    }

    // Provide positive feedback for healthy system
    if (
      systemMetrics.totalTasksBlocked === 0 &&
      systemMetrics.totalTasksCompletedToday > 0 &&
      systemMetrics.totalTasksQueued > 0
    ) {
      recommendations.push({
        type: 'healthy_system',
        message: `System is healthy: ${systemMetrics.totalTasksCompletedToday} tasks completed today, ${systemMetrics.totalTasksQueued} in queue`,
        priority: 'positive'
      });
    }

    return recommendations;
  }

  /**
   * Generates a complete recommendation report from project and system metrics.
   */
  generateReport(
    projectMetrics: ProjectMetrics[],
    systemMetrics: SystemMetrics
  ): RecommendationReport {
    const projectRecommendations = new Map<string, Recommendation[]>();

    // Analyze each project
    for (const metrics of projectMetrics) {
      const recs = this.analyzeProjectMetrics(metrics);
      if (recs.length > 0) {
        projectRecommendations.set(metrics.projectId, recs);
      }
    }

    // Analyze system metrics
    const systemRecommendations = this.analyzeSystemMetrics(systemMetrics);

    // Generate prioritized action items
    const actionItems = this.generateActionItems(projectRecommendations, systemRecommendations);

    return {
      projectRecommendations,
      systemRecommendations,
      actionItems
    };
  }

  /**
   * Generates a prioritized list of action items from recommendations.
   */
  private generateActionItems(
    projectRecommendations: Map<string, Recommendation[]>,
    systemRecommendations: Recommendation[]
  ): string[] {
    const items: { text: string; priority: RecommendationPriority }[] = [];

    // Add system-level action items
    for (const rec of systemRecommendations) {
      if (rec.priority === 'critical' || rec.priority === 'warning') {
        items.push({ text: rec.message, priority: rec.priority });
      }
    }

    // Add project-level action items
    for (const [, recs] of projectRecommendations) {
      for (const rec of recs) {
        if (rec.priority === 'critical' || rec.priority === 'warning') {
          items.push({ text: rec.message, priority: rec.priority });
        }
      }
    }

    // Sort by priority (critical first, then warning)
    items.sort((a, b) => {
      const priorityOrder: Record<RecommendationPriority, number> = {
        critical: 0,
        warning: 1,
        info: 2,
        positive: 3
      };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return items.map(item => item.text);
  }

  /**
   * Gets all critical recommendations that need immediate attention.
   */
  getCriticalRecommendations(report: RecommendationReport): Recommendation[] {
    const critical: Recommendation[] = [];

    // From system recommendations
    for (const rec of report.systemRecommendations) {
      if (rec.priority === 'critical') {
        critical.push(rec);
      }
    }

    // From project recommendations
    for (const [, recs] of report.projectRecommendations) {
      for (const rec of recs) {
        if (rec.priority === 'critical') {
          critical.push(rec);
        }
      }
    }

    return critical;
  }

  /**
   * Gets all positive recommendations (good news/celebrations).
   */
  getPositiveRecommendations(report: RecommendationReport): Recommendation[] {
    const positive: Recommendation[] = [];

    // From system recommendations
    for (const rec of report.systemRecommendations) {
      if (rec.priority === 'positive') {
        positive.push(rec);
      }
    }

    // From project recommendations
    for (const [, recs] of report.projectRecommendations) {
      for (const rec of recs) {
        if (rec.priority === 'positive') {
          positive.push(rec);
        }
      }
    }

    return positive;
  }
}
