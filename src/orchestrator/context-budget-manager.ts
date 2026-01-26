import { randomUUID } from 'node:crypto';
import {
  ContextBudget,
  ContextBudgetConfig,
  ContextCategory,
  ContextEntry,
  ContextEntryInput,
} from './context-budget.js';

/**
 * Default configuration values for context budget management
 */
const DEFAULT_CONFIG: Required<ContextBudgetConfig> = {
  maxTokens: 200000,
  targetUtilization: 0.5,
  warningThreshold: 0.4,
  tokensPerChar: 0.25,
};

/**
 * Manages context budget tracking for the orchestrator.
 *
 * This class tracks all context entries added to the orchestrator,
 * estimates token usage using character count heuristics, and provides
 * warnings when approaching utilization thresholds.
 */
export class ContextBudgetManager {
  private entries: Map<string, ContextEntry> = new Map();
  private config: Required<ContextBudgetConfig>;

  constructor(config?: ContextBudgetConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Estimate token count for a given text string.
   * Uses a configurable tokens-per-character heuristic.
   *
   * @param text The text to estimate tokens for
   * @returns Estimated token count
   */
  estimateTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }
    return Math.ceil(text.length * this.config.tokensPerChar);
  }

  /**
   * Add a context entry and get updated budget status.
   *
   * @param input Entry input (without auto-generated id and addedAt)
   * @returns Updated context budget status
   */
  addEntry(input: ContextEntryInput): ContextBudget {
    const id = randomUUID();
    const addedAt = new Date();

    // Calculate tokens from content if not provided
    let tokens: number;
    if (input.tokens !== undefined) {
      tokens = input.tokens;
    } else if (input.content !== undefined) {
      tokens = this.estimateTokens(input.content);
    } else {
      tokens = 0;
    }

    const entry: ContextEntry = {
      id,
      category: input.category,
      tokens,
      addedAt,
      compressible: input.compressible,
      referenceId: input.referenceId,
    };

    this.entries.set(id, entry);

    return this.getBudget();
  }

  /**
   * Remove a context entry by ID.
   *
   * @param id The entry ID to remove
   */
  removeEntry(id: string): void {
    this.entries.delete(id);
  }

  /**
   * Update an existing context entry with new content and recalculate tokens.
   *
   * @param id The entry ID to update
   * @param content New content for the entry
   * @returns true if the entry was updated, false if not found
   */
  updateEntry(id: string, content: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }

    const newTokens = this.estimateTokens(content);
    this.entries.set(id, {
      ...entry,
      tokens: newTokens,
    });

    return true;
  }

  /**
   * Remove all entries associated with a reference ID.
   *
   * @param referenceId The reference ID to remove entries for
   * @returns Number of entries removed
   */
  removeEntriesByReference(referenceId: string): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.referenceId === referenceId) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get current budget status.
   *
   * @returns Current context budget information
   */
  getBudget(): ContextBudget {
    const currentEstimate = this.calculateTotalTokens();

    return {
      maxTokens: this.config.maxTokens,
      targetUtilization: this.config.targetUtilization,
      currentEstimate,
      lastEstimated: new Date(),
    };
  }

  /**
   * Check if we're within the safe operating range (under target utilization).
   *
   * @returns true if current usage is under the target utilization threshold
   */
  isWithinBudget(): boolean {
    const currentTokens = this.calculateTotalTokens();
    const threshold = this.config.maxTokens * this.config.targetUtilization;
    return currentTokens < threshold;
  }

  /**
   * Check if we should warn about approaching the limit.
   * Returns true when usage exceeds the warning threshold but is still under target.
   *
   * @returns true if a warning should be issued
   */
  shouldWarn(): boolean {
    const currentTokens = this.calculateTotalTokens();
    const warningThreshold = this.config.maxTokens * this.config.warningThreshold;
    const targetThreshold = this.config.maxTokens * this.config.targetUtilization;
    return currentTokens >= warningThreshold && currentTokens < targetThreshold;
  }

  /**
   * Get entries that can be compressed to free up space.
   * Returns compressible entries sorted by age (oldest first).
   *
   * @returns Array of compressible context entries
   */
  getCompressibleEntries(): ContextEntry[] {
    return Array.from(this.entries.values())
      .filter(entry => entry.compressible)
      .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());
  }

  /**
   * Get summary of context usage by category.
   *
   * @returns Record mapping category names to token counts
   */
  getUsageByCategory(): Record<ContextCategory, number> {
    const usage: Record<ContextCategory, number> = {
      system: 0,
      task: 0,
      response: 0,
      history: 0,
    };

    for (const entry of this.entries.values()) {
      usage[entry.category] += entry.tokens;
    }

    return usage;
  }

  /**
   * Get all entries for a specific category.
   *
   * @param category The category to filter by
   * @returns Array of context entries in the specified category
   */
  getEntriesByCategory(category: ContextCategory): ContextEntry[] {
    return Array.from(this.entries.values()).filter(entry => entry.category === category);
  }

  /**
   * Get all current entries.
   *
   * @returns Array of all context entries
   */
  getAllEntries(): ContextEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get a specific entry by ID.
   *
   * @param id The entry ID
   * @returns The context entry or undefined if not found
   */
  getEntry(id: string): ContextEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Get the current utilization ratio (0-1).
   *
   * @returns Current utilization as a ratio of max tokens
   */
  getCurrentUtilization(): number {
    return this.calculateTotalTokens() / this.config.maxTokens;
  }

  /**
   * Get the number of tokens available before hitting the target utilization.
   *
   * @returns Number of tokens remaining in budget
   */
  getRemainingBudget(): number {
    const targetTokens = this.config.maxTokens * this.config.targetUtilization;
    const remaining = targetTokens - this.calculateTotalTokens();
    return Math.max(0, remaining);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get the current configuration.
   *
   * @returns The resolved configuration with all defaults applied
   */
  getConfig(): Required<ContextBudgetConfig> {
    return { ...this.config };
  }

  /**
   * Calculate total tokens across all entries.
   */
  private calculateTotalTokens(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.tokens;
    }
    return total;
  }
}
