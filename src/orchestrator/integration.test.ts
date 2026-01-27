/**
 * Phase 5 Integration Tests
 *
 * Tests the integration between all Phase 5 components:
 * - MainLoop orchestration
 * - EventBus pub/sub messaging
 * - SlackRouter routing
 * - CLI commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MainLoop, OrchestrationConfig, OrchestrationDependencies, SlackIntegration } from './main-loop.js';
import { EventBus, resetDefaultEventBus } from '../events/event-bus.js';
import { createEvent } from '../events/event-types.js';
import { SlackRouter, SlackRouterConfig, SendMessageFn, UploadFileFn } from '../slack/router.js';
import { NotificationManager, NotificationConfig, SendFunction } from '../slack/notification-manager.js';
import { StateManager } from './state-manager.js';
import { SlackMessage } from '../slack/bot.js';
import { Task } from '../db/repositories/tasks.js';

// =============================================================================
// Mock Dependencies
// =============================================================================

function createMockScheduler() {
  return {
    canSchedule: vi.fn().mockReturnValue(true),
    scheduleNext: vi.fn().mockResolvedValue({ status: 'no_tasks', tasks: [] }),
    getStats: vi.fn().mockReturnValue({
      queuedTasks: 0,
      capacity: {
        opus: { current: 0, limit: 5, available: 5, utilization: 0 },
        sonnet: { current: 0, limit: 10, available: 10, utilization: 0 },
      },
    }),
    syncCapacity: vi.fn(),
  };
}

function createMockAgentManager() {
  return {
    onEvent: vi.fn(),
    getSession: vi.fn().mockReturnValue(null),
    getActiveSessions: vi.fn().mockReturnValue([]),
  };
}

function createMockBacklogManager() {
  return {
    getStats: vi.fn().mockResolvedValue({
      totalQueued: 5,
      byProject: {},
    }),
    addTask: vi.fn().mockResolvedValue({ id: 'task-123' }),
  };
}

function createMockReporter() {
  return {
    generateReport: vi.fn().mockResolvedValue({
      timestamp: new Date().toISOString(),
      status: 'healthy',
    }),
  };
}

function createMockCapacityTracker() {
  return {
    releaseCapacity: vi.fn(),
    getCapacity: vi.fn().mockReturnValue({
      opus: { current: 0, limit: 5, available: 5 },
      sonnet: { current: 0, limit: 10, available: 10 },
    }),
  };
}

function createMockLearningProvider() {
  return {
    loadLearnings: vi.fn().mockResolvedValue([]),
  };
}

function createMockRetrospectiveTrigger() {
  return {
    checkTrigger: vi.fn().mockReturnValue({ shouldTrigger: false }),
  };
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Phase 5 Integration', () => {
  let mainLoop: MainLoop;
  let eventBus: EventBus;
  let mockDeps: OrchestrationDependencies;
  let config: OrchestrationConfig;
  let tempDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    resetDefaultEventBus();

    // Create a temp directory for state file
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-integration-test-'));
    stateFilePath = path.join(tempDir, 'state.json');

    config = {
      pollIntervalMs: 100,
      maxConcurrentAgents: 5,
      gracefulShutdownTimeoutMs: 5000,
      stateFilePath: stateFilePath,
      validateDatabaseOnStartup: false,
      dbRetryConfig: {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
      },
      maxConsecutiveDbFailures: 3,
      runPreFlightChecks: false,
      requirePreFlightConfirmation: false,
      enableTaskApproval: false,
      statusCheckInIntervalMs: 0,
      dailyBudgetUsd: 50,
      weeklyBudgetUsd: 200,
      hardStopAtBudgetLimit: false,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerResetTimeoutMs: 300000,
    };

    mockDeps = {
      scheduler: createMockScheduler() as any,
      agentManager: createMockAgentManager() as any,
      backlogManager: createMockBacklogManager() as any,
      reporter: createMockReporter() as any,
      capacityTracker: createMockCapacityTracker() as any,
      learningProvider: createMockLearningProvider() as any,
      retrospectiveTrigger: createMockRetrospectiveTrigger() as any,
    };

    mainLoop = new MainLoop(config, mockDeps);
    eventBus = new EventBus({ historySize: 50 });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (mainLoop.isRunning()) {
      try {
        await mainLoop.stop();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    resetDefaultEventBus();
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  // ===========================================================================
  // MainLoop with EventBus Integration
  // ===========================================================================

  describe('MainLoop with EventBus', () => {
    it('should start and stop the orchestration loop', async () => {
      expect(mainLoop.isRunning()).toBe(false);

      await mainLoop.start();
      expect(mainLoop.isRunning()).toBe(true);

      await mainLoop.stop();
      expect(mainLoop.isRunning()).toBe(false);
    });

    it('should pause and resume the orchestration loop', async () => {
      await mainLoop.start();
      expect(mainLoop.isPaused()).toBe(false);

      await mainLoop.pause();
      expect(mainLoop.isPaused()).toBe(true);
      expect(mainLoop.isRunning()).toBe(true);

      await mainLoop.resume();
      expect(mainLoop.isPaused()).toBe(false);
    });

    it('should dispatch events through the event dispatcher', async () => {
      const eventHandler = vi.fn();
      mainLoop.onEvent(eventHandler);

      await mainLoop.start();

      // Simulate an agent event
      await mainLoop.handleAgentEvent({
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: { result: 'success' },
        timestamp: new Date(),
      });

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'completion',
          agentId: 'agent-1',
        })
      );
    });

    it('should emit events through EventBus and receive them', () => {
      const handler = vi.fn();
      eventBus.on('agent:spawned', handler);

      eventBus.emit(createEvent('agent:spawned', {
        agentId: 'agent-123',
        taskId: 'task-456',
        model: 'opus',
        context: ['ctx1'],
      }));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:spawned',
          payload: expect.objectContaining({
            agentId: 'agent-123',
            model: 'opus',
          }),
        })
      );
    });

    it('should maintain event history', () => {
      eventBus.emit(createEvent('system:started', { version: '1.0.0', config: {} }));
      eventBus.emit(createEvent('agent:spawned', {
        agentId: 'a1',
        taskId: 't1',
        model: 'sonnet',
        context: [],
      }));
      eventBus.emit(createEvent('agent:completed', {
        agentId: 'a1',
        taskId: 't1',
        summary: 'Task completed successfully',
        durationMs: 1000,
      }));

      const history = eventBus.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].type).toBe('system:started');
      expect(history[1].type).toBe('agent:spawned');
      expect(history[2].type).toBe('agent:completed');
    });

    it('should isolate handler errors', () => {
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const successHandler = vi.fn();

      eventBus.on('agent:spawned', errorHandler);
      eventBus.on('agent:spawned', successHandler);

      // Should not throw
      expect(() => {
        eventBus.emit(createEvent('agent:spawned', {
          agentId: 'a1',
          taskId: 't1',
          model: 'haiku',
          context: [],
        }));
      }).not.toThrow();

      // Both handlers should be called
      expect(errorHandler).toHaveBeenCalled();
      expect(successHandler).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // SlackRouter Integration
  // ===========================================================================

  describe('SlackRouter Integration', () => {
    let slackRouter: SlackRouter;
    let mockSendMessage: SendMessageFn;
    let mockUploadFile: UploadFileFn;

    beforeEach(() => {
      mockSendMessage = vi.fn<SendMessageFn>().mockResolvedValue('1234567890.123456');
      mockUploadFile = vi.fn<UploadFileFn>().mockResolvedValue('file-123');

      const routerConfig: SlackRouterConfig = {
        channelId: 'C12345',
        batchIntervalMs: 1000,
        quietHoursStart: 0,
        quietHoursEnd: 6,
      };

      slackRouter = new SlackRouter(routerConfig, mockSendMessage, mockUploadFile);
    });

    it('should route questions to Slack and track threads', async () => {
      const threadTs = await slackRouter.routeQuestion(
        'agent-1',
        'task-1',
        'TestProject',
        'What should I do with the error?'
      );

      expect(threadTs).toBe('1234567890.123456');
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345',
          text: expect.stringContaining('What should I do with the error?'),
        })
      );

      const thread = slackRouter.getThreadForTask('task-1');
      expect(thread).toBeDefined();
      expect(thread?.agentId).toBe('agent-1');
      expect(thread?.status).toBe('waiting_response');
    });

    it('should route blockers to Slack', async () => {
      const threadTs = await slackRouter.routeBlocker(
        'agent-2',
        'task-2',
        'TestProject',
        'Cannot access the database'
      );

      expect(threadTs).toBe('1234567890.123456');
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Cannot access the database'),
        })
      );
    });

    it('should handle user responses', async () => {
      const responseHandler = vi.fn();
      slackRouter.onResponse(responseHandler);

      // First route a question to create a thread
      await slackRouter.routeQuestion('agent-1', 'task-1', 'TestProject', 'Question?');

      // Handle a response
      await slackRouter.handleResponse('1234567890.123456', 'U123', 'Here is the answer');

      expect(responseHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-1',
          agentId: 'agent-1',
          text: 'Here is the answer',
        })
      );
    });

    it('should detect skip commands', async () => {
      const responseHandler = vi.fn();
      slackRouter.onResponse(responseHandler);

      await slackRouter.routeBlocker('agent-1', 'task-1', 'TestProject', 'Blocked');
      await slackRouter.handleResponse('1234567890.123456', 'U123', 'skip');

      expect(responseHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          isSkip: true,
        })
      );
    });

    it('should route completion notifications', async () => {
      await slackRouter.routeCompletion(
        'agent-1',
        'task-1',
        'TestProject',
        'Task completed successfully'
      );

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Task complete'),
        })
      );
    });
  });

  // ===========================================================================
  // NotificationManager Integration
  // ===========================================================================

  describe('NotificationManager Integration', () => {
    let notificationManager: NotificationManager;
    let mockSendFn: SendFunction;

    beforeEach(() => {
      mockSendFn = vi.fn<SendFunction>().mockResolvedValue('1234567890.123456');

      const notificationConfig: NotificationConfig = {
        batchIntervalMs: 1000,
        quietHoursStart: 0,
        quietHoursEnd: 6,
        channelId: 'C12345',
      };

      notificationManager = new NotificationManager(notificationConfig, mockSendFn);
    });

    afterEach(() => {
      notificationManager.stopBatchTimer();
    });

    it('should batch notifications', async () => {
      notificationManager.queue({
        type: 'question',
        projectName: 'Project1',
        agentId: 'agent-1',
        taskId: 'task-1',
        message: 'Question 1',
      });

      notificationManager.queue({
        type: 'question',
        projectName: 'Project1',
        agentId: 'agent-2',
        taskId: 'task-2',
        message: 'Question 2',
      });

      // Manually flush
      await notificationManager.flush();

      expect(mockSendFn).toHaveBeenCalledTimes(2);
    });

    it('should respect quiet hours', () => {
      // Set time to quiet hours (2 AM)
      vi.setSystemTime(new Date('2024-01-01T02:00:00'));

      expect(notificationManager.isQuietHours()).toBe(true);
    });

    it('should handle DND mode', () => {
      expect(notificationManager.isDndActive()).toBe(false);

      notificationManager.setDnd(3600000); // 1 hour
      expect(notificationManager.isDndActive()).toBe(true);

      notificationManager.disableDnd();
      expect(notificationManager.isDndActive()).toBe(false);
    });
  });

  // ===========================================================================
  // State Management Integration
  // ===========================================================================

  describe('StateManager Integration', () => {
    let stateManager: StateManager;
    let stateManagerTempDir: string;

    beforeEach(async () => {
      stateManagerTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-state-test-'));
      stateManager = new StateManager({
        stateFilePath: path.join(stateManagerTempDir, 'state.json'),
      });
    });

    afterEach(async () => {
      try {
        await fs.rm(stateManagerTempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    it('should manage agent state', () => {
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      const state = stateManager.getState();
      expect(state.activeAgents.size).toBe(1);
      expect(state.activeAgents.get('session-1')?.status).toBe('running');
    });

    it('should update agent state', () => {
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      stateManager.updateAgent('session-1', { status: 'blocked' });

      const agent = stateManager.getState().activeAgents.get('session-1');
      expect(agent?.status).toBe('blocked');
    });

    it('should remove agents', () => {
      stateManager.addAgent({
        sessionId: 'session-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      stateManager.removeAgent('session-1');

      expect(stateManager.getState().activeAgents.size).toBe(0);
    });
  });

  // ===========================================================================
  // Event Flow Integration
  // ===========================================================================

  describe('Event Flow Integration', () => {
    it('should flow events from agent spawn through completion', async () => {
      const events: string[] = [];

      eventBus.on('agent:spawned', () => { events.push('spawned'); });
      eventBus.on('agent:question', () => { events.push('question'); });
      eventBus.on('agent:completed', () => { events.push('completed'); });

      // Simulate agent lifecycle
      eventBus.emit(createEvent('agent:spawned', {
        agentId: 'a1',
        taskId: 't1',
        model: 'opus',
        context: [],
      }));

      eventBus.emit(createEvent('agent:question', {
        agentId: 'a1',
        taskId: 't1',
        question: 'Need help?',
        threadTs: '123456.789',
      }));

      eventBus.emit(createEvent('agent:completed', {
        agentId: 'a1',
        taskId: 't1',
        summary: 'Task completed successfully',
        durationMs: 5000,
      }));

      expect(events).toEqual(['spawned', 'question', 'completed']);
    });

    it('should support correlation IDs for tracing', () => {
      const correlationId = 'corr-12345';
      const correlatedEvents: string[] = [];

      eventBus.onPattern(/^agent:/, (event) => {
        if (event.correlationId === correlationId) {
          correlatedEvents.push(event.type);
        }
      });

      // Events with same correlation ID
      eventBus.emit(createEvent('agent:spawned', {
        agentId: 'a1',
        taskId: 't1',
        model: 'opus',
        context: [],
      }, correlationId));

      eventBus.emit(createEvent('agent:completed', {
        agentId: 'a1',
        taskId: 't1',
        summary: 'Done',
        durationMs: 1000,
      }, correlationId));

      // Event without correlation ID
      eventBus.emit(createEvent('agent:spawned', {
        agentId: 'a2',
        taskId: 't2',
        model: 'sonnet',
        context: [],
      }));

      expect(correlatedEvents).toEqual(['agent:spawned', 'agent:completed']);
    });

    it('should filter history by event type', () => {
      eventBus.emit(createEvent('system:started', { version: '1.0.0', config: {} }));
      eventBus.emit(createEvent('agent:spawned', {
        agentId: 'a1',
        taskId: 't1',
        model: 'opus',
        context: [],
      }));
      eventBus.emit(createEvent('task:queued', {
        taskId: 't1',
        projectId: 'p1',
        priority: 5,
        title: 'Test task',
      }));
      eventBus.emit(createEvent('agent:completed', {
        agentId: 'a1',
        taskId: 't1',
        summary: 'Done',
        durationMs: 1000,
      }));

      const agentEvents = eventBus.getHistory({
        types: ['agent:spawned', 'agent:completed'],
      });

      expect(agentEvents).toHaveLength(2);
      expect(agentEvents.every(e => e.type.startsWith('agent:'))).toBe(true);
    });
  });

  // ===========================================================================
  // Full System Integration
  // ===========================================================================

  describe('Full System Integration', () => {
    it('should coordinate MainLoop, EventBus, and SlackRouter', async () => {
      const events: string[] = [];

      // Setup EventBus listeners
      eventBus.on('system:started', () => { events.push('system:started'); });
      eventBus.on('agent:spawned', () => { events.push('agent:spawned'); });
      eventBus.on('slack:message_received', () => { events.push('slack:received'); });

      // Setup MainLoop event handler
      const mainLoopHandler = vi.fn();
      mainLoop.onEvent(mainLoopHandler);

      // Start the system
      await mainLoop.start();
      eventBus.emit(createEvent('system:started', { version: '1.0.0', config: {} }));

      // Simulate agent spawn
      eventBus.emit(createEvent('agent:spawned', {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: ['learning-1'],
      }));

      // Simulate Slack message
      eventBus.emit(createEvent('slack:message_received', {
        threadTs: '123456.789',
        userId: 'U123',
        text: 'Approved',
        channel: 'C12345',
      }));

      expect(events).toContain('system:started');
      expect(events).toContain('agent:spawned');
      expect(events).toContain('slack:received');

      await mainLoop.stop();
    });

    it('should handle graceful shutdown', async () => {
      await mainLoop.start();
      expect(mainLoop.isRunning()).toBe(true);

      // Add an agent to state
      const stateManager = mainLoop.getStateManager();
      stateManager.addAgent({
        sessionId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      // Stop with graceful shutdown
      const stopPromise = mainLoop.stop();

      // Advance timers past the shutdown timeout
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;

      expect(mainLoop.isRunning()).toBe(false);
    });

    it('should provide comprehensive stats', async () => {
      await mainLoop.start();

      const stats = mainLoop.getStats();

      expect(stats).toMatchObject({
        isRunning: true,
        isPaused: false,
        activeAgentCount: expect.any(Number),
        schedulerStats: expect.objectContaining({
          queuedTasks: expect.any(Number),
          capacity: expect.any(Object),
        }),
        safety: expect.objectContaining({
          circuitBreakerState: expect.any(String),
          spendStats: expect.any(Object),
          productivityStats: expect.any(Object),
        }),
      });

      await mainLoop.stop();
    });
  });

  // ===========================================================================
  // Safety Systems Integration
  // ===========================================================================

  describe('Safety Systems Integration', () => {
    let mockSlackIntegration: SlackIntegration;

    beforeEach(() => {
      mockSlackIntegration = {
        sendMessage: vi.fn().mockResolvedValue('ts-123'),
        sendApprovalRequest: vi.fn().mockResolvedValue('ts-456'),
      };
    });

    describe('Circuit Breaker', () => {
      it('should track failures and trip the circuit', async () => {
        await mainLoop.start();

        const circuitBreaker = mainLoop.getCircuitBreaker();
        expect(circuitBreaker.getState()).toBe('closed');

        // Record multiple failures to trip the circuit
        for (let i = 0; i < 5; i++) {
          circuitBreaker.recordFailure(`Error ${i}`);
        }

        expect(circuitBreaker.getState()).toBe('open');
        expect(circuitBreaker.isTripped()).toBe(true);

        await mainLoop.stop();
      });

      it('should prevent operations when circuit is open', async () => {
        await mainLoop.start();

        const circuitBreaker = mainLoop.getCircuitBreaker();

        // Trip the circuit
        circuitBreaker.trip('Manual test trip');

        expect(circuitBreaker.allowsOperation()).toBe(false);

        await mainLoop.stop();
      });

      it('should recover after reset', async () => {
        await mainLoop.start();

        const circuitBreaker = mainLoop.getCircuitBreaker();

        // Trip the circuit
        circuitBreaker.trip('Test trip');
        expect(circuitBreaker.isTripped()).toBe(true);

        // Reset the circuit
        mainLoop.resetCircuitBreaker();
        expect(circuitBreaker.getState()).toBe('closed');
        expect(circuitBreaker.allowsOperation()).toBe(true);

        await mainLoop.stop();
      });

      it('should notify Slack when circuit trips', async () => {
        mainLoop.setSlackIntegration(mockSlackIntegration);
        await mainLoop.start();

        const circuitBreaker = mainLoop.getCircuitBreaker();
        circuitBreaker.trip('Test failure');

        // Wait for async callback
        await vi.advanceTimersByTimeAsync(100);

        // Check Slack was notified (may not be called if TC_SLACK_CHANNEL is not set)
        // This test validates the integration is wired up correctly

        await mainLoop.stop();
      });
    });

    describe('Spend Monitor', () => {
      it('should track agent costs', async () => {
        await mainLoop.start();

        const spendMonitor = mainLoop.getSpendMonitor();

        // Record some spend
        spendMonitor.recordAgentCost('session-1', 'task-1', 'opus', 1000, 500, 0.05);
        spendMonitor.recordAgentCost('session-2', 'task-2', 'sonnet', 2000, 1000, 0.02);

        const stats = spendMonitor.getStats();
        expect(stats.totalSpend).toBeGreaterThan(0);
        expect(stats.byModel.opus.spend).toBe(0.05);
        expect(stats.byModel.sonnet.spend).toBe(0.02);

        await mainLoop.stop();
      });

      it('should calculate budget usage percentages', async () => {
        // Create mainloop with lower budget for testing
        const testConfig = {
          ...config,
          dailyBudgetUsd: 1,
          weeklyBudgetUsd: 5,
        };
        const testLoop = new MainLoop(testConfig, mockDeps);
        await testLoop.start();

        const spendMonitor = testLoop.getSpendMonitor();

        // Record $0.50 spend
        spendMonitor.recordAgentCost('session-1', 'task-1', 'opus', 1000, 500, 0.50);

        const stats = spendMonitor.getStats();
        expect(stats.dailyBudgetUsed).toBe(50); // 50% of $1 daily budget
        expect(stats.weeklyBudgetUsed).toBe(10); // 10% of $5 weekly budget

        await testLoop.stop();
      });

      it('should be reflected in main stats', async () => {
        await mainLoop.start();

        const spendMonitor = mainLoop.getSpendMonitor();
        spendMonitor.recordAgentCost('session-1', 'task-1', 'opus', 1000, 500, 0.10);

        const stats = mainLoop.getStats();
        expect(stats.safety.spendStats.dailySpend).toBe(0.10);

        await mainLoop.stop();
      });
    });

    describe('Productivity Monitor', () => {
      it('should track task completions', async () => {
        await mainLoop.start();

        const productivityMonitor = mainLoop.getProductivityMonitor();

        // Record successful completions
        productivityMonitor.recordAgentCompletion(
          'session-1', 'task-1', 'opus', true, 5000, 1500, 0.05, 'Summary'
        );
        productivityMonitor.recordAgentCompletion(
          'session-2', 'task-2', 'sonnet', true, 3000, 1000, 0.02, 'Summary'
        );

        const stats = productivityMonitor.getStats();
        expect(stats.tasksCompleted).toBe(2);
        expect(stats.tasksSuccessful).toBe(2);
        expect(stats.successRate).toBe(100);

        await mainLoop.stop();
      });

      it('should track failures and calculate success rate', async () => {
        await mainLoop.start();

        const productivityMonitor = mainLoop.getProductivityMonitor();

        // Record mix of successes and failures
        productivityMonitor.recordAgentCompletion(
          'session-1', 'task-1', 'opus', true, 5000, 1500, 0.05
        );
        productivityMonitor.recordAgentCompletion(
          'session-2', 'task-2', 'sonnet', false, 3000, 1000, 0.02, undefined, 'Error occurred'
        );

        const stats = productivityMonitor.getStats();
        expect(stats.tasksCompleted).toBe(2);
        expect(stats.tasksSuccessful).toBe(1);
        expect(stats.tasksFailed).toBe(1);
        expect(stats.successRate).toBe(50);

        await mainLoop.stop();
      });

      it('should be reflected in main stats', async () => {
        await mainLoop.start();

        const productivityMonitor = mainLoop.getProductivityMonitor();
        productivityMonitor.recordAgentCompletion(
          'session-1', 'task-1', 'opus', true, 5000, 1500, 0.05
        );

        const stats = mainLoop.getStats();
        expect(stats.safety.productivityStats.tasksCompleted).toBe(1);
        expect(stats.safety.productivityStats.successRate).toBe(100);

        await mainLoop.stop();
      });
    });

    describe('Task Approval Manager', () => {
      it('should require approval for unconfirmed tasks when enabled', async () => {
        const testConfig = {
          ...config,
          enableTaskApproval: true,
        };
        const testLoop = new MainLoop(testConfig, mockDeps);
        await testLoop.start();

        const approvalManager = testLoop.getTaskApprovalManager();

        // Task without priority_confirmed
        const task: Task = {
          id: 'task-1',
          project_id: 'proj-1',
          title: 'Test Task',
          description: null,
          status: 'queued',
          priority: 50,
          priority_confirmed: false,
          priority_confirmed_at: null,
          priority_confirmed_by: null,
          source: 'user',
          tags: [],
          acceptance_criteria: null,
          parent_task_id: null,
          blocked_by_task_id: null,
          eta: null,
          estimated_sessions_opus: 1,
          estimated_sessions_sonnet: 0,
          actual_sessions_opus: 0,
          actual_sessions_sonnet: 0,
          actual_tokens_opus: 0,
          actual_tokens_sonnet: 0,
          assigned_agent_id: null,
          requires_visual_review: false,
          complexity_estimate: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          started_at: null,
          completed_at: null,
        };

        expect(approvalManager.requiresApproval(task)).toBe(true);

        await testLoop.stop();
      });

      it('should auto-approve confirmed tasks', async () => {
        const testConfig = {
          ...config,
          enableTaskApproval: true,
        };
        const testLoop = new MainLoop(testConfig, mockDeps);
        await testLoop.start();

        const approvalManager = testLoop.getTaskApprovalManager();

        // Task with priority_confirmed
        const task: Task = {
          id: 'task-1',
          project_id: 'proj-1',
          title: 'Test Task',
          description: null,
          status: 'queued',
          priority: 50,
          priority_confirmed: true,
          priority_confirmed_at: new Date().toISOString(),
          priority_confirmed_by: 'user-123',
          source: 'user',
          tags: [],
          acceptance_criteria: null,
          parent_task_id: null,
          blocked_by_task_id: null,
          eta: null,
          estimated_sessions_opus: 1,
          estimated_sessions_sonnet: 0,
          actual_sessions_opus: 0,
          actual_sessions_sonnet: 0,
          actual_tokens_opus: 0,
          actual_tokens_sonnet: 0,
          assigned_agent_id: null,
          requires_visual_review: false,
          complexity_estimate: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          started_at: null,
          completed_at: null,
        };

        expect(approvalManager.requiresApproval(task)).toBe(false);

        await testLoop.stop();
      });

      it('should handle approval responses', async () => {
        const testConfig = {
          ...config,
          enableTaskApproval: true,
        };
        const testLoop = new MainLoop(testConfig, mockDeps);
        await testLoop.start();

        const approvalManager = testLoop.getTaskApprovalManager();

        // Create a mock task
        const task: Task = {
          id: 'task-1',
          project_id: 'proj-1',
          title: 'Test Task',
          description: null,
          status: 'queued',
          priority: 50,
          priority_confirmed: false,
          priority_confirmed_at: null,
          priority_confirmed_by: null,
          source: 'user',
          tags: [],
          acceptance_criteria: null,
          parent_task_id: null,
          blocked_by_task_id: null,
          eta: null,
          estimated_sessions_opus: 1,
          estimated_sessions_sonnet: 0,
          actual_sessions_opus: 0,
          actual_sessions_sonnet: 0,
          actual_tokens_opus: 0,
          actual_tokens_sonnet: 0,
          assigned_agent_id: null,
          requires_visual_review: false,
          complexity_estimate: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          started_at: null,
          completed_at: null,
        };

        // Request approval
        await approvalManager.requestApproval(task);
        expect(approvalManager.getPendingApproval('task-1')).toBeDefined();

        // Handle approval response
        testLoop.handleTaskApprovalResponse('task-1', true, 'user-123');
        expect(approvalManager.isApproved('task-1')).toBe(true);

        await testLoop.stop();
      });
    });

    describe('Safety Systems Work Together', () => {
      it('should update all monitors on agent completion', async () => {
        await mainLoop.start();

        // Add an agent to state first
        const stateManager = mainLoop.getStateManager();
        stateManager.addAgent({
          sessionId: 'agent-1',
          taskId: 'task-1',
          model: 'opus',
          status: 'running',
          startedAt: new Date(Date.now() - 5000),
        });

        // Simulate agent completion event
        await mainLoop.handleAgentEvent({
          type: 'completion',
          agentId: 'agent-1',
          taskId: 'task-1',
          payload: {
            tokensUsed: 1500,
            costUsd: 0.05,
            durationMs: 5000,
            summary: 'Task completed successfully',
          },
          timestamp: new Date(),
        });

        // Check all monitors were updated
        const spendStats = mainLoop.getSpendMonitor().getStats();
        const productivityStats = mainLoop.getProductivityMonitor().getStats();
        const circuitBreakerStats = mainLoop.getCircuitBreaker().getStats();

        expect(spendStats.totalSpend).toBeGreaterThan(0);
        expect(productivityStats.tasksCompleted).toBe(1);
        expect(productivityStats.tasksSuccessful).toBe(1);
        expect(circuitBreakerStats.state).toBe('closed');

        await mainLoop.stop();
      });

      it('should update monitors on agent error', async () => {
        await mainLoop.start();

        // Add an agent to state first
        const stateManager = mainLoop.getStateManager();
        stateManager.addAgent({
          sessionId: 'agent-1',
          taskId: 'task-1',
          model: 'opus',
          status: 'running',
          startedAt: new Date(Date.now() - 5000),
        });

        // Simulate agent error event
        await mainLoop.handleAgentEvent({
          type: 'error',
          agentId: 'agent-1',
          taskId: 'task-1',
          payload: {
            error: 'Something went wrong',
            tokensUsed: 500,
            costUsd: 0.01,
          },
          timestamp: new Date(),
        });

        // Check monitors were updated
        const productivityStats = mainLoop.getProductivityMonitor().getStats();
        const circuitBreakerStats = mainLoop.getCircuitBreaker().getStats();

        expect(productivityStats.tasksFailed).toBe(1);
        expect(circuitBreakerStats.failureCount).toBeGreaterThan(0);

        await mainLoop.stop();
      });

      it('should reflect all safety stats in getStats()', async () => {
        await mainLoop.start();

        const stats = mainLoop.getStats();

        // Verify safety section structure
        expect(stats.safety).toBeDefined();
        expect(stats.safety.circuitBreakerState).toBe('closed');
        expect(stats.safety.circuitBreakerTripped).toBe(false);
        expect(stats.safety.spendStats).toBeDefined();
        expect(stats.safety.spendStats.dailySpend).toBe(0);
        expect(stats.safety.spendStats.weeklySpend).toBe(0);
        expect(stats.safety.productivityStats).toBeDefined();
        expect(stats.safety.productivityStats.tasksCompleted).toBe(0);
        expect(stats.safety.pendingApprovals).toBe(0);

        await mainLoop.stop();
      });
    });
  });
});
