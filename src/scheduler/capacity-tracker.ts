import { AgentManager } from '../agent/manager.js';
import { ModelType } from './types.js';
import { logger } from '../logging/index.js';

const log = logger.child('CapacityTracker');

export { ModelType };

export interface CapacityConfig {
  opusSessionLimit: number;
  sonnetSessionLimit: number;
}

export interface ModelCapacityStats {
  current: number;
  limit: number;
  available: number;
  utilization: number;
}

export interface CapacityStats {
  opus: ModelCapacityStats;
  sonnet: ModelCapacityStats;
}

/**
 * Tracks and manages capacity for Opus and Sonnet model sessions.
 * Haiku uses the same capacity pool as Sonnet.
 */
export class CapacityTracker {
  private config: CapacityConfig;
  private opusSessions: Set<string> = new Set();
  private sonnetSessions: Set<string> = new Set();
  private agentManager: AgentManager;

  constructor(agentManager: AgentManager, config?: Partial<CapacityConfig>) {
    this.agentManager = agentManager;

    // Load from environment variables with conservative defaults
    // Default to 1 opus and 2 sonnet to prevent runaway agent spawning
    this.config = {
      opusSessionLimit: config?.opusSessionLimit ?? this.parseEnvInt('OPUS_SESSION_LIMIT', 1),
      sonnetSessionLimit: config?.sonnetSessionLimit ?? this.parseEnvInt('SONNET_SESSION_LIMIT', 2),
    };

    log.info('Capacity tracker initialized', {
      opusSessionLimit: this.config.opusSessionLimit,
      sonnetSessionLimit: this.config.sonnetSessionLimit,
    });

    // Warn if limits are set higher than recommended
    this.checkCapacityLimits();

    // Subscribe to agent completion events to auto-release capacity
    this.setupAgentEventListeners();
  }

  private parseEnvInt(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Checks capacity limits and warns if they are set higher than recommended.
   * Recommended limits: opus <= 2, sonnet <= 5
   *
   * This helps prevent accidental high-cost deployments.
   * The warning is returned so it can be sent to Slack during startup.
   */
  private checkCapacityLimits(): string | null {
    const warnings: string[] = [];

    if (this.config.opusSessionLimit > 2) {
      warnings.push(`Opus session limit (${this.config.opusSessionLimit}) exceeds recommended maximum of 2`);
    }

    if (this.config.sonnetSessionLimit > 5) {
      warnings.push(`Sonnet session limit (${this.config.sonnetSessionLimit}) exceeds recommended maximum of 5`);
    }

    if (warnings.length > 0) {
      const warningMessage = `HIGH CAPACITY WARNING: ${warnings.join('; ')}. Consider lowering limits to control costs.`;

      log.warn(warningMessage, {
        opusLimit: this.config.opusSessionLimit,
        sonnetLimit: this.config.sonnetSessionLimit,
        recommendedOpusMax: 2,
        recommendedSonnetMax: 5,
      });

      return warningMessage;
    }

    return null;
  }

  /**
   * Returns any capacity warning message that should be sent to Slack.
   * Returns null if capacity limits are within recommended ranges.
   */
  getCapacityWarning(): string | null {
    const warnings: string[] = [];

    if (this.config.opusSessionLimit > 2) {
      warnings.push(`Opus session limit (${this.config.opusSessionLimit}) exceeds recommended maximum of 2`);
    }

    if (this.config.sonnetSessionLimit > 5) {
      warnings.push(`Sonnet session limit (${this.config.sonnetSessionLimit}) exceeds recommended maximum of 5`);
    }

    if (warnings.length > 0) {
      return `HIGH CAPACITY WARNING: ${warnings.join('; ')}. Consider lowering limits to control costs.`;
    }

    return null;
  }

  private setupAgentEventListeners(): void {
    // Auto-release capacity when agents complete
    this.agentManager.onEvent('completion', async (event) => {
      const session = this.agentManager.getSession(event.sessionId);
      if (session) {
        log.debug('Agent completed, releasing capacity', {
          sessionId: event.sessionId,
          model: session.model,
        });
        this.releaseCapacity(session.model, event.sessionId);
      }
    });

    // Also release on error
    this.agentManager.onEvent('error', async (event) => {
      const session = this.agentManager.getSession(event.sessionId);
      if (session) {
        log.debug('Agent errored, releasing capacity', {
          sessionId: event.sessionId,
          model: session.model,
        });
        this.releaseCapacity(session.model, event.sessionId);
      }
    });
  }

  /**
   * Get the current capacity configuration.
   */
  getConfig(): CapacityConfig {
    return { ...this.config };
  }

  /**
   * Check if there is capacity available for the given model type.
   * Haiku shares capacity with Sonnet.
   */
  hasCapacity(model: ModelType): boolean {
    const hasCapacity = model === 'opus'
      ? this.opusSessions.size < this.config.opusSessionLimit
      : this.sonnetSessions.size < this.config.sonnetSessionLimit;

    log.debug('Capacity check', {
      model,
      hasCapacity,
      current: model === 'opus' ? this.opusSessions.size : this.sonnetSessions.size,
      limit: model === 'opus' ? this.config.opusSessionLimit : this.config.sonnetSessionLimit,
    });

    return hasCapacity;
  }

  /**
   * Reserve capacity for a new session.
   * Returns true if reservation was successful, false if at capacity.
   */
  reserveCapacity(model: ModelType, sessionId: string): boolean {
    if (model === 'opus') {
      // Check if already reserved
      if (this.opusSessions.has(sessionId)) {
        log.debug('Session already reserved', { model, sessionId });
        return true;
      }

      if (this.opusSessions.size >= this.config.opusSessionLimit) {
        log.info('Cannot reserve capacity - at limit', {
          model,
          sessionId,
          current: this.opusSessions.size,
          limit: this.config.opusSessionLimit,
        });
        return false;
      }

      this.opusSessions.add(sessionId);
      log.info('Capacity reserved', {
        model,
        sessionId,
        current: this.opusSessions.size,
        limit: this.config.opusSessionLimit,
      });
      return true;
    }

    // Sonnet and Haiku share capacity
    if (this.sonnetSessions.has(sessionId)) {
      log.debug('Session already reserved', { model, sessionId });
      return true;
    }

    if (this.sonnetSessions.size >= this.config.sonnetSessionLimit) {
      log.info('Cannot reserve capacity - at limit', {
        model,
        sessionId,
        current: this.sonnetSessions.size,
        limit: this.config.sonnetSessionLimit,
      });
      return false;
    }

    this.sonnetSessions.add(sessionId);
    log.info('Capacity reserved', {
      model,
      sessionId,
      current: this.sonnetSessions.size,
      limit: this.config.sonnetSessionLimit,
    });
    return true;
  }

  /**
   * Release capacity for a completed/failed session.
   */
  releaseCapacity(model: ModelType, sessionId: string): void {
    const sessions = model === 'opus' ? this.opusSessions : this.sonnetSessions;
    const existed = sessions.has(sessionId);

    if (model === 'opus') {
      this.opusSessions.delete(sessionId);
    } else {
      this.sonnetSessions.delete(sessionId);
    }

    if (existed) {
      log.info('Capacity released', {
        model,
        sessionId,
        current: model === 'opus' ? this.opusSessions.size : this.sonnetSessions.size,
        limit: model === 'opus' ? this.config.opusSessionLimit : this.config.sonnetSessionLimit,
      });
    } else {
      log.debug('Attempted to release non-existent session', { model, sessionId });
    }
  }

  /**
   * Get the current number of active sessions for a model type.
   */
  getCurrentSessionCount(model: ModelType): number {
    if (model === 'opus') {
      return this.opusSessions.size;
    }
    return this.sonnetSessions.size;
  }

  /**
   * Get the available capacity for a model type.
   */
  getAvailableCapacity(model: ModelType): number {
    if (model === 'opus') {
      return this.config.opusSessionLimit - this.opusSessions.size;
    }
    return this.config.sonnetSessionLimit - this.sonnetSessions.size;
  }

  /**
   * Get comprehensive capacity statistics.
   */
  getCapacityStats(): CapacityStats {
    const opusCurrent = this.opusSessions.size;
    const sonnetCurrent = this.sonnetSessions.size;

    return {
      opus: {
        current: opusCurrent,
        limit: this.config.opusSessionLimit,
        available: this.config.opusSessionLimit - opusCurrent,
        utilization: this.config.opusSessionLimit > 0
          ? opusCurrent / this.config.opusSessionLimit
          : 0,
      },
      sonnet: {
        current: sonnetCurrent,
        limit: this.config.sonnetSessionLimit,
        available: this.config.sonnetSessionLimit - sonnetCurrent,
        utilization: this.config.sonnetSessionLimit > 0
          ? sonnetCurrent / this.config.sonnetSessionLimit
          : 0,
      },
    };
  }

  /**
   * Sync capacity tracking with the actual running sessions from AgentManager.
   * Useful for recovering state after restarts or detecting orphaned sessions.
   */
  syncWithAgentManager(): void {
    const previousOpus = this.opusSessions.size;
    const previousSonnet = this.sonnetSessions.size;

    // Clear current tracking
    this.opusSessions.clear();
    this.sonnetSessions.clear();

    // Get active sessions from agent manager
    const activeSessions = this.agentManager.getActiveSessions();

    for (const session of activeSessions) {
      if (session.model === 'opus') {
        this.opusSessions.add(session.id);
      } else {
        // Both sonnet and haiku go to sonnet pool
        this.sonnetSessions.add(session.id);
      }
    }

    log.info('Capacity synced with agent manager', {
      previousOpusSessions: previousOpus,
      previousSonnetSessions: previousSonnet,
      currentOpusSessions: this.opusSessions.size,
      currentSonnetSessions: this.sonnetSessions.size,
      totalActiveSessions: activeSessions.length,
    });
  }

  /**
   * Get all currently tracked session IDs for a model type.
   */
  getTrackedSessions(model: ModelType): string[] {
    if (model === 'opus') {
      return Array.from(this.opusSessions);
    }
    return Array.from(this.sonnetSessions);
  }
}
