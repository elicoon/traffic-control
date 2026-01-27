import { Task } from '../db/repositories/tasks.js';
import { ModelType } from './capacity-tracker.js';
import { logger } from '../logging/index.js';

const log = logger.child('TaskQueue');

/**
 * Represents a task in the queue with computed priority information.
 */
export interface QueuedTask {
  task: Task;
  enqueuedAt: Date;
  effectivePriority: number;
}

/**
 * Age boost factor - how much priority boost per hour of age.
 * A task waiting 1 hour gets +0.1 priority boost.
 */
const AGE_BOOST_PER_HOUR = 0.1;

/**
 * Priority queue for tasks sorted by priority + age.
 * Older tasks get a slight boost to prevent starvation.
 */
export class TaskQueue {
  private tasks: Map<string, QueuedTask> = new Map();

  /**
   * Add or update a task in the queue.
   */
  enqueue(task: Task): void {
    const existingEntry = this.tasks.get(task.id);
    const isUpdate = !!existingEntry;
    const enqueuedAt = existingEntry?.enqueuedAt ?? new Date();

    const queuedTask: QueuedTask = {
      task,
      enqueuedAt,
      effectivePriority: this.calculateEffectivePriority(task, enqueuedAt),
    };

    this.tasks.set(task.id, queuedTask);

    log.debug(isUpdate ? 'Task updated in queue' : 'Task enqueued', {
      taskId: task.id,
      taskTitle: task.title,
      priority: task.priority,
      effectivePriority: queuedTask.effectivePriority,
      queueSize: this.tasks.size,
    });
  }

  /**
   * Remove and return the highest priority task.
   */
  dequeue(): QueuedTask | undefined {
    const sorted = this.getSortedTasks();
    if (sorted.length === 0) {
      log.debug('Dequeue called on empty queue');
      return undefined;
    }

    const highest = sorted[0];
    this.tasks.delete(highest.task.id);

    log.debug('Task dequeued', {
      taskId: highest.task.id,
      taskTitle: highest.task.title,
      effectivePriority: highest.effectivePriority,
      remainingQueueSize: this.tasks.size,
    });

    return highest;
  }

  /**
   * Return the highest priority task without removing it.
   */
  peek(): QueuedTask | undefined {
    const sorted = this.getSortedTasks();
    return sorted[0];
  }

  /**
   * Get the next task that prefers the given model.
   * For Opus: tasks with estimated_sessions_opus > 0
   * For Sonnet: tasks with estimated_sessions_sonnet > 0 (or estimated_sessions_opus === 0)
   *
   * If no model-specific tasks exist, returns the highest priority task.
   * Does NOT remove the task from the queue.
   */
  getNextForModel(model: ModelType): QueuedTask | undefined {
    const sorted = this.getSortedTasks();
    if (sorted.length === 0) {
      log.debug('getNextForModel called on empty queue', { model });
      return undefined;
    }

    // Find tasks that prefer this model
    const preferredTasks = sorted.filter(qt => this.taskPrefersModel(qt.task, model));

    // If we have model-preferred tasks, sort by effective priority and return the best
    if (preferredTasks.length > 0) {
      log.debug('Found model-preferred task', {
        model,
        taskId: preferredTasks[0].task.id,
        taskTitle: preferredTasks[0].task.title,
        effectivePriority: preferredTasks[0].effectivePriority,
        preferredTaskCount: preferredTasks.length,
      });
      return preferredTasks[0];
    }

    // Fallback to any task
    log.debug('No model-preferred task, falling back to highest priority', {
      model,
      taskId: sorted[0].task.id,
      taskTitle: sorted[0].task.title,
      effectivePriority: sorted[0].effectivePriority,
    });
    return sorted[0];
  }

  /**
   * Remove a task by ID.
   */
  remove(taskId: string): void {
    const existed = this.tasks.has(taskId);
    this.tasks.delete(taskId);

    if (existed) {
      log.debug('Task removed from queue', { taskId, remainingQueueSize: this.tasks.size });
    } else {
      log.debug('Attempted to remove non-existent task', { taskId });
    }
  }

  /**
   * Clear all tasks from the queue.
   */
  clear(): void {
    const previousSize = this.tasks.size;
    this.tasks.clear();
    log.debug('Queue cleared', { previousSize });
  }

  /**
   * Get the number of tasks in the queue.
   */
  size(): number {
    return this.tasks.size;
  }

  /**
   * Check if the queue is empty.
   */
  isEmpty(): boolean {
    return this.tasks.size === 0;
  }

  /**
   * Check if a task exists in the queue.
   */
  has(taskId: string): boolean {
    return this.tasks.has(taskId);
  }

  /**
   * Get all tasks sorted by effective priority (highest first).
   */
  getAllTasks(): QueuedTask[] {
    return this.getSortedTasks();
  }

  /**
   * Calculate the effective priority including age boost.
   */
  private calculateEffectivePriority(task: Task, enqueuedAt: Date): number {
    const now = new Date();
    const ageMs = now.getTime() - enqueuedAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const ageBoost = ageHours * AGE_BOOST_PER_HOUR;

    return task.priority + ageBoost;
  }

  /**
   * Get all tasks sorted by effective priority (highest first).
   * Recalculates effective priority on each call to account for age changes.
   */
  private getSortedTasks(): QueuedTask[] {
    // Recalculate effective priorities
    const tasks = Array.from(this.tasks.values()).map(qt => ({
      ...qt,
      effectivePriority: this.calculateEffectivePriority(qt.task, qt.enqueuedAt),
    }));

    // Sort by effective priority (descending)
    return tasks.sort((a, b) => b.effectivePriority - a.effectivePriority);
  }

  /**
   * Determine if a task prefers a given model type.
   */
  private taskPrefersModel(task: Task, model: ModelType): boolean {
    if (model === 'opus') {
      return task.estimated_sessions_opus > 0;
    }
    // For sonnet/haiku, prefer tasks that don't specifically need opus
    return task.estimated_sessions_opus === 0 || task.estimated_sessions_sonnet > 0;
  }
}
