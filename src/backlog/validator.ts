import { TaskRepository, Task } from '../db/repositories/tasks.js';

export type ValidationSeverity = 'warning' | 'error';

export type ValidationRule = 'stale' | 'incomplete' | 'orphaned_blocker' | 'unconfirmed_high_priority';

export interface ValidationIssue {
  taskId: string;
  taskTitle: string;
  rule: ValidationRule;
  severity: ValidationSeverity;
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  checkedAt: string;
  taskCount: number;
}

export interface ValidatorOptions {
  /** Number of days a queued task can sit before being flagged as stale. Default: 14 */
  staleDays?: number;
}

export class BacklogValidator {
  private staleDays: number;

  constructor(
    private taskRepo: TaskRepository,
    options: ValidatorOptions = {}
  ) {
    this.staleDays = options.staleDays ?? 14;
  }

  /**
   * Run all validation checks against queued tasks and return issues found.
   */
  async validate(): Promise<ValidationResult> {
    const queuedTasks = await this.taskRepo.getQueued();
    const issues: ValidationIssue[] = [];

    const now = new Date();

    for (const task of queuedTasks) {
      this.checkStale(task, now, issues);
      this.checkIncomplete(task, issues);
      this.checkUnconfirmedHighPriority(task, issues);
    }

    // Orphaned blocker check needs to look up blocking tasks
    await this.checkOrphanedBlockers(queuedTasks, issues);

    return {
      issues,
      checkedAt: now.toISOString(),
      taskCount: queuedTasks.length,
    };
  }

  private checkStale(task: Task, now: Date, issues: ValidationIssue[]): void {
    const createdAt = new Date(task.created_at);
    const ageMs = now.getTime() - createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays >= this.staleDays) {
      issues.push({
        taskId: task.id,
        taskTitle: task.title,
        rule: 'stale',
        severity: 'warning',
        message: `Task has been queued for ${Math.floor(ageDays)} days (threshold: ${this.staleDays})`,
      });
    }
  }

  private checkIncomplete(task: Task, issues: ValidationIssue[]): void {
    const missingFields: string[] = [];

    if (!task.description) {
      missingFields.push('description');
    }
    if (!task.acceptance_criteria) {
      missingFields.push('acceptance_criteria');
    }

    if (missingFields.length > 0) {
      issues.push({
        taskId: task.id,
        taskTitle: task.title,
        rule: 'incomplete',
        severity: 'warning',
        message: `Task is missing: ${missingFields.join(', ')}`,
      });
    }
  }

  private checkUnconfirmedHighPriority(task: Task, issues: ValidationIssue[]): void {
    if (task.priority > 7 && !task.priority_confirmed) {
      issues.push({
        taskId: task.id,
        taskTitle: task.title,
        rule: 'unconfirmed_high_priority',
        severity: 'error',
        message: `High-priority task (priority=${task.priority}) has not been confirmed`,
      });
    }
  }

  private async checkOrphanedBlockers(tasks: Task[], issues: ValidationIssue[]): Promise<void> {
    const tasksWithBlockers = tasks.filter(t => t.blocked_by_task_id !== null);

    for (const task of tasksWithBlockers) {
      const blocker = await this.taskRepo.getById(task.blocked_by_task_id!);

      if (!blocker || blocker.status === 'complete') {
        issues.push({
          taskId: task.id,
          taskTitle: task.title,
          rule: 'orphaned_blocker',
          severity: 'error',
          message: blocker
            ? `Blocked by task "${blocker.title}" which is already complete`
            : `Blocked by task ${task.blocked_by_task_id} which no longer exists`,
        });
      }
    }
  }
}
