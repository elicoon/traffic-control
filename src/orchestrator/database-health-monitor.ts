/**
 * Database Health Monitor
 *
 * Manages database health tracking, degraded mode transitions, and recovery
 * attempts. Extracted from MainLoop to reduce complexity while preserving
 * identical behavior.
 */

import {
  checkHealth,
  waitForHealthy,
  HealthCheckResult,
  RetryConfig,
} from '../db/client.js';
import { EventBus } from '../events/event-bus.js';
import { createEvent } from '../events/event-types.js';
import { logger } from '../logging/index.js';

const log = logger.child('DatabaseHealthMonitor');

/**
 * Configuration for the database health monitor
 */
export interface DatabaseHealthMonitorConfig {
  /** Maximum consecutive DB failures before entering degraded mode */
  maxConsecutiveDbFailures: number;
  /** Retry configuration for database operations */
  dbRetryConfig: RetryConfig;
}

/**
 * Database health statistics
 */
export interface DatabaseHealthStats {
  healthy: boolean;
  consecutiveFailures: number;
  lastHealthyAt?: Date;
  lastError?: string;
}

/**
 * Database Health Monitor
 *
 * Encapsulates failure tracking, recovery attempts, degraded mode state,
 * and database event emission. MainLoop delegates all DB health operations
 * to this class.
 */
export class DatabaseHealthMonitor {
  private config: DatabaseHealthMonitorConfig;
  private eventBus: EventBus | null;
  private degraded: boolean = false;
  private consecutiveDbFailures: number = 0;
  private lastDbHealthyAt: Date | null = null;
  private lastDbError: string | null = null;

  constructor(config: DatabaseHealthMonitorConfig, eventBus: EventBus | null) {
    this.config = config;
    this.eventBus = eventBus;
  }

  /**
   * Checks if the system is in degraded mode due to database issues
   */
  isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * Gets database health statistics
   */
  getStats(): DatabaseHealthStats {
    return {
      healthy: !this.degraded,
      consecutiveFailures: this.consecutiveDbFailures,
      lastHealthyAt: this.lastDbHealthyAt || undefined,
      lastError: this.lastDbError || undefined,
    };
  }

  /**
   * Validates database connection on startup with retry logic
   */
  async validateOnStartup(): Promise<HealthCheckResult> {
    return waitForHealthy(
      this.config.dbRetryConfig,
      (attempt, delay, lastError) => {
        log.warn('Database not ready, retrying', {
          attempt,
          maxRetries: this.config.dbRetryConfig.maxRetries,
          retryDelayMs: delay,
          lastError: lastError || undefined,
        });
      }
    );
  }

  /**
   * Records a successful startup validation
   */
  recordStartupHealthy(latencyMs: number): void {
    this.lastDbHealthyAt = new Date();
    this.emitDatabaseEvent('database:healthy', { latencyMs });
  }

  /**
   * Checks if an error is database-related
   */
  isDbError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('supabase') ||
        msg.includes('database') ||
        msg.includes('connection') ||
        msg.includes('network') ||
        msg.includes('timeout') ||
        msg.includes('econnrefused') ||
        msg.includes('enotfound')
      );
    }
    return false;
  }

  /**
   * Handles a database failure
   */
  onDbFailure(error: unknown): void {
    this.consecutiveDbFailures++;
    this.lastDbError = error instanceof Error ? error.message : String(error);

    log.error('Database error', error instanceof Error ? error : new Error(String(error)), {
      consecutiveFailures: this.consecutiveDbFailures,
      maxConsecutiveDbFailures: this.config.maxConsecutiveDbFailures,
    });

    // Enter degraded mode if too many consecutive failures
    if (this.consecutiveDbFailures >= this.config.maxConsecutiveDbFailures && !this.degraded) {
      this.enterDegradedMode();
    }
  }

  /**
   * Handles a successful database operation
   */
  onDbSuccess(): void {
    const wasRecovery = this.degraded;
    const downtimeMs = this.lastDbHealthyAt ? Date.now() - this.lastDbHealthyAt.getTime() : 0;

    this.consecutiveDbFailures = 0;
    this.lastDbError = null;
    this.lastDbHealthyAt = new Date();

    if (wasRecovery) {
      this.exitDegradedMode(downtimeMs);
    }
  }

  /**
   * Attempts to recover from degraded mode by checking database health
   */
  async attemptDbRecovery(): Promise<void> {
    const result = await checkHealth();

    if (result.healthy) {
      const downtimeMs = this.lastDbHealthyAt ? Date.now() - this.lastDbHealthyAt.getTime() : 0;
      this.consecutiveDbFailures = 0;
      this.lastDbError = null;
      this.lastDbHealthyAt = new Date();
      this.degraded = false;

      log.info('Database recovered, exiting degraded mode', {
        latencyMs: result.latencyMs,
        downtimeMs,
      });

      this.emitDatabaseEvent('database:recovered', {
        latencyMs: result.latencyMs,
        downtimeMs,
      });
    }
  }

  /**
   * Resets state (used during MainLoop start)
   */
  reset(): void {
    this.degraded = false;
    this.consecutiveDbFailures = 0;
  }

  /**
   * Enters degraded mode due to database issues
   */
  private enterDegradedMode(): void {
    this.degraded = true;
    log.warn('Entering DEGRADED MODE due to database unavailability', {
      consecutiveFailures: this.consecutiveDbFailures,
      lastError: this.lastDbError,
      lastHealthyAt: this.lastDbHealthyAt?.toISOString(),
    });

    this.emitDatabaseEvent('database:degraded', {
      error: this.lastDbError || 'Unknown database error',
      lastHealthyAt: this.lastDbHealthyAt || undefined,
      retryCount: this.consecutiveDbFailures,
    });
  }

  /**
   * Exits degraded mode after database recovery
   */
  private exitDegradedMode(downtimeMs: number): void {
    this.degraded = false;
    log.info('Exiting DEGRADED MODE - database connection recovered', { downtimeMs });

    this.emitDatabaseEvent('database:recovered', {
      latencyMs: 0, // Will be set by the health check
      downtimeMs,
    });
  }

  /**
   * Emits a database event through the event bus
   */
  private emitDatabaseEvent(
    type: 'database:healthy' | 'database:degraded' | 'database:recovered',
    payload: Record<string, unknown>
  ): void {
    if (this.eventBus) {
      this.eventBus.emit(createEvent(type, payload as any));
    }
  }
}
