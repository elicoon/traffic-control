import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROICalculator, type ROIMetrics, type TaskROIInput, type ProjectROIInput } from './roi-calculator.js';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a mock Supabase client for testing
 */
function createMockClient() {
  const mockResults: Record<string, { data: unknown; error: { message: string } | null }> = {
    default: { data: [], error: null },
  };

  const createChainMethods = (tableName: string) => {
    const getResult = () => mockResults[tableName] || mockResults.default;

    const chainMethods = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        const result = getResult();
        return Promise.resolve({
          data: Array.isArray(result.data) ? result.data[0] : result.data,
          error: result.error,
        });
      }),
    };

    // Make all chain methods return a thenable
    const makeThenable = () => ({
      ...chainMethods,
      then: (resolve: (val: unknown) => void) => {
        const result = getResult();
        resolve(result);
        return Promise.resolve(result);
      },
    });

    chainMethods.select.mockReturnValue(makeThenable());
    chainMethods.eq.mockReturnValue(makeThenable());
    chainMethods.is.mockReturnValue(makeThenable());
    chainMethods.in.mockReturnValue(makeThenable());
    chainMethods.lte.mockReturnValue(makeThenable());
    chainMethods.gte.mockReturnValue(makeThenable());
    chainMethods.or.mockReturnValue(makeThenable());
    chainMethods.order.mockReturnValue(makeThenable());
    chainMethods.limit.mockReturnValue(makeThenable());

    return chainMethods;
  };

  const mockClient = {
    from: vi.fn().mockImplementation((tableName: string) => createChainMethods(tableName)),
  };

  return {
    client: mockClient as unknown as SupabaseClient,
    setResult: (tableName: string, data: unknown, error: { message: string } | null = null) => {
      mockResults[tableName] = { data, error };
    },
    setDefaultResult: (data: unknown, error: { message: string } | null = null) => {
      mockResults.default = { data, error };
    },
  };
}

describe('ROICalculator', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let calculator: ROICalculator;

  beforeEach(() => {
    mockClient = createMockClient();
    calculator = new ROICalculator(mockClient.client);
  });

  describe('calculateTaskROI', () => {
    it('should calculate ROI metrics for a completed task', async () => {
      const task = {
        id: 'task-1',
        project_id: 'project-1',
        title: 'Test Task',
        status: 'complete',
        estimated_sessions_opus: 2,
        estimated_sessions_sonnet: 3,
        actual_sessions_opus: 3,
        actual_sessions_sonnet: 4,
        actual_tokens_opus: 150000,
        actual_tokens_sonnet: 200000,
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T14:00:00Z',
      };

      const usageLogs = [
        { model: 'opus', input_tokens: 100000, output_tokens: 50000, cost_usd: 2.25 },
        { model: 'sonnet', input_tokens: 150000, output_tokens: 50000, cost_usd: 1.20 },
      ];

      const interventions = [
        { duration_seconds: 600 }, // 10 minutes
        { duration_seconds: 300 }, // 5 minutes
      ];

      mockClient.setResult('tc_tasks', [task]);
      mockClient.setResult('tc_usage_log', usageLogs);
      mockClient.setResult('tc_interventions', interventions);

      // Mock pricing
      mockClient.setResult('tc_model_pricing', [
        { model: 'opus', input_price_per_million: '15', output_price_per_million: '75' },
        { model: 'sonnet', input_price_per_million: '3', output_price_per_million: '15' },
      ]);

      const roi = await calculator.calculateTaskROI('task-1');

      expect(roi.taskId).toBe('task-1');
      expect(roi.estimatedSessions).toBe(5); // 2 opus + 3 sonnet
      expect(roi.actualSessions).toBe(7); // 3 opus + 4 sonnet
      expect(roi.sessionVariance).toBeCloseTo(0.4, 2); // (7-5)/5 = 0.4 = 40% over
    });

    it('should calculate efficiency based on estimate vs actual', async () => {
      const task = {
        id: 'task-2',
        project_id: 'project-1',
        title: 'Efficient Task',
        status: 'complete',
        estimated_sessions_opus: 5,
        estimated_sessions_sonnet: 10,
        actual_sessions_opus: 3,
        actual_sessions_sonnet: 6,
        actual_tokens_opus: 100000,
        actual_tokens_sonnet: 150000,
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T12:00:00Z',
      };

      mockClient.setResult('tc_tasks', [task]);
      mockClient.setResult('tc_usage_log', []);
      mockClient.setResult('tc_interventions', []);
      mockClient.setResult('tc_model_pricing', [
        { model: 'opus', input_price_per_million: '15', output_price_per_million: '75' },
        { model: 'sonnet', input_price_per_million: '3', output_price_per_million: '15' },
      ]);

      const roi = await calculator.calculateTaskROI('task-2');

      // Efficiency = estimated / actual (when actual < estimated, efficiency > 1)
      expect(roi.estimatedSessions).toBe(15);
      expect(roi.actualSessions).toBe(9);
      expect(roi.efficiency).toBeGreaterThan(1); // More efficient than estimated
    });

    it('should handle task with no interventions', async () => {
      const task = {
        id: 'task-3',
        project_id: 'project-1',
        title: 'Autonomous Task',
        status: 'complete',
        estimated_sessions_opus: 2,
        estimated_sessions_sonnet: 0,
        actual_sessions_opus: 2,
        actual_sessions_sonnet: 0,
        actual_tokens_opus: 80000,
        actual_tokens_sonnet: 0,
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T11:00:00Z',
      };

      mockClient.setResult('tc_tasks', [task]);
      mockClient.setResult('tc_usage_log', []);
      mockClient.setResult('tc_interventions', []);
      mockClient.setResult('tc_model_pricing', [
        { model: 'opus', input_price_per_million: '15', output_price_per_million: '75' },
      ]);

      const roi = await calculator.calculateTaskROI('task-3');

      expect(roi.interventionMinutes).toBe(0);
      expect(roi.totalDurationMinutes).toBe(60); // 1 hour
      expect(roi.automatedMinutes).toBe(60); // Fully automated
    });

    it('should throw when task not found', async () => {
      mockClient.setResult('tc_tasks', []);

      await expect(calculator.calculateTaskROI('nonexistent')).rejects.toThrow(
        'Task not found: nonexistent'
      );
    });
  });

  describe('calculateProjectROI', () => {
    it('should aggregate ROI across all project tasks', async () => {
      const tasks = [
        {
          id: 'task-1',
          project_id: 'project-1',
          status: 'complete',
          estimated_sessions_opus: 2,
          estimated_sessions_sonnet: 3,
          actual_sessions_opus: 3,
          actual_sessions_sonnet: 4,
          actual_tokens_opus: 150000,
          actual_tokens_sonnet: 200000,
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T14:00:00Z',
        },
        {
          id: 'task-2',
          project_id: 'project-1',
          status: 'complete',
          estimated_sessions_opus: 1,
          estimated_sessions_sonnet: 2,
          actual_sessions_opus: 1,
          actual_sessions_sonnet: 2,
          actual_tokens_opus: 50000,
          actual_tokens_sonnet: 100000,
          started_at: '2026-01-16T10:00:00Z',
          completed_at: '2026-01-16T12:00:00Z',
        },
      ];

      mockClient.setResult('tc_tasks', tasks);
      mockClient.setResult('tc_usage_log', []);
      mockClient.setResult('tc_interventions', []);
      mockClient.setResult('tc_model_pricing', [
        { model: 'opus', input_price_per_million: '15', output_price_per_million: '75' },
        { model: 'sonnet', input_price_per_million: '3', output_price_per_million: '15' },
      ]);

      const roi = await calculator.calculateProjectROI('project-1');

      expect(roi.projectId).toBe('project-1');
      expect(roi.estimatedSessions).toBe(8); // (2+3) + (1+2)
      expect(roi.actualSessions).toBe(10); // (3+4) + (1+2)
      expect(roi.actualTokens.input).toBe(500000); // 150000 + 200000 + 50000 + 100000
    });

    it('should only include completed tasks in ROI calculation', async () => {
      // When completedOnly is true, the query adds .eq('status', 'complete')
      // So the database would only return completed tasks
      const completedTasksOnly = [
        {
          id: 'task-1',
          project_id: 'project-1',
          status: 'complete',
          estimated_sessions_opus: 2,
          estimated_sessions_sonnet: 3,
          actual_sessions_opus: 2,
          actual_sessions_sonnet: 3,
          actual_tokens_opus: 100000,
          actual_tokens_sonnet: 150000,
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T14:00:00Z',
        },
        // task-2 is in_progress, so it wouldn't be returned by the DB with completedOnly filter
      ];

      mockClient.setResult('tc_tasks', completedTasksOnly);
      mockClient.setResult('tc_usage_log', []);
      mockClient.setResult('tc_interventions', []);
      mockClient.setResult('tc_model_pricing', [
        { model: 'opus', input_price_per_million: '15', output_price_per_million: '75' },
        { model: 'sonnet', input_price_per_million: '3', output_price_per_million: '15' },
      ]);

      const roi = await calculator.calculateProjectROI('project-1', { completedOnly: true });

      // Should only count the completed task
      expect(roi.estimatedSessions).toBe(5); // Only task-1: 2 opus + 3 sonnet
      expect(roi.actualSessions).toBe(5); // Only task-1: 2 opus + 3 sonnet
    });
  });

  describe('calculateOverallROI', () => {
    it('should calculate ROI across all projects', async () => {
      const tasks = [
        {
          id: 'task-1',
          project_id: 'project-1',
          status: 'complete',
          estimated_sessions_opus: 2,
          estimated_sessions_sonnet: 2,
          actual_sessions_opus: 2,
          actual_sessions_sonnet: 2,
          actual_tokens_opus: 100000,
          actual_tokens_sonnet: 100000,
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T12:00:00Z',
        },
        {
          id: 'task-2',
          project_id: 'project-2',
          status: 'complete',
          estimated_sessions_opus: 3,
          estimated_sessions_sonnet: 3,
          actual_sessions_opus: 3,
          actual_sessions_sonnet: 3,
          actual_tokens_opus: 150000,
          actual_tokens_sonnet: 150000,
          started_at: '2026-01-16T10:00:00Z',
          completed_at: '2026-01-16T14:00:00Z',
        },
      ];

      mockClient.setResult('tc_tasks', tasks);
      mockClient.setResult('tc_usage_log', []);
      mockClient.setResult('tc_interventions', []);
      mockClient.setResult('tc_model_pricing', [
        { model: 'opus', input_price_per_million: '15', output_price_per_million: '75' },
        { model: 'sonnet', input_price_per_million: '3', output_price_per_million: '15' },
      ]);

      const roi = await calculator.calculateOverallROI();

      expect(roi.estimatedSessions).toBe(10); // 4 + 6
      expect(roi.actualSessions).toBe(10);
      expect(roi.efficiency).toBeCloseTo(1.0, 2); // Perfectly on estimate
    });

    it('should filter by date range when provided', async () => {
      const tasks = [
        {
          id: 'task-1',
          project_id: 'project-1',
          status: 'complete',
          estimated_sessions_opus: 2,
          estimated_sessions_sonnet: 2,
          actual_sessions_opus: 2,
          actual_sessions_sonnet: 2,
          actual_tokens_opus: 100000,
          actual_tokens_sonnet: 100000,
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T12:00:00Z',
        },
      ];

      mockClient.setResult('tc_tasks', tasks);
      mockClient.setResult('tc_usage_log', []);
      mockClient.setResult('tc_interventions', []);
      mockClient.setResult('tc_model_pricing', [
        { model: 'opus', input_price_per_million: '15', output_price_per_million: '75' },
      ]);

      const roi = await calculator.calculateOverallROI({
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
      });

      expect(roi).toBeDefined();
      expect(mockClient.client.from).toHaveBeenCalledWith('tc_tasks');
    });
  });

  describe('getEstimateAccuracy', () => {
    it('should calculate how accurate estimates are over time', async () => {
      const tasks = [
        {
          id: 'task-1',
          status: 'complete',
          estimated_sessions_opus: 2,
          estimated_sessions_sonnet: 2,
          actual_sessions_opus: 2,
          actual_sessions_sonnet: 3, // +1 over
          completed_at: '2026-01-15T12:00:00Z',
        },
        {
          id: 'task-2',
          status: 'complete',
          estimated_sessions_opus: 3,
          estimated_sessions_sonnet: 3,
          actual_sessions_opus: 2, // -1 under
          actual_sessions_sonnet: 3,
          completed_at: '2026-01-16T12:00:00Z',
        },
        {
          id: 'task-3',
          status: 'complete',
          estimated_sessions_opus: 1,
          estimated_sessions_sonnet: 1,
          actual_sessions_opus: 3, // +2 over
          actual_sessions_sonnet: 2, // +1 over
          completed_at: '2026-01-17T12:00:00Z',
        },
      ];

      mockClient.setResult('tc_tasks', tasks);

      const accuracy = await calculator.getEstimateAccuracy();

      expect(accuracy.totalTasks).toBe(3);
      expect(accuracy.totalEstimatedSessions).toBe(12); // 4 + 6 + 2
      expect(accuracy.totalActualSessions).toBe(15); // 5 + 5 + 5
      expect(accuracy.averageVariance).toBeCloseTo(0.25, 2); // (15-12)/12 = 0.25
      expect(accuracy.underestimatedCount).toBeGreaterThan(0);
    });
  });

  describe('compareEstimateVsActual', () => {
    it('should provide detailed comparison for a task', async () => {
      const task = {
        id: 'task-1',
        title: 'Test Task',
        status: 'complete',
        estimated_sessions_opus: 3,
        estimated_sessions_sonnet: 5,
        actual_sessions_opus: 4,
        actual_sessions_sonnet: 6,
        actual_tokens_opus: 200000,
        actual_tokens_sonnet: 300000,
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T16:00:00Z',
      };

      mockClient.setResult('tc_tasks', [task]);
      mockClient.setResult('tc_model_pricing', [
        { model: 'opus', input_price_per_million: '15', output_price_per_million: '75' },
        { model: 'sonnet', input_price_per_million: '3', output_price_per_million: '15' },
      ]);

      const comparison = await calculator.compareEstimateVsActual('task-1');

      expect(comparison.taskId).toBe('task-1');
      expect(comparison.sessions.estimated.opus).toBe(3);
      expect(comparison.sessions.estimated.sonnet).toBe(5);
      expect(comparison.sessions.actual.opus).toBe(4);
      expect(comparison.sessions.actual.sonnet).toBe(6);
      expect(comparison.sessions.variance.opus).toBeCloseTo(0.333, 2); // (4-3)/3
      expect(comparison.sessions.variance.sonnet).toBeCloseTo(0.2, 2); // (6-5)/5
    });
  });
});
