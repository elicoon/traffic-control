import { AgentManager } from '../agent/manager.js';

export type ModelType = 'opus' | 'sonnet' | 'haiku';

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

    // Load from environment variables with defaults
    this.config = {
      opusSessionLimit: config?.opusSessionLimit ?? this.parseEnvInt('OPUS_SESSION_LIMIT', 5),
      sonnetSessionLimit: config?.sonnetSessionLimit ?? this.parseEnvInt('SONNET_SESSION_LIMIT', 10),
    };

    // Subscribe to agent completion events to auto-release capacity
    this.setupAgentEventListeners();
  }

  private parseEnvInt(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  private setupAgentEventListeners(): void {
    // Auto-release capacity when agents complete
    this.agentManager.onEvent('completion', async (event) => {
      const session = this.agentManager.getSession(event.sessionId);
      if (session) {
        this.releaseCapacity(session.model, event.sessionId);
      }
    });

    // Also release on error
    this.agentManager.onEvent('error', async (event) => {
      const session = this.agentManager.getSession(event.sessionId);
      if (session) {
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
    if (model === 'opus') {
      return this.opusSessions.size < this.config.opusSessionLimit;
    }
    // Both sonnet and haiku use sonnet capacity
    return this.sonnetSessions.size < this.config.sonnetSessionLimit;
  }

  /**
   * Reserve capacity for a new session.
   * Returns true if reservation was successful, false if at capacity.
   */
  reserveCapacity(model: ModelType, sessionId: string): boolean {
    if (model === 'opus') {
      // Check if already reserved
      if (this.opusSessions.has(sessionId)) {
        return true;
      }

      if (this.opusSessions.size >= this.config.opusSessionLimit) {
        return false;
      }

      this.opusSessions.add(sessionId);
      return true;
    }

    // Sonnet and Haiku share capacity
    if (this.sonnetSessions.has(sessionId)) {
      return true;
    }

    if (this.sonnetSessions.size >= this.config.sonnetSessionLimit) {
      return false;
    }

    this.sonnetSessions.add(sessionId);
    return true;
  }

  /**
   * Release capacity for a completed/failed session.
   */
  releaseCapacity(model: ModelType, sessionId: string): void {
    if (model === 'opus') {
      this.opusSessions.delete(sessionId);
    } else {
      this.sonnetSessions.delete(sessionId);
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
        utilization: opusCurrent / this.config.opusSessionLimit,
      },
      sonnet: {
        current: sonnetCurrent,
        limit: this.config.sonnetSessionLimit,
        available: this.config.sonnetSessionLimit - sonnetCurrent,
        utilization: sonnetCurrent / this.config.sonnetSessionLimit,
      },
    };
  }

  /**
   * Sync capacity tracking with the actual running sessions from AgentManager.
   * Useful for recovering state after restarts or detecting orphaned sessions.
   */
  syncWithAgentManager(): void {
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
