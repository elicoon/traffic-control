/**
 * SDK Adapter for Claude Agent SDK
 * Wraps SDK calls for easier testing/mocking and maps SDK events to our event types.
 */

import type {
  Query,
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKAssistantMessage,
  SDKResultSuccess,
  SDKResultError,
  ModelUsage,
  PermissionMode,
} from '@anthropic-ai/claude-agent-sdk';
import { AgentConfig, AgentEvent } from './types.js';

// Re-export SDK types we need
export type { Query, Options, SDKMessage, SDKResultMessage };

/**
 * Model name mapping from our simplified names to SDK model identifiers
 */
export const MODEL_MAP: Record<AgentConfig['model'], string> = {
  opus: 'claude-opus-4-20250514',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-3-20250307',
};

/**
 * Configuration for SDK adapter
 */
export interface SDKAdapterConfig {
  /** Working directory for the agent */
  cwd: string;
  /** System prompt for the agent */
  systemPrompt?: string;
  /** Model to use (opus, sonnet, haiku) */
  model: AgentConfig['model'];
  /** Maximum turns before stopping */
  maxTurns?: number;
  /** Permission mode for tool execution */
  permissionMode?: PermissionMode;
  /** Additional allowed tools */
  allowedTools?: string[];
}

/**
 * Token usage information extracted from SDK result
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

/**
 * Result of agent execution
 */
export interface AgentResult {
  success: boolean;
  result?: string;
  error?: string;
  usage: TokenUsage;
  modelUsage: Record<string, ModelUsage>;
  numTurns: number;
  durationMs: number;
}

/**
 * Callback for handling SDK messages/events
 */
export type SDKMessageHandler = (message: SDKMessage, sessionId: string) => void;

/**
 * Callback for permission requests
 */
export type PermissionHandler = (
  toolName: string,
  input: Record<string, unknown>,
  options: { toolUseID: string }
) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>;

/**
 * Active query wrapper that tracks state and provides methods
 */
export interface ActiveQuery {
  /** The underlying SDK query */
  query: Query;
  /** Session ID for this query */
  sessionId: string;
  /** Whether the query is still running */
  isRunning: boolean;
  /** Abort controller for cancellation */
  abortController: AbortController;
  /** Send a message to the running query */
  sendMessage(message: string): Promise<void>;
  /** Close and cleanup the query */
  close(): void;
}

/**
 * Interface for the SDK adapter - allows mocking in tests
 */
export interface ISDKAdapter {
  /**
   * Start a new agent query
   */
  startQuery(
    sessionId: string,
    prompt: string,
    config: SDKAdapterConfig,
    onMessage?: SDKMessageHandler
  ): Promise<ActiveQuery>;

  /**
   * Extract token usage from SDK result
   */
  extractUsage(result: SDKResultMessage): TokenUsage;

  /**
   * Map an SDK message to our AgentEvent type
   */
  mapToAgentEvent(message: SDKMessage, sessionId: string): AgentEvent | null;
}

/**
 * Default implementation of the SDK adapter
 */
export class SDKAdapter implements ISDKAdapter {
  private queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query;

  constructor(queryFn?: typeof import('@anthropic-ai/claude-agent-sdk').query) {
    // Lazily load the SDK query function if not provided (for testing)
    if (queryFn) {
      this.queryFn = queryFn;
    } else {
      // Will be initialized on first use
      this.queryFn = null as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;
    }
  }

  /**
   * Ensure the query function is loaded
   */
  private async ensureQueryFn(): Promise<void> {
    if (!this.queryFn) {
      const sdk = await import('@anthropic-ai/claude-agent-sdk');
      this.queryFn = sdk.query;
    }
  }

  /**
   * Start a new agent query with the given configuration
   */
  async startQuery(
    sessionId: string,
    prompt: string,
    config: SDKAdapterConfig,
    onMessage?: SDKMessageHandler
  ): Promise<ActiveQuery> {
    await this.ensureQueryFn();

    const abortController = new AbortController();

    const options: Options = {
      cwd: config.cwd,
      model: MODEL_MAP[config.model],
      systemPrompt: config.systemPrompt
        ? {
            type: 'preset',
            preset: 'claude_code',
            append: config.systemPrompt,
          }
        : { type: 'preset', preset: 'claude_code' },
      maxTurns: config.maxTurns,
      permissionMode: config.permissionMode ?? 'default',
      allowedTools: config.allowedTools,
      abortController,
      // Don't persist sessions for orchestrated agents
      persistSession: false,
    };

    const query = this.queryFn({ prompt, options });

    let isRunning = true;

    // Process the message stream
    const processStream = async () => {
      try {
        for await (const message of query) {
          if (onMessage) {
            onMessage(message, sessionId);
          }
        }
      } finally {
        isRunning = false;
      }
    };

    // Start processing in the background
    const streamPromise = processStream();

    const activeQuery: ActiveQuery = {
      query,
      sessionId,
      get isRunning() {
        return isRunning;
      },
      abortController,
      async sendMessage(message: string) {
        // Create an async iterable with the message
        const messageIterable = (async function* () {
          yield {
            type: 'user' as const,
            message: { role: 'user' as const, content: message },
            parent_tool_use_id: null,
            session_id: sessionId,
          };
        })();
        await query.streamInput(messageIterable);
      },
      close() {
        isRunning = false;
        abortController.abort();
        query.close();
      },
    };

    return activeQuery;
  }

  /**
   * Extract token usage information from an SDK result message
   */
  extractUsage(result: SDKResultMessage): TokenUsage {
    const usage = result.usage;
    return {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      costUSD: result.total_cost_usd ?? 0,
    };
  }

  /**
   * Map an SDK message to our internal AgentEvent type
   */
  mapToAgentEvent(message: SDKMessage, sessionId: string): AgentEvent | null {
    const timestamp = new Date();

    switch (message.type) {
      case 'assistant': {
        const assistantMsg = message as SDKAssistantMessage;
        // Check if the message contains tool use (question or action)
        const content = assistantMsg.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              // Check if it's asking a question (e.g., via ask tool)
              if (block.name === 'AskUserQuestion' || block.name === 'ask') {
                return {
                  type: 'question',
                  sessionId,
                  data: {
                    toolUseId: block.id,
                    question: block.input,
                  },
                  timestamp,
                };
              }
              // Otherwise it's a regular tool call
              return {
                type: 'tool_call',
                sessionId,
                data: {
                  toolUseId: block.id,
                  toolName: block.name,
                  input: block.input,
                },
                timestamp,
              };
            }
          }
        }
        return null;
      }

      case 'result': {
        const resultMsg = message as SDKResultSuccess | SDKResultError;
        if (resultMsg.subtype === 'success') {
          return {
            type: 'completion',
            sessionId,
            data: {
              success: true,
              result: (resultMsg as SDKResultSuccess).result,
              usage: this.extractUsage(resultMsg),
              numTurns: resultMsg.num_turns,
              durationMs: resultMsg.duration_ms,
            },
            timestamp,
          };
        } else {
          return {
            type: 'error',
            sessionId,
            data: {
              success: false,
              errors: (resultMsg as SDKResultError).errors,
              subtype: resultMsg.subtype,
              usage: this.extractUsage(resultMsg),
              numTurns: resultMsg.num_turns,
              durationMs: resultMsg.duration_ms,
            },
            timestamp,
          };
        }
      }

      case 'tool_progress': {
        // Emit tool call events for progress tracking
        return {
          type: 'tool_call',
          sessionId,
          data: {
            toolUseId: message.tool_use_id,
            toolName: message.tool_name,
            elapsedSeconds: message.elapsed_time_seconds,
            isProgress: true,
          },
          timestamp,
        };
      }

      default:
        // Ignore other message types (system, stream_event, etc.)
        return null;
    }
  }
}

/**
 * Create a mock SDK adapter for testing
 */
export function createMockSDKAdapter(): ISDKAdapter & {
  mockStartQuery: ReturnType<typeof import('vitest').vi.fn>;
  mockExtractUsage: ReturnType<typeof import('vitest').vi.fn>;
  mockMapToAgentEvent: ReturnType<typeof import('vitest').vi.fn>;
} {
  const vi = require('vitest').vi;

  const mockQuery: Partial<ActiveQuery> = {
    query: {} as Query,
    sessionId: 'mock-session-id',
    isRunning: true,
    abortController: new AbortController(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };

  const mockStartQuery = vi.fn().mockResolvedValue(mockQuery);
  const mockExtractUsage = vi.fn().mockReturnValue({
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0.01,
  });
  const mockMapToAgentEvent = vi.fn().mockReturnValue(null);

  return {
    startQuery: mockStartQuery,
    extractUsage: mockExtractUsage,
    mapToAgentEvent: mockMapToAgentEvent,
    mockStartQuery,
    mockExtractUsage,
    mockMapToAgentEvent,
  };
}

/**
 * Singleton instance of the SDK adapter.
 * Uses a wrapper to enable thread-safe lazy initialization with reset capability.
 * The initialization is atomic - once set, concurrent callers all get the same instance.
 */
let currentAdapter: SDKAdapter | null = null;
const adapterLock = { initializing: false };

/**
 * Get the default SDK adapter instance.
 * Thread-safe: uses synchronous initialization to avoid race conditions.
 */
export function getSDKAdapter(): SDKAdapter {
  if (currentAdapter === null) {
    // Synchronous initialization - no race condition in single-threaded Node.js event loop
    // The check + assignment is atomic within a single synchronous block
    currentAdapter = new SDKAdapter();
  }
  return currentAdapter;
}

/**
 * Reset the default adapter (for testing).
 * Replaces the singleton with a fresh instance.
 */
export function resetSDKAdapter(): void {
  currentAdapter = new SDKAdapter();
}
