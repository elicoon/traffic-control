/**
 * Context Budget Types and Interfaces
 *
 * These types support tracking context window utilization to prevent
 * performance degradation from overloaded context in the orchestrator.
 */

/**
 * Represents the current context budget status
 */
export interface ContextBudget {
  /** Maximum tokens available (e.g., 200k for Claude) */
  maxTokens: number;

  /** Target utilization threshold (0.5 = 50%) */
  targetUtilization: number;

  /** Current estimated token usage */
  currentEstimate: number;

  /** Timestamp of last estimation */
  lastEstimated: Date;
}

/**
 * Category of context entry
 */
export type ContextCategory = 'system' | 'task' | 'response' | 'history';

/**
 * Represents a single chunk of context being tracked
 */
export interface ContextEntry {
  /** Unique identifier for this context chunk */
  id: string;

  /** Category: 'system' | 'task' | 'response' | 'history' */
  category: ContextCategory;

  /** Estimated token count */
  tokens: number;

  /** When this context was added */
  addedAt: Date;

  /** Whether this can be summarized/compressed */
  compressible: boolean;

  /** Reference to task/session if applicable */
  referenceId?: string;
}

/**
 * Configuration options for the context budget manager
 */
export interface ContextBudgetConfig {
  /** Maximum tokens available. Default: 200000 */
  maxTokens?: number;

  /** Target utilization threshold (0-1). Default: 0.5 (50%) */
  targetUtilization?: number;

  /** Warning threshold (0-1). Default: 0.4 (40%) */
  warningThreshold?: number;

  /** Tokens per character estimate. Default: 0.25 */
  tokensPerChar?: number;
}

/**
 * Input for adding a new context entry (without auto-generated fields)
 */
export type ContextEntryInput = Omit<ContextEntry, 'id' | 'addedAt' | 'tokens'> & {
  /** Optional pre-calculated token count. If not provided, will be estimated from content */
  tokens?: number;
  /** Content to estimate tokens from if tokens not provided */
  content?: string;
};
