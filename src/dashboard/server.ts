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
 * Cost calculation constants (USD per 1M tokens)
 * Note: These are hardcoded for dashboard display performance.
 * For historical cost accuracy with database lookups, use CostTracker from analytics module.
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

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // CORS for development
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });
  }

  /**
   * Setup all routes
   */
  private setupRoutes(): void {
    // Serve dashboard HTML
    this.app.get('/', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'views', 'index.html'));
    });

    // API Routes
    this.app.get('/api/status', this.handleGetStatus.bind(this));
    this.app.get('/api/projects', this.handleGetProjects.bind(this));
    this.app.get('/api/projects/:id', this.handleGetProject.bind(this));
    this.app.get('/api/agents', this.handleGetAgents.bind(this));
    this.app.get('/api/tasks', this.handleGetTasks.bind(this));
    this.app.get('/api/metrics', this.handleGetMetrics.bind(this));
    this.app.get('/api/recommendations', this.handleGetRecommendations.bind(this));
    this.app.get('/api/events', this.handleSSE.bind(this));

    // Action routes
    this.app.post('/api/tasks/:id/priority', this.handleUpdateTaskPriority.bind(this));
    this.app.post('/api/projects/:id/pause', this.handlePauseProject.bind(this));
    this.app.post('/api/projects/:id/resume', this.handleResumeProject.bind(this));

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('Dashboard server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * GET /api/status - Get overall system status
   */
  private async handleGetStatus(_req: Request, res: Response): Promise<void> {
    try {
      const schedulerStats = this.config.scheduler.getStats();
      const systemMetrics = await this.config.metricsCollector.collectSystemMetrics();

      // Calculate cost
      const opusCost = this.calculateCost(systemMetrics.totalTokensOpus, 'opus');
      const sonnetCost = this.calculateCost(systemMetrics.totalTokensSonnet, 'sonnet');
      const totalCost = opusCost + sonnetCost;

      const status: SystemStatus = {
        running: this.isRunning(),
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
        capacity: schedulerStats.capacity,
        todayStats: {
          tasksCompleted: systemMetrics.totalTasksCompletedToday,
          tokensUsed: systemMetrics.totalTokensOpus + systemMetrics.totalTokensSonnet,
          costUsd: totalCost,
          interventions: systemMetrics.totalTasksBlocked, // Blocked tasks represent interventions needed
        },
      };

      res.json(status);
    } catch (error) {
      console.error('Error getting status:', error);
      res.status(500).json({ error: 'Failed to get system status' });
    }
  }

  /**
   * GET /api/projects - List projects with stats
   */
  private async handleGetProjects(_req: Request, res: Response): Promise<void> {
    try {
      const projects = await this.config.projectRepo.listActive();
      const projectMetrics = await this.config.metricsCollector.collectAllProjectMetrics();

      const summaries: ProjectSummary[] = (projects || []).map(project => {
        const metrics = (projectMetrics || []).find(m => m.projectId === project.id);

        return {
          id: project.id,
          name: project.name,
          status: project.status as 'active' | 'paused',
          activeAgents: metrics?.sessionsCount || 0,
          queuedTasks: metrics?.tasksQueued || 0,
          blockedTasks: metrics?.tasksBlocked || 0,
          roi: metrics?.completionRate || 0,
          costToday: this.calculateCost(metrics?.tokensOpus || 0, 'opus') +
                     this.calculateCost(metrics?.tokensSonnet || 0, 'sonnet'),
        };
      });

      res.json(summaries);
    } catch (error) {
      console.error('Error getting projects:', error);
      res.status(500).json({ error: 'Failed to get projects' });
    }
  }

  /**
   * GET /api/projects/:id - Get project details
   */
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

      res.json({
        project,
        metrics,
        tasks,
      });
    } catch (error) {
      console.error('Error getting project:', error);
      res.status(500).json({ error: 'Failed to get project details' });
    }
  }

  /**
   * GET /api/agents - List active agent sessions
   */
  private async handleGetAgents(_req: Request, res: Response): Promise<void> {
    try {
      const sessions = this.config.agentManager.getActiveSessions();

      const agentInfo = await Promise.all(
        sessions.map(async session => {
          let taskInfo = null;
          if (session.taskId) {
            const task = await this.config.taskRepo.getById(session.taskId);
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
  }

  /**
   * GET /api/tasks - Get task queue with priorities
   */
  private async handleGetTasks(_req: Request, res: Response): Promise<void> {
    try {
      const tasks = await this.config.taskRepo.getQueued();
      res.json(tasks);
    } catch (error) {
      console.error('Error getting tasks:', error);
      res.status(500).json({ error: 'Failed to get tasks' });
    }
  }

  /**
   * GET /api/metrics - Get ROI and cost metrics
   */
  private async handleGetMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const systemMetrics = await this.config.metricsCollector.collectSystemMetrics();
      const projectMetrics = await this.config.metricsCollector.collectAllProjectMetrics();

      // Calculate cost breakdown
      const opusCost = this.calculateCost(systemMetrics.totalTokensOpus, 'opus');
      const sonnetCost = this.calculateCost(systemMetrics.totalTokensSonnet, 'sonnet');

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

      // Project-level breakdown
      const projectCosts = projectMetrics.map(pm => ({
        projectId: pm.projectId,
        projectName: pm.projectName,
        opusCost: this.calculateCost(pm.tokensOpus, 'opus'),
        sonnetCost: this.calculateCost(pm.tokensSonnet, 'sonnet'),
        totalCost: this.calculateCost(pm.tokensOpus, 'opus') +
                   this.calculateCost(pm.tokensSonnet, 'sonnet'),
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
  }

  /**
   * GET /api/recommendations - Get current recommendations
   */
  private async handleGetRecommendations(_req: Request, res: Response): Promise<void> {
    try {
      const projectMetrics = await this.config.metricsCollector.collectAllProjectMetrics();
      const systemMetrics = await this.config.metricsCollector.collectSystemMetrics();

      const report = this.config.recommendationEngine.generateReport(projectMetrics, systemMetrics);

      // Convert Map to array for JSON serialization
      const recommendations: Recommendation[] = [];
      for (const [, recs] of report.projectRecommendations) {
        recommendations.push(...recs);
      }
      recommendations.push(...report.systemRecommendations);

      // Sort by priority
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
  }

  /**
   * POST /api/tasks/:id/priority - Update task priority
   */
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

      // Broadcast update to SSE clients
      this.broadcastEvent('taskUpdated', { taskId, priority });
    } catch (error) {
      console.error('Error updating task priority:', error);
      res.status(500).json({ error: 'Failed to update task priority' });
    }
  }

  /**
   * POST /api/projects/:id/pause - Pause a project
   */
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

      // Broadcast update to SSE clients
      this.broadcastEvent('projectPaused', { projectId });
    } catch (error) {
      console.error('Error pausing project:', error);
      res.status(500).json({ error: 'Failed to pause project' });
    }
  }

  /**
   * POST /api/projects/:id/resume - Resume a paused project
   */
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

      // Broadcast update to SSE clients
      this.broadcastEvent('projectResumed', { projectId });
    } catch (error) {
      console.error('Error resuming project:', error);
      res.status(500).json({ error: 'Failed to resume project' });
    }
  }

  /**
   * GET /api/events - Server-Sent Events endpoint
   */
  private handleSSE(req: Request, res: Response): void {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial connection event
    res.write('event: connected\n');
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    // Track client
    const clientId = `client-${++this.sseClientIdCounter}`;
    this.sseClients.set(clientId, { id: clientId, res });

    // Keep connection alive with periodic heartbeat
    const heartbeat = setInterval(() => {
      if (this.sseClients.has(clientId)) {
        res.write(': heartbeat\n\n');
      } else {
        clearInterval(heartbeat);
      }
    }, 30000);

    // Handle client disconnect - consolidated into single handler
    req.on('close', () => {
      this.sseClients.delete(clientId);
      clearInterval(heartbeat);
    });
  }

  /**
   * Broadcast an event to all SSE clients
   */
  public broadcastEvent(eventType: string, data: unknown): void {
    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const [, client] of this.sseClients) {
      try {
        client.res.write(message);
      } catch (error) {
        console.error(`Failed to send to client ${client.id}:`, error);
        this.sseClients.delete(client.id);
      }
    }
  }

  /**
   * Calculate cost in USD for token usage
   */
  private calculateCost(tokens: number, model: 'opus' | 'sonnet'): number {
    // Assume 50/50 input/output split for simplicity
    const inputTokens = tokens / 2;
    const outputTokens = tokens / 2;

    const costs = TOKEN_COSTS[model];
    return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
  }

  /**
   * Start the dashboard server
   */
  async start(): Promise<void> {
    if (this.server) {
      return; // Already running
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, () => {
          this.startTime = new Date();
          const address = this.server!.address() as AddressInfo;
          console.log(`Dashboard server started on port ${address.port}`);
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

  /**
   * Stop the dashboard server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    // Close all SSE connections
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

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Get the Express app instance (for testing)
   */
  getApp(): Application {
    return this.app;
  }

  /**
   * Get the server address (for testing)
   */
  getAddress(): AddressInfo | null {
    if (!this.server) {
      return null;
    }
    return this.server.address() as AddressInfo;
  }
}
