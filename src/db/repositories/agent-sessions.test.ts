import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSessionRepository, type CreateAgentSessionInput, type AgentSessionRecord } from './agent-sessions.js';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a mock Supabase client for testing AgentSessionRepository.
 *
 * Handles two patterns:
 * 1. Chains ending in .single() — create, getById, update (and methods that delegate to update)
 *    → returns { data, error } synchronously from single()
 * 2. Chains ending in .order() / .select('status') / .in() / .eq() without single()
 *    → returns a thenable { data, error } that can be awaited
 */
function createMockClient() {
  const mockSingleResult = {
    data: null as unknown,
    error: null as { message: string; code?: string } | null,
  };

  const mockQueryResult = {
    data: null as unknown,
    error: null as { message: string } | null,
  };

  function makeThenableQuery() {
    const result: Record<string, unknown> = { ...chainMethods };
    Object.defineProperty(result, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockQueryResult);
        return Promise.resolve(mockQueryResult);
      },
    });
    return result;
  }

  const chainMethods: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockImplementation(() => makeThenableQuery()),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation(() => makeThenableQuery()),
    in: vi.fn().mockImplementation(() => makeThenableQuery()),
    order: vi.fn().mockImplementation(() => makeThenableQuery()),
    single: vi.fn().mockImplementation(() => mockSingleResult),
  };

  // Stable inner mocks for insert and update chains
  const insertChain = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };
  const updateChain = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };

  // For insert().select().single() chain:
  insertChain.single.mockImplementation(() => mockSingleResult);
  insertChain.select.mockImplementation(() => ({ ...chainMethods, single: insertChain.single }));
  chainMethods.insert.mockImplementation((...args: unknown[]) => {
    insertChain.insert(...args);
    return {
      ...chainMethods,
      select: insertChain.select,
    };
  });

  // For update().eq().select().single() chain:
  updateChain.single.mockImplementation(() => mockSingleResult);
  updateChain.select.mockImplementation(() => ({ ...chainMethods, single: updateChain.single }));
  updateChain.eq.mockImplementation((...args: unknown[]) => ({
    ...chainMethods,
    select: updateChain.select,
  }));
  chainMethods.update.mockImplementation((...args: unknown[]) => {
    updateChain.update(...args);
    return {
      ...chainMethods,
      eq: updateChain.eq,
    };
  });

  // Stable inner chain mocks (returned by select()) for assertion tracking
  const innerOrder = vi.fn().mockImplementation(() => makeThenableQuery());

  const innerEq = vi.fn().mockImplementation(() => {
    const eqResult: Record<string, unknown> = {
      ...chainMethods,
      single: vi.fn().mockImplementation(() => mockSingleResult),
      order: innerOrder,
    };
    // eq result is also thenable for getByTaskId/getChildren chains without single
    Object.defineProperty(eqResult, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockQueryResult);
        return Promise.resolve(mockQueryResult);
      },
    });
    return eqResult;
  });

  const innerIn = vi.fn().mockImplementation(() => {
    const inResult: Record<string, unknown> = {
      ...chainMethods,
      order: innerOrder,
    };
    Object.defineProperty(inResult, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockQueryResult);
        return Promise.resolve(mockQueryResult);
      },
    });
    return inResult;
  });

  // For select('*').eq().single() chain (getById):
  // select returns object with eq, eq returns object with single
  chainMethods.select.mockImplementation(() => {
    const selectResult: Record<string, unknown> = {
      ...chainMethods,
      eq: innerEq,
      in: innerIn,
    };
    // select itself is thenable for getStats (select('status') with no further chaining)
    Object.defineProperty(selectResult, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockQueryResult);
        return Promise.resolve(mockQueryResult);
      },
    });
    return selectResult;
  });

  const mockClient = {
    from: vi.fn().mockReturnValue(chainMethods),
  };

  return {
    client: mockClient as unknown as SupabaseClient,
    setSingleResult: (data: unknown, error: { message: string; code?: string } | null = null) => {
      mockSingleResult.data = data;
      mockSingleResult.error = error;
    },
    setQueryResult: (data: unknown, error: { message: string } | null = null) => {
      mockQueryResult.data = data;
      mockQueryResult.error = error;
    },
    chainMethods,
    /** Inner chain mocks returned by select() — use these for asserting eq/in/order args */
    innerChainMethods: { eq: innerEq, in: innerIn, order: innerOrder },
    /** Chain mocks for insert().select().single() */
    insertChain,
    /** Chain mocks for update(payload).eq(id).select().single() */
    updateChain,
    mockClient,
  };
}

function makeSession(overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return {
    id: 'session-001',
    task_id: 'task-001',
    model: 'sonnet',
    parent_session_id: null,
    status: 'running',
    tokens_used: 0,
    blocker_reason: null,
    blocker_sent_at: null,
    blocker_resolved_at: null,
    started_at: '2024-01-01T10:00:00Z',
    ended_at: null,
    depth: 0,
    ...overrides,
  };
}

describe('AgentSessionRepository', () => {
  let mock: ReturnType<typeof createMockClient>;
  let repo: AgentSessionRepository;

  beforeEach(() => {
    mock = createMockClient();
    repo = new AgentSessionRepository(mock.client);
  });

  describe('create', () => {
    it('should create a session with defaults', async () => {
      const input: CreateAgentSessionInput = {
        id: 'session-001',
        task_id: 'task-001',
        model: 'sonnet',
      };
      const expected = makeSession();
      mock.setSingleResult(expected);

      const result = await repo.create(input);

      expect(result).toEqual(expected);
      expect(mock.client.from).toHaveBeenCalledWith('tc_agent_sessions');
      expect(mock.insertChain.insert).toHaveBeenCalledWith({
        id: 'session-001',
        task_id: 'task-001',
        model: 'sonnet',
        parent_session_id: null,
        status: 'running',
        depth: 0,
        tokens_used: 0,
      });
    });

    it('should create a session with optional fields', async () => {
      const input: CreateAgentSessionInput = {
        id: 'session-002',
        task_id: 'task-002',
        model: 'opus',
        parent_session_id: 'parent-001',
        status: 'blocked',
        depth: 2,
      };
      const expected = makeSession({
        id: 'session-002',
        task_id: 'task-002',
        model: 'opus',
        parent_session_id: 'parent-001',
        status: 'blocked',
        depth: 2,
      });
      mock.setSingleResult(expected);

      const result = await repo.create(input);

      expect(result).toEqual(expected);
    });

    it('should throw on insert error', async () => {
      mock.setSingleResult(null, { message: 'Duplicate key violation' });

      await expect(
        repo.create({ id: 'session-001', task_id: 'task-001', model: 'sonnet' })
      ).rejects.toThrow('Failed to create agent session: Duplicate key violation');
    });
  });

  describe('getById', () => {
    it('should return a session when found', async () => {
      const session = makeSession();
      mock.setSingleResult(session);

      const result = await repo.getById('session-001');

      expect(result).toEqual(session);
      expect(mock.innerChainMethods.eq).toHaveBeenCalledWith('id', 'session-001');
    });

    it('should return null when session not found (PGRST116)', async () => {
      mock.setSingleResult(null, { message: 'Row not found', code: 'PGRST116' });

      const result = await repo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw on other errors', async () => {
      mock.setSingleResult(null, { message: 'Connection refused' });

      await expect(repo.getById('session-001')).rejects.toThrow(
        'Failed to get agent session: Connection refused'
      );
    });
  });

  describe('update', () => {
    it('should update and return the session', async () => {
      const updated = makeSession({ status: 'complete', ended_at: '2024-01-01T12:00:00Z' });
      mock.setSingleResult(updated);

      const result = await repo.update('session-001', {
        status: 'complete',
        ended_at: '2024-01-01T12:00:00Z',
      });

      expect(result).toEqual(updated);
      expect(mock.client.from).toHaveBeenCalledWith('tc_agent_sessions');
      expect(mock.updateChain.update).toHaveBeenCalledWith({
        status: 'complete',
        ended_at: '2024-01-01T12:00:00Z',
      });
      expect(mock.updateChain.eq).toHaveBeenCalledWith('id', 'session-001');
    });

    it('should throw on update error', async () => {
      mock.setSingleResult(null, { message: 'Update failed' });

      await expect(
        repo.update('session-001', { status: 'complete' })
      ).rejects.toThrow('Failed to update agent session: Update failed');
    });
  });

  describe('complete', () => {
    it('should mark session complete without tokens', async () => {
      const completed = makeSession({ status: 'complete', ended_at: '2024-01-01T12:00:00Z' });
      mock.setSingleResult(completed);

      const result = await repo.complete('session-001');

      expect(result).toEqual(completed);
      expect(result.status).toBe('complete');
    });

    it('should mark session complete with tokens', async () => {
      const completed = makeSession({
        status: 'complete',
        ended_at: '2024-01-01T12:00:00Z',
        tokens_used: 5000,
      });
      mock.setSingleResult(completed);

      const result = await repo.complete('session-001', 5000);

      expect(result).toEqual(completed);
      expect(result.tokens_used).toBe(5000);
    });

    it('should pass correct update payload without tokens', async () => {
      const completed = makeSession({ status: 'complete' });
      mock.setSingleResult(completed);

      // Spy on update
      const updateSpy = vi.spyOn(repo, 'update');
      await repo.complete('session-001');

      expect(updateSpy).toHaveBeenCalledWith('session-001', {
        status: 'complete',
        ended_at: expect.any(String),
      });
    });

    it('should pass correct update payload with tokens', async () => {
      const completed = makeSession({ status: 'complete', tokens_used: 3000 });
      mock.setSingleResult(completed);

      const updateSpy = vi.spyOn(repo, 'update');
      await repo.complete('session-001', 3000);

      expect(updateSpy).toHaveBeenCalledWith('session-001', {
        status: 'complete',
        ended_at: expect.any(String),
        tokens_used: 3000,
      });
    });
  });

  describe('fail', () => {
    it('should mark session as failed without tokens', async () => {
      const failed = makeSession({ status: 'failed', ended_at: '2024-01-01T12:00:00Z' });
      mock.setSingleResult(failed);

      const result = await repo.fail('session-001');

      expect(result.status).toBe('failed');
    });

    it('should mark session as failed with tokens', async () => {
      const failed = makeSession({ status: 'failed', ended_at: '2024-01-01T12:00:00Z', tokens_used: 2000 });
      mock.setSingleResult(failed);

      const result = await repo.fail('session-001', 2000);

      expect(result.tokens_used).toBe(2000);
    });

    it('should pass correct update payload without tokens', async () => {
      mock.setSingleResult(makeSession({ status: 'failed' }));
      const updateSpy = vi.spyOn(repo, 'update');

      await repo.fail('session-001');

      expect(updateSpy).toHaveBeenCalledWith('session-001', {
        status: 'failed',
        ended_at: expect.any(String),
      });
    });

    it('should pass correct update payload with tokens', async () => {
      mock.setSingleResult(makeSession({ status: 'failed', tokens_used: 1500 }));
      const updateSpy = vi.spyOn(repo, 'update');

      await repo.fail('session-001', 1500);

      expect(updateSpy).toHaveBeenCalledWith('session-001', {
        status: 'failed',
        ended_at: expect.any(String),
        tokens_used: 1500,
      });
    });
  });

  describe('block', () => {
    it('should mark session as blocked without reason', async () => {
      const blocked = makeSession({ status: 'blocked', blocker_sent_at: '2024-01-01T12:00:00Z' });
      mock.setSingleResult(blocked);

      const result = await repo.block('session-001');

      expect(result.status).toBe('blocked');
    });

    it('should mark session as blocked with reason', async () => {
      const blocked = makeSession({
        status: 'blocked',
        blocker_reason: 'Waiting for user input',
        blocker_sent_at: '2024-01-01T12:00:00Z',
      });
      mock.setSingleResult(blocked);

      const result = await repo.block('session-001', 'Waiting for user input');

      expect(result.blocker_reason).toBe('Waiting for user input');
    });

    it('should pass correct update payload without reason', async () => {
      mock.setSingleResult(makeSession({ status: 'blocked' }));
      const updateSpy = vi.spyOn(repo, 'update');

      await repo.block('session-001');

      expect(updateSpy).toHaveBeenCalledWith('session-001', {
        status: 'blocked',
        blocker_reason: null,
        blocker_sent_at: expect.any(String),
      });
    });

    it('should pass correct update payload with reason', async () => {
      mock.setSingleResult(makeSession({ status: 'blocked' }));
      const updateSpy = vi.spyOn(repo, 'update');

      await repo.block('session-001', 'Need API key');

      expect(updateSpy).toHaveBeenCalledWith('session-001', {
        status: 'blocked',
        blocker_reason: 'Need API key',
        blocker_sent_at: expect.any(String),
      });
    });
  });

  describe('unblock', () => {
    it('should set session back to running with blocker_resolved_at', async () => {
      const unblocked = makeSession({
        status: 'running',
        blocker_resolved_at: '2024-01-01T13:00:00Z',
      });
      mock.setSingleResult(unblocked);

      const result = await repo.unblock('session-001');

      expect(result.status).toBe('running');
      expect(result.blocker_resolved_at).toBeDefined();
    });

    it('should pass correct update payload', async () => {
      mock.setSingleResult(makeSession({ status: 'running' }));
      const updateSpy = vi.spyOn(repo, 'update');

      await repo.unblock('session-001');

      expect(updateSpy).toHaveBeenCalledWith('session-001', {
        status: 'running',
        blocker_resolved_at: expect.any(String),
      });
    });
  });

  describe('getActive', () => {
    it('should return active sessions', async () => {
      const sessions = [
        makeSession({ id: 'session-001', status: 'running' }),
        makeSession({ id: 'session-002', status: 'blocked' }),
      ];
      mock.setQueryResult(sessions);

      const result = await repo.getActive();

      expect(result).toEqual(sessions);
      expect(result).toHaveLength(2);
      expect(mock.innerChainMethods.in).toHaveBeenCalledWith('status', ['running', 'blocked']);
      expect(mock.innerChainMethods.order).toHaveBeenCalledWith('started_at', { ascending: false });
    });

    it('should return empty array when data is null', async () => {
      mock.setQueryResult(null);

      const result = await repo.getActive();

      expect(result).toEqual([]);
    });

    it('should throw on error', async () => {
      mock.setQueryResult(null, { message: 'Query timeout' });

      await expect(repo.getActive()).rejects.toThrow(
        'Failed to get active sessions: Query timeout'
      );
    });
  });

  describe('getByTaskId', () => {
    it('should return sessions for a task', async () => {
      const sessions = [
        makeSession({ id: 'session-001', task_id: 'task-001' }),
        makeSession({ id: 'session-002', task_id: 'task-001' }),
      ];
      mock.setQueryResult(sessions);

      const result = await repo.getByTaskId('task-001');

      expect(result).toEqual(sessions);
      expect(result).toHaveLength(2);
      expect(mock.innerChainMethods.eq).toHaveBeenCalledWith('task_id', 'task-001');
      expect(mock.innerChainMethods.order).toHaveBeenCalledWith('started_at', { ascending: false });
    });

    it('should return empty array when data is null', async () => {
      mock.setQueryResult(null);

      const result = await repo.getByTaskId('task-001');

      expect(result).toEqual([]);
    });

    it('should throw on error', async () => {
      mock.setQueryResult(null, { message: 'Connection lost' });

      await expect(repo.getByTaskId('task-001')).rejects.toThrow(
        'Failed to get sessions by task: Connection lost'
      );
    });
  });

  describe('getChildren', () => {
    it('should return child sessions', async () => {
      const children = [
        makeSession({ id: 'child-001', parent_session_id: 'parent-001', depth: 1 }),
        makeSession({ id: 'child-002', parent_session_id: 'parent-001', depth: 1 }),
      ];
      mock.setQueryResult(children);

      const result = await repo.getChildren('parent-001');

      expect(result).toEqual(children);
      expect(result).toHaveLength(2);
      expect(mock.innerChainMethods.eq).toHaveBeenCalledWith('parent_session_id', 'parent-001');
      expect(mock.innerChainMethods.order).toHaveBeenCalledWith('started_at', { ascending: true });
    });

    it('should return empty array when data is null', async () => {
      mock.setQueryResult(null);

      const result = await repo.getChildren('parent-001');

      expect(result).toEqual([]);
    });

    it('should throw on error', async () => {
      mock.setQueryResult(null, { message: 'Permission denied' });

      await expect(repo.getChildren('parent-001')).rejects.toThrow(
        'Failed to get child sessions: Permission denied'
      );
    });
  });

  describe('getStats', () => {
    it('should compute correct aggregation', async () => {
      const sessions = [
        { status: 'running' },
        { status: 'running' },
        { status: 'blocked' },
        { status: 'complete' },
        { status: 'complete' },
        { status: 'complete' },
        { status: 'failed' },
      ];
      mock.setQueryResult(sessions);

      const stats = await repo.getStats();

      expect(stats).toEqual({
        total: 7,
        running: 2,
        blocked: 1,
        complete: 3,
        failed: 1,
      });
    });

    it('should return all zeros when data is null', async () => {
      mock.setQueryResult(null);

      const stats = await repo.getStats();

      expect(stats).toEqual({
        total: 0,
        running: 0,
        blocked: 0,
        complete: 0,
        failed: 0,
      });
    });

    it('should return all zeros for empty data', async () => {
      mock.setQueryResult([]);

      const stats = await repo.getStats();

      expect(stats).toEqual({
        total: 0,
        running: 0,
        blocked: 0,
        complete: 0,
        failed: 0,
      });
    });

    it('should throw on error', async () => {
      mock.setQueryResult(null, { message: 'Database error' });

      await expect(repo.getStats()).rejects.toThrow(
        'Failed to get session stats: Database error'
      );
    });
  });
});
