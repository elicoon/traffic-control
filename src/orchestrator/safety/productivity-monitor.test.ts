import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProductivityMonitor,
  CompletionRecord,
  ProductivityAlert,
} from './productivity-monitor.js';

/**
 * Helper to create a CompletionRecord with sensible defaults.
 */
function makeRecord(overrides: Partial<CompletionRecord> = {}): CompletionRecord {
  return {
    sessionId: 'session-1',
    taskId: 'task-1',
    model: 'sonnet',
    success: true,
    durationMs: 60_000,
    tokensUsed: 5000,
    costUsd: 0.50,
    timestamp: new Date(),
    ...overrides,
  };
}

describe('ProductivityMonitor', () => {
  let monitor: ProductivityMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-14T12:00:00Z'));
    monitor = new ProductivityMonitor();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ----------------------------------------------------------------
  // Success Rate Calculation
  // ----------------------------------------------------------------

  describe('success rate calculation', () => {
    it('correctly calculates success rate with mixed results', () => {
      // 3 successes, 2 failures = 60%
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const stats = monitor.getStats();
      expect(stats.successRate).toBeCloseTo(60, 1);
      expect(stats.tasksCompleted).toBe(5);
      expect(stats.tasksSuccessful).toBe(3);
      expect(stats.tasksFailed).toBe(2);
    });

    it('returns 0% success rate when all completions fail', () => {
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const stats = monitor.getStats();
      expect(stats.successRate).toBe(0);
      expect(stats.tasksSuccessful).toBe(0);
      expect(stats.tasksFailed).toBe(3);
    });

    it('returns 100% success rate when all completions succeed', () => {
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: true }));

      const stats = monitor.getStats();
      expect(stats.successRate).toBe(100);
      expect(stats.tasksSuccessful).toBe(3);
      expect(stats.tasksFailed).toBe(0);
    });

    it('only counts completions within the time window', () => {
      const windowMs = 86_400_000; // 24 hours (default)
      monitor = new ProductivityMonitor({ windowMs });

      // Record old completions (outside window)
      const oldTimestamp = new Date('2026-02-12T12:00:00Z'); // 2 days ago
      monitor.recordCompletion(makeRecord({ success: false, timestamp: oldTimestamp }));
      monitor.recordCompletion(makeRecord({ success: false, timestamp: oldTimestamp }));
      monitor.recordCompletion(makeRecord({ success: false, timestamp: oldTimestamp }));

      // Record recent completions (inside window)
      const recentTimestamp = new Date('2026-02-14T11:00:00Z'); // 1 hour ago
      monitor.recordCompletion(makeRecord({ success: true, timestamp: recentTimestamp }));
      monitor.recordCompletion(makeRecord({ success: true, timestamp: recentTimestamp }));

      const stats = monitor.getStats();
      // Only the 2 recent completions should count
      expect(stats.tasksCompleted).toBe(2);
      expect(stats.successRate).toBe(100);
    });
  });

  // ----------------------------------------------------------------
  // Failure Streak Detection
  // ----------------------------------------------------------------

  describe('failure streak detection', () => {
    it('does not fire alert at 2 consecutive failures', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({ failureStreakThreshold: 3, minimumCompletions: 1 });
      monitor.onAlert(callback);

      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const streakAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'high_failure_streak');
      expect(streakAlerts).toHaveLength(0);
    });

    it('fires alert at exactly 3 consecutive failures', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({ failureStreakThreshold: 3, minimumCompletions: 1 });
      monitor.onAlert(callback);

      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const streakAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'high_failure_streak');
      expect(streakAlerts.length).toBeGreaterThanOrEqual(1);
      expect(streakAlerts[0][0].metric).toBe(3);
      expect(streakAlerts[0][0].threshold).toBe(3);
    });

    it('fires alert at 4+ consecutive failures', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({ failureStreakThreshold: 3, minimumCompletions: 1 });
      monitor.onAlert(callback);

      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));
      // Advance to a new hour so deduplication doesn't suppress the alert
      vi.advanceTimersByTime(3_600_000);
      monitor.recordCompletion(makeRecord({ success: false, timestamp: new Date() }));

      const streakAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'high_failure_streak');
      expect(streakAlerts.length).toBeGreaterThanOrEqual(2);
    });

    it('resets streak to 0 on success', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({ failureStreakThreshold: 3, minimumCompletions: 1 });
      monitor.onAlert(callback);

      // 2 failures, then a success, then 2 more failures
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const streakAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'high_failure_streak');
      expect(streakAlerts).toHaveLength(0);
    });

    it('non-consecutive failures do not trigger streak alert', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({ failureStreakThreshold: 3, minimumCompletions: 1 });
      monitor.onAlert(callback);

      // Interleave successes to break up the streak
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const streakAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'high_failure_streak');
      expect(streakAlerts).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // Per-Model Stats
  // ----------------------------------------------------------------

  describe('per-model stats', () => {
    it('tracks stats separately per model (opus, sonnet, haiku)', () => {
      monitor.recordCompletion(makeRecord({ model: 'opus', success: true, durationMs: 100_000 }));
      monitor.recordCompletion(makeRecord({ model: 'opus', success: false, durationMs: 200_000 }));
      monitor.recordCompletion(makeRecord({ model: 'sonnet', success: true, durationMs: 50_000 }));
      monitor.recordCompletion(makeRecord({ model: 'haiku', success: true, durationMs: 10_000 }));
      monitor.recordCompletion(makeRecord({ model: 'haiku', success: true, durationMs: 30_000 }));

      const stats = monitor.getStats();

      expect(stats.byModel.opus.completed).toBe(2);
      expect(stats.byModel.opus.successful).toBe(1);
      expect(stats.byModel.opus.failed).toBe(1);
      expect(stats.byModel.opus.avgDurationMs).toBe(150_000);

      expect(stats.byModel.sonnet.completed).toBe(1);
      expect(stats.byModel.sonnet.successful).toBe(1);
      expect(stats.byModel.sonnet.failed).toBe(0);
      expect(stats.byModel.sonnet.avgDurationMs).toBe(50_000);

      expect(stats.byModel.haiku.completed).toBe(2);
      expect(stats.byModel.haiku.successful).toBe(2);
      expect(stats.byModel.haiku.failed).toBe(0);
      expect(stats.byModel.haiku.avgDurationMs).toBe(20_000);
    });

    it('getStats().byModel has correct counts per model', () => {
      // Only opus completions
      monitor.recordCompletion(makeRecord({ model: 'opus', success: true }));
      monitor.recordCompletion(makeRecord({ model: 'opus', success: true }));

      const stats = monitor.getStats();
      expect(stats.byModel.opus.completed).toBe(2);
      expect(stats.byModel.sonnet.completed).toBe(0);
      expect(stats.byModel.haiku.completed).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // Low Success Rate Alerts
  // ----------------------------------------------------------------

  describe('low success rate alerts', () => {
    it('fires when below threshold after minimumCompletions met', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({
        successRateThreshold: 70,
        minimumCompletions: 3,
        failureStreakThreshold: 100, // high to avoid streak alerts
      });
      monitor.onAlert(callback);

      // 1 success, 2 failures = 33% rate, but need 3 completions minimum
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const rateAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'low_success_rate');
      expect(rateAlerts.length).toBeGreaterThanOrEqual(1);
      expect(rateAlerts[0][0].metric).toBeCloseTo(33.3, 0);
      expect(rateAlerts[0][0].threshold).toBe(70);
    });

    it('does not fire if below minimumCompletions', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({
        successRateThreshold: 70,
        minimumCompletions: 5,
        failureStreakThreshold: 100,
      });
      monitor.onAlert(callback);

      // 0 successes, 2 failures = 0% rate, but only 2 completions (below minimum of 5)
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Alert Deduplication
  // ----------------------------------------------------------------

  describe('alert deduplication', () => {
    it('same alert type does not fire twice within same hour', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({
        successRateThreshold: 70,
        minimumCompletions: 3,
        failureStreakThreshold: 100,
      });
      monitor.onAlert(callback);

      // First batch: triggers alert
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const firstCallCount = callback.mock.calls.length;
      expect(firstCallCount).toBeGreaterThanOrEqual(1);

      // Record more completions in the same hour (should be deduplicated)
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const rateAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'low_success_rate');
      // Should only have fired once for this type within the hour
      expect(rateAlerts).toHaveLength(1);
    });

    it('alert deduplication resets across hours', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({
        successRateThreshold: 70,
        minimumCompletions: 3,
        failureStreakThreshold: 100,
      });
      monitor.onAlert(callback);

      // Trigger alert in first hour
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const firstRateAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'low_success_rate');
      expect(firstRateAlerts).toHaveLength(1);

      // Advance to a new hour
      vi.advanceTimersByTime(3_600_000);

      // More failing completions should trigger the alert again
      monitor.recordCompletion(makeRecord({ success: false, timestamp: new Date() }));

      const allRateAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'low_success_rate');
      expect(allRateAlerts).toHaveLength(2);
    });
  });

  // ----------------------------------------------------------------
  // recordAgentCompletion convenience method
  // ----------------------------------------------------------------

  describe('recordAgentCompletion', () => {
    it('works as a convenience wrapper around recordCompletion', () => {
      monitor.recordAgentCompletion(
        'session-abc',
        'task-xyz',
        'opus',
        true,
        120_000,
        8000,
        1.25,
        'Completed successfully',
      );

      const stats = monitor.getStats();
      expect(stats.tasksCompleted).toBe(1);
      expect(stats.tasksSuccessful).toBe(1);
      expect(stats.byModel.opus.completed).toBe(1);
      expect(stats.averageDurationMs).toBe(120_000);
      expect(stats.averageTokensPerTask).toBe(8000);
      expect(stats.averageCostPerTask).toBe(1.25);
    });

    it('passes errorReason through for failed completions', () => {
      monitor.recordAgentCompletion(
        'session-abc',
        'task-xyz',
        'sonnet',
        false,
        60_000,
        3000,
        0.40,
        undefined,
        'Out of context window',
      );

      const failed = monitor.getFailedCompletions();
      expect(failed).toHaveLength(1);
      expect(failed[0].errorReason).toBe('Out of context window');
      expect(failed[0].success).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // getRecentCompletions
  // ----------------------------------------------------------------

  describe('getRecentCompletions', () => {
    it('returns correct limit, sorted by timestamp desc', () => {
      const t1 = new Date('2026-02-14T10:00:00Z');
      const t2 = new Date('2026-02-14T11:00:00Z');
      const t3 = new Date('2026-02-14T11:30:00Z');
      const t4 = new Date('2026-02-14T11:45:00Z');
      const t5 = new Date('2026-02-14T11:50:00Z');

      monitor.recordCompletion(makeRecord({ sessionId: 's1', timestamp: t1 }));
      monitor.recordCompletion(makeRecord({ sessionId: 's2', timestamp: t2 }));
      monitor.recordCompletion(makeRecord({ sessionId: 's3', timestamp: t3 }));
      monitor.recordCompletion(makeRecord({ sessionId: 's4', timestamp: t4 }));
      monitor.recordCompletion(makeRecord({ sessionId: 's5', timestamp: t5 }));

      const recent = monitor.getRecentCompletions(3);

      expect(recent).toHaveLength(3);
      // Most recent first
      expect(recent[0].sessionId).toBe('s5');
      expect(recent[1].sessionId).toBe('s4');
      expect(recent[2].sessionId).toBe('s3');
    });

    it('returns all completions if limit is greater than count', () => {
      monitor.recordCompletion(makeRecord({ sessionId: 's1' }));
      monitor.recordCompletion(makeRecord({ sessionId: 's2' }));

      const recent = monitor.getRecentCompletions(10);
      expect(recent).toHaveLength(2);
    });

    it('defaults to limit of 10', () => {
      for (let i = 0; i < 15; i++) {
        monitor.recordCompletion(makeRecord({ sessionId: `s${i}` }));
      }

      const recent = monitor.getRecentCompletions();
      expect(recent).toHaveLength(10);
    });
  });

  // ----------------------------------------------------------------
  // getFailedCompletions
  // ----------------------------------------------------------------

  describe('getFailedCompletions', () => {
    it('returns only failures', () => {
      monitor.recordCompletion(makeRecord({ sessionId: 's1', success: true }));
      monitor.recordCompletion(makeRecord({ sessionId: 's2', success: false, errorReason: 'timeout' }));
      monitor.recordCompletion(makeRecord({ sessionId: 's3', success: true }));
      monitor.recordCompletion(makeRecord({ sessionId: 's4', success: false, errorReason: 'crash' }));

      const failed = monitor.getFailedCompletions();

      expect(failed).toHaveLength(2);
      expect(failed[0].sessionId).toBe('s2');
      expect(failed[1].sessionId).toBe('s4');
      expect(failed.every((c) => c.success === false)).toBe(true);
    });

    it('returns empty array when no failures', () => {
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: true }));

      const failed = monitor.getFailedCompletions();
      expect(failed).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // Window Pruning
  // ----------------------------------------------------------------

  describe('window pruning', () => {
    it('removes old records outside the window on next recordCompletion', () => {
      const shortWindow = 60_000; // 1 minute
      monitor = new ProductivityMonitor({ windowMs: shortWindow });

      // Record at current time
      monitor.recordCompletion(makeRecord({ sessionId: 'old', timestamp: new Date() }));

      // Advance past the window
      vi.advanceTimersByTime(120_000); // 2 minutes

      // Record new completion to trigger pruning
      monitor.recordCompletion(makeRecord({ sessionId: 'new', timestamp: new Date() }));

      // Old record should have been pruned
      const recent = monitor.getRecentCompletions(100);
      expect(recent).toHaveLength(1);
      expect(recent[0].sessionId).toBe('new');
    });
  });

  // ----------------------------------------------------------------
  // reset()
  // ----------------------------------------------------------------

  describe('reset', () => {
    it('clears all state', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: true }));

      monitor.reset();

      const stats = monitor.getStats();
      expect(stats.tasksCompleted).toBe(0);
      expect(stats.tasksSuccessful).toBe(0);
      expect(stats.tasksFailed).toBe(0);
      expect(stats.successRate).toBe(0);

      const recent = monitor.getRecentCompletions(100);
      expect(recent).toHaveLength(0);

      const failed = monitor.getFailedCompletions();
      expect(failed).toHaveLength(0);
    });

    it('clears alert deduplication state so alerts can fire again', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({
        successRateThreshold: 70,
        minimumCompletions: 3,
        failureStreakThreshold: 100,
      });
      monitor.onAlert(callback);

      // Trigger alert
      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const firstCount = callback.mock.calls.length;
      expect(firstCount).toBeGreaterThanOrEqual(1);

      // Reset and trigger again
      monitor.reset();

      monitor.recordCompletion(makeRecord({ success: true }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      const secondCount = callback.mock.calls.length;
      // Should have additional alerts after reset
      expect(secondCount).toBeGreaterThan(firstCount);
    });
  });

  // ----------------------------------------------------------------
  // formatForSlack
  // ----------------------------------------------------------------

  describe('formatForSlack', () => {
    it('returns a string containing key stats', () => {
      monitor.recordCompletion(makeRecord({ model: 'opus', success: true, durationMs: 60_000 }));
      monitor.recordCompletion(makeRecord({ model: 'sonnet', success: false, durationMs: 120_000 }));
      monitor.recordCompletion(makeRecord({ model: 'haiku', success: true, durationMs: 30_000 }));

      const slack = monitor.formatForSlack();

      expect(typeof slack).toBe('string');
      expect(slack).toContain('Productivity Monitor Status');
      expect(slack).toContain('Completed:');
      expect(slack).toContain('Success:');
      expect(slack).toContain('Failed:');
      expect(slack).toContain('By Model:');
      expect(slack).toContain('Opus:');
      expect(slack).toContain('Sonnet:');
      expect(slack).toContain('Haiku:');
    });

    it('returns a non-empty string even with no completions', () => {
      const slack = monitor.formatForSlack();
      expect(typeof slack).toBe('string');
      expect(slack.length).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------------------------------
  // onAlert / Unsubscribe
  // ----------------------------------------------------------------

  describe('onAlert and unsubscribe', () => {
    it('unsubscribe function prevents future callbacks', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({
        failureStreakThreshold: 3,
        minimumCompletions: 1,
      });
      const unsub = monitor.onAlert(callback);

      // Unsubscribe before any alerts fire
      unsub();

      // Trigger conditions for alert
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));
      monitor.recordCompletion(makeRecord({ success: false }));

      expect(callback).not.toHaveBeenCalled();
    });

    it('callback errors are caught and do not throw', () => {
      const badCallback = vi.fn(() => {
        throw new Error('callback explosion');
      });
      const goodCallback = vi.fn();

      monitor = new ProductivityMonitor({
        failureStreakThreshold: 3,
        minimumCompletions: 1,
      });
      monitor.onAlert(badCallback);
      monitor.onAlert(goodCallback);

      // Should not throw despite bad callback
      expect(() => {
        monitor.recordCompletion(makeRecord({ success: false }));
        monitor.recordCompletion(makeRecord({ success: false }));
        monitor.recordCompletion(makeRecord({ success: false }));
      }).not.toThrow();

      // The good callback should still have been called
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Constructor / Config Defaults
  // ----------------------------------------------------------------

  describe('constructor defaults', () => {
    it('uses default config values when no config is provided', () => {
      const defaultMonitor = new ProductivityMonitor();
      // Exercise getStats to verify no errors with defaults
      const stats = defaultMonitor.getStats();
      expect(stats.tasksCompleted).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('merges partial config with defaults', () => {
      const customMonitor = new ProductivityMonitor({
        successRateThreshold: 50,
      });

      // Record enough to verify the custom threshold
      const callback = vi.fn();
      customMonitor.onAlert(callback);

      // 2 success, 1 failure = 66.7% > 50%, so no low_success_rate alert
      customMonitor.recordCompletion(makeRecord({ success: true }));
      customMonitor.recordCompletion(makeRecord({ success: true }));
      customMonitor.recordCompletion(makeRecord({ success: false }));

      const rateAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'low_success_rate');
      expect(rateAlerts).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------
  // Slow completion alert
  // ----------------------------------------------------------------

  describe('slow completion alert', () => {
    it('fires when average duration exceeds threshold', () => {
      const callback = vi.fn();
      monitor = new ProductivityMonitor({
        slowDurationThresholdMs: 600_000, // 10 minutes
        minimumCompletions: 2,
        failureStreakThreshold: 100,
        successRateThreshold: 0, // disable success rate alerts
      });
      monitor.onAlert(callback);

      // Two completions averaging 15 minutes
      monitor.recordCompletion(makeRecord({ durationMs: 900_000 }));
      monitor.recordCompletion(makeRecord({ durationMs: 900_000 }));

      const slowAlerts = (callback.mock.calls as [ProductivityAlert][])
        .filter(([alert]) => alert.type === 'slow_completion');
      expect(slowAlerts.length).toBeGreaterThanOrEqual(1);
      expect(slowAlerts[0][0].metric).toBe(900_000);
      expect(slowAlerts[0][0].threshold).toBe(600_000);
    });
  });

  // ----------------------------------------------------------------
  // getStats additional fields
  // ----------------------------------------------------------------

  describe('getStats additional fields', () => {
    it('calculates averageDurationMs correctly', () => {
      monitor.recordCompletion(makeRecord({ durationMs: 100_000 }));
      monitor.recordCompletion(makeRecord({ durationMs: 200_000 }));

      const stats = monitor.getStats();
      expect(stats.averageDurationMs).toBe(150_000);
    });

    it('calculates averageTokensPerTask correctly', () => {
      monitor.recordCompletion(makeRecord({ tokensUsed: 4000 }));
      monitor.recordCompletion(makeRecord({ tokensUsed: 6000 }));

      const stats = monitor.getStats();
      expect(stats.averageTokensPerTask).toBe(5000);
    });

    it('calculates averageCostPerTask correctly', () => {
      monitor.recordCompletion(makeRecord({ costUsd: 1.00 }));
      monitor.recordCompletion(makeRecord({ costUsd: 3.00 }));

      const stats = monitor.getStats();
      expect(stats.averageCostPerTask).toBe(2.00);
    });

    it('calculates hourlyRate', () => {
      monitor.recordCompletion(makeRecord());
      monitor.recordCompletion(makeRecord());

      const stats = monitor.getStats();
      // 2 completions in a 24-hour window
      expect(stats.hourlyRate).toBeCloseTo(2 / 24, 4);
    });

    it('includes lastUpdated as a Date', () => {
      monitor.recordCompletion(makeRecord());

      const stats = monitor.getStats();
      expect(stats.lastUpdated).toBeInstanceOf(Date);
    });

    it('returns zero stats when no completions recorded', () => {
      const stats = monitor.getStats();
      expect(stats.tasksCompleted).toBe(0);
      expect(stats.tasksSuccessful).toBe(0);
      expect(stats.tasksFailed).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageDurationMs).toBe(0);
      expect(stats.averageTokensPerTask).toBe(0);
      expect(stats.averageCostPerTask).toBe(0);
      expect(stats.hourlyRate).toBe(0);
    });
  });
});
