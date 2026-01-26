import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  }

  client = createClient(url, key);
  return client;
}

/**
 * Resets the client singleton. Used for testing.
 */
export function resetClient(): void {
  client = null;
}

/**
 * Tests the database connection by attempting a simple query.
 * Returns success even if the table doesn't exist (schema not applied yet),
 * but fails on actual connection errors.
 */
export async function testConnection(): Promise<{ success: boolean; error?: string }> {
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
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  } catch (err) {
    // Properly handle different error types
    const errorMessage = err instanceof Error ? err.message : String(err);
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
        return { healthy: true, latencyMs };
      }

      return { healthy: false, latencyMs, error: error.message };
    }

    return { healthy: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
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

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    lastResult = await checkHealth();

    if (lastResult.healthy) {
      return lastResult;
    }

    if (attempt < config.maxRetries) {
      const delay = calculateRetryDelay(attempt, config);
      if (onRetry) {
        onRetry(attempt + 1, delay, lastResult.error);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return lastResult;
}
