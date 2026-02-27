import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageLogRepository, type CreateUsageLogInput, type UsageLog } from './usage-log.js';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a mock Supabase client for testing
 */
function createMockClient() {
  const mockSelectResult = {
    data: null as unknown,
    error: null as { message: string } | null,
  };

  const mockInsertResult = {
    data: null as unknown,
    error: null as { message: string } | null,
  };

  const mockDeleteResult = {
    data: [] as { id: string }[],
    error: null as { message: string } | null,
  };

  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => mockInsertResult),
  };

  // Make chainable methods resolve to appropriate results
  chainMethods.select.mockImplementation(() => {
    const result = { ...chainMethods };
    // When select is called after delete, use delete result
    // Otherwise use select result
    Object.defineProperty(result, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockSelectResult);
        return Promise.resolve(mockSelectResult);
      },
    });
    return result;
  });

  chainMethods.order.mockImplementation(() => {
    const result = { ...chainMethods };
    Object.defineProperty(result, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockSelectResult);
        return Promise.resolve(mockSelectResult);
      },
    });
    return result;
  });

  chainMethods.range.mockImplementation(() => {
    const result = { ...chainMethods };
    Object.defineProperty(result, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockSelectResult);
        return Promise.resolve(mockSelectResult);
      },
    });
    return result;
  });

  chainMethods.eq.mockImplementation(() => {
    const result = { ...chainMethods };
    Object.defineProperty(result, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockSelectResult);
        return Promise.resolve(mockSelectResult);
      },
    });
    return result;
  });

  chainMethods.delete.mockImplementation(() => {
    const result = { ...chainMethods };
    // Override select after delete to return delete result
    result.select = vi.fn().mockImplementation(() => {
      const selectResult = { ...chainMethods };
      Object.defineProperty(selectResult, 'then', {
        value: (resolve: (val: unknown) => void) => {
          resolve(mockDeleteResult);
          return Promise.resolve(mockDeleteResult);
        },
      });
      return selectResult;
    });
    return result;
  });

  const mockClient = {
    from: vi.fn().mockReturnValue(chainMethods),
  };

  return {
    client: mockClient as unknown as SupabaseClient,
    setSelectResult: (data: unknown, error: { message: string } | null = null) => {
      mockSelectResult.data = data;
      mockSelectResult.error = error;
    },
    setInsertResult: (data: unknown, error: { message: string } | null = null) => {
      mockInsertResult.data = data;
      mockInsertResult.error = error;
    },
    setDeleteResult: (data: { id: string }[], error: { message: string } | null = null) => {
      mockDeleteResult.data = data;
      mockDeleteResult.error = error;
    },
    chainMethods,
  };
}

describe('UsageLogRepository', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let repo: UsageLogRepository;

  beforeEach(() => {
    mockClient = createMockClient();
    repo = new UsageLogRepository(mockClient.client);
  });

  describe('create', () => {
    it('should create a usage log entry', async () => {
      const input: CreateUsageLogInput = {
        session_id: 'session-123',
        task_id: 'task-456',
        model: 'sonnet',
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 100,
        cache_creation_tokens: 50,
        cost_usd: 0.025,
        event_type: 'completion',
      };

      const expectedLog: UsageLog = {
        id: 'log-789',
        ...input,
        task_id: input.task_id!,
        cache_read_tokens: input.cache_read_tokens!,
        cache_creation_tokens: input.cache_creation_tokens!,
        cost_usd: input.cost_usd!,
        created_at: new Date().toISOString(),
      };

      mockClient.setInsertResult(expectedLog);

      const result = await repo.create(input);

      expect(result).toEqual(expectedLog);
      expect(mockClient.client.from).toHaveBeenCalledWith('tc_usage_log');
    });

    it('should handle missing optional fields with defaults', async () => {
      const input: CreateUsageLogInput = {
        session_id: 'session-123',
        model: 'opus',
        input_tokens: 500,
        output_tokens: 250,
        event_type: 'partial',
      };

      const expectedLog: UsageLog = {
        id: 'log-123',
        session_id: input.session_id,
        task_id: null,
        model: input.model,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        cost_usd: 0,
        event_type: input.event_type,
        created_at: new Date().toISOString(),
      };

      mockClient.setInsertResult(expectedLog);

      const result = await repo.create(input);

      expect(result.task_id).toBeNull();
      expect(result.cache_read_tokens).toBe(0);
      expect(result.cost_usd).toBe(0);
    });

    it('should throw on insert error', async () => {
      mockClient.setInsertResult(null, { message: 'Insert failed' });

      await expect(
        repo.create({
          session_id: 'session-123',
          model: 'haiku',
          input_tokens: 100,
          output_tokens: 50,
          event_type: 'completion',
        })
      ).rejects.toThrow('Failed to create usage log: Insert failed');
    });
  });

  describe('getBySessionId', () => {
    it('should return logs for a session', async () => {
      const logs: UsageLog[] = [
        {
          id: 'log-1',
          session_id: 'session-123',
          task_id: 'task-456',
          model: 'sonnet',
          input_tokens: 100,
          output_tokens: 50,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.01,
          event_type: 'partial',
          created_at: '2024-01-01T10:00:00Z',
        },
        {
          id: 'log-2',
          session_id: 'session-123',
          task_id: 'task-456',
          model: 'sonnet',
          input_tokens: 200,
          output_tokens: 100,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.02,
          event_type: 'completion',
          created_at: '2024-01-01T10:01:00Z',
        },
      ];

      mockClient.setSelectResult(logs);

      const result = await repo.getBySessionId('session-123');

      expect(result).toEqual(logs);
      expect(mockClient.chainMethods.eq).toHaveBeenCalledWith('session_id', 'session-123');
    });
  });

  describe('getByTaskId', () => {
    it('should return logs for a task', async () => {
      const logs: UsageLog[] = [
        {
          id: 'log-1',
          session_id: 'session-123',
          task_id: 'task-456',
          model: 'opus',
          input_tokens: 500,
          output_tokens: 250,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.05,
          event_type: 'completion',
          created_at: '2024-01-01T10:00:00Z',
        },
      ];

      mockClient.setSelectResult(logs);

      const result = await repo.getByTaskId('task-456');

      expect(result).toEqual(logs);
      expect(mockClient.chainMethods.eq).toHaveBeenCalledWith('task_id', 'task-456');
    });
  });

  describe('getTotalUsageBySession', () => {
    it('should aggregate usage for a session', async () => {
      const logs: UsageLog[] = [
        {
          id: 'log-1',
          session_id: 'session-123',
          task_id: null,
          model: 'sonnet',
          input_tokens: 100,
          output_tokens: 50,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.01,
          event_type: 'partial',
          created_at: '2024-01-01T10:00:00Z',
        },
        {
          id: 'log-2',
          session_id: 'session-123',
          task_id: null,
          model: 'sonnet',
          input_tokens: 200,
          output_tokens: 100,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.02,
          event_type: 'completion',
          created_at: '2024-01-01T10:01:00Z',
        },
      ];

      mockClient.setSelectResult(logs);

      const result = await repo.getTotalUsageBySession('session-123');

      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(150);
      expect(result.totalTokens).toBe(450);
      expect(result.costUSD).toBe(0.03);
    });

    it('should return zeros for session with no logs', async () => {
      mockClient.setSelectResult([]);

      const result = await repo.getTotalUsageBySession('no-logs-session');

      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.costUSD).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should aggregate usage statistics', async () => {
      const logs: UsageLog[] = [
        {
          id: 'log-1',
          session_id: 'session-1',
          task_id: null,
          model: 'sonnet',
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.05,
          event_type: 'completion',
          created_at: '2024-01-01T10:00:00Z',
        },
        {
          id: 'log-2',
          session_id: 'session-2',
          task_id: null,
          model: 'opus',
          input_tokens: 500,
          output_tokens: 250,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.10,
          event_type: 'completion',
          created_at: '2024-01-01T11:00:00Z',
        },
        {
          id: 'log-3',
          session_id: 'session-1',
          task_id: null,
          model: 'sonnet',
          input_tokens: 200,
          output_tokens: 100,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.01,
          event_type: 'partial',
          created_at: '2024-01-01T10:30:00Z',
        },
      ];

      mockClient.setSelectResult(logs);

      const stats = await repo.getStats();

      expect(stats.total_input_tokens).toBe(1700);
      expect(stats.total_output_tokens).toBe(850);
      expect(stats.total_tokens).toBe(2550);
      expect(stats.total_cost_usd).toBeCloseTo(0.16);
      expect(stats.session_count).toBe(2);

      expect(stats.by_model.sonnet.tokens).toBe(1800);
      expect(stats.by_model.sonnet.sessions).toBe(1);
      expect(stats.by_model.opus.tokens).toBe(750);
      expect(stats.by_model.opus.sessions).toBe(1);
      expect(stats.by_model.haiku.tokens).toBe(0);
      expect(stats.by_model.haiku.sessions).toBe(0);
    });

    it('should filter by date range when provided', async () => {
      mockClient.setSelectResult([]);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      await repo.getStats(startDate, endDate);

      expect(mockClient.chainMethods.gte).toHaveBeenCalledWith(
        'created_at',
        startDate.toISOString()
      );
      expect(mockClient.chainMethods.lte).toHaveBeenCalledWith('created_at', endDate.toISOString());
    });
  });

  describe('getRecent', () => {
    it('should return recent logs with pagination', async () => {
      const logs: UsageLog[] = [
        {
          id: 'log-1',
          session_id: 'session-1',
          task_id: null,
          model: 'sonnet',
          input_tokens: 100,
          output_tokens: 50,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.01,
          event_type: 'completion',
          created_at: '2024-01-02T10:00:00Z',
        },
        {
          id: 'log-2',
          session_id: 'session-2',
          task_id: null,
          model: 'opus',
          input_tokens: 200,
          output_tokens: 100,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.02,
          event_type: 'completion',
          created_at: '2024-01-01T10:00:00Z',
        },
      ];

      mockClient.setSelectResult(logs);

      const result = await repo.getRecent(10, 0);

      expect(result).toEqual(logs);
      expect(mockClient.chainMethods.range).toHaveBeenCalledWith(0, 9);
    });
  });

  describe('deleteOlderThan', () => {
    it('should delete old logs and return count', async () => {
      mockClient.setDeleteResult([{ id: 'log-1' }, { id: 'log-2' }, { id: 'log-3' }]);

      const cutoffDate = new Date('2024-01-01');
      const deletedCount = await repo.deleteOlderThan(cutoffDate);

      expect(deletedCount).toBe(3);
      expect(mockClient.chainMethods.lt).toHaveBeenCalledWith(
        'created_at',
        cutoffDate.toISOString()
      );
    });

    it('should throw when delete returns an error (lines 263-264)', async () => {
      mockClient.setDeleteResult([], { message: 'delete failed' });

      const cutoffDate = new Date('2024-01-01');
      await expect(repo.deleteOlderThan(cutoffDate)).rejects.toThrow('Failed to delete old usage logs');
    });
  });

  describe('getDailySummary', () => {
    it('should throw when query returns an error (lines 289-290)', async () => {
      mockClient.setSelectResult(null, { message: 'query failed' });

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-03');
      await expect(repo.getDailySummary(startDate, endDate)).rejects.toThrow('Failed to get daily summary');
    });

    it('should group usage by day', async () => {
      const logs: UsageLog[] = [
        {
          id: 'log-1',
          session_id: 'session-1',
          task_id: null,
          model: 'sonnet',
          input_tokens: 100,
          output_tokens: 50,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.01,
          event_type: 'completion',
          created_at: '2024-01-01T10:00:00Z',
        },
        {
          id: 'log-2',
          session_id: 'session-2',
          task_id: null,
          model: 'sonnet',
          input_tokens: 200,
          output_tokens: 100,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.02,
          event_type: 'completion',
          created_at: '2024-01-01T14:00:00Z',
        },
        {
          id: 'log-3',
          session_id: 'session-3',
          task_id: null,
          model: 'opus',
          input_tokens: 500,
          output_tokens: 250,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          cost_usd: 0.05,
          event_type: 'completion',
          created_at: '2024-01-02T10:00:00Z',
        },
      ];

      mockClient.setSelectResult(logs);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-03');
      const summary = await repo.getDailySummary(startDate, endDate);

      expect(summary).toHaveLength(2);

      const day1 = summary.find(s => s.date === '2024-01-01');
      expect(day1).toBeDefined();
      expect(day1!.tokens).toBe(450); // 100+50 + 200+100
      expect(day1!.cost).toBeCloseTo(0.03);
      expect(day1!.sessions).toBe(2);

      const day2 = summary.find(s => s.date === '2024-01-02');
      expect(day2).toBeDefined();
      expect(day2!.tokens).toBe(750); // 500+250
      expect(day2!.cost).toBeCloseTo(0.05);
      expect(day2!.sessions).toBe(1);
    });
  });
});
