import { Request, Response, RequestHandler } from 'express';
import { ProjectRepository } from '../../db/repositories/projects.js';
import { TaskRepository } from '../../db/repositories/tasks.js';
import { MetricsCollector } from '../../reporter/metrics-collector.js';
import { RecommendationEngine, Recommendation } from '../../reporter/recommendation-engine.js';
import { AgentManager } from '../../agent/manager.js';
import { Scheduler } from '../../scheduler/scheduler.js';
import { CapacityStats } from '../../scheduler/capacity-tracker.js';

/**
 * System status response interface
 */
export interface SystemStatus {
  running: boolean;
  uptime: number;
  capacity: CapacityStats;
  todayStats: {
    tasksCompleted: number;
    tokensUsed: number;
    costUsd: number;
    interventions: number;
  };
}

/**
 * Project summary for dashboard display
 */
export interface ProjectSummary {
  id: string;
  name: string;
  status: 'active' | 'paused';
  activeAgents: number;
  queuedTasks: number;
  blockedTasks: number;
  roi: number;
  costToday: number;
}

/**
 * Cost calculation constants (USD per 1M tokens)
 */
const TOKEN_COSTS = {
  opus: {
    input: 15.00,
    output: 75.00,
  },
  sonnet: {
    input: 3.00,
    output: 15.00,
  },
};

/**
 * Calculate cost in USD for token usage
 * Assumes 50/50 input/output split for simplicity
 */
export function calculateCost(tokens: number, model: 'opus' | 'sonnet'): number {
  if (tokens === 0) return 0;
  const inputTokens = tokens / 2;
  const outputTokens = tokens / 2;
  const costs = TOKEN_COSTS[model];
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

type BroadcastEventFn = (eventType: string, data: unknown) => void;

/**
 * Create handler for GET /api/status
 */
export function createStatusHandler(
  scheduler: Scheduler,
  metricsCollector: MetricsCollector,
  startTime: Date | null
): RequestHandler {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const schedulerStats = scheduler.getStats();
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      const opusCost = calculateCost(systemMetrics.totalTokensOpus, 'opus');
      const sonnetCost = calculateCost(systemMetrics.totalTokensSonnet, 'sonnet');
      const totalCost = opusCost + sonnetCost;

      const status: SystemStatus = {
        running: true,
        uptime: startTime ? Date.now() - startTime.getTime() : 0,
        capacity: schedulerStats.capacity,
        todayStats: {
          tasksCompleted: systemMetrics.totalTasksCompletedToday,
          tokensUsed: systemMetrics.totalTokensOpus + systemMetrics.totalTokensSonnet,
          costUsd: totalCost,
          interventions: systemMetrics.totalTasksBlocked,
        },
      };

      res.json(status);
    } catch (error) {
      console.error('Error getting status:', error);
      res.status(500).json({ error: 'Failed to get system status' });
    }
  };
}

/**
 * Create handler for GET /api/projects
 */
export function createProjectsHandler(
  projectRepo: ProjectRepository,
  metricsCollector: MetricsCollector,
  agentManager: AgentManager
): RequestHandler {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const projects = await projectRepo.listActive();
      const projectMetrics = await metricsCollector.collectAllProjectMetrics();

      const summaries: ProjectSummary[] = projects.map(project => {
        const metrics = projectMetrics.find(m => m.projectId === project.id);

        return {
          id: project.id,
          name: project.name,
          status: project.status as 'active' | 'paused',
          activeAgents: metrics?.sessionsCount || 0,
          queuedTasks: metrics?.tasksQueued || 0,
          blockedTasks: metrics?.tasksBlocked || 0,
          roi: metrics?.completionRate || 0,
          costToday: calculateCost(metrics?.tokensOpus || 0, 'opus') +
                     calculateCost(metrics?.tokensSonnet || 0, 'sonnet'),
        };
      });

      res.json(summaries);
    } catch (error) {
      console.error('Error getting projects:', error);
      res.status(500).json({ error: 'Failed to get projects' });
    }
  };
}

/**
 * Create handler for GET /api/projects/:id
 */
export function createProjectHandler(
  projectRepo: ProjectRepository,
  metricsCollector: MetricsCollector,
  taskRepo: TaskRepository
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = req.params.id as string;
      const project = await projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const metrics = await metricsCollector.collectProjectMetrics(project.id);
      const tasks = await taskRepo.getByProject(project.id);

      res.json({
        project,
        metrics,
        tasks,
      });
    } catch (error) {
      console.error('Error getting project:', error);
      res.status(500).json({ error: 'Failed to get project details' });
    }
  };
}

/**
 * Create handler for GET /api/agents
 */
export function createAgentsHandler(
  agentManager: AgentManager,
  taskRepo: TaskRepository
): RequestHandler {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const sessions = agentManager.getActiveSessions();

      const agentInfo = await Promise.all(
        sessions.map(async session => {
          let taskInfo = null;
          if (session.taskId) {
            const task = await taskRepo.getById(session.taskId);
            if (task) {
              taskInfo = {
                id: task.id,
                title: task.title,
                projectId: task.project_id,
              };
            }
          }

          return {
            sessionId: session.id,
            model: session.model,
            status: session.status,
            startedAt: session.startedAt,
            tokensUsed: session.tokensUsed,
            task: taskInfo,
          };
        })
      );

      res.json(agentInfo);
    } catch (error) {
      console.error('Error getting agents:', error);
      res.status(500).json({ error: 'Failed to get agents' });
    }
  };
}

/**
 * Create handler for GET /api/tasks
 */
export function createTasksHandler(taskRepo: TaskRepository): RequestHandler {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const tasks = await taskRepo.getQueued();
      res.json(tasks);
    } catch (error) {
      console.error('Error getting tasks:', error);
      res.status(500).json({ error: 'Failed to get tasks' });
    }
  };
}

/**
 * Create handler for GET /api/metrics
 */
export function createMetricsHandler(metricsCollector: MetricsCollector): RequestHandler {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const systemMetrics = await metricsCollector.collectSystemMetrics();
      const projectMetrics = await metricsCollector.collectAllProjectMetrics();

      const opusCost = calculateCost(systemMetrics.totalTokensOpus, 'opus');
      const sonnetCost = calculateCost(systemMetrics.totalTokensSonnet, 'sonnet');

      const costBreakdown = {
        opus: {
          tokens: systemMetrics.totalTokensOpus,
          cost: opusCost,
        },
        sonnet: {
          tokens: systemMetrics.totalTokensSonnet,
          cost: sonnetCost,
        },
        total: opusCost + sonnetCost,
      };

      const projectCosts = projectMetrics.map(pm => ({
        projectId: pm.projectId,
        projectName: pm.projectName,
        opusCost: calculateCost(pm.tokensOpus, 'opus'),
        sonnetCost: calculateCost(pm.tokensSonnet, 'sonnet'),
        totalCost: calculateCost(pm.tokensOpus, 'opus') +
                   calculateCost(pm.tokensSonnet, 'sonnet'),
        completionRate: pm.completionRate,
      }));

      res.json({
        system: systemMetrics,
        costBreakdown,
        projectCosts,
      });
    } catch (error) {
      console.error('Error getting metrics:', error);
      res.status(500).json({ error: 'Failed to get metrics' });
    }
  };
}

/**
 * Create handler for GET /api/recommendations
 */
export function createRecommendationsHandler(
  metricsCollector: MetricsCollector,
  recommendationEngine: RecommendationEngine
): RequestHandler {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const projectMetrics = await metricsCollector.collectAllProjectMetrics();
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      const report = recommendationEngine.generateReport(projectMetrics, systemMetrics);

      const recommendations: Recommendation[] = [];
      for (const [, recs] of report.projectRecommendations) {
        recommendations.push(...recs);
      }
      recommendations.push(...report.systemRecommendations);

      const priorityOrder = { critical: 0, warning: 1, info: 2, positive: 3 };
      recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      res.json({
        recommendations,
        actionItems: report.actionItems,
      });
    } catch (error) {
      console.error('Error getting recommendations:', error);
      res.status(500).json({ error: 'Failed to get recommendations' });
    }
  };
}

/**
 * Create handler for POST /api/tasks/:id/priority
 */
export function createUpdateTaskPriorityHandler(
  taskRepo: TaskRepository,
  broadcastEvent: BroadcastEventFn
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const taskId = req.params.id as string;
      const { priority } = req.body;

      if (typeof priority !== 'number') {
        res.status(400).json({ error: 'Priority must be a number' });
        return;
      }

      const task = await taskRepo.getById(taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const updated = await taskRepo.update(taskId, { priority });
      res.json(updated);

      broadcastEvent('taskUpdated', { taskId, priority });
    } catch (error) {
      console.error('Error updating task priority:', error);
      res.status(500).json({ error: 'Failed to update task priority' });
    }
  };
}

/**
 * Create handler for POST /api/projects/:id/pause
 */
export function createPauseProjectHandler(
  projectRepo: ProjectRepository,
  broadcastEvent: BroadcastEventFn
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = req.params.id as string;
      const project = await projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const updated = await projectRepo.updateStatus(projectId, 'paused');
      res.json(updated);

      broadcastEvent('projectPaused', { projectId });
    } catch (error) {
      console.error('Error pausing project:', error);
      res.status(500).json({ error: 'Failed to pause project' });
    }
  };
}

/**
 * Create handler for POST /api/projects/:id/resume
 */
export function createResumeProjectHandler(
  projectRepo: ProjectRepository,
  broadcastEvent: BroadcastEventFn
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = req.params.id as string;
      const project = await projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const updated = await projectRepo.updateStatus(projectId, 'active');
      res.json(updated);

      broadcastEvent('projectResumed', { projectId });
    } catch (error) {
      console.error('Error resuming project:', error);
      res.status(500).json({ error: 'Failed to resume project' });
    }
  };
}
