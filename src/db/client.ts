import { createClient, SupabaseClient } from '@supabase/supabase-js';
export type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logging/index.js';

const log = logger.child('Database');

let client: SupabaseClient | null = null;

/**
 * Creates or returns the singleton Supabase client instance.
 * Uses SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.
 * @throws Error if environment variables are not set
 */
export function createSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    log.error('Missing required environment variables', {
      hasUrl: !!url,
      hasKey: !!key
    });
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  }

  client = createClient(url, key);
  log.info('Supabase client created successfully');
  return client;
}

/**
 * Resets the client singleton. Used for testing.
 */
export function resetClient(): void {
  client = null;
  log.debug('Supabase client reset');
}

/**
 * Tests the database connection by attempting a simple query.
 * Returns success even if the table doesn't exist (schema not applied yet),
 * but fails on actual connection errors.
 */
export async function testConnection(): Promise<{ success: boolean; error?: string }> {
  log.time('connection-test');
  try {
    const supabase = createSupabaseClient();
    const { error } = await supabase.from('tc_projects').select('count').limit(1);

    // Table might not exist yet, but connection worked if no network error
    // Handle various "table not found" error messages from Supabase
    if (error) {
      const errorMsg = error.message.toLowerCase();
      const isTableNotFound =
        errorMsg.includes('does not exist') ||
        errorMsg.includes('relation') ||
        errorMsg.includes('could not find the table') ||
        errorMsg.includes('schema cache');

      if (!isTableNotFound) {
        log.timeEnd('connection-test', { success: false });
        log.error('Database connection test failed', { error: error.message });
        return { success: false, error: error.message };
      }
      // Table not found is okay - means connection works but schema not applied
      log.debug('Connection test: schema not applied yet', { error: error.message });
    }

    log.timeEnd('connection-test', { success: true });
    log.info('Database connection test passed');
    return { success: true };
  } catch (err) {
    log.timeEnd('connection-test', { success: false });
    // Properly handle different error types
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error('Database connection test threw exception', err instanceof Error ? err : undefined, {
      error: errorMessage
    });
    return { success: false, error: errorMessage };
  }
}

/**
 * Gets the Supabase client, creating it if necessary.
 * Alias for createSupabaseClient for semantic clarity.
 */
export function getClient(): SupabaseClient {
  return createSupabaseClient();
}

/**
 * Health check result interface
 */
export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Default health check timeout in milliseconds
 */
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Performs a health check on the Supabase connection.
 * Runs a simple query with a timeout to verify database connectivity.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Health check result with status, latency, and any error
 */
export async function checkHealth(timeoutMs: number = DEFAULT_HEALTH_CHECK_TIMEOUT_MS): Promise<HealthCheckResult> {
  const startTime = Date.now();
  log.time('health-check');

  try {
    const supabase = createSupabaseClient();

    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Health check timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    // Run a simple query - SELECT 1 via raw SQL through RPC or a simple table query
    const queryPromise = supabase.from('tc_projects').select('id').limit(1);

    // Race between the query and timeout
    const { error } = await Promise.race([queryPromise, timeoutPromise]);

    const latencyMs = Date.now() - startTime;
    log.timeEnd('health-check', { latencyMs });

    if (error) {
      // Check if it's a "table not found" error - that means DB is reachable but schema not applied
      const errorMsg = error.message.toLowerCase();
      const isTableNotFound =
        errorMsg.includes('does not exist') ||
        errorMsg.includes('relation') ||
        errorMsg.includes('could not find the table') ||
        errorMsg.includes('schema cache');

      if (isTableNotFound) {
        // Database is reachable, just schema issue
        log.debug('Health check passed (schema not applied)', { latencyMs });
        return { healthy: true, latencyMs };
      }

      log.warn('Health check failed', { latencyMs, error: error.message });
      return { healthy: false, latencyMs, error: error.message };
    }

    log.info('Database health check passed', { latencyMs });
    return { healthy: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    log.timeEnd('health-check', { latencyMs, success: false });
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error('Health check threw exception', err instanceof Error ? err : undefined, { latencyMs });
    return { healthy: false, latencyMs, error: errorMessage };
  }
}

/**
 * Retry configuration for database operations
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Calculates the delay for a retry attempt using exponential backoff with jitter
 *
 * @param attempt - The current attempt number (0-based)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const delay = Math.min(baseDelay, config.maxDelayMs);
  // Add jitter (0-25% of delay)
  const jitter = Math.random() * delay * 0.25;
  return Math.floor(delay + jitter);
}

/**
 * Waits for the database to become healthy with exponential backoff
 *
 * @param config - Retry configuration
 * @param onRetry - Optional callback invoked before each retry
 * @returns Health check result from the successful attempt or the last failed attempt
 */
export async function waitForHealthy(
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (attempt: number, delay: number, lastError?: string) => void
): Promise<HealthCheckResult> {
  let lastResult: HealthCheckResult = { healthy: false, latencyMs: 0, error: 'No attempts made' };

  log.info('Waiting for database to become healthy', { maxRetries: config.maxRetries });

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    lastResult = await checkHealth();

    if (lastResult.healthy) {
      if (attempt > 0) {
        log.info('Database connection recovered', { attempts: attempt + 1, latencyMs: lastResult.latencyMs });
      }
      return lastResult;
    }

    if (attempt < config.maxRetries) {
      const delay = calculateRetryDelay(attempt, config);
      log.warn('Database health check failed, retrying', {
        attempt: attempt + 1,
        maxRetries: config.maxRetries,
        delayMs: delay,
        error: lastResult.error
      });
      if (onRetry) {
        onRetry(attempt + 1, delay, lastResult.error);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  log.error('Database failed to become healthy after all retries', {
    attempts: config.maxRetries + 1,
    lastError: lastResult.error
  });

  return lastResult;
}
