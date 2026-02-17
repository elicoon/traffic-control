import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logging/index.js';

const log = logger.child('CostTracker');

/**
 * Hardcoded fallback pricing (per 1M tokens) used when DB pricing is unavailable.
 * Values match Anthropic's published pricing as of 2026-01.
 */
const FALLBACK_PRICING: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.25, output: 1.25 },
};

/**
 * Model pricing information from the database
 */
export interface ModelPricing {
  model: 'opus' | 'sonnet' | 'haiku' | string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  effectiveFrom: Date;
  effectiveUntil?: Date;
}

/**
 * Result of a cost calculation
 */
export interface CostCalculation {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  model: string;
  pricingDate: Date;
}

/**
 * Session cost summary
 */
export interface SessionCostSummary {
  sessionId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  costByModel: Record<string, CostCalculation>;
}

/**
 * Cost estimate input
 */
export interface CostEstimateInput {
  opusSessions?: number;
  sonnetSessions?: number;
  haikuSessions?: number;
  avgInputTokensPerSession?: number;
  avgOutputTokensPerSession?: number;
}

/**
 * Cost estimate result
 */
export interface CostEstimate {
  opusCost: number;
  sonnetCost: number;
  haikuCost: number;
  totalCost: number;
  breakdown: {
    model: string;
    sessions: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    cost: number;
  }[];
}

/**
 * Input for adding new pricing
 */
export interface AddPricingInput {
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  effectiveFrom: Date;
}

/**
 * Database row for model pricing
 */
interface ModelPricingRow {
  id: string;
  model: string;
  input_price_per_million: string;
  output_price_per_million: string;
  effective_from: string;
  effective_until: string | null;
}

/**
 * Database row for usage log
 */
interface UsageLogRow {
  id: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

/**
 * CostTracker - Tracks and calculates costs using historical pricing
 *
 * Uses the tc_model_pricing table to store pricing history and
 * calculates costs based on the pricing effective at the time of use.
 */
export class CostTracker {
  // Default average tokens per session (can be overridden)
  static readonly DEFAULT_AVG_INPUT_TOKENS = 50000;
  static readonly DEFAULT_AVG_OUTPUT_TOKENS = 10000;

  constructor(private client: SupabaseClient) {}

  /**
   * Get pricing for a specific model, optionally at a specific point in time
   */
  async getPricingForModel(model: string, atDate?: Date): Promise<ModelPricing | null> {
    const targetDate = atDate ?? new Date();

    try {
      const { data, error } = await this.client
        .from('tc_model_pricing')
        .select('*')
        .eq('model', model)
        .lte('effective_from', targetDate.toISOString())
        .or(`effective_until.is.null,effective_until.gte.${targetDate.toISOString()}`)
        .order('effective_from', { ascending: false })
        .limit(1);

      if (!error) {
        const rows = data as ModelPricingRow[];
        if (rows && rows.length > 0) {
          return this.rowToModelPricing(rows[0]);
        }
      } else {
        log.warn('Database pricing query failed, using fallback pricing', {
          model,
          error: error.message,
        });
      }
    } catch (err) {
      log.warn('Database pricing unavailable, using fallback pricing', {
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Use fallback pricing if available for this model
    return this.getFallbackPricing(model);
  }

  /**
   * Get all current pricing (where effective_until is null)
   */
  async getAllCurrentPricing(): Promise<ModelPricing[]> {
    try {
      const { data, error } = await this.client
        .from('tc_model_pricing')
        .select('*')
        .is('effective_until', null)
        .order('model');

      if (!error) {
        const rows = data as ModelPricingRow[];
        if (rows && rows.length > 0) {
          return rows.map(row => this.rowToModelPricing(row));
        }
      } else {
        log.warn('Database pricing query failed, using fallback pricing for all models', {
          error: error.message,
        });
      }
    } catch (err) {
      log.warn('Database pricing unavailable, using fallback pricing for all models', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Return fallback pricing for all known models
    return this.getAllFallbackPricing();
  }

  /**
   * Calculate cost for token usage
   */
  async calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    atDate?: Date
  ): Promise<CostCalculation> {
    const pricing = await this.getPricingForModel(model, atDate);

    if (!pricing) {
      throw new Error(`No pricing found for model: ${model}`);
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;

    return {
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      model,
      pricingDate: atDate ?? new Date(),
    };
  }

  /**
   * Calculate total cost for a session by aggregating all usage logs
   */
  async calculateSessionCost(sessionId: string): Promise<SessionCostSummary> {
    // Get all usage logs for the session
    const { data: logsData, error: logsError } = await this.client
      .from('tc_usage_log')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (logsError) {
      throw new Error(`Failed to get usage logs: ${logsError.message}`);
    }

    const logs = logsData as UsageLogRow[];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    const costByModel: Record<string, CostCalculation> = {};

    // Group logs by model and calculate costs
    for (const log of logs) {
      const logDate = new Date(log.created_at);
      const cost = await this.calculateCost(
        log.model,
        log.input_tokens,
        log.output_tokens,
        logDate
      );

      totalInputTokens += log.input_tokens;
      totalOutputTokens += log.output_tokens;
      totalCost += cost.totalCost;

      // Aggregate by model
      if (!costByModel[log.model]) {
        costByModel[log.model] = {
          inputTokens: 0,
          outputTokens: 0,
          inputCost: 0,
          outputCost: 0,
          totalCost: 0,
          model: log.model,
          pricingDate: logDate,
        };
      }

      costByModel[log.model].inputTokens += log.input_tokens;
      costByModel[log.model].outputTokens += log.output_tokens;
      costByModel[log.model].inputCost += cost.inputCost;
      costByModel[log.model].outputCost += cost.outputCost;
      costByModel[log.model].totalCost += cost.totalCost;
    }

    return {
      sessionId,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      costByModel,
    };
  }

  /**
   * Add new pricing for a model (closes the previous pricing period)
   */
  async addPricing(input: AddPricingInput): Promise<ModelPricing> {
    // First, close any existing open pricing for this model
    const effectiveUntil = new Date(input.effectiveFrom.getTime() - 1);

    await this.client
      .from('tc_model_pricing')
      .update({ effective_until: effectiveUntil.toISOString() })
      .eq('model', input.model)
      .is('effective_until', null);

    // Insert the new pricing
    const { data, error } = await this.client
      .from('tc_model_pricing')
      .insert({
        model: input.model,
        input_price_per_million: input.inputPricePerMillion.toString(),
        output_price_per_million: input.outputPricePerMillion.toString(),
        effective_from: input.effectiveFrom.toISOString(),
        effective_until: null,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add pricing: ${error.message}`);
    }

    return this.rowToModelPricing(data as ModelPricingRow);
  }

  /**
   * Estimate cost for a given number of sessions
   */
  async estimateCost(input: CostEstimateInput): Promise<CostEstimate> {
    const pricing = await this.getAllCurrentPricing();
    const pricingByModel = new Map(pricing.map(p => [p.model, p]));

    const avgInput = input.avgInputTokensPerSession ?? CostTracker.DEFAULT_AVG_INPUT_TOKENS;
    const avgOutput = input.avgOutputTokensPerSession ?? CostTracker.DEFAULT_AVG_OUTPUT_TOKENS;

    const breakdown: CostEstimate['breakdown'] = [];
    let opusCost = 0;
    let sonnetCost = 0;
    let haikuCost = 0;

    // Calculate opus cost
    if (input.opusSessions && input.opusSessions > 0) {
      const opusPricing = pricingByModel.get('opus');
      if (opusPricing) {
        const sessions = input.opusSessions;
        const totalInput = sessions * avgInput;
        const totalOutput = sessions * avgOutput;
        opusCost =
          (totalInput / 1_000_000) * opusPricing.inputPricePerMillion +
          (totalOutput / 1_000_000) * opusPricing.outputPricePerMillion;

        breakdown.push({
          model: 'opus',
          sessions,
          estimatedInputTokens: totalInput,
          estimatedOutputTokens: totalOutput,
          cost: opusCost,
        });
      }
    }

    // Calculate sonnet cost
    if (input.sonnetSessions && input.sonnetSessions > 0) {
      const sonnetPricing = pricingByModel.get('sonnet');
      if (sonnetPricing) {
        const sessions = input.sonnetSessions;
        const totalInput = sessions * avgInput;
        const totalOutput = sessions * avgOutput;
        sonnetCost =
          (totalInput / 1_000_000) * sonnetPricing.inputPricePerMillion +
          (totalOutput / 1_000_000) * sonnetPricing.outputPricePerMillion;

        breakdown.push({
          model: 'sonnet',
          sessions,
          estimatedInputTokens: totalInput,
          estimatedOutputTokens: totalOutput,
          cost: sonnetCost,
        });
      }
    }

    // Calculate haiku cost
    if (input.haikuSessions && input.haikuSessions > 0) {
      const haikuPricing = pricingByModel.get('haiku');
      if (haikuPricing) {
        const sessions = input.haikuSessions;
        const totalInput = sessions * avgInput;
        const totalOutput = sessions * avgOutput;
        haikuCost =
          (totalInput / 1_000_000) * haikuPricing.inputPricePerMillion +
          (totalOutput / 1_000_000) * haikuPricing.outputPricePerMillion;

        breakdown.push({
          model: 'haiku',
          sessions,
          estimatedInputTokens: totalInput,
          estimatedOutputTokens: totalOutput,
          cost: haikuCost,
        });
      }
    }

    return {
      opusCost,
      sonnetCost,
      haikuCost,
      totalCost: opusCost + sonnetCost + haikuCost,
      breakdown,
    };
  }

  /**
   * Get fallback pricing for a single model, or null if no fallback exists
   */
  private getFallbackPricing(model: string): ModelPricing | null {
    const fallback = FALLBACK_PRICING[model];
    if (!fallback) {
      return null;
    }

    log.warn('Using fallback pricing — database pricing unavailable', { model });

    return {
      model: model as ModelPricing['model'],
      inputPricePerMillion: fallback.input,
      outputPricePerMillion: fallback.output,
      effectiveFrom: new Date(0),
    };
  }

  /**
   * Get fallback pricing for all known models
   */
  private getAllFallbackPricing(): ModelPricing[] {
    log.warn('Using fallback pricing for all models — database pricing unavailable');

    return Object.entries(FALLBACK_PRICING).map(([model, prices]) => ({
      model: model as ModelPricing['model'],
      inputPricePerMillion: prices.input,
      outputPricePerMillion: prices.output,
      effectiveFrom: new Date(0),
    }));
  }

  /**
   * Convert database row to ModelPricing
   */
  private rowToModelPricing(row: ModelPricingRow): ModelPricing {
    return {
      model: row.model as ModelPricing['model'],
      inputPricePerMillion: parseFloat(row.input_price_per_million),
      outputPricePerMillion: parseFloat(row.output_price_per_million),
      effectiveFrom: new Date(row.effective_from),
      effectiveUntil: row.effective_until ? new Date(row.effective_until) : undefined,
    };
  }
}
