import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseHealthMonitor } from './database-health-monitor.js';
import type { EventBus } from '../events/event-bus.js';
import type { HealthCheckResult } from '../db/client.js';

// Mock the db/client module
vi.mock('../db/client.js', () => ({
  checkHealth: vi.fn(),
  waitForHealthy: vi.fn(),
}));

// Import mocked functions
import { checkHealth, waitForHealthy } from '../db/client.js';

describe('DatabaseHealthMonitor', () => {
  let mockEventBus: EventBus;
  let monitor: DatabaseHealthMonitor;

  const defaultConfig = {
    maxConsecutiveDbFailures: 3,
    dbRetryConfig: {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      timeoutMs: 5000,
    },
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock event bus
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };

    // Create monitor instance with default config
    monitor = new DatabaseHealthMonitor(defaultConfig, mockEventBus);
  });

  describe('Constructor and State', () => {
    it('should initialize with config and eventBus', () => {
      expect(monitor).toBeDefined();
      expect(monitor).toBeInstanceOf(DatabaseHealthMonitor);
    });

    it('should start in healthy state', () => {
      expect(monitor.isDegraded()).toBe(false);
    });

    it('should start with zero consecutive failures', () => {
      const stats = monitor.getStats();
      expect(stats.consecutiveFailures).toBe(0);
    });

    it('should return correct initial state from getStats', () => {
      const stats = monitor.getStats();
      expect(stats).toEqual({
        healthy: true,
        consecutiveFailures: 0,
        lastHealthyAt: undefined,
        lastError: undefined,
      });
    });
  });

  describe('Failure Tracking', () => {
    it('should increment consecutive failure counter on failure', () => {
      const error = new Error('Database connection failed');
      monitor.onDbFailure(error);

      const stats = monitor.getStats();
      expect(stats.consecutiveFailures).toBe(1);
    });

    it('should store last error message on failure', () => {
      const error = new Error('Connection timeout');
      monitor.onDbFailure(error);

      const stats = monitor.getStats();
      expect(stats.lastError).toBe('Connection timeout');
    });

    it('should NOT enter degraded mode before threshold', () => {
      const error = new Error('Database error');

      // Fail twice (threshold is 3)
      monitor.onDbFailure(error);
      monitor.onDbFailure(error);

      expect(monitor.isDegraded()).toBe(false);
    });

    it('should enter degraded mode at threshold', () => {
      const error = new Error('Database error');

      // Fail 3 times (threshold is 3)
      monitor.onDbFailure(error);
      monitor.onDbFailure(error);
      monitor.onDbFailure(error);

      expect(monitor.isDegraded()).toBe(true);
    });

    it('should reset consecutive failures to 0 on success', () => {
      const error = new Error('Database error');

      // Fail twice
      monitor.onDbFailure(error);
      monitor.onDbFailure(error);

      // Then succeed
      monitor.onDbSuccess();

      const stats = monitor.getStats();
      expect(stats.consecutiveFailures).toBe(0);
    });

    it('should clear last error on success', () => {
      const error = new Error('Database error');
      monitor.onDbFailure(error);

      monitor.onDbSuccess();

      const stats = monitor.getStats();
      expect(stats.lastError).toBeUndefined();
    });
  });

  describe('Degraded Mode', () => {
    it('should enter degraded mode after N consecutive failures', () => {
      const error = new Error('Database error');

      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      expect(monitor.isDegraded()).toBe(true);
    });

    it('should return healthy=false when degraded', () => {
      const error = new Error('Database error');

      // Trigger degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      const stats = monitor.getStats();
      expect(stats.healthy).toBe(false);
    });

    it('should emit database:degraded event when entering degraded mode', () => {
      const error = new Error('Database error');

      // Trigger degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'database:degraded',
          payload: expect.objectContaining({
            error: 'Database error',
            retryCount: defaultConfig.maxConsecutiveDbFailures,
          }),
        })
      );
    });

    it('should exit degraded mode on first success after degraded', () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }
      expect(monitor.isDegraded()).toBe(true);

      // Recover
      monitor.onDbSuccess();
      expect(monitor.isDegraded()).toBe(false);
    });

    it('should emit database:recovered event when exiting degraded mode', () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      // Clear previous emit calls
      vi.clearAllMocks();

      // Recover
      monitor.onDbSuccess();

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'database:recovered',
          payload: expect.objectContaining({
            downtimeMs: expect.any(Number),
          }),
        })
      );
    });

    it('should not re-emit database:degraded if already degraded', () => {
      const error = new Error('Database error');

      // Enter degraded mode (3 failures)
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      // Clear previous calls
      const emitCountAfterDegraded = (mockEventBus.emit as any).mock.calls.length;
      vi.clearAllMocks();

      // Fail again while already degraded
      monitor.onDbFailure(error);

      // Should NOT emit another degraded event
      const degradedEvents = (mockEventBus.emit as any).mock.calls.filter(
        (call: any) => call[0]?.type === 'database:degraded'
      );
      expect(degradedEvents.length).toBe(0);
    });
  });

  describe('Event Emissions', () => {
    it('should emit database:healthy on recordStartupHealthy with latencyMs', () => {
      monitor.recordStartupHealthy(42);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'database:healthy',
          payload: { latencyMs: 42 },
        })
      );
    });

    it('should emit database:degraded with correct payload', () => {
      const error = new Error('Connection refused');

      // Trigger degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'database:degraded',
          payload: expect.objectContaining({
            error: 'Connection refused',
            retryCount: defaultConfig.maxConsecutiveDbFailures,
          }),
        })
      );
    });

    it('should emit database:recovered with latencyMs and downtimeMs', () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      vi.clearAllMocks();

      // Recover
      monitor.onDbSuccess();

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'database:recovered',
          payload: expect.objectContaining({
            latencyMs: expect.any(Number),
            downtimeMs: expect.any(Number),
          }),
        })
      );
    });

    it('should not emit events if eventBus is null', () => {
      const monitorWithoutBus = new DatabaseHealthMonitor(defaultConfig, null);

      // These should not throw
      monitorWithoutBus.recordStartupHealthy(10);

      const error = new Error('Database error');
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitorWithoutBus.onDbFailure(error);
      }

      monitorWithoutBus.onDbSuccess();

      // Event bus should never have been called
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should emit events with correct payload structure', () => {
      monitor.recordStartupHealthy(100);

      const call = (mockEventBus.emit as any).mock.calls[0][0];
      expect(call).toHaveProperty('type');
      expect(call).toHaveProperty('payload');
      expect(call).toHaveProperty('timestamp');
      expect(call.type).toBe('database:healthy');
    });
  });

  describe('Error Detection', () => {
    it('should detect supabase errors', () => {
      const error = new Error('Supabase connection failed');
      expect(monitor.isDbError(error)).toBe(true);
    });

    it('should detect database errors', () => {
      const error = new Error('Database query failed');
      expect(monitor.isDbError(error)).toBe(true);
    });

    it('should detect connection errors', () => {
      const error = new Error('Connection lost');
      expect(monitor.isDbError(error)).toBe(true);
    });

    it('should detect network errors', () => {
      const error = new Error('Network timeout');
      expect(monitor.isDbError(error)).toBe(true);
    });

    it('should detect timeout errors', () => {
      const error = new Error('Request timeout');
      expect(monitor.isDbError(error)).toBe(true);
    });

    it('should detect ECONNREFUSED errors', () => {
      const error = new Error('ECONNREFUSED: connection refused');
      expect(monitor.isDbError(error)).toBe(true);
    });

    it('should detect ENOTFOUND errors', () => {
      const error = new Error('ENOTFOUND: host not found');
      expect(monitor.isDbError(error)).toBe(true);
    });

    it('should return false for non-database errors', () => {
      const error = new Error('Invalid user input');
      expect(monitor.isDbError(error)).toBe(false);
    });

    it('should return false for non-Error objects', () => {
      expect(monitor.isDbError('string error')).toBe(false);
      expect(monitor.isDbError({ message: 'database error' })).toBe(false);
      expect(monitor.isDbError(null)).toBe(false);
      expect(monitor.isDbError(undefined)).toBe(false);
    });
  });

  describe('Recovery', () => {
    beforeEach(() => {
      // Mock checkHealth to return healthy by default
      (checkHealth as any).mockResolvedValue({
        healthy: true,
        latencyMs: 50,
      } as HealthCheckResult);
    });

    it('should call checkHealth on attemptDbRecovery', async () => {
      await monitor.attemptDbRecovery();
      expect(checkHealth).toHaveBeenCalled();
    });

    it('should reset consecutiveFailures on successful recovery', async () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      await monitor.attemptDbRecovery();

      const stats = monitor.getStats();
      expect(stats.consecutiveFailures).toBe(0);
    });

    it('should clear lastError on successful recovery', async () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      await monitor.attemptDbRecovery();

      const stats = monitor.getStats();
      expect(stats.lastError).toBeUndefined();
    });

    it('should set lastDbHealthyAt on successful recovery', async () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      await monitor.attemptDbRecovery();

      const stats = monitor.getStats();
      expect(stats.lastHealthyAt).toBeInstanceOf(Date);
    });

    it('should exit degraded mode on successful recovery', async () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }
      expect(monitor.isDegraded()).toBe(true);

      await monitor.attemptDbRecovery();

      expect(monitor.isDegraded()).toBe(false);
    });

    it('should emit database:recovered on successful recovery', async () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      vi.clearAllMocks();

      await monitor.attemptDbRecovery();

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'database:recovered',
          payload: expect.objectContaining({
            latencyMs: 50,
            downtimeMs: expect.any(Number),
          }),
        })
      );
    });

    it('should keep degraded mode active on failed recovery', async () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      // Mock unhealthy response
      (checkHealth as any).mockResolvedValue({
        healthy: false,
        latencyMs: 0,
        error: 'Still down',
      } as HealthCheckResult);

      await monitor.attemptDbRecovery();

      expect(monitor.isDegraded()).toBe(true);
    });

    it('should clear degraded state on reset', () => {
      const error = new Error('Database error');

      // Enter degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }
      expect(monitor.isDegraded()).toBe(true);

      monitor.reset();

      expect(monitor.isDegraded()).toBe(false);
    });

    it('should reset consecutive failures on reset', () => {
      const error = new Error('Database error');
      monitor.onDbFailure(error);
      monitor.onDbFailure(error);

      monitor.reset();

      const stats = monitor.getStats();
      expect(stats.consecutiveFailures).toBe(0);
    });
  });

  describe('Startup Validation', () => {
    beforeEach(() => {
      (waitForHealthy as any).mockResolvedValue({
        healthy: true,
        latencyMs: 100,
      } as HealthCheckResult);
    });

    it('should call waitForHealthy with correct retry config', async () => {
      await monitor.validateOnStartup();

      expect(waitForHealthy).toHaveBeenCalledWith(
        defaultConfig.dbRetryConfig,
        expect.any(Function)
      );
    });

    it('should pass retry callback to waitForHealthy', async () => {
      await monitor.validateOnStartup();

      const callArgs = (waitForHealthy as any).mock.calls[0];
      expect(callArgs[1]).toBeTypeOf('function');
    });

    it('should set lastDbHealthyAt on recordStartupHealthy', () => {
      monitor.recordStartupHealthy(50);

      const stats = monitor.getStats();
      expect(stats.lastHealthyAt).toBeInstanceOf(Date);
    });

    it('should emit database:healthy event on recordStartupHealthy', () => {
      monitor.recordStartupHealthy(75);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'database:healthy',
          payload: { latencyMs: 75 },
        })
      );
    });
  });

  describe('Statistics', () => {
    it('should return healthy=true initially', () => {
      const stats = monitor.getStats();
      expect(stats.healthy).toBe(true);
    });

    it('should return healthy=false when degraded', () => {
      const error = new Error('Database error');

      // Trigger degraded mode
      for (let i = 0; i < defaultConfig.maxConsecutiveDbFailures; i++) {
        monitor.onDbFailure(error);
      }

      const stats = monitor.getStats();
      expect(stats.healthy).toBe(false);
    });

    it('should return correct consecutiveFailures count', () => {
      const error = new Error('Database error');
      monitor.onDbFailure(error);
      monitor.onDbFailure(error);

      const stats = monitor.getStats();
      expect(stats.consecutiveFailures).toBe(2);
    });

    it('should return lastHealthyAt after success', () => {
      monitor.onDbSuccess();

      const stats = monitor.getStats();
      expect(stats.lastHealthyAt).toBeInstanceOf(Date);
    });

    it('should return lastError after failure', () => {
      const error = new Error('Test error');
      monitor.onDbFailure(error);

      const stats = monitor.getStats();
      expect(stats.lastError).toBe('Test error');
    });

    it('should convert null lastHealthyAt to undefined', () => {
      const stats = monitor.getStats();
      expect(stats.lastHealthyAt).toBeUndefined();
    });

    it('should convert null lastError to undefined', () => {
      const stats = monitor.getStats();
      expect(stats.lastError).toBeUndefined();
    });
  });
});
