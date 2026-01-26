import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CostTracker,
  type ModelPricing,
  type CostCalculation,
} from './cost-tracker.js';
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

  const chainMethods = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => mockInsertResult),
  };

  chainMethods.select.mockImplementation(() => {
    const result = { ...chainMethods };
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

  chainMethods.limit.mockImplementation(() => {
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

  chainMethods.is.mockImplementation(() => {
    const result = { ...chainMethods };
    Object.defineProperty(result, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockSelectResult);
        return Promise.resolve(mockSelectResult);
      },
    });
    return result;
  });

  chainMethods.or.mockImplementation(() => {
    const result = { ...chainMethods };
    Object.defineProperty(result, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockSelectResult);
        return Promise.resolve(mockSelectResult);
      },
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
    chainMethods,
  };
}

describe('CostTracker', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let tracker: CostTracker;

  beforeEach(() => {
    mockClient = createMockClient();
    tracker = new CostTracker(mockClient.client);
  });

  describe('getPricingForModel', () => {
    it('should return current pricing for a model when no date specified', async () => {
      const pricingData = [{
        id: 'pricing-1',
        model: 'opus',
        input_price_per_million: '15.000000',
        output_price_per_million: '75.000000',
        effective_from: '2026-01-01T00:00:00Z',
        effective_until: null,
      }];

      mockClient.setSelectResult(pricingData);

      const pricing = await tracker.getPricingForModel('opus');

      expect(pricing).toBeDefined();
      expect(pricing!.model).toBe('opus');
      expect(pricing!.inputPricePerMillion).toBe(15);
      expect(pricing!.outputPricePerMillion).toBe(75);
      expect(mockClient.client.from).toHaveBeenCalledWith('tc_model_pricing');
    });

    it('should return historical pricing for a specific date', async () => {
      const pricingData = [{
        id: 'pricing-old',
        model: 'sonnet',
        input_price_per_million: '2.500000',
        output_price_per_million: '12.500000',
        effective_from: '2025-06-01T00:00:00Z',
        effective_until: '2025-12-31T23:59:59Z',
      }];

      mockClient.setSelectResult(pricingData);

      const pricing = await tracker.getPricingForModel('sonnet', new Date('2025-07-15'));

      expect(pricing).toBeDefined();
      expect(pricing!.inputPricePerMillion).toBe(2.5);
      expect(pricing!.outputPricePerMillion).toBe(12.5);
    });

    it('should return null when no pricing found for model', async () => {
      mockClient.setSelectResult([]);

      const pricing = await tracker.getPricingForModel('unknown');

      expect(pricing).toBeNull();
    });

    it('should throw on database error', async () => {
      mockClient.setSelectResult(null, { message: 'Database error' });

      await expect(tracker.getPricingForModel('opus')).rejects.toThrow(
        'Failed to get pricing: Database error'
      );
    });
  });

  describe('getAllCurrentPricing', () => {
    it('should return all current pricing', async () => {
      const pricingData = [
        {
          id: 'pricing-1',
          model: 'opus',
          input_price_per_million: '15.000000',
          output_price_per_million: '75.000000',
          effective_from: '2026-01-01T00:00:00Z',
          effective_until: null,
        },
        {
          id: 'pricing-2',
          model: 'sonnet',
          input_price_per_million: '3.000000',
          output_price_per_million: '15.000000',
          effective_from: '2026-01-01T00:00:00Z',
          effective_until: null,
        },
        {
          id: 'pricing-3',
          model: 'haiku',
          input_price_per_million: '0.250000',
          output_price_per_million: '1.250000',
          effective_from: '2026-01-01T00:00:00Z',
          effective_until: null,
        },
      ];

      mockClient.setSelectResult(pricingData);

      const pricing = await tracker.getAllCurrentPricing();

      expect(pricing).toHaveLength(3);
      expect(pricing.find(p => p.model === 'opus')).toBeDefined();
      expect(pricing.find(p => p.model === 'sonnet')).toBeDefined();
      expect(pricing.find(p => p.model === 'haiku')).toBeDefined();
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for token usage with current pricing', async () => {
      const pricingData = [{
        id: 'pricing-1',
        model: 'opus',
        input_price_per_million: '15.000000',
        output_price_per_million: '75.000000',
        effective_from: '2026-01-01T00:00:00Z',
        effective_until: null,
      }];

      mockClient.setSelectResult(pricingData);

      const cost = await tracker.calculateCost('opus', 1000000, 100000);

      expect(cost.inputTokens).toBe(1000000);
      expect(cost.outputTokens).toBe(100000);
      expect(cost.inputCost).toBe(15); // 1M tokens * $15/M
      expect(cost.outputCost).toBe(7.5); // 100K tokens * $75/M
      expect(cost.totalCost).toBe(22.5);
      expect(cost.model).toBe('opus');
    });

    it('should calculate cost for small token counts', async () => {
      const pricingData = [{
        id: 'pricing-1',
        model: 'sonnet',
        input_price_per_million: '3.000000',
        output_price_per_million: '15.000000',
        effective_from: '2026-01-01T00:00:00Z',
        effective_until: null,
      }];

      mockClient.setSelectResult(pricingData);

      const cost = await tracker.calculateCost('sonnet', 5000, 2000);

      // 5000 input tokens at $3/M = $0.015
      // 2000 output tokens at $15/M = $0.03
      expect(cost.inputCost).toBeCloseTo(0.015, 6);
      expect(cost.outputCost).toBeCloseTo(0.03, 6);
      expect(cost.totalCost).toBeCloseTo(0.045, 6);
    });

    it('should use historical pricing when date provided', async () => {
      const pricingData = [{
        id: 'pricing-old',
        model: 'haiku',
        input_price_per_million: '0.200000',
        output_price_per_million: '1.000000',
        effective_from: '2025-01-01T00:00:00Z',
        effective_until: '2025-12-31T23:59:59Z',
      }];

      mockClient.setSelectResult(pricingData);

      const cost = await tracker.calculateCost('haiku', 10000, 5000, new Date('2025-06-15'));

      // Using old pricing: 0.20/M input, 1.00/M output
      expect(cost.inputCost).toBeCloseTo(0.002, 6);
      expect(cost.outputCost).toBeCloseTo(0.005, 6);
    });

    it('should throw when no pricing available for model', async () => {
      mockClient.setSelectResult([]);

      await expect(tracker.calculateCost('unknown', 1000, 500)).rejects.toThrow(
        'No pricing found for model: unknown'
      );
    });
  });

  describe('calculateSessionCost', () => {
    it('should calculate total cost for a session with multiple log entries', async () => {
      const opusPricing = [{
        id: 'pricing-opus',
        model: 'opus',
        input_price_per_million: '15.000000',
        output_price_per_million: '75.000000',
        effective_from: '2026-01-01T00:00:00Z',
        effective_until: null,
      }];

      const usageLogs = [
        {
          id: 'log-1',
          session_id: 'session-123',
          model: 'opus',
          input_tokens: 50000,
          output_tokens: 10000,
          created_at: '2026-01-15T10:00:00Z',
        },
        {
          id: 'log-2',
          session_id: 'session-123',
          model: 'opus',
          input_tokens: 30000,
          output_tokens: 5000,
          created_at: '2026-01-15T10:30:00Z',
        },
      ];

      // Create a fresh mock that handles both tables
      const createChainMethods = (defaultData: unknown) => {
        const chainMethods = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn(),
        };

        // Make all chain methods return a thenable that resolves to the default data
        const makeThenable = (data: unknown) => ({
          ...chainMethods,
          then: (resolve: (val: unknown) => void) => {
            resolve({ data, error: null });
            return Promise.resolve({ data, error: null });
          },
        });

        chainMethods.select.mockReturnValue(makeThenable(defaultData));
        chainMethods.eq.mockReturnValue(makeThenable(defaultData));
        chainMethods.is.mockReturnValue(makeThenable(defaultData));
        chainMethods.lte.mockReturnValue(makeThenable(defaultData));
        chainMethods.or.mockReturnValue(makeThenable(defaultData));
        chainMethods.order.mockReturnValue(makeThenable(defaultData));
        chainMethods.limit.mockReturnValue(makeThenable(defaultData));

        return chainMethods;
      };

      mockClient.client.from = vi.fn().mockImplementation((table: string) => {
        if (table === 'tc_usage_log') {
          return createChainMethods(usageLogs);
        } else if (table === 'tc_model_pricing') {
          return createChainMethods(opusPricing);
        }
        return createChainMethods([]);
      });

      const sessionCost = await tracker.calculateSessionCost('session-123');

      // Total: 80000 input, 15000 output
      // Cost: 80000 * 15/1M + 15000 * 75/1M = 1.2 + 1.125 = 2.325
      expect(sessionCost.totalInputTokens).toBe(80000);
      expect(sessionCost.totalOutputTokens).toBe(15000);
      expect(sessionCost.totalCost).toBeCloseTo(2.325, 3);
    });
  });

  describe('addPricing', () => {
    it('should add new pricing for a model', async () => {
      const newPricing = {
        id: 'new-pricing',
        model: 'opus',
        input_price_per_million: '20.000000',
        output_price_per_million: '100.000000',
        effective_from: '2026-02-01T00:00:00Z',
        effective_until: null,
      };

      mockClient.setInsertResult(newPricing);

      const result = await tracker.addPricing({
        model: 'opus',
        inputPricePerMillion: 20,
        outputPricePerMillion: 100,
        effectiveFrom: new Date('2026-02-01'),
      });

      expect(result.model).toBe('opus');
      expect(result.inputPricePerMillion).toBe(20);
      expect(mockClient.chainMethods.insert).toHaveBeenCalled();
    });

    it('should close previous pricing when adding new pricing', async () => {
      // First call updates old pricing
      const updateResult = {
        data: { id: 'old-pricing' },
        error: null,
      };

      // Second call inserts new pricing
      const newPricing = {
        id: 'new-pricing',
        model: 'sonnet',
        input_price_per_million: '5.000000',
        output_price_per_million: '25.000000',
        effective_from: '2026-02-01T00:00:00Z',
        effective_until: null,
      };

      mockClient.setInsertResult(newPricing);

      const result = await tracker.addPricing({
        model: 'sonnet',
        inputPricePerMillion: 5,
        outputPricePerMillion: 25,
        effectiveFrom: new Date('2026-02-01'),
      });

      expect(result.inputPricePerMillion).toBe(5);
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost for given sessions by model', async () => {
      const pricingData = [
        {
          id: 'pricing-1',
          model: 'opus',
          input_price_per_million: '15.000000',
          output_price_per_million: '75.000000',
          effective_from: '2026-01-01T00:00:00Z',
          effective_until: null,
        },
        {
          id: 'pricing-2',
          model: 'sonnet',
          input_price_per_million: '3.000000',
          output_price_per_million: '15.000000',
          effective_from: '2026-01-01T00:00:00Z',
          effective_until: null,
        },
      ];

      mockClient.setSelectResult(pricingData);

      // Assuming average tokens per session (configurable defaults)
      const estimate = await tracker.estimateCost({
        opusSessions: 2,
        sonnetSessions: 5,
        avgInputTokensPerSession: 50000,
        avgOutputTokensPerSession: 10000,
      });

      // Opus: 2 sessions * (50K * 15/1M + 10K * 75/1M) = 2 * (0.75 + 0.75) = 3.00
      // Sonnet: 5 sessions * (50K * 3/1M + 10K * 15/1M) = 5 * (0.15 + 0.15) = 1.50
      // Total: 4.50
      expect(estimate.opusCost).toBeCloseTo(3.0, 2);
      expect(estimate.sonnetCost).toBeCloseTo(1.5, 2);
      expect(estimate.totalCost).toBeCloseTo(4.5, 2);
    });
  });
});
