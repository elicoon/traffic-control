import { Scheduler } from '../scheduler/scheduler.js';
import { AgentManager } from '../agent/manager.js';
import { BacklogManager } from '../backlog/backlog-manager.js';
import { Reporter } from '../reporter/reporter.js';
import { CapacityTracker } from '../scheduler/capacity-tracker.js';
import { LearningProvider } from '../learning/learning-provider.js';
import { RetrospectiveTrigger } from '../learning/retrospective-trigger.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { StateManager, OrchestrationState, AgentState } from './state-manager.js';
import { EventDispatcher, AgentEvent, EventHandler } from './event-dispatcher.js';
import {
  checkHealth,
  waitForHealthy,
  HealthCheckResult,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from '../db/client.js';
import { EventBus } from '../events/event-bus.js';
import { createEvent } from '../events/event-types.js';

/**
 * Configuration for the main orchestration loop
 */
export interface OrchestrationConfig {
  pollIntervalMs: number;
  maxConcurrentAgents: number;
  gracefulShutdownTimeoutMs: number;
  stateFilePath: string;
  /** Whether to validate database health on startup (default: true) */
  validateDatabaseOnStartup: boolean;
  /** Retry configuration for database operations */
  dbRetryConfig: RetryConfig;
  /** Maximum consecutive DB failures before entering degraded mode */
  maxConsecutiveDbFailures: number;
}

/**
 * Dependencies required by the main loop
 */
export interface OrchestrationDependencies {
  scheduler: Scheduler;
  agentManager: AgentManager;
  backlogManager: BacklogManager;
  reporter: Reporter;
  capacityTracker: CapacityTracker;
  learningProvider: LearningProvider;
  retrospectiveTrigger: RetrospectiveTrigger;
  /** Optional task repository for looking up task details (e.g., projectId) */
  taskRepository?: TaskRepository;
}

/**
 * Statistics from the main loop
 */
export interface OrchestrationStats {
  isRunning: boolean;
  isPaused: boolean;
  isDegraded: boolean;
  activeAgentCount: number;
  dbHealth: {
    healthy: boolean;
    consecutiveFailures: number;
    lastHealthyAt?: Date;
    lastError?: string;
  };
  schedulerStats: {
    queuedTasks: number;
    capacity: {
      opus: { current: number; limit: number; available: number; utilization: number };
      sonnet: { current: number; limit: number; available: number; utilization: number };
    };
  };
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: OrchestrationConfig = {
  pollIntervalMs: 5000,
  maxConcurrentAgents: 5,
  gracefulShutdownTimeoutMs: 30000,
  stateFilePath: './trafficcontrol-state.json',
  validateDatabaseOnStartup: true,
  dbRetryConfig: DEFAULT_RETRY_CONFIG,
  maxConsecutiveDbFailures: 3,
};

/**
 * Main orchestration loop that coordinates all TrafficControl components.
 *
 * Responsibilities:
 * - Continuously monitors capacity and spawns agents when available
 * - Routes agent events (questions, completions, errors) to appropriate handlers
 * - Coordinates between scheduler, agent manager, and reporter
 * - Handles graceful shutdown and state persistence
 */
export class MainLoop {
  private config: OrchestrationConfig;
  private deps: OrchestrationDependencies;
  private stateManager: StateManager;
  private eventDispatcher: EventDispatcher;
  private eventBus: EventBus | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private paused: boolean = false;
  private degraded: boolean = false;
  private consecutiveDbFailures: number = 0;
  private lastDbHealthyAt: Date | null = null;
  private lastDbError: string | null = null;
  private globalEventHandlers: EventHandler[] = [];

  constructor(config: Partial<OrchestrationConfig>, deps: OrchestrationDependencies, eventBus?: EventBus) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
    this.eventBus = eventBus || null;
    this.stateManager = new StateManager({
      stateFilePath: this.config.stateFilePath,
    });
    this.eventDispatcher = new EventDispatcher();

    this.setupAgentEventHandlers();
  }

  /**
   * Sets up handlers for agent manager events
   */
  private setupAgentEventHandlers(): void {
    // Listen to agent manager events and route through our event dispatcher
    this.deps.agentManager.onEvent('question', async (event) => {
      await this.handleAgentManagerEvent('question', event);
    });

    this.deps.agentManager.onEvent('completion', async (event) => {
      await this.handleAgentManagerEvent('completion', event);
    });

    this.deps.agentManager.onEvent('error', async (event) => {
      await this.handleAgentManagerEvent('error', event);
    });
  }

  /**
   * Routes agent manager events through the event dispatcher
   */
  private async handleAgentManagerEvent(
    type: AgentEvent['type'],
    event: { sessionId: string; data: unknown; timestamp: Date }
  ): Promise<void> {
    const session = this.deps.agentManager.getSession(event.sessionId);

    const agentEvent: AgentEvent = {
      type,
      agentId: event.sessionId,
      taskId: session?.taskId || '',
      payload: event.data,
      timestamp: event.timestamp,
    };

    await this.handleAgentEvent(agentEvent);
  }

  /**
   * Handles an agent event by updating state and dispatching
   */
  async handleAgentEvent(event: AgentEvent): Promise<void> {
    // Dispatch to event handlers
    await this.eventDispatcher.dispatch(event);

    // Call global handlers (copy array to prevent modification during iteration)
    for (const handler of [...this.globalEventHandlers]) {
      try {
        await handler(event);
      } catch (error) {
        console.error('[MainLoop] Error in global event handler:', error);
      }
    }

    // Update state based on event type
    switch (event.type) {
      case 'completion':
        await this.handleAgentCompletion(event);
        break;
      case 'error':
        await this.handleAgentError(event);
        break;
      case 'blocker':
        await this.handleAgentBlocker(event);
        break;
      case 'question':
        await this.handleAgentQuestion(event);
        break;
      case 'subagent_spawn':
        await this.handleSubagentSpawn(event);
        break;
    }
  }

  /**
   * Handles agent completion event
   */
  private async handleAgentCompletion(event: AgentEvent): Promise<void> {
    const agent = this.stateManager.getState().activeAgents.get(event.agentId);
    if (agent) {
      // Release capacity
      this.deps.capacityTracker.releaseCapacity(agent.model, event.agentId);

      // Remove from state
      this.stateManager.removeAgent(event.agentId);
    }
  }

  /**
   * Handles agent error event
   */
  private async handleAgentError(event: AgentEvent): Promise<void> {
    const agent = this.stateManager.getState().activeAgents.get(event.agentId);
    if (agent) {
      // Release capacity
      this.deps.capacityTracker.releaseCapacity(agent.model, event.agentId);

      // Remove from state
      this.stateManager.removeAgent(event.agentId);

      // Look up projectId from task if taskRepository is available
      let projectId: string | null = null;
      if (event.taskId && this.deps.taskRepository) {
        try {
          const task = await this.deps.taskRepository.getById(event.taskId);
          if (task) {
            projectId = task.project_id;
          } else {
            console.warn(`[MainLoop] Task not found for error event: ${event.taskId}`);
          }
        } catch (error) {
          console.warn(`[MainLoop] Failed to look up task for error event: ${error}`);
        }
      }

      // Only check retrospective trigger if we have a valid projectId
      if (projectId) {
        const triggerResult = this.deps.retrospectiveTrigger.checkTrigger({
          taskId: event.taskId,
          projectId,
          sessionId: event.agentId,
          isBlocked: false,
        });

        if (triggerResult.shouldTrigger) {
          console.log(`[MainLoop] Retrospective triggered: ${triggerResult.reason}`);
        }
      } else {
        console.warn(`[MainLoop] Skipping retrospective check: no projectId available for task ${event.taskId}`);
      }
    }
  }

  /**
   * Handles agent blocker event
   */
  private async handleAgentBlocker(event: AgentEvent): Promise<void> {
    try {
      const payload = event.payload as { reason?: string };
      this.stateManager.updateAgent(event.agentId, {
        status: 'blocked',
        blockerReason: payload.reason,
      });
    } catch (error) {
      // Agent might not exist in state yet
      console.warn(`[MainLoop] Could not update agent ${event.agentId} for blocker event`);
    }
  }

  /**
   * Handles agent question event
   */
  private async handleAgentQuestion(event: AgentEvent): Promise<void> {
    try {
      this.stateManager.updateAgent(event.agentId, {
        status: 'blocked',
      });
    } catch (error) {
      // Agent might not exist in state yet
      console.warn(`[MainLoop] Could not update agent ${event.agentId} for question event`);
    }
  }

  /**
   * Handles subagent spawn event
   */
  private async handleSubagentSpawn(event: AgentEvent): Promise<void> {
    const payload = event.payload as { sessionId?: string; model?: 'opus' | 'sonnet' | 'haiku' };

    if (payload.sessionId && payload.model) {
      this.stateManager.addAgent({
        sessionId: payload.sessionId,
        taskId: event.taskId,
        model: payload.model,
        status: 'running',
        startedAt: new Date(),
      });
    }
  }

  /**
   * Starts the main orchestration loop
   * @throws Error if database is unavailable and validateDatabaseOnStartup is true
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    console.log('[MainLoop] Starting orchestration loop...');

    // Validate database connection on startup if configured
    if (this.config.validateDatabaseOnStartup) {
      console.log('[MainLoop] Validating database connection...');
      const healthResult = await this.validateDatabaseOnStartup();
      if (!healthResult.healthy) {
        const errorMsg = `[MainLoop] Database unavailable: ${healthResult.error}. Cannot start orchestrator.`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      console.log(`[MainLoop] Database healthy (latency: ${healthResult.latencyMs}ms)`);
      this.lastDbHealthyAt = new Date();

      // Emit healthy event
      this.emitDatabaseEvent('database:healthy', { latencyMs: healthResult.latencyMs });
    }

    // Try to load previous state
    const loaded = await this.stateManager.loadState();
    if (loaded) {
      console.log('[MainLoop] Recovered state from previous session');
    }

    // Sync capacity with agent manager
    this.deps.scheduler.syncCapacity();

    // Update state
    this.running = true;
    this.paused = false;
    this.degraded = false;
    this.consecutiveDbFailures = 0;
    this.stateManager.updateState({ isRunning: true, isPaused: false });

    // Start the poll loop
    this.startPolling();

    console.log('[MainLoop] Orchestration loop started');
  }

  /**
   * Validates database connection on startup with retry logic
   */
  private async validateDatabaseOnStartup(): Promise<HealthCheckResult> {
    return waitForHealthy(
      this.config.dbRetryConfig,
      (attempt, delay, lastError) => {
        console.log(
          `[MainLoop] Database not ready, retrying in ${delay}ms (attempt ${attempt}/${this.config.dbRetryConfig.maxRetries})${lastError ? `: ${lastError}` : ''}`
        );
      }
    );
  }

  /**
   * Stops the main orchestration loop
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log('[MainLoop] Stopping orchestration loop...');

    // Stop polling
    this.stopPolling();

    // Wait for active agents to complete (with timeout)
    await this.waitForAgents();

    // Update state
    this.running = false;
    this.paused = false;
    this.stateManager.updateState({ isRunning: false, isPaused: false });

    // Save state
    await this.stateManager.saveState();

    console.log('[MainLoop] Orchestration loop stopped');
  }

  /**
   * Pauses the orchestration loop (stops scheduling new tasks)
   */
  async pause(): Promise<void> {
    if (!this.running || this.paused) {
      return;
    }

    console.log('[MainLoop] Pausing orchestration loop...');

    this.paused = true;
    this.stateManager.updateState({ isPaused: true });
  }

  /**
   * Resumes a paused orchestration loop
   */
  async resume(): Promise<void> {
    if (!this.running || !this.paused) {
      return;
    }

    console.log('[MainLoop] Resuming orchestration loop...');

    this.paused = false;
    this.stateManager.updateState({ isPaused: false });
  }

  /**
   * Checks if the loop is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Checks if the loop is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Checks if the loop is in degraded mode due to database issues
   */
  isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * Gets the current orchestration state
   */
  getState(): OrchestrationState {
    return this.stateManager.getState();
  }

  /**
   * Registers a handler for all agent events
   */
  onEvent(handler: EventHandler): () => void {
    this.globalEventHandlers.push(handler);

    return () => {
      const index = this.globalEventHandlers.indexOf(handler);
      if (index >= 0) {
        this.globalEventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Gets orchestration statistics
   */
  getStats(): OrchestrationStats {
    const schedulerStats = this.deps.scheduler.getStats();

    return {
      isRunning: this.running,
      isPaused: this.paused,
      isDegraded: this.degraded,
      activeAgentCount: this.stateManager.getState().activeAgents.size,
      dbHealth: {
        healthy: !this.degraded,
        consecutiveFailures: this.consecutiveDbFailures,
        lastHealthyAt: this.lastDbHealthyAt || undefined,
        lastError: this.lastDbError || undefined,
      },
      schedulerStats,
    };
  }

  /**
   * Gets the state manager instance
   */
  getStateManager(): StateManager {
    return this.stateManager;
  }

  /**
   * Gets the event dispatcher instance
   */
  getEventDispatcher(): EventDispatcher {
    return this.eventDispatcher;
  }

  /**
   * Starts the polling loop
   */
  private startPolling(): void {
    this.pollInterval = setInterval(async () => {
      await this.tick();
    }, this.config.pollIntervalMs);
  }

  /**
   * Stops the polling loop
   */
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Single tick of the orchestration loop
   */
  private async tick(): Promise<void> {
    if (!this.running || this.paused) {
      return;
    }

    try {
      // If in degraded mode, try to recover first
      if (this.degraded) {
        await this.attemptDbRecovery();
        if (this.degraded) {
          // Still degraded, skip this tick
          return;
        }
      }

      // Check if we can schedule anything
      if (this.deps.scheduler.canSchedule()) {
        // Try to schedule next task
        const result = await this.deps.scheduler.scheduleNext();

        if (result.status === 'scheduled' && result.tasks) {
          for (const scheduled of result.tasks) {
            // Add to state
            const session = this.deps.agentManager.getSession(scheduled.sessionId);
            if (session) {
              this.stateManager.addAgent({
                sessionId: scheduled.sessionId,
                taskId: scheduled.taskId,
                model: scheduled.model,
                status: 'running',
                startedAt: session.startedAt,
              });
            }

            console.log(
              `[MainLoop] Scheduled task ${scheduled.taskId} with model ${scheduled.model} (session: ${scheduled.sessionId})`
            );
          }
        }
      }

      // Reset consecutive failures on successful tick
      if (this.consecutiveDbFailures > 0) {
        this.onDbSuccess();
      }
    } catch (error) {
      // Check if this is a database-related error
      if (this.isDbError(error)) {
        this.onDbFailure(error);
      } else {
        // Non-DB error, just log it
        console.error('[MainLoop] Error in tick:', error);
      }
    }
  }

  /**
   * Checks if an error is database-related
   */
  private isDbError(error: unknown): boolean {
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
  private onDbFailure(error: unknown): void {
    this.consecutiveDbFailures++;
    this.lastDbError = error instanceof Error ? error.message : String(error);

    console.error(
      `[MainLoop] Database error (${this.consecutiveDbFailures}/${this.config.maxConsecutiveDbFailures}):`,
      this.lastDbError
    );

    // Enter degraded mode if too many consecutive failures
    if (this.consecutiveDbFailures >= this.config.maxConsecutiveDbFailures && !this.degraded) {
      this.enterDegradedMode();
    }
  }

  /**
   * Handles a successful database operation
   */
  private onDbSuccess(): void {
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
   * Enters degraded mode due to database issues
   */
  private enterDegradedMode(): void {
    this.degraded = true;
    console.warn('[MainLoop] Entering DEGRADED MODE due to database unavailability');

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
    console.log('[MainLoop] Exiting DEGRADED MODE - database connection recovered');

    this.emitDatabaseEvent('database:recovered', {
      latencyMs: 0, // Will be set by the health check
      downtimeMs,
    });
  }

  /**
   * Attempts to recover from degraded mode by checking database health
   */
  private async attemptDbRecovery(): Promise<void> {
    const result = await checkHealth();

    if (result.healthy) {
      const downtimeMs = this.lastDbHealthyAt ? Date.now() - this.lastDbHealthyAt.getTime() : 0;
      this.consecutiveDbFailures = 0;
      this.lastDbError = null;
      this.lastDbHealthyAt = new Date();
      this.degraded = false;

      console.log('[MainLoop] Database recovered, exiting degraded mode');

      this.emitDatabaseEvent('database:recovered', {
        latencyMs: result.latencyMs,
        downtimeMs,
      });
    }
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

  /**
   * Waits for active agents to complete (with timeout)
   */
  private async waitForAgents(): Promise<void> {
    const startTime = Date.now();
    const timeout = this.config.gracefulShutdownTimeoutMs;

    while (this.deps.agentManager.getActiveSessions().length > 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        console.warn('[MainLoop] Graceful shutdown timeout reached, forcing stop');
        break;
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
