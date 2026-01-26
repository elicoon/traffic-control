import { Scheduler } from '../scheduler/scheduler.js';
import { AgentManager } from '../agent/manager.js';
import { BacklogManager } from '../backlog/backlog-manager.js';
import { Reporter } from '../reporter/reporter.js';
import { CapacityTracker } from '../scheduler/capacity-tracker.js';
import { LearningProvider } from '../learning/learning-provider.js';
import { RetrospectiveTrigger } from '../learning/retrospective-trigger.js';
import { StateManager, OrchestrationState, AgentState } from './state-manager.js';
import { EventDispatcher, AgentEvent, EventHandler } from './event-dispatcher.js';

/**
 * Configuration for the main orchestration loop
 */
export interface OrchestrationConfig {
  pollIntervalMs: number;
  maxConcurrentAgents: number;
  gracefulShutdownTimeoutMs: number;
  stateFilePath: string;
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
}

/**
 * Statistics from the main loop
 */
export interface OrchestrationStats {
  isRunning: boolean;
  isPaused: boolean;
  activeAgentCount: number;
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
  private pollInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private paused: boolean = false;
  private globalEventHandlers: EventHandler[] = [];

  constructor(config: Partial<OrchestrationConfig>, deps: OrchestrationDependencies) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
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

      // Check if retrospective should be triggered
      const triggerResult = this.deps.retrospectiveTrigger.checkTrigger({
        taskId: event.taskId,
        projectId: '', // Would need to look this up
        sessionId: event.agentId,
        isBlocked: false,
      });

      if (triggerResult.shouldTrigger) {
        console.log(`[MainLoop] Retrospective triggered: ${triggerResult.reason}`);
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
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    console.log('[MainLoop] Starting orchestration loop...');

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
    this.stateManager.updateState({ isRunning: true, isPaused: false });

    // Start the poll loop
    this.startPolling();

    console.log('[MainLoop] Orchestration loop started');
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
      activeAgentCount: this.stateManager.getState().activeAgents.size,
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
    } catch (error) {
      console.error('[MainLoop] Error in tick:', error);
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
