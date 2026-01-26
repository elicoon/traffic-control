import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  NotificationManager,
  NotificationConfig,
  Notification,
  NotificationType,
  SendFunction
} from './notification-manager.js';

describe('NotificationManager', () => {
  let manager: NotificationManager;
  let mockSendFn: SendFunction;
  let config: NotificationConfig;

  beforeEach(() => {
    // Reset time mocking
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-26T12:00:00'));

    mockSendFn = vi.fn().mockResolvedValue('1234567890.123456') as unknown as SendFunction;

    config = {
      batchIntervalMs: 5000,
      quietHoursStart: 0, // midnight
      quietHoursEnd: 7, // 7am
      channelId: 'C12345'
    };

    manager = new NotificationManager(config, mockSendFn);
  });

  afterEach(() => {
    vi.useRealTimers();
    manager.stopBatchTimer();
  });

  describe('queue', () => {
    it('should queue a notification', () => {
      const notification: Notification = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'What database should I use?'
      };

      manager.queue(notification);

      const pending = manager.getPendingNotifications();
      expect(pending.questions).toHaveLength(1);
      expect(pending.questions[0].message).toBe('What database should I use?');
    });

    it('should categorize notifications by type', () => {
      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Question 1'
      });
      manager.queue({
        type: 'blocker',
        agentId: 'agent-1',
        taskId: 'task-2',
        projectName: 'TestProject',
        message: 'Blocker 1'
      });
      manager.queue({
        type: 'visual_review',
        agentId: 'agent-1',
        taskId: 'task-3',
        projectName: 'TestProject',
        message: 'Review 1'
      });
      manager.queue({
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-4',
        projectName: 'TestProject',
        message: 'Complete 1'
      });

      const pending = manager.getPendingNotifications();
      expect(pending.questions).toHaveLength(1);
      expect(pending.blockers).toHaveLength(1);
      expect(pending.reviews).toHaveLength(1);
      expect(pending.completions).toHaveLength(1);
    });
  });

  describe('flush', () => {
    it('should send all pending notifications', async () => {
      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Question 1'
      });
      manager.queue({
        type: 'blocker',
        agentId: 'agent-1',
        taskId: 'task-2',
        projectName: 'TestProject',
        message: 'Blocker 1'
      });

      await manager.flush();

      expect(mockSendFn).toHaveBeenCalledTimes(2);
    });

    it('should clear pending notifications after flush', async () => {
      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Question 1'
      });

      await manager.flush();

      const pending = manager.getPendingNotifications();
      expect(pending.questions).toHaveLength(0);
    });

    it('should not send during quiet hours', async () => {
      // Set time to 3am (quiet hours)
      vi.setSystemTime(new Date('2026-01-26T03:00:00'));

      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Question 1'
      });

      await manager.flush();

      expect(mockSendFn).not.toHaveBeenCalled();
    });

    it('should send blockers even during quiet hours (high priority)', async () => {
      // Set time to 3am (quiet hours)
      vi.setSystemTime(new Date('2026-01-26T03:00:00'));

      manager.queue({
        type: 'blocker',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Critical blocker',
        priority: 'high'
      });

      await manager.flush();

      expect(mockSendFn).toHaveBeenCalledTimes(1);
    });

    it('should do nothing if no pending notifications', async () => {
      await manager.flush();
      expect(mockSendFn).not.toHaveBeenCalled();
    });
  });

  describe('isQuietHours', () => {
    it('should return true during quiet hours', () => {
      vi.setSystemTime(new Date('2026-01-26T03:00:00')); // 3am
      expect(manager.isQuietHours()).toBe(true);
    });

    it('should return false outside quiet hours', () => {
      vi.setSystemTime(new Date('2026-01-26T12:00:00')); // noon
      expect(manager.isQuietHours()).toBe(false);
    });

    it('should return true at quiet hours start', () => {
      vi.setSystemTime(new Date('2026-01-26T00:00:00')); // midnight
      expect(manager.isQuietHours()).toBe(true);
    });

    it('should return false at quiet hours end', () => {
      vi.setSystemTime(new Date('2026-01-26T07:00:00')); // 7am
      expect(manager.isQuietHours()).toBe(false);
    });

    it('should handle quiet hours spanning midnight', () => {
      const nightConfig: NotificationConfig = {
        ...config,
        quietHoursStart: 22, // 10pm
        quietHoursEnd: 6 // 6am
      };
      const nightManager = new NotificationManager(nightConfig, mockSendFn);

      vi.setSystemTime(new Date('2026-01-26T23:00:00')); // 11pm
      expect(nightManager.isQuietHours()).toBe(true);

      vi.setSystemTime(new Date('2026-01-26T04:00:00')); // 4am
      expect(nightManager.isQuietHours()).toBe(true);

      vi.setSystemTime(new Date('2026-01-26T12:00:00')); // noon
      expect(nightManager.isQuietHours()).toBe(false);

      nightManager.stopBatchTimer();
    });
  });

  describe('DND (Do Not Disturb)', () => {
    it('should enable DND for specified duration', () => {
      manager.setDnd(60000); // 1 minute
      expect(manager.isDndActive()).toBe(true);
    });

    it('should disable DND after duration expires', () => {
      manager.setDnd(60000); // 1 minute

      vi.advanceTimersByTime(60001);

      expect(manager.isDndActive()).toBe(false);
    });

    it('should allow manual DND disable', () => {
      manager.setDnd(60000);
      expect(manager.isDndActive()).toBe(true);

      manager.disableDnd();
      expect(manager.isDndActive()).toBe(false);
    });

    it('should block non-critical notifications during DND', async () => {
      manager.setDnd(60000);

      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Question'
      });

      await manager.flush();

      expect(mockSendFn).not.toHaveBeenCalled();
    });

    it('should allow high priority blockers during DND', async () => {
      manager.setDnd(60000);

      manager.queue({
        type: 'blocker',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Critical blocker',
        priority: 'high'
      });

      await manager.flush();

      expect(mockSendFn).toHaveBeenCalledTimes(1);
    });

    it('should return remaining DND time', () => {
      manager.setDnd(60000);

      vi.advanceTimersByTime(30000);

      const remaining = manager.getDndRemainingMs();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(30000);
    });

    it('should return 0 remaining time when DND is not active', () => {
      expect(manager.getDndRemainingMs()).toBe(0);
    });
  });

  describe('batch timer', () => {
    it('should start batch timer on construction', () => {
      expect(manager.isBatchTimerRunning()).toBe(true);
    });

    it('should auto-flush after batch interval', async () => {
      manager.queue({
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Task complete'
      });

      // Fast forward past batch interval
      await vi.advanceTimersByTimeAsync(5001);

      expect(mockSendFn).toHaveBeenCalled();
    });

    it('should stop batch timer when requested', () => {
      manager.stopBatchTimer();
      expect(manager.isBatchTimerRunning()).toBe(false);
    });

    it('should restart batch timer', () => {
      manager.stopBatchTimer();
      expect(manager.isBatchTimerRunning()).toBe(false);

      manager.startBatchTimer();
      expect(manager.isBatchTimerRunning()).toBe(true);
    });
  });

  describe('immediate send', () => {
    it('should send immediately bypassing queue', async () => {
      const result = await manager.sendImmediate({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Urgent question'
      });

      expect(mockSendFn).toHaveBeenCalledTimes(1);
      expect(result).toBe('1234567890.123456');
    });

    it('should respect DND even for immediate send (unless high priority)', async () => {
      manager.setDnd(60000);

      await manager.sendImmediate({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Question'
      });

      expect(mockSendFn).not.toHaveBeenCalled();
    });

    it('should send high priority immediately even during DND', async () => {
      manager.setDnd(60000);

      await manager.sendImmediate({
        type: 'blocker',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Critical',
        priority: 'high'
      });

      expect(mockSendFn).toHaveBeenCalled();
    });
  });

  describe('notification formatting', () => {
    it('should format question notification correctly', async () => {
      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'What database should I use?'
      });

      await manager.flush();

      expect(mockSendFn).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'C12345',
        text: expect.stringContaining('[TestProject]')
      }));
      expect(mockSendFn).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('What database should I use?')
      }));
    });

    it('should format blocker notification correctly', async () => {
      manager.queue({
        type: 'blocker',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Cannot access API'
      });

      await manager.flush();

      expect(mockSendFn).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('Cannot access API')
      }));
    });

    it('should format completion notification correctly', async () => {
      manager.queue({
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Task completed successfully'
      });

      await manager.flush();

      expect(mockSendFn).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringContaining('Task completed successfully')
      }));
    });
  });

  describe('getStats', () => {
    it('should return notification statistics', async () => {
      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Q1'
      });
      manager.queue({
        type: 'blocker',
        agentId: 'agent-1',
        taskId: 'task-2',
        projectName: 'TestProject',
        message: 'B1'
      });

      await manager.flush();

      const stats = manager.getStats();
      expect(stats.totalSent).toBe(2);
      expect(stats.totalQueued).toBe(0);
    });

    it('should track queued count', () => {
      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Q1'
      });
      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-2',
        projectName: 'TestProject',
        message: 'Q2'
      });

      const stats = manager.getStats();
      expect(stats.totalQueued).toBe(2);
    });
  });

  describe('thread handling', () => {
    it('should include thread_ts when provided', async () => {
      manager.queue({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        projectName: 'TestProject',
        message: 'Follow-up question',
        threadTs: '1234567890.123456'
      });

      await manager.flush();

      expect(mockSendFn).toHaveBeenCalledWith(expect.objectContaining({
        thread_ts: '1234567890.123456'
      }));
    });
  });
});
