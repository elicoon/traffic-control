import { createSupabaseClient } from './db/client.js';
import { ProjectRepository, Project } from './db/repositories/projects.js';
import { TaskRepository, Task } from './db/repositories/tasks.js';
import { AgentManager } from './agent/manager.js';
import { Scheduler, ModelType } from './scheduler/index.js';
import { sendMessage, formatQuestion, startBot } from './slack/bot.js';
import { setMessageHandler, setupHandlers } from './slack/handlers.js';
import { ContextBudgetManager, ContextEntry, DelegationMetricsManager } from './orchestrator/index.js';

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
  private projectRepo: ProjectRepository;
  private taskRepo: TaskRepository;
  private agentManager: AgentManager;
  private scheduler: Scheduler;
  private contextBudget: ContextBudgetManager;
  private delegationMetrics: DelegationMetricsManager;
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private slackChannel: string;

  constructor() {
    const client = createSupabaseClient();
    this.projectRepo = new ProjectRepository(client);
    this.taskRepo = new TaskRepository(client);
    this.agentManager = new AgentManager();
    this.scheduler = new Scheduler({ agentManager: this.agentManager });
    this.contextBudget = new ContextBudgetManager();
    this.delegationMetrics = new DelegationMetricsManager();
    this.slackChannel = process.env.SLACK_CHANNEL || 'trafficcontrol';

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
          console.log(`[Orchestrator] Delegation completed successfully: task=${delegation.taskId}, duration=${delegation.durationMs}ms, questions=${delegation.questionCount}`);
        }

        // Remove context budget entries for this task
        if (session.taskId) {
          const removed = this.contextBudget.removeEntriesByReference(session.taskId);
          if (removed > 0) {
            console.log(`[Orchestrator] Removed ${removed} context entries for completed task ${session.taskId}`);
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
          console.log(`[Orchestrator] Delegation failed: task=${delegation.taskId}, duration=${delegation.durationMs}ms, questions=${delegation.questionCount}, error=${errorMessage}`);
        }

        // Remove context budget entries for this task
        if (session.taskId) {
          const removed = this.contextBudget.removeEntriesByReference(session.taskId);
          if (removed > 0) {
            console.log(`[Orchestrator] Removed ${removed} context entries for failed task ${session.taskId}`);
          }
        }
      }
    });

    // Handle Slack replies
    setMessageHandler(async (text, userId, threadTs) => {
      // Find pending question by thread
      for (const [sessionId, pq] of this.pendingQuestions) {
        if (pq.slackThreadTs === threadTs) {
          // Inject response into agent
          await this.agentManager.injectMessage(sessionId, text);
          this.pendingQuestions.delete(sessionId);
          break;
        }
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

    console.log('Starting TrafficControl orchestrator...');

    // Setup Slack handlers and start bot
    setupHandlers();
    await startBot();

    // Sync scheduler with any existing agent sessions
    this.scheduler.syncCapacity();

    this.running = true;
    console.log('TrafficControl orchestrator is running');

    // Start the main loop
    this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log('TrafficControl orchestrator stopped');
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        console.error('Error in orchestrator loop:', err);
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
          console.log(
            `[Orchestrator] Scheduled task ${scheduled.taskId} with model ${scheduled.model} (session: ${scheduled.sessionId})`
          );
        }
      } else if (result.status === 'error') {
        console.error(`[Orchestrator] Scheduling error: ${result.error}`);
      }
    }
  }

  private async spawnAgentForTask(task: Task, model: ModelType): Promise<string> {
    const project = await this.projectRepo.getById(task.project_id);
    if (!project) {
      throw new Error(`Project not found for task ${task.id}`);
    }

    console.log(`[Orchestrator] Assigning task "${task.title}" to new ${model} agent`);

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
    });

    // Record delegation metrics
    this.delegationMetrics.recordDelegation({
      taskId: task.id,
      sessionId,
      model,
      contextTokens,
    });

    console.log(`[Orchestrator] Delegation recorded: task=${task.id}, session=${sessionId}, model=${model}, contextTokens=${contextTokens}`);

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

      console.warn(`[Orchestrator] Context budget warning: ${utilization}% utilized`);
      console.warn(`[Orchestrator] Usage by category:`, usageByCategory);
    }

    // Check if we've exceeded the target utilization
    if (!this.contextBudget.isWithinBudget()) {
      const budget = this.contextBudget.getBudget();
      const utilization = (budget.currentEstimate / budget.maxTokens * 100).toFixed(1);

      console.error(`[Orchestrator] Context budget exceeded: ${utilization}% utilized (target: ${budget.targetUtilization * 100}%)`);
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
      console.warn('[Orchestrator] No compressible context entries available');
      return;
    }

    console.log(`[Orchestrator] Compressing context: ${compressibleEntries.length} compressible entries`);

    let entriesProcessed = 0;
    let tokensSaved = 0;

    // Process entries from oldest to newest until within budget
    for (const entry of compressibleEntries) {
      // Check if we're back within budget
      if (this.contextBudget.isWithinBudget()) {
        console.log(`[Orchestrator] Context now within budget after processing ${entriesProcessed} entries, saved ${tokensSaved} tokens`);
        break;
      }

      const originalTokens = entry.tokens;

      // Summarize the entry
      const summary = this.summarizeEntry(entry);

      if (summary === null) {
        // Entry should be removed entirely
        this.contextBudget.removeEntry(entry.id);
        tokensSaved += originalTokens;
        console.log(`  - Removed [${entry.category}] entry (ref: ${entry.referenceId || 'none'}), saved ${originalTokens} tokens`);
      } else {
        // Update entry with summarized content
        this.contextBudget.updateEntry(entry.id, summary);
        const newEntry = this.contextBudget.getEntry(entry.id);
        const newTokens = newEntry?.tokens || 0;
        const saved = originalTokens - newTokens;
        tokensSaved += saved;
        console.log(`  - Summarized [${entry.category}] entry (ref: ${entry.referenceId || 'none'}), saved ${saved} tokens`);
      }

      entriesProcessed++;
    }

    const budget = this.contextBudget.getBudget();
    const utilization = (budget.currentEstimate / budget.maxTokens * 100).toFixed(1);
    console.log(`[Orchestrator] Compression complete: ${entriesProcessed} entries processed, ${tokensSaved} tokens saved, utilization now ${utilization}%`);
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
