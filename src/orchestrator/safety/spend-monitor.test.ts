import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpendMonitor, SpendEntry } from './spend-monitor.js';

vi.mock('../../logging/index.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

/**
 * Helper: create a SpendEntry with sensible defaults, timestamped "now".
 */
function makeEntry(overrides: Partial<SpendEntry> = {}): SpendEntry {
  return {
    sessionId: 'sess-1',
    model: 'opus',
    costUsd: 0,
    inputTokens: 1000,
    outputTokens: 500,
    timestamp: new Date(),
    ...overrides,
  };
}

describe('SpendMonitor', () => {
  let monitor: SpendMonitor;

  beforeEach(() => {
    monitor = new SpendMonitor();
  });

  // ─── Alert Thresholds ──────────────────────────────────────────────

  describe('alert thresholds', () => {
    it('fires alert when daily spend reaches 50% of budget', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      // 50% of $50 daily budget = $25
      monitor.recordSpend(makeEntry({ costUsd: 25 }));

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('daily', 50, expect.any(Number), 50);
    });

    it('fires alert when daily spend reaches 75% of budget', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      // 75% of $50 = $37.50
      monitor.recordSpend(makeEntry({ costUsd: 37.5 }));

      // Should have fired 50% and 75%
      const calls = callback.mock.calls.filter(
        (c: any) => c[0] === 'daily' && c[1] === 75
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['daily', 75, expect.any(Number), 50]);
    });

    it('fires alert when daily spend reaches 90% of budget', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      // 90% of $50 = $45
      monitor.recordSpend(makeEntry({ costUsd: 45 }));

      const calls = callback.mock.calls.filter(
        (c: any) => c[0] === 'daily' && c[1] === 90
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['daily', 90, expect.any(Number), 50]);
    });

    it('fires alert when daily spend reaches 100% of budget', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      // 100% of $50 = $50
      monitor.recordSpend(makeEntry({ costUsd: 50 }));

      const calls = callback.mock.calls.filter(
        (c: any) => c[0] === 'daily' && c[1] === 100
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['daily', 100, expect.any(Number), 50]);
    });

    it('fires all four daily threshold alerts when spending the full budget in one entry', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      // Single entry that hits all thresholds at once
      monitor.recordSpend(makeEntry({ costUsd: 50 }));

      const dailyCalls = callback.mock.calls.filter(
        (c: any) => c[0] === 'daily'
      );
      const thresholds = dailyCalls.map((c: any) => c[1]);
      expect(thresholds).toEqual(expect.arrayContaining([50, 75, 90, 100]));
      expect(dailyCalls).toHaveLength(4);
    });
  });

  // ─── Hard-Stop Behavior ────────────────────────────────────────────

  describe('hard-stop behavior', () => {
    it('shouldStop() returns false when hardStopAtLimit is false even at 100% spend', () => {
      // Default config has hardStopAtLimit: false
      monitor.recordSpend(makeEntry({ costUsd: 50 }));

      expect(monitor.shouldStop()).toBe(false);
    });

    it('shouldStop() returns true when hardStopAtLimit is true and daily spend >= budget', () => {
      const hardStopMonitor = new SpendMonitor({ hardStopAtLimit: true });
      hardStopMonitor.recordSpend(makeEntry({ costUsd: 50 }));

      expect(hardStopMonitor.shouldStop()).toBe(true);
    });

    it('shouldStop() returns true when hardStopAtLimit is true and weekly spend >= budget', () => {
      const hardStopMonitor = new SpendMonitor({
        hardStopAtLimit: true,
        dailyBudgetUsd: 1000, // high daily so it won't trigger
        weeklyBudgetUsd: 100,
      });

      // Spend enough to exceed weekly but not daily
      hardStopMonitor.recordSpend(makeEntry({ costUsd: 100 }));

      expect(hardStopMonitor.shouldStop()).toBe(true);
    });

    it('shouldStop() checks both daily AND weekly budgets', () => {
      const hardStopMonitor = new SpendMonitor({
        hardStopAtLimit: true,
        dailyBudgetUsd: 30,
        weeklyBudgetUsd: 200,
      });

      // $30 hits daily limit but not weekly
      hardStopMonitor.recordSpend(makeEntry({ costUsd: 30 }));

      expect(hardStopMonitor.shouldStop()).toBe(true);
    });
  });

  // ─── Alert Deduplication ───────────────────────────────────────────

  describe('alert deduplication', () => {
    it('does not fire the same daily threshold twice in the same period', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      // First spend pushes past 50%
      monitor.recordSpend(makeEntry({ costUsd: 25 }));
      const countAfterFirst = callback.mock.calls.filter(
        (c: any) => c[0] === 'daily' && c[1] === 50
      ).length;
      expect(countAfterFirst).toBe(1);

      // Second spend stays above 50% but below 75%
      monitor.recordSpend(makeEntry({ costUsd: 5 }));
      const countAfterSecond = callback.mock.calls.filter(
        (c: any) => c[0] === 'daily' && c[1] === 50
      ).length;
      expect(countAfterSecond).toBe(1); // still 1, not 2
    });
  });

  // ─── Weekly Alerts ─────────────────────────────────────────────────

  describe('weekly alerts', () => {
    it('fires weekly alerts independently of daily alerts', () => {
      // Small daily budget so daily thresholds fire easily,
      // large weekly budget so weekly thresholds need separate verification
      const customMonitor = new SpendMonitor({
        dailyBudgetUsd: 10,
        weeklyBudgetUsd: 200,
      });
      const callback = vi.fn();
      customMonitor.onAlert(callback);

      // Spend $100 — that's 1000% of daily but only 50% of weekly
      customMonitor.recordSpend(makeEntry({ costUsd: 100 }));

      const weeklyCalls = callback.mock.calls.filter(
        (c: any) => c[0] === 'weekly' && c[1] === 50
      );
      expect(weeklyCalls).toHaveLength(1);
      expect(weeklyCalls[0]).toEqual(['weekly', 50, expect.any(Number), 200]);
    });
  });

  // ─── Reset Thresholds ─────────────────────────────────────────────

  describe('resetDailyThresholds', () => {
    it('allows daily alerts to re-fire after reset', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      monitor.recordSpend(makeEntry({ costUsd: 25 }));
      const firstFire = callback.mock.calls.filter(
        (c: any) => c[0] === 'daily' && c[1] === 50
      ).length;
      expect(firstFire).toBe(1);

      monitor.resetDailyThresholds();

      // Recording more spend (still above 50%) should re-fire the 50% threshold
      monitor.recordSpend(makeEntry({ costUsd: 1 }));
      const secondFire = callback.mock.calls.filter(
        (c: any) => c[0] === 'daily' && c[1] === 50
      ).length;
      expect(secondFire).toBe(2);
    });
  });

  describe('resetWeeklyThresholds', () => {
    it('allows weekly alerts to re-fire after reset', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      // 50% of $200 weekly = $100
      monitor.recordSpend(makeEntry({ costUsd: 100 }));

      const firstFire = callback.mock.calls.filter(
        (c: any) => c[0] === 'weekly' && c[1] === 50
      ).length;
      expect(firstFire).toBe(1);

      monitor.resetWeeklyThresholds();

      // Still above 50% of weekly, so threshold should re-fire
      monitor.recordSpend(makeEntry({ costUsd: 1 }));
      const secondFire = callback.mock.calls.filter(
        (c: any) => c[0] === 'weekly' && c[1] === 50
      ).length;
      expect(secondFire).toBe(2);
    });
  });

  // ─── recordAgentCost convenience method ────────────────────────────

  describe('recordAgentCost', () => {
    it('records spending correctly via the convenience method', () => {
      monitor.recordAgentCost('sess-42', 'task-7', 'sonnet', 2000, 1000, 3.5);

      const stats = monitor.getStats();
      expect(stats.totalSpend).toBe(3.5);
      expect(stats.byModel.sonnet.spend).toBe(3.5);
      expect(stats.byModel.sonnet.sessions).toBe(1);
    });

    it('accepts undefined taskId', () => {
      monitor.recordAgentCost('sess-42', undefined, 'opus', 1000, 500, 2.0);

      const stats = monitor.getStats();
      expect(stats.totalSpend).toBe(2.0);
    });
  });

  // ─── getStats ──────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns accurate per-model breakdown', () => {
      monitor.recordSpend(makeEntry({ model: 'opus', costUsd: 10, sessionId: 'opus-1' }));
      monitor.recordSpend(makeEntry({ model: 'opus', costUsd: 5, sessionId: 'opus-2' }));
      monitor.recordSpend(makeEntry({ model: 'sonnet', costUsd: 3, sessionId: 'sonnet-1' }));
      monitor.recordSpend(makeEntry({ model: 'haiku', costUsd: 1, sessionId: 'haiku-1' }));

      const stats = monitor.getStats();

      expect(stats.byModel.opus.spend).toBe(15);
      expect(stats.byModel.opus.sessions).toBe(2);
      expect(stats.byModel.sonnet.spend).toBe(3);
      expect(stats.byModel.sonnet.sessions).toBe(1);
      expect(stats.byModel.haiku.spend).toBe(1);
      expect(stats.byModel.haiku.sessions).toBe(1);
    });

    it('calculates daily vs weekly spend correctly', () => {
      // All entries have timestamp = now, so they're both daily and weekly
      monitor.recordSpend(makeEntry({ costUsd: 10 }));
      monitor.recordSpend(makeEntry({ costUsd: 5 }));

      const stats = monitor.getStats();

      expect(stats.dailySpend).toBe(15);
      expect(stats.weeklySpend).toBe(15);
      expect(stats.totalSpend).toBe(15);
      // dailyBudgetUsed = (15 / 50) * 100 = 30%
      expect(stats.dailyBudgetUsed).toBe(30);
      // weeklyBudgetUsed = (15 / 200) * 100 = 7.5%
      expect(stats.weeklyBudgetUsed).toBe(7.5);
    });

    it('marks isOverBudget when daily spend >= 100%', () => {
      monitor.recordSpend(makeEntry({ costUsd: 50 }));

      const stats = monitor.getStats();
      expect(stats.isOverBudget).toBe(true);
    });

    it('marks isOverBudget as false when under both budgets', () => {
      monitor.recordSpend(makeEntry({ costUsd: 10 }));

      const stats = monitor.getStats();
      expect(stats.isOverBudget).toBe(false);
    });

    it('returns zero stats when no entries recorded', () => {
      const stats = monitor.getStats();

      expect(stats.dailySpend).toBe(0);
      expect(stats.weeklySpend).toBe(0);
      expect(stats.totalSpend).toBe(0);
      expect(stats.byModel.opus.spend).toBe(0);
      expect(stats.byModel.opus.sessions).toBe(0);
      expect(stats.isOverBudget).toBe(false);
    });

    it('includes a lastUpdated date', () => {
      const stats = monitor.getStats();
      expect(stats.lastUpdated).toBeInstanceOf(Date);
    });

    it('excludes entries from previous days in daily spend', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      monitor.recordSpend(makeEntry({ costUsd: 20, timestamp: yesterday }));
      monitor.recordSpend(makeEntry({ costUsd: 5 })); // today

      const stats = monitor.getStats();
      expect(stats.dailySpend).toBe(5);
      expect(stats.totalSpend).toBe(25);
    });
  });

  // ─── updateConfig ──────────────────────────────────────────────────

  describe('updateConfig', () => {
    it('reinitializes threshold tracking when alertThresholds change', () => {
      const callback = vi.fn();
      monitor.onAlert(callback);

      // Trigger 50% threshold ($25 of $50)
      monitor.recordSpend(makeEntry({ costUsd: 25 }));
      expect(callback).toHaveBeenCalled();

      callback.mockClear();

      // Change thresholds to [60, 80] — old 50% threshold state is gone
      monitor.updateConfig({ alertThresholds: [60, 80] });

      // Spend $6 more → total $31 = 62% of $50, crossing new 60% threshold
      monitor.recordSpend(makeEntry({ costUsd: 6 }));

      const calls60 = callback.mock.calls.filter(
        (c: any) => c[0] === 'daily' && c[1] === 60
      );
      expect(calls60).toHaveLength(1);
    });

    it('updates budget values', () => {
      monitor.updateConfig({ dailyBudgetUsd: 100, weeklyBudgetUsd: 500 });

      const config = monitor.getConfig();
      expect(config.dailyBudgetUsd).toBe(100);
      expect(config.weeklyBudgetUsd).toBe(500);
    });
  });

  // ─── formatForSlack ────────────────────────────────────────────────

  describe('formatForSlack', () => {
    it('returns a string', () => {
      const result = monitor.formatForSlack();
      expect(typeof result).toBe('string');
    });

    it('includes daily and weekly budget info', () => {
      monitor.recordSpend(makeEntry({ costUsd: 10 }));

      const result = monitor.formatForSlack();

      expect(result).toContain('Daily:');
      expect(result).toContain('Weekly:');
      expect(result).toContain('$10.00');
    });

    it('includes over-budget warning when applicable', () => {
      monitor.recordSpend(makeEntry({ costUsd: 50 }));

      const result = monitor.formatForSlack();
      expect(result).toContain('OVER BUDGET');
    });

    it('does not include over-budget warning when under budget', () => {
      monitor.recordSpend(makeEntry({ costUsd: 5 }));

      const result = monitor.formatForSlack();
      expect(result).not.toContain('OVER BUDGET');
    });
  });

  // ─── getConfig ─────────────────────────────────────────────────────

  describe('getConfig', () => {
    it('returns a deep copy, not the internal reference', () => {
      const config1 = monitor.getConfig();
      config1.dailyBudgetUsd = 9999;

      const config2 = monitor.getConfig();
      expect(config2.dailyBudgetUsd).toBe(50); // unchanged
    });

    it('returns the default config values', () => {
      const config = monitor.getConfig();

      expect(config.dailyBudgetUsd).toBe(50);
      expect(config.weeklyBudgetUsd).toBe(200);
      expect(config.alertThresholds).toEqual([50, 75, 90, 100]);
      expect(config.hardStopAtLimit).toBe(false);
    });
  });

  // ─── Callback error handling ───────────────────────────────────────

  describe('callback error handling', () => {
    it('catches callback errors and does not propagate them', () => {
      const badCallback = vi.fn(() => {
        throw new Error('callback exploded');
      });
      monitor.onAlert(badCallback);

      // Should not throw
      expect(() => {
        monitor.recordSpend(makeEntry({ costUsd: 25 }));
      }).not.toThrow();

      expect(badCallback).toHaveBeenCalled();
    });

    it('continues calling remaining callbacks even if one throws', () => {
      const badCallback = vi.fn(() => {
        throw new Error('first callback explodes');
      });
      const goodCallback = vi.fn();

      monitor.onAlert(badCallback);
      monitor.onAlert(goodCallback);

      monitor.recordSpend(makeEntry({ costUsd: 25 }));

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();
    });
  });

  // ─── Unsubscribe ───────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('prevents further alert calls after unsubscribing', () => {
      const callback = vi.fn();
      const unsub = monitor.onAlert(callback);

      // Trigger 50%
      monitor.recordSpend(makeEntry({ costUsd: 25 }));
      expect(callback).toHaveBeenCalled();

      callback.mockClear();
      unsub();

      // Trigger 75% — callback should NOT fire
      monitor.recordSpend(makeEntry({ costUsd: 15 }));
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ─── Constructor with custom config ────────────────────────────────

  describe('constructor', () => {
    it('accepts partial config and merges with defaults', () => {
      const custom = new SpendMonitor({ dailyBudgetUsd: 100 });
      const config = custom.getConfig();

      expect(config.dailyBudgetUsd).toBe(100);
      expect(config.weeklyBudgetUsd).toBe(200); // default
      expect(config.alertThresholds).toEqual([50, 75, 90, 100]); // default
      expect(config.hardStopAtLimit).toBe(false); // default
    });

    it('works with no arguments (all defaults)', () => {
      const defaultMonitor = new SpendMonitor();
      const config = defaultMonitor.getConfig();

      expect(config.dailyBudgetUsd).toBe(50);
      expect(config.weeklyBudgetUsd).toBe(200);
    });
  });
});
