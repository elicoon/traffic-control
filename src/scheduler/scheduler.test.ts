import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler, SchedulerResult, SchedulerStats } from './scheduler.js';
import { CapacityTracker } from './capacity-tracker.js';
import { TaskQueue, QueuedTask } from './task-queue.js';
import { AgentManager } from '../agent/manager.js';
import { Task } from '../db/repositories/tasks.js';

// Mock dependencies with proper class constructors
vi.mock('../agent/manager.js', () => {
  const MockAgentManager = vi.fn(function (this: any) {
    this.getActiveSessions = vi.fn().mockReturnValue([]);
    this.onEvent = vi.fn();
    this.getSession = vi.fn();
    this.spawnAgent = vi.fn().mockResolvedValue('session-123');
  });
  return { AgentManager: MockAgentManager };
});

vi.mock('./capacity-tracker.js', () => {
  const MockCapacityTracker = vi.fn(function (this: any) {
    this.hasCapacity = vi.fn().mockReturnValue(true);
    this.reserveCapacity = vi.fn().mockReturnValue(true);
    this.releaseCapacity = vi.fn();
    this.getCapacityStats = vi.fn().mockReturnValue({
      opus: { current: 0, limit: 1, available: 1, utilization: 0 },
      sonnet: { current: 0, limit: 2, available: 2, utilization: 0 },
    });
    this.syncWithAgentManager = vi.fn();
    this.getConfig = vi.fn().mockReturnValue({
      opusSessionLimit: 1,
      sonnetSessionLimit: 2,
    });
  });
  return { CapacityTracker: MockCapacityTracker };
});

vi.mock('./task-queue.js', () => {
  const MockTaskQueue = vi.fn(function (this: any) {
    this.enqueue = vi.fn();
    this.dequeue = vi.fn();
    this.peek = vi.fn();
    this.getNextForModel = vi.fn();
    this.remove = vi.fn();
    this.size = vi.fn().mockReturnValue(0);
    this.isEmpty = vi.fn().mockReturnValue(true);
    this.getAllTasks = vi.fn().mockReturnValue([]);
  });
  return { TaskQueue: MockTaskQueue };
});

// Helper to create mock tasks
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).substr(2, 9)}`,
    project_id: 'project-1',
    title: 'Test Task',
    description: null,
    status: 'queued',
    priority: 0,
    complexity_estimate: null,
    estimated_sessions_opus: 0,
    estimated_sessions_sonnet: 1,
    actual_tokens_opus: 0,
    actual_tokens_sonnet: 0,
    actual_sessions_opus: 0,
    actual_sessions_sonnet: 0,
    assigned_agent_id: null,
    requires_visual_review: false,
    // Task management fields
    parent_task_id: null,
    tags: [],
    acceptance_criteria: null,
    source: 'user',
    blocked_by_task_id: null,
    eta: null,
    // Timestamps
    started_at: null,
    completed_at: null,
    // Priority confirmation
    priority_confirmed: false,
    priority_confirmed_at: null,
    priority_confirmed_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createQueuedTask(taskOverrides: Partial<Task> = {}): QueuedTask {
  return {
    task: createMockTask(taskOverrides),
    enqueuedAt: new Date(),
    effectivePriority: taskOverrides.priority ?? 0,
  };
}

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let mockAgentManager: AgentManager;
  let mockCapacityTracker: CapacityTracker;
  let mockTaskQueue: TaskQueue;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAgentManager = new AgentManager();
    mockCapacityTracker = new CapacityTracker(mockAgentManager);
    mockTaskQueue = new TaskQueue();

    scheduler = new Scheduler({
      agentManager: mockAgentManager,
      capacityTracker: mockCapacityTracker,
      taskQueue: mockTaskQueue,
    });
  });

  describe('scheduleNext', () => {
    it('should return idle when queue is empty', async () => {
      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(true);

      const result = await scheduler.scheduleNext();

      expect(result.status).toBe('idle');
      expect(result.scheduled).toBe(0);
    });

    it('should return no_capacity when no capacity available', async () => {
      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(false);
      vi.mocked(mockCapacityTracker.hasCapacity).mockReturnValue(false);

      const result = await scheduler.scheduleNext();

      expect(result.status).toBe('no_capacity');
      expect(result.scheduled).toBe(0);
    });

    it('should schedule an opus task when opus capacity available', async () => {
      const opusTask = createQueuedTask({
        id: 'opus-task',
        estimated_sessions_opus: 1,
        estimated_sessions_sonnet: 0,
      });

      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(false);
      vi.mocked(mockCapacityTracker.hasCapacity).mockImplementation(model => model === 'opus');
      vi.mocked(mockTaskQueue.getNextForModel).mockImplementation(model =>
        model === 'opus' ? opusTask : undefined
      );
      vi.mocked(mockTaskQueue.dequeue).mockReturnValue(opusTask);

      const result = await scheduler.scheduleNext();

      expect(result.status).toBe('scheduled');
      expect(result.scheduled).toBe(1);
      expect(result.tasks?.[0].taskId).toBe('opus-task');
      expect(result.tasks?.[0].model).toBe('opus');
    });

    it('should schedule a sonnet task when only sonnet capacity available', async () => {
      const sonnetTask = createQueuedTask({
        id: 'sonnet-task',
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 1,
      });

      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(false);
      vi.mocked(mockCapacityTracker.hasCapacity).mockImplementation(model => model === 'sonnet');
      vi.mocked(mockTaskQueue.getNextForModel).mockImplementation(model =>
        model === 'sonnet' ? sonnetTask : undefined
      );
      vi.mocked(mockTaskQueue.dequeue).mockReturnValue(sonnetTask);

      const result = await scheduler.scheduleNext();

      expect(result.status).toBe('scheduled');
      expect(result.scheduled).toBe(1);
      expect(result.tasks?.[0].taskId).toBe('sonnet-task');
      expect(result.tasks?.[0].model).toBe('sonnet');
    });

    it('should call spawnCallback when provided', async () => {
      const sonnetTask = createQueuedTask({
        id: 'task-1',
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 1,
      });

      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(false);
      vi.mocked(mockCapacityTracker.hasCapacity).mockReturnValue(true);
      vi.mocked(mockTaskQueue.getNextForModel).mockReturnValue(sonnetTask);

      const spawnCallback = vi.fn().mockResolvedValue('session-abc');

      const result = await scheduler.scheduleNext(spawnCallback);

      expect(spawnCallback).toHaveBeenCalledWith(sonnetTask.task, 'sonnet');
      expect(result.tasks?.[0].sessionId).toBe('session-abc');
    });

    it('should reserve capacity after successful scheduling', async () => {
      const task = createQueuedTask({ id: 'task-1' });

      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(false);
      vi.mocked(mockCapacityTracker.hasCapacity).mockReturnValue(true);
      vi.mocked(mockTaskQueue.getNextForModel).mockReturnValue(task);

      const spawnCallback = vi.fn().mockResolvedValue('session-123');
      await scheduler.scheduleNext(spawnCallback);

      expect(mockCapacityTracker.reserveCapacity).toHaveBeenCalledWith('sonnet', 'session-123');
    });

    it('should remove task from queue after scheduling', async () => {
      const task = createQueuedTask({ id: 'task-1' });

      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(false);
      vi.mocked(mockCapacityTracker.hasCapacity).mockReturnValue(true);
      vi.mocked(mockTaskQueue.getNextForModel).mockReturnValue(task);

      const spawnCallback = vi.fn().mockResolvedValue('session-123');
      await scheduler.scheduleNext(spawnCallback);

      expect(mockTaskQueue.remove).toHaveBeenCalledWith('task-1');
    });
  });

  describe('scheduleAll', () => {
    it('should schedule multiple tasks up to capacity', async () => {
      const tasks = [
        createQueuedTask({ id: 'task-1', estimated_sessions_sonnet: 1 }),
        createQueuedTask({ id: 'task-2', estimated_sessions_sonnet: 1 }),
        createQueuedTask({ id: 'task-3', estimated_sessions_sonnet: 1 }),
      ];

      let callCount = 0;
      vi.mocked(mockTaskQueue.isEmpty).mockImplementation(() => callCount >= 3);
      vi.mocked(mockCapacityTracker.hasCapacity).mockImplementation(() => callCount < 3);
      vi.mocked(mockTaskQueue.getNextForModel).mockImplementation(() => {
        if (callCount < 3) {
          return tasks[callCount];
        }
        return undefined;
      });

      const spawnCallback = vi.fn().mockImplementation(async () => {
        callCount++;
        return `session-${callCount}`;
      });

      const results = await scheduler.scheduleAll(spawnCallback);

      expect(results.length).toBe(3);
      expect(spawnCallback).toHaveBeenCalledTimes(3);
    });

    it('should stop when capacity is exhausted', async () => {
      const task = createQueuedTask({ id: 'task-1' });

      let capacityCallCount = 0;
      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(false);
      // First check: hasCapacity returns true for both opus and sonnet (allows scheduling)
      // Then scheduleNext is called and it schedules
      // Second check (after scheduling): hasCapacity returns false for both (stops loop)
      vi.mocked(mockCapacityTracker.hasCapacity).mockImplementation(() => {
        capacityCallCount++;
        // First 4 calls (2 in canSchedule, 2 in scheduleNext) - allow scheduling
        // After that - no capacity
        return capacityCallCount <= 4;
      });
      vi.mocked(mockTaskQueue.getNextForModel).mockReturnValue(task);

      const spawnCallback = vi.fn().mockResolvedValue('session-1');
      const results = await scheduler.scheduleAll(spawnCallback);

      expect(results.length).toBe(1);
    });
  });

  describe('addTask', () => {
    it('should enqueue task to the task queue', () => {
      const task = createMockTask({ id: 'task-1' });

      scheduler.addTask(task);

      expect(mockTaskQueue.enqueue).toHaveBeenCalledWith(task);
    });
  });

  describe('removeTask', () => {
    it('should remove task from the task queue', () => {
      scheduler.removeTask('task-1');

      expect(mockTaskQueue.remove).toHaveBeenCalledWith('task-1');
    });
  });

  describe('releaseCapacity', () => {
    it('should release capacity for a model', () => {
      scheduler.releaseCapacity('opus', 'session-1');

      expect(mockCapacityTracker.releaseCapacity).toHaveBeenCalledWith('opus', 'session-1');
    });
  });

  describe('getStats', () => {
    it('should return scheduler statistics', () => {
      vi.mocked(mockTaskQueue.size).mockReturnValue(5);
      vi.mocked(mockCapacityTracker.getCapacityStats).mockReturnValue({
        opus: { current: 1, limit: 1, available: 0, utilization: 1.0 },
        sonnet: { current: 2, limit: 2, available: 0, utilization: 1.0 },
      });

      const stats = scheduler.getStats();

      expect(stats.queuedTasks).toBe(5);
      expect(stats.capacity.opus.current).toBe(1);
      expect(stats.capacity.sonnet.current).toBe(2);
    });
  });

  describe('syncCapacity', () => {
    it('should sync capacity with agent manager', () => {
      scheduler.syncCapacity();

      expect(mockCapacityTracker.syncWithAgentManager).toHaveBeenCalled();
    });
  });

  describe('determineModel', () => {
    it('should return opus for tasks that estimate opus sessions', () => {
      const task = createMockTask({
        estimated_sessions_opus: 1,
        estimated_sessions_sonnet: 0,
      });

      const model = scheduler.determineModel(task);

      expect(model).toBe('opus');
    });

    it('should return sonnet for tasks that estimate sonnet sessions', () => {
      const task = createMockTask({
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 1,
      });

      const model = scheduler.determineModel(task);

      expect(model).toBe('sonnet');
    });

    it('should return opus for high complexity tasks', () => {
      const task = createMockTask({
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 0,
        complexity_estimate: 'high',
      });

      const model = scheduler.determineModel(task);

      expect(model).toBe('opus');
    });

    it('should return sonnet for low/medium complexity tasks', () => {
      const task = createMockTask({
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 0,
        complexity_estimate: 'low',
      });

      const model = scheduler.determineModel(task);

      expect(model).toBe('sonnet');
    });

    it('should default to sonnet when no hints available', () => {
      const task = createMockTask({
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 0,
        complexity_estimate: null,
      });

      const model = scheduler.determineModel(task);

      expect(model).toBe('sonnet');
    });
  });

  describe('canSchedule', () => {
    it('should return true when queue has tasks and capacity is available', () => {
      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(false);
      vi.mocked(mockCapacityTracker.hasCapacity).mockReturnValue(true);

      expect(scheduler.canSchedule()).toBe(true);
    });

    it('should return false when queue is empty', () => {
      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(true);
      vi.mocked(mockCapacityTracker.hasCapacity).mockReturnValue(true);

      expect(scheduler.canSchedule()).toBe(false);
    });

    it('should return false when no capacity', () => {
      vi.mocked(mockTaskQueue.isEmpty).mockReturnValue(false);
      vi.mocked(mockCapacityTracker.hasCapacity).mockReturnValue(false);

      expect(scheduler.canSchedule()).toBe(false);
    });
  });
});
