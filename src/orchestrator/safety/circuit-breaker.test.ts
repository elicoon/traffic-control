import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

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

describe('CircuitBreaker (safety)', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new CircuitBreaker();
  });

  afterEach(() => {
    cb.destroy();
    vi.useRealTimers();
  });

  // ─── State Transitions ───────────────────────────────────────────────

  describe('state transitions', () => {
    it('should transition from closed to open when failures exceed threshold', () => {
      expect(cb.getState()).toBe('closed');

      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`error-${i}`);
      }

      expect(cb.getState()).toBe('open');
      expect(cb.isTripped()).toBe(true);
    });

    it('should transition from open to half_open after reset timeout via allowsOperation', () => {
      // Trip the breaker
      cb.trip('manual trip');
      expect(cb.getState()).toBe('open');

      // Advance past the reset timeout (default 5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000);

      // allowsOperation should detect the timeout and transition
      const allowed = cb.allowsOperation();
      expect(allowed).toBe(true);
      expect(cb.getState()).toBe('half_open');
    });

    it('should transition from open to half_open via scheduled auto-reset timer', () => {
      // Trip the breaker via failures (which schedules the reset timer)
      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`error-${i}`);
      }
      expect(cb.getState()).toBe('open');

      // The timer scheduled by trip() should fire after resetTimeoutMs
      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(cb.getState()).toBe('half_open');
    });

    it('should transition from open to half_open via manual tryHalfOpen()', () => {
      cb.trip('test');
      expect(cb.getState()).toBe('open');

      cb.tryHalfOpen();
      expect(cb.getState()).toBe('half_open');
    });

    it('should transition from half_open to closed after sufficient successes', () => {
      cb.trip('test');
      cb.tryHalfOpen();
      expect(cb.getState()).toBe('half_open');

      // Default successThresholdForClose is 3
      cb.recordSuccess();
      cb.recordSuccess();
      expect(cb.getState()).toBe('half_open');

      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    });

    it('should respect custom successThresholdForClose', () => {
      const custom = new CircuitBreaker({ successThresholdForClose: 1 });
      custom.trip('test');
      custom.tryHalfOpen();

      custom.recordSuccess();
      expect(custom.getState()).toBe('closed');
      custom.destroy();
    });
  });

  // ─── Failure Threshold Behavior ──────────────────────────────────────

  describe('failure threshold behavior', () => {
    it('should not trip when failures are below threshold', () => {
      for (let i = 0; i < 4; i++) {
        cb.recordFailure(`error-${i}`);
      }

      expect(cb.getState()).toBe('closed');
      expect(cb.isTripped()).toBe(false);
    });

    it('should respect custom failureThreshold', () => {
      const custom = new CircuitBreaker({ failureThreshold: 2 });
      custom.recordFailure('error-1');
      expect(custom.getState()).toBe('closed');

      custom.recordFailure('error-2');
      expect(custom.getState()).toBe('open');
      custom.destroy();
    });

    it('should not count failures outside the failure window', () => {
      const custom = new CircuitBreaker({
        failureThreshold: 3,
        failureWindowMs: 60_000, // 1 minute
      });

      // Record 2 failures
      custom.recordFailure('old-error-1');
      custom.recordFailure('old-error-2');

      // Advance past the failure window
      vi.advanceTimersByTime(61_000);

      // Old failures should be pruned; this one alone shouldn't trip
      custom.recordFailure('new-error');
      expect(custom.getState()).toBe('closed');

      custom.destroy();
    });

    it('should prune old failures on recordFailure so they do not accumulate', () => {
      const custom = new CircuitBreaker({
        failureThreshold: 5,
        failureWindowMs: 10_000,
      });

      // Record 4 failures
      for (let i = 0; i < 4; i++) {
        custom.recordFailure(`error-${i}`);
      }

      // Advance so those 4 fall outside the window
      vi.advanceTimersByTime(11_000);

      // Record 1 new failure; old ones pruned, total in-window = 1
      custom.recordFailure('new-error');
      expect(custom.getState()).toBe('closed');
      expect(custom.getStats().failureCount).toBe(1);

      custom.destroy();
    });
  });

  // ─── isTripped() ─────────────────────────────────────────────────────

  describe('isTripped()', () => {
    it('should return false when state is closed', () => {
      expect(cb.isTripped()).toBe(false);
    });

    it('should return true when state is open', () => {
      cb.trip('test');
      expect(cb.isTripped()).toBe(true);
    });

    it('should return false when state is half_open', () => {
      cb.trip('test');
      cb.tryHalfOpen();
      expect(cb.isTripped()).toBe(false);
    });
  });

  // ─── allowsOperation() ──────────────────────────────────────────────

  describe('allowsOperation()', () => {
    it('should return true when closed', () => {
      expect(cb.allowsOperation()).toBe(true);
    });

    it('should return false when open and timeout has not elapsed', () => {
      cb.trip('test');
      expect(cb.allowsOperation()).toBe(false);
    });

    it('should return true when half_open', () => {
      cb.trip('test');
      cb.tryHalfOpen();
      expect(cb.allowsOperation()).toBe(true);
    });

    it('should auto-transition open to half_open when reset timeout has elapsed', () => {
      cb.trip('test');
      expect(cb.allowsOperation()).toBe(false);

      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(cb.allowsOperation()).toBe(true);
      expect(cb.getState()).toBe('half_open');
    });

    it('should not auto-transition when autoReset is false', () => {
      const noAuto = new CircuitBreaker({ autoReset: false });
      noAuto.trip('test');

      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(noAuto.allowsOperation()).toBe(false);
      expect(noAuto.getState()).toBe('open');

      noAuto.destroy();
    });
  });

  // ─── Half-open failure ──────────────────────────────────────────────

  describe('half_open failure', () => {
    it('should return to open on any failure during half_open', () => {
      cb.trip('initial trip');
      cb.tryHalfOpen();
      expect(cb.getState()).toBe('half_open');

      cb.recordFailure('half-open failure');
      expect(cb.getState()).toBe('open');
      expect(cb.isTripped()).toBe(true);
    });

    it('should increment tripCount when re-tripping from half_open', () => {
      cb.trip('first trip');
      const statsAfterFirst = cb.getStats();
      const firstTripCount = statsAfterFirst.tripCount;

      cb.tryHalfOpen();
      cb.recordFailure('re-trip');

      expect(cb.getStats().tripCount).toBe(firstTripCount + 1);
    });
  });

  // ─── trip() ──────────────────────────────────────────────────────────

  describe('trip()', () => {
    it('should manually open the circuit', () => {
      cb.trip('manual reason');
      expect(cb.getState()).toBe('open');
      expect(cb.isTripped()).toBe(true);
    });

    it('should be idempotent when already open', () => {
      cb.trip('first');
      const tripCountBefore = cb.getStats().tripCount;

      cb.trip('second');
      expect(cb.getStats().tripCount).toBe(tripCountBefore);
      expect(cb.getState()).toBe('open');
    });

    it('should increment tripCount on first trip', () => {
      expect(cb.getStats().tripCount).toBe(0);
      cb.trip('test');
      expect(cb.getStats().tripCount).toBe(1);
    });

    it('should trip from half_open state', () => {
      cb.trip('initial');
      cb.tryHalfOpen();
      expect(cb.getState()).toBe('half_open');

      cb.trip('re-trip from half_open');
      expect(cb.getState()).toBe('open');
      expect(cb.getStats().tripCount).toBe(2);
    });
  });

  // ─── reset() ─────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('should reset from open to closed', () => {
      cb.trip('test');
      cb.reset();
      expect(cb.getState()).toBe('closed');
    });

    it('should clear failures and half-open success counter', () => {
      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`error-${i}`);
      }
      expect(cb.getState()).toBe('open');

      cb.reset();
      expect(cb.getStats().failureCount).toBe(0);
      expect(cb.getStats().successCount).toBe(0);
      expect(cb.getState()).toBe('closed');
    });

    it('should be a no-op when already closed (without force)', () => {
      const stateChanges: string[] = [];
      cb.onStateChange((_prev, next) => stateChanges.push(next));

      cb.reset();
      // No state change callback should fire
      expect(stateChanges).toEqual([]);
      expect(cb.getState()).toBe('closed');
    });

    it('should force reset even when closed when force=true', () => {
      const stateChanges: string[] = [];
      cb.onStateChange((_prev, next) => stateChanges.push(next));

      cb.reset(true);
      // A transition should have fired
      expect(stateChanges).toContain('closed');
    });

    it('should reset from half_open to closed', () => {
      cb.trip('test');
      cb.tryHalfOpen();
      cb.reset();
      expect(cb.getState()).toBe('closed');
    });

    it('should clear the auto-reset timer', () => {
      // Trip to start the auto-reset timer
      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`error-${i}`);
      }
      expect(cb.getState()).toBe('open');

      // Reset manually
      cb.reset();
      expect(cb.getState()).toBe('closed');

      // Advance past the old reset timeout; should not cause another transition
      const stateChanges: string[] = [];
      cb.onStateChange((_prev, next) => stateChanges.push(next));
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(stateChanges).toEqual([]);
    });
  });

  // ─── tryHalfOpen() ──────────────────────────────────────────────────

  describe('tryHalfOpen()', () => {
    it('should transition open to half_open', () => {
      cb.trip('test');
      cb.tryHalfOpen();
      expect(cb.getState()).toBe('half_open');
    });

    it('should be a no-op when not in open state', () => {
      cb.tryHalfOpen(); // closed state
      expect(cb.getState()).toBe('closed');

      cb.trip('test');
      cb.tryHalfOpen();
      expect(cb.getState()).toBe('half_open');

      cb.tryHalfOpen(); // already half_open
      expect(cb.getState()).toBe('half_open');
    });

    it('should reset successesInHalfOpen counter', () => {
      cb.trip('first');
      cb.tryHalfOpen();
      cb.recordSuccess(); // 1 success in half_open

      // Fail to go back to open
      cb.recordFailure('failure');
      expect(cb.getState()).toBe('open');

      // Re-enter half_open; counter should be reset
      cb.tryHalfOpen();
      expect(cb.getStats().successCount).toBe(0);
    });
  });

  // ─── recordSuccess() ────────────────────────────────────────────────

  describe('recordSuccess()', () => {
    it('should update lastSuccess timestamp', () => {
      expect(cb.getStats().lastSuccess).toBeUndefined();
      cb.recordSuccess();
      expect(cb.getStats().lastSuccess).toBeDefined();
    });

    it('should not change state when closed', () => {
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');
    });

    it('should increment half_open success counter', () => {
      cb.trip('test');
      cb.tryHalfOpen();

      cb.recordSuccess();
      expect(cb.getStats().successCount).toBe(1);

      cb.recordSuccess();
      expect(cb.getStats().successCount).toBe(2);
    });
  });

  // ─── recordFailure() ────────────────────────────────────────────────

  describe('recordFailure()', () => {
    it('should accept error string and optional context', () => {
      cb.recordFailure('something broke', { component: 'scheduler' });
      const failures = cb.getRecentFailures();
      expect(failures).toHaveLength(1);
      expect(failures[0].error).toBe('something broke');
      expect(failures[0].context).toEqual({ component: 'scheduler' });
    });

    it('should record timestamp on failure', () => {
      const now = new Date();
      cb.recordFailure('test');
      const failures = cb.getRecentFailures();
      expect(failures[0].timestamp.getTime()).toBeGreaterThanOrEqual(now.getTime());
    });
  });

  // ─── onStateChange callbacks ─────────────────────────────────────────

  describe('onStateChange()', () => {
    it('should fire callback on closed to open transition', () => {
      const callback = vi.fn();
      cb.onStateChange(callback);

      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`error-${i}`);
      }

      expect(callback).toHaveBeenCalledWith('closed', 'open', expect.any(String));
    });

    it('should fire callback on open to half_open transition', () => {
      const callback = vi.fn();
      cb.trip('test');

      cb.onStateChange(callback);
      cb.tryHalfOpen();

      expect(callback).toHaveBeenCalledWith('open', 'half_open', expect.any(String));
    });

    it('should fire callback on half_open to closed transition', () => {
      const callback = vi.fn();
      cb.trip('test');
      cb.tryHalfOpen();

      cb.onStateChange(callback);
      for (let i = 0; i < 3; i++) {
        cb.recordSuccess();
      }

      expect(callback).toHaveBeenCalledWith('half_open', 'closed', expect.any(String));
    });

    it('should catch errors thrown by callbacks without propagating', () => {
      const throwingCallback = vi.fn(() => {
        throw new Error('callback exploded');
      });
      cb.onStateChange(throwingCallback);

      // Should not throw
      expect(() => cb.trip('test')).not.toThrow();
      expect(throwingCallback).toHaveBeenCalled();
    });

    it('should return an unsubscribe function that removes the callback', () => {
      const callback = vi.fn();
      const unsub = cb.onStateChange(callback);

      unsub();

      cb.trip('test');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle multiple callbacks', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      cb.onStateChange(cb1);
      cb.onStateChange(cb2);

      cb.trip('test');

      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });

    it('should allow unsubscribing one callback while others remain', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      const unsub1 = cb.onStateChange(cb1);
      cb.onStateChange(cb2);

      unsub1();
      cb.trip('test');

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });
  });

  // ─── getStats() ──────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('should return correct initial stats', () => {
      const stats = cb.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.tripCount).toBe(0);
      expect(stats.isTripped).toBe(false);
      expect(stats.lastFailure).toBeUndefined();
      expect(stats.lastSuccess).toBeUndefined();
      expect(stats.lastStateChange).toBeInstanceOf(Date);
    });

    it('should reflect failure count', () => {
      cb.recordFailure('err-1');
      cb.recordFailure('err-2');
      expect(cb.getStats().failureCount).toBe(2);
    });

    it('should reflect tripCount across multiple trips', () => {
      cb.trip('first');
      cb.tryHalfOpen();
      cb.trip('second');
      expect(cb.getStats().tripCount).toBe(2);
    });

    it('should show lastFailure timestamp', () => {
      cb.recordFailure('test');
      expect(cb.getStats().lastFailure).toBeInstanceOf(Date);
    });

    it('should show lastSuccess timestamp', () => {
      cb.recordSuccess();
      expect(cb.getStats().lastSuccess).toBeInstanceOf(Date);
    });

    it('should reflect isTripped correctly', () => {
      expect(cb.getStats().isTripped).toBe(false);
      cb.trip('test');
      expect(cb.getStats().isTripped).toBe(true);
      cb.tryHalfOpen();
      expect(cb.getStats().isTripped).toBe(false);
    });
  });

  // ─── getRecentFailures() ─────────────────────────────────────────────

  describe('getRecentFailures()', () => {
    it('should return empty array when no failures', () => {
      expect(cb.getRecentFailures()).toEqual([]);
    });

    it('should return all failures when under limit', () => {
      cb.recordFailure('err-1');
      cb.recordFailure('err-2');
      const failures = cb.getRecentFailures();
      expect(failures).toHaveLength(2);
      expect(failures[0].error).toBe('err-1');
      expect(failures[1].error).toBe('err-2');
    });

    it('should return last N failures when limit is specified', () => {
      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`err-${i}`);
      }

      const failures = cb.getRecentFailures(2);
      expect(failures).toHaveLength(2);
      expect(failures[0].error).toBe('err-3');
      expect(failures[1].error).toBe('err-4');
    });

    it('should default to 10 limit', () => {
      const custom = new CircuitBreaker({ failureThreshold: 20, failureWindowMs: 60_000 });
      for (let i = 0; i < 15; i++) {
        custom.recordFailure(`err-${i}`);
      }
      const failures = custom.getRecentFailures();
      expect(failures).toHaveLength(10);
      custom.destroy();
    });

    it('should return a copy, not a reference to internal array', () => {
      cb.recordFailure('test');
      const failures = cb.getRecentFailures();
      failures.push({ timestamp: new Date(), error: 'injected' });

      expect(cb.getRecentFailures()).toHaveLength(1);
    });
  });

  // ─── formatForSlack() ────────────────────────────────────────────────

  describe('formatForSlack()', () => {
    it('should return a string', () => {
      expect(typeof cb.formatForSlack()).toBe('string');
    });

    it('should include state indicator for closed state', () => {
      const output = cb.formatForSlack();
      expect(output).toContain('[OK]');
      expect(output).toContain('closed');
    });

    it('should include state indicator for open state', () => {
      cb.trip('test');
      const output = cb.formatForSlack();
      expect(output).toContain('[OPEN]');
      expect(output).toContain('open');
      expect(output).toContain('Operations blocked');
    });

    it('should include state indicator for half_open state', () => {
      cb.trip('test');
      cb.tryHalfOpen();
      const output = cb.formatForSlack();
      expect(output).toContain('[HALF]');
      expect(output).toContain('half_open');
      expect(output).toContain('Recovery');
    });

    it('should include failure count and threshold', () => {
      cb.recordFailure('test');
      const output = cb.formatForSlack();
      expect(output).toContain('Failures');
      expect(output).toContain('threshold');
    });

    it('should include reset countdown when open', () => {
      cb.trip('test');
      const output = cb.formatForSlack();
      expect(output).toContain('Reset in');
    });

    it('should include last failure time when failures exist', () => {
      cb.recordFailure('test');
      const output = cb.formatForSlack();
      expect(output).toContain('Last Fail');
    });

    it('should include last success time when successes exist', () => {
      cb.recordSuccess();
      const output = cb.formatForSlack();
      expect(output).toContain('Last OK');
    });
  });

  // ─── destroy() ───────────────────────────────────────────────────────

  describe('destroy()', () => {
    it('should clear reset timer so it does not fire', () => {
      // Trip to schedule a reset timer
      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`error-${i}`);
      }
      expect(cb.getState()).toBe('open');

      cb.destroy();

      // Advance past timeout; state should remain open since timer was cleared
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(cb.getState()).toBe('open');
    });

    it('should clear all state change callbacks', () => {
      const callback = vi.fn();
      cb.onStateChange(callback);

      cb.destroy();

      // Manually cause a transition; callback should not fire
      // We need a new reference since destroy cleared callbacks
      // Trip should still work but no callback
      cb.trip('after destroy');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ─── autoReset: false ────────────────────────────────────────────────

  describe('autoReset: false', () => {
    let noAutoReset: CircuitBreaker;

    beforeEach(() => {
      noAutoReset = new CircuitBreaker({ autoReset: false });
    });

    afterEach(() => {
      noAutoReset.destroy();
    });

    it('should not schedule a reset timer when tripped', () => {
      noAutoReset.trip('test');
      expect(noAutoReset.getState()).toBe('open');

      // Advance well past the default timeout
      vi.advanceTimersByTime(30 * 60 * 1000);

      // Still open - no auto-reset
      expect(noAutoReset.getState()).toBe('open');
    });

    it('should not auto-transition on allowsOperation when timeout elapsed', () => {
      noAutoReset.trip('test');

      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(noAutoReset.allowsOperation()).toBe(false);
      expect(noAutoReset.getState()).toBe('open');
    });

    it('should still allow manual tryHalfOpen', () => {
      noAutoReset.trip('test');
      noAutoReset.tryHalfOpen();
      expect(noAutoReset.getState()).toBe('half_open');
    });

    it('should still allow manual reset', () => {
      noAutoReset.trip('test');
      noAutoReset.reset();
      expect(noAutoReset.getState()).toBe('closed');
    });

    it('should keep circuit open indefinitely after failure-triggered trip', () => {
      const noAuto = new CircuitBreaker({
        autoReset: false,
        failureThreshold: 2,
      });

      noAuto.recordFailure('err-1');
      noAuto.recordFailure('err-2');
      expect(noAuto.getState()).toBe('open');

      vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour

      expect(noAuto.getState()).toBe('open');
      expect(noAuto.allowsOperation()).toBe(false);

      noAuto.destroy();
    });
  });

  // ─── Full lifecycle ──────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('should complete a full closed -> open -> half_open -> closed cycle', () => {
      const transitions: Array<{ from: string; to: string; reason: string }> = [];
      cb.onStateChange((prev, next, reason) => {
        transitions.push({ from: prev, to: next, reason });
      });

      // Start closed
      expect(cb.getState()).toBe('closed');

      // Trip via failures
      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`error-${i}`);
      }
      expect(cb.getState()).toBe('open');

      // Wait for auto-reset timer
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(cb.getState()).toBe('half_open');

      // Recover via successes
      cb.recordSuccess();
      cb.recordSuccess();
      cb.recordSuccess();
      expect(cb.getState()).toBe('closed');

      // Verify all transitions fired
      expect(transitions).toHaveLength(3);
      expect(transitions[0]).toEqual({ from: 'closed', to: 'open', reason: expect.any(String) });
      expect(transitions[1]).toEqual({
        from: 'open',
        to: 'half_open',
        reason: expect.any(String),
      });
      expect(transitions[2]).toEqual({
        from: 'half_open',
        to: 'closed',
        reason: expect.any(String),
      });
    });

    it('should handle repeated trip-recover cycles', () => {
      // First cycle
      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`cycle1-error-${i}`);
      }
      expect(cb.getState()).toBe('open');

      cb.tryHalfOpen();
      for (let i = 0; i < 3; i++) {
        cb.recordSuccess();
      }
      expect(cb.getState()).toBe('closed');

      // Second cycle
      for (let i = 0; i < 5; i++) {
        cb.recordFailure(`cycle2-error-${i}`);
      }
      expect(cb.getState()).toBe('open');
      expect(cb.getStats().tripCount).toBe(2);

      cb.tryHalfOpen();
      for (let i = 0; i < 3; i++) {
        cb.recordSuccess();
      }
      expect(cb.getState()).toBe('closed');
    });
  });

  // ─── Constructor defaults ────────────────────────────────────────────

  describe('constructor', () => {
    it('should use default config values', () => {
      const defaultCb = new CircuitBreaker();
      // Default failureThreshold is 5; 4 failures should not trip
      for (let i = 0; i < 4; i++) {
        defaultCb.recordFailure(`error-${i}`);
      }
      expect(defaultCb.getState()).toBe('closed');

      defaultCb.recordFailure('error-4');
      expect(defaultCb.getState()).toBe('open');
      defaultCb.destroy();
    });

    it('should allow partial config overrides', () => {
      const custom = new CircuitBreaker({ failureThreshold: 2 });
      custom.recordFailure('err-1');
      custom.recordFailure('err-2');
      expect(custom.getState()).toBe('open');
      custom.destroy();
    });

    it('should start in closed state', () => {
      expect(cb.getState()).toBe('closed');
    });
  });
});
