/**
 * Task Approval Manager
 *
 * Manages task approval workflow via Slack.
 * Tasks must be approved before they can be scheduled.
 */

import { Task } from '../../db/repositories/tasks.js';
import { logger } from '../../logging/index.js';

const log = logger.child('Safety.TaskApprovalManager');

/**
 * Approval status for a task
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout';

/**
 * Pending approval request
 */
export interface PendingApproval {
  taskId: string;
  task: Task;
  requestedAt: Date;
  threadTs?: string;
  timeoutMs: number;
  status: ApprovalStatus;
  rejectionReason?: string;
}

/**
 * Approval response from user
 */
export interface ApprovalResponse {
  taskId: string;
  approved: boolean;
  reason?: string;
  respondedBy: string;
  respondedAt: Date;
}

/**
 * Configuration for task approval
 */
export interface TaskApprovalConfig {
  /** Time to wait for approval (default: 5 minutes) */
  approvalTimeoutMs: number;
  /** Whether to auto-approve tasks with priority_confirmed = true */
  autoApproveConfirmed: boolean;
  /** Whether to require approval for all tasks */
  requireApprovalForAll: boolean;
  /** Priority threshold - tasks above this are auto-approved */
  autoApprovePriorityThreshold?: number;
}

const DEFAULT_CONFIG: TaskApprovalConfig = {
  approvalTimeoutMs: 5 * 60 * 1000, // 5 minutes
  autoApproveConfirmed: true,
  requireApprovalForAll: false,
  autoApprovePriorityThreshold: undefined,
};

/**
 * Callback for sending approval requests
 */
export type SendApprovalRequestFn = (
  task: Task,
  message: string
) => Promise<string | undefined>;

/**
 * Task Approval Manager
 */
export class TaskApprovalManager {
  private config: TaskApprovalConfig;
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private sendRequestFn: SendApprovalRequestFn | null = null;
  private approvalCallbacks: Array<(response: ApprovalResponse) => void> = [];

  constructor(config: Partial<TaskApprovalConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the function used to send approval requests to Slack
   */
  setSendRequestFn(fn: SendApprovalRequestFn): void {
    this.sendRequestFn = fn;
  }

  /**
   * Register a callback for approval responses
   */
  onApproval(callback: (response: ApprovalResponse) => void): () => void {
    this.approvalCallbacks.push(callback);
    return () => {
      const index = this.approvalCallbacks.indexOf(callback);
      if (index >= 0) {
        this.approvalCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Check if a task requires approval
   */
  requiresApproval(task: Task): boolean {
    // If auto-approve confirmed is enabled and task is confirmed, no approval needed
    if (this.config.autoApproveConfirmed && task.priority_confirmed) {
      log.debug('Task auto-approved (priority_confirmed)', { taskId: task.id });
      return false;
    }

    // If auto-approve by priority threshold
    if (
      this.config.autoApprovePriorityThreshold !== undefined &&
      task.priority >= this.config.autoApprovePriorityThreshold
    ) {
      log.debug('Task auto-approved (priority threshold)', {
        taskId: task.id,
        priority: task.priority,
        threshold: this.config.autoApprovePriorityThreshold,
      });
      return false;
    }

    // If require approval for all is enabled
    if (this.config.requireApprovalForAll) {
      return true;
    }

    // By default, unconfirmed tasks require approval
    return !task.priority_confirmed;
  }

  /**
   * Request approval for a task
   */
  async requestApproval(task: Task): Promise<PendingApproval> {
    log.info('Requesting approval for task', { taskId: task.id, title: task.title });

    const pending: PendingApproval = {
      taskId: task.id,
      task,
      requestedAt: new Date(),
      timeoutMs: this.config.approvalTimeoutMs,
      status: 'pending',
    };

    // Send request to Slack if function is configured
    if (this.sendRequestFn) {
      const message = this.formatApprovalRequest(task);
      try {
        pending.threadTs = await this.sendRequestFn(task, message);
      } catch (error) {
        log.error(
          'Failed to send approval request',
          error instanceof Error ? error : new Error(String(error)),
          { taskId: task.id }
        );
      }
    }

    this.pendingApprovals.set(task.id, pending);

    // Set timeout
    setTimeout(() => {
      this.handleTimeout(task.id);
    }, this.config.approvalTimeoutMs);

    return pending;
  }

  /**
   * Handle approval response
   */
  handleResponse(taskId: string, approved: boolean, respondedBy: string, reason?: string): void {
    const pending = this.pendingApprovals.get(taskId);
    if (!pending) {
      log.warn('Received approval response for unknown task', { taskId });
      return;
    }

    if (pending.status !== 'pending') {
      log.warn('Received approval response for already resolved task', {
        taskId,
        currentStatus: pending.status,
      });
      return;
    }

    pending.status = approved ? 'approved' : 'rejected';
    pending.rejectionReason = reason;

    log.info('Task approval response received', {
      taskId,
      approved,
      respondedBy,
      reason,
    });

    const response: ApprovalResponse = {
      taskId,
      approved,
      reason,
      respondedBy,
      respondedAt: new Date(),
    };

    // Notify callbacks
    for (const callback of this.approvalCallbacks) {
      try {
        callback(response);
      } catch (error) {
        log.error(
          'Error in approval callback',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  /**
   * Handle approval timeout
   */
  private handleTimeout(taskId: string): void {
    const pending = this.pendingApprovals.get(taskId);
    if (!pending || pending.status !== 'pending') {
      return;
    }

    pending.status = 'timeout';
    log.warn('Task approval timed out', { taskId, timeoutMs: pending.timeoutMs });

    const response: ApprovalResponse = {
      taskId,
      approved: false,
      reason: 'Approval timeout',
      respondedBy: 'system',
      respondedAt: new Date(),
    };

    for (const callback of this.approvalCallbacks) {
      try {
        callback(response);
      } catch (error) {
        log.error(
          'Error in approval callback',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  /**
   * Get pending approval for a task
   */
  getPendingApproval(taskId: string): PendingApproval | undefined {
    return this.pendingApprovals.get(taskId);
  }

  /**
   * Get all pending approvals
   */
  getAllPending(): PendingApproval[] {
    return Array.from(this.pendingApprovals.values()).filter(
      (p) => p.status === 'pending'
    );
  }

  /**
   * Check if a task is approved
   */
  isApproved(taskId: string): boolean {
    const pending = this.pendingApprovals.get(taskId);
    return pending?.status === 'approved';
  }

  /**
   * Clear approval state for a task
   */
  clearApproval(taskId: string): void {
    this.pendingApprovals.delete(taskId);
  }

  /**
   * Format approval request message for Slack
   */
  private formatApprovalRequest(task: Task): string {
    const lines: string[] = [
      '*Task Approval Request*',
      '',
      `*Title:* ${task.title}`,
    ];

    if (task.description) {
      lines.push(`*Description:* ${task.description}`);
    }

    lines.push(`*Priority:* ${task.priority}`);

    if (task.estimated_sessions_opus > 0 || task.estimated_sessions_sonnet > 0) {
      const sessions = [];
      if (task.estimated_sessions_opus > 0) {
        sessions.push(`${task.estimated_sessions_opus} Opus`);
      }
      if (task.estimated_sessions_sonnet > 0) {
        sessions.push(`${task.estimated_sessions_sonnet} Sonnet`);
      }
      lines.push(`*Estimated:* ${sessions.join(' + ')} sessions`);
    }

    if (task.tags && task.tags.length > 0) {
      lines.push(`*Tags:* ${task.tags.join(', ')}`);
    }

    lines.push('');
    lines.push('_Reply "approve" to approve or "reject: reason" to reject._');

    return lines.join('\n');
  }

  /**
   * Get approval statistics
   */
  getStats(): {
    pending: number;
    approved: number;
    rejected: number;
    timedOut: number;
  } {
    const approvals = Array.from(this.pendingApprovals.values());
    return {
      pending: approvals.filter((a) => a.status === 'pending').length,
      approved: approvals.filter((a) => a.status === 'approved').length,
      rejected: approvals.filter((a) => a.status === 'rejected').length,
      timedOut: approvals.filter((a) => a.status === 'timeout').length,
    };
  }
}
