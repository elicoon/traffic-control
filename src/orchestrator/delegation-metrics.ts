import { randomUUID } from 'node:crypto';
import { ModelType } from '../scheduler/index.js';

/**
 * Delegation Metrics Types and Manager
 *
 * Tracks metrics for task delegations to sub-agents including:
 * - Context tokens passed to sub-agent
 * - Task completion success/failure
 * - Time to completion
 * - Whether sub-agent asked questions
 */

/**
 * Status of a delegation
 */
export type DelegationStatus = 'active' | 'completed' | 'failed';

/**
 * Outcome of a completed delegation
 */
export type DelegationOutcome = 'success' | 'failure' | 'timeout' | 'cancelled';

/**
 * Represents metrics for a single delegation
 */
export interface DelegationMetrics {
  /** Unique identifier for this delegation */
  id: string;

  /** Task ID that was delegated */
  taskId: string;

  /** Session ID of the spawned agent */
  sessionId: string;

  /** Model used for the delegation (opus, sonnet, haiku) */
  model: ModelType;

  /** Number of context tokens passed to the sub-agent */
  contextTokens: number;

  /** Current status of the delegation */
  status: DelegationStatus;

  /** Outcome when completed (null if still active) */
  outcome: DelegationOutcome | null;

  /** Whether the sub-agent asked any questions */
  askedQuestions: boolean;

  /** Number of questions asked by the sub-agent */
  questionCount: number;

  /** When the delegation started */
  startedAt: Date;

  /** When the delegation completed (null if still active) */
  completedAt: Date | null;

  /** Time to completion in milliseconds (null if still active) */
  durationMs: number | null;

  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Input for recording a new delegation
 */
export interface RecordDelegationInput {
  /** Task ID being delegated */
  taskId: string;

  /** Session ID of the spawned agent */
  sessionId: string;

  /** Model used for the delegation */
  model: ModelType;

  /** Number of context tokens passed to the sub-agent */
  contextTokens: number;
}

/**
 * Input for completing a delegation
 */
export interface CompleteDelegationInput {
  /** Outcome of the delegation */
  outcome: DelegationOutcome;

  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Summary statistics for delegations
 */
export interface DelegationSummary {
  /** Total number of delegations */
  totalDelegations: number;

  /** Number of active delegations */
  activeDelegations: number;

  /** Number of completed delegations */
  completedDelegations: number;

  /** Number of successful delegations */
  successfulDelegations: number;

  /** Number of failed delegations */
  failedDelegations: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Total questions asked across all delegations */
  totalQuestionsAsked: number;

  /** Percentage of delegations that asked questions (0-1) */
  questionRate: number;

  /** Average duration in milliseconds (completed only) */
  avgDurationMs: number;

  /** Average context tokens passed */
  avgContextTokens: number;

  /** Breakdown by model */
  byModel: Record<ModelType, ModelDelegationStats>;
}

/**
 * Model-specific delegation statistics
 */
export interface ModelDelegationStats {
  /** Total delegations for this model */
  total: number;

  /** Successful delegations */
  successful: number;

  /** Failed delegations */
  failed: number;

  /** Success rate for this model */
  successRate: number;

  /** Average duration for this model */
  avgDurationMs: number;

  /** Average context tokens for this model */
  avgContextTokens: number;
}

/**
 * Configuration options for the delegation metrics manager
 */
export interface DelegationMetricsConfig {
  /** Maximum number of completed delegations to retain in memory. Default: 1000 */
  maxRetainedDelegations?: number;

  /** Whether to auto-clean old completed delegations. Default: true */
  autoCleanup?: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<DelegationMetricsConfig> = {
  maxRetainedDelegations: 1000,
  autoCleanup: true,
};

/**
 * Manages delegation metrics tracking for the orchestrator.
 *
 * This class tracks metrics for each task delegation including context tokens,
 * completion status, duration, and whether the sub-agent asked questions.
 */
export class DelegationMetricsManager {
  private delegations: Map<string, DelegationMetrics> = new Map();
  private config: Required<DelegationMetricsConfig>;

  constructor(config?: DelegationMetricsConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Record a new delegation when spawning an agent for a task.
   *
   * @param input Delegation input data
   * @returns The created delegation metrics record
   */
  recordDelegation(input: RecordDelegationInput): DelegationMetrics {
    const id = randomUUID();
    const startedAt = new Date();

    const delegation: DelegationMetrics = {
      id,
      taskId: input.taskId,
      sessionId: input.sessionId,
      model: input.model,
      contextTokens: input.contextTokens,
      status: 'active',
      outcome: null,
      askedQuestions: false,
      questionCount: 0,
      startedAt,
      completedAt: null,
      durationMs: null,
    };

    this.delegations.set(id, delegation);

    // Trigger cleanup if needed
    if (this.config.autoCleanup) {
      this.cleanupOldDelegations();
    }

    return delegation;
  }

  /**
   * Record that a sub-agent asked a question.
   *
   * @param sessionId Session ID of the agent that asked
   */
  recordQuestion(sessionId: string): void {
    const delegation = this.getBySessionId(sessionId);
    if (delegation) {
      delegation.askedQuestions = true;
      delegation.questionCount += 1;
    }
  }

  /**
   * Complete a delegation with an outcome.
   *
   * @param sessionId Session ID of the completed agent
   * @param input Completion data
   * @returns Updated delegation metrics or undefined if not found
   */
  completeDelegation(sessionId: string, input: CompleteDelegationInput): DelegationMetrics | undefined {
    const delegation = this.getBySessionId(sessionId);
    if (!delegation) {
      return undefined;
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - delegation.startedAt.getTime();

    delegation.status = input.outcome === 'success' ? 'completed' : 'failed';
    delegation.outcome = input.outcome;
    delegation.completedAt = completedAt;
    delegation.durationMs = durationMs;

    if (input.errorMessage) {
      delegation.errorMessage = input.errorMessage;
    }

    // Trigger cleanup if needed
    if (this.config.autoCleanup) {
      this.cleanupOldDelegations();
    }

    return delegation;
  }

  /**
   * Get a delegation by its ID.
   *
   * @param id Delegation ID
   * @returns The delegation metrics or undefined
   */
  getDelegation(id: string): DelegationMetrics | undefined {
    return this.delegations.get(id);
  }

  /**
   * Get a delegation by session ID.
   *
   * @param sessionId Session ID of the agent
   * @returns The delegation metrics or undefined
   */
  getBySessionId(sessionId: string): DelegationMetrics | undefined {
    for (const delegation of this.delegations.values()) {
      if (delegation.sessionId === sessionId) {
        return delegation;
      }
    }
    return undefined;
  }

  /**
   * Get a delegation by task ID.
   *
   * @param taskId Task ID
   * @returns The delegation metrics or undefined
   */
  getByTaskId(taskId: string): DelegationMetrics | undefined {
    for (const delegation of this.delegations.values()) {
      if (delegation.taskId === taskId) {
        return delegation;
      }
    }
    return undefined;
  }

  /**
   * Get all active delegations.
   *
   * @returns Array of active delegation metrics
   */
  getActiveDelegations(): DelegationMetrics[] {
    return Array.from(this.delegations.values()).filter(d => d.status === 'active');
  }

  /**
   * Get all completed delegations.
   *
   * @returns Array of completed delegation metrics
   */
  getCompletedDelegations(): DelegationMetrics[] {
    return Array.from(this.delegations.values()).filter(
      d => d.status === 'completed' || d.status === 'failed'
    );
  }

  /**
   * Get all delegations.
   *
   * @returns Array of all delegation metrics
   */
  getAllDelegations(): DelegationMetrics[] {
    return Array.from(this.delegations.values());
  }

  /**
   * Get summary statistics for all delegations.
   *
   * @returns Delegation summary statistics
   */
  getSummary(): DelegationSummary {
    const all = this.getAllDelegations();
    const completed = this.getCompletedDelegations();
    const active = this.getActiveDelegations();
    const successful = completed.filter(d => d.outcome === 'success');
    const failed = completed.filter(d => d.outcome !== 'success');
    const withQuestions = all.filter(d => d.askedQuestions);

    // Calculate averages
    const avgDurationMs =
      completed.length > 0
        ? completed.reduce((sum, d) => sum + (d.durationMs || 0), 0) / completed.length
        : 0;

    const avgContextTokens =
      all.length > 0 ? all.reduce((sum, d) => sum + d.contextTokens, 0) / all.length : 0;

    const totalQuestionsAsked = all.reduce((sum, d) => sum + d.questionCount, 0);

    // Calculate per-model stats
    const byModel = this.calculateModelStats(all);

    return {
      totalDelegations: all.length,
      activeDelegations: active.length,
      completedDelegations: completed.length,
      successfulDelegations: successful.length,
      failedDelegations: failed.length,
      successRate: completed.length > 0 ? successful.length / completed.length : 0,
      totalQuestionsAsked,
      questionRate: all.length > 0 ? withQuestions.length / all.length : 0,
      avgDurationMs,
      avgContextTokens,
      byModel,
    };
  }

  /**
   * Calculate model-specific statistics.
   */
  private calculateModelStats(
    delegations: DelegationMetrics[]
  ): Record<'opus' | 'sonnet' | 'haiku', ModelDelegationStats> {
    const models: ModelType[] = ['opus', 'sonnet', 'haiku'];
    const result: Record<ModelType, ModelDelegationStats> = {} as Record<
      ModelType,
      ModelDelegationStats
    >;

    for (const model of models) {
      const modelDelegations = delegations.filter(d => d.model === model);
      const completed = modelDelegations.filter(d => d.status !== 'active');
      const successful = completed.filter(d => d.outcome === 'success');

      const avgDurationMs =
        completed.length > 0
          ? completed.reduce((sum, d) => sum + (d.durationMs || 0), 0) / completed.length
          : 0;

      const avgContextTokens =
        modelDelegations.length > 0
          ? modelDelegations.reduce((sum, d) => sum + d.contextTokens, 0) / modelDelegations.length
          : 0;

      result[model] = {
        total: modelDelegations.length,
        successful: successful.length,
        failed: completed.length - successful.length,
        successRate: completed.length > 0 ? successful.length / completed.length : 0,
        avgDurationMs,
        avgContextTokens,
      };
    }

    return result;
  }

  /**
   * Remove a delegation by ID.
   *
   * @param id Delegation ID to remove
   */
  removeDelegation(id: string): void {
    this.delegations.delete(id);
  }

  /**
   * Clear all delegations.
   */
  clear(): void {
    this.delegations.clear();
  }

  /**
   * Get the current configuration.
   *
   * @returns The resolved configuration
   */
  getConfig(): Required<DelegationMetricsConfig> {
    return { ...this.config };
  }

  /**
   * Clean up old completed delegations if we exceed the retention limit.
   * Removes oldest completed delegations first.
   */
  private cleanupOldDelegations(): void {
    const completed = this.getCompletedDelegations();
    if (completed.length <= this.config.maxRetainedDelegations) {
      return;
    }

    // Sort by completion time (oldest first)
    const sorted = completed.sort(
      (a, b) => (a.completedAt?.getTime() || 0) - (b.completedAt?.getTime() || 0)
    );

    // Remove excess
    const excess = completed.length - this.config.maxRetainedDelegations;
    for (let i = 0; i < excess; i++) {
      this.delegations.delete(sorted[i].id);
    }
  }
}
