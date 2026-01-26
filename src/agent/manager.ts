import { AgentConfig, AgentSession, AgentEvent, AgentEventHandler } from './types.js';

export class AgentManager {
  private sessions: Map<string, AgentSession> = new Map();
  private eventHandlers: Map<AgentEvent['type'], AgentEventHandler[]> = new Map();

  constructor() {
    // Initialize event handler maps
    this.eventHandlers.set('question', []);
    this.eventHandlers.set('tool_call', []);
    this.eventHandlers.set('completion', []);
    this.eventHandlers.set('error', []);
  }

  getActiveSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.status === 'running' || s.status === 'blocked'
    );
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  onEvent(type: AgentEvent['type'], handler: AgentEventHandler): void {
    const handlers = this.eventHandlers.get(type) || [];
    handlers.push(handler);
    this.eventHandlers.set(type, handlers);
  }

  hasHandler(type: AgentEvent['type']): boolean {
    const handlers = this.eventHandlers.get(type);
    return handlers !== undefined && handlers.length > 0;
  }

  private async emitEvent(event: AgentEvent): Promise<void> {
    const handlers = this.eventHandlers.get(event.type) || [];
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`Error in event handler for ${event.type}:`, err);
      }
    }
  }

  async spawnAgent(taskId: string, config: AgentConfig): Promise<string> {
    const sessionId = crypto.randomUUID();

    const session: AgentSession = {
      id: sessionId,
      taskId,
      model: config.model,
      status: 'running',
      startedAt: new Date(),
      tokensUsed: 0
    };

    this.sessions.set(sessionId, session);

    // TODO: Integrate with Claude Agent SDK
    // For now, this is a placeholder that will be implemented
    // when we integrate the actual SDK
    console.log(`Spawned agent ${sessionId} for task ${taskId}`);

    return sessionId;
  }

  async injectMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'blocked') {
      throw new Error(`Session ${sessionId} is not blocked`);
    }

    // Update status
    session.status = 'running';
    this.sessions.set(sessionId, session);

    // TODO: Inject message into running session
    console.log(`Injected message into session ${sessionId}: ${message}`);
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'failed';
    this.sessions.set(sessionId, session);

    await this.emitEvent({
      type: 'completion',
      sessionId,
      data: { reason: 'terminated' },
      timestamp: new Date()
    });
  }
}
