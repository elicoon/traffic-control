/**
 * Integration test for SDK adapter.
 * Tests that agents can be spawned and execute tasks.
 *
 * OPT-IN ONLY: Set RUN_INTEGRATION_TESTS=true to run these tests.
 *
 * These tests are opt-in rather than opt-out because:
 * 1. They require a valid ANTHROPIC_API_KEY with credits (costs real money)
 * 2. SDK streaming behavior can change between versions, making assertions fragile
 * 3. They should not run during normal `npm test` to avoid surprise API charges
 *
 * To run: RUN_INTEGRATION_TESTS=true ANTHROPIC_API_KEY=sk-... npm test -- sdk-integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SDKAdapter, MODEL_MAP, SDKAdapterConfig } from './sdk-adapter.js';
import { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// Opt-in: only run when explicitly requested AND an API key is available
const SKIP_INTEGRATION = process.env.RUN_INTEGRATION_TESTS !== 'true' || !process.env.ANTHROPIC_API_KEY;

describe.skipIf(SKIP_INTEGRATION)('SDK Integration', () => {
  let adapter: SDKAdapter;

  beforeAll(() => {
    adapter = new SDKAdapter();
  });

  it('should have correct model mappings', () => {
    expect(MODEL_MAP.opus).toBe('claude-opus-4-20250514');
    expect(MODEL_MAP.sonnet).toBe('claude-sonnet-4-5-20250929');
    expect(MODEL_MAP.haiku).toBe('claude-3-5-haiku-20241022');
  });

  it('should create adapter instance', () => {
    expect(adapter).toBeDefined();
  });

  describe('agent execution', () => {
    it('should spawn and run a simple agent task', async () => {
      const sessionId = `test-${Date.now()}`;
      const messages: SDKMessage[] = [];

      const config: SDKAdapterConfig = {
        cwd: process.cwd(),
        model: 'haiku', // Use cheapest model for testing
        maxTurns: 1,
        permissionMode: 'bypassPermissions',
      };

      const onMessage = (msg: SDKMessage) => {
        messages.push(msg);
      };

      const query = await adapter.startQuery(
        sessionId,
        'What is 2+2? Reply with just the number.',
        config,
        onMessage
      );

      expect(query).toBeDefined();
      expect(query.sessionId).toBe(sessionId);
      expect(query.isRunning).toBe(true);

      // Wait for completion (max 30 seconds)
      const timeout = 30000;
      const startTime = Date.now();

      while (query.isRunning && Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Should have received at least one message
      expect(messages.length).toBeGreaterThan(0);

      // Check for result message
      const resultMessages = messages.filter(m => m.type === 'result');
      expect(resultMessages.length).toBeGreaterThan(0);

      // Clean up
      if (query.isRunning) {
        query.close();
      }
    }, 60000); // 60 second timeout for this test
  });

  describe('extractUsage', () => {
    it('should extract usage from result message', () => {
      const mockResult = {
        type: 'result' as const,
        subtype: 'success' as const,
        result: 'test result',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 25,
          cache_creation_input_tokens: 10,
        },
        total_cost_usd: 0.005,
        num_turns: 1,
        duration_ms: 1000,
        model_usage: {},
      };

      const usage = adapter.extractUsage(mockResult as any);

      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
      expect(usage.cacheReadInputTokens).toBe(25);
      expect(usage.cacheCreationInputTokens).toBe(10);
      expect(usage.costUSD).toBe(0.005);
    });
  });

  describe('mapToAgentEvent', () => {
    it('should map completion result to completion event', () => {
      const mockResult = {
        type: 'result' as const,
        subtype: 'success' as const,
        result: 'Task completed',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
        total_cost_usd: 0.005,
        num_turns: 1,
        duration_ms: 1000,
        model_usage: {},
      };

      const event = adapter.mapToAgentEvent(mockResult as any, 'test-session');

      expect(event).not.toBeNull();
      expect(event!.type).toBe('completion');
      expect(event!.sessionId).toBe('test-session');
      const data = event!.data as { success: boolean; result: string };
      expect(data.success).toBe(true);
      expect(data.result).toBe('Task completed');
    });

    it('should map error result to error event', () => {
      const mockResult = {
        type: 'result' as const,
        subtype: 'error' as const,
        errors: ['Test error'],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
        total_cost_usd: 0.005,
        num_turns: 1,
        duration_ms: 1000,
        model_usage: {},
      };

      const event = adapter.mapToAgentEvent(mockResult as any, 'test-session');

      expect(event).not.toBeNull();
      expect(event!.type).toBe('error');
      expect(event!.sessionId).toBe('test-session');
      const data = event!.data as { success: boolean; errors: string[] };
      expect(data.success).toBe(false);
      expect(data.errors).toContain('Test error');
    });

    it('should return null for system messages', () => {
      const mockMessage = {
        type: 'system' as const,
        data: 'system info',
      };

      const event = adapter.mapToAgentEvent(mockMessage as any, 'test-session');

      expect(event).toBeNull();
    });
  });
});
