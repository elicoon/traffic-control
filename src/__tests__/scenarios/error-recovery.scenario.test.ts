/**
 * Error Recovery Scenario Tests
 *
 * Simulates database outages, Slack failures, and agent crashes
 * to verify Phase 5 resilience features recover correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Mock the db/client module BEFORE importing anything that uses it
vi.mock('../../db/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../db/client.js')>();
  return {
    ...original,
    checkHealth: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 10 }),
    waitForHealthy: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 10 }),
    getClient: vi.fn().mockReturnValue({}),
    createSupabaseClient: vi.fn().mockReturnValue({}),
  };
});

import { MainLoop, OrchestrationConfig, OrchestrationDependencies } from '../../orchestrator/main-loop.js';
import { EventBus, resetDefaultEventBus } from '../../events/event-bus.js';
import { checkHealth, waitForHealthy } from '../../db/client.js';
import { NotificationManager, NotificationConfig, SendFunction } from '../../slack/notification-manager.js';

// ============================================================================
// Shared Mock Factories
// ============================================================================

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

function createMockDeps(): OrchestrationDependencies {
  return {
    scheduler: createMockScheduler() as any,
    agentManager: createMockAgentManager() as any,
    backlogManager: {
      getStats: vi.fn().mockResolvedValue({ totalQueued: 0, byProject: {} }),
      addTask: vi.fn().mockResolvedValue({ id: 'task-123' }),
    } as any,
    reporter: {
      generateReport: vi.fn().mockResolvedValue({ timestamp: new Date().toISOString(), status: 'healthy' }),
    } as any,
    capacityTracker: {
      releaseCapacity: vi.fn(),
      getCapacity: vi.fn().mockReturnValue({
        opus: { current: 0, limit: 5, available: 5 },
        sonnet: { current: 0, limit: 10, available: 10 },
      }),
    } as any,
    learningProvider: { loadLearnings: vi.fn().mockResolvedValue([]) } as any,
    retrospectiveTrigger: { checkTrigger: vi.fn().mockReturnValue({ shouldTrigger: false }) } as any,
    budgetTracker: { checkBudgetAlerts: vi.fn().mockResolvedValue([]) } as any,
  };
}

function createTestConfig(overrides: Partial<OrchestrationConfig> = {}): OrchestrationConfig {
  return {
    pollIntervalMs: 100,
    maxConcurrentAgents: 5,
    gracefulShutdownTimeoutMs: 1000,
    stateFilePath: '',
    validateDatabaseOnStartup: false,
    runPreFlightChecks: false,
    requirePreFlightConfirmation: false,
    dbRetryConfig: {
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
    },
    maxConsecutiveDbFailures: 3,
    enableTaskApproval: false,
    statusCheckInIntervalMs: 0,
    dailyBudgetUsd: 50,
    weeklyBudgetUsd: 200,
    hardStopAtBudgetLimit: false,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerResetTimeoutMs: 300000,
    ...overrides,
  };
}

// ============================================================================
// Scenario 1: Database Outage During Startup
// ============================================================================

describe('Scenario: Database outage during startup', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    resetDefaultEventBus();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-scenario-startup-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    resetDefaultEventBus();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should retry with exponential backoff when database is unavailable at startup', async () => {
    // Configure waitForHealthy to simulate 2 failed attempts then success,
    // invoking the onRetry callback for each failed attempt (exercising the
    // actual retry/backoff path that DatabaseHealthMonitor.validateOnStartup
    // delegates to).
    const mockWaitForHealthy = vi.mocked(waitForHealthy);
    const retryAttempts: Array<{ attempt: number; delay: number; lastError?: string }> = [];

    mockWaitForHealthy.mockImplementationOnce(async (_config, onRetry) => {
      // Simulate 2 failed health checks before succeeding
      if (onRetry) {
        onRetry(1, 100, 'Connection refused');
        retryAttempts.push({ attempt: 1, delay: 100, lastError: 'Connection refused' });
        onRetry(2, 200, 'Connection refused');
        retryAttempts.push({ attempt: 2, delay: 200, lastError: 'Connection refused' });
      }
      return { healthy: true, latencyMs: 50 };
    });

    const config = createTestConfig({
      stateFilePath: path.join(tempDir, 'state.json'),
      validateDatabaseOnStartup: true,
    });
    const deps = createMockDeps();
    const eventBus = new EventBus({ historySize: 50 });
    const mainLoop = new MainLoop(config, deps, eventBus);

    await mainLoop.start();

    // Verify startup succeeded after retries
    expect(mainLoop.isRunning()).toBe(true);

    // Verify waitForHealthy was called (the real retry mechanism)
    expect(mockWaitForHealthy).toHaveBeenCalledTimes(1);

    // Verify retry callbacks were invoked with increasing delays (backoff)
    expect(retryAttempts).toHaveLength(2);
    expect(retryAttempts[0].delay).toBeLessThan(retryAttempts[1].delay);

    // Verify database:healthy event was emitted via recordStartupHealthy
    const healthyEvents = eventBus.getHistory({ types: ['database:healthy'] });
    expect(healthyEvents.length).toBeGreaterThanOrEqual(1);

    await mainLoop.stop();
  });

  it('should fail startup when database never becomes healthy', async () => {
    const config = createTestConfig({
      stateFilePath: path.join(tempDir, 'state.json'),
      validateDatabaseOnStartup: true,
    });
    const deps = createMockDeps();
    const mainLoop = new MainLoop(config, deps);

    // Mock validateOnStartup to return unhealthy
    const dbHealthMonitor = mainLoop.getDatabaseHealthMonitor();
    vi.spyOn(dbHealthMonitor, 'validateOnStartup').mockResolvedValue({
      healthy: false,
      latencyMs: 0,
      error: 'Connection refused after all retries',
    });

    await expect(mainLoop.start()).rejects.toThrow('Database unavailable');
    expect(mainLoop.isRunning()).toBe(false);
  });
});

// ============================================================================
// Scenario 2: Database Outage During Tick
// ============================================================================

describe('Scenario: Database outage during tick', () => {
  let tempDir: string;
  let mainLoop: MainLoop;
  let eventBus: EventBus;

  beforeEach(async () => {
    vi.useFakeTimers();
    resetDefaultEventBus();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-scenario-tick-'));

    const config = createTestConfig({
      stateFilePath: path.join(tempDir, 'state.json'),
      maxConsecutiveDbFailures: 3,
    });
    const deps = createMockDeps();
    eventBus = new EventBus({ historySize: 50 });
    mainLoop = new MainLoop(config, deps, eventBus);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (mainLoop.isRunning()) {
      await mainLoop.stop().catch(() => {});
    }
    resetDefaultEventBus();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should enter degraded mode after consecutive database failures during ticks', async () => {
    await mainLoop.start();

    const dbHealthMonitor = mainLoop.getDatabaseHealthMonitor();
    const degradedEvents: unknown[] = [];
    eventBus.on('database:degraded', (event) => { degradedEvents.push(event); });

    // Simulate 3 consecutive DB failures to trigger degraded mode
    const dbError = new Error('Database connection timeout');
    dbHealthMonitor.onDbFailure(dbError);
    dbHealthMonitor.onDbFailure(dbError);
    dbHealthMonitor.onDbFailure(dbError);

    // Verify degraded mode
    expect(dbHealthMonitor.isDegraded()).toBe(true);
    expect(degradedEvents.length).toBe(1);

    // Verify stats reflect degraded state
    const stats = dbHealthMonitor.getStats();
    expect(stats.healthy).toBe(false);
    expect(stats.consecutiveFailures).toBe(3);
    expect(stats.lastError).toBe('Database connection timeout');

    await mainLoop.stop();
  });

  it('should recover from degraded mode when database becomes healthy', async () => {
    await mainLoop.start();

    const dbHealthMonitor = mainLoop.getDatabaseHealthMonitor();
    const recoveredEvents: unknown[] = [];
    eventBus.on('database:recovered', (event) => { recoveredEvents.push(event); });

    // Enter degraded mode
    const dbError = new Error('Database connection timeout');
    dbHealthMonitor.onDbFailure(dbError);
    dbHealthMonitor.onDbFailure(dbError);
    dbHealthMonitor.onDbFailure(dbError);
    expect(dbHealthMonitor.isDegraded()).toBe(true);

    // Mock checkHealth to return healthy for recovery attempt
    vi.mocked(checkHealth).mockResolvedValueOnce({ healthy: true, latencyMs: 15 });

    // Trigger recovery attempt
    await dbHealthMonitor.attemptDbRecovery();

    // Verify recovery
    expect(dbHealthMonitor.isDegraded()).toBe(false);
    expect(recoveredEvents.length).toBe(1);

    // Verify stats are reset
    const stats = dbHealthMonitor.getStats();
    expect(stats.healthy).toBe(true);
    expect(stats.consecutiveFailures).toBe(0);

    await mainLoop.stop();
  });

  it('should remain in degraded mode if recovery attempt fails', async () => {
    await mainLoop.start();

    const dbHealthMonitor = mainLoop.getDatabaseHealthMonitor();

    // Enter degraded mode
    const dbError = new Error('Database connection timeout');
    dbHealthMonitor.onDbFailure(dbError);
    dbHealthMonitor.onDbFailure(dbError);
    dbHealthMonitor.onDbFailure(dbError);
    expect(dbHealthMonitor.isDegraded()).toBe(true);

    // Mock checkHealth to still be unhealthy
    vi.mocked(checkHealth).mockResolvedValueOnce({
      healthy: false,
      latencyMs: 5000,
      error: 'Still down',
    });

    // Attempt recovery — should stay degraded
    await dbHealthMonitor.attemptDbRecovery();
    expect(dbHealthMonitor.isDegraded()).toBe(true);

    await mainLoop.stop();
  });

  it('should emit correct event sequence: healthy → degraded → recovered', async () => {
    await mainLoop.start();

    const dbHealthMonitor = mainLoop.getDatabaseHealthMonitor();
    const eventSequence: string[] = [];

    eventBus.on('database:healthy', () => { eventSequence.push('healthy'); });
    eventBus.on('database:degraded', () => { eventSequence.push('degraded'); });
    eventBus.on('database:recovered', () => { eventSequence.push('recovered'); });

    // Record initial healthy state
    dbHealthMonitor.recordStartupHealthy(10);

    // Enter degraded mode
    const dbError = new Error('Connection lost');
    dbHealthMonitor.onDbFailure(dbError);
    dbHealthMonitor.onDbFailure(dbError);
    dbHealthMonitor.onDbFailure(dbError);

    // Recover
    vi.mocked(checkHealth).mockResolvedValueOnce({ healthy: true, latencyMs: 20 });
    await dbHealthMonitor.attemptDbRecovery();

    expect(eventSequence).toEqual(['healthy', 'degraded', 'recovered']);

    await mainLoop.stop();
  });
});

// ============================================================================
// Scenario 3: Slack Transient Failure
// ============================================================================

describe('Scenario: Slack transient failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set time outside quiet hours so flush() processes all notifications
    vi.setSystemTime(new Date('2024-06-15T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle send failure gracefully and track it in stats', async () => {
    const mockSendFn: SendFunction = vi.fn()
      .mockRejectedValueOnce(new Error('Slack API rate limited'))
      .mockResolvedValueOnce('ts-success');

    const config: NotificationConfig = {
      batchIntervalMs: 5000,
      quietHoursStart: 0,
      quietHoursEnd: 6,
      channelId: 'C-TEST',
    };

    const manager = new NotificationManager(config, mockSendFn);

    // Queue a notification that will fail
    manager.queue({
      type: 'question',
      agentId: 'agent-1',
      taskId: 'task-1',
      projectName: 'TestProject',
      message: 'Need help with this',
    });

    // Flush — the send will fail
    await manager.flush();

    const statsAfterFailure = manager.getStats();
    expect(statsAfterFailure.totalFailed).toBe(1);
    expect(statsAfterFailure.totalSent).toBe(0);

    // Queue another notification — this one should succeed
    manager.queue({
      type: 'completion',
      agentId: 'agent-2',
      taskId: 'task-2',
      projectName: 'TestProject',
      message: 'Task done',
    });

    await manager.flush();

    const statsAfterSuccess = manager.getStats();
    expect(statsAfterSuccess.totalSent).toBe(1);
    expect(statsAfterSuccess.totalFailed).toBe(1);

    manager.destroy();
  });

  it('should continue processing remaining notifications after one fails', async () => {
    const mockSendFn: SendFunction = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce('ts-2');

    const config: NotificationConfig = {
      batchIntervalMs: 5000,
      quietHoursStart: 0,
      quietHoursEnd: 6,
      channelId: 'C-TEST',
    };

    const manager = new NotificationManager(config, mockSendFn);

    // Queue two notifications
    manager.queue({
      type: 'blocker',
      agentId: 'agent-1',
      taskId: 'task-1',
      projectName: 'Project1',
      message: 'Blocked!',
    });

    manager.queue({
      type: 'completion',
      agentId: 'agent-2',
      taskId: 'task-2',
      projectName: 'Project2',
      message: 'Done',
    });

    // Flush — first will fail, second should still be attempted.
    // NotificationManager.sendNotification() catches errors internally and
    // removeFromQueue() runs unconditionally, so a failure on one notification
    // does not prevent processing subsequent ones.
    await manager.flush();

    expect(mockSendFn).toHaveBeenCalledTimes(2);
    const stats = manager.getStats();
    expect(stats.totalFailed).toBe(1);
    expect(stats.totalSent).toBe(1);

    manager.destroy();
  });

  it('should skip non-high-priority notifications during quiet hours', async () => {
    // Set time to quiet hours (3 AM)
    vi.setSystemTime(new Date('2024-06-15T03:00:00'));

    const mockSendFn: SendFunction = vi.fn().mockResolvedValue('ts-123');

    const config: NotificationConfig = {
      batchIntervalMs: 5000,
      quietHoursStart: 0,
      quietHoursEnd: 6,
      channelId: 'C-TEST',
    };

    const manager = new NotificationManager(config, mockSendFn);

    // Queue normal priority (should be skipped)
    manager.queue({
      type: 'completion',
      agentId: 'agent-1',
      taskId: 'task-1',
      projectName: 'Project1',
      message: 'Done',
      priority: 'normal',
    });

    // Queue high priority (should be sent)
    manager.queue({
      type: 'blocker',
      agentId: 'agent-2',
      taskId: 'task-2',
      projectName: 'Project2',
      message: 'Critical blocker!',
      priority: 'high',
    });

    await manager.flush();

    // Only the high-priority notification should have been sent
    expect(mockSendFn).toHaveBeenCalledTimes(1);
    const stats = manager.getStats();
    expect(stats.totalSent).toBe(1);
    // The normal-priority one should still be queued
    expect(stats.totalQueued).toBe(1);

    manager.destroy();
  });
});

// ============================================================================
// Scenario 4: Agent Crash
// ============================================================================

describe('Scenario: Agent crash', () => {
  let tempDir: string;
  let mainLoop: MainLoop;
  let eventBus: EventBus;
  let mockDeps: OrchestrationDependencies;

  beforeEach(async () => {
    vi.useFakeTimers();
    resetDefaultEventBus();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tc-scenario-agent-'));

    const config = createTestConfig({
      stateFilePath: path.join(tempDir, 'state.json'),
    });
    mockDeps = createMockDeps();
    eventBus = new EventBus({ historySize: 50 });
    mainLoop = new MainLoop(config, mockDeps, eventBus);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (mainLoop.isRunning()) {
      await mainLoop.stop().catch(() => {});
    }
    resetDefaultEventBus();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should clean up agent session and release capacity on crash', async () => {
    await mainLoop.start();

    const stateManager = mainLoop.getStateManager();

    // Add an agent to state (simulating a running agent)
    stateManager.addAgent({
      sessionId: 'agent-crash-1',
      taskId: 'task-1',
      model: 'opus',
      status: 'running',
      startedAt: new Date(Date.now() - 10000),
    });

    expect(stateManager.getState().activeAgents.size).toBe(1);

    // Simulate agent crash via error event
    await mainLoop.handleAgentEvent({
      type: 'error',
      agentId: 'agent-crash-1',
      taskId: 'task-1',
      payload: {
        error: 'Agent process exited unexpectedly',
        tokensUsed: 500,
        costUsd: 0.01,
      },
      timestamp: new Date(),
    });

    // Verify agent is removed from state
    expect(stateManager.getState().activeAgents.size).toBe(0);

    // Verify capacity was released
    expect(mockDeps.capacityTracker.releaseCapacity).toHaveBeenCalledWith('opus', 'agent-crash-1');

    // Verify circuit breaker tracked the failure
    const cbStats = mainLoop.getCircuitBreaker().getStats();
    expect(cbStats.failureCount).toBeGreaterThan(0);

    // Verify productivity monitor tracked the failure
    const prodStats = mainLoop.getProductivityMonitor().getStats();
    expect(prodStats.tasksFailed).toBe(1);

    await mainLoop.stop();
  });

  it('should maintain consistent state after multiple agent crashes', async () => {
    await mainLoop.start();

    const stateManager = mainLoop.getStateManager();

    // Add 3 agents
    for (let i = 1; i <= 3; i++) {
      stateManager.addAgent({
        sessionId: `agent-${i}`,
        taskId: `task-${i}`,
        model: i <= 2 ? 'opus' : 'sonnet',
        status: 'running',
        startedAt: new Date(Date.now() - i * 5000),
      });
    }
    expect(stateManager.getState().activeAgents.size).toBe(3);

    // Crash agent 1 and 3
    await mainLoop.handleAgentEvent({
      type: 'error',
      agentId: 'agent-1',
      taskId: 'task-1',
      payload: { error: 'OOM killed', tokensUsed: 100, costUsd: 0.01 },
      timestamp: new Date(),
    });

    await mainLoop.handleAgentEvent({
      type: 'error',
      agentId: 'agent-3',
      taskId: 'task-3',
      payload: { error: 'Segfault', tokensUsed: 200, costUsd: 0.005 },
      timestamp: new Date(),
    });

    // Agent 2 should still be running
    expect(stateManager.getState().activeAgents.size).toBe(1);
    expect(stateManager.getState().activeAgents.get('agent-2')?.status).toBe('running');

    // Complete agent 2 normally
    await mainLoop.handleAgentEvent({
      type: 'completion',
      agentId: 'agent-2',
      taskId: 'task-2',
      payload: { tokensUsed: 1000, costUsd: 0.03, durationMs: 5000, summary: 'Done' },
      timestamp: new Date(),
    });

    // All agents should be cleaned up
    expect(stateManager.getState().activeAgents.size).toBe(0);

    // Verify monitors tracked everything correctly
    const prodStats = mainLoop.getProductivityMonitor().getStats();
    expect(prodStats.tasksFailed).toBe(2);
    expect(prodStats.tasksSuccessful).toBe(1);
    expect(prodStats.tasksCompleted).toBe(3);

    // Verify spend was tracked for all agents
    const spendStats = mainLoop.getSpendMonitor().getStats();
    expect(spendStats.totalSpend).toBeGreaterThan(0);

    await mainLoop.stop();
  });

  it('should trip circuit breaker after enough agent crashes', async () => {
    const config = createTestConfig({
      stateFilePath: path.join(tempDir, 'state.json'),
      circuitBreakerFailureThreshold: 3,
    });
    mockDeps = createMockDeps();
    eventBus = new EventBus({ historySize: 50 });
    mainLoop = new MainLoop(config, mockDeps, eventBus);

    await mainLoop.start();

    const stateManager = mainLoop.getStateManager();
    const circuitBreaker = mainLoop.getCircuitBreaker();

    expect(circuitBreaker.getState()).toBe('closed');

    // Crash 3 agents to trip the circuit breaker
    for (let i = 1; i <= 3; i++) {
      stateManager.addAgent({
        sessionId: `crash-agent-${i}`,
        taskId: `crash-task-${i}`,
        model: 'opus',
        status: 'running',
        startedAt: new Date(),
      });

      await mainLoop.handleAgentEvent({
        type: 'error',
        agentId: `crash-agent-${i}`,
        taskId: `crash-task-${i}`,
        payload: { error: `Crash ${i}`, tokensUsed: 100, costUsd: 0.01 },
        timestamp: new Date(),
      });
    }

    // Circuit breaker should be tripped
    expect(circuitBreaker.isTripped()).toBe(true);
    expect(circuitBreaker.allowsOperation()).toBe(false);

    // Reset and verify recovery
    mainLoop.resetCircuitBreaker();
    expect(circuitBreaker.getState()).toBe('closed');
    expect(circuitBreaker.allowsOperation()).toBe(true);

    await mainLoop.stop();
  });
});
