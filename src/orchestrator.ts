import { createSupabaseClient } from './db/client.js';
import { ProjectRepository } from './db/repositories/projects.js';
import { TaskRepository, Task } from './db/repositories/tasks.js';
import { AgentManager } from './agent/manager.js';
import { sendMessage, formatQuestion, startBot } from './slack/bot.js';
import { setMessageHandler, setupHandlers } from './slack/handlers.js';

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
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private slackChannel: string;

  constructor() {
    const client = createSupabaseClient();
    this.projectRepo = new ProjectRepository(client);
    this.taskRepo = new TaskRepository(client);
    this.agentManager = new AgentManager();
    this.slackChannel = process.env.SLACK_CHANNEL || 'trafficcontrol';

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle agent questions
    this.agentManager.onEvent('question', async (event) => {
      const session = this.agentManager.getSession(event.sessionId);
      if (!session?.taskId) return;

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

  async start(): Promise<void> {
    if (this.running) return;

    console.log('Starting TrafficControl orchestrator...');

    // Setup Slack handlers and start bot
    setupHandlers();
    await startBot();

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
    // Check for queued tasks that need agents
    const activeSessions = this.agentManager.getActiveSessions();

    // For Phase 1: limit to 1 concurrent agent
    if (activeSessions.length >= 1) return;

    // Get next queued task
    const queuedTasks = await this.taskRepo.getQueued();
    if (queuedTasks.length === 0) return;

    const task = queuedTasks[0];
    await this.assignTask(task);
  }

  private async assignTask(task: Task): Promise<void> {
    const project = await this.projectRepo.getById(task.project_id);
    if (!project) return;

    console.log(`Assigning task "${task.title}" to new agent`);

    // Spawn agent
    const sessionId = await this.agentManager.spawnAgent(task.id, {
      model: task.estimated_sessions_opus > 0 ? 'opus' : 'sonnet',
      projectPath: process.cwd(), // Will be project-specific in later phases
      systemPrompt: `You are working on project "${project.name}". Task: ${task.title}\n\n${task.description || ''}`
    });

    // Update task
    await this.taskRepo.assignAgent(task.id, sessionId);
  }
}
