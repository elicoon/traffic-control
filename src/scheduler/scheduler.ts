import { AgentManager } from '../agent/manager.js';
import { Task } from '../db/repositories/tasks.js';
import { CapacityTracker, ModelType, CapacityStats } from './capacity-tracker.js';
import { TaskQueue, QueuedTask } from './task-queue.js';
import { logger } from '../logging/index.js';

const log = logger.child('Scheduler');

/**
 * Callback function for spawning agents.
 * Returns the session ID if successful.
 */
export type SpawnCallback = (task: Task, model: ModelType) => Promise<string>;

/**
 * Callback function to filter/approve tasks before scheduling.
 * Return true to proceed with scheduling, false to skip this task.
 */
export type TaskFilterCallback = (task: Task) => Promise<boolean>;

/**
 * Result of a scheduling operation.
 */
export interface ScheduledTaskInfo {
  taskId: string;
  sessionId: string;
  model: ModelType;
}

export interface SchedulerResult {
  status: 'scheduled' | 'no_capacity' | 'idle' | 'error';
  scheduled: number;
  tasks?: ScheduledTaskInfo[];
  error?: string;
}

export interface SchedulerStats {
  queuedTasks: number;
  capacity: CapacityStats;
}

export interface SchedulerConfig {
  agentManager: AgentManager;
  capacityTracker?: CapacityTracker;
  taskQueue?: TaskQueue;
}

/**
 * Main scheduler class that coordinates capacity tracking and task queue.
 * Spawns agents up to capacity limits.
 */
export class Scheduler {
  private agentManager: AgentManager;
  private capacityTracker: CapacityTracker;
  private taskQueue: TaskQueue;

  constructor(config: SchedulerConfig) {
    this.agentManager = config.agentManager;
    this.capacityTracker = config.capacityTracker ?? new CapacityTracker(config.agentManager);
    this.taskQueue = config.taskQueue ?? new TaskQueue();
  }

  /**
   * Schedule the next available task if capacity permits.
   * @param spawnCallback Optional callback for spawning agents
   * @param taskFilter Optional callback to filter/approve tasks before scheduling
   * Returns information about what was scheduled.
   */
  async scheduleNext(spawnCallback?: SpawnCallback, taskFilter?: TaskFilterCallback): Promise<SchedulerResult> {
    log.debug('Checking for tasks to schedule', { queueSize: this.taskQueue.size() });

    // Check if queue is empty
    if (this.taskQueue.isEmpty()) {
      log.debug('Queue is empty, nothing to schedule');
      return { status: 'idle', scheduled: 0 };
    }

    // Check capacity for both models
    const hasOpusCapacity = this.capacityTracker.hasCapacity('opus');
    const hasSonnetCapacity = this.capacityTracker.hasCapacity('sonnet');

    log.debug('Capacity check', { hasOpusCapacity, hasSonnetCapacity });

    if (!hasOpusCapacity && !hasSonnetCapacity) {
      log.debug('No capacity available for any model');
      return { status: 'no_capacity', scheduled: 0 };
    }

    // Try to find a task for available capacity
    let queuedTask: QueuedTask | undefined;
    let targetModel: ModelType = 'sonnet'; // Default, will be updated based on task

    // Prioritize opus tasks if opus capacity is available
    if (hasOpusCapacity) {
      queuedTask = this.taskQueue.getNextForModel('opus');
      if (queuedTask) {
        targetModel = this.determineModel(queuedTask.task);
        // If task doesn't really need opus, and we have sonnet capacity, try that instead
        if (targetModel !== 'opus' && hasSonnetCapacity) {
          const sonnetTask = this.taskQueue.getNextForModel('sonnet');
          if (sonnetTask) {
            queuedTask = sonnetTask;
            targetModel = 'sonnet';
          }
        } else if (targetModel === 'opus') {
          // Keep opus task
        } else {
          // Task wants sonnet but we only have opus - use sonnet anyway
          targetModel = 'sonnet';
        }
      }
    }

    // If no opus task or no opus capacity, try sonnet
    if (!queuedTask && hasSonnetCapacity) {
      queuedTask = this.taskQueue.getNextForModel('sonnet');
      if (queuedTask) {
        targetModel = this.determineModel(queuedTask.task);
        // Force sonnet if that's all we have capacity for
        if (!hasOpusCapacity && targetModel === 'opus') {
          targetModel = 'sonnet';
        }
      }
    }

    if (!queuedTask) {
      log.debug('No suitable task found in queue');
      return { status: 'idle', scheduled: 0 };
    }

    // Apply task filter if provided
    if (taskFilter) {
      try {
        const approved = await taskFilter(queuedTask.task);
        if (!approved) {
          log.debug('Task rejected by filter', { taskId: queuedTask.task.id });
          return { status: 'idle', scheduled: 0 };
        }
      } catch (error) {
        log.warn('Task filter threw error, skipping task', {
          taskId: queuedTask.task.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { status: 'idle', scheduled: 0 };
      }
    }

    log.debug('Task selected for scheduling', {
      taskId: queuedTask.task.id,
      taskTitle: queuedTask.task.title,
      initialTargetModel: targetModel!,
      priority: queuedTask.task.priority,
      effectivePriority: queuedTask.effectivePriority,
    });

    // Verify capacity for target model
    if (!this.capacityTracker.hasCapacity(targetModel!)) {
      // Fallback to other model if available
      const originalModel = targetModel;
      targetModel = targetModel! === 'opus' ? 'sonnet' : 'opus';
      log.debug('Target model capacity exhausted, attempting fallback', {
        originalModel,
        fallbackModel: targetModel,
      });
      if (!this.capacityTracker.hasCapacity(targetModel)) {
        log.debug('Fallback model also at capacity');
        return { status: 'no_capacity', scheduled: 0 };
      }
    }

    try {
      log.debug('Attempting to spawn agent for task', {
        taskId: queuedTask.task.id,
        taskTitle: queuedTask.task.title,
        targetModel: targetModel!,
        effectivePriority: queuedTask.effectivePriority,
      });

      // Spawn the agent
      let sessionId: string;
      if (spawnCallback) {
        sessionId = await spawnCallback(queuedTask.task, targetModel!);
      } else {
        // Default: use agent manager directly
        sessionId = await this.agentManager.spawnAgent(queuedTask.task.id, {
          model: targetModel!,
          projectPath: process.cwd(),
        });
      }

      // Reserve capacity
      this.capacityTracker.reserveCapacity(targetModel!, sessionId);

      // Remove from queue
      this.taskQueue.remove(queuedTask.task.id);

      // Log capacity utilization
      this.logCapacityMetrics();

      log.info('Task scheduled successfully', {
        taskId: queuedTask.task.id,
        sessionId,
        model: targetModel!,
        priority: queuedTask.task.priority,
      });

      return {
        status: 'scheduled',
        scheduled: 1,
        tasks: [{
          taskId: queuedTask.task.id,
          sessionId,
          model: targetModel!,
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to schedule task', error instanceof Error ? error : undefined, {
        taskId: queuedTask.task.id,
        targetModel: targetModel!,
      });
      return { status: 'error', scheduled: 0, error: message };
    }
  }

  /**
   * Schedule as many tasks as capacity allows.
   * @param spawnCallback Optional callback for spawning agents
   * @param taskFilter Optional callback to filter/approve tasks before scheduling
   * Returns results for each scheduled task.
   */
  async scheduleAll(spawnCallback?: SpawnCallback, taskFilter?: TaskFilterCallback): Promise<SchedulerResult[]> {
    const results: SchedulerResult[] = [];

    while (this.canSchedule()) {
      const result = await this.scheduleNext(spawnCallback, taskFilter);

      if (result.status === 'idle' || result.status === 'no_capacity') {
        break;
      }

      results.push(result);

      if (result.status === 'error') {
        break;
      }
    }

    return results;
  }

  /**
   * Add a task to the queue.
   */
  addTask(task: Task): void {
    log.debug('Adding task to queue', {
      taskId: task.id,
      taskTitle: task.title,
      priority: task.priority,
      estimatedOpusSessions: task.estimated_sessions_opus,
      estimatedSonnetSessions: task.estimated_sessions_sonnet,
    });
    this.taskQueue.enqueue(task);
  }

  /**
   * Remove a task from the queue.
   */
  removeTask(taskId: string): void {
    log.debug('Removing task from queue', { taskId });
    this.taskQueue.remove(taskId);
  }

  /**
   * Release capacity for a completed session.
   */
  releaseCapacity(model: ModelType, sessionId: string): void {
    log.debug('Releasing capacity', { model, sessionId });
    this.capacityTracker.releaseCapacity(model, sessionId);
  }

  /**
   * Get current scheduler statistics.
   */
  getStats(): SchedulerStats {
    return {
      queuedTasks: this.taskQueue.size(),
      capacity: this.capacityTracker.getCapacityStats(),
    };
  }

  /**
   * Sync capacity with actual agent manager state.
   */
  syncCapacity(): void {
    log.info('Syncing capacity with agent manager');
    this.capacityTracker.syncWithAgentManager();
  }

  /**
   * Check if we can potentially schedule more tasks.
   */
  canSchedule(): boolean {
    if (this.taskQueue.isEmpty()) {
      return false;
    }

    return this.capacityTracker.hasCapacity('opus') ||
           this.capacityTracker.hasCapacity('sonnet');
  }

  /**
   * Determine the appropriate model for a task based on its properties.
   */
  determineModel(task: Task): ModelType {
    // Explicit session estimates take priority
    if (task.estimated_sessions_opus > 0) {
      return 'opus';
    }
    if (task.estimated_sessions_sonnet > 0) {
      return 'sonnet';
    }

    // Use complexity estimate as a hint
    if (task.complexity_estimate) {
      const complexity = task.complexity_estimate.toLowerCase();
      if (complexity === 'high' || complexity === 'complex') {
        return 'opus';
      }
    }

    // Default to sonnet for better cost efficiency
    return 'sonnet';
  }

  /**
   * Log capacity utilization metrics.
   */
  private logCapacityMetrics(): void {
    const stats = this.capacityTracker.getCapacityStats();
    log.info('Capacity utilization updated', {
      opus: {
        current: stats.opus.current,
        limit: stats.opus.limit,
        utilization: `${(stats.opus.utilization * 100).toFixed(1)}%`,
      },
      sonnet: {
        current: stats.sonnet.current,
        limit: stats.sonnet.limit,
        utilization: `${(stats.sonnet.utilization * 100).toFixed(1)}%`,
      },
      queueSize: this.taskQueue.size(),
    });
  }

  /**
   * Get the task queue instance.
   */
  getTaskQueue(): TaskQueue {
    return this.taskQueue;
  }

  /**
   * Get the capacity tracker instance.
   */
  getCapacityTracker(): CapacityTracker {
    return this.capacityTracker;
  }
}
