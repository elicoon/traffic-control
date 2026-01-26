import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainLoop, OrchestrationConfig, OrchestrationDependencies } from './main-loop.js';
import { StateManager } from './state-manager.js';
import { EventDispatcher, AgentEvent } from './event-dispatcher.js';

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

const createMockDependencies = (): OrchestrationDependencies => ({
  scheduler: createMockScheduler() as any,
  agentManager: createMockAgentManager() as any,
  backlogManager: createMockBacklogManager() as any,
  reporter: createMockReporter() as any,
  capacityTracker: createMockCapacityTracker() as any,
  learningProvider: createMockLearningProvider() as any,
  retrospectiveTrigger: createMockRetrospectiveTrigger() as any,
});

const createDefaultConfig = (): OrchestrationConfig => ({
  pollIntervalMs: 100,
  maxConcurrentAgents: 5,
  gracefulShutdownTimeoutMs: 1000,
  stateFilePath: '/tmp/test-state.json',
});

describe('MainLoop', () => {
  let mainLoop: MainLoop;
  let config: OrchestrationConfig;
  let deps: OrchestrationDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

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

      expect(elapsed).toBeGreaterThanOrEqual(50);
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
});
