import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { MainLoop, OrchestrationConfig, OrchestrationDependencies } from './main-loop.js';
import { StateManager } from './state-manager.js';
import { EventDispatcher, AgentEvent } from './event-dispatcher.js';
import { EventBus } from '../events/event-bus.js';
import * as clientModule from '../db/client.js';

// Create mock classes
const createMockScheduler = () => ({
  scheduleNext: vi.fn().mockResolvedValue({ status: 'idle', scheduled: 0 }),
  scheduleAll: vi.fn().mockResolvedValue([]),
  addTask: vi.fn(),
  removeTask: vi.fn(),
  releaseCapacity: vi.fn(),
  getStats: vi.fn().mockReturnValue({
    queuedTasks: 0,
    capacity: {
      opus: { current: 0, limit: 5, available: 5, utilization: 0 },
      sonnet: { current: 0, limit: 10, available: 10, utilization: 0 },
    },
  }),
  syncCapacity: vi.fn(),
  canSchedule: vi.fn().mockReturnValue(false),
  getCapacityTracker: vi.fn().mockReturnValue({
    hasCapacity: vi.fn().mockReturnValue(true),
    getCapacityStats: vi.fn().mockReturnValue({
      opus: { current: 0, limit: 5, available: 5, utilization: 0 },
      sonnet: { current: 0, limit: 10, available: 10, utilization: 0 },
    }),
  }),
});

const createMockAgentManager = () => ({
  getActiveSessions: vi.fn().mockReturnValue([]),
  getSession: vi.fn(),
  onEvent: vi.fn(),
  spawnAgent: vi.fn().mockResolvedValue('session-123'),
  injectMessage: vi.fn(),
  terminateSession: vi.fn(),
});

const createMockBacklogManager = () => ({
  isBacklogLow: vi.fn().mockResolvedValue(false),
  getBacklogDepth: vi.fn().mockResolvedValue(10),
  getBacklogStats: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue({
    totalQueued: 10,
    totalInProgress: 2,
    totalBlocked: 0,
    totalPendingProposals: 0,
    isBacklogLow: false,
    threshold: 5,
  }),
});

const createMockReporter = () => ({
  start: vi.fn(),
  stop: vi.fn(),
  isRunning: vi.fn().mockReturnValue(false),
  sendImmediateReport: vi.fn().mockResolvedValue({ sent: true }),
  generateReport: vi.fn().mockResolvedValue({}),
});

const createMockCapacityTracker = () => ({
  hasCapacity: vi.fn().mockReturnValue(true),
  reserveCapacity: vi.fn().mockReturnValue(true),
  releaseCapacity: vi.fn(),
  getCapacityStats: vi.fn().mockReturnValue({
    opus: { current: 0, limit: 5, available: 5, utilization: 0 },
    sonnet: { current: 0, limit: 10, available: 10, utilization: 0 },
  }),
  syncWithAgentManager: vi.fn(),
});

const createMockLearningProvider = () => ({
  getContextForSession: vi.fn().mockResolvedValue({
    globalLearnings: [],
    projectLearnings: [],
    agentGuidelines: '',
  }),
  formatAsSystemPrompt: vi.fn().mockReturnValue(''),
  getRelevantLearnings: vi.fn().mockResolvedValue([]),
});

const createMockRetrospectiveTrigger = () => ({
  checkTrigger: vi.fn().mockReturnValue({ shouldTrigger: false }),
  createManualTrigger: vi.fn(),
  isTriggerEnabled: vi.fn().mockReturnValue(true),
});

const createMockTaskRepository = () => ({
  getById: vi.fn().mockResolvedValue({
    id: 'task-1',
    project_id: 'project-123',
    title: 'Test Task',
    status: 'in_progress',
  }),
  create: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
  getQueued: vi.fn(),
  getByProject: vi.fn(),
  getByStatus: vi.fn(),
});

const createMockUsageLogRepository = () => ({
  create: vi.fn().mockResolvedValue({
    id: 'usage-log-1',
    session_id: 'session-1',
    task_id: 'task-1',
    model: 'opus',
    input_tokens: 100,
    output_tokens: 200,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    cost_usd: 0.5,
    event_type: 'completion',
    created_at: new Date().toISOString(),
  }),
  getBySessionId: vi.fn().mockResolvedValue([]),
  getByTaskId: vi.fn().mockResolvedValue([]),
  getTotalUsageBySession: vi.fn().mockResolvedValue({ inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 }),
  getStats: vi.fn().mockResolvedValue({}),
  getRecent: vi.fn().mockResolvedValue([]),
  deleteOlderThan: vi.fn().mockResolvedValue(0),
  getDailySummary: vi.fn().mockResolvedValue([]),
});

const createMockDependencies = (): OrchestrationDependencies => ({
  scheduler: createMockScheduler() as any,
  agentManager: createMockAgentManager() as any,
  backlogManager: createMockBacklogManager() as any,
  reporter: createMockReporter() as any,
  capacityTracker: createMockCapacityTracker() as any,
  learningProvider: createMockLearningProvider() as any,
  retrospectiveTrigger: createMockRetrospectiveTrigger() as any,
  taskRepository: createMockTaskRepository() as any,
  usageLogRepository: createMockUsageLogRepository() as any,
});

const createDefaultConfig = (): OrchestrationConfig => ({
  pollIntervalMs: 100,
  maxConcurrentAgents: 5,
  gracefulShutdownTimeoutMs: 1000,
  stateFilePath: '/tmp/test-state.json',
  validateDatabaseOnStartup: false, // Disable DB validation in tests
  dbRetryConfig: {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
  },
  maxConsecutiveDbFailures: 3,
  // Pre-flight configuration
  runPreFlightChecks: false, // Disable in tests
  requirePreFlightConfirmation: false,
  // Safety system configuration
  enableTaskApproval: false,
  statusCheckInIntervalMs: 0, // Disable in tests
  dailyBudgetUsd: 100,
  weeklyBudgetUsd: 500,
  hardStopAtBudgetLimit: false,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetTimeoutMs: 5000,
});

describe('MainLoop', () => {
  let mainLoop: MainLoop;
  let config: OrchestrationConfig;
  let deps: OrchestrationDependencies;

  let getClientSpy: ReturnType<typeof vi.spyOn>;
  let origSlackChannel: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Save env vars before each test to guarantee cleanup
    origSlackChannel = process.env.TC_SLACK_CHANNEL;

    // Clean up stale state file to prevent cross-test contamination
    await fs.rm('/tmp/test-state.json', { force: true }).catch(() => {});

    // Prevent BudgetTracker auto-instantiation from hitting the real Supabase client in tests.
    // Tests that need a BudgetTracker pass one explicitly via deps.
    getClientSpy = vi.spyOn(clientModule, 'getClient').mockImplementation(() => {
      throw new Error('No Supabase client in tests');
    });

    config = createDefaultConfig();
    deps = createMockDependencies();
    mainLoop = new MainLoop(config, deps);
  });

  afterEach(async () => {
    // Ensure loop is stopped
    if (mainLoop.isRunning()) {
      await mainLoop.stop();
    }
    vi.useRealTimers();
    getClientSpy.mockRestore();

    // Restore env vars regardless of test outcome
    if (origSlackChannel !== undefined) {
      process.env.TC_SLACK_CHANNEL = origSlackChannel;
    } else {
      delete process.env.TC_SLACK_CHANNEL;
    }
  });

  describe('constructor', () => {
    it('should create MainLoop with config and dependencies', () => {
      expect(mainLoop).toBeDefined();
    });

    it('should initialize in stopped state', () => {
      expect(mainLoop.isRunning()).toBe(false);
    });
  });

  describe('start', () => {
    it('should start the main loop', async () => {
      await mainLoop.start();

      expect(mainLoop.isRunning()).toBe(true);
    });

    it('should not start if already running', async () => {
      await mainLoop.start();
      await mainLoop.start(); // Second call should be no-op

      expect(mainLoop.isRunning()).toBe(true);
    });

    it('should sync capacity on start', async () => {
      await mainLoop.start();

      expect(deps.scheduler.syncCapacity).toHaveBeenCalled();
    });

    it('should load state on start', async () => {
      const stateManager = mainLoop.getStateManager();
      const loadSpy = vi.spyOn(stateManager, 'loadState').mockResolvedValue(false);

      await mainLoop.start();

      expect(loadSpy).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop the main loop', async () => {
      await mainLoop.start();
      await mainLoop.stop();

      expect(mainLoop.isRunning()).toBe(false);
    });

    it('should be idempotent when not running', async () => {
      await mainLoop.stop(); // Should not throw

      expect(mainLoop.isRunning()).toBe(false);
    });

    it('should save state on stop', async () => {
      await mainLoop.start();

      const stateManager = mainLoop.getStateManager();
      const saveSpy = vi.spyOn(stateManager, 'saveState').mockResolvedValue();

      await mainLoop.stop();

      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe('pause', () => {
    it('should pause the main loop', async () => {
      await mainLoop.start();
      await mainLoop.pause();

      expect(mainLoop.isPaused()).toBe(true);
    });

    it('should not schedule new tasks when paused', async () => {
      await mainLoop.start();
      await mainLoop.pause();

      // Advance timer
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 2);

      // scheduleNext should not be called while paused
      // (The initial call happens on start, so we check for just that one)
      const callsAfterPause = vi.mocked(deps.scheduler.scheduleNext).mock.calls.length;
      expect(callsAfterPause).toBeLessThanOrEqual(1);
    });
  });

  describe('resume', () => {
    it('should resume a paused loop', async () => {
      await mainLoop.start();
      await mainLoop.pause();
      await mainLoop.resume();

      expect(mainLoop.isPaused()).toBe(false);
    });

    it('should continue scheduling after resume', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();
      await mainLoop.pause();
      await mainLoop.resume();

      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer to trigger poll
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      expect(deps.scheduler.scheduleNext).toHaveBeenCalled();
    });
  });

  describe('getState', () => {
    it('should return current orchestration state', () => {
      const state = mainLoop.getState();

      expect(state).toHaveProperty('isRunning');
      expect(state).toHaveProperty('isPaused');
      expect(state).toHaveProperty('activeAgents');
      expect(state).toHaveProperty('pendingTasks');
    });

    it('should reflect running state', async () => {
      expect(mainLoop.getState().isRunning).toBe(false);

      await mainLoop.start();

      expect(mainLoop.getState().isRunning).toBe(true);
    });
  });

  describe('polling behavior', () => {
    it('should check scheduler at poll interval', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();

      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer by multiple poll intervals
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 3);

      expect(deps.scheduler.scheduleNext).toHaveBeenCalledTimes(3);
    });

    it('should not poll when stopped', async () => {
      await mainLoop.start();
      await mainLoop.stop();

      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 2);

      expect(deps.scheduler.scheduleNext).not.toHaveBeenCalled();
    });
  });

  describe('event handling', () => {
    it('should register event handler', () => {
      const handler = vi.fn();
      mainLoop.onEvent(handler);

      expect(mainLoop.getEventDispatcher().hasHandlers('question')).toBe(false);
      // Global handlers are separate
    });

    it('should dispatch events through event dispatcher', async () => {
      const handler = vi.fn();
      const dispatcher = mainLoop.getEventDispatcher();
      dispatcher.on('question', handler);

      const event: AgentEvent = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: { question: 'What?' },
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('graceful shutdown', () => {
    it('should wait for active agents during shutdown', async () => {
      vi.useRealTimers();

      const realDeps = createMockDependencies();
      vi.mocked(realDeps.agentManager.getActiveSessions).mockReturnValue([
        {
          id: 'session-1',
          taskId: 'task-1',
          model: 'opus',
          status: 'running',
          startedAt: new Date(),
          tokensUsed: 0,
        },
      ]);

      const realConfig: OrchestrationConfig = {
        ...createDefaultConfig(),
        gracefulShutdownTimeoutMs: 100,
      };

      const loop = new MainLoop(realConfig, realDeps);
      await loop.start();

      const stopPromise = loop.stop();

      // Simulate agent completion
      setTimeout(() => {
        vi.mocked(realDeps.agentManager.getActiveSessions).mockReturnValue([]);
      }, 50);

      await stopPromise;

      expect(loop.isRunning()).toBe(false);
    });

    it('should timeout if agents do not complete', async () => {
      vi.useRealTimers();

      const realDeps = createMockDependencies();
      vi.mocked(realDeps.agentManager.getActiveSessions).mockReturnValue([
        {
          id: 'session-1',
          taskId: 'task-1',
          model: 'opus',
          status: 'running',
          startedAt: new Date(),
          tokensUsed: 0,
        },
      ]);

      const realConfig: OrchestrationConfig = {
        ...createDefaultConfig(),
        gracefulShutdownTimeoutMs: 50,
      };

      const loop = new MainLoop(realConfig, realDeps);
      await loop.start();

      // Stop should complete within timeout even if agents still running
      const startTime = Date.now();
      await loop.stop();
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(loop.isRunning()).toBe(false);
    });
  });

  describe('agent event routing', () => {
    it('should update state on agent completion', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'completion',
        agentId: 'session-1',
        taskId: 'task-1',
        payload: { summary: 'Done' },
        timestamp: new Date(),
      });

      const state = stateManager.getState();
      expect(state.activeAgents.has('session-1')).toBe(false);
    });

    it('should update state on agent error', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'error',
        agentId: 'session-1',
        taskId: 'task-1',
        payload: { error: 'Something failed' },
        timestamp: new Date(),
      });

      const state = stateManager.getState();
      expect(state.activeAgents.has('session-1')).toBe(false);
    });

    it('should update state on agent blocker', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'blocker',
        agentId: 'session-1',
        taskId: 'task-1',
        payload: { reason: 'Need clarification' },
        timestamp: new Date(),
      });

      const agent = stateManager.getState().activeAgents.get('session-1');
      expect(agent?.status).toBe('blocked');
    });

    it('should release capacity on agent completion', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'completion',
        agentId: 'session-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      expect(deps.capacityTracker.releaseCapacity).toHaveBeenCalledWith('opus', 'session-1');
    });

    it('should look up projectId from task on agent error and call retrospective trigger', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      // Mock task repository to return a task with project_id
      vi.mocked(deps.taskRepository!.getById).mockResolvedValue({
        id: 'task-1',
        project_id: 'project-456',
        title: 'Test Task',
        status: 'in_progress',
      } as any);

      await mainLoop.handleAgentEvent({
        type: 'error',
        agentId: 'session-1',
        taskId: 'task-1',
        payload: { error: 'Something failed' },
        timestamp: new Date(),
      });

      // Verify taskRepository was called with the taskId
      expect(deps.taskRepository!.getById).toHaveBeenCalledWith('task-1');

      // Verify retrospective trigger was called with correct projectId
      expect(deps.retrospectiveTrigger.checkTrigger).toHaveBeenCalledWith({
        taskId: 'task-1',
        projectId: 'project-456',
        sessionId: 'session-1',
        isBlocked: false,
      });
    });

    it('should handle task lookup failure gracefully on agent error', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      // Mock task repository to throw an error
      vi.mocked(deps.taskRepository!.getById).mockRejectedValue(new Error('DB connection failed'));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await mainLoop.handleAgentEvent({
        type: 'error',
        agentId: 'session-1',
        taskId: 'task-1',
        payload: { error: 'Something failed' },
        timestamp: new Date(),
      });

      // Should log a warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to look up task for error event')
      );

      // Should NOT call retrospective trigger since projectId lookup failed
      expect(deps.retrospectiveTrigger.checkTrigger).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle missing task gracefully on agent error', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      // Mock task repository to return null (task not found)
      vi.mocked(deps.taskRepository!.getById).mockResolvedValue(null);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await mainLoop.handleAgentEvent({
        type: 'error',
        agentId: 'session-1',
        taskId: 'task-1',
        payload: { error: 'Something failed' },
        timestamp: new Date(),
      });

      // Should log a warning about task not found
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task not found for error event')
      );

      // Should NOT call retrospective trigger since task wasn't found
      expect(deps.retrospectiveTrigger.checkTrigger).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should skip retrospective check when taskRepository is not provided', async () => {
      // Create deps without taskRepository
      const depsWithoutRepo = createMockDependencies();
      delete depsWithoutRepo.taskRepository;

      const loopWithoutRepo = new MainLoop(config, depsWithoutRepo);
      const stateManager = loopWithoutRepo.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await loopWithoutRepo.handleAgentEvent({
        type: 'error',
        agentId: 'session-1',
        taskId: 'task-1',
        payload: { error: 'Something failed' },
        timestamp: new Date(),
      });

      // Should log a warning about skipping retrospective
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping retrospective check')
      );

      // Should NOT call retrospective trigger
      expect(depsWithoutRepo.retrospectiveTrigger.checkTrigger).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('getStateManager', () => {
    it('should return the state manager', () => {
      const stateManager = mainLoop.getStateManager();

      expect(stateManager).toBeInstanceOf(StateManager);
    });
  });

  describe('getEventDispatcher', () => {
    it('should return the event dispatcher', () => {
      const dispatcher = mainLoop.getEventDispatcher();

      expect(dispatcher).toBeInstanceOf(EventDispatcher);
    });
  });

  describe('getStats', () => {
    it('should return orchestration statistics', () => {
      const stats = mainLoop.getStats();

      expect(stats).toHaveProperty('isRunning');
      expect(stats).toHaveProperty('isPaused');
      expect(stats).toHaveProperty('activeAgentCount');
      expect(stats).toHaveProperty('schedulerStats');
    });

    it('should include scheduler stats', () => {
      const stats = mainLoop.getStats();

      expect(stats.schedulerStats).toHaveProperty('queuedTasks');
      expect(stats.schedulerStats).toHaveProperty('capacity');
    });
  });

  describe('integration with scheduler', () => {
    it('should call scheduler on tick when capacity available', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();

      // Clear any calls from start
      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      expect(deps.scheduler.scheduleNext).toHaveBeenCalled();
    });

    it('should not call scheduler when no capacity', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(false);

      await mainLoop.start();

      // Clear any calls from start
      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // May or may not call scheduleNext - depends on implementation
      // The key is that it should check canSchedule first
      expect(deps.scheduler.canSchedule).toHaveBeenCalled();
    });
  });

  describe('degraded mode', () => {
    it('should initialize with isDegraded as false', () => {
      expect(mainLoop.isDegraded()).toBe(false);
    });

    it('should include isDegraded in stats', () => {
      const stats = mainLoop.getStats();
      expect(stats).toHaveProperty('isDegraded');
      expect(stats.isDegraded).toBe(false);
    });

    it('should include dbHealth in stats', () => {
      const stats = mainLoop.getStats();
      expect(stats).toHaveProperty('dbHealth');
      expect(stats.dbHealth).toHaveProperty('healthy');
      expect(stats.dbHealth).toHaveProperty('consecutiveFailures');
    });
  });

  describe('usage log persistence', () => {
    it('should persist usage log on successful agent completion', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'completion',
        agentId: 'session-1',
        taskId: 'task-1',
        payload: {
          inputTokens: 500,
          outputTokens: 1000,
          costUsd: 2.5,
          durationMs: 30000,
          summary: 'Task completed successfully',
        },
        timestamp: new Date(),
      });

      expect(deps.usageLogRepository!.create).toHaveBeenCalledWith({
        session_id: 'session-1',
        task_id: 'task-1',
        model: 'opus',
        input_tokens: 500,
        output_tokens: 1000,
        cost_usd: 2.5,
        event_type: 'completion',
      });
    });

    it('should persist usage log on agent error', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-2',
        taskId: 'task-2',
        model: 'sonnet',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'error',
        agentId: 'session-2',
        taskId: 'task-2',
        payload: {
          error: 'Agent crashed',
          inputTokens: 200,
          outputTokens: 50,
          costUsd: 0.1,
        },
        timestamp: new Date(),
      });

      expect(deps.usageLogRepository!.create).toHaveBeenCalledWith({
        session_id: 'session-2',
        task_id: 'task-2',
        model: 'sonnet',
        input_tokens: 200,
        output_tokens: 50,
        cost_usd: 0.1,
        event_type: 'error',
      });
    });

    it('should populate correct fields from tokensUsed fallback when inputTokens/outputTokens not provided', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-3',
        taskId: 'task-3',
        model: 'haiku',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'completion',
        agentId: 'session-3',
        taskId: 'task-3',
        payload: {
          tokensUsed: 1000,
          costUsd: 0.05,
        },
        timestamp: new Date(),
      });

      // When only tokensUsed is provided, inputTokens = floor(tokensUsed * 0.3), outputTokens = floor(tokensUsed * 0.7)
      expect(deps.usageLogRepository!.create).toHaveBeenCalledWith({
        session_id: 'session-3',
        task_id: 'task-3',
        model: 'haiku',
        input_tokens: 300,
        output_tokens: 700,
        cost_usd: 0.05,
        event_type: 'completion',
      });
    });

    it('should set task_id to null when taskId is empty string', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-4',
        taskId: '',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'completion',
        agentId: 'session-4',
        taskId: '',
        payload: {
          inputTokens: 100,
          outputTokens: 200,
          costUsd: 0.5,
        },
        timestamp: new Date(),
      });

      expect(deps.usageLogRepository!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: null,
        })
      );
    });

    it('should not crash when usageLogRepository.create throws', async () => {
      vi.mocked(deps.usageLogRepository!.create).mockRejectedValue(new Error('DB insert failed'));

      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-5',
        taskId: 'task-5',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      // Should not throw despite the repository error
      await expect(
        mainLoop.handleAgentEvent({
          type: 'completion',
          agentId: 'session-5',
          taskId: 'task-5',
          payload: {
            inputTokens: 100,
            outputTokens: 200,
            costUsd: 1.0,
          },
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();

      // Agent should still be removed from state (completion flow continued)
      expect(stateManager.getState().activeAgents.has('session-5')).toBe(false);
    });

    it('should not crash when usageLogRepository.create throws on error event', async () => {
      vi.mocked(deps.usageLogRepository!.create).mockRejectedValue(new Error('DB insert failed'));

      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-5b',
        taskId: 'task-5b',
        model: 'sonnet',
        status: 'running',
        startedAt: new Date(),
      });

      // Should not throw despite the repository error
      await expect(
        mainLoop.handleAgentEvent({
          type: 'error',
          agentId: 'session-5b',
          taskId: 'task-5b',
          payload: {
            error: 'Agent crashed',
            inputTokens: 200,
            outputTokens: 50,
            costUsd: 0.1,
          },
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();

      // Agent should still be removed from state (error flow continued)
      expect(stateManager.getState().activeAgents.has('session-5b')).toBe(false);
    });

    it('should not error when usageLogRepository is not provided', async () => {
      const depsWithoutUsageRepo = createMockDependencies();
      delete (depsWithoutUsageRepo as any).usageLogRepository;

      const loopWithoutRepo = new MainLoop(config, depsWithoutUsageRepo);
      const stateManager = loopWithoutRepo.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-6',
        taskId: 'task-6',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      // Should not throw when usageLogRepository is undefined
      await expect(
        loopWithoutRepo.handleAgentEvent({
          type: 'completion',
          agentId: 'session-6',
          taskId: 'task-6',
          payload: {
            inputTokens: 100,
            outputTokens: 200,
            costUsd: 1.0,
          },
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();

      // Agent should still be removed from state
      expect(stateManager.getState().activeAgents.has('session-6')).toBe(false);
    });
  });

  describe('startup database validation', () => {
    it('should skip database validation when validateDatabaseOnStartup is false', async () => {
      const waitForHealthySpy = vi.spyOn(clientModule, 'waitForHealthy');

      const loopNoValidate = new MainLoop(
        { ...config, validateDatabaseOnStartup: false },
        deps
      );

      await loopNoValidate.start();

      expect(waitForHealthySpy).not.toHaveBeenCalled();
      expect(loopNoValidate.isRunning()).toBe(true);

      await loopNoValidate.stop();
      waitForHealthySpy.mockRestore();
    });

    it('should validate database on startup when validateDatabaseOnStartup is true', async () => {
      const waitForHealthySpy = vi.spyOn(clientModule, 'waitForHealthy').mockResolvedValue({
        healthy: true,
        latencyMs: 50,
      });

      const loopWithValidate = new MainLoop(
        { ...config, validateDatabaseOnStartup: true },
        deps
      );

      await loopWithValidate.start();

      expect(waitForHealthySpy).toHaveBeenCalled();
      expect(loopWithValidate.isRunning()).toBe(true);

      await loopWithValidate.stop();
      waitForHealthySpy.mockRestore();
    });

    it('should throw error on startup if database is unavailable', async () => {
      const waitForHealthySpy = vi.spyOn(clientModule, 'waitForHealthy').mockResolvedValue({
        healthy: false,
        latencyMs: 5000,
        error: 'Connection refused',
      });

      const loopWithValidate = new MainLoop(
        { ...config, validateDatabaseOnStartup: true },
        deps
      );

      await expect(loopWithValidate.start()).rejects.toThrow('Database unavailable');
      expect(loopWithValidate.isRunning()).toBe(false);

      waitForHealthySpy.mockRestore();
    });

    it('should emit database:healthy event on successful startup validation', async () => {
      const eventBus = new EventBus({ logErrors: false });
      const healthyHandler = vi.fn();
      eventBus.on('database:healthy', healthyHandler);

      const waitForHealthySpy = vi.spyOn(clientModule, 'waitForHealthy').mockResolvedValue({
        healthy: true,
        latencyMs: 25,
      });

      const loopWithBus = new MainLoop(
        { ...config, validateDatabaseOnStartup: true },
        deps,
        eventBus
      );

      await loopWithBus.start();

      expect(healthyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'database:healthy',
          payload: expect.objectContaining({
            latencyMs: 25,
          }),
        })
      );

      await loopWithBus.stop();
      waitForHealthySpy.mockRestore();
    });
  });

  describe('BudgetTracker integration', () => {
    const createMockBudgetTracker = () => ({
      checkBudgetAlerts: vi.fn().mockResolvedValue([]),
    });

    const createCriticalAlert = () => ({
      budget: { id: 'budget-1', periodType: 'daily', budgetUsd: 10, alertThresholdPercent: 80, projectId: undefined, createdAt: new Date(), updatedAt: new Date() },
      status: { budgetId: 'budget-1', periodType: 'daily', budgetUsd: 10, spentUsd: 12, remainingUsd: 0, percentUsed: 120, projectedTotalUsd: 12, onTrack: false, alertTriggered: true, alertThresholdPercent: 80, periodStart: new Date(), periodEnd: new Date(), projectId: undefined },
      severity: 'critical' as const,
      message: 'Budget exceeded! 120.0% of daily budget used.',
    });

    it('no BudgetTracker in deps → constructor warns on getClient failure, existing behavior unchanged', async () => {
      // getClient is already mocked to throw in beforeEach — BudgetTracker init silently fails
      const depsNoBudget = createMockDependencies();
      const loop = new MainLoop(config, depsNoBudget);
      vi.mocked(depsNoBudget.scheduler.canSchedule).mockReturnValue(true);

      await loop.start();
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Scheduling should still proceed (budget check skipped when no budgetTracker)
      expect(depsNoBudget.scheduler.scheduleNext).toHaveBeenCalled();

      await loop.stop();
    });

    it('budget OK → tasks scheduled normally', async () => {
      const mockBudgetTracker = createMockBudgetTracker();
      const depsWithBudget = { ...createMockDependencies(), budgetTracker: mockBudgetTracker as any };
      vi.mocked(depsWithBudget.scheduler.canSchedule).mockReturnValue(true);

      const loop = new MainLoop(config, depsWithBudget);
      await loop.start();
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      expect(mockBudgetTracker.checkBudgetAlerts).toHaveBeenCalled();
      expect(depsWithBudget.scheduler.scheduleNext).toHaveBeenCalled();

      await loop.stop();
    });

    it('budget exceeded → scheduling skipped, Slack notified, budgetPaused = true', async () => {
      const mockBudgetTracker = createMockBudgetTracker();
      mockBudgetTracker.checkBudgetAlerts.mockResolvedValue([createCriticalAlert()]);

      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      const depsWithBudget = { ...createMockDependencies(), budgetTracker: mockBudgetTracker as any };
      vi.mocked(depsWithBudget.scheduler.canSchedule).mockReturnValue(true);

      const loop = new MainLoop(config, depsWithBudget);
      loop.setSlackIntegration(mockSlack);

      // Set TC_SLACK_CHANNEL so Slack notification fires
      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await loop.start();
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Scheduling should be skipped
      expect(depsWithBudget.scheduler.scheduleNext).not.toHaveBeenCalled();

      // Flush microtasks so the fire-and-forget sendMessage promise resolves
      await Promise.resolve();
      expect(mockSlack.sendMessage).toHaveBeenCalledWith(
        'C_TEST_CHANNEL',
        expect.stringContaining('Budget Exceeded')
      );

      // budgetPaused should be true
      expect(loop.getStats().safety.budgetPaused).toBe(true);


      await loop.stop();
    });

    it('budget exceeded on two ticks → Slack notified only once (dedup)', async () => {
      const mockBudgetTracker = createMockBudgetTracker();
      mockBudgetTracker.checkBudgetAlerts.mockResolvedValue([createCriticalAlert()]);

      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      const depsWithBudget = { ...createMockDependencies(), budgetTracker: mockBudgetTracker as any };

      const loop = new MainLoop(config, depsWithBudget);
      loop.setSlackIntegration(mockSlack);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await loop.start();
      // Two ticks
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 2);
      // Flush microtasks so fire-and-forget sendMessage promises resolve
      await Promise.resolve();

      // Slack called only once despite two ticks
      const budgetExceededCalls = mockSlack.sendMessage.mock.calls.filter(
        call => typeof call[1] === 'string' && call[1].includes('Budget Exceeded')
      );
      expect(budgetExceededCalls).toHaveLength(1);


      await loop.stop();
    });

    it('budget recovered after exceeded → Slack notified, scheduling resumes', async () => {
      const mockBudgetTracker = createMockBudgetTracker();
      // First tick: exceeded
      mockBudgetTracker.checkBudgetAlerts
        .mockResolvedValueOnce([createCriticalAlert()])
        // Second tick: recovered
        .mockResolvedValueOnce([])
        // Third tick: still OK
        .mockResolvedValue([]);

      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      const depsWithBudget = { ...createMockDependencies(), budgetTracker: mockBudgetTracker as any };
      vi.mocked(depsWithBudget.scheduler.canSchedule).mockReturnValue(true);

      const loop = new MainLoop(config, depsWithBudget);
      loop.setSlackIntegration(mockSlack);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await loop.start();

      // Tick 1: budget exceeded
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);
      expect(depsWithBudget.scheduler.scheduleNext).not.toHaveBeenCalled();
      expect(loop.getStats().safety.budgetPaused).toBe(true);

      // Tick 2: budget recovered
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);
      // Flush microtasks so fire-and-forget sendMessage promises resolve
      await Promise.resolve();
      expect(loop.getStats().safety.budgetPaused).toBe(false);

      // Slack should have recovery message
      const recoveryCalls = mockSlack.sendMessage.mock.calls.filter(
        call => typeof call[1] === 'string' && call[1].includes('Budget Recovered')
      );
      expect(recoveryCalls).toHaveLength(1);

      // Tick 3: scheduling resumes
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);
      expect(depsWithBudget.scheduler.scheduleNext).toHaveBeenCalled();


      await loop.stop();
    });

    it('BudgetTracker.checkBudgetAlerts throws → scheduling continues (fail-safe)', async () => {
      const mockBudgetTracker = createMockBudgetTracker();
      mockBudgetTracker.checkBudgetAlerts.mockRejectedValue(new Error('DB connection failed'));

      const depsWithBudget = { ...createMockDependencies(), budgetTracker: mockBudgetTracker as any };
      vi.mocked(depsWithBudget.scheduler.canSchedule).mockReturnValue(true);

      const loop = new MainLoop(config, depsWithBudget);
      await loop.start();
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Scheduling should still proceed despite BudgetTracker error
      expect(depsWithBudget.scheduler.scheduleNext).toHaveBeenCalled();

      await loop.stop();
    });

    it('getBudgetTracker() returns the injected BudgetTracker', () => {
      const mockBudgetTracker = createMockBudgetTracker();
      const depsWithBudget = { ...createMockDependencies(), budgetTracker: mockBudgetTracker as any };
      const loop = new MainLoop(config, depsWithBudget);
      expect(loop.getBudgetTracker()).toBe(mockBudgetTracker);
    });
  });

  describe('tick - degraded mode transitions', () => {
    it('should skip work when in degraded mode and recovery fails', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();

      // Put the health monitor into degraded mode
      const healthMonitor = mainLoop.getDatabaseHealthMonitor();
      vi.spyOn(healthMonitor, 'isDegraded').mockReturnValue(true);
      vi.spyOn(healthMonitor, 'attemptDbRecovery').mockResolvedValue(undefined);

      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Scheduler should NOT have been called since degraded mode persists
      expect(deps.scheduler.scheduleNext).not.toHaveBeenCalled();
      expect(healthMonitor.attemptDbRecovery).toHaveBeenCalled();
    });

    it('should resume work after successful recovery from degraded mode', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();

      const healthMonitor = mainLoop.getDatabaseHealthMonitor();
      // First call: degraded, second call (after recovery): not degraded
      vi.spyOn(healthMonitor, 'isDegraded')
        .mockReturnValueOnce(true)   // initial check
        .mockReturnValueOnce(false); // after recovery attempt
      vi.spyOn(healthMonitor, 'attemptDbRecovery').mockResolvedValue(undefined);
      vi.spyOn(healthMonitor, 'getStats').mockReturnValue({
        healthy: true,
        consecutiveFailures: 0,
      });
      vi.spyOn(healthMonitor, 'onDbSuccess').mockImplementation(() => {});

      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Scheduler SHOULD have been called since recovery succeeded
      expect(healthMonitor.attemptDbRecovery).toHaveBeenCalled();
      expect(deps.scheduler.canSchedule).toHaveBeenCalled();
    });
  });

  describe('tick - circuit breaker integration', () => {
    it('should skip tick when circuit breaker prevents operation', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();

      // Trip the circuit breaker
      const circuitBreaker = mainLoop.getCircuitBreaker();
      vi.spyOn(circuitBreaker, 'allowsOperation').mockReturnValue(false);

      vi.mocked(deps.scheduler.scheduleNext).mockClear();
      vi.mocked(deps.scheduler.canSchedule).mockClear();

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Nothing should happen since circuit breaker is open
      expect(deps.scheduler.canSchedule).not.toHaveBeenCalled();
      expect(deps.scheduler.scheduleNext).not.toHaveBeenCalled();
    });

    it('should proceed with tick when circuit breaker allows operation', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();

      const circuitBreaker = mainLoop.getCircuitBreaker();
      vi.spyOn(circuitBreaker, 'allowsOperation').mockReturnValue(true);

      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Scheduler should be checked/called
      expect(deps.scheduler.canSchedule).toHaveBeenCalled();
    });
  });

  describe('tick - spend monitor stop', () => {
    it('should pause loop when spend monitor triggers stop', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();

      const spendMonitor = mainLoop.getSpendMonitor();
      vi.spyOn(spendMonitor, 'shouldStop').mockReturnValue(true);

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      expect(mainLoop.isPaused()).toBe(true);
    });

    it('should notify Slack when spend monitor triggers stop', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();
      mainLoop.setSlackIntegration(mockSlack);

      const spendMonitor = mainLoop.getSpendMonitor();
      vi.spyOn(spendMonitor, 'shouldStop').mockReturnValue(true);
      vi.spyOn(spendMonitor, 'formatForSlack').mockReturnValue('Budget info');

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      // Clear any startup notifications
      mockSlack.sendMessage.mockClear();

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);
      await Promise.resolve();

      expect(mockSlack.sendMessage).toHaveBeenCalledWith(
        'C_TEST_CHANNEL',
        expect.stringContaining('Budget Limit Reached')
      );


    });
  });

  describe('tick - error handling', () => {
    it('should handle database errors by routing to health monitor', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);
      vi.mocked(deps.scheduler.scheduleNext).mockRejectedValue(new Error('Database connection refused'));

      await mainLoop.start();

      const healthMonitor = mainLoop.getDatabaseHealthMonitor();
      vi.spyOn(healthMonitor, 'isDbError').mockReturnValue(true);
      vi.spyOn(healthMonitor, 'onDbFailure').mockImplementation(() => {});

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      expect(healthMonitor.isDbError).toHaveBeenCalled();
      expect(healthMonitor.onDbFailure).toHaveBeenCalled();
    });

    it('should log non-DB errors without triggering degraded mode', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);
      vi.mocked(deps.scheduler.scheduleNext).mockRejectedValue(new Error('Some random error'));

      await mainLoop.start();

      const healthMonitor = mainLoop.getDatabaseHealthMonitor();
      vi.spyOn(healthMonitor, 'isDbError').mockReturnValue(false);
      vi.spyOn(healthMonitor, 'onDbFailure').mockImplementation(() => {});

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      expect(healthMonitor.isDbError).toHaveBeenCalled();
      expect(healthMonitor.onDbFailure).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should not crash the loop when tick throws', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);
      // First tick fails, second tick succeeds
      vi.mocked(deps.scheduler.scheduleNext)
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValue({ status: 'idle', scheduled: 0 });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await mainLoop.start();

      const healthMonitor = mainLoop.getDatabaseHealthMonitor();
      vi.spyOn(healthMonitor, 'isDbError').mockReturnValue(false);

      // Advance timer for first tick (error)
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Loop should still be running
      expect(mainLoop.isRunning()).toBe(true);
      expect(mainLoop.isPaused()).toBe(false);

      // Advance timer for second tick (success)
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Loop should still be running after recovery
      expect(mainLoop.isRunning()).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should reset DB failure counter on successful tick', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();

      const healthMonitor = mainLoop.getDatabaseHealthMonitor();
      // Simulate health monitor having previous failures
      vi.spyOn(healthMonitor, 'getStats').mockReturnValue({
        healthy: true,
        consecutiveFailures: 2,
      });
      vi.spyOn(healthMonitor, 'onDbSuccess').mockImplementation(() => {});

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      expect(healthMonitor.onDbSuccess).toHaveBeenCalled();
    });
  });

  describe('tick - task scheduling with state tracking', () => {
    it('should add scheduled tasks to state manager', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);
      vi.mocked(deps.scheduler.scheduleNext).mockResolvedValue({
        status: 'scheduled',
        scheduled: 1,
        tasks: [{
          taskId: 'task-abc',
          model: 'opus',
          sessionId: 'session-abc',
        }],
      });

      vi.mocked(deps.agentManager.getSession).mockReturnValue({
        id: 'session-abc',
        taskId: 'task-abc',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
        tokensUsed: 0,
      });

      await mainLoop.start();

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      const state = mainLoop.getState();
      expect(state.activeAgents.has('session-abc')).toBe(true);
    });

    it('should handle scheduled task when agent session not found', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);
      vi.mocked(deps.scheduler.scheduleNext).mockResolvedValue({
        status: 'scheduled',
        scheduled: 1,
        tasks: [{
          taskId: 'task-def',
          model: 'sonnet',
          sessionId: 'session-def',
        }],
      });

      // getSession returns undefined - agent not found
      vi.mocked(deps.agentManager.getSession).mockReturnValue(undefined);

      await mainLoop.start();

      // Should not throw
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // Agent should NOT be in state since session wasn't found
      const state = mainLoop.getState();
      expect(state.activeAgents.has('session-def')).toBe(false);
    });

    it('should track multiple scheduled tasks from a single tick', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);
      vi.mocked(deps.scheduler.scheduleNext).mockResolvedValue({
        status: 'scheduled',
        scheduled: 2,
        tasks: [
          { taskId: 'task-1', model: 'opus', sessionId: 'session-1' },
          { taskId: 'task-2', model: 'sonnet', sessionId: 'session-2' },
        ],
      });

      vi.mocked(deps.agentManager.getSession)
        .mockReturnValueOnce({
          id: 'session-1', taskId: 'task-1', model: 'opus',
          status: 'running', startedAt: new Date(), tokensUsed: 0,
        })
        .mockReturnValueOnce({
          id: 'session-2', taskId: 'task-2', model: 'sonnet',
          status: 'running', startedAt: new Date(), tokensUsed: 0,
        });

      await mainLoop.start();

      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      const state = mainLoop.getState();
      expect(state.activeAgents.has('session-1')).toBe(true);
      expect(state.activeAgents.has('session-2')).toBe(true);
    });
  });

  describe('subagent spawn handling', () => {
    it('should add subagent to state on subagent_spawn event', async () => {
      await mainLoop.handleAgentEvent({
        type: 'subagent_spawn',
        agentId: 'parent-1',
        taskId: 'task-1',
        payload: {
          sessionId: 'sub-session-1',
          model: 'sonnet',
        },
        timestamp: new Date(),
      });

      const state = mainLoop.getState();
      expect(state.activeAgents.has('sub-session-1')).toBe(true);
      const agent = state.activeAgents.get('sub-session-1');
      expect(agent?.model).toBe('sonnet');
      expect(agent?.taskId).toBe('task-1');
    });

    it('should not add subagent when payload is incomplete', async () => {
      await mainLoop.handleAgentEvent({
        type: 'subagent_spawn',
        agentId: 'parent-1',
        taskId: 'task-1',
        payload: {}, // missing sessionId and model
        timestamp: new Date(),
      });

      const state = mainLoop.getState();
      // No new agent should be added
      expect(state.activeAgents.size).toBe(0);
    });
  });

  describe('agent question handling', () => {
    it('should set agent status to blocked on question event', async () => {
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'session-q1',
        taskId: 'task-q1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'question',
        agentId: 'session-q1',
        taskId: 'task-q1',
        payload: { question: 'What should I do?' },
        timestamp: new Date(),
      });

      const agent = stateManager.getState().activeAgents.get('session-q1');
      expect(agent?.status).toBe('blocked');
    });

    it('should handle question for non-existent agent gracefully', async () => {
      // Should not throw even if agent doesn't exist
      await expect(
        mainLoop.handleAgentEvent({
          type: 'question',
          agentId: 'non-existent',
          taskId: 'task-1',
          payload: { question: 'Hello?' },
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();
    });
  });

  describe('safety system getters', () => {
    it('should return circuit breaker instance', () => {
      expect(mainLoop.getCircuitBreaker()).toBeDefined();
    });

    it('should return spend monitor instance', () => {
      expect(mainLoop.getSpendMonitor()).toBeDefined();
    });

    it('should return productivity monitor instance', () => {
      expect(mainLoop.getProductivityMonitor()).toBeDefined();
    });

    it('should return task approval manager instance', () => {
      expect(mainLoop.getTaskApprovalManager()).toBeDefined();
    });

    it('should return database health monitor instance', () => {
      expect(mainLoop.getDatabaseHealthMonitor()).toBeDefined();
    });

    it('should return null for pre-flight checker before start', () => {
      expect(mainLoop.getPreFlightChecker()).toBeNull();
    });

    it('should return null for last pre-flight result before start', () => {
      expect(mainLoop.getLastPreFlightResult()).toBeNull();
    });
  });

  describe('circuit breaker manual reset', () => {
    it('should reset circuit breaker and consecutive failures', () => {
      const circuitBreaker = mainLoop.getCircuitBreaker();
      const resetSpy = vi.spyOn(circuitBreaker, 'reset');

      mainLoop.resetCircuitBreaker();

      expect(resetSpy).toHaveBeenCalledWith(true);
    });
  });

  describe('task approval response handling', () => {
    it('should forward approval response to task approval manager', () => {
      const approvalManager = mainLoop.getTaskApprovalManager();
      const handleSpy = vi.spyOn(approvalManager, 'handleResponse');

      mainLoop.handleTaskApprovalResponse('task-1', true, 'user-1', 'looks good');

      expect(handleSpy).toHaveBeenCalledWith('task-1', true, 'user-1', 'looks good');
    });
  });

  describe('Slack integration', () => {
    it('should send startup notification to Slack when integration is set', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      mainLoop.setSlackIntegration(mockSlack);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await mainLoop.start();

      expect(mockSlack.sendMessage).toHaveBeenCalledWith(
        'C_TEST_CHANNEL',
        expect.stringContaining('TrafficControl Started')
      );


    });

    it('should send shutdown notification to Slack when integration is set', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      mainLoop.setSlackIntegration(mockSlack);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await mainLoop.start();
      mockSlack.sendMessage.mockClear();
      await mainLoop.stop();

      expect(mockSlack.sendMessage).toHaveBeenCalledWith(
        'C_TEST_CHANNEL',
        expect.stringContaining('TrafficControl Stopped')
      );


    });

    it('should include final summary in shutdown notification', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      mainLoop.setSlackIntegration(mockSlack);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await mainLoop.start();
      mockSlack.sendMessage.mockClear();
      await mainLoop.stop();

      const shutdownCall = mockSlack.sendMessage.mock.calls.find(
        call => typeof call[1] === 'string' && call[1].includes('TrafficControl Stopped')
      );
      expect(shutdownCall).toBeDefined();
      expect(shutdownCall![1]).toContain('Final Summary');


    });
  });

  describe('formatStatusForSlack', () => {
    it('should include circuit breaker tripped warning in status', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      mainLoop.setSlackIntegration(mockSlack);

      // Trip the circuit breaker
      const cb = mainLoop.getCircuitBreaker();
      for (let i = 0; i < config.circuitBreakerFailureThreshold; i++) {
        cb.recordFailure(`error-${i}`);
      }

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await mainLoop.start();

      const startupCall = mockSlack.sendMessage.mock.calls.find(
        call => typeof call[1] === 'string' && call[1].includes('TrafficControl Started')
      );
      expect(startupCall![1]).toContain('Circuit breaker is tripped');


    });

    it('should include degraded mode warning in status', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      mainLoop.setSlackIntegration(mockSlack);

      // Put health monitor into degraded mode
      const healthMonitor = mainLoop.getDatabaseHealthMonitor();
      vi.spyOn(healthMonitor, 'isDegraded').mockReturnValue(true);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await mainLoop.start();

      const startupCall = mockSlack.sendMessage.mock.calls.find(
        call => typeof call[1] === 'string' && call[1].includes('TrafficControl Started')
      );
      expect(startupCall![1]).toContain('Database degraded');


    });

    it('should include over budget warning in status', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      mainLoop.setSlackIntegration(mockSlack);

      // Put spend monitor over budget
      const spendMonitor = mainLoop.getSpendMonitor();
      vi.spyOn(spendMonitor, 'getStats').mockReturnValue({
        dailySpend: 200,
        weeklySpend: 600,
        dailyBudgetUsed: 200,
        weeklyBudgetUsed: 120,
        isOverBudget: true,
        totalSpend: 200,
        byModel: {
          opus: { spend: 150, sessions: 3 },
          sonnet: { spend: 50, sessions: 2 },
          haiku: { spend: 0, sessions: 0 },
        },
        lastUpdated: new Date(),
      });

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await mainLoop.start();

      const startupCall = mockSlack.sendMessage.mock.calls.find(
        call => typeof call[1] === 'string' && call[1].includes('TrafficControl Started')
      );
      expect(startupCall![1]).toContain('Over budget');


    });
  });

  describe('status check-in', () => {
    it('should start status check-in when interval is configured', async () => {
      const loopWithCheckIn = new MainLoop(
        { ...config, statusCheckInIntervalMs: 500 },
        deps
      );

      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };
      loopWithCheckIn.setSlackIntegration(mockSlack);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      await loopWithCheckIn.start();
      mockSlack.sendMessage.mockClear();

      // Advance timer past the status check-in interval
      await vi.advanceTimersByTimeAsync(500);

      const checkInCalls = mockSlack.sendMessage.mock.calls.filter(
        call => typeof call[1] === 'string' && call[1].includes('Status Check-In')
      );
      expect(checkInCalls.length).toBeGreaterThanOrEqual(1);


      await loopWithCheckIn.stop();
    });

    it('should not send status check-in when no Slack integration', async () => {
      const loopWithCheckIn = new MainLoop(
        { ...config, statusCheckInIntervalMs: 200 },
        deps
      );

      await loopWithCheckIn.start();

      // Advance past check-in interval - should not throw
      await vi.advanceTimersByTimeAsync(200);

      expect(loopWithCheckIn.isRunning()).toBe(true);

      await loopWithCheckIn.stop();
    });

    it('should not send status check-in when no channel configured', async () => {
      const loopWithCheckIn = new MainLoop(
        { ...config, statusCheckInIntervalMs: 200 },
        deps
      );

      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };
      loopWithCheckIn.setSlackIntegration(mockSlack);

      delete process.env.TC_SLACK_CHANNEL;

      await loopWithCheckIn.start();
      mockSlack.sendMessage.mockClear();

      await vi.advanceTimersByTimeAsync(200);

      const checkInCalls = mockSlack.sendMessage.mock.calls.filter(
        call => typeof call[1] === 'string' && call[1].includes('Status Check-In')
      );
      expect(checkInCalls).toHaveLength(0);


      await loopWithCheckIn.stop();
    });
  });

  describe('approval-aware scheduling', () => {
    it('should use approval callback when enableTaskApproval is true', async () => {
      const loopWithApproval = new MainLoop(
        { ...config, enableTaskApproval: true },
        deps
      );

      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await loopWithApproval.start();

      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // scheduleNext should have been called with a filter function
      expect(deps.scheduler.scheduleNext).toHaveBeenCalledWith(
        undefined,
        expect.any(Function)
      );

      await loopWithApproval.stop();
    });

    it('should not pass approval callback when enableTaskApproval is false', async () => {
      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      await mainLoop.start();

      vi.mocked(deps.scheduler.scheduleNext).mockClear();

      // Advance timer to trigger tick
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      // scheduleNext should be called without a filter
      expect(deps.scheduler.scheduleNext).toHaveBeenCalledWith(
        undefined,
        undefined
      );
    });
  });

  describe('global event handlers', () => {
    it('should call global event handlers and allow unsubscribe', async () => {
      const handler = vi.fn();
      const unsubscribe = mainLoop.onEvent(handler);

      const event: AgentEvent = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: { question: 'What?' },
        timestamp: new Date(),
      };

      await mainLoop.handleAgentEvent(event);
      expect(handler).toHaveBeenCalledWith(event);

      handler.mockClear();
      unsubscribe();

      await mainLoop.handleAgentEvent(event);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should continue dispatching when a global handler throws', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('handler error'));
      const goodHandler = vi.fn();

      mainLoop.onEvent(errorHandler);
      mainLoop.onEvent(goodHandler);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const event: AgentEvent = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      };

      await mainLoop.handleAgentEvent(event);

      // Both handlers should have been called
      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('safety callbacks', () => {
    it('should notify Slack when circuit breaker opens', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      mainLoop.setSlackIntegration(mockSlack);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      // Trip the circuit breaker
      const cb = mainLoop.getCircuitBreaker();
      for (let i = 0; i < config.circuitBreakerFailureThreshold; i++) {
        cb.recordFailure(`error-${i}`);
      }

      // Flush async
      await Promise.resolve();

      const cbCalls = mockSlack.sendMessage.mock.calls.filter(
        call => typeof call[1] === 'string' && call[1].includes('Circuit Breaker TRIPPED')
      );
      expect(cbCalls.length).toBeGreaterThanOrEqual(1);


    });

    it('should send spend alert to Slack when spend threshold crossed', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      mainLoop.setSlackIntegration(mockSlack);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      // Record enough spend to trigger alert (>80% of daily budget)
      const sm = mainLoop.getSpendMonitor();
      // Record cost close to daily budget to trigger alert
      for (let i = 0; i < 10; i++) {
        sm.recordAgentCost(`agent-${i}`, `task-${i}`, 'opus', 1000, 2000, 9);
      }

      await Promise.resolve();

      const alertCalls = mockSlack.sendMessage.mock.calls.filter(
        call => typeof call[1] === 'string' && call[1].includes('Budget Alert')
      );
      expect(alertCalls.length).toBeGreaterThanOrEqual(1);


    });

    it('should send productivity alert to Slack on consecutive failures', async () => {
      const mockSlack = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
      };

      mainLoop.setSlackIntegration(mockSlack);

      process.env.TC_SLACK_CHANNEL = 'C_TEST_CHANNEL';

      // Record consecutive failures to trigger productivity alert
      const pm = mainLoop.getProductivityMonitor();
      for (let i = 0; i < 5; i++) {
        pm.recordAgentCompletion(
          `agent-${i}`, `task-${i}`, 'opus',
          false, 10000, 1000, 3.0,
          undefined, `Error ${i}`
        );
      }

      await Promise.resolve();

      const alertCalls = mockSlack.sendMessage.mock.calls.filter(
        call => typeof call[1] === 'string' && call[1].includes('Productivity Alert')
      );
      expect(alertCalls.length).toBeGreaterThanOrEqual(1);


    });
  });

  describe('approval-aware scheduling callback', () => {
    it('should skip unapproved tasks that require approval', async () => {
      const loopWithApproval = new MainLoop(
        { ...config, enableTaskApproval: true },
        deps
      );

      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      // Capture the filter function passed to scheduleNext
      let capturedFilter: ((task: any) => Promise<boolean>) | undefined;
      vi.mocked(deps.scheduler.scheduleNext).mockImplementation(async (_project, filter) => {
        capturedFilter = filter as any;
        return { status: 'idle', scheduled: 0 };
      });

      await loopWithApproval.start();
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      expect(capturedFilter).toBeDefined();

      // Test with a task that requires approval and is not approved
      const approvalManager = loopWithApproval.getTaskApprovalManager();
      vi.spyOn(approvalManager, 'requiresApproval').mockReturnValue(true);
      vi.spyOn(approvalManager, 'isApproved').mockReturnValue(false);
      vi.spyOn(approvalManager, 'getPendingApproval').mockReturnValue(undefined);
      vi.spyOn(approvalManager, 'requestApproval').mockResolvedValue({
        taskId: 'task-x',
        requestedAt: new Date(),
        status: 'pending',
      } as any);

      const result = await capturedFilter!({
        id: 'task-x',
        title: 'Test Task',
        priority_confirmed: false,
      });

      expect(result).toBe(false);
      expect(approvalManager.requestApproval).toHaveBeenCalled();

      await loopWithApproval.stop();
    });

    it('should allow approved tasks through the filter', async () => {
      const loopWithApproval = new MainLoop(
        { ...config, enableTaskApproval: true },
        deps
      );

      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      let capturedFilter: ((task: any) => Promise<boolean>) | undefined;
      vi.mocked(deps.scheduler.scheduleNext).mockImplementation(async (_project, filter) => {
        capturedFilter = filter as any;
        return { status: 'idle', scheduled: 0 };
      });

      await loopWithApproval.start();
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      const approvalManager = loopWithApproval.getTaskApprovalManager();
      vi.spyOn(approvalManager, 'requiresApproval').mockReturnValue(true);
      vi.spyOn(approvalManager, 'isApproved').mockReturnValue(true);

      const result = await capturedFilter!({
        id: 'task-approved',
        title: 'Approved Task',
      });

      expect(result).toBe(true);

      await loopWithApproval.stop();
    });

    it('should skip tasks with pending approvals without requesting again', async () => {
      const loopWithApproval = new MainLoop(
        { ...config, enableTaskApproval: true },
        deps
      );

      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      let capturedFilter: ((task: any) => Promise<boolean>) | undefined;
      vi.mocked(deps.scheduler.scheduleNext).mockImplementation(async (_project, filter) => {
        capturedFilter = filter as any;
        return { status: 'idle', scheduled: 0 };
      });

      await loopWithApproval.start();
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      const approvalManager = loopWithApproval.getTaskApprovalManager();
      vi.spyOn(approvalManager, 'requiresApproval').mockReturnValue(true);
      vi.spyOn(approvalManager, 'isApproved').mockReturnValue(false);
      vi.spyOn(approvalManager, 'getPendingApproval').mockReturnValue({
        taskId: 'task-pending',
        requestedAt: new Date(),
        status: 'pending',
      } as any);
      vi.spyOn(approvalManager, 'requestApproval');

      const result = await capturedFilter!({
        id: 'task-pending',
        title: 'Pending Task',
      });

      expect(result).toBe(false);
      expect(approvalManager.requestApproval).not.toHaveBeenCalled();

      await loopWithApproval.stop();
    });

    it('should allow tasks that do not require approval', async () => {
      const loopWithApproval = new MainLoop(
        { ...config, enableTaskApproval: true },
        deps
      );

      vi.mocked(deps.scheduler.canSchedule).mockReturnValue(true);

      let capturedFilter: ((task: any) => Promise<boolean>) | undefined;
      vi.mocked(deps.scheduler.scheduleNext).mockImplementation(async (_project, filter) => {
        capturedFilter = filter as any;
        return { status: 'idle', scheduled: 0 };
      });

      await loopWithApproval.start();
      await vi.advanceTimersByTimeAsync(config.pollIntervalMs);

      const approvalManager = loopWithApproval.getTaskApprovalManager();
      vi.spyOn(approvalManager, 'requiresApproval').mockReturnValue(false);

      const result = await capturedFilter!({
        id: 'task-nonapproval',
        title: 'Auto-approved Task',
      });

      expect(result).toBe(true);

      await loopWithApproval.stop();
    });
  });

  describe('agent manager event routing', () => {
    it('should route agent manager events through handleAgentManagerEvent', async () => {
      // Capture the callbacks registered via agentManager.onEvent
      const capturedCallbacks: Record<string, Function> = {};
      vi.mocked(deps.agentManager.onEvent).mockImplementation((eventType: string, callback: Function) => {
        capturedCallbacks[eventType] = callback;
      });

      // Re-create mainLoop so onEvent captures the callbacks
      const freshLoop = new MainLoop(config, deps);

      // Set up an agent in state for the completion to find
      freshLoop.getStateManager().addAgent({
        sessionId: 'session-routed',
        taskId: 'task-routed',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      // Mock getSession to return session info
      vi.mocked(deps.agentManager.getSession).mockReturnValue({
        id: 'session-routed',
        taskId: 'task-routed',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
        tokensUsed: 0,
      });

      // Trigger the completion callback
      expect(capturedCallbacks['completion']).toBeDefined();
      await capturedCallbacks['completion']({
        sessionId: 'session-routed',
        data: { summary: 'Routed completion' },
        timestamp: new Date(),
      });

      // Agent should have been removed from state (completion processed)
      expect(freshLoop.getStateManager().getState().activeAgents.has('session-routed')).toBe(false);
    });
  });
});
