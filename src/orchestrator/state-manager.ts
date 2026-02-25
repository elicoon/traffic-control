import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../logging/index.js';

const log = logger.child('StateManager');

/**
 * Status of an active agent in the orchestration system
 */
export type AgentStatus = 'running' | 'blocked' | 'waiting_approval' | 'complete' | 'failed';

/**
 * State of a single agent being managed
 */
export interface AgentState {
  sessionId: string;
  taskId: string;
  model: 'opus' | 'sonnet' | 'haiku';
  status: AgentStatus;
  startedAt: Date;
  blockerReason?: string;
}

/**
 * Complete orchestration state for persistence
 */
export interface OrchestrationState {
  isRunning: boolean;
  isPaused: boolean;
  activeAgents: Map<string, AgentState>;
  pendingTasks: string[];
  lastCheckpoint: Date;
}

/**
 * Configuration for the state manager
 */
export interface StateManagerConfig {
  stateFilePath?: string;
  autoSaveIntervalMs?: number;
}

/**
 * Serialized version of AgentState for JSON persistence
 */
interface SerializedAgentState {
  sessionId: string;
  taskId: string;
  model: 'opus' | 'sonnet' | 'haiku';
  status: AgentStatus;
  startedAt: string; // ISO date string
  blockerReason?: string;
}

/**
 * Serializable version of OrchestrationState for JSON persistence
 */
interface SerializedState {
  isRunning: boolean;
  isPaused: boolean;
  activeAgents: SerializedAgentState[];
  pendingTasks: string[];
  lastCheckpoint: string;
}

const DEFAULT_CONFIG: Required<StateManagerConfig> = {
  stateFilePath: './trafficcontrol-state.json',
  autoSaveIntervalMs: 30000, // 30 seconds
};

/**
 * Manages orchestration state persistence and recovery.
 * Supports saving/loading state to/from file for crash recovery.
 */
export class StateManager {
  private config: Required<StateManagerConfig>;
  private state: OrchestrationState;
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(config: StateManagerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = this.createInitialState();
  }

  /**
   * Creates the initial/default state
   */
  private createInitialState(): OrchestrationState {
    return {
      isRunning: false,
      isPaused: false,
      activeAgents: new Map(),
      pendingTasks: [],
      lastCheckpoint: new Date(),
    };
  }

  /**
   * Gets the current orchestration state
   */
  getState(): OrchestrationState {
    return {
      ...this.state,
      // Return a copy of the Map to prevent external mutation
      activeAgents: new Map(this.state.activeAgents),
      pendingTasks: [...this.state.pendingTasks],
    };
  }

  /**
   * Updates the orchestration state with partial values
   */
  updateState(updates: Partial<Omit<OrchestrationState, 'activeAgents'>>): void {
    this.state = {
      ...this.state,
      ...updates,
    };
  }

  /**
   * Adds an agent to the active agents map
   */
  addAgent(agentState: AgentState): void {
    this.state.activeAgents.set(agentState.sessionId, { ...agentState });
    log.info('Agent added to state', {
      sessionId: agentState.sessionId,
      taskId: agentState.taskId,
      model: agentState.model,
      status: agentState.status,
    });
  }

  /**
   * Updates an existing agent's state
   * @throws Error if agent not found
   */
  updateAgent(sessionId: string, updates: Partial<Omit<AgentState, 'sessionId'>>): void {
    const existing = this.state.activeAgents.get(sessionId);
    if (!existing) {
      throw new Error(`Agent ${sessionId} not found`);
    }

    const previousStatus = existing.status;
    this.state.activeAgents.set(sessionId, {
      ...existing,
      ...updates,
    });

    // Log state transitions
    if (updates.status && updates.status !== previousStatus) {
      log.info('Agent state transition', {
        sessionId,
        previousStatus,
        newStatus: updates.status,
        taskId: existing.taskId,
      });
    }
  }

  /**
   * Removes an agent from the active agents map
   */
  removeAgent(sessionId: string): void {
    const agent = this.state.activeAgents.get(sessionId);
    this.state.activeAgents.delete(sessionId);
    if (agent) {
      log.info('Agent removed from state', {
        sessionId,
        taskId: agent.taskId,
        model: agent.model,
        finalStatus: agent.status,
      });
    }
  }

  /**
   * Saves the current state to the configured file path
   */
  async saveState(): Promise<void> {
    log.time('save-state');
    // Update checkpoint timestamp
    this.state.lastCheckpoint = new Date();

    // Serialize state for JSON
    const serialized = this.serializeState();

    // Ensure directory exists
    const dir = path.dirname(this.config.stateFilePath);
    await fs.mkdir(dir, { recursive: true });

    // Write to file
    await fs.writeFile(
      this.config.stateFilePath,
      JSON.stringify(serialized, null, 2),
      'utf-8'
    );
    log.timeEnd('save-state', {
      activeAgents: this.state.activeAgents.size,
      pendingTasks: this.state.pendingTasks.length,
    });
    log.debug('State saved to file', { path: this.config.stateFilePath });
  }

  /**
   * Loads state from the configured file path
   * @returns true if state was loaded, false if file doesn't exist
   */
  async loadState(): Promise<boolean> {
    log.time('load-state');
    try {
      const content = await fs.readFile(this.config.stateFilePath, 'utf-8');
      const serialized: SerializedState = JSON.parse(content);
      this.deserializeState(serialized);
      log.timeEnd('load-state', {
        activeAgents: this.state.activeAgents.size,
        pendingTasks: this.state.pendingTasks.length,
        lastCheckpoint: this.state.lastCheckpoint.toISOString(),
      });
      log.info('State loaded from file', { path: this.config.stateFilePath });
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        log.debug('No existing state file found', { path: this.config.stateFilePath });
        return false;
      }
      if (error instanceof SyntaxError) {
        log.warn('Corrupt state file detected, starting fresh', {
          path: this.config.stateFilePath,
          error: error.message,
        });
        this.state = this.createInitialState();
        return false;
      }
      log.error('Failed to load state', error instanceof Error ? error : new Error(String(error)), {
        path: this.config.stateFilePath,
      });
      throw error;
    }
  }

  /**
   * Clears the state to initial values
   */
  clearState(): void {
    this.state = this.createInitialState();
  }

  /**
   * Checks if there are any active agents
   */
  hasActiveAgents(): boolean {
    return this.state.activeAgents.size > 0;
  }

  /**
   * Gets agents filtered by status
   */
  getAgentsByStatus(status: AgentStatus): AgentState[] {
    const agents: AgentState[] = [];
    this.state.activeAgents.forEach(agent => {
      if (agent.status === status) {
        agents.push({ ...agent });
      }
    });
    return agents;
  }

  /**
   * Starts periodic auto-save of state
   */
  startAutoSave(): void {
    if (this.autoSaveInterval) {
      return;
    }

    this.autoSaveInterval = setInterval(async () => {
      try {
        await this.saveState();
      } catch (error) {
        log.error('Auto-save failed', error instanceof Error ? error : new Error(String(error)));
      }
    }, this.config.autoSaveIntervalMs);
    log.debug('Auto-save started', { intervalMs: this.config.autoSaveIntervalMs });
  }

  /**
   * Stops periodic auto-save
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      log.debug('Auto-save stopped');
    }
  }

  /**
   * Serializes state for JSON persistence
   */
  private serializeState(): SerializedState {
    return {
      isRunning: this.state.isRunning,
      isPaused: this.state.isPaused,
      activeAgents: Array.from(this.state.activeAgents.values()).map(agent => ({
        ...agent,
        // Ensure startedAt is properly converted to ISO string for JSON
        startedAt: agent.startedAt instanceof Date
          ? agent.startedAt.toISOString()
          : String(agent.startedAt),
      })),
      pendingTasks: this.state.pendingTasks,
      lastCheckpoint: this.state.lastCheckpoint.toISOString(),
    };
  }

  /**
   * Deserializes state from JSON
   */
  private deserializeState(serialized: SerializedState): void {
    const activeAgents = new Map<string, AgentState>();

    for (const agent of serialized.activeAgents) {
      activeAgents.set(agent.sessionId, {
        ...agent,
        startedAt: new Date(agent.startedAt),
      });
    }

    this.state = {
      isRunning: serialized.isRunning,
      isPaused: serialized.isPaused,
      activeAgents,
      pendingTasks: serialized.pendingTasks,
      lastCheckpoint: new Date(serialized.lastCheckpoint),
    };
  }
}
