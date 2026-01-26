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
    return { success: false, error: String(err) };
  }
}

/**
 * Gets the Supabase client, creating it if necessary.
 * Alias for createSupabaseClient for semantic clarity.
 */
export function getClient(): SupabaseClient {
  return createSupabaseClient();
}
