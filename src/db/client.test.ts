import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createSupabaseClient,
  testConnection,
  resetClient,
  checkHealth,
  waitForHealthy,
  calculateRetryDelay,
  DEFAULT_RETRY_CONFIG,
} from './client.js';

describe('Supabase Client', () => {
  beforeEach(() => {
    // Reset client between tests to ensure clean state
    resetClient();
  });

  it('should create a client instance', () => {
    const client = createSupabaseClient();
    expect(client).toBeDefined();
  });

  it('should return same client instance on multiple calls', () => {
    const client1 = createSupabaseClient();
    const client2 = createSupabaseClient();
    expect(client1).toBe(client2);
  });

  it('should connect to database', async () => {
    const result = await testConnection();
    expect(result.success).toBe(true);
  });

  it('should return failure when query returns non-table-not-found error', async () => {
    const client = createSupabaseClient();
    const fromSpy = vi.spyOn(client, 'from').mockReturnValue({
      select: () => ({
        limit: () => Promise.resolve({
          data: null,
          error: { message: 'permission denied for table tc_projects' },
        }),
      }),
    } as any);

    const result = await testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toContain('permission denied');
    fromSpy.mockRestore();
  });

  it('should return failure when connection throws an exception', async () => {
    const client = createSupabaseClient();
    const fromSpy = vi.spyOn(client, 'from').mockImplementation(() => {
      throw new Error('network unreachable');
    });

    const result = await testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toContain('network unreachable');
    fromSpy.mockRestore();
  });

  it('should throw error when environment variables are missing', () => {
    // Store original values
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_KEY;

    // Reset client and clear env vars
    resetClient();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;

    expect(() => createSupabaseClient()).toThrow('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');

    // Restore env vars
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_KEY = originalKey;
    resetClient();
  });
});

describe('Health Check', () => {
  beforeEach(() => {
    resetClient();
  });

  describe('checkHealth', () => {
    it('should return healthy status when database is reachable', async () => {
      const result = await checkHealth();

      expect(result).toHaveProperty('healthy');
      expect(result).toHaveProperty('latencyMs');
      expect(typeof result.latencyMs).toBe('number');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      // If healthy, no error should be present
      if (result.healthy) {
        expect(result.error).toBeUndefined();
      }
    });

    it('should measure latency accurately', async () => {
      const result = await checkHealth();

      // Latency should be reasonable (less than 10 seconds)
      expect(result.latencyMs).toBeLessThan(10000);
    });

    it('should handle timeout parameter', async () => {
      // Very short timeout might fail, but should not hang
      const startTime = Date.now();
      const result = await checkHealth(100); // 100ms timeout
      const elapsed = Date.now() - startTime;

      // Should complete within reasonable time (timeout + overhead)
      expect(elapsed).toBeLessThan(5000);
      expect(result).toHaveProperty('healthy');
    });

    it('should return error details when unhealthy', async () => {
      // Store original values
      const originalUrl = process.env.SUPABASE_URL;
      const originalKey = process.env.SUPABASE_SERVICE_KEY;

      // Set invalid credentials
      resetClient();
      process.env.SUPABASE_URL = 'https://invalid.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'invalid-key';

      const result = await checkHealth(2000);

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');

      // Restore env vars
      process.env.SUPABASE_URL = originalUrl;
      process.env.SUPABASE_SERVICE_KEY = originalKey;
      resetClient();
    });

    it('should return healthy when DB reports table-not-found (schema not applied)', async () => {
      const client = createSupabaseClient();
      const fromSpy = vi.spyOn(client, 'from').mockReturnValue({
        select: () => ({
          limit: () => Promise.resolve({
            data: null,
            error: { message: 'relation "tc_projects" does not exist' },
          }),
        }),
      } as any);

      const result = await checkHealth();

      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      fromSpy.mockRestore();
    });

    it('should catch exceptions thrown by client creation and return unhealthy', async () => {
      const originalUrl = process.env.SUPABASE_URL;
      const originalKey = process.env.SUPABASE_SERVICE_KEY;

      resetClient();
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;

      const result = await checkHealth();

      expect(result.healthy).toBe(false);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');

      // Restore
      process.env.SUPABASE_URL = originalUrl;
      process.env.SUPABASE_SERVICE_KEY = originalKey;
      resetClient();
    });
  });

  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff', () => {
      const config = {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      };

      // Delays should increase exponentially (with some jitter)
      const delay0 = calculateRetryDelay(0, config);
      const delay1 = calculateRetryDelay(1, config);
      const delay2 = calculateRetryDelay(2, config);

      // Base delays without jitter would be: 1000, 2000, 4000
      // With up to 25% jitter, ranges are: [1000, 1250], [2000, 2500], [4000, 5000]
      expect(delay0).toBeGreaterThanOrEqual(1000);
      expect(delay0).toBeLessThanOrEqual(1250);

      expect(delay1).toBeGreaterThanOrEqual(2000);
      expect(delay1).toBeLessThanOrEqual(2500);

      expect(delay2).toBeGreaterThanOrEqual(4000);
      expect(delay2).toBeLessThanOrEqual(5000);
    });

    it('should cap delay at maxDelayMs', () => {
      const config = {
        maxRetries: 10,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 3,
      };

      // After several retries, should be capped at max
      const delay = calculateRetryDelay(10, config);
      expect(delay).toBeLessThanOrEqual(5000 * 1.25); // Max + jitter
    });

    it('should use default config when not provided', () => {
      const delay = calculateRetryDelay(0);
      expect(delay).toBeGreaterThanOrEqual(DEFAULT_RETRY_CONFIG.initialDelayMs);
    });
  });

  describe('waitForHealthy', () => {
    it('should return immediately if database is healthy', async () => {
      const startTime = Date.now();
      const result = await waitForHealthy({
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
      });
      const elapsed = Date.now() - startTime;

      if (result.healthy) {
        // Should return quickly if healthy
        expect(elapsed).toBeLessThan(5000);
      }

      expect(result).toHaveProperty('healthy');
      expect(result).toHaveProperty('latencyMs');
    });

    it('should call onRetry callback on retry attempts', async () => {
      const onRetry = vi.fn();

      // Store original values
      const originalUrl = process.env.SUPABASE_URL;
      const originalKey = process.env.SUPABASE_SERVICE_KEY;

      // Set invalid credentials to force retries
      resetClient();
      process.env.SUPABASE_URL = 'https://invalid.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'invalid-key';

      await waitForHealthy(
        {
          maxRetries: 2,
          initialDelayMs: 50,
          maxDelayMs: 100,
          backoffMultiplier: 1.5,
        },
        onRetry
      );

      // Should have called onRetry for each retry attempt
      expect(onRetry).toHaveBeenCalled();

      // Restore env vars
      process.env.SUPABASE_URL = originalUrl;
      process.env.SUPABASE_SERVICE_KEY = originalKey;
      resetClient();
    });

    it('should return last failed result after all retries exhausted', async () => {
      // Store original values
      const originalUrl = process.env.SUPABASE_URL;
      const originalKey = process.env.SUPABASE_SERVICE_KEY;

      // Set invalid credentials
      resetClient();
      process.env.SUPABASE_URL = 'https://invalid.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'invalid-key';

      const result = await waitForHealthy({
        maxRetries: 1,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffMultiplier: 1,
      });

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();

      // Restore env vars
      process.env.SUPABASE_URL = originalUrl;
      process.env.SUPABASE_SERVICE_KEY = originalKey;
      resetClient();
    });

    it('should log recovery when database becomes healthy after a failed attempt', async () => {
      const client = createSupabaseClient();

      let callCount = 0;
      const fromSpy = vi.spyOn(client, 'from').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            select: () => ({
              limit: () => Promise.resolve({
                data: null,
                error: { message: 'temporary connection error' },
              }),
            }),
          } as any;
        }
        return {
          select: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        } as any;
      });

      const result = await waitForHealthy({
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffMultiplier: 1,
      });

      expect(result.healthy).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(2);
      fromSpy.mockRestore();
    });
  });
});
