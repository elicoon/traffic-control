import { createSupabaseClient, SupabaseClient } from './db/client.js';
import { ProjectRepository, Project } from './db/repositories/projects.js';
import { TaskRepository, Task } from './db/repositories/tasks.js';
import { AgentManager } from './agent/manager.js';
import { Scheduler, ModelType } from './scheduler/index.js';
import { sendMessage, formatQuestion, startBot } from './slack/bot.js';
import { setMessageHandler, setupHandlers } from './slack/handlers.js';
import { ContextBudgetManager, ContextEntry, DelegationMetricsManager, PreFlightChecker, createPreFlightChecker } from './orchestrator/index.js';
import { DashboardServer } from './dashboard/index.js';
import { MetricsCollector, RecommendationEngine } from './reporter/index.js';
import { CostTracker } from './analytics/cost-tracker.js';
import { logger } from './logging/index.js';

const log = logger.child('Orchestrator');

interface PendingQuestion {
  sessionId: string;
  taskId: string;
  projectName: string;
  question: string;
  slackThreadTs?: string;
  askedAt: Date;
}

export class Orchestrator {
  private running = false;
  private confirmed = false;
  private supabaseClient: SupabaseClient;
  private projectRepo: ProjectRepository;
  private taskRepo: TaskRepository;
  private agentManager: AgentManager;
  private scheduler: Scheduler;
  private contextBudget: ContextBudgetManager;
  private delegationMetrics: DelegationMetricsManager;
  private preFlightChecker: PreFlightChecker;
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private slackChannel: string;
  private dashboardServer: DashboardServer | null = null;
  private metricsCollector: MetricsCollector;
  private recommendationEngine: RecommendationEngine;

  constructor() {
    this.supabaseClient = createSupabaseClient();
    this.projectRepo = new ProjectRepository(this.supabaseClient);
    this.taskRepo = new TaskRepository(this.supabaseClient);
    this.agentManager = new AgentManager();
    this.scheduler = new Scheduler({ agentManager: this.agentManager });
    this.contextBudget = new ContextBudgetManager();
    this.delegationMetrics = new DelegationMetricsManager();
    this.slackChannel = process.env.SLACK_CHANNEL || 'trafficcontrol';
    this.metricsCollector = new MetricsCollector(this.supabaseClient);
    this.recommendationEngine = new RecommendationEngine();
    this.preFlightChecker = createPreFlightChecker(this.supabaseClient, {
      slackChannelId: this.slackChannel,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle agent questions
    this.agentManager.onEvent('question', async (event) => {
      const session = this.agentManager.getSession(event.sessionId);
      if (!session?.taskId) return;

      // Track question in delegation metrics
      this.delegationMetrics.recordQuestion(event.sessionId);

      const task = await this.taskRepo.getById(session.taskId);
      if (!task) return;

      const project = await this.projectRepo.getById(task.project_id);
      const projectName = project?.name || 'Unknown';
      const question = String(event.data);

      // Send to Slack
      const message = formatQuestion(projectName, question);
      const threadTs = await sendMessage({
        channel: this.slackChannel,
        text: message
      });

      // Track pending question
      this.pendingQuestions.set(event.sessionId, {
        sessionId: event.sessionId,
        taskId: session.taskId,
        projectName,
        question,
        slackThreadTs: threadTs,
        askedAt: new Date()
      });
    });

    // Handle agent completion to release capacity and context budget
    this.agentManager.onEvent('completion', async (event) => {
      const session = this.agentManager.getSession(event.sessionId);
      if (session) {
        this.scheduler.releaseCapacity(session.model, event.sessionId);

        // Complete delegation metrics with success
        const delegation = this.delegationMetrics.completeDelegation(event.sessionId, {
          outcome: 'success',
        });
        if (delegation) {
          log.info('Delegation completed successfully', { taskId: delegation.taskId, durationMs: delegation.durationMs, questionCount: delegation.questionCount });
        }

        // Remove context budget entries for this task
        if (session.taskId) {
          const removed = this.contextBudget.removeEntriesByReference(session.taskId);
          if (removed > 0) {
            log.info('Removed context entries for completed task', { removed, taskId: session.taskId });
          }
        }
      }
    });

    // Handle agent errors to release capacity and context budget
    this.agentManager.onEvent('error', async (event) => {
      const session = this.agentManager.getSession(event.sessionId);
      if (session) {
        this.scheduler.releaseCapacity(session.model, event.sessionId);

        // Complete delegation metrics with failure
        const errorMessage = event.data ? String(event.data) : undefined;
        const delegation = this.delegationMetrics.completeDelegation(event.sessionId, {
          outcome: 'failure',
          errorMessage,
        });
        if (delegation) {
          log.error('Delegation failed', { taskId: delegation.taskId, durationMs: delegation.durationMs, questionCount: delegation.questionCount, error: errorMessage });
        }

        // Remove context budget entries for this task
        if (session.taskId) {
          const removed = this.contextBudget.removeEntriesByReference(session.taskId);
          if (removed > 0) {
            log.info('Removed context entries for failed task', { removed, taskId: session.taskId });
          }
        }
      }
    });

    // Handle Slack replies and @mentions
    setMessageHandler(async (text, userId, threadTs) => {
      const lowerText = text.toLowerCase().trim();

      // Check for pre-flight confirmation commands
      const confirmationThreadTs = this.preFlightChecker.getConfirmationThreadTs();
      if (confirmationThreadTs && threadTs === confirmationThreadTs) {
        if (lowerText === 'confirm' || lowerText === 'yes' || lowerText === 'start') {
          log.info('Received confirmation from user', { userId });
          this.preFlightChecker.confirm(true);
          return;
        } else if (lowerText === 'abort' || lowerText === 'cancel' || lowerText === 'no' || lowerText === 'stop') {
          log.info('Received abort command from user', { userId });
          this.preFlightChecker.confirm(false);
          return;
        }
      }

      // First, check if this is a reply to a pending question
      for (const [sessionId, pq] of this.pendingQuestions) {
        if (pq.slackThreadTs === threadTs) {
          // Inject response into agent
          await this.agentManager.injectMessage(sessionId, text);
          this.pendingQuestions.delete(sessionId);
          return; // Handled as pending question reply
        }
      }

      // Fallback: Handle general @mentions with commands

      if (lowerText.includes('status')) {
        // Respond with status summary
        const stats = this.getSchedulerStats();
        const pendingQs = this.getPendingQuestions();
        const statusText = [
          '*TrafficControl Status*',
          '',
          `Opus: ${stats.capacity.opus.current}/${stats.capacity.opus.limit} active`,
          `Sonnet: ${stats.capacity.sonnet.current}/${stats.capacity.sonnet.limit} active`,
          `Pending questions: ${pendingQs.length}`,
          `Context budget: ${stats.contextWithinBudget ? 'OK' : 'Over limit'}`,
        ].join('\n');

        await sendMessage({
          channel: this.slackChannel,
          text: statusText,
          thread_ts: threadTs,
        });
      } else if (lowerText.includes('tasks') || lowerText.includes('list')) {
        // Respond with task list
        const queuedTasks = await this.taskRepo.getQueued();
        const taskLines = queuedTasks.slice(0, 10).map((t, i) =>
          `${i + 1}. ${t.title} (priority: ${t.priority ?? 0})`
        );
        const taskText = taskLines.length > 0
          ? `*Queued Tasks (${queuedTasks.length} total)*\n\n${taskLines.join('\n')}${queuedTasks.length > 10 ? '\n_...and more_' : ''}`
          : '*No queued tasks*';

        await sendMessage({
          channel: this.slackChannel,
          text: taskText,
          thread_ts: threadTs,
        });
      } else {
        // Default help response
        const helpText = [
          '*TrafficControl Bot*',
          '',
          'Available commands (mention me with):',
          '- `status` - Show current orchestrator status',
          '- `tasks` or `list` - Show queued tasks',
          '',
          'Or use `/tc help` for slash commands.',
        ].join('\n');

        await sendMessage({
          channel: this.slackChannel,
          text: helpText,
          thread_ts: threadTs,
        });
      }
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getPendingQuestions(): PendingQuestion[] {
    return Array.from(this.pendingQuestions.values());
  }

  getSchedulerStats() {
    return {
      ...this.scheduler.getStats(),
      contextBudget: this.contextBudget.getBudget(),
      contextUsageByCategory: this.contextBudget.getUsageByCategory(),
      contextWithinBudget: this.contextBudget.isWithinBudget(),
      delegationMetrics: this.delegationMetrics.getSummary(),
    };
  }

  /**
   * Get the delegation metrics manager for direct access to metrics.
   */
  getDelegationMetrics(): DelegationMetricsManager {
    return this.delegationMetrics;
  }

  async start(): Promise<void> {
    if (this.running) return;

    log.info('Starting TrafficControl orchestrator');

    // Setup Slack handlers and start bot
    setupHandlers();
    await startBot();

    // Run pre-flight checks BEFORE starting the main loop
    log.info('Running pre-flight checks');
    try {
      const preFlightResult = await this.preFlightChecker.runChecks();

      // Send summary to Slack and wait for confirmation
      await this.preFlightChecker.sendSummaryToSlack();

      log.info('Pre-flight checks complete', { queuedTaskCount: preFlightResult.queuedTaskCount });
      if (preFlightResult.warnings.length > 0) {
        log.warn('Pre-flight warnings found', { count: preFlightResult.warnings.length });
        for (const w of preFlightResult.warnings) {
          log.warn('Pre-flight warning', { severity: w.severity, message: w.message });
        }
      }

      log.info('Waiting for confirmation via Slack, reply "confirm" to start or "abort" to cancel');

      // Wait for user to confirm via Slack
      const confirmed = await this.preFlightChecker.waitForConfirmation();

      if (!confirmed) {
        log.warn('Startup aborted by user or timeout');
        await sendMessage({
          channel: this.slackChannel,
          text: '❌ *Orchestrator startup aborted.* No agents will be spawned.',
        });
        return;
      }

      this.confirmed = true;
      log.info('Confirmation received, starting orchestrator');

      await sendMessage({
        channel: this.slackChannel,
        text: '✅ *Orchestrator confirmed and starting.* Tasks will now be assigned to agents.',
      });

    } catch (error) {
      log.error('Pre-flight checks failed', error instanceof Error ? error : { error: String(error) });
      await sendMessage({
        channel: this.slackChannel,
        text: `❌ *Pre-flight checks failed:* ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    // Start dashboard server if enabled
    const dashboardEnabled = process.env.DASHBOARD_ENABLED !== 'false';
    if (dashboardEnabled) {
      const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '3000', 10);
      try {
        this.dashboardServer = new DashboardServer({
          port: dashboardPort,
          projectRepo: this.projectRepo,
          taskRepo: this.taskRepo,
          metricsCollector: this.metricsCollector,
          recommendationEngine: this.recommendationEngine,
          agentManager: this.agentManager,
          scheduler: this.scheduler,
          costTracker: new CostTracker(this.supabaseClient),
        });
        await this.dashboardServer.start();
        log.info('Dashboard available', { url: `http://localhost:${dashboardPort}` });
      } catch (error) {
        log.error('Failed to start dashboard', error instanceof Error ? error : { error: String(error) });
      }
    }

    // Sync scheduler with any existing agent sessions
    this.scheduler.syncCapacity();

    this.running = true;
    log.info('TrafficControl orchestrator is running');

    // Start the main loop
    this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;

    // Stop dashboard server if running
    if (this.dashboardServer) {
      try {
        await this.dashboardServer.stop();
        log.info('Dashboard server stopped');
      } catch (error) {
        log.error('Error stopping dashboard', error instanceof Error ? error : { error: String(error) });
      }
    }

    log.info('TrafficControl orchestrator stopped');
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        log.error('Error in orchestrator loop', err instanceof Error ? err : { error: String(err) });
      }

      // Wait before next tick
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  private async tick(): Promise<void> {
    // Check context budget before processing
    this.checkContextBudget();

    // Load queued tasks into scheduler
    const queuedTasks = await this.taskRepo.getQueued();
    for (const task of queuedTasks) {
      this.scheduler.addTask(task);
    }

    // Check if we can schedule anything
    if (!this.scheduler.canSchedule()) {
      return;
    }

    // Schedule all available tasks up to capacity
    const results = await this.scheduler.scheduleAll(
      async (task: Task, model: ModelType) => this.spawnAgentForTask(task, model)
    );

    // Log results
    for (const result of results) {
      if (result.status === 'scheduled' && result.tasks) {
        for (const scheduled of result.tasks) {
          log.info('Scheduled task', { taskId: scheduled.taskId, model: scheduled.model, sessionId: scheduled.sessionId });
        }
      } else if (result.status === 'error') {
        log.error('Scheduling error', { error: result.error });
      }
    }
  }

  private async spawnAgentForTask(task: Task, model: ModelType): Promise<string> {
    const project = await this.projectRepo.getById(task.project_id);
    if (!project) {
      throw new Error(`Project not found for task ${task.id}`);
    }

    log.info('Assigning task to agent', { title: task.title, model });

    // Build minimal context for the task
    const systemPrompt = this.buildMinimalTaskContext(task, project);

    // Track delegated task in context budget
    const budgetEntry = this.contextBudget.addEntry({
      category: 'task',
      compressible: true,
      referenceId: task.id,
      content: systemPrompt,
    });

    // Calculate context tokens for metrics
    const contextTokens = this.contextBudget.estimateTokens(systemPrompt);

    // Spawn agent with minimal context
    const sessionId = await this.agentManager.spawnAgent(task.id, {
      model,
      projectPath: process.cwd(), // Will be project-specific in later phases
      systemPrompt,
      maxTurns: 50, // Default max turns to prevent runaway agents
    });

    // Record delegation metrics
    this.delegationMetrics.recordDelegation({
      taskId: task.id,
      sessionId,
      model,
      contextTokens,
    });

    log.info('Delegation recorded', { taskId: task.id, sessionId, model, contextTokens });

    // Update task in database
    await this.taskRepo.assignAgent(task.id, sessionId);

    return sessionId;
  }

  /**
   * Build a minimal, focused context prompt for a task.
   * References documentation files instead of embedding full content.
   */
  private buildMinimalTaskContext(task: Task, project: Project): string {
    const lines: string[] = [
      `# Task Assignment`,
      ``,
      `## Project: ${project.name}`,
      ``,
      `## Task: ${task.title}`,
      ``,
    ];

    if (task.description) {
      lines.push(`## Description`);
      lines.push(task.description);
      lines.push(``);
    }

    // Add success criteria if available
    if (task.acceptance_criteria) {
      lines.push(`## Success Criteria`);
      if (Array.isArray(task.acceptance_criteria)) {
        for (const criterion of task.acceptance_criteria) {
          lines.push(`- ${criterion}`);
        }
      } else {
        lines.push(String(task.acceptance_criteria));
      }
      lines.push(``);
    }

    // Reference documentation instead of embedding content
    lines.push(`## Guidelines`);
    lines.push(`- Refer to CAPABILITIES.md for available tools and actions`);
    lines.push(`- Refer to agents.md for agent behavior guidelines`);
    lines.push(`- Keep responses focused on the task at hand`);
    lines.push(``);

    return lines.join('\n');
  }

  /**
   * Check context budget and take action if needed.
   */
  private checkContextBudget(): void {
    // Check if we should warn about approaching limits
    if (this.contextBudget.shouldWarn()) {
      const budget = this.contextBudget.getBudget();
      const usageByCategory = this.contextBudget.getUsageByCategory();
      const utilization = (budget.currentEstimate / budget.maxTokens * 100).toFixed(1);

      log.warn('Context budget warning', { utilization, usageByCategory });
    }

    // Check if we've exceeded the target utilization
    if (!this.contextBudget.isWithinBudget()) {
      const budget = this.contextBudget.getBudget();
      const utilization = (budget.currentEstimate / budget.maxTokens * 100).toFixed(1);

      log.error('Context budget exceeded', { utilization, targetPercent: budget.targetUtilization * 100 });
      this.compressContext();
    }
  }

  /**
   * Compress context by removing or summarizing compressible entries.
   * Removes oldest compressible entries until under 50% threshold.
   */
  private compressContext(): void {
    const compressibleEntries = this.contextBudget.getCompressibleEntries();

    if (compressibleEntries.length === 0) {
      log.warn('No compressible context entries available');
      return;
    }

    log.info('Compressing context', { compressibleEntries: compressibleEntries.length });

    let entriesProcessed = 0;
    let tokensSaved = 0;

    // Process entries from oldest to newest until within budget
    for (const entry of compressibleEntries) {
      // Check if we're back within budget
      if (this.contextBudget.isWithinBudget()) {
        log.info('Context now within budget', { entriesProcessed, tokensSaved });
        break;
      }

      const originalTokens = entry.tokens;

      // Summarize the entry
      const summary = this.summarizeEntry(entry);

      if (summary === null) {
        // Entry should be removed entirely
        this.contextBudget.removeEntry(entry.id);
        tokensSaved += originalTokens;
        log.debug('Removed context entry', { category: entry.category, referenceId: entry.referenceId, tokensSaved: originalTokens });
      } else {
        // Update entry with summarized content
        this.contextBudget.updateEntry(entry.id, summary);
        const newEntry = this.contextBudget.getEntry(entry.id);
        const newTokens = newEntry?.tokens || 0;
        const saved = originalTokens - newTokens;
        tokensSaved += saved;
        log.debug('Summarized context entry', { category: entry.category, referenceId: entry.referenceId, tokensSaved: saved });
      }

      entriesProcessed++;
    }

    const budget = this.contextBudget.getBudget();
    const utilization = (budget.currentEstimate / budget.maxTokens * 100).toFixed(1);
    log.info('Compression complete', { entriesProcessed, tokensSaved, utilization });
  }

  /**
   * Summarize a context entry to reduce its token footprint.
   * Returns null if the entry should be removed entirely.
   *
   * @param entry The context entry to summarize
   * @returns Summarized content string, or null to remove the entry
   */
  private summarizeEntry(entry: ContextEntry): string | null {
    switch (entry.category) {
      case 'task':
        // Summarize task entries to a single line
        if (entry.referenceId) {
          return `Task ${entry.referenceId}: delegated`;
        }
        return null;

      case 'history':
        // History entries can be removed entirely during compression
        return null;

      case 'response':
        // Response entries can be removed during compression
        return null;

      case 'system':
        // System entries should not be compressed (they shouldn't be marked compressible)
        // But if they are, keep a minimal marker
        return '[system context compressed]';

      default:
        // Unknown category - remove it
        return null;
    }
  }
}
