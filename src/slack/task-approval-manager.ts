import { SupabaseClient } from '@supabase/supabase-js';
import { SlackMessage, sendMessage, RetryConfig, DEFAULT_RETRY_CONFIG } from './bot.js';
import { logger } from '../logging/index.js';
import { Task } from '../db/repositories/tasks.js';
import { CostTracker, CostEstimate } from '../analytics/cost-tracker.js';

const log = logger.child('Slack.TaskApprovalManager');

/**
 * Result of an approval request
 */
export type ApprovalStatus = 'approved' | 'rejected' | 'timeout' | 'pending';

/**
 * Result returned from requestApproval
 */
export interface ApprovalResult {
  taskId: string;
  status: ApprovalStatus;
  approvedBy?: string;
  rejectedBy?: string;
  reason?: string;
  respondedAt?: Date;
}

/**
 * Pending approval entry
 */
export interface PendingApproval {
  task: Task;
  threadTs: string;
  messageTs: string;
  requestedAt: Date;
  timeoutAt: Date;
  resolve: (result: ApprovalResult) => void;
  queuePosition: number;
  costEstimate?: CostEstimate;
}

/**
 * Configuration for the task approval manager
 */
export interface TaskApprovalConfig {
  /** Slack channel to send approval requests */
  channelId: string;
  /** Timeout in milliseconds for approval requests (default: 5 minutes) */
  timeoutMs: number;
  /** Retry configuration for Slack messages */
  retryConfig?: RetryConfig;
}

/**
 * Default configuration
 */
export const DEFAULT_APPROVAL_CONFIG: TaskApprovalConfig = {
  channelId: '',
  timeoutMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Database row for approval log
 */
export interface ApprovalLogRow {
  id?: string;
  task_id: string;
  status: ApprovalStatus;
  approved_by?: string | null;
  rejected_by?: string | null;
  reason?: string | null;
  requested_at: string;
  responded_at?: string | null;
  thread_ts?: string | null;
}

/**
 * Type for the send function (for dependency injection in tests)
 */
export type ApprovalSendFunction = (message: SlackMessage, retryConfig?: RetryConfig) => Promise<string | undefined>;

/**
 * TaskApprovalManager - Manages task approval workflow via Slack
 *
 * Before any task starts, sends a Slack message requesting approval.
 * Users can approve via emoji reactions or text replies.
 * Logs all approvals/rejections to database.
 */
export class TaskApprovalManager {
  private config: TaskApprovalConfig;
  private client: SupabaseClient;
  private costTracker: CostTracker;
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private sendFn: ApprovalSendFunction;
  private timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    config: TaskApprovalConfig,
    client: SupabaseClient,
    sendFn?: ApprovalSendFunction
  ) {
    if (!config.channelId) {
      throw new Error('TaskApprovalManager requires a channelId');
    }

    this.config = {
      ...DEFAULT_APPROVAL_CONFIG,
      ...config,
    };
    this.client = client;
    this.costTracker = new CostTracker(client);
    this.sendFn = sendFn ?? sendMessage;

    log.info('TaskApprovalManager initialized', {
      channelId: this.config.channelId,
      timeoutMs: this.config.timeoutMs,
    });
  }

  /**
   * Requests approval for a task before it can start.
   * Sends a Slack message with task details and waits for user response.
   *
   * @param task - The task requiring approval
   * @returns Promise that resolves with the approval result
   */
  async requestApproval(task: Task): Promise<ApprovalResult> {
    log.info('Requesting approval for task', { taskId: task.id, title: task.title });

    // Calculate queue position
    const queuePosition = await this.calculateQueuePosition(task);

    // Estimate cost
    let costEstimate: CostEstimate | undefined;
    try {
      costEstimate = await this.costTracker.estimateCost({
        opusSessions: task.estimated_sessions_opus,
        sonnetSessions: task.estimated_sessions_sonnet,
      });
    } catch (error) {
      log.warn('Failed to estimate cost', { taskId: task.id, error: error instanceof Error ? error.message : String(error) });
    }

    // Format and send the approval message
    const messageText = this.formatApprovalMessage(task, queuePosition, costEstimate);
    const message: SlackMessage = {
      channel: this.config.channelId,
      text: messageText,
    };

    const messageTs = await this.sendFn(message, this.config.retryConfig);

    if (!messageTs) {
      log.error('Failed to send approval request message', { taskId: task.id });
      // Log the failed attempt
      await this.logApproval({
        task_id: task.id,
        status: 'timeout',
        reason: 'Failed to send Slack message',
        requested_at: new Date().toISOString(),
      });
      return {
        taskId: task.id,
        status: 'timeout',
        reason: 'Failed to send Slack message',
      };
    }

    // Create a promise that will resolve when approval/rejection is received or timeout
    return new Promise<ApprovalResult>((resolve) => {
      const now = new Date();
      const timeoutAt = new Date(now.getTime() + this.config.timeoutMs);

      const pendingApproval: PendingApproval = {
        task,
        threadTs: messageTs,
        messageTs,
        requestedAt: now,
        timeoutAt,
        resolve,
        queuePosition,
        costEstimate,
      };

      this.pendingApprovals.set(task.id, pendingApproval);

      // Set up timeout - do NOT auto-approve, just reject with timeout
      const timer = setTimeout(async () => {
        await this.handleTimeout(task.id);
      }, this.config.timeoutMs);

      this.timeoutTimers.set(task.id, timer);

      log.debug('Approval request pending', {
        taskId: task.id,
        messageTs,
        timeoutAt: timeoutAt.toISOString(),
      });
    });
  }

  /**
   * Handles an emoji reaction on an approval message.
   *
   * @param reaction - The emoji reaction name (e.g., 'white_check_mark', 'x')
   * @param taskId - The task ID being approved/rejected
   * @param userId - The user ID who reacted (optional, for logging)
   */
  async handleReaction(reaction: string, taskId: string, userId?: string): Promise<void> {
    const pending = this.pendingApprovals.get(taskId);
    if (!pending) {
      log.debug('Received reaction for non-pending task', { taskId, reaction });
      return;
    }

    log.info('Processing reaction for task approval', { taskId, reaction, userId });

    // Normalize reaction names (Slack uses various formats)
    const approveReactions = ['white_check_mark', 'heavy_check_mark', 'check', '+1', 'thumbsup'];
    const rejectReactions = ['x', 'heavy_multiplication_x', 'negative_squared_cross_mark', '-1', 'thumbsdown'];

    let result: ApprovalResult;

    if (approveReactions.includes(reaction)) {
      result = {
        taskId,
        status: 'approved',
        approvedBy: userId,
        respondedAt: new Date(),
      };
    } else if (rejectReactions.includes(reaction)) {
      result = {
        taskId,
        status: 'rejected',
        rejectedBy: userId,
        respondedAt: new Date(),
      };
    } else {
      // Unknown reaction, ignore
      log.debug('Ignoring unknown reaction', { taskId, reaction });
      return;
    }

    await this.completeApproval(taskId, result);
  }

  /**
   * Handles a text reply to an approval message.
   *
   * @param text - The reply text
   * @param taskId - The task ID being approved/rejected
   * @param userId - The user ID who replied (optional, for logging)
   */
  async handleReply(text: string, taskId: string, userId?: string): Promise<void> {
    const pending = this.pendingApprovals.get(taskId);
    if (!pending) {
      log.debug('Received reply for non-pending task', { taskId, text: text.substring(0, 50) });
      return;
    }

    log.info('Processing reply for task approval', { taskId, userId });

    const normalizedText = text.toLowerCase().trim();
    let result: ApprovalResult;

    // Check for approval keywords
    if (
      normalizedText === 'approve' ||
      normalizedText === 'approved' ||
      normalizedText === 'yes' ||
      normalizedText === 'ok' ||
      normalizedText === 'go' ||
      normalizedText === 'lgtm' ||
      normalizedText.startsWith('approve')
    ) {
      result = {
        taskId,
        status: 'approved',
        approvedBy: userId,
        respondedAt: new Date(),
      };
    }
    // Check for rejection keywords
    else if (
      normalizedText === 'reject' ||
      normalizedText === 'rejected' ||
      normalizedText === 'no' ||
      normalizedText === 'stop' ||
      normalizedText === 'cancel' ||
      normalizedText.startsWith('reject')
    ) {
      // Extract reason if provided (e.g., "reject: not ready")
      let reason: string | undefined;
      const colonIndex = text.indexOf(':');
      if (colonIndex > 0) {
        reason = text.substring(colonIndex + 1).trim();
      }

      result = {
        taskId,
        status: 'rejected',
        rejectedBy: userId,
        reason,
        respondedAt: new Date(),
      };
    } else {
      // Unknown reply, ignore but log
      log.debug('Ignoring unrecognized reply', { taskId, text: text.substring(0, 50) });
      return;
    }

    await this.completeApproval(taskId, result);
  }

  /**
   * Gets all tasks currently pending approval.
   */
  getPendingApprovals(): Task[] {
    return Array.from(this.pendingApprovals.values()).map(p => p.task);
  }

  /**
   * Gets pending approval details by task ID.
   */
  getPendingApprovalByTaskId(taskId: string): PendingApproval | undefined {
    return this.pendingApprovals.get(taskId);
  }

  /**
   * Finds a pending approval by its Slack thread timestamp.
   */
  findPendingByThreadTs(threadTs: string): PendingApproval | undefined {
    const pendingList = Array.from(this.pendingApprovals.values());
    for (const pending of pendingList) {
      if (pending.threadTs === threadTs || pending.messageTs === threadTs) {
        return pending;
      }
    }
    return undefined;
  }

  /**
   * Cancels a pending approval request.
   */
  cancelApproval(taskId: string, reason?: string): void {
    const pending = this.pendingApprovals.get(taskId);
    if (!pending) {
      return;
    }

    log.info('Cancelling approval request', { taskId, reason });

    // Clear timeout
    const timer = this.timeoutTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(taskId);
    }

    // Resolve with rejected status
    pending.resolve({
      taskId,
      status: 'rejected',
      reason: reason ?? 'Cancelled',
    });

    this.pendingApprovals.delete(taskId);
  }

  /**
   * Destroys the manager, cleaning up all resources.
   */
  destroy(): void {
    log.info('TaskApprovalManager destroying', {
      pendingCount: this.pendingApprovals.size,
    });

    // Clear all timeouts
    const timerEntries = Array.from(this.timeoutTimers.entries());
    for (const [taskId, timer] of timerEntries) {
      clearTimeout(timer);
      log.debug('Cleared timeout for task', { taskId });
    }
    this.timeoutTimers.clear();

    // Cancel all pending approvals
    const pendingTaskIds = Array.from(this.pendingApprovals.keys());
    for (const taskId of pendingTaskIds) {
      this.cancelApproval(taskId, 'Manager destroyed');
    }
    this.pendingApprovals.clear();
  }

  /**
   * Handles timeout for a pending approval.
   */
  private async handleTimeout(taskId: string): Promise<void> {
    const pending = this.pendingApprovals.get(taskId);
    if (!pending) {
      return;
    }

    log.warn('Approval request timed out', {
      taskId,
      title: pending.task.title,
      requestedAt: pending.requestedAt.toISOString(),
    });

    // Do NOT auto-approve - timeout means rejection
    const result: ApprovalResult = {
      taskId,
      status: 'timeout',
      reason: `No response within ${this.config.timeoutMs / 1000} seconds`,
    };

    await this.completeApproval(taskId, result);
  }

  /**
   * Completes an approval request and logs the result.
   */
  private async completeApproval(taskId: string, result: ApprovalResult): Promise<void> {
    const pending = this.pendingApprovals.get(taskId);
    if (!pending) {
      return;
    }

    // Clear timeout timer
    const timer = this.timeoutTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(taskId);
    }

    // Log to database
    await this.logApproval({
      task_id: taskId,
      status: result.status,
      approved_by: result.approvedBy,
      rejected_by: result.rejectedBy,
      reason: result.reason,
      requested_at: pending.requestedAt.toISOString(),
      responded_at: result.respondedAt?.toISOString() ?? null,
      thread_ts: pending.threadTs,
    });

    log.info('Approval completed', {
      taskId,
      status: result.status,
      approvedBy: result.approvedBy,
      rejectedBy: result.rejectedBy,
      reason: result.reason,
    });

    // Remove from pending and resolve
    this.pendingApprovals.delete(taskId);
    pending.resolve(result);
  }

  /**
   * Logs an approval/rejection to the database.
   */
  private async logApproval(row: ApprovalLogRow): Promise<void> {
    try {
      const { error } = await this.client
        .from('tc_task_approvals')
        .insert(row);

      if (error) {
        // Table might not exist yet - just log and continue
        log.warn('Failed to log approval to database', {
          taskId: row.task_id,
          status: row.status,
          error: error.message,
        });
      } else {
        log.debug('Approval logged to database', {
          taskId: row.task_id,
          status: row.status,
        });
      }
    } catch (error) {
      log.warn('Exception logging approval to database', {
        taskId: row.task_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Calculates the queue position for a task.
   */
  private async calculateQueuePosition(task: Task): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('tc_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'queued')
        .gt('priority', task.priority);

      if (error) {
        log.warn('Failed to calculate queue position', { error: error.message });
        return 0;
      }

      return (count ?? 0) + 1;
    } catch (error) {
      log.warn('Exception calculating queue position', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Formats the approval request message for Slack.
   */
  private formatApprovalMessage(
    task: Task,
    queuePosition: number,
    costEstimate?: CostEstimate
  ): string {
    const lines: string[] = [];

    // Header
    lines.push('*Task Approval Required*');
    lines.push('');

    // Task details
    lines.push(`*Title:* ${task.title}`);
    if (task.description) {
      // Truncate long descriptions
      const maxDesc = 200;
      const desc = task.description.length > maxDesc
        ? task.description.substring(0, maxDesc) + '...'
        : task.description;
      lines.push(`*Description:* ${desc}`);
    }
    lines.push('');

    // Priority and queue position
    lines.push(`*Priority:* ${task.priority}`);
    lines.push(`*Queue Position:* #${queuePosition}`);
    lines.push('');

    // Cost estimate
    if (costEstimate && costEstimate.totalCost > 0) {
      const formatCost = (cost: number) => `$${cost.toFixed(2)}`;
      lines.push('*Estimated Cost:*');
      if (costEstimate.opusCost > 0) {
        lines.push(`  - Opus: ${formatCost(costEstimate.opusCost)} (${task.estimated_sessions_opus} sessions)`);
      }
      if (costEstimate.sonnetCost > 0) {
        lines.push(`  - Sonnet: ${formatCost(costEstimate.sonnetCost)} (${task.estimated_sessions_sonnet} sessions)`);
      }
      lines.push(`  - *Total:* ${formatCost(costEstimate.totalCost)}`);
      lines.push('');
    } else if (task.estimated_sessions_opus > 0 || task.estimated_sessions_sonnet > 0) {
      lines.push('*Estimated Sessions:*');
      if (task.estimated_sessions_opus > 0) {
        lines.push(`  - Opus: ${task.estimated_sessions_opus}`);
      }
      if (task.estimated_sessions_sonnet > 0) {
        lines.push(`  - Sonnet: ${task.estimated_sessions_sonnet}`);
      }
      lines.push('');
    }

    // Instructions
    lines.push('---');
    lines.push('React with :white_check_mark: to approve or :x: to reject');
    lines.push("Or reply with `approve` or `reject` (optionally: `reject: reason`)");

    return lines.join('\n');
  }
}
