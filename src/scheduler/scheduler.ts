import { AgentManager } from '../agent/manager.js';
import { Task } from '../db/repositories/tasks.js';
import { CapacityTracker, ModelType, CapacityStats } from './capacity-tracker.js';
import { TaskQueue, QueuedTask } from './task-queue.js';

/**
 * Callback function for spawning agents.
 * Returns the session ID if successful.
 */
export type SpawnCallback = (task: Task, model: ModelType) => Promise<string>;

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
   * Returns information about what was scheduled.
   */
  async scheduleNext(spawnCallback?: SpawnCallback): Promise<SchedulerResult> {
    // Check if queue is empty
    if (this.taskQueue.isEmpty()) {
      return { status: 'idle', scheduled: 0 };
    }

    // Check capacity for both models
    const hasOpusCapacity = this.capacityTracker.hasCapacity('opus');
    const hasSonnetCapacity = this.capacityTracker.hasCapacity('sonnet');

    if (!hasOpusCapacity && !hasSonnetCapacity) {
      return { status: 'no_capacity', scheduled: 0 };
    }

    // Try to find a task for available capacity
    let queuedTask: QueuedTask | undefined;
    let targetModel: ModelType;

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
      return { status: 'idle', scheduled: 0 };
    }

    // Verify capacity for target model
    if (!this.capacityTracker.hasCapacity(targetModel!)) {
      // Fallback to other model if available
      targetModel = targetModel! === 'opus' ? 'sonnet' : 'opus';
      if (!this.capacityTracker.hasCapacity(targetModel)) {
        return { status: 'no_capacity', scheduled: 0 };
      }
    }

    try {
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
      console.error(`Failed to schedule task ${queuedTask.task.id}:`, message);
      return { status: 'error', scheduled: 0, error: message };
    }
  }

  /**
   * Schedule as many tasks as capacity allows.
   * Returns results for each scheduled task.
   */
  async scheduleAll(spawnCallback?: SpawnCallback): Promise<SchedulerResult[]> {
    const results: SchedulerResult[] = [];

    while (this.canSchedule()) {
      const result = await this.scheduleNext(spawnCallback);

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
    this.taskQueue.enqueue(task);
  }

  /**
   * Remove a task from the queue.
   */
  removeTask(taskId: string): void {
    this.taskQueue.remove(taskId);
  }

  /**
   * Release capacity for a completed session.
   */
  releaseCapacity(model: ModelType, sessionId: string): void {
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
    console.log(
      `[Scheduler] Capacity - Opus: ${stats.opus.current}/${stats.opus.limit} (${(stats.opus.utilization * 100).toFixed(1)}%), ` +
      `Sonnet: ${stats.sonnet.current}/${stats.sonnet.limit} (${(stats.sonnet.utilization * 100).toFixed(1)}%), ` +
      `Queue: ${this.taskQueue.size()} tasks`
    );
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
