export interface AgentConfig {
  model: 'opus' | 'sonnet' | 'haiku';
  projectPath: string;
  systemPrompt?: string;
  maxTurns?: number;
}

export interface AgentSession {
  id: string;
  taskId: string | null;
  model: AgentConfig['model'];
  status: 'running' | 'blocked' | 'waiting_approval' | 'complete' | 'failed';
  startedAt: Date;
  tokensUsed: number;
  /** Parent session ID if this is a subagent (null if root) */
  parentSessionId?: string | null;
  /** Depth in the subagent hierarchy (0 = root) */
  depth?: number;
}

export interface AgentEvent {
  type: 'question' | 'tool_call' | 'completion' | 'error';
  sessionId: string;
  data: unknown;
  timestamp: Date;
}

export type AgentEventHandler = (event: AgentEvent) => Promise<void>;

/**
 * Configuration for spawning a subagent
 */
export interface SubagentConfig {
  /** Parent session ID that is spawning this subagent */
  parentSessionId: string;
  /** Maximum depth of subagent nesting (default: 2) */
  maxDepth?: number;
}

/**
 * Represents the hierarchy of agent sessions (parent-child relationships)
 */
export interface AgentHierarchy {
  /** Session ID of this agent */
  sessionId: string;
  /** Parent session ID (null if root agent) */
  parentId: string | null;
  /** Depth level (0 = root, 1 = first level subagent, etc.) */
  depth: number;
  /** Child sessions spawned by this agent */
  children: AgentHierarchy[];
}
