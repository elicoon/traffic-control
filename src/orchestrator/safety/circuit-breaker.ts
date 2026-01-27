/**
 * Circuit Breaker
 *
 * Implements the circuit breaker pattern to prevent cascading failures.
 * Trips when too many failures occur and prevents further operations
 * until the system recovers.
 */

import { logger } from '../../logging/index.js';

const log = logger.child('Safety.CircuitBreaker');

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Failure record for tracking issues
 */
export interface FailureRecord {
  timestamp: Date;
  error: string;
  context?: Record<string, unknown>;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time to wait before trying half-open (ms) */
  resetTimeoutMs: number;
  /** Time window for counting failures (ms) */
  failureWindowMs: number;
  /** Number of successful calls in half-open to close circuit */
  successThresholdForClose: number;
  /** Whether to auto-reset to closed after reset timeout */
  autoReset: boolean;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 5 * 60 * 1000, // 5 minutes
  failureWindowMs: 10 * 60 * 1000, // 10 minutes
  successThresholdForClose: 3,
  autoReset: true,
};

/**
 * Statistics for the circuit breaker
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  lastStateChange: Date;
  tripCount: number;
  isTripped: boolean;
}

/**
 * Callback for state changes
 */
export type StateChangeCallback = (
  previousState: CircuitState,
  newState: CircuitState,
  reason: string
) => void;

/**
 * Circuit Breaker implementation
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failures: FailureRecord[] = [];
  private successesInHalfOpen: number = 0;
  private lastStateChange: Date = new Date();
  private tripCount: number = 0;
  private lastSuccess?: Date;
  private resetTimer: NodeJS.Timeout | null = null;
  private stateChangeCallbacks: StateChangeCallback[] = [];

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a state change callback
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const index = this.stateChangeCallbacks.indexOf(callback);
      if (index >= 0) {
        this.stateChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if the circuit is tripped (open)
   */
  isTripped(): boolean {
    return this.state === 'open';
  }

  /**
   * Check if operations are allowed
   */
  allowsOperation(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'half_open') {
      // Allow limited operations in half-open state
      return true;
    }

    // Check if it's time to transition to half-open
    if (this.state === 'open' && this.config.autoReset) {
      const timeSinceTrip = Date.now() - this.lastStateChange.getTime();
      if (timeSinceTrip >= this.config.resetTimeoutMs) {
        this.transitionTo('half_open', 'Reset timeout elapsed');
        return true;
      }
    }

    return false;
  }

  /**
   * Record a failure
   */
  recordFailure(error: string, context?: Record<string, unknown>): void {
    const record: FailureRecord = {
      timestamp: new Date(),
      error,
      context,
    };

    this.failures.push(record);
    this.pruneOldFailures();

    log.debug('Failure recorded', {
      error,
      totalFailures: this.failures.length,
      state: this.state,
    });

    // Check if we should trip the circuit
    if (this.state === 'closed' && this.failures.length >= this.config.failureThreshold) {
      this.trip(`${this.failures.length} failures in window`);
    }

    // If in half-open, any failure trips back to open
    if (this.state === 'half_open') {
      this.trip('Failure during half-open recovery');
    }
  }

  /**
   * Record a success
   */
  recordSuccess(): void {
    this.lastSuccess = new Date();

    if (this.state === 'half_open') {
      this.successesInHalfOpen++;
      log.debug('Success in half-open state', {
        successCount: this.successesInHalfOpen,
        threshold: this.config.successThresholdForClose,
      });

      if (this.successesInHalfOpen >= this.config.successThresholdForClose) {
        this.transitionTo('closed', 'Sufficient successes in half-open');
      }
    }
  }

  /**
   * Trip the circuit (open it)
   */
  trip(reason: string): void {
    if (this.state === 'open') {
      return; // Already tripped
    }

    this.tripCount++;
    this.transitionTo('open', reason);

    log.warn('Circuit breaker tripped', {
      reason,
      tripCount: this.tripCount,
      failureCount: this.failures.length,
    });

    // Schedule auto-reset if enabled
    if (this.config.autoReset) {
      this.scheduleReset();
    }
  }

  /**
   * Manually reset the circuit
   */
  reset(force: boolean = false): void {
    if (this.state === 'closed' && !force) {
      return; // Already closed
    }

    this.clearResetTimer();
    this.failures = [];
    this.successesInHalfOpen = 0;
    this.transitionTo('closed', force ? 'Manual force reset' : 'Manual reset');

    log.info('Circuit breaker reset', { forced: force });
  }

  /**
   * Transition to half-open state for testing recovery
   */
  tryHalfOpen(): void {
    if (this.state !== 'open') {
      return;
    }

    this.transitionTo('half_open', 'Manual half-open transition');
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failures.length,
      successCount: this.successesInHalfOpen,
      lastFailure: this.failures.length > 0 ? this.failures[this.failures.length - 1].timestamp : undefined,
      lastSuccess: this.lastSuccess,
      lastStateChange: this.lastStateChange,
      tripCount: this.tripCount,
      isTripped: this.state === 'open',
    };
  }

  /**
   * Get recent failures
   */
  getRecentFailures(limit: number = 10): FailureRecord[] {
    return [...this.failures].slice(-limit);
  }

  /**
   * Format status for Slack
   */
  formatForSlack(): string {
    const stats = this.getStats();
    const stateIcon =
      stats.state === 'closed' ? '[OK]' : stats.state === 'open' ? '[OPEN]' : '[HALF]';

    const lines: string[] = [
      `*Circuit Breaker ${stateIcon}*`,
      '',
      '```',
      `State:     ${stats.state}`,
      `Failures:  ${stats.failureCount} (threshold: ${this.config.failureThreshold})`,
      `Trip Count: ${stats.tripCount}`,
    ];

    if (stats.lastFailure) {
      lines.push(`Last Fail: ${stats.lastFailure.toISOString()}`);
    }

    if (stats.lastSuccess) {
      lines.push(`Last OK:   ${stats.lastSuccess.toISOString()}`);
    }

    if (stats.state === 'half_open') {
      lines.push(`Recovery:  ${stats.successCount}/${this.config.successThresholdForClose} successes`);
    }

    if (stats.state === 'open') {
      const timeToReset = this.config.resetTimeoutMs - (Date.now() - stats.lastStateChange.getTime());
      if (timeToReset > 0) {
        lines.push(`Reset in:  ${Math.round(timeToReset / 1000)}s`);
      }
    }

    lines.push('```');

    if (stats.state === 'open') {
      lines.push('');
      lines.push('*[!] Circuit is OPEN - Operations blocked*');
      lines.push('_Reply "reset circuit" to manually reset_');
    }

    return lines.join('\n');
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState, reason: string): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();

    if (newState === 'half_open') {
      this.successesInHalfOpen = 0;
    }

    log.info('Circuit breaker state change', {
      from: previousState,
      to: newState,
      reason,
    });

    // Notify callbacks
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(previousState, newState, reason);
      } catch (error) {
        log.error(
          'Error in state change callback',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  /**
   * Prune failures outside the time window
   */
  private pruneOldFailures(): void {
    const cutoff = new Date(Date.now() - this.config.failureWindowMs);
    this.failures = this.failures.filter((f) => f.timestamp >= cutoff);
  }

  /**
   * Schedule automatic reset to half-open
   */
  private scheduleReset(): void {
    this.clearResetTimer();

    this.resetTimer = setTimeout(() => {
      if (this.state === 'open') {
        this.transitionTo('half_open', 'Auto-reset timeout');
      }
    }, this.config.resetTimeoutMs);
  }

  /**
   * Clear the reset timer
   */
  private clearResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  /**
   * Cleanup (for testing)
   */
  destroy(): void {
    this.clearResetTimer();
    this.stateChangeCallbacks = [];
  }
}
