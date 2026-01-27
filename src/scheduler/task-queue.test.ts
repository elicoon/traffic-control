import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskQueue, QueuedTask } from './task-queue.js';
import { Task } from '../db/repositories/tasks.js';

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

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new TaskQueue();
  });

  describe('enqueue', () => {
    it('should add a task to the queue', () => {
      const task = createMockTask();
      queue.enqueue(task);

      expect(queue.size()).toBe(1);
    });

    it('should not add duplicate tasks', () => {
      const task = createMockTask({ id: 'task-1' });
      queue.enqueue(task);
      queue.enqueue(task);

      expect(queue.size()).toBe(1);
    });

    it('should update existing task with same ID', () => {
      const task1 = createMockTask({ id: 'task-1', priority: 1 });
      const task2 = createMockTask({ id: 'task-1', priority: 5 });

      queue.enqueue(task1);
      queue.enqueue(task2);

      expect(queue.size()).toBe(1);
      expect(queue.peek()?.task.priority).toBe(5);
    });
  });

  describe('dequeue', () => {
    it('should return undefined when queue is empty', () => {
      expect(queue.dequeue()).toBeUndefined();
    });

    it('should return and remove the highest priority task', () => {
      const lowPriority = createMockTask({ id: 'task-1', priority: 1 });
      const highPriority = createMockTask({ id: 'task-2', priority: 10 });

      queue.enqueue(lowPriority);
      queue.enqueue(highPriority);

      const dequeued = queue.dequeue();
      expect(dequeued?.task.id).toBe('task-2');
      expect(queue.size()).toBe(1);
    });
  });

  describe('peek', () => {
    it('should return undefined when queue is empty', () => {
      expect(queue.peek()).toBeUndefined();
    });

    it('should return the highest priority task without removing it', () => {
      const task = createMockTask({ id: 'task-1', priority: 5 });
      queue.enqueue(task);

      const peeked = queue.peek();
      expect(peeked?.task.id).toBe('task-1');
      expect(queue.size()).toBe(1);
    });
  });

  describe('priority ordering', () => {
    it('should order by priority (higher first)', () => {
      const tasks = [
        createMockTask({ id: 'task-1', priority: 1 }),
        createMockTask({ id: 'task-2', priority: 10 }),
        createMockTask({ id: 'task-3', priority: 5 }),
      ];

      tasks.forEach(t => queue.enqueue(t));

      expect(queue.dequeue()?.task.id).toBe('task-2');
      expect(queue.dequeue()?.task.id).toBe('task-3');
      expect(queue.dequeue()?.task.id).toBe('task-1');
    });

    it('should give age boost to older tasks with equal priority', () => {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      const olderTask = createMockTask({
        id: 'task-old',
        priority: 5,
        created_at: new Date('2024-01-01T00:00:00Z').toISOString(),
      });
      queue.enqueue(olderTask);

      vi.setSystemTime(new Date('2024-01-01T01:00:00Z'));
      const newerTask = createMockTask({
        id: 'task-new',
        priority: 5,
        created_at: new Date('2024-01-01T01:00:00Z').toISOString(),
      });
      queue.enqueue(newerTask);

      // Older task should come first due to age boost
      expect(queue.dequeue()?.task.id).toBe('task-old');
    });
  });

  describe('getNextForModel', () => {
    it('should return undefined when queue is empty', () => {
      expect(queue.getNextForModel('opus')).toBeUndefined();
    });

    it('should prefer opus tasks when looking for opus', () => {
      const sonnetTask = createMockTask({
        id: 'sonnet-task',
        priority: 10,
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 1,
      });
      const opusTask = createMockTask({
        id: 'opus-task',
        priority: 5,
        estimated_sessions_opus: 1,
        estimated_sessions_sonnet: 0,
      });

      queue.enqueue(sonnetTask);
      queue.enqueue(opusTask);

      const result = queue.getNextForModel('opus');
      expect(result?.task.id).toBe('opus-task');
    });

    it('should prefer sonnet tasks when looking for sonnet', () => {
      const opusTask = createMockTask({
        id: 'opus-task',
        priority: 10,
        estimated_sessions_opus: 1,
        estimated_sessions_sonnet: 0,
      });
      const sonnetTask = createMockTask({
        id: 'sonnet-task',
        priority: 5,
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 1,
      });

      queue.enqueue(opusTask);
      queue.enqueue(sonnetTask);

      const result = queue.getNextForModel('sonnet');
      expect(result?.task.id).toBe('sonnet-task');
    });

    it('should return any task if no model-specific tasks exist', () => {
      const sonnetTask = createMockTask({
        id: 'sonnet-task',
        priority: 10,
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 1,
      });

      queue.enqueue(sonnetTask);

      // Looking for opus but only sonnet exists - should still return it
      const result = queue.getNextForModel('opus');
      expect(result?.task.id).toBe('sonnet-task');
    });

    it('should respect priority among model-preferred tasks', () => {
      const lowPriorityOpus = createMockTask({
        id: 'opus-low',
        priority: 1,
        estimated_sessions_opus: 1,
        estimated_sessions_sonnet: 0,
      });
      const highPriorityOpus = createMockTask({
        id: 'opus-high',
        priority: 10,
        estimated_sessions_opus: 1,
        estimated_sessions_sonnet: 0,
      });

      queue.enqueue(lowPriorityOpus);
      queue.enqueue(highPriorityOpus);

      const result = queue.getNextForModel('opus');
      expect(result?.task.id).toBe('opus-high');
    });

    it('should not remove the task from queue', () => {
      const task = createMockTask({
        id: 'task-1',
        estimated_sessions_opus: 1,
      });

      queue.enqueue(task);
      queue.getNextForModel('opus');

      expect(queue.size()).toBe(1);
    });
  });

  describe('remove', () => {
    it('should remove a task by ID', () => {
      const task = createMockTask({ id: 'task-1' });
      queue.enqueue(task);
      expect(queue.size()).toBe(1);

      queue.remove('task-1');
      expect(queue.size()).toBe(0);
    });

    it('should handle removing non-existent task gracefully', () => {
      expect(() => queue.remove('non-existent')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all tasks', () => {
      queue.enqueue(createMockTask({ id: 'task-1' }));
      queue.enqueue(createMockTask({ id: 'task-2' }));
      queue.enqueue(createMockTask({ id: 'task-3' }));

      queue.clear();

      expect(queue.size()).toBe(0);
    });
  });

  describe('isEmpty', () => {
    it('should return true when queue is empty', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false when queue has tasks', () => {
      queue.enqueue(createMockTask());
      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('getAllTasks', () => {
    it('should return all tasks sorted by effective priority', () => {
      const tasks = [
        createMockTask({ id: 'task-1', priority: 1 }),
        createMockTask({ id: 'task-2', priority: 10 }),
        createMockTask({ id: 'task-3', priority: 5 }),
      ];

      tasks.forEach(t => queue.enqueue(t));

      const all = queue.getAllTasks();
      expect(all.length).toBe(3);
      expect(all[0].task.id).toBe('task-2');
      expect(all[1].task.id).toBe('task-3');
      expect(all[2].task.id).toBe('task-1');
    });
  });

  describe('has', () => {
    it('should return true if task exists', () => {
      queue.enqueue(createMockTask({ id: 'task-1' }));
      expect(queue.has('task-1')).toBe(true);
    });

    it('should return false if task does not exist', () => {
      expect(queue.has('task-1')).toBe(false);
    });
  });
});
