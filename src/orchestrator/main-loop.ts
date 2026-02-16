import { Scheduler } from '../scheduler/scheduler.js';
import { AgentManager } from '../agent/manager.js';
import { BacklogManager } from '../backlog/backlog-manager.js';
import { Reporter } from '../reporter/reporter.js';
import { CapacityTracker } from '../scheduler/capacity-tracker.js';
import { LearningProvider } from '../learning/learning-provider.js';
import { RetrospectiveTrigger } from '../learning/retrospective-trigger.js';
import { TaskRepository, Task } from '../db/repositories/tasks.js';
import { UsageLogRepository } from '../db/repositories/usage-log.js';
import { StateManager, OrchestrationState, AgentState } from './state-manager.js';
import { EventDispatcher, AgentEvent, EventHandler } from './event-dispatcher.js';
import {
  checkHealth,
  waitForHealthy,
  HealthCheckResult,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  getClient,
} from '../db/client.js';
import { EventBus } from '../events/event-bus.js';
import { createEvent } from '../events/event-types.js';
import { logger } from '../logging/index.js';
import { PreFlightChecker, PreFlightConfig, PreFlightResult } from './pre-flight.js';
import {
  TaskApprovalManager,
  SpendMonitor,
  ProductivityMonitor,
  CircuitBreaker,
} from './safety/index.js';

const log = logger.child('MainLoop');

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
  /** Whether to run pre-flight checks before starting (default: true) */
  runPreFlightChecks: boolean;
  /** Whether to require user confirmation for pre-flight checks (default: true) */
  requirePreFlightConfirmation: boolean;
  /** Pre-flight check configuration */
  preFlightConfig?: Partial<PreFlightConfig>;

  // Safety system configuration
  /** Whether to require task approval before scheduling (default: false) */
  enableTaskApproval: boolean;
  /** Status check-in interval in ms (default: 30 minutes, 0 to disable) */
  statusCheckInIntervalMs: number;
  /** Daily spend budget in USD */
  dailyBudgetUsd: number;
  /** Weekly spend budget in USD */
  weeklyBudgetUsd: number;
  /** Whether to hard stop when budget is exceeded (default: false) */
  hardStopAtBudgetLimit: boolean;
  /** Circuit breaker failure threshold (default: 5) */
  circuitBreakerFailureThreshold: number;
  /** Circuit breaker reset timeout in ms (default: 5 minutes) */
  circuitBreakerResetTimeoutMs: number;
}

/**
 * Slack integration interface for safety system notifications
 */
export interface SlackIntegration {
  sendMessage(channel: string, text: string, threadTs?: string): Promise<string | undefined>;
  sendApprovalRequest(task: Task, message: string): Promise<string | undefined>;
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
  /** Optional usage log repository for persisting agent usage data */
  usageLogRepository?: UsageLogRepository;
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
  safety: {
    circuitBreakerState: string;
    circuitBreakerTripped: boolean;
    spendStats: {
      dailySpend: number;
      weeklySpend: number;
      dailyBudgetUsed: number;
      weeklyBudgetUsed: number;
      isOverBudget: boolean;
    };
    productivityStats: {
      tasksCompleted: number;
      tasksSuccessful: number;
      tasksFailed: number;
      successRate: number;
      consecutiveFailures: number;
    };
    pendingApprovals: number;
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
  runPreFlightChecks: true,
  requirePreFlightConfirmation: true,
  // Safety defaults
  enableTaskApproval: false,
  statusCheckInIntervalMs: 30 * 60 * 1000, // 30 minutes
  dailyBudgetUsd: 50,
  weeklyBudgetUsd: 200,
  hardStopAtBudgetLimit: false,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerResetTimeoutMs: 5 * 60 * 1000, // 5 minutes
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
  private statusCheckInInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private paused: boolean = false;
  private degraded: boolean = false;
  private shuttingDown: boolean = false;
  private consecutiveDbFailures: number = 0;
  private lastDbHealthyAt: Date | null = null;
  private lastDbError: string | null = null;
  private globalEventHandlers: EventHandler[] = [];
  private preFlightChecker: PreFlightChecker | null = null;
  private lastPreFlightResult: PreFlightResult | null = null;

  // Safety systems
  private taskApprovalManager: TaskApprovalManager;
  private spendMonitor: SpendMonitor;
  private productivityMonitor: ProductivityMonitor;
  private circuitBreaker: CircuitBreaker;
  private slackIntegration: SlackIntegration | null = null;
  private consecutiveFailures: number = 0;

  constructor(config: Partial<OrchestrationConfig>, deps: OrchestrationDependencies, eventBus?: EventBus) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
    this.eventBus = eventBus || null;
    this.stateManager = new StateManager({
      stateFilePath: this.config.stateFilePath,
    });
    this.eventDispatcher = new EventDispatcher();

    // Initialize safety systems
    this.taskApprovalManager = new TaskApprovalManager({
      autoApproveConfirmed: true,
      requireApprovalForAll: this.config.enableTaskApproval,
    });

    this.spendMonitor = new SpendMonitor({
      dailyBudgetUsd: this.config.dailyBudgetUsd,
      weeklyBudgetUsd: this.config.weeklyBudgetUsd,
      hardStopAtLimit: this.config.hardStopAtBudgetLimit,
    });

    this.productivityMonitor = new ProductivityMonitor();

    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: this.config.circuitBreakerFailureThreshold,
      resetTimeoutMs: this.config.circuitBreakerResetTimeoutMs,
      autoReset: true,
    });

    this.setupAgentEventHandlers();
    this.setupSafetyCallbacks();
  }

  /**
   * Sets the Slack integration for safety system notifications
   */
  setSlackIntegration(slack: SlackIntegration): void {
    this.slackIntegration = slack;
    this.taskApprovalManager.setSendRequestFn(async (task, message) => {
      return slack.sendApprovalRequest(task, message);
    });
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
   * Sets up callbacks for safety systems
   */
  private setupSafetyCallbacks(): void {
    // Circuit breaker state changes
    this.circuitBreaker.onStateChange((prev, next, reason) => {
      log.warn('Circuit breaker state changed', { from: prev, to: next, reason });

      if (next === 'open' && this.slackIntegration) {
        const channelId = process.env.TC_SLACK_CHANNEL || '';
        if (channelId) {
          this.slackIntegration.sendMessage(
            channelId,
            `*[!] Circuit Breaker TRIPPED*\nReason: ${reason}\n\n_Operations are paused. Reply "reset circuit" to resume._`
          ).catch(err => log.error('Failed to send circuit breaker notification', err instanceof Error ? err : new Error(String(err))));
        }
      }
    });

    // Spend alerts
    this.spendMonitor.onAlert((type, percentage, currentSpend, budget) => {
      if (this.slackIntegration) {
        const channelId = process.env.TC_SLACK_CHANNEL || '';
        if (channelId) {
          this.slackIntegration.sendMessage(
            channelId,
            `*Budget Alert*\n${type.charAt(0).toUpperCase() + type.slice(1)} spend at ${percentage}%\n$${currentSpend.toFixed(2)} / $${budget.toFixed(2)}`
          ).catch(err => log.error('Failed to send spend alert', err instanceof Error ? err : new Error(String(err))));
        }
      }
    });

    // Productivity alerts
    this.productivityMonitor.onAlert((alert) => {
      if (this.slackIntegration) {
        const channelId = process.env.TC_SLACK_CHANNEL || '';
        if (channelId) {
          this.slackIntegration.sendMessage(
            channelId,
            `*Productivity Alert*\n${alert.message}`
          ).catch(err => log.error('Failed to send productivity alert', err instanceof Error ? err : new Error(String(err))));
        }
      }
    });

    // Task approval responses
    this.taskApprovalManager.onApproval((response) => {
      log.info('Task approval response', {
        taskId: response.taskId,
        approved: response.approved,
        respondedBy: response.respondedBy,
      });
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
        log.error('Error in global event handler', error instanceof Error ? error : new Error(String(error)), {
          eventType: event.type,
          agentId: event.agentId,
          taskId: event.taskId,
        });
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

      // Update safety monitors
      const payload = event.payload as {
        tokensUsed?: number;
        costUsd?: number;
        durationMs?: number;
        summary?: string;
        inputTokens?: number;
        outputTokens?: number;
      };

      // Record spend
      const costUsd = payload.costUsd ?? 0;
      const inputTokens = payload.inputTokens ?? (payload.tokensUsed ? Math.floor(payload.tokensUsed * 0.3) : 0);
      const outputTokens = payload.outputTokens ?? (payload.tokensUsed ? Math.floor(payload.tokensUsed * 0.7) : 0);

      if (costUsd > 0 || inputTokens > 0 || outputTokens > 0) {
        this.spendMonitor.recordAgentCost(
          event.agentId,
          event.taskId,
          agent.model,
          inputTokens,
          outputTokens,
          costUsd
        );
      }

      // Persist usage to database
      if (this.deps.usageLogRepository) {
        try {
          await this.deps.usageLogRepository.create({
            session_id: event.agentId,
            task_id: event.taskId || null,
            model: agent.model,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_usd: costUsd,
            event_type: 'completion',
          });
        } catch (err) {
          log.warn('Failed to persist usage log', { error: String(err), agentId: event.agentId });
        }
      }

      // Record productivity
      const durationMs = payload.durationMs ?? (Date.now() - agent.startedAt.getTime());
      this.productivityMonitor.recordAgentCompletion(
        event.agentId,
        event.taskId,
        agent.model,
        true,
        durationMs,
        payload.tokensUsed ?? (inputTokens + outputTokens),
        costUsd,
        payload.summary
      );

      // Record success with circuit breaker
      this.circuitBreaker.recordSuccess();
      this.consecutiveFailures = 0;
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

      const payload = event.payload as {
        error?: string;
        tokensUsed?: number;
        costUsd?: number;
        inputTokens?: number;
        outputTokens?: number;
      };

      // Record spend even on error
      const costUsd = payload.costUsd ?? 0;
      const inputTokens = payload.inputTokens ?? (payload.tokensUsed ? Math.floor(payload.tokensUsed * 0.3) : 0);
      const outputTokens = payload.outputTokens ?? (payload.tokensUsed ? Math.floor(payload.tokensUsed * 0.7) : 0);

      if (costUsd > 0 || inputTokens > 0 || outputTokens > 0) {
        this.spendMonitor.recordAgentCost(
          event.agentId,
          event.taskId,
          agent.model,
          inputTokens,
          outputTokens,
          costUsd
        );
      }

      // Persist usage to database (even on error — partial work still costs money)
      if (this.deps.usageLogRepository) {
        try {
          await this.deps.usageLogRepository.create({
            session_id: event.agentId,
            task_id: event.taskId || null,
            model: agent.model,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_usd: costUsd,
            event_type: 'error',
          });
        } catch (err) {
          log.warn('Failed to persist usage log', { error: String(err), agentId: event.agentId });
        }
      }

      // Record failed productivity
      const durationMs = Date.now() - agent.startedAt.getTime();
      this.productivityMonitor.recordAgentCompletion(
        event.agentId,
        event.taskId,
        agent.model,
        false,
        durationMs,
        payload.tokensUsed ?? (inputTokens + outputTokens),
        costUsd,
        undefined,
        payload.error
      );

      // Record failure with circuit breaker
      this.circuitBreaker.recordFailure(
        payload.error || 'Unknown error',
        { agentId: event.agentId, taskId: event.taskId }
      );
      this.consecutiveFailures++;

      // Look up projectId from task if taskRepository is available
      let projectId: string | null = null;
      if (event.taskId && this.deps.taskRepository) {
        try {
          const task = await this.deps.taskRepository.getById(event.taskId);
          if (task) {
            projectId = task.project_id;
          } else {
            log.warn('Task not found for error event', { taskId: event.taskId, agentId: event.agentId });
          }
        } catch (error) {
          log.warn('Failed to look up task for error event', { taskId: event.taskId, error: String(error) });
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
          log.info('Retrospective triggered', {
            reason: triggerResult.reason,
            taskId: event.taskId,
            agentId: event.agentId,
            projectId,
          });
        }
      } else {
        log.warn('Skipping retrospective check: no projectId available', { taskId: event.taskId, agentId: event.agentId });
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
      log.warn('Could not update agent for blocker event', { agentId: event.agentId, taskId: event.taskId });
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
      log.warn('Could not update agent for question event', { agentId: event.agentId, taskId: event.taskId });
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
   * @throws Error if pre-flight checks fail or user declines confirmation
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    log.info('Starting orchestration loop');
    log.time('startup');

    // Validate database connection on startup if configured
    if (this.config.validateDatabaseOnStartup) {
      log.info('Validating database connection');
      log.time('db-validation');
      const healthResult = await this.validateDatabaseOnStartup();
      log.timeEnd('db-validation');
      if (!healthResult.healthy) {
        log.error('Database unavailable, cannot start orchestrator', { error: healthResult.error });
        throw new Error(`Database unavailable: ${healthResult.error}. Cannot start orchestrator.`);
      }
      log.info('Database healthy', { latencyMs: healthResult.latencyMs });
      this.lastDbHealthyAt = new Date();

      // Emit healthy event
      this.emitDatabaseEvent('database:healthy', { latencyMs: healthResult.latencyMs });
    }

    // Run pre-flight checks if configured
    if (this.config.runPreFlightChecks) {
      log.info('Running pre-flight checks');
      log.time('pre-flight');

      try {
        this.preFlightChecker = new PreFlightChecker(getClient(), {
          skipSlack: !this.config.requirePreFlightConfirmation,
          ...this.config.preFlightConfig,
        });

        const preFlightResult = await this.preFlightChecker.runChecks();
        this.lastPreFlightResult = preFlightResult;

        log.info('Pre-flight checks completed', {
          passed: preFlightResult.passed,
          taskCount: preFlightResult.queuedTaskCount,
          warningCount: preFlightResult.warnings.length,
          testDataDetected: preFlightResult.testDataDetected,
          unconfirmedCount: preFlightResult.unconfirmedPriorityCount,
        });

        // Send summary to Slack and wait for confirmation if configured
        if (this.config.requirePreFlightConfirmation) {
          await this.preFlightChecker.sendSummaryToSlack();
          log.info('Pre-flight summary sent to Slack, waiting for confirmation');

          const confirmed = await this.preFlightChecker.waitForConfirmation();
          if (!confirmed) {
            log.warn('Pre-flight confirmation declined or timed out');
            log.timeEnd('pre-flight');
            throw new Error('Pre-flight checks not confirmed. Startup aborted.');
          }
          log.info('Pre-flight checks confirmed by user');
        }
      } catch (error) {
        log.timeEnd('pre-flight');
        if (error instanceof Error && error.message.includes('not confirmed')) {
          throw error;
        }
        log.error('Pre-flight checks failed', error instanceof Error ? error : new Error(String(error)));
        throw new Error(`Pre-flight checks failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      log.timeEnd('pre-flight');
    }

    // Try to load previous state
    const loaded = await this.stateManager.loadState();
    if (loaded) {
      log.info('Recovered state from previous session');
    }

    // Sync capacity with agent manager
    this.deps.scheduler.syncCapacity();

    // Update state
    this.running = true;
    this.paused = false;
    this.degraded = false;
    this.shuttingDown = false;
    this.consecutiveDbFailures = 0;
    this.consecutiveFailures = 0;
    this.stateManager.updateState({ isRunning: true, isPaused: false });

    // Start the poll loop
    this.startPolling();

    // Start status check-in interval
    this.startStatusCheckIn();

    // Setup signal handlers for graceful shutdown
    this.setupSignalHandlers();

    log.timeEnd('startup');
    log.info('Orchestration loop started', {
      pollIntervalMs: this.config.pollIntervalMs,
      maxConcurrentAgents: this.config.maxConcurrentAgents,
    });

    // Send startup notification to Slack
    if (this.slackIntegration) {
      const channelId = process.env.TC_SLACK_CHANNEL || '';
      if (channelId) {
        await this.slackIntegration.sendMessage(
          channelId,
          '*TrafficControl Started*\n' + this.formatStatusForSlack()
        ).catch(err => log.error('Failed to send startup notification', err instanceof Error ? err : new Error(String(err))));
      }
    }
  }

  /**
   * Sets up signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const handleShutdown = async (signal: string) => {
      log.info(`Received ${signal}, initiating graceful shutdown`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  }

  /**
   * Validates database connection on startup with retry logic
   */
  private async validateDatabaseOnStartup(): Promise<HealthCheckResult> {
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
   * Stops the main orchestration loop
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.shuttingDown = true;
    log.info('Stopping orchestration loop');
    log.time('shutdown');

    // Stop polling
    this.stopPolling();

    // Stop status check-in
    this.stopStatusCheckIn();

    // Wait for active agents to complete (with timeout)
    await this.waitForAgents();

    // Update state
    this.running = false;
    this.paused = false;
    this.stateManager.updateState({ isRunning: false, isPaused: false });

    // Save state
    await this.stateManager.saveState();

    // Send final summary to Slack
    if (this.slackIntegration) {
      const channelId = process.env.TC_SLACK_CHANNEL || '';
      if (channelId) {
        await this.slackIntegration.sendMessage(
          channelId,
          '*TrafficControl Stopped*\n\n*Final Summary:*\n' + this.formatFinalSummary()
        ).catch(err => log.error('Failed to send shutdown notification', err instanceof Error ? err : new Error(String(err))));
      }
    }

    // Cleanup circuit breaker
    this.circuitBreaker.destroy();

    log.timeEnd('shutdown');
    log.info('Orchestration loop stopped');
  }

  /**
   * Pauses the orchestration loop (stops scheduling new tasks)
   */
  async pause(): Promise<void> {
    if (!this.running || this.paused) {
      return;
    }

    log.info('Pausing orchestration loop');

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

    log.info('Resuming orchestration loop');

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
    const spendStats = this.spendMonitor.getStats();
    const productivityStats = this.productivityMonitor.getStats();
    const circuitBreakerStats = this.circuitBreaker.getStats();
    const approvalStats = this.taskApprovalManager.getStats();

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
      safety: {
        circuitBreakerState: circuitBreakerStats.state,
        circuitBreakerTripped: circuitBreakerStats.isTripped,
        spendStats: {
          dailySpend: spendStats.dailySpend,
          weeklySpend: spendStats.weeklySpend,
          dailyBudgetUsed: spendStats.dailyBudgetUsed,
          weeklyBudgetUsed: spendStats.weeklyBudgetUsed,
          isOverBudget: spendStats.isOverBudget,
        },
        productivityStats: {
          tasksCompleted: productivityStats.tasksCompleted,
          tasksSuccessful: productivityStats.tasksSuccessful,
          tasksFailed: productivityStats.tasksFailed,
          successRate: productivityStats.successRate,
          consecutiveFailures: this.consecutiveFailures,
        },
        pendingApprovals: approvalStats.pending,
      },
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
   * Gets the pre-flight checker instance (if pre-flight checks were run)
   */
  getPreFlightChecker(): PreFlightChecker | null {
    return this.preFlightChecker;
  }

  /**
   * Gets the last pre-flight check result
   */
  getLastPreFlightResult(): PreFlightResult | null {
    return this.lastPreFlightResult;
  }

  /**
   * Gets the circuit breaker instance
   */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Gets the spend monitor instance
   */
  getSpendMonitor(): SpendMonitor {
    return this.spendMonitor;
  }

  /**
   * Gets the productivity monitor instance
   */
  getProductivityMonitor(): ProductivityMonitor {
    return this.productivityMonitor;
  }

  /**
   * Gets the task approval manager instance
   */
  getTaskApprovalManager(): TaskApprovalManager {
    return this.taskApprovalManager;
  }

  /**
   * Manually reset the circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset(true);
    this.consecutiveFailures = 0;
    log.info('Circuit breaker manually reset');
  }

  /**
   * Handle task approval response (called from external Slack handler)
   */
  handleTaskApprovalResponse(taskId: string, approved: boolean, respondedBy: string, reason?: string): void {
    this.taskApprovalManager.handleResponse(taskId, approved, respondedBy, reason);
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
   * Starts the status check-in interval
   */
  private startStatusCheckIn(): void {
    if (this.config.statusCheckInIntervalMs <= 0) {
      return;
    }

    this.statusCheckInInterval = setInterval(async () => {
      await this.sendStatusCheckIn();
    }, this.config.statusCheckInIntervalMs);

    log.info('Status check-in started', { intervalMs: this.config.statusCheckInIntervalMs });
  }

  /**
   * Stops the status check-in interval
   */
  private stopStatusCheckIn(): void {
    if (this.statusCheckInInterval) {
      clearInterval(this.statusCheckInInterval);
      this.statusCheckInInterval = null;
    }
  }

  /**
   * Sends a periodic status check-in to Slack
   */
  private async sendStatusCheckIn(): Promise<void> {
    if (!this.slackIntegration || !this.running) {
      return;
    }

    const channelId = process.env.TC_SLACK_CHANNEL || '';
    if (!channelId) {
      return;
    }

    log.info('Sending status check-in');

    const message = `*Status Check-In*\n${this.formatStatusForSlack()}`;
    await this.slackIntegration.sendMessage(channelId, message)
      .catch(err => log.error('Failed to send status check-in', err instanceof Error ? err : new Error(String(err))));
  }

  /**
   * Format current status for Slack
   */
  private formatStatusForSlack(): string {
    const stats = this.getStats();
    const lines: string[] = [
      '',
      '```',
      `Status:     ${stats.isRunning ? (stats.isPaused ? 'Paused' : 'Running') : 'Stopped'}`,
      `Mode:       ${stats.isDegraded ? 'DEGRADED' : 'Normal'}`,
      `Active:     ${stats.activeAgentCount} agents`,
      `Queued:     ${stats.schedulerStats.queuedTasks} tasks`,
      '',
      'Capacity:',
      `  Opus:    ${stats.schedulerStats.capacity.opus.current}/${stats.schedulerStats.capacity.opus.limit} (${Math.round(stats.schedulerStats.capacity.opus.utilization)}%)`,
      `  Sonnet:  ${stats.schedulerStats.capacity.sonnet.current}/${stats.schedulerStats.capacity.sonnet.limit} (${Math.round(stats.schedulerStats.capacity.sonnet.utilization)}%)`,
      '',
      'Spend:',
      `  Daily:   $${stats.safety.spendStats.dailySpend.toFixed(2)} (${stats.safety.spendStats.dailyBudgetUsed.toFixed(1)}%)`,
      `  Weekly:  $${stats.safety.spendStats.weeklySpend.toFixed(2)} (${stats.safety.spendStats.weeklyBudgetUsed.toFixed(1)}%)`,
      '',
      'Productivity:',
      `  Completed: ${stats.safety.productivityStats.tasksCompleted}`,
      `  Success:   ${stats.safety.productivityStats.successRate.toFixed(1)}%`,
      `  Failed:    ${stats.safety.productivityStats.tasksFailed}`,
      '',
      `Circuit:    ${stats.safety.circuitBreakerState}${stats.safety.circuitBreakerTripped ? ' [TRIPPED]' : ''}`,
      `Approvals:  ${stats.safety.pendingApprovals} pending`,
      '```',
    ];

    // Add warnings
    if (stats.safety.circuitBreakerTripped) {
      lines.push('');
      lines.push('*[!] Circuit breaker is tripped - operations paused*');
    }

    if (stats.safety.spendStats.isOverBudget) {
      lines.push('');
      lines.push('*[!] Over budget - consider pausing operations*');
    }

    if (stats.isDegraded) {
      lines.push('');
      lines.push('*[!] Database degraded - limited operations*');
    }

    return lines.join('\n');
  }

  /**
   * Format final summary for shutdown
   */
  private formatFinalSummary(): string {
    const spendStats = this.spendMonitor.getStats();
    const productivityStats = this.productivityMonitor.getStats();

    const lines: string[] = [
      '```',
      'Session Summary:',
      `  Tasks Completed: ${productivityStats.tasksCompleted}`,
      `  Success Rate:    ${productivityStats.successRate.toFixed(1)}%`,
      `  Total Spend:     $${spendStats.totalSpend.toFixed(2)}`,
      '',
      'By Model:',
      `  Opus:   ${productivityStats.byModel.opus.completed} tasks, $${spendStats.byModel.opus.spend.toFixed(2)}`,
      `  Sonnet: ${productivityStats.byModel.sonnet.completed} tasks, $${spendStats.byModel.sonnet.spend.toFixed(2)}`,
      `  Haiku:  ${productivityStats.byModel.haiku.completed} tasks, $${spendStats.byModel.haiku.spend.toFixed(2)}`,
      '```',
    ];

    return lines.join('\n');
  }

  /**
   * Single tick of the orchestration loop
   */
  private async tick(): Promise<void> {
    if (!this.running || this.paused || this.shuttingDown) {
      return;
    }

    // Check circuit breaker
    if (!this.circuitBreaker.allowsOperation()) {
      log.debug('Circuit breaker preventing operation');
      return;
    }

    // Check spend limits
    if (this.spendMonitor.shouldStop()) {
      log.warn('Spend monitor triggered stop due to budget limit');
      await this.pause();

      // Notify via Slack
      if (this.slackIntegration) {
        const channelId = process.env.TC_SLACK_CHANNEL || '';
        if (channelId) {
          this.slackIntegration.sendMessage(
            channelId,
            '*[!] Budget Limit Reached*\nOrchestrator paused due to budget limits.\n\n' + this.spendMonitor.formatForSlack()
          ).catch(err => log.error('Failed to send budget limit notification', err instanceof Error ? err : new Error(String(err))));
        }
      }
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
        // Try to schedule next task with approval check if enabled
        const taskFilter = this.config.enableTaskApproval
          ? this.approvalAwareScheduleCallback.bind(this)
          : undefined;
        const result = await this.deps.scheduler.scheduleNext(undefined, taskFilter);

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

            log.info('Scheduled task', {
              taskId: scheduled.taskId,
              model: scheduled.model,
              sessionId: scheduled.sessionId,
            });
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
        log.error('Error in tick', error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Callback for approval-aware scheduling (checks task approval before scheduling)
   */
  private async approvalAwareScheduleCallback(task: Task): Promise<boolean> {
    // Check if task requires approval
    if (this.taskApprovalManager.requiresApproval(task)) {
      // Check if already approved
      if (!this.taskApprovalManager.isApproved(task.id)) {
        // Check if approval already pending
        const pending = this.taskApprovalManager.getPendingApproval(task.id);
        if (!pending) {
          // Request approval
          log.info('Requesting approval for task', { taskId: task.id, title: task.title });
          await this.taskApprovalManager.requestApproval(task);
        }
        // Skip this task for now
        return false;
      }
    }
    // Task is approved or doesn't require approval
    return true;
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
        log.warn('Graceful shutdown timeout reached, forcing stop', {
          elapsedMs: elapsed,
          timeoutMs: timeout,
          activeAgents: this.deps.agentManager.getActiveSessions().length,
        });
        break;
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
