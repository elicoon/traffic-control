import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MainLoop } from '../../orchestrator/main-loop.js';
import { Scheduler } from '../../scheduler/scheduler.js';
import { TaskQueue } from '../../scheduler/task-queue.js';
import { CapacityTracker } from '../../scheduler/capacity-tracker.js';
import { Task } from '../../db/repositories/tasks.js';
import * as clientModule from '../../db/client.js';

// ---------------------------------------------------------------------------
// FakeAgentManager — simulates spawn → run → complete lifecycle
// ---------------------------------------------------------------------------

/**
 * FakeAgentManager simulates the AgentManager interface for integration tests.
 * On spawnAgent(), it creates a session and schedules an async completion event
 * after a configurable delay.
 */
class FakeAgentManager {
  private sessions = new Map<string, {
    id: string;
    taskId: string | null;
    model: 'opus' | 'sonnet' | 'haiku';
    status: string;
    startedAt: Date;
    tokensUsed: number;
  }>();
  private eventHandlers = new Map<string, ((event: unknown) => Promise<void>)[]>();
  private pendingTimers: NodeJS.Timeout[] = [];
  public spawnCount = 0;
  public completionDelayMs: number;

  constructor(completionDelayMs = 50) {
    this.completionDelayMs = completionDelayMs;
  }

  destroy(): void {
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers = [];
  }

  onEvent(type: string, handler: (event: unknown) => Promise<void>): void {
    const handlers = this.eventHandlers.get(type) || [];
    handlers.push(handler);
    this.eventHandlers.set(type, handlers);
  }

  async spawnAgent(taskId: string, config: { model: string; projectPath: string }): Promise<string> {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      id: sessionId,
      taskId,
      model: config.model as 'opus' | 'sonnet' | 'haiku',
      status: 'running',
      startedAt: new Date(),
      tokensUsed: 0,
    });
    this.spawnCount++;

    // Schedule async completion after delay (tracked for cleanup)
    const timer = setTimeout(() => {
      this.completeSession(sessionId);
    }, this.completionDelayMs);
    this.pendingTimers.push(timer);

    return sessionId;
  }

  getSession(id: string) {
    return this.sessions.get(id);
  }

  getActiveSessions() {
    return Array.from(this.sessions.values()).filter(s => s.status === 'running');
  }

  private async completeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'complete';
    session.tokensUsed = 1500;

    const handlers = this.eventHandlers.get('completion') || [];
    for (const handler of handlers) {
      await handler({
        sessionId,
        data: {
          summary: 'Task completed successfully',
          inputTokens: 500,
          outputTokens: 1000,
          costUsd: 0.50,
          durationMs: this.completionDelayMs,
        },
        timestamp: new Date(),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Mock factories (repositories only — Scheduler/StateManager are real)
// ---------------------------------------------------------------------------

const createMockBacklogManager = () => ({
  isBacklogLow: vi.fn().mockResolvedValue(false),
  getBacklogDepth: vi.fn().mockResolvedValue(10),
  getBacklogStats: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue({
    totalQueued: 10, totalInProgress: 0, totalBlocked: 0,
    totalPendingProposals: 0, isBacklogLow: false, threshold: 5,
  }),
});

const createMockReporter = () => ({
  start: vi.fn(), stop: vi.fn(),
  isRunning: vi.fn().mockReturnValue(false),
  sendImmediateReport: vi.fn().mockResolvedValue({ sent: true }),
  generateReport: vi.fn().mockResolvedValue({}),
});

const createMockLearningProvider = () => ({
  getContextForSession: vi.fn().mockResolvedValue({
    globalLearnings: [], projectLearnings: [], agentGuidelines: '',
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
  getById: vi.fn().mockImplementation(async (id: string) => ({
    id,
    project_id: 'project-integration-test',
    title: 'Integration Test Task',
    status: 'in_progress',
  })),
  create: vi.fn(), update: vi.fn(), updateStatus: vi.fn(),
  getQueued: vi.fn(), getByProject: vi.fn(), getByStatus: vi.fn(),
});

const createMockUsageLogRepository = () => ({
  create: vi.fn().mockResolvedValue({
    id: randomUUID(), session_id: '', task_id: '',
    model: 'sonnet', input_tokens: 0, output_tokens: 0,
    cache_read_tokens: 0, cache_creation_tokens: 0,
    cost_usd: 0, event_type: 'completion',
    created_at: new Date().toISOString(),
  }),
  getBySessionId: vi.fn().mockResolvedValue([]),
  getByTaskId: vi.fn().mockResolvedValue([]),
  getTotalUsageBySession: vi.fn().mockResolvedValue({
    inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0,
  }),
  getStats: vi.fn().mockResolvedValue({}),
  getRecent: vi.fn().mockResolvedValue([]),
  deleteOlderThan: vi.fn().mockResolvedValue(0),
  getDailySummary: vi.fn().mockResolvedValue([]),
});

// ---------------------------------------------------------------------------
// Test task factory
// ---------------------------------------------------------------------------

function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: randomUUID(),
    project_id: 'project-integration-test',
    title: 'Integration Test Task',
    description: 'A task for integration testing',
    status: 'queued',
    priority: 5,
    complexity_estimate: null,
    estimated_sessions_opus: 0,
    estimated_sessions_sonnet: 1,
    actual_tokens_opus: 0,
    actual_tokens_sonnet: 0,
    actual_sessions_opus: 0,
    actual_sessions_sonnet: 0,
    assigned_agent_id: null,
    requires_visual_review: false,
    parent_task_id: null,
    tags: [],
    acceptance_criteria: null,
    source: 'user',
    blocked_by_task_id: null,
    eta: null,
    priority_confirmed: true,
    priority_confirmed_at: null,
    priority_confirmed_by: null,
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Integration Test Suite
// ---------------------------------------------------------------------------

const STATE_FILE = `/tmp/integration-test-state-${process.pid}.json`;

describe('Integration: Full Orchestration Cycle', () => {
  let fakeAgentManager: FakeAgentManager;
  let scheduler: Scheduler;
  let capacityTracker: CapacityTracker;
  let mainLoop: MainLoop;
  let usageLogRepo: ReturnType<typeof createMockUsageLogRepository>;
  let taskRepo: ReturnType<typeof createMockTaskRepository>;
  let getClientSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Prevent real Supabase client initialization
    getClientSpy = vi.spyOn(clientModule, 'getClient').mockImplementation(() => {
      throw new Error('No Supabase client in integration tests');
    });

    // Clean up state file
    await fs.rm(STATE_FILE, { force: true }).catch(() => {});

    // Create FakeAgentManager with 50ms completion delay
    fakeAgentManager = new FakeAgentManager(50);

    // Create real Scheduler with real TaskQueue + CapacityTracker
    capacityTracker = new CapacityTracker(fakeAgentManager as any, {
      opusSessionLimit: 1,
      sonnetSessionLimit: 2,
    });
    scheduler = new Scheduler({
      agentManager: fakeAgentManager as any,
      capacityTracker,
      taskQueue: new TaskQueue(),
    });

    // Create mock repositories
    usageLogRepo = createMockUsageLogRepository();
    taskRepo = createMockTaskRepository();

    // Create MainLoop with real Scheduler + fake AgentManager
    mainLoop = new MainLoop(
      {
        pollIntervalMs: 50,
        maxConcurrentAgents: 2,
        gracefulShutdownTimeoutMs: 2000,
        stateFilePath: STATE_FILE,
        validateDatabaseOnStartup: false,
        runPreFlightChecks: false,
        requirePreFlightConfirmation: false,
        enableTaskApproval: false,
        statusCheckInIntervalMs: 0,
        dailyBudgetUsd: 100,
        weeklyBudgetUsd: 500,
        hardStopAtBudgetLimit: false,
        circuitBreakerFailureThreshold: 5,
        circuitBreakerResetTimeoutMs: 5000,
      },
      {
        scheduler,
        agentManager: fakeAgentManager as any,
        backlogManager: createMockBacklogManager() as any,
        reporter: createMockReporter() as any,
        capacityTracker,
        learningProvider: createMockLearningProvider() as any,
        retrospectiveTrigger: createMockRetrospectiveTrigger() as any,
        taskRepository: taskRepo as any,
        usageLogRepository: usageLogRepo as any,
      },
    );
  });

  afterEach(async () => {
    fakeAgentManager.destroy();
    if (mainLoop.isRunning()) {
      await mainLoop.stop();
    }
    getClientSpy.mockRestore();
    await fs.rm(STATE_FILE, { force: true }).catch(() => {});
  });

  it('should complete full lifecycle: queued → scheduled → agent spawned → completion → state updated', async () => {
    // 1. Create and enqueue a task
    const task = createTestTask({ title: 'Full Lifecycle Test' });
    scheduler.addTask(task);

    // Verify task is in queue
    expect(scheduler.getStats().queuedTasks).toBe(1);

    // 2. Start the MainLoop
    await mainLoop.start();
    expect(mainLoop.isRunning()).toBe(true);

    // 3. Wait for the tick to schedule the task and the agent to complete
    await new Promise(resolve => setTimeout(resolve, 250));

    // 4. Verify the agent was spawned
    expect(fakeAgentManager.spawnCount).toBe(1);

    // 5. Verify the task was removed from queue
    expect(scheduler.getStats().queuedTasks).toBe(0);

    // 6. Verify usage log was persisted
    expect(usageLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: task.id,
        model: 'sonnet',
        input_tokens: 500,
        output_tokens: 1000,
        cost_usd: 0.50,
        event_type: 'completion',
      }),
    );

    // 7. Verify agent was removed from state after completion
    const state = mainLoop.getState();
    expect(state.activeAgents.size).toBe(0);

    // 8. Stop the loop
    await mainLoop.stop();
    expect(mainLoop.isRunning()).toBe(false);
  }, 10_000);

  it('should track agent in state while running', async () => {
    // Use longer completion delay to catch running state
    fakeAgentManager.completionDelayMs = 500;

    const task = createTestTask({ title: 'State Tracking Test' });
    scheduler.addTask(task);

    await mainLoop.start();

    // Wait for tick to schedule (but not for completion)
    await new Promise(resolve => setTimeout(resolve, 150));

    // Agent should be in state as running
    const state = mainLoop.getState();
    expect(state.activeAgents.size).toBe(1);

    const [agentState] = Array.from(state.activeAgents.values());
    expect(agentState.taskId).toBe(task.id);
    expect(agentState.model).toBe('sonnet');
    expect(agentState.status).toBe('running');

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 500));

    // Agent should be removed after completion
    expect(mainLoop.getState().activeAgents.size).toBe(0);

    await mainLoop.stop();
  }, 10_000);

  it('should schedule and complete multiple tasks across tick cycles', async () => {
    const task1 = createTestTask({ title: 'Task 1', priority: 8 });
    const task2 = createTestTask({ title: 'Task 2', priority: 5 });

    scheduler.addTask(task1);
    scheduler.addTask(task2);
    expect(scheduler.getStats().queuedTasks).toBe(2);

    await mainLoop.start();

    // Wait for both tasks to be scheduled and complete
    // Capacity is 2 sonnet, so both can be scheduled
    await new Promise(resolve => setTimeout(resolve, 400));

    expect(fakeAgentManager.spawnCount).toBe(2);
    expect(scheduler.getStats().queuedTasks).toBe(0);

    // Both completions logged
    expect(usageLogRepo.create).toHaveBeenCalledTimes(2);

    // No agents remaining in state
    expect(mainLoop.getState().activeAgents.size).toBe(0);

    await mainLoop.stop();
  }, 10_000);

  it('should run in under 30 seconds', async () => {
    const start = Date.now();

    const task = createTestTask({ title: 'Performance Test' });
    scheduler.addTask(task);

    await mainLoop.start();
    await new Promise(resolve => setTimeout(resolve, 250));
    await mainLoop.stop();

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30_000);
    expect(fakeAgentManager.spawnCount).toBe(1);
  }, 30_000);

  it('should clean up state after stop', async () => {
    const task = createTestTask({ title: 'Cleanup Test' });
    scheduler.addTask(task);

    await mainLoop.start();
    await new Promise(resolve => setTimeout(resolve, 250));
    await mainLoop.stop();

    // Verify MainLoop is stopped
    expect(mainLoop.isRunning()).toBe(false);
    expect(mainLoop.isPaused()).toBe(false);
  }, 10_000);
});
