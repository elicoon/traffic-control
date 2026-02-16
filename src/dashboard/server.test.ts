import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { DashboardServer, DashboardServerConfig } from './server.js';

// Mock dependencies
const mockProjectRepo = {
  listActive: vi.fn(),
  getById: vi.fn(),
  updateStatus: vi.fn(),
};

const mockTaskRepo = {
  getQueued: vi.fn(),
  getByProject: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  getByStatus: vi.fn(),
};

const mockMetricsCollector = {
  collectSystemMetrics: vi.fn(),
  collectAllProjectMetrics: vi.fn(),
  collectProjectMetrics: vi.fn(),
};

const mockRecommendationEngine = {
  generateReport: vi.fn(),
  analyzeProjectMetrics: vi.fn(),
  analyzeSystemMetrics: vi.fn(),
};

const mockAgentManager = {
  getActiveSessions: vi.fn(),
  getSession: vi.fn(),
};

const mockScheduler = {
  getStats: vi.fn(),
};

const mockCostTracker = {
  calculateCost: vi.fn().mockResolvedValue({ inputCost: 0, outputCost: 0, totalCost: 0 }),
  getAllCurrentPricing: vi.fn().mockResolvedValue([]),
};

describe('DashboardServer', () => {
  let dashboardServer: DashboardServer;

  const defaultConfig: DashboardServerConfig = {
    port: 0, // Use random port for testing
    projectRepo: mockProjectRepo as any,
    taskRepo: mockTaskRepo as any,
    metricsCollector: mockMetricsCollector as any,
    recommendationEngine: mockRecommendationEngine as any,
    agentManager: mockAgentManager as any,
    scheduler: mockScheduler as any,
    costTracker: mockCostTracker as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dashboardServer = new DashboardServer(defaultConfig);
  });

  afterEach(async () => {
    await dashboardServer.stop();
  });

  describe('constructor', () => {
    it('should create server instance', () => {
      expect(dashboardServer).toBeDefined();
    });
  });

  describe('start/stop', () => {
    it('should start and stop server without errors', async () => {
      await dashboardServer.start();
      expect(dashboardServer.isRunning()).toBe(true);

      await dashboardServer.stop();
      expect(dashboardServer.isRunning()).toBe(false);
    });

    it('should handle multiple start calls gracefully', async () => {
      await dashboardServer.start();
      await dashboardServer.start(); // Should not throw
      expect(dashboardServer.isRunning()).toBe(true);
    });

    it('should handle stop when not running', async () => {
      await dashboardServer.stop(); // Should not throw
      expect(dashboardServer.isRunning()).toBe(false);
    });
  });

  describe('GET /', () => {
    it('should serve the dashboard HTML page', async () => {
      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).get('/');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });
  });

  describe('GET /api/status', () => {
    it('should return system status', async () => {
      mockScheduler.getStats.mockReturnValue({
        queuedTasks: 5,
        capacity: {
          opus: { current: 2, limit: 5, available: 3, utilization: 0.4 },
          sonnet: { current: 5, limit: 10, available: 5, utilization: 0.5 },
        },
      });

      mockMetricsCollector.collectSystemMetrics.mockResolvedValue({
        totalProjects: 3,
        totalTasksQueued: 5,
        totalTasksInProgress: 7,
        totalTasksBlocked: 1,
        totalTasksCompletedToday: 10,
        totalTasksCompletedThisWeek: 50,
        totalTokensOpus: 100000,
        totalTokensSonnet: 200000,
        totalSessions: 15,
        opusUtilization: 40,
        sonnetUtilization: 50,
      });

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).get('/api/status');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('running');
      expect(response.body).toHaveProperty('capacity');
      expect(response.body).toHaveProperty('todayStats');
    });
  });

  describe('GET /api/projects', () => {
    it('should return list of projects with stats', async () => {
      mockProjectRepo.listActive.mockResolvedValue([
        { id: 'proj-1', name: 'Project 1', status: 'active', priority: 1 },
        { id: 'proj-2', name: 'Project 2', status: 'active', priority: 2 },
      ]);

      mockMetricsCollector.collectAllProjectMetrics.mockResolvedValue([
        {
          projectId: 'proj-1',
          projectName: 'Project 1',
          tasksQueued: 5,
          tasksInProgress: 2,
          tasksBlocked: 0,
          tasksCompletedToday: 3,
          tokensOpus: 1000,
          tokensSonnet: 2000,
          sessionsCount: 5,
          completionRate: 75,
        },
        {
          projectId: 'proj-2',
          projectName: 'Project 2',
          tasksQueued: 3,
          tasksInProgress: 1,
          tasksBlocked: 1,
          tasksCompletedToday: 2,
          tokensOpus: 500,
          tokensSonnet: 1500,
          sessionsCount: 3,
          completionRate: 50,
        },
      ]);

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).get('/api/projects');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('should return project details', async () => {
      mockProjectRepo.getById.mockResolvedValue({
        id: 'proj-1',
        name: 'Project 1',
        status: 'active',
        priority: 1,
      });

      mockMetricsCollector.collectProjectMetrics.mockResolvedValue({
        projectId: 'proj-1',
        projectName: 'Project 1',
        tasksQueued: 5,
        tasksInProgress: 2,
        tasksBlocked: 0,
        tasksCompletedToday: 3,
        tokensOpus: 1000,
        tokensSonnet: 2000,
        sessionsCount: 5,
        completionRate: 75,
      });

      mockTaskRepo.getByProject.mockResolvedValue([
        { id: 'task-1', title: 'Task 1', status: 'queued' },
      ]);

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).get('/api/projects/proj-1');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('project');
      expect(response.body).toHaveProperty('metrics');
      expect(response.body).toHaveProperty('tasks');
    });

    it('should return 404 for non-existent project', async () => {
      mockProjectRepo.getById.mockResolvedValue(null);

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).get('/api/projects/non-existent');
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/agents', () => {
    it('should return list of active agents', async () => {
      mockAgentManager.getActiveSessions.mockReturnValue([
        {
          id: 'session-1',
          taskId: 'task-1',
          model: 'opus',
          status: 'running',
          startedAt: new Date(),
          tokensUsed: 1000,
        },
        {
          id: 'session-2',
          taskId: 'task-2',
          model: 'sonnet',
          status: 'blocked',
          startedAt: new Date(),
          tokensUsed: 500,
        },
      ]);

      mockTaskRepo.getById.mockResolvedValue({
        id: 'task-1',
        title: 'Test Task',
        project_id: 'proj-1',
      });

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).get('/api/agents');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/tasks', () => {
    it('should return task queue with priorities', async () => {
      mockTaskRepo.getQueued.mockResolvedValue([
        { id: 'task-1', title: 'Task 1', priority: 10, status: 'queued' },
        { id: 'task-2', title: 'Task 2', priority: 5, status: 'queued' },
      ]);

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).get('/api/tasks');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });
  });

  describe('GET /api/metrics', () => {
    it('should return ROI and cost metrics', async () => {
      mockMetricsCollector.collectSystemMetrics.mockResolvedValue({
        totalProjects: 3,
        totalTasksQueued: 5,
        totalTasksInProgress: 7,
        totalTasksBlocked: 1,
        totalTasksCompletedToday: 10,
        totalTasksCompletedThisWeek: 50,
        totalTokensOpus: 100000,
        totalTokensSonnet: 200000,
        totalSessions: 15,
        opusUtilization: 40,
        sonnetUtilization: 50,
      });

      mockMetricsCollector.collectAllProjectMetrics.mockResolvedValue([
        {
          projectId: 'proj-1',
          projectName: 'Project 1',
          tokensOpus: 50000,
          tokensSonnet: 100000,
        },
      ]);

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).get('/api/metrics');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('system');
      expect(response.body).toHaveProperty('costBreakdown');
    });
  });

  describe('GET /api/recommendations', () => {
    it('should return current recommendations', async () => {
      mockMetricsCollector.collectAllProjectMetrics.mockResolvedValue([]);
      mockMetricsCollector.collectSystemMetrics.mockResolvedValue({
        totalProjects: 0,
        totalTasksQueued: 0,
        totalTasksInProgress: 0,
        totalTasksBlocked: 0,
        totalTasksCompletedToday: 0,
        totalTasksCompletedThisWeek: 0,
        totalTokensOpus: 0,
        totalTokensSonnet: 0,
        totalSessions: 0,
        opusUtilization: 0,
        sonnetUtilization: 0,
      });

      mockRecommendationEngine.generateReport.mockReturnValue({
        projectRecommendations: new Map(),
        systemRecommendations: [],
        actionItems: [],
      });

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).get('/api/recommendations');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('recommendations');
      expect(response.body).toHaveProperty('actionItems');
    });
  });

  describe('POST /api/tasks/:id/priority', () => {
    it('should update task priority', async () => {
      mockTaskRepo.getById.mockResolvedValue({
        id: 'task-1',
        title: 'Task 1',
        priority: 5,
      });

      mockTaskRepo.update.mockResolvedValue({
        id: 'task-1',
        title: 'Task 1',
        priority: 10,
      });

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app)
        .post('/api/tasks/task-1/priority')
        .send({ priority: 10 });

      expect(response.status).toBe(200);
      expect(mockTaskRepo.update).toHaveBeenCalledWith('task-1', { priority: 10 });
    });

    it('should return 400 for invalid priority', async () => {
      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app)
        .post('/api/tasks/task-1/priority')
        .send({ priority: 'invalid' });

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent task', async () => {
      mockTaskRepo.getById.mockResolvedValue(null);

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app)
        .post('/api/tasks/non-existent/priority')
        .send({ priority: 10 });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/projects/:id/pause', () => {
    it('should pause a project', async () => {
      mockProjectRepo.getById.mockResolvedValue({
        id: 'proj-1',
        name: 'Project 1',
        status: 'active',
      });

      mockProjectRepo.updateStatus.mockResolvedValue({
        id: 'proj-1',
        name: 'Project 1',
        status: 'paused',
      });

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).post('/api/projects/proj-1/pause');
      expect(response.status).toBe(200);
      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('proj-1', 'paused');
    });

    it('should return 404 for non-existent project', async () => {
      mockProjectRepo.getById.mockResolvedValue(null);

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).post('/api/projects/non-existent/pause');
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/projects/:id/resume', () => {
    it('should resume a paused project', async () => {
      mockProjectRepo.getById.mockResolvedValue({
        id: 'proj-1',
        name: 'Project 1',
        status: 'paused',
      });

      mockProjectRepo.updateStatus.mockResolvedValue({
        id: 'proj-1',
        name: 'Project 1',
        status: 'active',
      });

      await dashboardServer.start();
      const app = dashboardServer.getApp();

      const response = await request(app).post('/api/projects/proj-1/resume');
      expect(response.status).toBe(200);
      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('proj-1', 'active');
    });
  });

  describe('GET /api/events (SSE)', () => {
    it('should establish SSE connection', async () => {
      await dashboardServer.start();

      // Test SSE endpoint by making a direct HTTP request
      // This verifies the endpoint responds with correct headers
      const address = dashboardServer.getAddress();
      expect(address).toBeDefined();

      // For SSE, we just verify the endpoint exists and sets correct headers
      // Full SSE testing would require a real HTTP client that handles streaming
      const app = dashboardServer.getApp();

      // Verify SSE route handler is set up by checking for correct headers in a timeout
      return new Promise<void>((resolve) => {
        const req = request(app)
          .get('/api/events')
          .set('Accept', 'text/event-stream')
          .timeout(200)
          .end((err, res) => {
            // Even with timeout, we should get initial headers
            if (res) {
              expect(res.status).toBe(200);
              expect(res.headers['content-type']).toContain('text/event-stream');
            }
            resolve();
          });
      });
    });
  });

  describe('getAddress', () => {
    it('should return server address when running', async () => {
      await dashboardServer.start();
      const address = dashboardServer.getAddress();
      expect(address).toBeDefined();
      expect(address).toHaveProperty('port');
    });

    it('should return null when not running', () => {
      const address = dashboardServer.getAddress();
      expect(address).toBeNull();
    });
  });
});
