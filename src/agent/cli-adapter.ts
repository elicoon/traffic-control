/**
 * CLI Adapter for Claude Code CLI
 *
 * An alternative to sdk-adapter.ts that uses the Claude CLI directly
 * for subscription-based usage instead of API credits.
 *
 * Key differences from SDK adapter:
 * - Uses child_process.spawn to run 'claude' CLI
 * - Parses stdout/stderr for responses
 * - Supports streaming via --output-format=stream-json
 * - No direct SDK imports needed
 * - Usage tracking is limited (CLI doesn't report token counts to stdout)
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { AgentConfig, AgentEvent } from './types.js';
import { logger } from '../logging/index.js';
import type {
  IAgentAdapter,
  ActiveQuery,
  SDKAdapterConfig,
  TokenUsage,
} from './sdk-adapter.js';

const log = logger.child('CLIAdapter');

/**
 * Model name mapping for CLI
 * The CLI accepts model aliases like 'opus', 'sonnet' or full names
 */
export const CLI_MODEL_MAP: Record<AgentConfig['model'], string> = {
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
};

/**
 * Message types from --output-format=stream-json
 */
export interface CLIStreamMessage {
  type: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  tool_use_id?: string;
  tool_name?: string;
  result?: string;
  error?: string;
  errors?: string[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  session_id?: string;
  [key: string]: unknown;
}

/**
 * Configuration specific to CLI adapter
 */
export interface CLIAdapterConfig extends SDKAdapterConfig {
  /** Path to claude CLI executable (default: 'claude') */
  cliPath?: string;
  /** Additional CLI arguments */
  additionalArgs?: string[];
  /** Timeout for CLI process in ms (default: 600000 = 10 min) */
  timeout?: number;
}

/**
 * Callback for handling CLI messages
 */
export type CLIMessageHandler = (message: CLIStreamMessage, sessionId: string) => void;

/**
 * Active CLI query wrapper
 */
export interface ActiveCLIQuery extends ActiveQuery {
  /** The underlying child process */
  process: ChildProcess;
  /** Promise that resolves when the process completes */
  completionPromise: Promise<void>;
}

/**
 * CLI Adapter uses the claude CLI instead of the SDK
 * Implements IAgentAdapter for compatibility with AgentManager
 */
export class CLIAdapter implements IAgentAdapter {
  private cliPath: string;
  private defaultTimeout: number;

  constructor(options?: { cliPath?: string; timeout?: number }) {
    this.cliPath = options?.cliPath ?? 'claude';
    this.defaultTimeout = options?.timeout ?? 600000; // 10 minutes default
  }

  /**
   * Build CLI arguments from configuration
   */
  private buildArgs(
    prompt: string,
    config: CLIAdapterConfig
  ): string[] {
    const args: string[] = [];

    // Print mode for non-interactive output
    args.push('--print');

    // Output format for streaming JSON
    args.push('--output-format', 'stream-json');

    // Model selection
    if (config.model) {
      args.push('--model', CLI_MODEL_MAP[config.model]);
    }

    // Permission mode
    if (config.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    }

    // Max turns - CLI doesn't have this flag but we track it internally
    // The CLI has --max-budget-usd but not max-turns

    // System prompt
    if (config.systemPrompt) {
      args.push('--append-system-prompt', config.systemPrompt);
    }

    // Allowed tools
    if (config.allowedTools && config.allowedTools.length > 0) {
      args.push('--allowedTools', ...config.allowedTools);
    }

    // Additional args from config
    if (config.additionalArgs) {
      args.push(...config.additionalArgs);
    }

    // The prompt goes at the end
    args.push(prompt);

    return args;
  }

  /**
   * Parse a line of JSON output from the CLI
   */
  private parseStreamLine(line: string): CLIStreamMessage | null {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) {
      return null;
    }

    try {
      return JSON.parse(trimmed) as CLIStreamMessage;
    } catch (err) {
      log.debug('Failed to parse CLI output line', { line: trimmed.substring(0, 100) });
      return null;
    }
  }

  /**
   * Start a new CLI query
   */
  async startQuery(
    sessionId: string,
    prompt: string,
    config: SDKAdapterConfig,
    onMessage?: CLIMessageHandler
  ): Promise<ActiveQuery> {
    const cliConfig = config as CLIAdapterConfig;
    const args = this.buildArgs(prompt, cliConfig);

    log.info('Starting CLI query', {
      sessionId,
      cwd: config.cwd,
      model: config.model,
      argsCount: args.length,
    });

    const abortController = new AbortController();
    let isRunning = true;
    let outputBuffer = '';
    let stderrBuffer = '';
    let resolveCompletion: () => void;
    let rejectCompletion: (err: Error) => void;

    const completionPromise = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    // Spawn the CLI process
    const process = spawn(this.cliPath, args, {
      cwd: config.cwd,
      env: {
        ...globalThis.process.env,
        // Ensure no interactive prompts
        CI: 'true',
      },
      shell: true,
      // Windows compatibility
      windowsHide: true,
    });

    // Set up timeout
    const timeout = cliConfig.timeout ?? this.defaultTimeout;
    const timeoutId = setTimeout(() => {
      if (isRunning) {
        log.warn('CLI process timed out', { sessionId, timeout });
        process.kill('SIGTERM');
        isRunning = false;
        rejectCompletion(new Error(`CLI process timed out after ${timeout}ms`));
      }
    }, timeout);

    // Handle stdout (streaming JSON)
    process.stdout?.on('data', (data: Buffer) => {
      outputBuffer += data.toString();

      // Process complete lines
      const lines = outputBuffer.split('\n');
      outputBuffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const message = this.parseStreamLine(line);
        if (message && onMessage) {
          onMessage(message, sessionId);
        }
      }
    });

    // Handle stderr
    process.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
      log.debug('CLI stderr', { sessionId, data: data.toString().substring(0, 200) });
    });

    // Handle process completion
    process.on('close', (code) => {
      clearTimeout(timeoutId);
      isRunning = false;

      // Process any remaining output
      if (outputBuffer.trim()) {
        const message = this.parseStreamLine(outputBuffer);
        if (message && onMessage) {
          onMessage(message, sessionId);
        }
      }

      if (code === 0) {
        log.info('CLI process completed successfully', { sessionId, code });
        resolveCompletion();
      } else {
        log.error('CLI process exited with error', new Error(`Exit code: ${code}`), {
          sessionId,
          code,
          stderr: stderrBuffer.substring(0, 500),
        });
        // Still resolve - we emit error events through onMessage
        resolveCompletion();
      }
    });

    process.on('error', (err) => {
      clearTimeout(timeoutId);
      isRunning = false;
      log.error('CLI process error', err, { sessionId });
      rejectCompletion(err);
    });

    // Handle abort signal
    abortController.signal.addEventListener('abort', () => {
      if (isRunning) {
        process.kill('SIGTERM');
        isRunning = false;
      }
    });

    const activeQuery: ActiveCLIQuery = {
      query: null as unknown as any, // CLI doesn't have a Query object
      sessionId,
      get isRunning() {
        return isRunning;
      },
      abortController,
      process,
      completionPromise,
      async sendMessage(message: string) {
        // CLI in print mode doesn't support interactive input
        // For follow-up messages, we'd need to spawn a new process
        // This is a limitation of the CLI approach
        log.warn('sendMessage not fully supported in CLI mode - spawning new query would be needed', {
          sessionId,
        });
        throw new Error(
          'CLI adapter does not support interactive message injection. ' +
          'Consider restarting the query with updated context.'
        );
      },
      close() {
        if (isRunning) {
          process.kill('SIGTERM');
          isRunning = false;
        }
      },
    };

    return activeQuery;
  }

  /**
   * Extract token usage from CLI result
   * Note: CLI may not always report detailed usage
   */
  extractUsage(result: CLIStreamMessage): TokenUsage {
    const usage = result.usage ?? {};
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
   * Map a CLI message to our internal AgentEvent type
   */
  mapToAgentEvent(message: CLIStreamMessage, sessionId: string): AgentEvent | null {
    const timestamp = new Date();

    switch (message.type) {
      case 'assistant': {
        // Check if the message contains tool use
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && block !== null && 'type' in block) {
              const typedBlock = block as { type: string; id?: string; name?: string; input?: unknown };
              if (typedBlock.type === 'tool_use') {
                // Check if it's asking a question
                if (typedBlock.name === 'AskUserQuestion' || typedBlock.name === 'ask') {
                  return {
                    type: 'question',
                    sessionId,
                    data: {
                      toolUseId: typedBlock.id,
                      question: typedBlock.input,
                    },
                    timestamp,
                  };
                }
                // Regular tool call
                return {
                  type: 'tool_call',
                  sessionId,
                  data: {
                    toolUseId: typedBlock.id,
                    toolName: typedBlock.name,
                    input: typedBlock.input,
                  },
                  timestamp,
                };
              }
            }
          }
        }
        return null;
      }

      case 'result': {
        if (message.subtype === 'success') {
          return {
            type: 'completion',
            sessionId,
            data: {
              success: true,
              result: message.result,
              usage: this.extractUsage(message),
              numTurns: message.num_turns ?? 0,
              durationMs: message.duration_ms ?? 0,
            },
            timestamp,
          };
        } else {
          return {
            type: 'error',
            sessionId,
            data: {
              success: false,
              errors: message.errors ?? [message.error ?? 'Unknown error'],
              subtype: message.subtype,
              usage: this.extractUsage(message),
              numTurns: message.num_turns ?? 0,
              durationMs: message.duration_ms ?? 0,
            },
            timestamp,
          };
        }
      }

      case 'tool_progress': {
        return {
          type: 'tool_call',
          sessionId,
          data: {
            toolUseId: message.tool_use_id,
            toolName: message.tool_name,
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
 * Singleton instance management
 */
let currentAdapter: CLIAdapter | null = null;

/**
 * Get the default CLI adapter instance
 */
export function getCLIAdapter(): CLIAdapter {
  if (currentAdapter === null) {
    currentAdapter = new CLIAdapter();
  }
  return currentAdapter;
}

/**
 * Reset the default adapter (for testing)
 */
export function resetCLIAdapter(): void {
  currentAdapter = new CLIAdapter();
}

/**
 * Type for mock CLI adapter - the actual mock should be created in test files
 * using vitest's vi.fn() directly. This type provides the expected structure.
 */
export interface MockCLIAdapter extends IAgentAdapter {
  mockStartQuery: unknown;
  mockExtractUsage: unknown;
  mockMapToAgentEvent: unknown;
}

/**
 * Create a mock CLI adapter for testing.
 * This is a factory function that creates basic mock structure.
 * For full vitest mock support, create the mock directly in your test file.
 *
 * @example
 * // In your test file:
 * import { vi } from 'vitest';
 *
 * const mockQuery = {
 *   query: {},
 *   sessionId: 'mock-session',
 *   isRunning: true,
 *   abortController: new AbortController(),
 *   sendMessage: vi.fn().mockRejectedValue(new Error('not supported')),
 *   close: vi.fn(),
 * };
 *
 * const mockAdapter = {
 *   startQuery: vi.fn().mockResolvedValue(mockQuery),
 *   extractUsage: vi.fn().mockReturnValue({ ... }),
 *   mapToAgentEvent: vi.fn().mockReturnValue(null),
 * };
 */
export function createBasicMockCLIAdapter(): IAgentAdapter {
  const mockQuery: Partial<ActiveQuery> = {
    query: undefined, // CLI adapter doesn't have an SDK Query object
    sessionId: 'mock-session-id',
    isRunning: true,
    abortController: new AbortController(),
    sendMessage: () => Promise.reject(new Error('CLI adapter does not support sendMessage')),
    close: () => {},
  };

  return {
    startQuery: () => Promise.resolve(mockQuery as ActiveQuery),
    extractUsage: () => ({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
    }),
    mapToAgentEvent: () => null,
  };
}
