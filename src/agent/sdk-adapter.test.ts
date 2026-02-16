import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SDKAdapter,
  MODEL_MAP,
  FALLBACK_PRICING,
  calculateCostFromTokens,
  getSDKAdapter,
  resetSDKAdapter,
  type TokenUsage,
  type SDKAdapterConfig,
  type ActiveQuery,
} from './sdk-adapter.js';
import type {
  SDKMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKAssistantMessage,
  Query,
} from '@anthropic-ai/claude-agent-sdk';

describe('SDKAdapter', () => {
  beforeEach(() => {
    resetSDKAdapter();
  });

  describe('MODEL_MAP', () => {
    it('should map opus to correct model ID', () => {
      expect(MODEL_MAP.opus).toBe('claude-opus-4-20250514');
    });

    it('should map sonnet to correct model ID', () => {
      expect(MODEL_MAP.sonnet).toBe('claude-sonnet-4-5-20250929');
    });

    it('should map haiku to correct model ID', () => {
      expect(MODEL_MAP.haiku).toBe('claude-3-5-haiku-20241022');
    });
  });

  describe('extractUsage', () => {
    it('should extract token usage from successful result', () => {
      const adapter = new SDKAdapter();

      const result: SDKResultSuccess = {
        type: 'result',
        subtype: 'success',
        duration_ms: 5000,
        duration_api_ms: 4500,
        is_error: false,
        num_turns: 3,
        result: 'Task completed',
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
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
      const adapter = new SDKAdapter();

      const result: SDKResultSuccess = {
        type: 'result',
        subtype: 'success',
        duration_ms: 1000,
        duration_api_ms: 900,
        is_error: false,
        num_turns: 1,
        result: 'Done',
        total_cost_usd: 0,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
      };

      const usage = adapter.extractUsage(result);

      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
    });

    it('should calculate costUSD from tokens when model is provided', () => {
      const adapter = new SDKAdapter();

      const result: SDKResultSuccess = {
        type: 'result',
        subtype: 'success',
        duration_ms: 5000,
        duration_api_ms: 4500,
        is_error: false,
        num_turns: 3,
        result: 'Task completed',
        total_cost_usd: 0,
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 100_000,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
      };

      // Opus: (1M/1M)*15 + (100K/1M)*75 = 15 + 7.5 = 22.5
      const usage = adapter.extractUsage(result, 'opus');
      expect(usage.costUSD).toBe(22.5);
    });

    it('should calculate costUSD for sonnet model', () => {
      const adapter = new SDKAdapter();

      const result: SDKResultSuccess = {
        type: 'result',
        subtype: 'success',
        duration_ms: 3000,
        duration_api_ms: 2500,
        is_error: false,
        num_turns: 2,
        result: 'Done',
        total_cost_usd: 0,
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 100_000,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
      };

      // Sonnet: (1M/1M)*3 + (100K/1M)*15 = 3 + 1.5 = 4.5
      const usage = adapter.extractUsage(result, 'sonnet');
      expect(usage.costUSD).toBe(4.5);
    });

    it('should resolve model from session tracking when not passed directly', async () => {
      const mockQuery = {
        [Symbol.asyncIterator]: async function* () {},
        streamInput: vi.fn(),
        close: vi.fn(),
      } as unknown as Query;

      const queryFn = vi.fn().mockReturnValue(mockQuery);
      const adapter = new SDKAdapter(queryFn);

      // Start a query which registers the model for the session
      await adapter.startQuery('tracked-session', 'Test', {
        cwd: '/test',
        model: 'opus',
      });

      const result: SDKResultSuccess = {
        type: 'result',
        subtype: 'success',
        duration_ms: 5000,
        duration_api_ms: 4500,
        is_error: false,
        num_turns: 3,
        result: 'Done',
        total_cost_usd: 0,
        usage: {
          input_tokens: 100_000,
          output_tokens: 10_000,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'tracked-session',
      };

      // Should auto-resolve opus model from session tracking
      // Opus: (100K/1M)*15 + (10K/1M)*75 = 1.5 + 0.75 = 2.25
      const usage = adapter.extractUsage(result);
      expect(usage.costUSD).toBe(2.25);
    });

    it('should return zero cost for zero tokens even with model', () => {
      const adapter = new SDKAdapter();

      const result: SDKResultSuccess = {
        type: 'result',
        subtype: 'success',
        duration_ms: 1000,
        duration_api_ms: 900,
        is_error: false,
        num_turns: 1,
        result: 'Done',
        total_cost_usd: 0,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
      };

      const usage = adapter.extractUsage(result, 'opus');
      expect(usage.costUSD).toBe(0);
    });

    it('should fall back to SDK total_cost_usd when model is unknown', () => {
      const adapter = new SDKAdapter();

      const result: SDKResultSuccess = {
        type: 'result',
        subtype: 'success',
        duration_ms: 1000,
        duration_api_ms: 900,
        is_error: false,
        num_turns: 1,
        result: 'Done',
        total_cost_usd: 0.42,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
      };

      // No model provided and no session tracking — falls back to SDK value
      const usage = adapter.extractUsage(result);
      expect(usage.costUSD).toBe(0.42);
    });
  });

  describe('calculateCostFromTokens', () => {
    it('should calculate opus cost correctly', () => {
      // (1M/1M)*15 + (1M/1M)*75 = 15 + 75 = 90
      expect(calculateCostFromTokens('opus', 1_000_000, 1_000_000)).toBe(90);
    });

    it('should calculate sonnet cost correctly', () => {
      // (1M/1M)*3 + (1M/1M)*15 = 3 + 15 = 18
      expect(calculateCostFromTokens('sonnet', 1_000_000, 1_000_000)).toBe(18);
    });

    it('should calculate haiku cost correctly', () => {
      // (1M/1M)*0.80 + (1M/1M)*4 = 0.80 + 4 = 4.80
      expect(calculateCostFromTokens('haiku', 1_000_000, 1_000_000)).toBe(4.80);
    });

    it('should return 0 for unknown model', () => {
      expect(calculateCostFromTokens('unknown-model', 1_000_000, 1_000_000)).toBe(0);
    });

    it('should return 0 for zero tokens', () => {
      expect(calculateCostFromTokens('opus', 0, 0)).toBe(0);
    });

    it('should handle realistic token counts', () => {
      // Typical session: 50K input, 10K output on opus
      // (50K/1M)*15 + (10K/1M)*75 = 0.75 + 0.75 = 1.50
      expect(calculateCostFromTokens('opus', 50_000, 10_000)).toBe(1.5);
    });
  });

  describe('mapToAgentEvent', () => {
    it('should map assistant message with tool use to tool_call event', () => {
      const adapter = new SDKAdapter();

      const message: SDKAssistantMessage = {
        type: 'assistant',
        message: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5-20250929',
          content: [
            {
              type: 'tool_use',
              id: 'tool-use-123',
              name: 'Bash',
              input: { command: 'ls -la' },
            },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
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
      const adapter = new SDKAdapter();

      const message: SDKAssistantMessage = {
        type: 'assistant',
        message: {
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5-20250929',
          content: [
            {
              type: 'tool_use',
              id: 'tool-use-456',
              name: 'AskUserQuestion',
              input: { questions: [{ question: 'Which approach?', header: 'Approach' }] },
            },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).not.toBeNull();
      expect(event?.type).toBe('question');
      expect(event?.data).toHaveProperty('toolUseId', 'tool-use-456');
      expect(event?.data).toHaveProperty('question');
    });

    it('should map successful result to completion event', () => {
      const adapter = new SDKAdapter();

      const message: SDKResultSuccess = {
        type: 'result',
        subtype: 'success',
        duration_ms: 5000,
        duration_api_ms: 4500,
        is_error: false,
        num_turns: 3,
        result: 'Task completed successfully',
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).not.toBeNull();
      expect(event?.type).toBe('completion');
      expect(event?.sessionId).toBe('session-123');
      expect((event?.data as { success: boolean }).success).toBe(true);
      expect((event?.data as { result: string }).result).toBe('Task completed successfully');
    });

    it('should map error result to error event', () => {
      const adapter = new SDKAdapter();

      const message: SDKResultError = {
        type: 'result',
        subtype: 'error_during_execution',
        duration_ms: 1000,
        duration_api_ms: 900,
        is_error: true,
        num_turns: 1,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        errors: ['Something went wrong'],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).not.toBeNull();
      expect(event?.type).toBe('error');
      expect((event?.data as { success: boolean }).success).toBe(false);
      expect((event?.data as { errors: string[] }).errors).toContain('Something went wrong');
    });

    it('should map tool_progress to tool_call event with progress flag', () => {
      const adapter = new SDKAdapter();

      const message: SDKMessage = {
        type: 'tool_progress',
        tool_use_id: 'tool-123',
        tool_name: 'Bash',
        parent_tool_use_id: null,
        elapsed_time_seconds: 5,
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).not.toBeNull();
      expect(event?.type).toBe('tool_call');
      expect((event?.data as { isProgress: boolean }).isProgress).toBe(true);
      expect((event?.data as { elapsedSeconds: number }).elapsedSeconds).toBe(5);
    });

    it('should return null for system messages', () => {
      const adapter = new SDKAdapter();

      const message: SDKMessage = {
        type: 'system',
        subtype: 'init',
        claude_code_version: '1.0.0',
        cwd: '/test',
        tools: ['Bash', 'Read'],
        mcp_servers: [],
        model: 'claude-sonnet-4-5-20250929',
        permissionMode: 'default',
        slash_commands: [],
        output_style: 'default',
        skills: [],
        plugins: [],
        uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
        session_id: 'test-session',
        apiKeySource: 'user',
      };

      const event = adapter.mapToAgentEvent(message, 'session-123');

      expect(event).toBeNull();
    });
  });

  describe('startQuery', () => {
    it('should start a query with correct configuration', async () => {
      // Create a mock query function
      const mockQuery = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
          } as SDKMessage;
        },
        streamInput: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
        setModel: vi.fn(),
        setMaxThinkingTokens: vi.fn(),
        supportedCommands: vi.fn(),
        supportedModels: vi.fn(),
        mcpServerStatus: vi.fn(),
        accountInfo: vi.fn(),
        rewindFiles: vi.fn(),
        setMcpServers: vi.fn(),
      } as unknown as Query;

      const queryFn = vi.fn().mockReturnValue(mockQuery);
      const adapter = new SDKAdapter(queryFn);

      const config: SDKAdapterConfig = {
        cwd: '/test/path',
        model: 'sonnet',
        systemPrompt: 'You are a helpful assistant',
        maxTurns: 10,
      };

      const onMessage = vi.fn();
      const activeQuery = await adapter.startQuery('session-123', 'Do something', config, onMessage);

      // Verify query was called with correct options
      expect(queryFn).toHaveBeenCalledWith({
        prompt: 'Do something',
        options: expect.objectContaining({
          cwd: '/test/path',
          model: 'claude-sonnet-4-5-20250929',
          maxTurns: 10,
          permissionMode: 'bypassPermissions',
          persistSession: false,
        }),
      });

      expect(activeQuery.sessionId).toBe('session-123');
      expect(activeQuery.query).toBe(mockQuery);

      // Clean up
      activeQuery.close();
    });

    it('should handle system prompt configuration', async () => {
      const mockQuery = {
        [Symbol.asyncIterator]: async function* () {},
        streamInput: vi.fn(),
        close: vi.fn(),
      } as unknown as Query;

      const queryFn = vi.fn().mockReturnValue(mockQuery);
      const adapter = new SDKAdapter(queryFn);

      // With system prompt
      await adapter.startQuery('session-1', 'Test', {
        cwd: '/test',
        model: 'opus',
        systemPrompt: 'Custom prompt',
      });

      expect(queryFn).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              append: 'Custom prompt',
            },
          }),
        })
      );

      // Without system prompt
      await adapter.startQuery('session-2', 'Test', {
        cwd: '/test',
        model: 'haiku',
      });

      expect(queryFn).toHaveBeenLastCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
            },
          }),
        })
      );
    });
  });

  describe('singleton management', () => {
    it('should return same instance from getSDKAdapter', () => {
      const adapter1 = getSDKAdapter();
      const adapter2 = getSDKAdapter();

      expect(adapter1).toBe(adapter2);
    });

    it('should create new instance after resetSDKAdapter', () => {
      const adapter1 = getSDKAdapter();
      resetSDKAdapter();
      const adapter2 = getSDKAdapter();

      expect(adapter1).not.toBe(adapter2);
    });
  });
});
