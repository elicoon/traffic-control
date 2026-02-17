import express, { Application, Request, Response, NextFunction } from 'express';
import { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectRepository, Project } from '../db/repositories/projects.js';
import { TaskRepository, Task } from '../db/repositories/tasks.js';
import { MetricsCollector, SystemMetrics, ProjectMetrics } from '../reporter/metrics-collector.js';
import { RecommendationEngine, RecommendationReport, Recommendation } from '../reporter/recommendation-engine.js';
import { AgentManager } from '../agent/manager.js';
import { Scheduler, SchedulerStats } from '../scheduler/scheduler.js';
import { CapacityStats } from '../scheduler/capacity-tracker.js';
import { CostTracker } from '../analytics/cost-tracker.js';
import { calculateTokenCost } from './routes/api.js';
import { logger } from '../logging/index.js';

const log = logger.child('DashboardServer');

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration for the dashboard server
 */
export interface DashboardServerConfig {
  port: number;
  projectRepo: ProjectRepository;
  taskRepo: TaskRepository;
  metricsCollector: MetricsCollector;
  recommendationEngine: RecommendationEngine;
  agentManager: AgentManager;
  scheduler: Scheduler;
  costTracker: CostTracker;
}

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
 * SSE client connection tracking
 */
interface SSEClient {
  id: string;
  res: Response;
}

/**
 * Dashboard server that provides REST API and SSE for real-time updates
 */
export class DashboardServer {
  private app: Application;
  private server: Server | null = null;
  private config: DashboardServerConfig;
  private startTime: Date | null = null;
  private sseClients: Map<string, SSEClient> = new Map();
  private sseClientIdCounter = 0;

  constructor(config: DashboardServerConfig) {
    this.config = config;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',') || [];
      const origin = _req.headers.origin;

      if (process.env.NODE_ENV === 'production') {
        if (origin && allowedOrigins.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
        }
      } else {
        res.header('Access-Control-Allow-Origin', '*');
      }

      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });
  }

  private setupRoutes(): void {
    this.app.get('/', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'views', 'index.html'));
    });

    this.app.get('/api/status', this.handleGetStatus.bind(this));
    this.app.get('/api/projects', this.handleGetProjects.bind(this));
    this.app.get('/api/projects/:id', this.handleGetProject.bind(this));
    this.app.get('/api/agents', this.handleGetAgents.bind(this));
    this.app.get('/api/tasks', this.handleGetTasks.bind(this));
    this.app.get('/api/metrics', this.handleGetMetrics.bind(this));
    this.app.get('/api/recommendations', this.handleGetRecommendations.bind(this));
    this.app.get('/api/events', this.handleSSE.bind(this));

    this.app.post('/api/tasks/:id/priority', this.handleUpdateTaskPriority.bind(this));
    this.app.post('/api/projects/:id/pause', this.handlePauseProject.bind(this));
    this.app.post('/api/projects/:id/resume', this.handleResumeProject.bind(this));

    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      log.error('Dashboard server error', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  private async handleGetStatus(_req: Request, res: Response): Promise<void> {
    try {
      const schedulerStats = this.config.scheduler.getStats();
      const systemMetrics = await this.config.metricsCollector.collectSystemMetrics();

      const opusCost = await calculateTokenCost(this.config.costTracker, systemMetrics.totalTokensOpus, 'opus');
      const sonnetCost = await calculateTokenCost(this.config.costTracker, systemMetrics.totalTokensSonnet, 'sonnet');
      const totalCost = opusCost + sonnetCost;

      const status: SystemStatus = {
        running: this.isRunning(),
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
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
      log.error('Error getting status', error as Error);
      res.status(500).json({ error: 'Failed to get system status' });
    }
  }

  private async handleGetProjects(_req: Request, res: Response): Promise<void> {
    try {
      const projects = await this.config.projectRepo.listActive();
      const projectMetrics = await this.config.metricsCollector.collectAllProjectMetrics();

      const summaries: ProjectSummary[] = await Promise.all((projects || []).map(async project => {
        const metrics = (projectMetrics || []).find(m => m.projectId === project.id);

        const opusCost = await calculateTokenCost(this.config.costTracker, metrics?.tokensOpus || 0, 'opus');
        const sonnetCost = await calculateTokenCost(this.config.costTracker, metrics?.tokensSonnet || 0, 'sonnet');

        return {
          id: project.id,
          name: project.name,
          status: project.status as 'active' | 'paused',
          activeAgents: metrics?.sessionsCount || 0,
          queuedTasks: metrics?.tasksQueued || 0,
          blockedTasks: metrics?.tasksBlocked || 0,
          roi: metrics?.completionRate || 0,
          costToday: opusCost + sonnetCost,
        };
      }));

      res.json(summaries);
    } catch (error) {
      log.error('Error getting projects', error as Error);
      res.status(500).json({ error: 'Failed to get projects' });
    }
  }

  private async handleGetProject(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params.id as string;
      const project = await this.config.projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const metrics = await this.config.metricsCollector.collectProjectMetrics(project.id);
      const tasks = await this.config.taskRepo.getByProject(project.id);

      res.json({ project, metrics, tasks });
    } catch (error) {
      log.error('Error getting project', error as Error);
      res.status(500).json({ error: 'Failed to get project details' });
    }
  }

  private async handleGetAgents(_req: Request, res: Response): Promise<void> {
    try {
      const sessions = this.config.agentManager.getActiveSessions();

      const agentInfo = await Promise.all(
        sessions.map(async session => {
          let taskInfo = null;
          if (session.taskId) {
            const task = await this.config.taskRepo.getById(session.taskId);
            if (task) {
              taskInfo = { id: task.id, title: task.title, projectId: task.project_id };
            }
          }
          return {
            sessionId: session.id, model: session.model, status: session.status,
            startedAt: session.startedAt, tokensUsed: session.tokensUsed, task: taskInfo,
          };
        })
      );

      res.json(agentInfo);
    } catch (error) {
      log.error('Error getting agents', error as Error);
      res.status(500).json({ error: 'Failed to get agents' });
    }
  }

  private async handleGetTasks(_req: Request, res: Response): Promise<void> {
    try {
      const tasks = await this.config.taskRepo.getQueued();
      res.json(tasks);
    } catch (error) {
      log.error('Error getting tasks', error as Error);
      res.status(500).json({ error: 'Failed to get tasks' });
    }
  }

  private async handleGetMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const systemMetrics = await this.config.metricsCollector.collectSystemMetrics();
      const projectMetrics = await this.config.metricsCollector.collectAllProjectMetrics();

      const opusCost = await calculateTokenCost(this.config.costTracker, systemMetrics.totalTokensOpus, 'opus');
      const sonnetCost = await calculateTokenCost(this.config.costTracker, systemMetrics.totalTokensSonnet, 'sonnet');

      const costBreakdown = {
        opus: { tokens: systemMetrics.totalTokensOpus, cost: opusCost },
        sonnet: { tokens: systemMetrics.totalTokensSonnet, cost: sonnetCost },
        total: opusCost + sonnetCost,
      };

      const projectCosts = await Promise.all(projectMetrics.map(async pm => {
        const pmOpusCost = await calculateTokenCost(this.config.costTracker, pm.tokensOpus, 'opus');
        const pmSonnetCost = await calculateTokenCost(this.config.costTracker, pm.tokensSonnet, 'sonnet');
        return {
          projectId: pm.projectId, projectName: pm.projectName,
          opusCost: pmOpusCost, sonnetCost: pmSonnetCost,
          totalCost: pmOpusCost + pmSonnetCost, completionRate: pm.completionRate,
        };
      }));

      res.json({ system: systemMetrics, costBreakdown, projectCosts });
    } catch (error) {
      log.error('Error getting metrics', error as Error);
      res.status(500).json({ error: 'Failed to get metrics' });
    }
  }

  private async handleGetRecommendations(_req: Request, res: Response): Promise<void> {
    try {
      const projectMetrics = await this.config.metricsCollector.collectAllProjectMetrics();
      const systemMetrics = await this.config.metricsCollector.collectSystemMetrics();

      const report = this.config.recommendationEngine.generateReport(projectMetrics, systemMetrics);

      const recommendations: Recommendation[] = [];
      for (const [, recs] of report.projectRecommendations) {
        recommendations.push(...recs);
      }
      recommendations.push(...report.systemRecommendations);

      const priorityOrder = { critical: 0, warning: 1, info: 2, positive: 3 };
      recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      res.json({ recommendations, actionItems: report.actionItems });
    } catch (error) {
      log.error('Error getting recommendations', error as Error);
      res.status(500).json({ error: 'Failed to get recommendations' });
    }
  }

  private async handleUpdateTaskPriority(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.id as string;
      const { priority } = req.body;

      if (typeof priority !== 'number') {
        res.status(400).json({ error: 'Priority must be a number' });
        return;
      }

      const task = await this.config.taskRepo.getById(taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const updated = await this.config.taskRepo.update(taskId, { priority });
      res.json(updated);
      this.broadcastEvent('taskUpdated', { taskId, priority });
    } catch (error) {
      log.error('Error updating task priority', error as Error);
      res.status(500).json({ error: 'Failed to update task priority' });
    }
  }

  private async handlePauseProject(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params.id as string;
      const project = await this.config.projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const updated = await this.config.projectRepo.updateStatus(projectId, 'paused');
      res.json(updated);
      this.broadcastEvent('projectPaused', { projectId });
    } catch (error) {
      log.error('Error pausing project', error as Error);
      res.status(500).json({ error: 'Failed to pause project' });
    }
  }

  private async handleResumeProject(req: Request, res: Response): Promise<void> {
    try {
      const projectId = req.params.id as string;
      const project = await this.config.projectRepo.getById(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const updated = await this.config.projectRepo.updateStatus(projectId, 'active');
      res.json(updated);
      this.broadcastEvent('projectResumed', { projectId });
    } catch (error) {
      log.error('Error resuming project', error as Error);
      res.status(500).json({ error: 'Failed to resume project' });
    }
  }

  private handleSSE(req: Request, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write('event: connected\n');
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    const clientId = `client-${++this.sseClientIdCounter}`;
    this.sseClients.set(clientId, { id: clientId, res });

    const heartbeat = setInterval(() => {
      if (this.sseClients.has(clientId)) {
        res.write(': heartbeat\n\n');
      } else {
        clearInterval(heartbeat);
      }
    }, 30000);

    req.on('close', () => {
      this.sseClients.delete(clientId);
      clearInterval(heartbeat);
    });
  }

  public broadcastEvent(eventType: string, data: unknown): void {
    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const [, client] of this.sseClients) {
      try {
        client.res.write(message);
      } catch (error) {
        log.error(`Failed to send to client ${client.id}`, error as Error);
        this.sseClients.delete(client.id);
      }
    }
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, () => {
          this.startTime = new Date();
          const address = this.server?.address();
          const port = typeof address === 'object' && address ? address.port : this.config.port;
          log.info(`Dashboard server started on port ${port}`);
          resolve();
        });

        this.server.on('error', (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    for (const [, client] of this.sseClients) {
      try {
        client.res.end();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    this.sseClients.clear();

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.server = null;
          this.startTime = null;
          resolve();
        }
      });
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getApp(): Application {
    return this.app;
  }

  getAddress(): AddressInfo | null {
    if (!this.server) {
      return null;
    }
    return this.server.address() as AddressInfo;
  }
}
