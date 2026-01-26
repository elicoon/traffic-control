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
      expect(config.opusSessionLimit).toBe(5);
      expect(config.sonnetSessionLimit).toBe(10);
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
      // Reserve all opus slots
      for (let i = 0; i < 5; i++) {
        tracker.reserveCapacity('opus', `session-${i}`);
      }

      expect(tracker.hasCapacity('opus')).toBe(false);
      expect(tracker.hasCapacity('sonnet')).toBe(true);
    });

    it('should return false when at sonnet capacity', () => {
      // Reserve all sonnet slots
      for (let i = 0; i < 10; i++) {
        tracker.reserveCapacity('sonnet', `session-${i}`);
      }

      expect(tracker.hasCapacity('opus')).toBe(true);
      expect(tracker.hasCapacity('sonnet')).toBe(false);
    });

    it('should handle haiku model (uses sonnet capacity)', () => {
      expect(tracker.hasCapacity('haiku')).toBe(true);

      // Fill sonnet capacity
      for (let i = 0; i < 10; i++) {
        tracker.reserveCapacity('sonnet', `session-${i}`);
      }

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
      // Fill opus capacity
      for (let i = 0; i < 5; i++) {
        tracker.reserveCapacity('opus', `session-${i}`);
      }

      const result = tracker.reserveCapacity('opus', 'session-overflow');
      expect(result).toBe(false);
      expect(tracker.getCurrentSessionCount('opus')).toBe(5);
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
      tracker.reserveCapacity('opus', 'session-1');
      tracker.reserveCapacity('opus', 'session-2');

      expect(tracker.getCurrentSessionCount('opus')).toBe(2);
    });

    it('should count sonnet sessions correctly', () => {
      tracker.reserveCapacity('sonnet', 'session-1');
      tracker.reserveCapacity('sonnet', 'session-2');
      tracker.reserveCapacity('sonnet', 'session-3');

      expect(tracker.getCurrentSessionCount('sonnet')).toBe(3);
    });
  });

  describe('getAvailableCapacity', () => {
    it('should return full capacity when no sessions', () => {
      expect(tracker.getAvailableCapacity('opus')).toBe(5);
      expect(tracker.getAvailableCapacity('sonnet')).toBe(10);
    });

    it('should return remaining capacity for opus', () => {
      tracker.reserveCapacity('opus', 'session-1');
      tracker.reserveCapacity('opus', 'session-2');

      expect(tracker.getAvailableCapacity('opus')).toBe(3);
    });

    it('should return remaining capacity for sonnet', () => {
      tracker.reserveCapacity('sonnet', 'session-1');

      expect(tracker.getAvailableCapacity('sonnet')).toBe(9);
    });
  });

  describe('getCapacityStats', () => {
    it('should return comprehensive stats', () => {
      tracker.reserveCapacity('opus', 'session-1');
      tracker.reserveCapacity('sonnet', 'session-2');
      tracker.reserveCapacity('sonnet', 'session-3');

      const stats = tracker.getCapacityStats();

      expect(stats.opus.current).toBe(1);
      expect(stats.opus.limit).toBe(5);
      expect(stats.opus.available).toBe(4);
      expect(stats.opus.utilization).toBeCloseTo(0.2);

      expect(stats.sonnet.current).toBe(2);
      expect(stats.sonnet.limit).toBe(10);
      expect(stats.sonnet.available).toBe(8);
      expect(stats.sonnet.utilization).toBeCloseTo(0.2);
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
});
