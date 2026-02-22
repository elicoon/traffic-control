import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../../scheduler/scheduler.js';
import { CapacityTracker } from '../../scheduler/capacity-tracker.js';
import { TaskQueue } from '../../scheduler/task-queue.js';
import { MainLoop, OrchestrationConfig, OrchestrationDependencies } from '../../orchestrator/main-loop.js';
import { Task } from '../../db/repositories/tasks.js';
import { randomUUID } from 'node:crypto';
import * as clientModule from '../../db/client.js';

/**
 * Mock AgentManager that simulates agent spawn/complete with no real SDK calls.
 * Used for benchmarking only.
 */
const createMockAgentManager = () => ({
  getActiveSessions: vi.fn().mockReturnValue([]),
  getSession: vi.fn(),
  onEvent: vi.fn(),
  spawnAgent: vi.fn().mockImplementation(async () => randomUUID()),
  injectMessage: vi.fn(),
  terminateSession: vi.fn(),
});

/** Generate a mock Task with configurable properties */
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: randomUUID(),
    project_id: 'project-bench',
    title: `Benchmark Task ${Math.random().toString(36).slice(2, 8)}`,
    description: 'Auto-generated benchmark task',
    status: 'queued',
    priority: Math.floor(Math.random() * 10),
    priority_confirmed: true,
    priority_confirmed_at: null,
    priority_confirmed_by: null,
    source: 'user',
    tags: [],
    acceptance_criteria: null,
    parent_task_id: null,
    blocked_by_task_id: null,
    eta: null,
    estimated_sessions_opus: 0,
    estimated_sessions_sonnet: 1,
    actual_tokens_opus: 0,
    actual_tokens_sonnet: 0,
    actual_sessions_opus: 0,
    actual_sessions_sonnet: 0,
    assigned_agent_id: null,
    requires_visual_review: false,
    complexity_estimate: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    ...overrides,
  } as Task;
}

describe('Performance Benchmarks', () => {
  describe('Scheduler: 100+ queued tasks', () => {
    it('should sort and retrieve next task from 150 tasks in under 10ms per call', () => {
      const taskQueue = new TaskQueue();

      // Populate with 150 tasks
      for (let i = 0; i < 150; i++) {
        taskQueue.enqueue(createMockTask({ priority: Math.floor(Math.random() * 10) }));
      }

      expect(taskQueue.size()).toBe(150);

      // Benchmark: time 100 getNextForModel calls
      const times: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        const task = taskQueue.getNextForModel('sonnet');
        const elapsed = performance.now() - start;
        times.push(elapsed);
        expect(task).toBeDefined();
      }

      const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
      const maxMs = Math.max(...times);
      const sorted = [...times].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];

      console.log(`[Scheduler Benchmark] getNextForModel (150 tasks):`);
      console.log(`  Avg: ${avgMs.toFixed(3)}ms | P95: ${p95.toFixed(3)}ms | Max: ${maxMs.toFixed(3)}ms`);

      // Assert: each call should be well under 10ms
      expect(p95).toBeLessThan(10);
    });

    it('should handle enqueue/dequeue cycle for 200 tasks efficiently', () => {
      const taskQueue = new TaskQueue();

      const start = performance.now();
      // Enqueue 200 tasks
      for (let i = 0; i < 200; i++) {
        taskQueue.enqueue(createMockTask({ priority: i % 10 }));
      }
      const enqueueTime = performance.now() - start;

      expect(taskQueue.size()).toBe(200);

      // Dequeue all
      const dequeueStart = performance.now();
      let dequeued = 0;
      while (!taskQueue.isEmpty()) {
        const task = taskQueue.dequeue();
        if (task) dequeued++;
      }
      const dequeueTime = performance.now() - dequeueStart;

      expect(dequeued).toBe(200);

      console.log(`[Scheduler Benchmark] Enqueue/Dequeue 200 tasks:`);
      console.log(`  Enqueue: ${enqueueTime.toFixed(3)}ms | Dequeue: ${dequeueTime.toFixed(3)}ms`);
      console.log(`  Total: ${(enqueueTime + dequeueTime).toFixed(3)}ms`);

      // Should complete in under 500ms total
      expect(enqueueTime + dequeueTime).toBeLessThan(500);
    });
  });

  describe('CapacityTracker: 5+ concurrent agents', () => {
    it('should accurately track capacity with 8 concurrent agents', () => {
      const mockAgentManager = createMockAgentManager();
      const tracker = new CapacityTracker(mockAgentManager as any, {
        opusSessionLimit: 3,
        sonnetSessionLimit: 5,
      });

      // Register 3 opus + 5 sonnet agents
      const opusSessions = Array.from({ length: 3 }, () => randomUUID());
      const sonnetSessions = Array.from({ length: 5 }, () => randomUUID());

      const start = performance.now();

      // Reserve all
      for (const sid of opusSessions) {
        expect(tracker.reserveCapacity('opus', sid)).toBe(true);
      }
      for (const sid of sonnetSessions) {
        expect(tracker.reserveCapacity('sonnet', sid)).toBe(true);
      }

      // Verify at capacity
      expect(tracker.hasCapacity('opus')).toBe(false);
      expect(tracker.hasCapacity('sonnet')).toBe(false);

      // Attempt over-capacity reservation (should fail)
      expect(tracker.reserveCapacity('opus', randomUUID())).toBe(false);
      expect(tracker.reserveCapacity('sonnet', randomUUID())).toBe(false);

      // Release half
      for (let i = 0; i < 2; i++) {
        tracker.releaseCapacity('opus', opusSessions[i]);
        tracker.releaseCapacity('sonnet', sonnetSessions[i]);
      }

      // Verify partial capacity restored
      expect(tracker.hasCapacity('opus')).toBe(true);
      expect(tracker.hasCapacity('sonnet')).toBe(true);
      expect(tracker.getCurrentSessionCount('opus')).toBe(1);
      expect(tracker.getCurrentSessionCount('sonnet')).toBe(3);

      const elapsed = performance.now() - start;

      console.log(`[CapacityTracker Benchmark] 8 concurrent agents:`);
      console.log(`  Reserve/release/verify cycle: ${elapsed.toFixed(3)}ms`);

      // Stats should be accurate
      const stats = tracker.getCapacityStats();
      expect(stats.opus.current).toBe(1);
      expect(stats.opus.available).toBe(2);
      expect(stats.sonnet.current).toBe(3);
      expect(stats.sonnet.available).toBe(2);

      // Should complete in under 50ms
      expect(elapsed).toBeLessThan(50);
    });

    it('should handle rapid reserve/release cycles without drift', () => {
      const mockAgentManager = createMockAgentManager();
      const tracker = new CapacityTracker(mockAgentManager as any, {
        opusSessionLimit: 5,
        sonnetSessionLimit: 10,
      });

      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const sid = `session-${i}`;
        const model = i % 2 === 0 ? 'opus' as const : 'sonnet' as const;
        tracker.reserveCapacity(model, sid);
        tracker.releaseCapacity(model, sid);
      }

      const elapsed = performance.now() - start;

      // After all reserve/release pairs, counts should be zero
      expect(tracker.getCurrentSessionCount('opus')).toBe(0);
      expect(tracker.getCurrentSessionCount('sonnet')).toBe(0);

      console.log(`[CapacityTracker Benchmark] ${iterations} reserve/release cycles:`);
      console.log(`  Total: ${elapsed.toFixed(3)}ms | Per-cycle: ${(elapsed / iterations).toFixed(4)}ms`);

      // 1000 cycles should complete in under 100ms
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Throughput: task processing with mock agents', () => {
    it('should process 50 tasks through scheduler with mock spawns', async () => {
      const mockAgentManager = createMockAgentManager();
      const capacityTracker = new CapacityTracker(mockAgentManager as any, {
        opusSessionLimit: 2,
        sonnetSessionLimit: 5,
      });
      const taskQueue = new TaskQueue();
      const scheduler = new Scheduler({
        agentManager: mockAgentManager as any,
        capacityTracker,
        taskQueue,
      });

      // Queue 50 tasks
      for (let i = 0; i < 50; i++) {
        const task = createMockTask({
          estimated_sessions_sonnet: 1,
          priority: Math.floor(Math.random() * 10),
        });
        scheduler.addTask(task);
      }

      expect(taskQueue.size()).toBe(50);

      const start = performance.now();
      let scheduled = 0;
      let iterations = 0;
      const MAX_ITERATIONS = 500;

      // Simulate scheduling loop: schedule, then release capacity to simulate completion
      while (taskQueue.size() > 0 && iterations++ < MAX_ITERATIONS) {
        const result = await scheduler.scheduleNext();

        if (result.status === 'scheduled' && result.tasks) {
          scheduled += result.tasks.length;
          // Simulate agent completing immediately by releasing capacity
          for (const t of result.tasks) {
            capacityTracker.releaseCapacity(t.model, t.sessionId);
          }
        } else if (result.status === 'no_capacity') {
          // Release all tracked sessions to simulate completion
          for (const sid of capacityTracker.getTrackedSessions('opus')) {
            capacityTracker.releaseCapacity('opus', sid);
          }
          for (const sid of capacityTracker.getTrackedSessions('sonnet')) {
            capacityTracker.releaseCapacity('sonnet', sid);
          }
        } else {
          break; // idle or error
        }
      }

      const elapsed = performance.now() - start;
      const tasksPerMinute = (scheduled / elapsed) * 60000;

      console.log(`[Throughput Benchmark] 50 tasks with mock agents:`);
      console.log(`  Scheduled: ${scheduled} tasks in ${elapsed.toFixed(3)}ms`);
      console.log(`  Throughput: ${tasksPerMinute.toFixed(0)} tasks/minute`);
      console.log(`  Avg per task: ${(elapsed / scheduled).toFixed(3)}ms`);

      expect(iterations).toBeLessThan(MAX_ITERATIONS); // ensure no infinite loop
      expect(scheduled).toBe(50);
      // Should process at least 1000 tasks/minute with mocks
      expect(tasksPerMinute).toBeGreaterThan(1000);
    });
  });

  describe('MainLoop tick latency under load', () => {
    let getClientSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      getClientSpy = vi.spyOn(clientModule, 'getClient').mockImplementation(() => {
        throw new Error('No Supabase client in benchmarks');
      });
    });

    afterEach(() => {
      getClientSpy.mockRestore();
    });

    it('should keep p99 tick time under 1 second with tasks queued', async () => {
      const mockAgentManager = createMockAgentManager();
      const mockScheduler = {
        scheduleNext: vi.fn().mockResolvedValue({ status: 'idle', scheduled: 0 }),
        scheduleAll: vi.fn().mockResolvedValue([]),
        addTask: vi.fn(),
        removeTask: vi.fn(),
        releaseCapacity: vi.fn(),
        getStats: vi.fn().mockReturnValue({
          queuedTasks: 100,
          capacity: {
            opus: { current: 1, limit: 2, available: 1, utilization: 0.5 },
            sonnet: { current: 3, limit: 5, available: 2, utilization: 0.6 },
          },
        }),
        syncCapacity: vi.fn(),
        canSchedule: vi.fn().mockReturnValue(true),
        getCapacityTracker: vi.fn(),
      };

      const mockDeps: OrchestrationDependencies = {
        scheduler: mockScheduler as any,
        agentManager: mockAgentManager as any,
        backlogManager: {
          isBacklogLow: vi.fn().mockResolvedValue(false),
          getBacklogDepth: vi.fn().mockResolvedValue(100),
          getBacklogStats: vi.fn().mockResolvedValue([]),
          getSummary: vi.fn().mockResolvedValue({
            totalQueued: 100, totalInProgress: 4, totalBlocked: 0,
            totalPendingProposals: 0, isBacklogLow: false, threshold: 5,
          }),
        } as any,
        reporter: {
          start: vi.fn(), stop: vi.fn(), isRunning: vi.fn().mockReturnValue(false),
          sendImmediateReport: vi.fn(), generateReport: vi.fn(),
        } as any,
        capacityTracker: {
          hasCapacity: vi.fn().mockReturnValue(true),
          reserveCapacity: vi.fn().mockReturnValue(true),
          releaseCapacity: vi.fn(),
          getCapacityStats: vi.fn().mockReturnValue({
            opus: { current: 1, limit: 2, available: 1, utilization: 0.5 },
            sonnet: { current: 3, limit: 5, available: 2, utilization: 0.6 },
          }),
          syncWithAgentManager: vi.fn(),
        } as any,
        learningProvider: {
          getContextForSession: vi.fn().mockResolvedValue({
            globalLearnings: [], projectLearnings: [], agentGuidelines: '',
          }),
          formatAsSystemPrompt: vi.fn().mockReturnValue(''),
          getRelevantLearnings: vi.fn().mockResolvedValue([]),
        } as any,
        retrospectiveTrigger: {
          checkTrigger: vi.fn().mockReturnValue({ shouldTrigger: false }),
          createManualTrigger: vi.fn(),
          isTriggerEnabled: vi.fn().mockReturnValue(true),
        } as any,
      };

      const config: Partial<OrchestrationConfig> = {
        pollIntervalMs: 1,
        maxConcurrentAgents: 7,
        gracefulShutdownTimeoutMs: 100,
        stateFilePath: '/tmp/bench-state.json',
        validateDatabaseOnStartup: false,
        runPreFlightChecks: false,
        requirePreFlightConfirmation: false,
        enableTaskApproval: false,
        statusCheckInIntervalMs: 0,
        dailyBudgetUsd: 1000,
        weeklyBudgetUsd: 5000,
        hardStopAtBudgetLimit: false,
        circuitBreakerFailureThreshold: 100,
        circuitBreakerResetTimeoutMs: 60000,
      };

      const mainLoop = new MainLoop(config, mockDeps);
      await mainLoop.start();

      // Measure event handling times (exercises the full event pipeline)
      const tickTimes: number[] = [];
      for (let i = 0; i < 100; i++) {
        const agentId = `bench-agent-${i}`;
        mainLoop.getStateManager().addAgent({
          sessionId: agentId,
          taskId: `bench-task-${i}`,
          model: i % 3 === 0 ? 'opus' : 'sonnet',
          status: 'running',
          startedAt: new Date(),
        });

        const start = performance.now();
        await mainLoop.handleAgentEvent({
          type: 'completion',
          agentId,
          taskId: `bench-task-${i}`,
          payload: {
            inputTokens: 500,
            outputTokens: 1000,
            costUsd: 0.5,
            durationMs: 10000,
            summary: `Benchmark task ${i} completed`,
          },
          timestamp: new Date(),
        });
        const elapsed = performance.now() - start;
        tickTimes.push(elapsed);
      }

      await mainLoop.stop();

      const sorted = [...tickTimes].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      const avg = tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length;

      console.log(`[MainLoop Tick Benchmark] 100 event cycles:`);
      console.log(`  Avg: ${avg.toFixed(3)}ms | P50: ${p50.toFixed(3)}ms | P95: ${p95.toFixed(3)}ms | P99: ${p99.toFixed(3)}ms`);

      // Assert p99 < 1 second (1000ms)
      expect(p99).toBeLessThan(1000);
    });
  });

  describe('Memory usage under load', () => {
    it('should not leak memory during 500 task enqueue/dequeue cycles', () => {
      // Force GC if available for accurate baseline
      if (global.gc) global.gc();
      const baselineMemory = process.memoryUsage();

      const taskQueue = new TaskQueue();

      // Run 500 enqueue/dequeue cycles
      for (let cycle = 0; cycle < 500; cycle++) {
        const task = createMockTask({ priority: cycle % 10 });
        taskQueue.enqueue(task);
        taskQueue.dequeue();
      }

      expect(taskQueue.size()).toBe(0);

      const afterMemory = process.memoryUsage();
      const heapGrowthMB = (afterMemory.heapUsed - baselineMemory.heapUsed) / (1024 * 1024);

      console.log(`[Memory Benchmark] 500 enqueue/dequeue cycles:`);
      console.log(`  Heap baseline: ${(baselineMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Heap after: ${(afterMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Growth: ${heapGrowthMB.toFixed(2)}MB`);
      console.log(`  RSS: ${(afterMemory.rss / 1024 / 1024).toFixed(2)}MB`);

      // Heap growth should be less than 10MB for 500 cycles
      expect(heapGrowthMB).toBeLessThan(10);
    });
  });
});
