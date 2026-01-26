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
}

export interface AgentEvent {
  type: 'question' | 'tool_call' | 'completion' | 'error';
  sessionId: string;
  data: unknown;
  timestamp: Date;
}

export type AgentEventHandler = (event: AgentEvent) => Promise<void>;
