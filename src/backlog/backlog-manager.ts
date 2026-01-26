import { TaskRepository, Task } from '../db/repositories/tasks.js';
import { ProjectRepository, Project } from '../db/repositories/projects.js';
import { ProposalRepository } from '../db/repositories/proposals.js';

export interface BacklogStats {
  projectId: string;
  projectName: string;
  queuedCount: number;
  inProgressCount: number;
  blockedCount: number;
  pendingProposalsCount: number;
}

export interface BacklogManagerOptions {
  /** Minimum number of queued tasks before backlog is considered low. Default: 5 */
  threshold?: number;
}

export class BacklogManager {
  private threshold: number;

  constructor(
    private taskRepo: TaskRepository,
    private projectRepo: ProjectRepository,
    private proposalRepo: ProposalRepository,
    options: BacklogManagerOptions = {}
  ) {
    this.threshold = options.threshold ?? 5;
  }

  /**
   * Check if the overall backlog depth is below the threshold.
   */
  async isBacklogLow(): Promise<boolean> {
    const depth = await this.getBacklogDepth();
    return depth < this.threshold;
  }

  /**
   * Get the total number of queued tasks across all active projects.
   */
  async getBacklogDepth(): Promise<number> {
    const queuedTasks = await this.taskRepo.getQueued();
    return queuedTasks.length;
  }

  /**
   * Get detailed backlog statistics for each active project.
   */
  async getBacklogStats(): Promise<BacklogStats[]> {
    const activeProjects = await this.projectRepo.listActive();
    const stats: BacklogStats[] = [];

    for (const project of activeProjects) {
      const projectStats = await this.getProjectStats(project);
      stats.push(projectStats);
    }

    return stats;
  }

  /**
   * Get stats for a specific project.
   */
  private async getProjectStats(project: Project): Promise<BacklogStats> {
    const tasks = await this.taskRepo.getByProject(project.id);
    const proposals = await this.proposalRepo.getByProject(project.id);

    const queuedCount = tasks.filter(t => t.status === 'queued').length;
    const inProgressCount = tasks.filter(t =>
      t.status === 'in_progress' || t.status === 'assigned'
    ).length;
    const blockedCount = tasks.filter(t => t.status === 'blocked').length;
    const pendingProposalsCount = proposals.filter(p => p.status === 'proposed').length;

    return {
      projectId: project.id,
      projectName: project.name,
      queuedCount,
      inProgressCount,
      blockedCount,
      pendingProposalsCount
    };
  }

  /**
   * Check if proposals should be generated based on backlog depth.
   * Returns true if the backlog is low and new proposals are needed.
   */
  async checkAndTriggerProposals(): Promise<boolean> {
    const isLow = await this.isBacklogLow();

    if (!isLow) {
      return false;
    }

    // Also check if there are already pending proposals waiting for approval
    const pendingProposals = await this.proposalRepo.getPending();

    // If there are already many pending proposals, don't generate more
    if (pendingProposals.length >= this.threshold) {
      return false;
    }

    return true;
  }

  /**
   * Get projects that have low backlog and could use more tasks.
   */
  async getProjectsNeedingTasks(): Promise<Project[]> {
    const stats = await this.getBacklogStats();
    const projectsNeedingTasks: Project[] = [];

    for (const stat of stats) {
      // Consider a project as needing tasks if it has fewer than 2 queued tasks
      // and fewer than 3 pending proposals
      if (stat.queuedCount < 2 && stat.pendingProposalsCount < 3) {
        const project = await this.projectRepo.getById(stat.projectId);
        if (project) {
          projectsNeedingTasks.push(project);
        }
      }
    }

    return projectsNeedingTasks;
  }

  /**
   * Get a summary of the current backlog state.
   */
  async getSummary(): Promise<{
    totalQueued: number;
    totalInProgress: number;
    totalBlocked: number;
    totalPendingProposals: number;
    isBacklogLow: boolean;
    threshold: number;
  }> {
    const stats = await this.getBacklogStats();
    const totalQueued = stats.reduce((sum, s) => sum + s.queuedCount, 0);
    const totalInProgress = stats.reduce((sum, s) => sum + s.inProgressCount, 0);
    const totalBlocked = stats.reduce((sum, s) => sum + s.blockedCount, 0);
    const totalPendingProposals = stats.reduce((sum, s) => sum + s.pendingProposalsCount, 0);

    return {
      totalQueued,
      totalInProgress,
      totalBlocked,
      totalPendingProposals,
      isBacklogLow: totalQueued < this.threshold,
      threshold: this.threshold
    };
  }
}
