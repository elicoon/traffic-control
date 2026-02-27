import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapacityTracker, ModelType, CapacityConfig } from './capacity-tracker.js';
import { AgentManager } from '../agent/manager.js';

// Mock the AgentManager with a class that can be constructed
vi.mock('../agent/manager.js', () => {
  const MockAgentManager = vi.fn(function (this: any) {
    this.getActiveSessions = vi.fn().mockReturnValue([]);
    this.onEvent = vi.fn();
  });
  return { AgentManager: MockAgentManager };
});

describe('CapacityTracker', () => {
  let tracker: CapacityTracker;
  let mockAgentManager: AgentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentManager = new AgentManager();
    tracker = new CapacityTracker(mockAgentManager);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('configuration', () => {
    it('should use default limits when env vars are not set', () => {
      const config = tracker.getConfig();
      expect(config.opusSessionLimit).toBe(1);
      expect(config.sonnetSessionLimit).toBe(2);
    });

    it('should use custom limits from env vars', () => {
      vi.stubEnv('OPUS_SESSION_LIMIT', '3');
      vi.stubEnv('SONNET_SESSION_LIMIT', '15');

      const customTracker = new CapacityTracker(mockAgentManager);
      const config = customTracker.getConfig();

      expect(config.opusSessionLimit).toBe(3);
      expect(config.sonnetSessionLimit).toBe(15);
    });

    it('should allow custom config via constructor', () => {
      const customConfig: CapacityConfig = {
        opusSessionLimit: 2,
        sonnetSessionLimit: 8,
      };
      const customTracker = new CapacityTracker(mockAgentManager, customConfig);
      const config = customTracker.getConfig();

      expect(config.opusSessionLimit).toBe(2);
      expect(config.sonnetSessionLimit).toBe(8);
    });
  });

  describe('hasCapacity', () => {
    it('should return true when no sessions are running', () => {
      expect(tracker.hasCapacity('opus')).toBe(true);
      expect(tracker.hasCapacity('sonnet')).toBe(true);
    });

    it('should return false when at opus capacity', () => {
      // Reserve all opus slots (default: 1)
      tracker.reserveCapacity('opus', 'session-0');

      expect(tracker.hasCapacity('opus')).toBe(false);
      expect(tracker.hasCapacity('sonnet')).toBe(true);
    });

    it('should return false when at sonnet capacity', () => {
      // Reserve all sonnet slots (default: 2)
      tracker.reserveCapacity('sonnet', 'session-0');
      tracker.reserveCapacity('sonnet', 'session-1');

      expect(tracker.hasCapacity('opus')).toBe(true);
      expect(tracker.hasCapacity('sonnet')).toBe(false);
    });

    it('should handle haiku model (uses sonnet capacity)', () => {
      expect(tracker.hasCapacity('haiku')).toBe(true);

      // Fill sonnet capacity (default: 2)
      tracker.reserveCapacity('sonnet', 'session-0');
      tracker.reserveCapacity('sonnet', 'session-1');

      expect(tracker.hasCapacity('haiku')).toBe(false);
    });
  });

  describe('reserveCapacity', () => {
    it('should reserve opus capacity successfully', () => {
      const result = tracker.reserveCapacity('opus', 'session-1');
      expect(result).toBe(true);
      expect(tracker.getCurrentSessionCount('opus')).toBe(1);
    });

    it('should reserve sonnet capacity successfully', () => {
      const result = tracker.reserveCapacity('sonnet', 'session-1');
      expect(result).toBe(true);
      expect(tracker.getCurrentSessionCount('sonnet')).toBe(1);
    });

    it('should fail to reserve when at capacity', () => {
      // Fill opus capacity (default: 1)
      tracker.reserveCapacity('opus', 'session-0');

      const result = tracker.reserveCapacity('opus', 'session-overflow');
      expect(result).toBe(false);
      expect(tracker.getCurrentSessionCount('opus')).toBe(1);
    });

    it('should not double-reserve the same session', () => {
      tracker.reserveCapacity('opus', 'session-1');
      tracker.reserveCapacity('opus', 'session-1'); // Same session

      expect(tracker.getCurrentSessionCount('opus')).toBe(1);
    });
  });

  describe('releaseCapacity', () => {
    it('should release opus capacity', () => {
      tracker.reserveCapacity('opus', 'session-1');
      expect(tracker.getCurrentSessionCount('opus')).toBe(1);

      tracker.releaseCapacity('opus', 'session-1');
      expect(tracker.getCurrentSessionCount('opus')).toBe(0);
    });

    it('should release sonnet capacity', () => {
      tracker.reserveCapacity('sonnet', 'session-1');
      expect(tracker.getCurrentSessionCount('sonnet')).toBe(1);

      tracker.releaseCapacity('sonnet', 'session-1');
      expect(tracker.getCurrentSessionCount('sonnet')).toBe(0);
    });

    it('should handle releasing non-existent session gracefully', () => {
      // Should not throw
      expect(() => tracker.releaseCapacity('opus', 'non-existent')).not.toThrow();
      expect(tracker.getCurrentSessionCount('opus')).toBe(0);
    });
  });

  describe('getCurrentSessionCount', () => {
    it('should return 0 when no sessions', () => {
      expect(tracker.getCurrentSessionCount('opus')).toBe(0);
      expect(tracker.getCurrentSessionCount('sonnet')).toBe(0);
    });

    it('should count opus sessions correctly', () => {
      // Default limit is 1, so only one can be reserved
      tracker.reserveCapacity('opus', 'session-1');

      expect(tracker.getCurrentSessionCount('opus')).toBe(1);
    });

    it('should count sonnet sessions correctly', () => {
      // Default limit is 2, so only two can be reserved
      tracker.reserveCapacity('sonnet', 'session-1');
      tracker.reserveCapacity('sonnet', 'session-2');

      expect(tracker.getCurrentSessionCount('sonnet')).toBe(2);
    });
  });

  describe('getAvailableCapacity', () => {
    it('should return full capacity when no sessions', () => {
      expect(tracker.getAvailableCapacity('opus')).toBe(1);
      expect(tracker.getAvailableCapacity('sonnet')).toBe(2);
    });

    it('should return remaining capacity for opus', () => {
      tracker.reserveCapacity('opus', 'session-1');

      expect(tracker.getAvailableCapacity('opus')).toBe(0);
    });

    it('should return remaining capacity for sonnet', () => {
      tracker.reserveCapacity('sonnet', 'session-1');

      expect(tracker.getAvailableCapacity('sonnet')).toBe(1);
    });
  });

  describe('getCapacityStats', () => {
    it('should return comprehensive stats', () => {
      tracker.reserveCapacity('opus', 'session-1');
      tracker.reserveCapacity('sonnet', 'session-2');

      const stats = tracker.getCapacityStats();

      expect(stats.opus.current).toBe(1);
      expect(stats.opus.limit).toBe(1);
      expect(stats.opus.available).toBe(0);
      expect(stats.opus.utilization).toBeCloseTo(1.0);

      expect(stats.sonnet.current).toBe(1);
      expect(stats.sonnet.limit).toBe(2);
      expect(stats.sonnet.available).toBe(1);
      expect(stats.sonnet.utilization).toBeCloseTo(0.5);
    });
  });

  describe('syncWithAgentManager', () => {
    it('should sync with active agent sessions', () => {
      const mockSessions = [
        { id: 'session-1', model: 'opus', status: 'running' },
        { id: 'session-2', model: 'sonnet', status: 'running' },
        { id: 'session-3', model: 'sonnet', status: 'blocked' },
      ];

      vi.mocked(mockAgentManager.getActiveSessions).mockReturnValue(mockSessions as any);

      tracker.syncWithAgentManager();

      expect(tracker.getCurrentSessionCount('opus')).toBe(1);
      expect(tracker.getCurrentSessionCount('sonnet')).toBe(2);
    });
  });

  describe('getCapacityWarning', () => {
    it('should return null when within safe limits (default config)', () => {
      const result = tracker.getCapacityWarning();
      expect(result).toBeNull();
    });

    it('should warn when opus limit exceeds 2', () => {
      const highOpusTracker = new CapacityTracker(mockAgentManager, {
        opusSessionLimit: 3,
        sonnetSessionLimit: 2,
      });
      const result = highOpusTracker.getCapacityWarning();
      expect(result).not.toBeNull();
      expect(result).toContain('Opus session limit');
      expect(result).toContain('HIGH CAPACITY WARNING');
    });

    it('should warn when sonnet limit exceeds 5', () => {
      const highSonnetTracker = new CapacityTracker(mockAgentManager, {
        opusSessionLimit: 1,
        sonnetSessionLimit: 6,
      });
      const result = highSonnetTracker.getCapacityWarning();
      expect(result).not.toBeNull();
      expect(result).toContain('Sonnet session limit');
    });

    it('should include both warnings when both limits exceeded', () => {
      const highTracker = new CapacityTracker(mockAgentManager, {
        opusSessionLimit: 5,
        sonnetSessionLimit: 10,
      });
      const result = highTracker.getCapacityWarning();
      expect(result).not.toBeNull();
      expect(result).toContain('Opus session limit');
      expect(result).toContain('Sonnet session limit');
    });
  });

  describe('event-driven capacity release', () => {
    it('should release capacity when agent error event fires', () => {
      const handlers: Record<string, (...args: unknown[]) => void> = {};
      const customManager = new AgentManager() as any;
      customManager.onEvent.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          handlers[event] = handler;
        }
      );
      customManager.getSession = vi.fn().mockReturnValue({ model: 'sonnet' });

      const newTracker = new CapacityTracker(customManager);
      newTracker.reserveCapacity('sonnet', 'err-session-1');
      expect(newTracker.getCurrentSessionCount('sonnet')).toBe(1);

      // Fire the error event handler — covers lines 136-142
      if (handlers['error']) {
        handlers['error']({ sessionId: 'err-session-1' });
      }

      expect(newTracker.getCurrentSessionCount('sonnet')).toBe(0);
    });

    it('should not throw when error event fires for unknown session', () => {
      const handlers: Record<string, (...args: unknown[]) => void> = {};
      const customManager = new AgentManager() as any;
      customManager.onEvent.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          handlers[event] = handler;
        }
      );
      customManager.getSession = vi.fn().mockReturnValue(null);

      new CapacityTracker(customManager);

      expect(() => {
        if (handlers['error']) {
          handlers['error']({ sessionId: 'unknown-session' });
        }
      }).not.toThrow();
    });
  });

  describe('reserveCapacity - idempotent for sonnet', () => {
    it('should return true when reserving already-reserved sonnet session', () => {
      tracker.reserveCapacity('sonnet', 'session-dup');
      // Second reservation of same session should return true (early return path)
      const result = tracker.reserveCapacity('sonnet', 'session-dup');
      expect(result).toBe(true);
      // Count should still be 1 (not doubled)
      expect(tracker.getCurrentSessionCount('sonnet')).toBe(1);
    });

    it('should return true when reserving already-reserved haiku session (uses sonnet pool)', () => {
      tracker.reserveCapacity('haiku', 'session-h1');
      const result = tracker.reserveCapacity('haiku', 'session-h1');
      expect(result).toBe(true);
      expect(tracker.getCurrentSessionCount('sonnet')).toBe(1);
    });
  });

  describe('getTrackedSessions', () => {
    it('should return empty array when no opus sessions', () => {
      const sessions = tracker.getTrackedSessions('opus');
      expect(sessions).toEqual([]);
    });

    it('should return opus session IDs', () => {
      tracker.reserveCapacity('opus', 'opus-session-1');
      const sessions = tracker.getTrackedSessions('opus');
      expect(sessions).toContain('opus-session-1');
      expect(sessions).toHaveLength(1);
    });

    it('should return empty array when no sonnet sessions', () => {
      const sessions = tracker.getTrackedSessions('sonnet');
      expect(sessions).toEqual([]);
    });

    it('should return sonnet session IDs', () => {
      tracker.reserveCapacity('sonnet', 'sonnet-session-1');
      tracker.reserveCapacity('sonnet', 'sonnet-session-2');
      const sessions = tracker.getTrackedSessions('sonnet');
      expect(sessions).toContain('sonnet-session-1');
      expect(sessions).toContain('sonnet-session-2');
      expect(sessions).toHaveLength(2);
    });

    it('should return sonnet pool sessions for haiku model', () => {
      tracker.reserveCapacity('haiku', 'haiku-session-1');
      // haiku uses sonnet pool
      const sessions = tracker.getTrackedSessions('haiku');
      expect(sessions).toContain('haiku-session-1');
    });
  });
});
