/**
 * Circuit Breaker - Automatic Safety Stops for TrafficControl
 *
 * Provides automatic safety mechanisms to pause all agent activity when:
 * - Any agent has consecutive errors exceeding threshold
 * - Global error rate exceeds threshold
 * - Total spend exceeds hard budget limit
 * - Token consumption exceeds limit without meaningful output
 *
 * When tripped:
 * - All agents are immediately paused
 * - Slack alert is sent with reason and details
 * - Manual reset is required via Slack command or restart
 */

import { EventBus } from '../events/event-bus.js';
import { createEvent } from '../events/event-types.js';
import { logger } from '../logging/index.js';
import { getClient } from '../db/client.js';

const log = logger.child('CircuitBreaker');

/**
 * Reason for circuit breaker trip
 */
export type CircuitBreakerTripReason =
  | 'consecutive_agent_errors'
  | 'global_error_rate'
  | 'budget_exceeded'
  | 'token_limit_exceeded'
  | 'manual';

/**
 * Status of the circuit breaker
 */
export interface CircuitBreakerStatus {
  /** Whether the circuit breaker is currently tripped */
  isTripped: boolean;
  /** Reason for the trip, if tripped */
  tripReason?: CircuitBreakerTripReason;
  /** Detailed message about the trip */
  tripMessage?: string;
  /** When the circuit breaker was tripped */
  trippedAt?: Date;
  /** Agent that caused the trip, if applicable */
  triggeringAgentId?: string;
  /** Per-agent consecutive error counts */
  agentErrorCounts: Map<string, number>;
  /** Recent operations for error rate calculation */
  recentOperations: OperationResult[];
  /** Total tokens consumed since last reset */
  totalTokensConsumed: number;
  /** Total spend since last reset */
  totalSpend: number;
  /** Count of meaningful outputs since last reset */
  meaningfulOutputCount: number;
}

/**
 * Result of an operation (success or error)
 */
export interface OperationResult {
  agentId: string;
  success: boolean;
  timestamp: Date;
  error?: Error;
  tokensUsed?: number;
  costUSD?: number;
  hasMeaningfulOutput?: boolean;
}

/**
 * Configuration for the circuit breaker
 */
export interface CircuitBreakerConfig {
  /** Maximum consecutive errors per agent before trip (default: 3) */
  maxConsecutiveAgentErrors: number;
  /** Error rate threshold (0-1) to trigger trip (default: 0.5) */
  errorRateThreshold: number;
  /** Number of recent operations to consider for error rate (default: 10) */
  errorRateWindowSize: number;
  /** Hard budget limit in USD (default: 100) */
  hardBudgetLimit: number;
  /** Token limit without meaningful output (default: 100000) */
  tokenLimitWithoutOutput: number;
  /** Callback to pause all agents when tripped */
  onTrip?: (reason: CircuitBreakerTripReason, message: string) => Promise<void>;
  /** Callback to send Slack alerts */
  sendSlackAlert?: (message: string, priority: 'high') => Promise<void>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveAgentErrors: 3,
  errorRateThreshold: 0.5,
  errorRateWindowSize: 10,
  hardBudgetLimit: 100,
  tokenLimitWithoutOutput: 100000,
};

/**
 * Circuit breaker event logged to database
 */
export interface CircuitBreakerEvent {
  event_type: 'trip' | 'reset' | 'error_recorded' | 'success_recorded';
  reason?: CircuitBreakerTripReason;
  agent_id?: string;
  message?: string;
  details?: Record<string, unknown>;
  created_at: Date;
}

/**
 * CircuitBreaker - Automatic safety stops for agent orchestration
 *
 * Monitors agent operations and automatically pauses all activity when
 * safety thresholds are exceeded. Requires manual reset to resume.
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private eventBus: EventBus | null = null;
  private isTrippedState: boolean = false;
  private tripReason?: CircuitBreakerTripReason;
  private tripMessage?: string;
  private trippedAt?: Date;
  private triggeringAgentId?: string;
  private agentErrorCounts: Map<string, number> = new Map();
  private recentOperations: OperationResult[] = [];
  private totalTokensConsumed: number = 0;
  private totalSpend: number = 0;
  private meaningfulOutputCount: number = 0;
  private tokensSinceLastMeaningfulOutput: number = 0;

  constructor(config: Partial<CircuitBreakerConfig> = {}, eventBus?: EventBus) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = eventBus || null;

    log.info('CircuitBreaker initialized', {
      maxConsecutiveAgentErrors: this.config.maxConsecutiveAgentErrors,
      errorRateThreshold: this.config.errorRateThreshold,
      errorRateWindowSize: this.config.errorRateWindowSize,
      hardBudgetLimit: this.config.hardBudgetLimit,
      tokenLimitWithoutOutput: this.config.tokenLimitWithoutOutput,
    });
  }

  /**
   * Records a successful operation for an agent
   */
  recordSuccess(
    agentId: string,
    options?: { tokensUsed?: number; costUSD?: number; hasMeaningfulOutput?: boolean }
  ): void {
    if (this.isTrippedState) {
      log.warn('Attempted to record success while circuit breaker is tripped', { agentId });
      return;
    }

    // Reset consecutive error count for this agent
    this.agentErrorCounts.set(agentId, 0);

    // Track tokens and cost
    const tokensUsed = options?.tokensUsed ?? 0;
    const costUSD = options?.costUSD ?? 0;
    this.totalTokensConsumed += tokensUsed;
    this.totalSpend += costUSD;

    // Track meaningful output
    const hasMeaningfulOutput = options?.hasMeaningfulOutput ?? true;
    if (hasMeaningfulOutput) {
      this.meaningfulOutputCount++;
      this.tokensSinceLastMeaningfulOutput = 0;
    } else {
      this.tokensSinceLastMeaningfulOutput += tokensUsed;
    }

    // Add to recent operations
    const operation: OperationResult = {
      agentId,
      success: true,
      timestamp: new Date(),
      tokensUsed,
      costUSD,
      hasMeaningfulOutput,
    };
    this.addOperation(operation);

    log.debug('Success recorded', {
      agentId,
      tokensUsed,
      costUSD,
      hasMeaningfulOutput,
      totalTokensConsumed: this.totalTokensConsumed,
      totalSpend: this.totalSpend,
    });

    // Log event to database (async, don't block)
    this.logEventToDatabase({
      event_type: 'success_recorded',
      agent_id: agentId,
      details: { tokensUsed, costUSD, hasMeaningfulOutput },
      created_at: new Date(),
    }).catch((err) => {
      log.error('Failed to log success event to database', err instanceof Error ? err : new Error(String(err)));
    });

    // Check if budget exceeded
    this.checkBudgetLimit();

    // Check if token limit exceeded without meaningful output
    this.checkTokenLimitWithoutOutput();
  }

  /**
   * Records an error for an agent
   */
  recordError(agentId: string, error: Error, options?: { tokensUsed?: number; costUSD?: number }): void {
    if (this.isTrippedState) {
      log.warn('Attempted to record error while circuit breaker is tripped', { agentId, error: error.message });
      return;
    }

    // Increment consecutive error count for this agent
    const currentCount = this.agentErrorCounts.get(agentId) ?? 0;
    const newCount = currentCount + 1;
    this.agentErrorCounts.set(agentId, newCount);

    // Track tokens and cost even for errors
    const tokensUsed = options?.tokensUsed ?? 0;
    const costUSD = options?.costUSD ?? 0;
    this.totalTokensConsumed += tokensUsed;
    this.totalSpend += costUSD;
    this.tokensSinceLastMeaningfulOutput += tokensUsed;

    // Add to recent operations
    const operation: OperationResult = {
      agentId,
      success: false,
      timestamp: new Date(),
      error,
      tokensUsed,
      costUSD,
      hasMeaningfulOutput: false,
    };
    this.addOperation(operation);

    log.warn('Error recorded', {
      agentId,
      consecutiveErrors: newCount,
      maxAllowed: this.config.maxConsecutiveAgentErrors,
      error: error.message,
      tokensUsed,
      costUSD,
    });

    // Log event to database (async, don't block)
    this.logEventToDatabase({
      event_type: 'error_recorded',
      agent_id: agentId,
      message: error.message,
      details: { consecutiveErrors: newCount, tokensUsed, costUSD },
      created_at: new Date(),
    }).catch((err) => {
      log.error('Failed to log error event to database', err instanceof Error ? err : new Error(String(err)));
    });

    // Check if consecutive error threshold exceeded
    if (newCount >= this.config.maxConsecutiveAgentErrors) {
      this.trip(
        'consecutive_agent_errors',
        `Agent ${agentId} has ${newCount} consecutive errors. Latest: ${error.message}`,
        agentId
      );
      return;
    }

    // Check global error rate
    this.checkGlobalErrorRate();

    // Check if budget exceeded
    this.checkBudgetLimit();

    // Check if token limit exceeded without meaningful output
    this.checkTokenLimitWithoutOutput();
  }

  /**
   * Checks if the circuit breaker is currently tripped
   */
  isTripped(): boolean {
    return this.isTrippedState;
  }

  /**
   * Manually trips the circuit breaker
   */
  trip(reason: CircuitBreakerTripReason, message: string, triggeringAgentId?: string): void {
    if (this.isTrippedState) {
      log.warn('Circuit breaker already tripped, ignoring additional trip', {
        existingReason: this.tripReason,
        newReason: reason,
        newMessage: message,
      });
      return;
    }

    this.isTrippedState = true;
    this.tripReason = reason;
    this.tripMessage = message;
    this.trippedAt = new Date();
    this.triggeringAgentId = triggeringAgentId;

    log.error('CIRCUIT BREAKER TRIPPED', new Error(message), {
      reason,
      triggeringAgentId,
      totalTokensConsumed: this.totalTokensConsumed,
      totalSpend: this.totalSpend,
      meaningfulOutputCount: this.meaningfulOutputCount,
      recentErrorRate: this.calculateErrorRate(),
    });

    // Log event to database
    this.logEventToDatabase({
      event_type: 'trip',
      reason,
      agent_id: triggeringAgentId,
      message,
      details: {
        totalTokensConsumed: this.totalTokensConsumed,
        totalSpend: this.totalSpend,
        meaningfulOutputCount: this.meaningfulOutputCount,
        recentErrorRate: this.calculateErrorRate(),
        agentErrorCounts: Object.fromEntries(this.agentErrorCounts),
      },
      created_at: new Date(),
    }).catch((err) => {
      log.error('Failed to log trip event to database', err instanceof Error ? err : new Error(String(err)));
    });

    // Emit event to event bus
    if (this.eventBus) {
      this.eventBus.emit(
        createEvent('system:error', {
          error: new Error(`Circuit breaker tripped: ${message}`),
          component: 'circuit-breaker',
          message: `Circuit breaker tripped (${reason}): ${message}`,
        })
      );
    }

    // Call trip callback to pause all agents
    if (this.config.onTrip) {
      this.config.onTrip(reason, message).catch((err) => {
        log.error('Error in onTrip callback', err instanceof Error ? err : new Error(String(err)));
      });
    }

    // Send Slack alert
    if (this.config.sendSlackAlert) {
      const alertMessage = this.formatSlackAlert(reason, message, triggeringAgentId);
      this.config.sendSlackAlert(alertMessage, 'high').catch((err) => {
        log.error('Failed to send Slack alert', err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  /**
   * Resets the circuit breaker, allowing operations to resume
   */
  reset(): void {
    if (!this.isTrippedState) {
      log.info('Circuit breaker reset called but was not tripped');
      return;
    }

    const previousReason = this.tripReason;
    const previousMessage = this.tripMessage;
    const previousTrippedAt = this.trippedAt;

    this.isTrippedState = false;
    this.tripReason = undefined;
    this.tripMessage = undefined;
    this.trippedAt = undefined;
    this.triggeringAgentId = undefined;

    // Reset all counters
    this.agentErrorCounts.clear();
    this.recentOperations = [];
    this.totalTokensConsumed = 0;
    this.totalSpend = 0;
    this.meaningfulOutputCount = 0;
    this.tokensSinceLastMeaningfulOutput = 0;

    log.info('Circuit breaker reset', {
      previousReason,
      previousMessage,
      previousTrippedAt: previousTrippedAt?.toISOString(),
    });

    // Log event to database
    this.logEventToDatabase({
      event_type: 'reset',
      reason: previousReason,
      message: `Circuit breaker reset. Previous state: ${previousReason} - ${previousMessage}`,
      details: {
        previousTrippedAt: previousTrippedAt?.toISOString(),
      },
      created_at: new Date(),
    }).catch((err) => {
      log.error('Failed to log reset event to database', err instanceof Error ? err : new Error(String(err)));
    });
  }

  /**
   * Gets the current status of the circuit breaker
   */
  getStatus(): CircuitBreakerStatus {
    return {
      isTripped: this.isTrippedState,
      tripReason: this.tripReason,
      tripMessage: this.tripMessage,
      trippedAt: this.trippedAt,
      triggeringAgentId: this.triggeringAgentId,
      agentErrorCounts: new Map(this.agentErrorCounts),
      recentOperations: [...this.recentOperations],
      totalTokensConsumed: this.totalTokensConsumed,
      totalSpend: this.totalSpend,
      meaningfulOutputCount: this.meaningfulOutputCount,
    };
  }

  /**
   * Gets the current error rate from recent operations
   */
  getErrorRate(): number {
    return this.calculateErrorRate();
  }

  /**
   * Gets the consecutive error count for a specific agent
   */
  getAgentErrorCount(agentId: string): number {
    return this.agentErrorCounts.get(agentId) ?? 0;
  }

  /**
   * Updates the configuration
   */
  updateConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config };
    log.info('CircuitBreaker configuration updated', {
      maxConsecutiveAgentErrors: this.config.maxConsecutiveAgentErrors,
      errorRateThreshold: this.config.errorRateThreshold,
      errorRateWindowSize: this.config.errorRateWindowSize,
      hardBudgetLimit: this.config.hardBudgetLimit,
      tokenLimitWithoutOutput: this.config.tokenLimitWithoutOutput,
    });
  }

  // Private methods

  /**
   * Adds an operation to the recent operations list
   */
  private addOperation(operation: OperationResult): void {
    this.recentOperations.push(operation);

    // Trim to window size
    while (this.recentOperations.length > this.config.errorRateWindowSize) {
      this.recentOperations.shift();
    }
  }

  /**
   * Calculates the current error rate from recent operations
   */
  private calculateErrorRate(): number {
    if (this.recentOperations.length === 0) {
      return 0;
    }

    const errorCount = this.recentOperations.filter((op) => !op.success).length;
    return errorCount / this.recentOperations.length;
  }

  /**
   * Checks if global error rate threshold is exceeded
   */
  private checkGlobalErrorRate(): void {
    if (this.recentOperations.length < this.config.errorRateWindowSize) {
      // Not enough data yet
      return;
    }

    const errorRate = this.calculateErrorRate();
    if (errorRate > this.config.errorRateThreshold) {
      const errorCount = this.recentOperations.filter((op) => !op.success).length;
      this.trip(
        'global_error_rate',
        `Global error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${
          this.config.errorRateThreshold * 100
        }% (${errorCount}/${this.recentOperations.length} operations failed)`
      );
    }
  }

  /**
   * Checks if hard budget limit is exceeded
   */
  private checkBudgetLimit(): void {
    if (this.totalSpend >= this.config.hardBudgetLimit) {
      this.trip(
        'budget_exceeded',
        `Total spend $${this.totalSpend.toFixed(2)} exceeds hard budget limit of $${this.config.hardBudgetLimit.toFixed(
          2
        )}`
      );
    }
  }

  /**
   * Checks if token limit without meaningful output is exceeded
   */
  private checkTokenLimitWithoutOutput(): void {
    if (this.tokensSinceLastMeaningfulOutput >= this.config.tokenLimitWithoutOutput) {
      this.trip(
        'token_limit_exceeded',
        `${this.tokensSinceLastMeaningfulOutput.toLocaleString()} tokens consumed without meaningful output (limit: ${this.config.tokenLimitWithoutOutput.toLocaleString()})`
      );
    }
  }

  /**
   * Formats a Slack alert message
   */
  private formatSlackAlert(
    reason: CircuitBreakerTripReason,
    message: string,
    triggeringAgentId?: string
  ): string {
    const reasonLabels: Record<CircuitBreakerTripReason, string> = {
      consecutive_agent_errors: 'Consecutive Agent Errors',
      global_error_rate: 'High Global Error Rate',
      budget_exceeded: 'Budget Limit Exceeded',
      token_limit_exceeded: 'Token Limit Without Output',
      manual: 'Manual Trip',
    };

    const lines: string[] = [
      '*CIRCUIT BREAKER TRIPPED*',
      '',
      `*Reason:* ${reasonLabels[reason]}`,
      `*Details:* ${message}`,
    ];

    if (triggeringAgentId) {
      lines.push(`*Triggering Agent:* ${triggeringAgentId}`);
    }

    lines.push(
      '',
      '*Status:*',
      `- Total Spend: $${this.totalSpend.toFixed(2)} / $${this.config.hardBudgetLimit.toFixed(2)}`,
      `- Total Tokens: ${this.totalTokensConsumed.toLocaleString()}`,
      `- Error Rate: ${(this.calculateErrorRate() * 100).toFixed(1)}%`,
      `- Meaningful Outputs: ${this.meaningfulOutputCount}`,
      '',
      '*All agents have been paused.* Use `/tc circuit-breaker reset` to resume operations.'
    );

    return lines.join('\n');
  }

  /**
   * Logs an event to the database
   */
  private async logEventToDatabase(event: CircuitBreakerEvent): Promise<void> {
    try {
      const client = getClient();

      // Insert into tc_interventions table (repurposing for circuit breaker events)
      const { error } = await client.from('tc_interventions').insert({
        type: `circuit_breaker_${event.event_type}`,
        reason: event.reason || event.event_type,
        agent_session_id: event.agent_id,
        notes: event.message,
        metadata: event.details,
        created_at: event.created_at.toISOString(),
      });

      if (error) {
        // Don't throw - just log the error
        log.warn('Failed to log circuit breaker event to database', {
          eventType: event.event_type,
          error: error.message,
        });
      } else {
        log.debug('Circuit breaker event logged to database', {
          eventType: event.event_type,
          reason: event.reason,
        });
      }
    } catch (err) {
      // Don't throw - database logging is best-effort
      log.warn('Exception logging circuit breaker event', {
        eventType: event.event_type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Creates a circuit breaker instance with default configuration
 */
export function createCircuitBreaker(
  config?: Partial<CircuitBreakerConfig>,
  eventBus?: EventBus
): CircuitBreaker {
  return new CircuitBreaker(config, eventBus);
}
