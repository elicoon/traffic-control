import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Usage log entry from the database
 */
export interface UsageLog {
  id: string;
  session_id: string;
  task_id: string | null;
  model: 'opus' | 'sonnet' | 'haiku';
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  event_type: 'completion' | 'error' | 'partial';
  created_at: string;
}

/**
 * Input for creating a new usage log entry
 */
export interface CreateUsageLogInput {
  session_id: string;
  task_id?: string | null;
  model: 'opus' | 'sonnet' | 'haiku';
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_usd?: number;
  event_type: 'completion' | 'error' | 'partial';
}

/**
 * Aggregated usage statistics
 */
export interface UsageStats {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  session_count: number;
  by_model: {
    opus: { tokens: number; cost: number; sessions: number };
    sonnet: { tokens: number; cost: number; sessions: number };
    haiku: { tokens: number; cost: number; sessions: number };
  };
}

/**
 * Repository for managing usage logs in tc_usage_log table
 */
export class UsageLogRepository {
  constructor(private client: SupabaseClient) {}

  /**
   * Create a new usage log entry
   */
  async create(input: CreateUsageLogInput): Promise<UsageLog> {
    const { data, error } = await this.client
      .from('tc_usage_log')
      .insert({
        session_id: input.session_id,
        task_id: input.task_id ?? null,
        model: input.model,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        cache_read_tokens: input.cache_read_tokens ?? 0,
        cache_creation_tokens: input.cache_creation_tokens ?? 0,
        cost_usd: input.cost_usd ?? 0,
        event_type: input.event_type,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create usage log: ${error.message}`);
    return data as UsageLog;
  }

  /**
   * Get usage logs by session ID
   */
  async getBySessionId(sessionId: string): Promise<UsageLog[]> {
    const { data, error } = await this.client
      .from('tc_usage_log')
      .select()
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Failed to get usage logs: ${error.message}`);
    return data as UsageLog[];
  }

  /**
   * Get usage logs by task ID
   */
  async getByTaskId(taskId: string): Promise<UsageLog[]> {
    const { data, error } = await this.client
      .from('tc_usage_log')
      .select()
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Failed to get usage logs: ${error.message}`);
    return data as UsageLog[];
  }

  /**
   * Get total usage for a session
   */
  async getTotalUsageBySession(sessionId: string): Promise<{
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  }> {
    const logs = await this.getBySessionId(sessionId);

    const totals = logs.reduce(
      (acc, log) => ({
        inputTokens: acc.inputTokens + log.input_tokens,
        outputTokens: acc.outputTokens + log.output_tokens,
        totalTokens: acc.totalTokens + log.input_tokens + log.output_tokens,
        costUSD: acc.costUSD + log.cost_usd,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 }
    );

    return totals;
  }

  /**
   * Get aggregated usage statistics for a time range
   */
  async getStats(startDate?: Date, endDate?: Date): Promise<UsageStats> {
    let query = this.client.from('tc_usage_log').select('*');

    if (startDate) {
      query = query.gte('created_at', startDate.toISOString());
    }
    if (endDate) {
      query = query.lte('created_at', endDate.toISOString());
    }

    const { data, error } = await query;

    if (error) throw new Error(`Failed to get usage stats: ${error.message}`);

    const logs = data as UsageLog[];

    // Initialize stats
    const stats: UsageStats = {
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      session_count: new Set(logs.map(l => l.session_id)).size,
      by_model: {
        opus: { tokens: 0, cost: 0, sessions: 0 },
        sonnet: { tokens: 0, cost: 0, sessions: 0 },
        haiku: { tokens: 0, cost: 0, sessions: 0 },
      },
    };

    // Track unique sessions per model
    const sessionsByModel = {
      opus: new Set<string>(),
      sonnet: new Set<string>(),
      haiku: new Set<string>(),
    };

    // Aggregate
    for (const log of logs) {
      const tokens = log.input_tokens + log.output_tokens;

      stats.total_input_tokens += log.input_tokens;
      stats.total_output_tokens += log.output_tokens;
      stats.total_tokens += tokens;
      stats.total_cost_usd += log.cost_usd;

      if (log.model in stats.by_model) {
        stats.by_model[log.model].tokens += tokens;
        stats.by_model[log.model].cost += log.cost_usd;
        sessionsByModel[log.model].add(log.session_id);
      }
    }

    // Set session counts per model
    stats.by_model.opus.sessions = sessionsByModel.opus.size;
    stats.by_model.sonnet.sessions = sessionsByModel.sonnet.size;
    stats.by_model.haiku.sessions = sessionsByModel.haiku.size;

    return stats;
  }

  /**
   * Get recent usage logs with pagination
   */
  async getRecent(limit: number = 100, offset: number = 0): Promise<UsageLog[]> {
    const { data, error } = await this.client
      .from('tc_usage_log')
      .select()
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to get recent usage logs: ${error.message}`);
    return data as UsageLog[];
  }

  /**
   * Delete usage logs older than a specified date
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const { data, error } = await this.client
      .from('tc_usage_log')
      .delete()
      .lt('created_at', date.toISOString())
      .select('id');

    if (error) throw new Error(`Failed to delete old usage logs: ${error.message}`);
    return (data as { id: string }[]).length;
  }

  /**
   * Get daily usage summary for a date range
   */
  async getDailySummary(
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ date: string; tokens: number; cost: number; sessions: number }>> {
    const { data, error } = await this.client
      .from('tc_usage_log')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Failed to get daily summary: ${error.message}`);

    const logs = data as UsageLog[];

    // Group by date
    const byDate = new Map<string, { tokens: number; cost: number; sessions: Set<string> }>();

    for (const log of logs) {
      const date = log.created_at.split('T')[0];
      const existing = byDate.get(date) || { tokens: 0, cost: 0, sessions: new Set<string>() };

      existing.tokens += log.input_tokens + log.output_tokens;
      existing.cost += log.cost_usd;
      existing.sessions.add(log.session_id);

      byDate.set(date, existing);
    }

    // Convert to array
    return Array.from(byDate.entries()).map(([date, data]) => ({
      date,
      tokens: data.tokens,
      cost: data.cost,
      sessions: data.sessions.size,
    }));
  }
}
