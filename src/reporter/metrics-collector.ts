import { SupabaseClient } from '@supabase/supabase-js';

export interface ProjectMetrics {
  projectId: string;
  projectName: string;
  tasksQueued: number;
  tasksInProgress: number;
  tasksBlocked: number;
  tasksCompletedToday: number;
  tasksCompletedThisWeek: number;
  tokensOpus: number;
  tokensSonnet: number;
  sessionsCount: number;
  completionRate: number;
}

export interface SystemMetrics {
  totalProjects: number;
  totalTasksQueued: number;
  totalTasksInProgress: number;
  totalTasksBlocked: number;
  totalTasksCompletedToday: number;
  totalTasksCompletedThisWeek: number;
  totalTokensOpus: number;
  totalTokensSonnet: number;
  totalSessions: number;
  opusUtilization: number;
  sonnetUtilization: number;
}

export interface EstimateComparison {
  projectId: string;
  estimatedSessionsOpus: number;
  actualSessionsOpus: number;
  estimatedSessionsSonnet: number;
  actualSessionsSonnet: number;
  variance: number; // Percentage: positive = under estimate, negative = over estimate
}

export type TimePeriod = 'today' | 'week';

export class MetricsCollector {
  constructor(private client: SupabaseClient) {}

  /**
   * Collects metrics for a specific project.
   */
  async collectProjectMetrics(projectId: string): Promise<ProjectMetrics> {
    // Get project name
    const { data: project, error: projectError } = await this.client
      .from('tc_projects')
      .select('name')
      .eq('id', projectId)
      .single();

    if (projectError) {
      throw new Error(`Failed to get project: ${projectError.message}`);
    }

    // Get all tasks for this project
    const { data: tasks, error: tasksError } = await this.client
      .from('tc_tasks')
      .select('*')
      .eq('project_id', projectId);

    if (tasksError) {
      throw new Error(`Failed to get tasks: ${tasksError.message}`);
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Count tasks by status
    const tasksQueued = tasks.filter(t => t.status === 'queued').length;
    const tasksInProgress = tasks.filter(t => t.status === 'in_progress' || t.status === 'assigned').length;
    const tasksBlocked = tasks.filter(t => t.status === 'blocked').length;
    const tasksCompletedToday = tasks.filter(t =>
      t.status === 'complete' && t.completed_at && t.completed_at >= todayStart
    ).length;
    const tasksCompletedThisWeek = tasks.filter(t =>
      t.status === 'complete' && t.completed_at && t.completed_at >= weekStart
    ).length;

    // Sum token usage
    const tokensOpus = tasks.reduce((sum, t) => sum + (t.actual_tokens_opus || 0), 0);
    const tokensSonnet = tasks.reduce((sum, t) => sum + (t.actual_tokens_sonnet || 0), 0);

    // Get session count from tc_agent_sessions
    const { data: sessions, error: sessionsError } = await this.client
      .from('tc_agent_sessions')
      .select('id')
      .in('task_id', tasks.map(t => t.id));

    const sessionsCount = sessionsError ? 0 : (sessions?.length || 0);

    // Calculate completion rate
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'complete').length;
    const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    return {
      projectId,
      projectName: project.name,
      tasksQueued,
      tasksInProgress,
      tasksBlocked,
      tasksCompletedToday,
      tasksCompletedThisWeek,
      tokensOpus,
      tokensSonnet,
      sessionsCount,
      completionRate
    };
  }

  /**
   * Collects metrics for all active projects.
   * Projects that fail to load (e.g., deleted during collection) are skipped.
   */
  async collectAllProjectMetrics(): Promise<ProjectMetrics[]> {
    const { data: projects, error } = await this.client
      .from('tc_projects')
      .select('id')
      .eq('status', 'active');

    if (error) {
      throw new Error(`Failed to get projects: ${error.message}`);
    }

    const metrics: ProjectMetrics[] = [];
    for (const project of projects || []) {
      try {
        const projectMetrics = await this.collectProjectMetrics(project.id);
        metrics.push(projectMetrics);
      } catch (err) {
        // Project may have been deleted during collection, skip it
        console.warn(`Skipping project ${project.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return metrics;
  }

  /**
   * Collects system-wide metrics across all projects.
   */
  async collectSystemMetrics(): Promise<SystemMetrics> {
    // Get all active projects count
    const { data: projects, error: projectsError } = await this.client
      .from('tc_projects')
      .select('id')
      .eq('status', 'active');

    if (projectsError) {
      throw new Error(`Failed to get projects: ${projectsError.message}`);
    }

    const totalProjects = projects?.length || 0;

    // Get all tasks
    const { data: tasks, error: tasksError } = await this.client
      .from('tc_tasks')
      .select('*');

    if (tasksError) {
      throw new Error(`Failed to get tasks: ${tasksError.message}`);
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Count tasks by status
    const totalTasksQueued = tasks.filter(t => t.status === 'queued').length;
    const totalTasksInProgress = tasks.filter(t => t.status === 'in_progress' || t.status === 'assigned').length;
    const totalTasksBlocked = tasks.filter(t => t.status === 'blocked').length;
    const totalTasksCompletedToday = tasks.filter(t =>
      t.status === 'complete' && t.completed_at && t.completed_at >= todayStart
    ).length;
    const totalTasksCompletedThisWeek = tasks.filter(t =>
      t.status === 'complete' && t.completed_at && t.completed_at >= weekStart
    ).length;

    // Sum token usage
    const totalTokensOpus = tasks.reduce((sum, t) => sum + (t.actual_tokens_opus || 0), 0);
    const totalTokensSonnet = tasks.reduce((sum, t) => sum + (t.actual_tokens_sonnet || 0), 0);

    // Get total sessions
    const { data: sessions, error: sessionsError } = await this.client
      .from('tc_agent_sessions')
      .select('id, model');

    const totalSessions = sessionsError ? 0 : (sessions?.length || 0);

    // Calculate utilization (based on estimated vs actual sessions)
    const estimatedOpus = tasks.reduce((sum, t) => sum + (t.estimated_sessions_opus || 0), 0);
    const actualOpus = tasks.reduce((sum, t) => sum + (t.actual_sessions_opus || 0), 0);
    const estimatedSonnet = tasks.reduce((sum, t) => sum + (t.estimated_sessions_sonnet || 0), 0);
    const actualSonnet = tasks.reduce((sum, t) => sum + (t.actual_sessions_sonnet || 0), 0);

    // Utilization as percentage of estimated capacity used
    const opusUtilization = estimatedOpus > 0 ? Math.min(100, (actualOpus / estimatedOpus) * 100) : 0;
    const sonnetUtilization = estimatedSonnet > 0 ? Math.min(100, (actualSonnet / estimatedSonnet) * 100) : 0;

    return {
      totalProjects,
      totalTasksQueued,
      totalTasksInProgress,
      totalTasksBlocked,
      totalTasksCompletedToday,
      totalTasksCompletedThisWeek,
      totalTokensOpus,
      totalTokensSonnet,
      totalSessions,
      opusUtilization,
      sonnetUtilization
    };
  }

  /**
   * Gets count of tasks completed in a given time period.
   */
  async getTasksCompletedInPeriod(period: TimePeriod): Promise<number> {
    const now = new Date();
    let startDate: string;

    if (period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    const { data: tasks, error } = await this.client
      .from('tc_tasks')
      .select('id')
      .eq('status', 'complete')
      .gte('completed_at', startDate);

    if (error) {
      throw new Error(`Failed to get completed tasks: ${error.message}`);
    }

    return tasks?.length || 0;
  }

  /**
   * Compares estimated vs actual session usage for a project.
   */
  async compareEstimatesVsActuals(projectId: string): Promise<EstimateComparison> {
    const { data: tasks, error } = await this.client
      .from('tc_tasks')
      .select('estimated_sessions_opus, actual_sessions_opus, estimated_sessions_sonnet, actual_sessions_sonnet')
      .eq('project_id', projectId)
      .eq('status', 'complete');

    if (error) {
      throw new Error(`Failed to get tasks for comparison: ${error.message}`);
    }

    const estimatedSessionsOpus = tasks.reduce((sum, t) => sum + (t.estimated_sessions_opus || 0), 0);
    const actualSessionsOpus = tasks.reduce((sum, t) => sum + (t.actual_sessions_opus || 0), 0);
    const estimatedSessionsSonnet = tasks.reduce((sum, t) => sum + (t.estimated_sessions_sonnet || 0), 0);
    const actualSessionsSonnet = tasks.reduce((sum, t) => sum + (t.actual_sessions_sonnet || 0), 0);

    const totalEstimated = estimatedSessionsOpus + estimatedSessionsSonnet;
    const totalActual = actualSessionsOpus + actualSessionsSonnet;

    // Variance: positive = under budget (good), negative = over budget
    const variance = totalEstimated > 0
      ? ((totalEstimated - totalActual) / totalEstimated) * 100
      : 0;

    return {
      projectId,
      estimatedSessionsOpus,
      actualSessionsOpus,
      estimatedSessionsSonnet,
      actualSessionsSonnet,
      variance
    };
  }
}
