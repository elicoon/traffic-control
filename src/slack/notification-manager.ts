import { SlackMessage, formatQuestion, formatBlocker, formatVisualReview } from './bot.js';

/**
 * Type of notification.
 */
export type NotificationType = 'question' | 'blocker' | 'visual_review' | 'completion';

/**
 * Priority level for notifications.
 */
export type NotificationPriority = 'low' | 'normal' | 'high';

/**
 * A notification to be sent to Slack.
 */
export interface Notification {
  type: NotificationType;
  agentId: string;
  taskId: string;
  projectName: string;
  message: string;
  priority?: NotificationPriority;
  threadTs?: string;
  screenshotUrl?: string;
}

/**
 * Pending notification with timestamp.
 */
export interface PendingNotification extends Notification {
  queuedAt: Date;
}

/**
 * Configuration for the notification manager.
 */
export interface NotificationConfig {
  /** Interval in ms between batch flushes */
  batchIntervalMs: number;
  /** Hour (0-23) when quiet hours start */
  quietHoursStart: number;
  /** Hour (0-23) when quiet hours end */
  quietHoursEnd: number;
  /** Default channel to send notifications */
  channelId: string;
}

/**
 * Queued notifications by category.
 */
export interface NotificationQueue {
  questions: PendingNotification[];
  blockers: PendingNotification[];
  reviews: PendingNotification[];
  completions: PendingNotification[];
}

/**
 * Notification statistics.
 */
export interface NotificationStats {
  totalSent: number;
  totalQueued: number;
  lastFlushAt: Date | null;
}

/**
 * Type for the send function.
 */
export type SendFunction = (message: SlackMessage) => Promise<string | undefined>;

/**
 * Manages notification batching, quiet hours, and DND mode.
 */
export class NotificationManager {
  private config: NotificationConfig;
  private sendFn: SendFunction;
  private notificationQueue: NotificationQueue;
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private dndUntil: Date | null = null;
  private stats: NotificationStats;

  constructor(config: NotificationConfig, sendFn: SendFunction) {
    this.config = config;
    this.sendFn = sendFn;
    this.notificationQueue = {
      questions: [],
      blockers: [],
      reviews: [],
      completions: []
    };
    this.stats = {
      totalSent: 0,
      totalQueued: 0,
      lastFlushAt: null
    };

    // Start the batch timer automatically
    this.startBatchTimer();
  }

  /**
   * Queues a notification for batch sending.
   */
  queue(notification: Notification): void {
    const pending: PendingNotification = {
      ...notification,
      queuedAt: new Date()
    };

    switch (notification.type) {
      case 'question':
        this.notificationQueue.questions.push(pending);
        break;
      case 'blocker':
        this.notificationQueue.blockers.push(pending);
        break;
      case 'visual_review':
        this.notificationQueue.reviews.push(pending);
        break;
      case 'completion':
        this.notificationQueue.completions.push(pending);
        break;
    }
  }

  /**
   * Gets all pending notifications.
   */
  getPendingNotifications(): NotificationQueue {
    return { ...this.notificationQueue };
  }

  /**
   * Flushes all pending notifications (respects quiet hours and DND).
   */
  async flush(): Promise<void> {
    const allPending = [
      ...this.notificationQueue.questions,
      ...this.notificationQueue.blockers,
      ...this.notificationQueue.reviews,
      ...this.notificationQueue.completions
    ];

    if (allPending.length === 0) {
      return;
    }

    const isQuiet = this.isQuietHours();
    const isDnd = this.isDndActive();

    for (const notification of allPending) {
      const isHighPriority = notification.priority === 'high';

      // Skip non-high-priority during quiet hours or DND
      if ((isQuiet || isDnd) && !isHighPriority) {
        continue;
      }

      await this.sendNotification(notification);
      this.removeFromQueue(notification);
    }

    this.stats.lastFlushAt = new Date();
  }

  /**
   * Removes a notification from the queue.
   */
  private removeFromQueue(notification: PendingNotification): void {
    switch (notification.type) {
      case 'question':
        this.notificationQueue.questions = this.notificationQueue.questions.filter(n => n !== notification);
        break;
      case 'blocker':
        this.notificationQueue.blockers = this.notificationQueue.blockers.filter(n => n !== notification);
        break;
      case 'visual_review':
        this.notificationQueue.reviews = this.notificationQueue.reviews.filter(n => n !== notification);
        break;
      case 'completion':
        this.notificationQueue.completions = this.notificationQueue.completions.filter(n => n !== notification);
        break;
    }
  }

  /**
   * Sends a notification to Slack.
   */
  private async sendNotification(notification: PendingNotification): Promise<string | undefined> {
    const formattedMessage = this.formatNotification(notification);
    const message: SlackMessage = {
      channel: this.config.channelId,
      text: formattedMessage,
      thread_ts: notification.threadTs
    };

    const result = await this.sendFn(message);
    this.stats.totalSent++;
    return result;
  }

  /**
   * Formats a notification based on its type.
   */
  private formatNotification(notification: Notification): string {
    switch (notification.type) {
      case 'question':
        return formatQuestion(notification.projectName, notification.message);
      case 'blocker':
        return formatBlocker(notification.projectName, notification.message);
      case 'visual_review':
        return formatVisualReview(notification.projectName, notification.message);
      case 'completion':
        return `*[${notification.projectName}]* Task complete:\n\n${notification.message}`;
      default:
        return notification.message;
    }
  }

  /**
   * Checks if current time is within quiet hours.
   */
  isQuietHours(): boolean {
    const now = new Date();
    const hour = now.getHours();

    const start = this.config.quietHoursStart;
    const end = this.config.quietHoursEnd;

    // Handle quiet hours that span midnight
    if (start > end) {
      // e.g., 22:00 to 06:00
      return hour >= start || hour < end;
    } else {
      // e.g., 00:00 to 07:00
      return hour >= start && hour < end;
    }
  }

  /**
   * Enables Do Not Disturb mode for the specified duration.
   */
  setDnd(durationMs: number): void {
    this.dndUntil = new Date(Date.now() + durationMs);
  }

  /**
   * Disables Do Not Disturb mode.
   */
  disableDnd(): void {
    this.dndUntil = null;
  }

  /**
   * Checks if DND is currently active.
   */
  isDndActive(): boolean {
    if (!this.dndUntil) return false;
    return Date.now() < this.dndUntil.getTime();
  }

  /**
   * Gets the remaining DND time in milliseconds.
   */
  getDndRemainingMs(): number {
    if (!this.dndUntil) return 0;
    const remaining = this.dndUntil.getTime() - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Starts the batch flush timer.
   */
  startBatchTimer(): void {
    if (this.batchTimer) return;

    this.batchTimer = setInterval(async () => {
      await this.flush();
    }, this.config.batchIntervalMs);
  }

  /**
   * Stops the batch flush timer.
   */
  stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Checks if the batch timer is running.
   */
  isBatchTimerRunning(): boolean {
    return this.batchTimer !== null;
  }

  /**
   * Sends a notification immediately, bypassing the queue.
   * Still respects DND unless high priority.
   */
  async sendImmediate(notification: Notification): Promise<string | undefined> {
    const isHighPriority = notification.priority === 'high';

    // Check DND (but allow high priority)
    if (this.isDndActive() && !isHighPriority) {
      return undefined;
    }

    // Check quiet hours (but allow high priority)
    if (this.isQuietHours() && !isHighPriority) {
      return undefined;
    }

    const pending: PendingNotification = {
      ...notification,
      queuedAt: new Date()
    };

    return this.sendNotification(pending);
  }

  /**
   * Gets notification statistics.
   */
  getStats(): NotificationStats {
    const totalQueued =
      this.notificationQueue.questions.length +
      this.notificationQueue.blockers.length +
      this.notificationQueue.reviews.length +
      this.notificationQueue.completions.length;

    return {
      ...this.stats,
      totalQueued
    };
  }

  /**
   * Destroys the notification manager, cleaning up all resources.
   * IMPORTANT: Must be called when disposing of the NotificationManager
   * to prevent memory leaks from the batch timer.
   */
  destroy(): void {
    this.stopBatchTimer();
    this.notificationQueue = {
      questions: [],
      blockers: [],
      reviews: [],
      completions: []
    };
    this.dndUntil = null;
  }
}
