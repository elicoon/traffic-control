import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
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
  calculateCost,
} from './api.js';

// Helper to create mock request/response/next
function createMockReqRes(params = {}, body = {}) {
  const req = {
    params,
    body,
  } as unknown as Request;

  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    sendFile: vi.fn().mockReturnThis(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

describe('API Route Handlers', () => {
  describe('calculateCost', () => {
    it('should calculate opus cost correctly', () => {
      // 1M tokens with 50/50 split
      // Input: 500k * $15/M = $7.50
      // Output: 500k * $75/M = $37.50
      // Total: $45
      const cost = calculateCost(1_000_000, 'opus');
      expect(cost).toBeCloseTo(45, 2);
    });

    it('should calculate sonnet cost correctly', () => {
      // 1M tokens with 50/50 split
      // Input: 500k * $3/M = $1.50
      // Output: 500k * $15/M = $7.50
      // Total: $9
      const cost = calculateCost(1_000_000, 'sonnet');
      expect(cost).toBeCloseTo(9, 2);
    });

    it('should return 0 for 0 tokens', () => {
      expect(calculateCost(0, 'opus')).toBe(0);
      expect(calculateCost(0, 'sonnet')).toBe(0);
    });
  });

  describe('createStatusHandler', () => {
    it('should return system status', async () => {
      const mockScheduler = {
        getStats: vi.fn().mockReturnValue({
          queuedTasks: 5,
          capacity: {
            opus: { current: 2, limit: 5, available: 3, utilization: 0.4 },
            sonnet: { current: 5, limit: 10, available: 5, utilization: 0.5 },
          },
        }),
      };

      const mockMetricsCollector = {
        collectSystemMetrics: vi.fn().mockResolvedValue({
          totalTasksCompletedToday: 10,
          totalTokensOpus: 100000,
          totalTokensSonnet: 200000,
          totalTasksBlocked: 1,
        }),
      };

      const handler = createStatusHandler(
        mockScheduler as any,
        mockMetricsCollector as any,
        new Date()
      );

      const { req, res, next } = createMockReqRes();
      await handler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = (res.json as any).mock.calls[0][0];
      expect(response).toHaveProperty('running');
      expect(response).toHaveProperty('uptime');
      expect(response).toHaveProperty('capacity');
      expect(response).toHaveProperty('todayStats');
    });
  });

  describe('createProjectsHandler', () => {
    it('should return project summaries', async () => {
      const mockProjectRepo = {
        listActive: vi.fn().mockResolvedValue([
          { id: 'proj-1', name: 'Project 1', status: 'active' },
          { id: 'proj-2', name: 'Project 2', status: 'active' },
        ]),
      };

      const mockMetricsCollector = {
        collectAllProjectMetrics: vi.fn().mockResolvedValue([
          {
            projectId: 'proj-1',
            projectName: 'Project 1',
            tasksQueued: 5,
            tasksBlocked: 0,
            sessionsCount: 2,
            completionRate: 75,
            tokensOpus: 1000,
            tokensSonnet: 2000,
          },
        ]),
      };

      const mockAgentManager = {
        getActiveSessions: vi.fn().mockReturnValue([]),
      };

      const handler = createProjectsHandler(
        mockProjectRepo as any,
        mockMetricsCollector as any,
        mockAgentManager as any
      );

      const { req, res, next } = createMockReqRes();
      await handler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = (res.json as any).mock.calls[0][0];
      expect(Array.isArray(response)).toBe(true);
      expect(response).toHaveLength(2);
    });
  });

  describe('createProjectHandler', () => {
    it('should return project details', async () => {
      const mockProjectRepo = {
        getById: vi.fn().mockResolvedValue({
          id: 'proj-1',
          name: 'Project 1',
          status: 'active',
        }),
      };

      const mockMetricsCollector = {
        collectProjectMetrics: vi.fn().mockResolvedValue({
          projectId: 'proj-1',
          projectName: 'Project 1',
          tasksQueued: 5,
        }),
      };

      const mockTaskRepo = {
        getByProject: vi.fn().mockResolvedValue([
          { id: 'task-1', title: 'Task 1' },
        ]),
      };

      const handler = createProjectHandler(
        mockProjectRepo as any,
        mockMetricsCollector as any,
        mockTaskRepo as any
      );

      const { req, res, next } = createMockReqRes({ id: 'proj-1' });
      await handler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = (res.json as any).mock.calls[0][0];
      expect(response).toHaveProperty('project');
      expect(response).toHaveProperty('metrics');
      expect(response).toHaveProperty('tasks');
    });

    it('should return 404 for non-existent project', async () => {
      const mockProjectRepo = {
        getById: vi.fn().mockResolvedValue(null),
      };

      const handler = createProjectHandler(
        mockProjectRepo as any,
        {} as any,
        {} as any
      );

      const { req, res, next } = createMockReqRes({ id: 'non-existent' });
      await handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('createAgentsHandler', () => {
    it('should return active agents', async () => {
      const mockAgentManager = {
        getActiveSessions: vi.fn().mockReturnValue([
          {
            id: 'session-1',
            taskId: 'task-1',
            model: 'opus',
            status: 'running',
            startedAt: new Date(),
            tokensUsed: 1000,
          },
        ]),
      };

      const mockTaskRepo = {
        getById: vi.fn().mockResolvedValue({
          id: 'task-1',
          title: 'Test Task',
          project_id: 'proj-1',
        }),
      };

      const handler = createAgentsHandler(mockAgentManager as any, mockTaskRepo as any);

      const { req, res, next } = createMockReqRes();
      await handler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = (res.json as any).mock.calls[0][0];
      expect(Array.isArray(response)).toBe(true);
    });
  });

  describe('createTasksHandler', () => {
    it('should return queued tasks', async () => {
      const mockTaskRepo = {
        getQueued: vi.fn().mockResolvedValue([
          { id: 'task-1', title: 'Task 1', priority: 10 },
          { id: 'task-2', title: 'Task 2', priority: 5 },
        ]),
      };

      const handler = createTasksHandler(mockTaskRepo as any);

      const { req, res, next } = createMockReqRes();
      await handler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = (res.json as any).mock.calls[0][0];
      expect(Array.isArray(response)).toBe(true);
      expect(response).toHaveLength(2);
    });
  });

  describe('createMetricsHandler', () => {
    it('should return metrics with cost breakdown', async () => {
      const mockMetricsCollector = {
        collectSystemMetrics: vi.fn().mockResolvedValue({
          totalProjects: 2,
          totalTokensOpus: 100000,
          totalTokensSonnet: 200000,
        }),
        collectAllProjectMetrics: vi.fn().mockResolvedValue([
          {
            projectId: 'proj-1',
            projectName: 'Project 1',
            tokensOpus: 50000,
            tokensSonnet: 100000,
            completionRate: 75,
          },
        ]),
      };

      const handler = createMetricsHandler(mockMetricsCollector as any);

      const { req, res, next } = createMockReqRes();
      await handler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = (res.json as any).mock.calls[0][0];
      expect(response).toHaveProperty('system');
      expect(response).toHaveProperty('costBreakdown');
      expect(response).toHaveProperty('projectCosts');
    });
  });

  describe('createRecommendationsHandler', () => {
    it('should return recommendations', async () => {
      const mockMetricsCollector = {
        collectAllProjectMetrics: vi.fn().mockResolvedValue([]),
        collectSystemMetrics: vi.fn().mockResolvedValue({
          totalProjects: 0,
          totalTasksQueued: 0,
          totalTasksBlocked: 0,
        }),
      };

      const mockRecommendationEngine = {
        generateReport: vi.fn().mockReturnValue({
          projectRecommendations: new Map(),
          systemRecommendations: [
            { type: 'empty_queues', message: 'No tasks', priority: 'warning' },
          ],
          actionItems: ['Add tasks'],
        }),
      };

      const handler = createRecommendationsHandler(
        mockMetricsCollector as any,
        mockRecommendationEngine as any
      );

      const { req, res, next } = createMockReqRes();
      await handler(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = (res.json as any).mock.calls[0][0];
      expect(response).toHaveProperty('recommendations');
      expect(response).toHaveProperty('actionItems');
    });
  });

  describe('createUpdateTaskPriorityHandler', () => {
    it('should update task priority', async () => {
      const mockTaskRepo = {
        getById: vi.fn().mockResolvedValue({ id: 'task-1', priority: 5 }),
        update: vi.fn().mockResolvedValue({ id: 'task-1', priority: 10 }),
      };

      const broadcastEvent = vi.fn();
      const handler = createUpdateTaskPriorityHandler(mockTaskRepo as any, broadcastEvent);

      const { req, res, next } = createMockReqRes({ id: 'task-1' }, { priority: 10 });
      await handler(req, res, next);

      expect(mockTaskRepo.update).toHaveBeenCalledWith('task-1', { priority: 10 });
      expect(res.json).toHaveBeenCalled();
      expect(broadcastEvent).toHaveBeenCalledWith('taskUpdated', { taskId: 'task-1', priority: 10 });
    });

    it('should return 400 for invalid priority', async () => {
      const handler = createUpdateTaskPriorityHandler({} as any, vi.fn());

      const { req, res, next } = createMockReqRes({ id: 'task-1' }, { priority: 'invalid' });
      await handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 for non-existent task', async () => {
      const mockTaskRepo = {
        getById: vi.fn().mockResolvedValue(null),
      };

      const handler = createUpdateTaskPriorityHandler(mockTaskRepo as any, vi.fn());

      const { req, res, next } = createMockReqRes({ id: 'non-existent' }, { priority: 10 });
      await handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('createPauseProjectHandler', () => {
    it('should pause a project', async () => {
      const mockProjectRepo = {
        getById: vi.fn().mockResolvedValue({ id: 'proj-1', status: 'active' }),
        updateStatus: vi.fn().mockResolvedValue({ id: 'proj-1', status: 'paused' }),
      };

      const broadcastEvent = vi.fn();
      const handler = createPauseProjectHandler(mockProjectRepo as any, broadcastEvent);

      const { req, res, next } = createMockReqRes({ id: 'proj-1' });
      await handler(req, res, next);

      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('proj-1', 'paused');
      expect(res.json).toHaveBeenCalled();
      expect(broadcastEvent).toHaveBeenCalledWith('projectPaused', { projectId: 'proj-1' });
    });

    it('should return 404 for non-existent project', async () => {
      const mockProjectRepo = {
        getById: vi.fn().mockResolvedValue(null),
      };

      const handler = createPauseProjectHandler(mockProjectRepo as any, vi.fn());

      const { req, res, next } = createMockReqRes({ id: 'non-existent' });
      await handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('createResumeProjectHandler', () => {
    it('should resume a paused project', async () => {
      const mockProjectRepo = {
        getById: vi.fn().mockResolvedValue({ id: 'proj-1', status: 'paused' }),
        updateStatus: vi.fn().mockResolvedValue({ id: 'proj-1', status: 'active' }),
      };

      const broadcastEvent = vi.fn();
      const handler = createResumeProjectHandler(mockProjectRepo as any, broadcastEvent);

      const { req, res, next } = createMockReqRes({ id: 'proj-1' });
      await handler(req, res, next);

      expect(mockProjectRepo.updateStatus).toHaveBeenCalledWith('proj-1', 'active');
      expect(res.json).toHaveBeenCalled();
      expect(broadcastEvent).toHaveBeenCalledWith('projectResumed', { projectId: 'proj-1' });
    });
  });
});
