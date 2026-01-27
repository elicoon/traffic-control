import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  CLIAdapter,
  CLI_MODEL_MAP,
  getCLIAdapter,
  resetCLIAdapter,
  createBasicMockCLIAdapter,
  type CLIStreamMessage,
  type CLIAdapterConfig,
} from './cli-adapter.js';
import type { SDKAdapterConfig, TokenUsage, IAgentAdapter, ActiveQuery } from './sdk-adapter.js';

// Mock child_process
vi.mock('node:child_process', () => {
  const mockProcess = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn(), end: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };

  return {
    spawn: vi.fn(() => mockProcess),
    ChildProcess: class {},
  };
});

describe('CLIAdapter', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockProcess: {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    on: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    resetCLIAdapter();
    vi.clearAllMocks();

    // Get reference to mocked spawn
    const childProcess = await import('node:child_process');
    mockSpawn = childProcess.spawn as unknown as ReturnType<typeof vi.fn>;

    // Create fresh mock process for each test
    mockProcess = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('CLI_MODEL_MAP', () => {
    it('should map opus to CLI alias', () => {
      expect(CLI_MODEL_MAP.opus).toBe('opus');
    });

    it('should map sonnet to CLI alias', () => {
      expect(CLI_MODEL_MAP.sonnet).toBe('sonnet');
    });

    it('should map haiku to CLI alias', () => {
      expect(CLI_MODEL_MAP.haiku).toBe('haiku');
    });
  });

  describe('extractUsage', () => {
    it('should extract token usage from CLI result', () => {
      const adapter = new CLIAdapter();

      const result: CLIStreamMessage = {
        type: 'result',
        subtype: 'success',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
        },
        total_cost_usd: 0.05,
      };

      const usage = adapter.extractUsage(result);

      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(500);
      expect(usage.totalTokens).toBe(1500);
      expect(usage.cacheReadInputTokens).toBe(200);
      expect(usage.cacheCreationInputTokens).toBe(100);
      expect(usage.costUSD).toBe(0.05);
    });

    it('should handle missing usage values with defaults', () => {
      const adapter = new CLIAdapter();

      const result: CLIStreamMessage = {
        type: 'result',
        subtype: 'success',
      };

      const usage = adapter.extractUsage(result);

      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.cacheReadInputTokens).toBe(0);
      expect(usage.cacheCreationInputTokens).toBe(0);
      expect(usage.costUSD).toBe(0);
    });
  });

  describe('mapToAgentEvent', () => {
    it('should map assistant message with tool use to tool_call event', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-use-123',
              name: 'Bash',
              input: { command: 'ls -la' },
            },
          ],
        },
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).not.toBeNull();
      expect(event?.type).toBe('tool_call');
      expect(event?.sessionId).toBe('session-123');
      expect(event?.data).toEqual({
        toolUseId: 'tool-use-123',
        toolName: 'Bash',
        input: { command: 'ls -la' },
      });
    });

    it('should map AskUserQuestion tool to question event', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-use-456',
              name: 'AskUserQuestion',
              input: { questions: [{ question: 'Which approach?', header: 'Approach' }] },
            },
          ],
        },
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).not.toBeNull();
      expect(event?.type).toBe('question');
      expect(event?.data).toHaveProperty('toolUseId', 'tool-use-456');
      expect(event?.data).toHaveProperty('question');
    });

    it('should map successful result to completion event', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'result',
        subtype: 'success',
        result: 'Task completed successfully',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
        },
        total_cost_usd: 0.05,
        num_turns: 3,
        duration_ms: 5000,
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).not.toBeNull();
      expect(event?.type).toBe('completion');
      expect(event?.sessionId).toBe('session-123');
      expect((event?.data as { success: boolean }).success).toBe(true);
      expect((event?.data as { result: string }).result).toBe('Task completed successfully');
    });

    it('should map error result to error event', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['Something went wrong'],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
        num_turns: 1,
        duration_ms: 1000,
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).not.toBeNull();
      expect(event?.type).toBe('error');
      expect((event?.data as { success: boolean }).success).toBe(false);
      expect((event?.data as { errors: string[] }).errors).toContain('Something went wrong');
    });

    it('should map tool_progress to tool_call event with progress flag', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'tool_progress',
        tool_use_id: 'tool-123',
        tool_name: 'Bash',
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).not.toBeNull();
      expect(event?.type).toBe('tool_call');
      expect((event?.data as { isProgress: boolean }).isProgress).toBe(true);
    });

    it('should return null for system messages', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'system',
        subtype: 'init',
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).toBeNull();
    });

    it('should return null for unknown message types', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'stream_event',
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).toBeNull();
    });
  });

  describe('startQuery', () => {
    it('should spawn CLI process with correct arguments', async () => {
      const adapter = new CLIAdapter();

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'sonnet',
        systemPrompt: 'You are a helpful assistant',
        permissionMode: 'bypassPermissions',
      };

      // Set up mock process event handlers
      let closeHandler: ((code: number) => void) | undefined;
      mockProcess.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          closeHandler = handler as (code: number) => void;
        }
        return mockProcess;
      });

      const onMessage = vi.fn();
      const activeQuery = await adapter.startQuery('session-123', 'Do something', config, onMessage);

      // Verify spawn was called
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--print',
          '--output-format', 'stream-json',
          '--model', 'sonnet',
          '--dangerously-skip-permissions',
          '--append-system-prompt', 'You are a helpful assistant',
          'Do something',
        ]),
        expect.objectContaining({
          cwd: '/test/path',
          shell: true,
        })
      );

      expect(activeQuery.sessionId).toBe('session-123');
      expect(activeQuery.isRunning).toBe(true);

      // Clean up by simulating process close
      if (closeHandler) {
        closeHandler(0);
      }
      activeQuery.close();
    });

    it('should parse streaming JSON output and call onMessage', async () => {
      const adapter = new CLIAdapter();

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'opus',
      };

      // Set up mock process
      let closeHandler: ((code: number) => void) | undefined;
      mockProcess.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          closeHandler = handler as (code: number) => void;
        }
        return mockProcess;
      });

      const onMessage = vi.fn();
      await adapter.startQuery('session-123', 'Test', config, onMessage);

      // Simulate streaming JSON output
      const testMessage = {
        type: 'result',
        subtype: 'success',
        result: 'Done',
      };

      mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(testMessage) + '\n'));

      expect(onMessage).toHaveBeenCalledWith(testMessage, 'session-123');

      // Clean up
      if (closeHandler) {
        closeHandler(0);
      }
    });

    it('should handle multiple JSON messages in single chunk', async () => {
      const adapter = new CLIAdapter();

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'haiku',
      };

      let closeHandler: ((code: number) => void) | undefined;
      mockProcess.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          closeHandler = handler as (code: number) => void;
        }
        return mockProcess;
      });

      const onMessage = vi.fn();
      await adapter.startQuery('session-123', 'Test', config, onMessage);

      // Simulate multiple messages in one chunk
      const messages = [
        { type: 'system', subtype: 'init' },
        { type: 'assistant', message: { role: 'assistant', content: 'Hello' } },
      ];

      mockProcess.stdout.emit(
        'data',
        Buffer.from(messages.map(m => JSON.stringify(m)).join('\n') + '\n')
      );

      expect(onMessage).toHaveBeenCalledTimes(2);

      if (closeHandler) {
        closeHandler(0);
      }
    });

    it('should handle partial JSON across chunks', async () => {
      const adapter = new CLIAdapter();

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'sonnet',
      };

      let closeHandler: ((code: number) => void) | undefined;
      mockProcess.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          closeHandler = handler as (code: number) => void;
        }
        return mockProcess;
      });

      const onMessage = vi.fn();
      await adapter.startQuery('session-123', 'Test', config, onMessage);

      // Simulate message split across chunks
      const fullMessage = { type: 'result', subtype: 'success', result: 'Done' };
      const json = JSON.stringify(fullMessage);
      const midpoint = Math.floor(json.length / 2);

      mockProcess.stdout.emit('data', Buffer.from(json.substring(0, midpoint)));
      expect(onMessage).not.toHaveBeenCalled();

      mockProcess.stdout.emit('data', Buffer.from(json.substring(midpoint) + '\n'));
      expect(onMessage).toHaveBeenCalledWith(fullMessage, 'session-123');

      if (closeHandler) {
        closeHandler(0);
      }
    });

    it('should handle process error events', async () => {
      const adapter = new CLIAdapter();

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'sonnet',
      };

      let errorHandler: ((err: Error) => void) | undefined;
      mockProcess.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'error') {
          errorHandler = handler as (err: Error) => void;
        }
        return mockProcess;
      });

      const queryPromise = adapter.startQuery('session-123', 'Test', config);
      const activeQuery = await queryPromise;

      // Simulate process error - catch the rejection from completionPromise
      if (errorHandler) {
        // The completionPromise will reject, so we need to handle it
        const completionPromise = (activeQuery as any).completionPromise as Promise<void>;
        errorHandler(new Error('Process failed'));

        // Wait for the rejection and catch it
        await expect(completionPromise).rejects.toThrow('Process failed');
      }

      // The query should no longer be running
      expect(activeQuery.isRunning).toBe(false);
    });

    it('should throw error on sendMessage (not supported)', async () => {
      const adapter = new CLIAdapter();

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'sonnet',
      };

      mockProcess.on.mockImplementation(() => mockProcess);

      const activeQuery = await adapter.startQuery('session-123', 'Test', config);

      await expect(activeQuery.sendMessage('Follow up')).rejects.toThrow(
        'CLI adapter does not support interactive message injection'
      );
    });

    it('should close process when close() is called', async () => {
      const adapter = new CLIAdapter();

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'sonnet',
      };

      mockProcess.on.mockImplementation(() => mockProcess);

      const activeQuery = await adapter.startQuery('session-123', 'Test', config);
      activeQuery.close();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should not include permission flag when not bypassPermissions', async () => {
      const adapter = new CLIAdapter();

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'sonnet',
        permissionMode: 'default',
      };

      mockProcess.on.mockImplementation(() => mockProcess);

      await adapter.startQuery('session-123', 'Test', config);

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--dangerously-skip-permissions');
    });

    it('should include allowed tools when specified', async () => {
      const adapter = new CLIAdapter();

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'sonnet',
        allowedTools: ['Bash', 'Read', 'Write'],
      };

      mockProcess.on.mockImplementation(() => mockProcess);

      await adapter.startQuery('session-123', 'Test', config);

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--allowedTools');
      expect(spawnArgs).toContain('Bash');
      expect(spawnArgs).toContain('Read');
      expect(spawnArgs).toContain('Write');
    });
  });

  describe('singleton management', () => {
    it('should return same instance from getCLIAdapter', () => {
      const adapter1 = getCLIAdapter();
      const adapter2 = getCLIAdapter();

      expect(adapter1).toBe(adapter2);
    });

    it('should create new instance after resetCLIAdapter', () => {
      const adapter1 = getCLIAdapter();
      resetCLIAdapter();
      const adapter2 = getCLIAdapter();

      expect(adapter1).not.toBe(adapter2);
    });
  });

  describe('createBasicMockCLIAdapter', () => {
    it('should create a mock adapter with expected interface', () => {
      const mock = createBasicMockCLIAdapter();

      expect(mock.startQuery).toBeDefined();
      expect(mock.extractUsage).toBeDefined();
      expect(mock.mapToAgentEvent).toBeDefined();
      expect(typeof mock.startQuery).toBe('function');
      expect(typeof mock.extractUsage).toBe('function');
      expect(typeof mock.mapToAgentEvent).toBe('function');
    });

    it('should mock startQuery to reject sendMessage', async () => {
      const mock = createBasicMockCLIAdapter();
      const query = await mock.startQuery('session', 'prompt', { cwd: '/test', model: 'sonnet' });

      await expect(query.sendMessage('test')).rejects.toThrow();
    });
  });

  describe('vitest mock adapter pattern', () => {
    it('should work with vitest mocks for full control', async () => {
      const mockQuery: Partial<ActiveQuery> = {
        query: undefined, // CLI doesn't have SDK Query
        sessionId: 'mock-session',
        isRunning: true,
        abortController: new AbortController(),
        sendMessage: vi.fn().mockRejectedValue(new Error('not supported')),
        close: vi.fn(),
      };

      const mockAdapter: IAgentAdapter = {
        startQuery: vi.fn().mockResolvedValue(mockQuery),
        extractUsage: vi.fn().mockReturnValue({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0,
        }),
        mapToAgentEvent: vi.fn().mockReturnValue(null),
      };

      const query = await mockAdapter.startQuery('session', 'prompt', { cwd: '/test', model: 'sonnet' });
      expect(mockAdapter.startQuery).toHaveBeenCalled();
      expect(query.sessionId).toBe('mock-session');
    });
  });
});

describe('CLIAdapter integration scenarios', () => {
  // These tests verify behavior without mocking child_process
  // They test internal logic paths

  describe('error handling edge cases', () => {
    it('should handle error result with missing error message', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'result',
        subtype: 'error_during_execution',
        // No errors or error field
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event?.type).toBe('error');
      expect((event?.data as { errors: string[] }).errors).toContain('Unknown error');
    });

    it('should handle error result with error field instead of errors array', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'result',
        subtype: 'error_during_execution',
        error: 'Single error message',
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event?.type).toBe('error');
      expect((event?.data as { errors: string[] }).errors).toContain('Single error message');
    });

    it('should handle assistant message with non-array content', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'Plain text content',
        },
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      // Should return null since there's no tool_use in the content
      expect(event).toBeNull();
    });

    it('should handle assistant message with empty content array', () => {
      const adapter = new CLIAdapter();

      const message: CLIStreamMessage = {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [],
        },
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).toBeNull();
    });
  });

  describe('constructor options', () => {
    it('should use custom CLI path', () => {
      const adapter = new CLIAdapter({ cliPath: '/custom/path/claude' });
      // The custom path would be used in startQuery - verified through integration
      expect(adapter).toBeDefined();
    });

    it('should use custom timeout', () => {
      const adapter = new CLIAdapter({ timeout: 30000 });
      expect(adapter).toBeDefined();
    });
  });
});
