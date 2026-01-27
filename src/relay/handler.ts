/**
 * Relay Handler for Slack Claude Relay
 *
 * Core module that:
 * - Spawns Claude CLI processes with appropriate flags
 * - Parses streaming JSON output
 * - Extracts session IDs for conversation continuity
 * - Posts progress updates to Slack
 * - Handles errors gracefully
 */

import { spawn, ChildProcess } from 'node:child_process';
import { logger } from '../logging/index.js';

const log = logger.child('Relay.Handler');

/**
 * Relay configuration interface (subset of RelayConfig from config.ts)
 * This is defined here to allow handler.ts to be used independently.
 */
export interface RelayHandlerConfig {
  /** Path to the Claude CLI executable (default: 'claude') */
  cliPath: string;
  /** Timeout for Claude CLI operations in milliseconds */
  timeoutMs: number;
  /** Model to use: 'sonnet' or 'opus' */
  model: 'sonnet' | 'opus';
}

/**
 * Context for a relay request
 */
export interface RelayContext {
  /** Slack channel ID (also accepts 'channelId' for backward compatibility) */
  channel?: string;
  /** Slack channel ID (alternate name) */
  channelId?: string;
  /** Thread timestamp for replies */
  threadTs: string;
  /** Working directory for the Claude CLI */
  projectPath: string;
  /** Existing session ID for --resume (also accepts 'existingSessionId') */
  sessionId?: string;
  /** Existing session ID for --resume (alternate name) */
  existingSessionId?: string;
  /** Callback for progress updates - accepts either string or ProgressUpdate */
  onProgress?: ((progressText: string) => Promise<void>) | ProgressCallback;
}

/**
 * Result from a relay operation
 */
export interface RelayResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** The response text from Claude */
  response: string;
  /** Session ID for future --resume calls */
  sessionId: string | null;
  /** Error message if failed */
  error?: string;
  /** Duration of the operation in milliseconds */
  durationMs: number;
}

/**
 * Progress update for Slack
 */
export interface ProgressUpdate {
  /** Type of progress (tool use, thinking, etc.) */
  type: 'tool_use' | 'thinking' | 'result';
  /** Human-readable message */
  message: string;
  /** Tool name if applicable */
  toolName?: string;
  /** File path if applicable */
  filePath?: string;
}

/**
 * Callback for posting progress updates
 */
export type ProgressCallback = (update: ProgressUpdate) => Promise<void>;

/**
 * Configuration for the relay function
 */
export interface RelayOptions {
  /** Path to claude CLI executable (default: 'claude') */
  cliPath?: string;
  /** Timeout in milliseconds (default: 600000 = 10 min) */
  timeoutMs?: number;
  /** Model to use (default: 'sonnet') */
  model?: 'sonnet' | 'opus';
  /** Minimum interval between progress updates in ms (default: 3000) */
  progressIntervalMs?: number;
}

/**
 * CLI streaming JSON message types
 */
export interface CLIStreamMessage {
  type: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: ContentBlock[];
  };
  tool_use_id?: string;
  tool_name?: string;
  result?: string;
  error?: string;
  errors?: string[];
  session_id?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

/**
 * Content block in assistant messages
 */
interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Error types for better error handling
 */
export enum RelayErrorType {
  CLI_NOT_FOUND = 'CLI_NOT_FOUND',
  AUTH_NEEDED = 'AUTH_NEEDED',
  TIMEOUT = 'TIMEOUT',
  RESUME_FAILED = 'RESUME_FAILED',
  UNKNOWN = 'UNKNOWN',
}

/**
 * User-facing error messages
 */
const ERROR_MESSAGES: Record<RelayErrorType, string> = {
  [RelayErrorType.CLI_NOT_FOUND]: 'Claude CLI not found. Is it installed and in PATH?',
  [RelayErrorType.AUTH_NEEDED]: 'Claude CLI needs authentication. Run `claude` on your desktop to log in.',
  [RelayErrorType.TIMEOUT]: 'Request timed out. Try breaking it into smaller tasks.',
  [RelayErrorType.RESUME_FAILED]: 'Starting fresh (previous session unavailable)',
  [RelayErrorType.UNKNOWN]: 'Something went wrong',
};

/**
 * Default configuration values
 */
const DEFAULTS: Required<RelayOptions> = {
  cliPath: process.env.RELAY_CLI_PATH ?? 'claude',
  timeoutMs: parseInt(process.env.RELAY_TIMEOUT_MS ?? '600000', 10),
  model: (process.env.RELAY_MODEL as 'sonnet' | 'opus') ?? 'sonnet',
  progressIntervalMs: 3000,
};

/**
 * Classify an error into a known type
 */
function classifyError(error: Error | string, stderr: string): RelayErrorType {
  const errorStr = typeof error === 'string' ? error : error.message;
  const combined = `${errorStr} ${stderr}`.toLowerCase();

  if (combined.includes('enoent') || combined.includes('not found') || combined.includes('not recognized')) {
    return RelayErrorType.CLI_NOT_FOUND;
  }

  if (combined.includes('auth') || combined.includes('login') || combined.includes('authenticate')) {
    return RelayErrorType.AUTH_NEEDED;
  }

  if (combined.includes('timeout') || combined.includes('timed out')) {
    return RelayErrorType.TIMEOUT;
  }

  if (combined.includes('session') && (combined.includes('invalid') || combined.includes('not found'))) {
    return RelayErrorType.RESUME_FAILED;
  }

  return RelayErrorType.UNKNOWN;
}

/**
 * Parse a line of streaming JSON output
 */
function parseStreamLine(line: string): CLIStreamMessage | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as CLIStreamMessage;
  } catch {
    log.debug('Failed to parse CLI output line', { line: trimmed.substring(0, 100) });
    return null;
  }
}

/**
 * Extract filename from a path
 */
function extractFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Create a progress update for a tool use
 */
function createToolProgressUpdate(
  toolName: string,
  input?: Record<string, unknown>
): ProgressUpdate {
  const filePath = input?.file_path as string | undefined
    ?? input?.path as string | undefined
    ?? input?.filename as string | undefined;

  let displayMessage: string;

  switch (toolName) {
    case 'Read':
      displayMessage = filePath ? `Reading ${extractFileName(filePath)}...` : 'Reading file...';
      break;
    case 'Edit':
      displayMessage = filePath ? `Editing ${extractFileName(filePath)}...` : 'Editing file...';
      break;
    case 'Write':
      displayMessage = filePath ? `Creating ${extractFileName(filePath)}...` : 'Creating file...';
      break;
    case 'Bash':
      displayMessage = 'Running command...';
      break;
    case 'Glob':
      displayMessage = 'Searching files...';
      break;
    case 'Grep':
      displayMessage = 'Searching content...';
      break;
    case 'WebFetch':
      displayMessage = 'Fetching web content...';
      break;
    case 'WebSearch':
      displayMessage = 'Searching the web...';
      break;
    default:
      displayMessage = `Using ${toolName}...`;
  }

  return {
    type: 'tool_use',
    message: displayMessage,
    toolName,
    filePath,
  };
}

/**
 * Get progress update from a CLI stream message
 */
function getProgressUpdate(message: CLIStreamMessage): ProgressUpdate | null {
  // Handle tool_use from assistant message
  if (message.type === 'assistant' && message.message?.content) {
    for (const block of message.message.content) {
      if (block.type === 'tool_use' && block.name) {
        return createToolProgressUpdate(block.name, block.input);
      }
    }
  }

  // Handle standalone tool_use message type
  if (message.type === 'tool_use' && message.tool_name) {
    return createToolProgressUpdate(message.tool_name, message as Record<string, unknown>);
  }

  return null;
}

/**
 * Extract text response from result message
 */
function extractResultText(message: CLIStreamMessage): string {
  // The 'result' field often contains the final text
  if (message.result && typeof message.result === 'string') {
    return message.result;
  }

  // Sometimes the response is in message.content
  if (message.message?.content) {
    const textBlocks = message.message.content
      .filter((block): block is ContentBlock & { text: string } =>
        block.type === 'text' && typeof block.text === 'string'
      )
      .map(block => block.text);

    if (textBlocks.length > 0) {
      return textBlocks.join('\n');
    }
  }

  return '';
}

/**
 * Split a long response into chunks that fit Slack's character limit.
 * Splits at paragraph boundaries when possible.
 *
 * @param text - Text to chunk
 * @param maxLength - Maximum characters per chunk (default 3800 to leave room for formatting)
 * @returns Array of text chunks
 */
export function chunkResponse(text: string, maxLength: number = 3800): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);

    // If no paragraph break, try single newline
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }

    // If no newline, try space
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }

    // Last resort: hard split
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks;
}

/**
 * Escape a string for use as a shell argument.
 * On Windows with shell: true, we need to wrap in double quotes
 * and escape any internal double quotes.
 */
function escapeShellArg(arg: string): string {
  // Escape backslashes that precede double quotes, and double quotes themselves
  // For Windows cmd.exe, we escape " as ""
  const escaped = arg.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Build CLI arguments for the relay request.
 */
function buildCLIArgs(
  message: string,
  options: Required<RelayOptions>,
  sessionId?: string
): string[] {
  const args: string[] = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',  // Required when using --print with stream-json
    '--dangerously-skip-permissions',
  ];

  // Add model if specified and not default
  if (options.model && options.model !== 'sonnet') {
    args.push('--model', options.model);
  }

  // Add resume flag if continuing conversation
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  // The message goes last - must be quoted for shell: true to prevent
  // shell interpretation of special characters (?, *, etc.)
  args.push(escapeShellArg(message));

  return args;
}

/**
 * Normalize RelayContext to handle both naming conventions
 */
function normalizeContext(context: RelayContext): {
  channelId: string;
  threadTs: string;
  projectPath: string;
  sessionId?: string;
  onProgress?: ((progressText: string) => Promise<void>) | ProgressCallback;
} {
  return {
    channelId: context.channelId ?? context.channel ?? 'unknown',
    threadTs: context.threadTs,
    projectPath: context.projectPath,
    sessionId: context.sessionId ?? context.existingSessionId,
    onProgress: context.onProgress,
  };
}

/**
 * Main relay function.
 * Spawns Claude CLI, streams output, and returns result.
 *
 * @param message - The user's message to send to Claude
 * @param context - Context including channel, thread, project path, and optional session ID
 * @param options - Optional configuration (CLI path, timeout, model)
 * @param onProgress - Optional callback for progress updates (deprecated, use context.onProgress)
 * @returns Result containing success status, response, session ID, and duration
 */
export async function relay(
  message: string,
  context: RelayContext,
  options: RelayOptions = {},
  onProgress?: ProgressCallback
): Promise<RelayResult> {
  const fullOptions: Required<RelayOptions> = { ...DEFAULTS, ...options };
  const startTime = Date.now();

  // Normalize context for both naming conventions
  const normalizedContext = normalizeContext(context);

  // Use progress callback from context if available, otherwise use parameter
  const progressCallback = normalizedContext.onProgress ?? onProgress;

  const args = buildCLIArgs(message, fullOptions, normalizedContext.sessionId);

  log.info('Starting relay', {
    channelId: normalizedContext.channelId,
    threadTs: normalizedContext.threadTs,
    projectPath: normalizedContext.projectPath,
    hasExistingSession: !!normalizedContext.sessionId,
    messageLength: message.length,
    cliPath: fullOptions.cliPath,
    args: args.join(' '),
    fullCommand: `${fullOptions.cliPath} ${args.join(' ')}`,
  });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let sessionId: string | null = null;
    let resultText = '';
    let lastProgressTime = 0;
    let isTimedOut = false;

    // Spawn the CLI process
    log.debug('Spawning CLI process', { cliPath: fullOptions.cliPath, cwd: normalizedContext.projectPath });
    // Build environment for child process
    // IMPORTANT: Exclude ANTHROPIC_API_KEY so Claude CLI uses Max subscription
    // instead of API billing. Also exclude CI to prevent billing mode switch.
    const childEnv = { ...process.env };
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.CI;

    const proc: ChildProcess = spawn(fullOptions.cliPath, args, {
      cwd: normalizedContext.projectPath,
      env: childEnv,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'], // Explicitly set stdio to capture output
    });

    log.info('CLI process spawned', { pid: proc.pid, hasStdout: !!proc.stdout, hasStderr: !!proc.stderr });

    // Close stdin to signal no more input - required for CLI to proceed
    proc.stdin?.end();

    // Log when process exits (might fire before 'close')
    proc.on('exit', (code, signal) => {
      log.info('CLI process exited', { code, signal });
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      log.warn('Relay timed out', {
        channelId: normalizedContext.channelId,
        threadTs: normalizedContext.threadTs,
        durationMs: Date.now() - startTime,
      });
      proc.kill('SIGTERM');
    }, fullOptions.timeoutMs);

    // Buffer for incomplete lines
    let lineBuffer = '';

    // Handle stdout streaming
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      log.debug('CLI stdout', { length: text.length, preview: text.substring(0, 200) });
      stdout += text;
      lineBuffer += text;

      // Process complete lines
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const parsed = parseStreamLine(line);
        if (!parsed) continue;

        // Extract session ID from result
        if (parsed.type === 'result' && parsed.session_id) {
          sessionId = parsed.session_id;
        }

        // Extract result text
        if (parsed.type === 'result') {
          const text = extractResultText(parsed);
          if (text) {
            resultText = text;
          }
        }

        // Send progress updates (rate limited)
        if (progressCallback) {
          const now = Date.now();
          if (now - lastProgressTime >= fullOptions.progressIntervalMs) {
            const progressUpdate = getProgressUpdate(parsed);
            if (progressUpdate) {
              lastProgressTime = now;
              // Fire and forget - don't await
              // The callback may expect a string or ProgressUpdate - send the message string
              // which works for both (bot.ts expects string, standalone API can use either)
              (progressCallback as (arg: string) => Promise<void>)(progressUpdate.message).catch((err) => {
                log.debug('Failed to send progress update', { error: err instanceof Error ? err.message : String(err) });
              });
            }
          }
        }
      }
    });

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      log.warn('CLI stderr', { text: text.substring(0, 500) });
      stderr += text;
    });

    // Handle process errors (e.g., CLI not found)
    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;
      const errorType = classifyError(err, stderr);

      log.error('Relay process error', err, {
        channelId: normalizedContext.channelId,
        errorType,
        durationMs,
      });

      resolve({
        success: false,
        response: '',
        sessionId: null,
        error: `${ERROR_MESSAGES[errorType]}: ${err.message}`,
        durationMs,
      });
    });

    // Handle process completion
    proc.on('close', (code, signal) => {
      log.info('CLI process closed', { code, signal, stdoutLength: stdout.length, stderrLength: stderr.length });
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      // Process any remaining buffer
      if (lineBuffer.trim()) {
        const parsed = parseStreamLine(lineBuffer);
        if (parsed) {
          if (parsed.session_id) {
            sessionId = parsed.session_id;
          }
          if (parsed.type === 'result') {
            const text = extractResultText(parsed);
            if (text) {
              resultText = text;
            }
          }
        }
      }

      // Handle timeout
      if (isTimedOut) {
        resolve({
          success: false,
          response: resultText || '',
          sessionId,
          error: ERROR_MESSAGES[RelayErrorType.TIMEOUT],
          durationMs,
        });
        return;
      }

      // Handle non-zero exit code
      if (code !== 0) {
        const errorType = classifyError(`Exit code ${code}`, stderr);
        log.warn('Relay process exited with error', {
          code,
          errorType,
          stderr: stderr.substring(0, 500),
          channelId: normalizedContext.channelId,
          durationMs,
        });

        resolve({
          success: false,
          response: resultText || '',
          sessionId,
          error: `${ERROR_MESSAGES[errorType]}${stderr ? `: ${stderr.substring(0, 200)}` : ''}`,
          durationMs,
        });
        return;
      }

      // Success
      log.info('Relay completed successfully', {
        channelId: normalizedContext.channelId,
        hasSessionId: !!sessionId,
        responseLength: resultText.length,
        durationMs,
      });

      resolve({
        success: true,
        response: resultText,
        sessionId,
        durationMs,
      });
    });
  });
}

/**
 * Relay Handler class.
 * Alternative class-based interface for the relay functionality.
 */
export class RelayHandler {
  private options: Required<RelayOptions>;

  /**
   * Create a new RelayHandler.
   *
   * @param config - Relay configuration
   */
  constructor(config: RelayHandlerConfig) {
    this.options = {
      cliPath: config.cliPath,
      timeoutMs: config.timeoutMs,
      model: config.model,
      progressIntervalMs: DEFAULTS.progressIntervalMs,
    };
  }

  /**
   * Relay a message to Claude CLI.
   *
   * @param message - The user's message to send to Claude
   * @param context - Context including channel, thread, project path, and optional session ID
   * @param onProgress - Optional callback for progress updates
   * @returns Result containing success status, response, session ID, and duration
   */
  async relay(
    message: string,
    context: RelayContext,
    onProgress?: ProgressCallback
  ): Promise<RelayResult> {
    return relay(message, context, this.options, onProgress);
  }
}

export default {
  relay,
  chunkResponse,
  RelayHandler,
  RelayErrorType,
  ERROR_MESSAGES,
};
