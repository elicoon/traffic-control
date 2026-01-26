import { describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseClient, testConnection, resetClient } from './client.js';

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
});
