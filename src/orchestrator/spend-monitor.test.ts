import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RollingSpendMonitor,
  RollingSpendMonitorConfig,
  SpendAlert,
  formatSpendAlert,
} from './spend-monitor.js';

describe('RollingSpendMonitor', () => {
  let monitor: RollingSpendMonitor;
  let config: Partial<RollingSpendMonitorConfig>;

  beforeEach(() => {
    vi.useFakeTimers();
    config = {
      alertThresholdUsd: 5,
      windowMinutes: 5,
      hardLimitUsd: 50,
    };
    monitor = new RollingSpendMonitor(config);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create RollingSpendMonitor with default config', () => {
      const defaultMonitor = new RollingSpendMonitor();
      const monitorConfig = defaultMonitor.getConfig();

      // Default values from environment or defaults
      expect(monitorConfig.alertThresholdUsd).toBeDefined();
      expect(monitorConfig.windowMinutes).toBeDefined();
      expect(monitorConfig.hardLimitUsd).toBeDefined();
    });

    it('should create RollingSpendMonitor with custom config', () => {
      const customConfig: Partial<RollingSpendMonitorConfig> = {
        alertThresholdUsd: 10,
        windowMinutes: 10,
        hardLimitUsd: 100,
      };
      const customMonitor = new RollingSpendMonitor(customConfig);
      const monitorConfig = customMonitor.getConfig();

      expect(monitorConfig.alertThresholdUsd).toBe(10);
      expect(monitorConfig.windowMinutes).toBe(10);
      expect(monitorConfig.hardLimitUsd).toBe(100);
    });

    it('should start in unpaused state', () => {
      expect(monitor.isPaused()).toBe(false);
    });
  });

  describe('recordSpend', () => {
    it('should record a spend event', () => {
      monitor.recordSpend(1.5, 'task-1', 'opus');

      const stats = monitor.getStats();
      expect(stats.currentSpend).toBe(1.5);
      expect(stats.recordCount).toBe(1);
    });

    it('should accumulate multiple spend events', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');
      monitor.recordSpend(2.0, 'task-2', 'sonnet');
      monitor.recordSpend(0.5, 'task-1', 'opus');

      const stats = monitor.getStats();
      expect(stats.currentSpend).toBe(3.5);
      expect(stats.recordCount).toBe(3);
    });

    it('should track spend by task', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');
      monitor.recordSpend(2.0, 'task-2', 'sonnet');
      monitor.recordSpend(0.5, 'task-1', 'opus');

      const topTasks = monitor.getSpendByTask();
      expect(topTasks).toHaveLength(2);

      // task-2 spent $2.0
      expect(topTasks[0].taskId).toBe('task-2');
      expect(topTasks[0].amount).toBe(2.0);

      // task-1 spent $1.5 total
      expect(topTasks[1].taskId).toBe('task-1');
      expect(topTasks[1].amount).toBe(1.5);
    });
  });

  describe('getSpendInWindow', () => {
    it('should return total spend within the specified window', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');
      monitor.recordSpend(2.0, 'task-2', 'sonnet');

      expect(monitor.getSpendInWindow(5)).toBe(3.0);
    });

    it('should exclude spend outside the window', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');

      // Advance time by 6 minutes (outside 5 minute window)
      vi.advanceTimersByTime(6 * 60 * 1000);

      monitor.recordSpend(2.0, 'task-2', 'sonnet');

      // Only the recent spend should count
      expect(monitor.getSpendInWindow(5)).toBe(2.0);
    });

    it('should support different window sizes', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');

      // Advance time by 3 minutes
      vi.advanceTimersByTime(3 * 60 * 1000);

      monitor.recordSpend(2.0, 'task-2', 'sonnet');

      // 5 minute window should include both
      expect(monitor.getSpendInWindow(5)).toBe(3.0);

      // 2 minute window should only include recent
      expect(monitor.getSpendInWindow(2)).toBe(2.0);
    });

    it('should return 0 when no spend recorded', () => {
      expect(monitor.getSpendInWindow(5)).toBe(0);
    });
  });

  describe('checkThresholds', () => {
    it('should return no alerts when under threshold', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');

      const result = monitor.checkThresholds();

      expect(result.alert).toBe(false);
      expect(result.pause).toBe(false);
      expect(result.stop).toBe(false);
      expect(result.currentSpend).toBe(1.0);
    });

    it('should trigger alert when threshold exceeded', () => {
      // Spend $6 to exceed $5 threshold
      monitor.recordSpend(6.0, 'task-1', 'opus');

      const result = monitor.checkThresholds();

      expect(result.alert).toBe(true);
      expect(result.pause).toBe(true);
      expect(result.stop).toBe(false);
      expect(result.currentSpend).toBe(6.0);
    });

    it('should trigger stop when hard limit exceeded', () => {
      // Spend $55 to exceed $50 hard limit
      monitor.recordSpend(55.0, 'task-1', 'opus');

      const result = monitor.checkThresholds();

      expect(result.alert).toBe(true);
      expect(result.pause).toBe(true);
      expect(result.stop).toBe(true);
      expect(result.currentSpend).toBe(55.0);
    });

    it('should include window minutes in result', () => {
      const result = monitor.checkThresholds();

      expect(result.windowMinutes).toBe(5);
    });
  });

  describe('alert callbacks', () => {
    it('should call onAlert when threshold exceeded', async () => {
      const onAlert = vi.fn();
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onAlert,
      });

      monitorWithCallback.recordSpend(6.0, 'task-1', 'opus');
      monitorWithCallback.checkThresholds();

      expect(onAlert).toHaveBeenCalledTimes(1);
      expect(onAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          amountSpent: 6.0,
          windowMinutes: 5,
          threshold: 5,
          isHardLimit: false,
        })
      );
    });

    it('should call onHardLimit when hard limit exceeded', async () => {
      const onHardLimit = vi.fn();
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onHardLimit,
      });

      monitorWithCallback.recordSpend(55.0, 'task-1', 'opus');
      monitorWithCallback.checkThresholds();

      expect(onHardLimit).toHaveBeenCalledTimes(1);
      expect(onHardLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          amountSpent: 55.0,
          isHardLimit: true,
          threshold: 50,
        })
      );
    });

    it('should fall back to onAlert for hard limit if no onHardLimit provided', async () => {
      const onAlert = vi.fn();
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onAlert,
      });

      monitorWithCallback.recordSpend(55.0, 'task-1', 'opus');
      monitorWithCallback.checkThresholds();

      expect(onAlert).toHaveBeenCalledTimes(1);
      expect(onAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          isHardLimit: true,
        })
      );
    });

    it('should not call alert callback multiple times within cooldown', async () => {
      const onAlert = vi.fn();
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onAlert,
      });

      monitorWithCallback.recordSpend(6.0, 'task-1', 'opus');
      monitorWithCallback.checkThresholds();
      monitorWithCallback.checkThresholds();
      monitorWithCallback.checkThresholds();

      // Should only be called once within the cooldown window
      expect(onAlert).toHaveBeenCalledTimes(1);
    });

    it('should call alert callback again after cooldown expires', async () => {
      const onAlert = vi.fn();
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onAlert,
      });

      monitorWithCallback.recordSpend(6.0, 'task-1', 'opus');
      monitorWithCallback.checkThresholds();

      // Advance past cooldown (window minutes * 60 * 1000)
      vi.advanceTimersByTime(6 * 60 * 1000);

      monitorWithCallback.recordSpend(6.0, 'task-2', 'opus');
      monitorWithCallback.checkThresholds();

      expect(onAlert).toHaveBeenCalledTimes(2);
    });

    it('should handle async callbacks', async () => {
      const onAlert = vi.fn().mockResolvedValue(undefined);
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onAlert,
      });

      monitorWithCallback.recordSpend(6.0, 'task-1', 'opus');
      monitorWithCallback.checkThresholds();

      // Allow promises to resolve
      await vi.runAllTimersAsync();

      expect(onAlert).toHaveBeenCalled();
    });

    it('should catch and log errors in callbacks', async () => {
      const onAlert = vi.fn().mockRejectedValue(new Error('Callback error'));
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onAlert,
      });

      monitorWithCallback.recordSpend(6.0, 'task-1', 'opus');

      // Should not throw
      expect(() => monitorWithCallback.checkThresholds()).not.toThrow();
    });
  });

  describe('pause and resume', () => {
    it('should pause the monitor', () => {
      monitor.pause();

      expect(monitor.isPaused()).toBe(true);
    });

    it('should resume the monitor', () => {
      monitor.pause();
      monitor.resume();

      expect(monitor.isPaused()).toBe(false);
    });

    it('should be idempotent when pausing', () => {
      monitor.pause();
      monitor.pause();

      expect(monitor.isPaused()).toBe(true);
    });

    it('should be idempotent when resuming', () => {
      monitor.resume();
      monitor.resume();

      expect(monitor.isPaused()).toBe(false);
    });

    it('should track pausedAt timestamp', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      vi.setSystemTime(now);

      monitor.pause();

      const stats = monitor.getStats();
      expect(stats.pausedAt).toEqual(now);
    });

    it('should clear pausedAt on resume', () => {
      monitor.pause();
      monitor.resume();

      const stats = monitor.getStats();
      expect(stats.pausedAt).toBeNull();
    });

    it('should reset hard limit flag on resume', () => {
      const onHardLimit = vi.fn();
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onHardLimit,
      });

      // Trigger hard limit
      monitorWithCallback.recordSpend(55.0, 'task-1', 'opus');
      monitorWithCallback.checkThresholds();

      expect(onHardLimit).toHaveBeenCalledTimes(1);

      // Resume should reset the flag
      monitorWithCallback.resume();

      // Reset the spend records for a clean slate
      monitorWithCallback.reset();

      // Re-add the callback since reset clears it
      monitorWithCallback.updateConfig({ onHardLimit });

      // Trigger hard limit again - should trigger callback again
      monitorWithCallback.recordSpend(55.0, 'task-2', 'opus');
      monitorWithCallback.checkThresholds();

      expect(onHardLimit).toHaveBeenCalledTimes(2);
    });
  });

  describe('getSpendByTask', () => {
    it('should return empty array when no spend', () => {
      const tasks = monitor.getSpendByTask();
      expect(tasks).toEqual([]);
    });

    it('should aggregate spend by task', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');
      monitor.recordSpend(0.5, 'task-1', 'opus');
      monitor.recordSpend(2.0, 'task-2', 'sonnet');

      const tasks = monitor.getSpendByTask();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].taskId).toBe('task-2');
      expect(tasks[0].amount).toBe(2.0);
      expect(tasks[1].taskId).toBe('task-1');
      expect(tasks[1].amount).toBe(1.5);
    });

    it('should calculate percentages correctly', () => {
      monitor.recordSpend(3.0, 'task-1', 'opus');
      monitor.recordSpend(1.0, 'task-2', 'sonnet');

      const tasks = monitor.getSpendByTask();

      expect(tasks[0].percentage).toBe(75);
      expect(tasks[1].percentage).toBe(25);
    });

    it('should sort by amount descending', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');
      monitor.recordSpend(3.0, 'task-2', 'sonnet');
      monitor.recordSpend(2.0, 'task-3', 'haiku');

      const tasks = monitor.getSpendByTask();

      expect(tasks[0].amount).toBe(3.0);
      expect(tasks[1].amount).toBe(2.0);
      expect(tasks[2].amount).toBe(1.0);
    });

    it('should only include spend within window', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');

      // Advance past window
      vi.advanceTimersByTime(6 * 60 * 1000);

      monitor.recordSpend(2.0, 'task-2', 'sonnet');

      const tasks = monitor.getSpendByTask();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].taskId).toBe('task-2');
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');
      monitor.recordSpend(2.0, 'task-2', 'sonnet');

      const stats = monitor.getStats();

      expect(stats.currentSpend).toBe(3.0);
      expect(stats.alertThreshold).toBe(5);
      expect(stats.hardLimit).toBe(50);
      expect(stats.windowMinutes).toBe(5);
      expect(stats.isPaused).toBe(false);
      expect(stats.pausedAt).toBeNull();
      expect(stats.recordCount).toBe(2);
      expect(stats.topTasks).toHaveLength(2);
    });

    it('should limit topTasks to 5', () => {
      for (let i = 0; i < 10; i++) {
        monitor.recordSpend(1.0, `task-${i}`, 'opus');
      }

      const stats = monitor.getStats();

      expect(stats.topTasks.length).toBeLessThanOrEqual(5);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      monitor.updateConfig({
        alertThresholdUsd: 10,
        windowMinutes: 10,
      });

      const newConfig = monitor.getConfig();

      expect(newConfig.alertThresholdUsd).toBe(10);
      expect(newConfig.windowMinutes).toBe(10);
      expect(newConfig.hardLimitUsd).toBe(50); // Unchanged
    });

    it('should affect threshold checks after update', () => {
      monitor.recordSpend(6.0, 'task-1', 'opus');

      // Should trigger alert with $5 threshold
      let result = monitor.checkThresholds();
      expect(result.alert).toBe(true);

      // Update threshold to $10
      monitor.updateConfig({ alertThresholdUsd: 10 });

      // Reset alert sent timestamp by advancing time
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Should not trigger alert now
      result = monitor.checkThresholds();
      expect(result.alert).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear all spend records', () => {
      monitor.recordSpend(1.0, 'task-1', 'opus');
      monitor.recordSpend(2.0, 'task-2', 'sonnet');

      monitor.reset();

      const stats = monitor.getStats();
      expect(stats.currentSpend).toBe(0);
      expect(stats.recordCount).toBe(0);
    });

    it('should reset paused state', () => {
      monitor.pause();
      monitor.reset();

      expect(monitor.isPaused()).toBe(false);
    });

    it('should reset alert timestamps', () => {
      const onAlert = vi.fn();
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onAlert,
      });

      monitorWithCallback.recordSpend(6.0, 'task-1', 'opus');
      monitorWithCallback.checkThresholds();

      monitorWithCallback.reset();

      // Should be able to trigger alert again without cooldown
      monitorWithCallback.recordSpend(6.0, 'task-2', 'opus');
      monitorWithCallback.checkThresholds();

      expect(onAlert).toHaveBeenCalledTimes(2);
    });
  });

  describe('record pruning', () => {
    it('should prune old records automatically', () => {
      // Record spend
      monitor.recordSpend(1.0, 'task-1', 'opus');

      // Advance time past 2x window (pruning threshold)
      vi.advanceTimersByTime(11 * 60 * 1000);

      // Record new spend to trigger pruning
      monitor.recordSpend(2.0, 'task-2', 'sonnet');

      const stats = monitor.getStats();
      expect(stats.recordCount).toBe(1); // Only the new record
    });
  });

  describe('alert object structure', () => {
    it('should include all required fields in alert', () => {
      let capturedAlert: SpendAlert | null = null;
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onAlert: (alert) => {
          capturedAlert = alert;
        },
      });

      monitorWithCallback.recordSpend(3.0, 'task-1', 'opus');
      monitorWithCallback.recordSpend(3.0, 'task-2', 'sonnet');
      monitorWithCallback.checkThresholds();

      expect(capturedAlert).not.toBeNull();
      expect(capturedAlert!.amountSpent).toBe(6.0);
      expect(capturedAlert!.windowMinutes).toBe(5);
      expect(capturedAlert!.threshold).toBe(5);
      expect(capturedAlert!.isHardLimit).toBe(false);
      expect(capturedAlert!.topTasks).toHaveLength(2);
      expect(capturedAlert!.timestamp).toBeInstanceOf(Date);
    });

    it('should include top tasks sorted by amount', () => {
      let capturedAlert: SpendAlert | null = null;
      const monitorWithCallback = new RollingSpendMonitor({
        ...config,
        onAlert: (alert) => {
          capturedAlert = alert;
        },
      });

      monitorWithCallback.recordSpend(1.0, 'task-1', 'opus');
      monitorWithCallback.recordSpend(4.0, 'task-2', 'sonnet');
      monitorWithCallback.recordSpend(1.0, 'task-3', 'haiku');
      monitorWithCallback.checkThresholds();

      expect(capturedAlert!.topTasks[0].taskId).toBe('task-2');
      expect(capturedAlert!.topTasks[0].amount).toBe(4.0);
    });
  });
});

describe('formatSpendAlert', () => {
  it('should format alert for regular threshold', () => {
    const alert: SpendAlert = {
      amountSpent: 6.5,
      windowMinutes: 5,
      threshold: 5,
      isHardLimit: false,
      topTasks: [
        { taskId: 'task-1', model: 'opus', amount: 4.0, percentage: 61.5 },
        { taskId: 'task-2', model: 'sonnet', amount: 2.5, percentage: 38.5 },
      ],
      timestamp: new Date(),
    };

    const message = formatSpendAlert(alert);

    expect(message).toContain(':warning:');
    expect(message).toContain('Spending Alert');
    expect(message).toContain('$6.50');
    expect(message).toContain('5 minutes');
    expect(message).toContain('$5.00');
    expect(message).toContain('task-1');
    expect(message).toContain('opus');
    expect(message).toContain('61.5%');
    expect(message).toContain('continue');
    expect(message).toContain('pause');
    expect(message).toContain('stop');
  });

  it('should format alert for hard limit', () => {
    const alert: SpendAlert = {
      amountSpent: 55.0,
      windowMinutes: 5,
      threshold: 50,
      isHardLimit: true,
      topTasks: [
        { taskId: 'task-1', model: 'opus', amount: 55.0, percentage: 100 },
      ],
      timestamp: new Date(),
    };

    const message = formatSpendAlert(alert);

    expect(message).toContain(':rotating_light:');
    expect(message).toContain('HARD LIMIT EXCEEDED');
    expect(message).toContain('$55.00');
    expect(message).toContain('$50.00');
  });

  it('should handle empty top tasks', () => {
    const alert: SpendAlert = {
      amountSpent: 6.0,
      windowMinutes: 5,
      threshold: 5,
      isHardLimit: false,
      topTasks: [],
      timestamp: new Date(),
    };

    const message = formatSpendAlert(alert);

    expect(message).not.toContain('Top spending tasks:');
  });
});
