import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../logging/index.js';

const log = logger.child('Database.AgentSessionRepo');

/**
 * Agent session status
 */
export type AgentSessionStatus = 'running' | 'blocked' | 'complete' | 'failed';

/**
 * Agent session record from the database
 */
export interface AgentSessionRecord {
  id: string;
  task_id: string;
  model: string;
  parent_session_id: string | null;
  status: AgentSessionStatus;
  tokens_used: number;
  blocker_reason: string | null;
  blocker_sent_at: string | null;
  blocker_resolved_at: string | null;
  started_at: string;
  ended_at: string | null;
  depth: number;
}

/**
 * Input for creating a new agent session
 */
export interface CreateAgentSessionInput {
  id: string;
  task_id: string;
  model: string;
  parent_session_id?: string | null;
  status?: AgentSessionStatus;
  depth?: number;
}

/**
 * Input for updating an agent session
 */
export interface UpdateAgentSessionInput {
  status?: AgentSessionStatus;
  tokens_used?: number;
  blocker_reason?: string | null;
  blocker_sent_at?: string | null;
  blocker_resolved_at?: string | null;
  ended_at?: string | null;
}

/**
 * Repository for managing agent sessions in the database
 */
export class AgentSessionRepository {
  constructor(private client: SupabaseClient) {}

  /**
   * Create a new agent session
   */
  async create(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
    log.time('create-agent-session');
    const { data, error } = await this.client
      .from('tc_agent_sessions')
      .insert({
        id: input.id,
        task_id: input.task_id,
        model: input.model,
        parent_session_id: input.parent_session_id ?? null,
        status: input.status ?? 'running',
        depth: input.depth ?? 0,
        tokens_used: 0,
      })
      .select()
      .single();

    log.timeEnd('create-agent-session', { table: 'tc_agent_sessions', operation: 'insert' });

    if (error) {
      log.error('Failed to create agent session', { operation: 'insert', table: 'tc_agent_sessions', sessionId: input.id, error: error.message });
      throw new Error(`Failed to create agent session: ${error.message}`);
    }

    log.info('Agent session created', { sessionId: input.id, taskId: input.task_id, model: input.model, depth: input.depth ?? 0 });
    return data as AgentSessionRecord;
  }

  /**
   * Get an agent session by ID
   */
  async getById(id: string): Promise<AgentSessionRecord | null> {
    log.time('get-agent-session-by-id');
    const { data, error } = await this.client
      .from('tc_agent_sessions')
      .select('*')
      .eq('id', id)
      .single();

    log.timeEnd('get-agent-session-by-id', { table: 'tc_agent_sessions', operation: 'select', sessionId: id });

    if (error) {
      if (error.code === 'PGRST116') {
        log.debug('Agent session not found', { sessionId: id });
        return null; // Not found
      }
      log.error('Failed to get agent session', { operation: 'select', table: 'tc_agent_sessions', sessionId: id, error: error.message });
      throw new Error(`Failed to get agent session: ${error.message}`);
    }

    log.debug('Agent session fetched', { sessionId: id, found: !!data });
    return data as AgentSessionRecord;
  }

  /**
   * Update an agent session
   */
  async update(id: string, input: UpdateAgentSessionInput): Promise<AgentSessionRecord> {
    log.time('update-agent-session');
    const { data, error } = await this.client
      .from('tc_agent_sessions')
      .update(input)
      .eq('id', id)
      .select()
      .single();

    log.timeEnd('update-agent-session', { table: 'tc_agent_sessions', operation: 'update', sessionId: id });

    if (error) {
      log.error('Failed to update agent session', { operation: 'update', table: 'tc_agent_sessions', sessionId: id, error: error.message });
      throw new Error(`Failed to update agent session: ${error.message}`);
    }

    log.debug('Agent session updated', { sessionId: id, status: input.status });
    return data as AgentSessionRecord;
  }

  /**
   * Mark a session as complete
   */
  async complete(id: string, tokensUsed?: number): Promise<AgentSessionRecord> {
    log.info('Marking agent session as complete', { sessionId: id, tokensUsed });
    return this.update(id, {
      status: 'complete',
      ended_at: new Date().toISOString(),
      ...(tokensUsed !== undefined && { tokens_used: tokensUsed }),
    });
  }

  /**
   * Mark a session as failed
   */
  async fail(id: string, tokensUsed?: number): Promise<AgentSessionRecord> {
    log.warn('Marking agent session as failed', { sessionId: id, tokensUsed });
    return this.update(id, {
      status: 'failed',
      ended_at: new Date().toISOString(),
      ...(tokensUsed !== undefined && { tokens_used: tokensUsed }),
    });
  }

  /**
   * Mark a session as blocked
   */
  async block(id: string, reason?: string): Promise<AgentSessionRecord> {
    log.warn('Marking agent session as blocked', { sessionId: id, reason });
    return this.update(id, {
      status: 'blocked',
      blocker_reason: reason ?? null,
      blocker_sent_at: new Date().toISOString(),
    });
  }

  /**
   * Unblock a session (set back to running)
   */
  async unblock(id: string): Promise<AgentSessionRecord> {
    log.info('Unblocking agent session', { sessionId: id });
    return this.update(id, {
      status: 'running',
      blocker_resolved_at: new Date().toISOString(),
    });
  }

  /**
   * Get all active sessions (running or blocked)
   */
  async getActive(): Promise<AgentSessionRecord[]> {
    log.time('get-active-sessions');
    const { data, error } = await this.client
      .from('tc_agent_sessions')
      .select('*')
      .in('status', ['running', 'blocked'])
      .order('started_at', { ascending: false });

    log.timeEnd('get-active-sessions', { table: 'tc_agent_sessions', operation: 'select', rowCount: data?.length });

    if (error) {
      log.error('Failed to get active sessions', { operation: 'select', table: 'tc_agent_sessions', error: error.message });
      throw new Error(`Failed to get active sessions: ${error.message}`);
    }

    log.debug('Active sessions fetched', { count: (data ?? []).length });
    return (data ?? []) as AgentSessionRecord[];
  }

  /**
   * Get sessions by task ID
   */
  async getByTaskId(taskId: string): Promise<AgentSessionRecord[]> {
    log.time('get-sessions-by-task');
    const { data, error } = await this.client
      .from('tc_agent_sessions')
      .select('*')
      .eq('task_id', taskId)
      .order('started_at', { ascending: false });

    log.timeEnd('get-sessions-by-task', { table: 'tc_agent_sessions', operation: 'select', taskId, rowCount: data?.length });

    if (error) {
      log.error('Failed to get sessions by task', { operation: 'select', table: 'tc_agent_sessions', taskId, error: error.message });
      throw new Error(`Failed to get sessions by task: ${error.message}`);
    }

    log.debug('Sessions by task fetched', { taskId, count: (data ?? []).length });
    return (data ?? []) as AgentSessionRecord[];
  }

  /**
   * Get child sessions for a parent session
   */
  async getChildren(parentSessionId: string): Promise<AgentSessionRecord[]> {
    log.time('get-child-sessions');
    const { data, error } = await this.client
      .from('tc_agent_sessions')
      .select('*')
      .eq('parent_session_id', parentSessionId)
      .order('started_at', { ascending: true });

    log.timeEnd('get-child-sessions', { table: 'tc_agent_sessions', operation: 'select', parentSessionId, rowCount: data?.length });

    if (error) {
      log.error('Failed to get child sessions', { operation: 'select', table: 'tc_agent_sessions', parentSessionId, error: error.message });
      throw new Error(`Failed to get child sessions: ${error.message}`);
    }

    log.debug('Child sessions fetched', { parentSessionId, count: (data ?? []).length });
    return (data ?? []) as AgentSessionRecord[];
  }

  /**
   * Get session statistics
   */
  async getStats(): Promise<{
    total: number;
    running: number;
    blocked: number;
    complete: number;
    failed: number;
  }> {
    log.time('get-session-stats');
    const { data, error } = await this.client
      .from('tc_agent_sessions')
      .select('status');

    log.timeEnd('get-session-stats', { table: 'tc_agent_sessions', operation: 'select', rowCount: data?.length });

    if (error) {
      log.error('Failed to get session stats', { operation: 'select', table: 'tc_agent_sessions', error: error.message });
      throw new Error(`Failed to get session stats: ${error.message}`);
    }

    const sessions = data ?? [];
    const stats = {
      total: sessions.length,
      running: sessions.filter(s => s.status === 'running').length,
      blocked: sessions.filter(s => s.status === 'blocked').length,
      complete: sessions.filter(s => s.status === 'complete').length,
      failed: sessions.filter(s => s.status === 'failed').length,
    };
    log.debug('Session stats computed', stats);
    return stats;
  }
}
