import express, { Application, Request, Response, NextFunction } from 'express';
import { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectRepository } from '../db/repositories/projects.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { MetricsCollector } from '../reporter/metrics-collector.js';
import { RecommendationEngine } from '../reporter/recommendation-engine.js';
import { AgentManager } from '../agent/manager.js';
import { Scheduler } from '../scheduler/scheduler.js';
import { CostTracker } from '../analytics/cost-tracker.js';
import {
  createStatusHandler,
  createProjectsHandler,
  createProjectHandler,
  createAgentsHandler,
  createTasksHandler,
  createMetricsHandler,
  createRecommendationsHandler,
  createUpdateTaskPriorityHandler,
  createPauseProjectHandler,
  createResumeProjectHandler,
} from './routes/api.js';
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
    const { scheduler, metricsCollector, costTracker, projectRepo, taskRepo,
            agentManager, recommendationEngine } = this.config;
    const broadcastEvent = this.broadcastEvent.bind(this);

    this.app.get('/', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'views', 'index.html'));
    });

    // Status handler needs current startTime, so create handler per-request
    this.app.get('/api/status', (req: Request, res: Response, next: NextFunction) => {
      const handler = createStatusHandler(scheduler, metricsCollector, this.startTime, costTracker);
      return handler(req, res, next);
    });

    this.app.get('/api/projects', createProjectsHandler(projectRepo, metricsCollector, agentManager, costTracker));
    this.app.get('/api/projects/:id', createProjectHandler(projectRepo, metricsCollector, taskRepo));
    this.app.get('/api/agents', createAgentsHandler(agentManager, taskRepo));
    this.app.get('/api/tasks', createTasksHandler(taskRepo));
    this.app.get('/api/metrics', createMetricsHandler(metricsCollector, costTracker));
    this.app.get('/api/recommendations', createRecommendationsHandler(metricsCollector, recommendationEngine));
    this.app.get('/api/events', this.handleSSE.bind(this));

    this.app.post('/api/tasks/:id/priority', createUpdateTaskPriorityHandler(taskRepo, broadcastEvent));
    this.app.post('/api/projects/:id/pause', createPauseProjectHandler(projectRepo, broadcastEvent));
    this.app.post('/api/projects/:id/resume', createResumeProjectHandler(projectRepo, broadcastEvent));

    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      log.error('Dashboard server error', err);
      res.status(500).json({ error: 'Internal server error' });
    });
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
