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
import { logger } from '../logging/index.js';

const log = logger.child('SDKAdapter');

// Re-export SDK types we need
export type { Query, Options, SDKMessage, SDKResultMessage };

/**
 * Model name mapping from our simplified names to SDK model identifiers
 */
export const MODEL_MAP: Record<AgentConfig['model'], string> = {
  opus: 'claude-opus-4-20250514',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-3-5-haiku-20241022',
};

/**
 * Fallback pricing per million tokens (used when CostTracker/DB is unavailable).
 * These are hardcoded as a safety net — a slightly stale price is better than $0.
 */
export const FALLBACK_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  opus: { inputPerMillion: 15, outputPerMillion: 75 },
  sonnet: { inputPerMillion: 3, outputPerMillion: 15 },
  haiku: { inputPerMillion: 0.80, outputPerMillion: 4 },
};

/**
 * Calculate cost from token counts using fallback pricing.
 * Returns 0 if the model is unknown.
 */
export function calculateCostFromTokens(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = FALLBACK_PRICING[model];
  if (!pricing) {
    return 0;
  }
  return (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;
}

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
 * Generic message handler type that works with any message format
 */
export type GenericMessageHandler = (message: unknown, sessionId: string) => void;

/**
 * Base interface for agent adapters - allows both SDK and CLI adapters
 * to be used interchangeably by the AgentManager
 */
export interface IAgentAdapter {
  /**
   * Start a new agent query
   */
  startQuery(
    sessionId: string,
    prompt: string,
    config: SDKAdapterConfig,
    onMessage?: GenericMessageHandler
  ): Promise<ActiveQuery>;

  /**
   * Extract token usage from a result message
   */
  extractUsage(result: unknown): TokenUsage;

  /**
   * Map an adapter-specific message to our AgentEvent type
   */
  mapToAgentEvent(message: unknown, sessionId: string): AgentEvent | null;
}

/**
 * Default implementation of the SDK adapter
 */
export class SDKAdapter implements IAgentAdapter {
  private queryFn: typeof import('@anthropic-ai/claude-agent-sdk').query;
  private sessionModels: Map<string, AgentConfig['model']> = new Map();

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

    // Track which model this session uses for cost calculation
    this.sessionModels.set(sessionId, config.model);

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
      permissionMode: config.permissionMode ?? 'bypassPermissions',
      // Required when using bypassPermissions mode
      allowDangerouslySkipPermissions: true,
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
          // Log all messages for debugging
          const subtype = 'subtype' in message ? (message as { subtype?: string }).subtype : undefined;
          log.debug('SDK message received', {
            sessionId,
            messageType: message.type,
            subtype,
          });
          if (onMessage) {
            onMessage(message, sessionId);
          }
        }
        log.debug('Stream ended normally', { sessionId });
      } catch (err) {
        log.error('SDK stream error', err instanceof Error ? err : new Error(String(err)), {
          sessionId,
        });

        // Re-throw to be caught by the outer handler
        throw err;
      } finally {
        isRunning = false;
      }
    };

    // Start processing in the background - attach error handler to prevent unhandled rejection
    const streamPromise = processStream().catch(err => {
      log.error('Agent session failed', err instanceof Error ? err : new Error(String(err)), {
        sessionId,
      });
    });

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
   * Extract token usage information from an SDK result message.
   * Calculates costUSD from token counts using fallback pricing when the SDK
   * does not provide total_cost_usd (which is the common case).
   */
  extractUsage(result: SDKResultMessage, model?: AgentConfig['model']): TokenUsage {
    const usage = result.usage;
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;

    // Look up model from session tracking if not provided directly
    const resolvedModel = model ?? this.sessionModels.get(result.session_id);

    // Calculate cost from tokens using fallback pricing.
    // Only fall back to SDK's total_cost_usd if we can't calculate ourselves.
    const calculatedCost = resolvedModel
      ? calculateCostFromTokens(resolvedModel, inputTokens, outputTokens)
      : 0;
    const costUSD = calculatedCost > 0 ? calculatedCost : (result.total_cost_usd ?? 0);

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      costUSD,
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
        const usage = this.extractUsage(resultMsg);
        // Clean up session model tracking after extracting usage
        this.sessionModels.delete(sessionId);

        if (resultMsg.subtype === 'success') {
          return {
            type: 'completion',
            sessionId,
            data: {
              success: true,
              result: (resultMsg as SDKResultSuccess).result,
              usage,
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
              usage,
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
export function createMockSDKAdapter(): IAgentAdapter & {
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
