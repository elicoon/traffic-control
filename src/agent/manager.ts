import { randomUUID } from 'node:crypto';
import { AgentConfig, AgentSession, AgentEvent, AgentEventHandler } from './types.js';
import {
  ISDKAdapter,
  SDKAdapter,
  ActiveQuery,
  SDKAdapterConfig,
  TokenUsage,
  getSDKAdapter,
} from './sdk-adapter.js';
import { SubagentTracker } from './subagent-tracker.js';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Extended session info that includes the active query
 */
interface SessionInfo {
  session: AgentSession;
  activeQuery?: ActiveQuery;
  pendingMessage?: string;
}

/**
 * Configuration options for AgentManager
 */
export interface AgentManagerOptions {
  /** Maximum depth for subagent nesting (default: 2) */
  maxSubagentDepth?: number;
}

export class AgentManager {
  private sessions: Map<string, SessionInfo> = new Map();
  private eventHandlers: Map<AgentEvent['type'], AgentEventHandler[]> = new Map();
  private sdkAdapter: ISDKAdapter;
  private subagentTracker: SubagentTracker;

  constructor(sdkAdapter?: ISDKAdapter, options?: AgentManagerOptions) {
    // Initialize event handler maps
    this.eventHandlers.set('question', []);
    this.eventHandlers.set('tool_call', []);
    this.eventHandlers.set('completion', []);
    this.eventHandlers.set('error', []);

    // Use provided adapter or get the default
    this.sdkAdapter = sdkAdapter ?? getSDKAdapter();

    // Initialize subagent tracker with configured max depth
    this.subagentTracker = new SubagentTracker(options?.maxSubagentDepth ?? 2);
  }

  getActiveSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.session.status === 'running' || s.session.status === 'blocked')
      .map(s => s.session);
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id)?.session;
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

  /**
   * Handle an SDK message by mapping it to our event system
   */
  private async handleSDKMessage(message: SDKMessage, sessionId: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return;

    // Map the SDK message to our event type
    const event = this.sdkAdapter.mapToAgentEvent(message, sessionId);

    if (event) {
      // Update session status based on event type
      if (event.type === 'question') {
        sessionInfo.session.status = 'blocked';
        this.sessions.set(sessionId, sessionInfo);
      } else if (event.type === 'completion') {
        sessionInfo.session.status = 'complete';
        // Extract and update token usage
        const data = event.data as { usage?: TokenUsage };
        if (data.usage) {
          sessionInfo.session.tokensUsed = data.usage.totalTokens;
        }
        this.sessions.set(sessionId, sessionInfo);
      } else if (event.type === 'error') {
        sessionInfo.session.status = 'failed';
        const data = event.data as { usage?: TokenUsage };
        if (data.usage) {
          sessionInfo.session.tokensUsed = data.usage.totalTokens;
        }
        this.sessions.set(sessionId, sessionInfo);
      }

      // Emit the event to handlers
      await this.emitEvent(event);
    }
  }

  /**
   * Build the system prompt for a task
   */
  private buildSystemPrompt(taskId: string, config: AgentConfig): string {
    const parts: string[] = [];

    // Add task context
    parts.push(`You are working on task ID: ${taskId}`);
    parts.push(`Working directory: ${config.projectPath}`);

    // Add custom system prompt if provided
    if (config.systemPrompt) {
      parts.push('');
      parts.push('Additional instructions:');
      parts.push(config.systemPrompt);
    }

    return parts.join('\n');
  }

  async spawnAgent(taskId: string, config: AgentConfig): Promise<string> {
    const sessionId = randomUUID();

    const session: AgentSession = {
      id: sessionId,
      taskId,
      model: config.model,
      status: 'running',
      startedAt: new Date(),
      tokensUsed: 0,
      parentSessionId: null,
      depth: 0,
    };

    const sessionInfo: SessionInfo = {
      session,
    };

    this.sessions.set(sessionId, sessionInfo);

    // Register as root session in subagent tracker
    this.subagentTracker.registerRootSession(sessionId);

    // Build SDK adapter configuration
    const sdkConfig: SDKAdapterConfig = {
      cwd: config.projectPath,
      model: config.model,
      systemPrompt: this.buildSystemPrompt(taskId, config),
      maxTurns: config.maxTurns,
      permissionMode: 'default',
    };

    // Start the SDK query with message handling
    try {
      const activeQuery = await this.sdkAdapter.startQuery(
        sessionId,
        `Begin working on the assigned task. Follow the system prompt instructions.`,
        sdkConfig,
        (message, sid) => this.handleSDKMessage(message, sid)
      );

      // Store the active query
      sessionInfo.activeQuery = activeQuery;
      this.sessions.set(sessionId, sessionInfo);

      console.log(`Spawned agent ${sessionId} for task ${taskId} using model ${config.model}`);
    } catch (err) {
      // If SDK initialization fails, mark session as failed
      session.status = 'failed';
      this.sessions.set(sessionId, sessionInfo);

      await this.emitEvent({
        type: 'error',
        sessionId,
        data: {
          error: err instanceof Error ? err.message : String(err),
          phase: 'initialization',
        },
        timestamp: new Date(),
      });

      throw err;
    }

    return sessionId;
  }

  async injectMessage(sessionId: string, message: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const { session, activeQuery } = sessionInfo;

    if (session.status !== 'blocked' && session.status !== 'waiting_approval') {
      throw new Error(
        `Session ${sessionId} is not in a state that accepts messages (current: ${session.status})`
      );
    }

    // Update status to running
    session.status = 'running';
    this.sessions.set(sessionId, sessionInfo);

    // If we have an active query, send the message through SDK
    if (activeQuery && activeQuery.isRunning) {
      try {
        await activeQuery.sendMessage(message);
        console.log(`Injected message into session ${sessionId}: ${message.substring(0, 50)}...`);
      } catch (err) {
        // If sending fails, mark as blocked again
        session.status = 'blocked';
        this.sessions.set(sessionId, sessionInfo);
        throw new Error(`Failed to inject message: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // No active query - store the message for when the query resumes
      sessionInfo.pendingMessage = message;
      this.sessions.set(sessionId, sessionInfo);
      console.log(`Stored pending message for session ${sessionId}`);
    }
  }

  async terminateSession(sessionId: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return;

    // First, terminate all descendants
    const descendants = this.subagentTracker.getDescendants(sessionId);
    for (const descendantId of descendants) {
      await this.terminateSingleSession(descendantId);
    }

    // Then terminate this session
    await this.terminateSingleSession(sessionId);

    // Remove from subagent tracker (also removes descendants)
    this.subagentTracker.removeSession(sessionId);
  }

  /**
   * Terminate a single session without cascading to children
   */
  private async terminateSingleSession(sessionId: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return;

    const { session, activeQuery } = sessionInfo;

    // Close the active query if running
    if (activeQuery) {
      try {
        activeQuery.close();
      } catch (err) {
        console.error(`Error closing query for session ${sessionId}:`, err);
      }
    }

    session.status = 'failed';
    this.sessions.set(sessionId, sessionInfo);

    await this.emitEvent({
      type: 'completion',
      sessionId,
      data: { reason: 'terminated' },
      timestamp: new Date(),
    });
  }

  /**
   * Get the total tokens used across all sessions
   */
  getTotalTokensUsed(): number {
    return Array.from(this.sessions.values()).reduce(
      (total, info) => total + info.session.tokensUsed,
      0
    );
  }

  /**
   * Get sessions by status
   */
  getSessionsByStatus(status: AgentSession['status']): AgentSession[] {
    return Array.from(this.sessions.values())
      .filter(info => info.session.status === status)
      .map(info => info.session);
  }

  /**
   * Check if a session has an active running query
   */
  isSessionActive(sessionId: string): boolean {
    const sessionInfo = this.sessions.get(sessionId);
    return sessionInfo?.activeQuery?.isRunning ?? false;
  }

  /**
   * Spawn a subagent under an existing parent session
   * @param parentSessionId The parent session ID
   * @param taskId The task ID for the subagent
   * @param prompt The initial prompt for the subagent
   * @param config Agent configuration
   * @returns The created AgentSession
   */
  async spawnSubagent(
    parentSessionId: string,
    taskId: string,
    prompt: string,
    config: AgentConfig
  ): Promise<AgentSession> {
    // Verify parent exists
    const parentInfo = this.sessions.get(parentSessionId);
    if (!parentInfo) {
      throw new Error(`Parent session ${parentSessionId} not found`);
    }

    // Check if we can spawn at this depth
    if (!this.subagentTracker.canSpawnSubagent(parentSessionId)) {
      const depth = this.subagentTracker.getDepth(parentSessionId);
      throw new Error(
        `Maximum subagent depth (${this.subagentTracker.getMaxDepth()}) exceeded. ` +
          `Parent session ${parentSessionId} is at depth ${depth}.`
      );
    }

    const sessionId = randomUUID();
    const parentDepth = this.subagentTracker.getDepth(parentSessionId);

    const session: AgentSession = {
      id: sessionId,
      taskId,
      model: config.model,
      status: 'running',
      startedAt: new Date(),
      tokensUsed: 0,
      parentSessionId,
      depth: parentDepth + 1,
    };

    const sessionInfo: SessionInfo = {
      session,
    };

    this.sessions.set(sessionId, sessionInfo);

    // Register in subagent tracker
    this.subagentTracker.registerSubagent(parentSessionId, sessionId);

    // Build SDK adapter configuration with subagent context
    const sdkConfig: SDKAdapterConfig = {
      cwd: config.projectPath,
      model: config.model,
      systemPrompt: this.buildSubagentSystemPrompt(taskId, parentSessionId, config),
      maxTurns: config.maxTurns,
      permissionMode: 'default',
    };

    // Start the SDK query with message handling
    try {
      const activeQuery = await this.sdkAdapter.startQuery(
        sessionId,
        prompt,
        sdkConfig,
        (message, sid) => this.handleSDKMessage(message, sid)
      );

      // Store the active query
      sessionInfo.activeQuery = activeQuery;
      this.sessions.set(sessionId, sessionInfo);

      console.log(
        `Spawned subagent ${sessionId} for task ${taskId} under parent ${parentSessionId} ` +
          `at depth ${session.depth} using model ${config.model}`
      );
    } catch (err) {
      // If SDK initialization fails, mark session as failed
      session.status = 'failed';
      this.sessions.set(sessionId, sessionInfo);

      // Remove from tracker
      this.subagentTracker.removeSession(sessionId);

      await this.emitEvent({
        type: 'error',
        sessionId,
        data: {
          error: err instanceof Error ? err.message : String(err),
          phase: 'initialization',
          parentSessionId,
        },
        timestamp: new Date(),
      });

      throw err;
    }

    return session;
  }

  /**
   * Build system prompt for a subagent with parent context
   */
  private buildSubagentSystemPrompt(
    taskId: string,
    parentSessionId: string,
    config: AgentConfig
  ): string {
    const parts: string[] = [];

    // Add task context
    parts.push(`You are a subagent working on task ID: ${taskId}`);
    parts.push(`Parent session ID: ${parentSessionId}`);
    parts.push(`Working directory: ${config.projectPath}`);

    // Add custom system prompt if provided
    if (config.systemPrompt) {
      parts.push('');
      parts.push('Additional instructions:');
      parts.push(config.systemPrompt);
    }

    return parts.join('\n');
  }

  /**
   * Check if a session can spawn a subagent (hasn't reached max depth)
   * @param sessionId The session to check
   * @returns true if the session can spawn subagents
   */
  canSpawnSubagent(sessionId: string): boolean {
    return this.subagentTracker.canSpawnSubagent(sessionId);
  }

  /**
   * Get all child sessions for a parent session
   * @param parentSessionId The parent session ID
   * @returns Array of child AgentSession objects
   */
  getChildSessions(parentSessionId: string): AgentSession[] {
    const hierarchy = this.subagentTracker.getHierarchy(parentSessionId);
    if (!hierarchy) {
      return [];
    }

    return hierarchy.children
      .map(child => this.sessions.get(child.sessionId)?.session)
      .filter((session): session is AgentSession => session !== undefined);
  }

  /**
   * Get the root session ID for a given session
   * @param sessionId The session ID to find the root for
   * @returns The root session ID, or null if not found
   */
  getRootSession(sessionId: string): string | null {
    return this.subagentTracker.getRootSession(sessionId);
  }

  /**
   * Get aggregated token usage for a session including all its descendants
   * @param sessionId The session ID to aggregate usage for
   * @returns TokenUsage with aggregated values
   */
  getAggregatedUsage(sessionId: string): TokenUsage {
    const emptyUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
    };

    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      return emptyUsage;
    }

    // Start with this session's usage
    let totalTokens = sessionInfo.session.tokensUsed;

    // Add all descendants' usage
    const descendants = this.subagentTracker.getDescendants(sessionId);
    for (const descendantId of descendants) {
      const descendantInfo = this.sessions.get(descendantId);
      if (descendantInfo) {
        totalTokens += descendantInfo.session.tokensUsed;
      }
    }

    // Note: We only track totalTokens in sessions currently
    // In a more complete implementation, we'd track full TokenUsage
    return {
      ...emptyUsage,
      totalTokens,
    };
  }
}
