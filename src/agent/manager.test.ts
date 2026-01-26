import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentManager } from './manager.js';
import type { ISDKAdapter, ActiveQuery, SDKAdapterConfig, TokenUsage } from './sdk-adapter.js';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentEvent } from './types.js';

/**
 * Create a mock SDK adapter for testing
 */
function createMockAdapter(): ISDKAdapter & {
  mockStartQuery: ReturnType<typeof vi.fn>;
  mockActiveQuery: ActiveQuery;
  onMessageCallback?: (message: SDKMessage, sessionId: string) => void;
} {
  const mockActiveQuery: ActiveQuery = {
    query: {} as Query,
    sessionId: 'mock-session',
    isRunning: true,
    abortController: new AbortController(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };

  let onMessageCallback: ((message: SDKMessage, sessionId: string) => void) | undefined;

  const mockStartQuery = vi.fn(
    async (
      sessionId: string,
      prompt: string,
      config: SDKAdapterConfig,
      onMessage?: (message: SDKMessage, sessionId: string) => void
    ): Promise<ActiveQuery> => {
      onMessageCallback = onMessage;
      return {
        ...mockActiveQuery,
        sessionId,
      };
    }
  );

  const mockExtractUsage = vi.fn().mockReturnValue({
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0.01,
  } as TokenUsage);

  const mockMapToAgentEvent = vi.fn().mockReturnValue(null);

  return {
    startQuery: mockStartQuery,
    extractUsage: mockExtractUsage,
    mapToAgentEvent: mockMapToAgentEvent,
    mockStartQuery,
    mockActiveQuery,
    get onMessageCallback() {
      return onMessageCallback;
    },
  };
}

describe('AgentManager', () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
  });

  it('should create an instance', () => {
    const manager = new AgentManager(mockAdapter);
    expect(manager).toBeDefined();
  });

  it('should track active sessions', () => {
    const manager = new AgentManager(mockAdapter);
    expect(manager.getActiveSessions()).toEqual([]);
  });

  it('should register event handlers', () => {
    const manager = new AgentManager(mockAdapter);
    const handler = vi.fn();

    manager.onEvent('question', handler);
    expect(manager.hasHandler('question')).toBe(true);
  });

  it('should spawn an agent and create a session', async () => {
    const manager = new AgentManager(mockAdapter);
    const sessionId = await manager.spawnAgent('task-123', {
      model: 'sonnet',
      projectPath: '/test/path',
    });

    expect(sessionId).toBeDefined();
    const session = manager.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.status).toBe('running');
    expect(session?.taskId).toBe('task-123');
  });

  it('should call SDK adapter startQuery with correct config', async () => {
    const manager = new AgentManager(mockAdapter);

    await manager.spawnAgent('task-456', {
      model: 'opus',
      projectPath: '/project/path',
      systemPrompt: 'Custom instructions',
      maxTurns: 20,
    });

    expect(mockAdapter.mockStartQuery).toHaveBeenCalledWith(
      expect.any(String), // sessionId
      expect.any(String), // prompt
      expect.objectContaining({
        cwd: '/project/path',
        model: 'opus',
        maxTurns: 20,
        permissionMode: 'default',
      }),
      expect.any(Function) // onMessage callback
    );
  });

  it('should return undefined for non-existent session', () => {
    const manager = new AgentManager(mockAdapter);
    expect(manager.getSession('non-existent')).toBeUndefined();
  });

  it('should throw when injecting message to non-existent session', async () => {
    const manager = new AgentManager(mockAdapter);
    await expect(manager.injectMessage('non-existent', 'test')).rejects.toThrow('not found');
  });

  it('should throw when injecting message to running session', async () => {
    const manager = new AgentManager(mockAdapter);
    const sessionId = await manager.spawnAgent('task-123', {
      model: 'sonnet',
      projectPath: '/test/path',
    });

    // Session is running, not blocked
    await expect(manager.injectMessage(sessionId, 'test')).rejects.toThrow(
      'is not in a state that accepts messages'
    );
  });

  it('should terminate a session and set status to failed', async () => {
    const manager = new AgentManager(mockAdapter);
    const sessionId = await manager.spawnAgent('task-123', {
      model: 'sonnet',
      projectPath: '/test/path',
    });

    await manager.terminateSession(sessionId);
    const session = manager.getSession(sessionId);
    expect(session?.status).toBe('failed');
  });

  it('should close the active query when terminating', async () => {
    const manager = new AgentManager(mockAdapter);
    const sessionId = await manager.spawnAgent('task-123', {
      model: 'sonnet',
      projectPath: '/test/path',
    });

    await manager.terminateSession(sessionId);

    // The mock's close should have been called
    expect(mockAdapter.mockActiveQuery.close).toHaveBeenCalled();
  });

  it('should emit completion event when terminating', async () => {
    const manager = new AgentManager(mockAdapter);
    const handler = vi.fn();
    manager.onEvent('completion', handler);

    const sessionId = await manager.spawnAgent('task-123', {
      model: 'sonnet',
      projectPath: '/test/path',
    });

    await manager.terminateSession(sessionId);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'completion',
        sessionId,
        data: { reason: 'terminated' },
      })
    );
  });

  describe('SDK event handling', () => {
    it('should update session status to blocked on question event', async () => {
      mockAdapter.mapToAgentEvent = vi.fn().mockReturnValue({
        type: 'question',
        sessionId: 'test-session',
        data: { question: 'What do you want?' },
        timestamp: new Date(),
      });

      const manager = new AgentManager(mockAdapter);
      const handler = vi.fn();
      manager.onEvent('question', handler);

      const sessionId = await manager.spawnAgent('task-123', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      // Simulate receiving a message from SDK
      if (mockAdapter.onMessageCallback) {
        const mockMessage: SDKMessage = {
          type: 'assistant',
          message: {
            id: 'msg-123',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5-20250929',
            content: [],
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 50 },
          },
          parent_tool_use_id: null,
          uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
          session_id: sessionId,
        };

        // Need to wait for the async handler
        await mockAdapter.onMessageCallback(mockMessage, sessionId);
      }

      // Allow async event handling
      await new Promise(resolve => setTimeout(resolve, 0));

      const session = manager.getSession(sessionId);
      expect(session?.status).toBe('blocked');
      expect(handler).toHaveBeenCalled();
    });

    it('should update session status to complete on completion event', async () => {
      mockAdapter.mapToAgentEvent = vi.fn().mockReturnValue({
        type: 'completion',
        sessionId: 'test-session',
        data: {
          success: true,
          result: 'Done',
          usage: { totalTokens: 500 },
        },
        timestamp: new Date(),
      });

      const manager = new AgentManager(mockAdapter);
      const sessionId = await manager.spawnAgent('task-123', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      if (mockAdapter.onMessageCallback) {
        const mockMessage: SDKMessage = {
          type: 'result',
          subtype: 'success',
          result: 'Done',
          duration_ms: 1000,
          duration_api_ms: 900,
          is_error: false,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: {
            input_tokens: 300,
            output_tokens: 200,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          modelUsage: {},
          permission_denials: [],
          uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
          session_id: sessionId,
        };

        await mockAdapter.onMessageCallback(mockMessage, sessionId);
      }

      await new Promise(resolve => setTimeout(resolve, 0));

      const session = manager.getSession(sessionId);
      expect(session?.status).toBe('complete');
      expect(session?.tokensUsed).toBe(500);
    });

    it('should update session status to failed on error event', async () => {
      mockAdapter.mapToAgentEvent = vi.fn().mockReturnValue({
        type: 'error',
        sessionId: 'test-session',
        data: {
          success: false,
          errors: ['Something went wrong'],
          usage: { totalTokens: 100 },
        },
        timestamp: new Date(),
      });

      const manager = new AgentManager(mockAdapter);
      const handler = vi.fn();
      manager.onEvent('error', handler);

      const sessionId = await manager.spawnAgent('task-123', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      if (mockAdapter.onMessageCallback) {
        const mockMessage: SDKMessage = {
          type: 'result',
          subtype: 'error_during_execution',
          duration_ms: 1000,
          duration_api_ms: 900,
          is_error: true,
          num_turns: 1,
          total_cost_usd: 0.01,
          usage: {
            input_tokens: 50,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          modelUsage: {},
          permission_denials: [],
          errors: ['Something went wrong'],
          uuid: '00000000-0000-0000-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`,
          session_id: sessionId,
        };

        await mockAdapter.onMessageCallback(mockMessage, sessionId);
      }

      await new Promise(resolve => setTimeout(resolve, 0));

      const session = manager.getSession(sessionId);
      expect(session?.status).toBe('failed');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('message injection', () => {
    it('should inject message to blocked session via SDK', async () => {
      // First call returns question event to block, second returns null
      let callCount = 0;
      mockAdapter.mapToAgentEvent = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            type: 'question',
            sessionId: 'test-session',
            data: { question: 'What?' },
            timestamp: new Date(),
          };
        }
        return null;
      });

      const manager = new AgentManager(mockAdapter);
      const sessionId = await manager.spawnAgent('task-123', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      // Simulate question event to block the session
      if (mockAdapter.onMessageCallback) {
        await mockAdapter.onMessageCallback({} as SDKMessage, sessionId);
      }

      await new Promise(resolve => setTimeout(resolve, 0));

      // Now session should be blocked
      expect(manager.getSession(sessionId)?.status).toBe('blocked');

      // Inject a message
      await manager.injectMessage(sessionId, 'User response');

      expect(mockAdapter.mockActiveQuery.sendMessage).toHaveBeenCalledWith('User response');
      expect(manager.getSession(sessionId)?.status).toBe('running');
    });
  });

  describe('utility methods', () => {
    it('should get total tokens used across sessions', async () => {
      // Set up adapter to return completion events with token usage
      let callCount = 0;
      mockAdapter.mapToAgentEvent = vi.fn().mockImplementation(() => {
        callCount++;
        return {
          type: 'completion',
          sessionId: 'test-session',
          data: {
            success: true,
            usage: { totalTokens: callCount * 100 },
          },
          timestamp: new Date(),
        };
      });

      const manager = new AgentManager(mockAdapter);

      // Spawn multiple agents
      const session1 = await manager.spawnAgent('task-1', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      if (mockAdapter.onMessageCallback) {
        await mockAdapter.onMessageCallback({} as SDKMessage, session1);
      }

      const session2 = await manager.spawnAgent('task-2', {
        model: 'opus',
        projectPath: '/test/path',
      });

      if (mockAdapter.onMessageCallback) {
        await mockAdapter.onMessageCallback({} as SDKMessage, session2);
      }

      await new Promise(resolve => setTimeout(resolve, 0));

      // Session 1 got 100 tokens, Session 2 got 200 tokens
      expect(manager.getTotalTokensUsed()).toBe(300);
    });

    it('should get sessions by status', async () => {
      mockAdapter.mapToAgentEvent = vi.fn().mockReturnValue(null);

      const manager = new AgentManager(mockAdapter);

      await manager.spawnAgent('task-1', { model: 'sonnet', projectPath: '/test' });
      await manager.spawnAgent('task-2', { model: 'opus', projectPath: '/test' });

      const runningSessions = manager.getSessionsByStatus('running');
      expect(runningSessions).toHaveLength(2);

      const completedSessions = manager.getSessionsByStatus('complete');
      expect(completedSessions).toHaveLength(0);
    });

    it('should check if session is active', async () => {
      const manager = new AgentManager(mockAdapter);
      const sessionId = await manager.spawnAgent('task-1', {
        model: 'sonnet',
        projectPath: '/test',
      });

      expect(manager.isSessionActive(sessionId)).toBe(true);
      expect(manager.isSessionActive('non-existent')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle SDK start failure gracefully', async () => {
      mockAdapter.startQuery = vi.fn().mockRejectedValue(new Error('SDK initialization failed'));

      const manager = new AgentManager(mockAdapter);
      const errorHandler = vi.fn();
      manager.onEvent('error', errorHandler);

      await expect(
        manager.spawnAgent('task-123', {
          model: 'sonnet',
          projectPath: '/test/path',
        })
      ).rejects.toThrow('SDK initialization failed');

      // Error event should have been emitted
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          data: expect.objectContaining({
            error: 'SDK initialization failed',
            phase: 'initialization',
          }),
        })
      );
    });

    it('should handle message injection failure', async () => {
      // First setup blocked state
      mockAdapter.mapToAgentEvent = vi.fn().mockReturnValue({
        type: 'question',
        sessionId: 'test-session',
        data: { question: 'What?' },
        timestamp: new Date(),
      });

      // Make sendMessage fail
      mockAdapter.mockActiveQuery.sendMessage = vi.fn().mockRejectedValue(new Error('Send failed'));

      const manager = new AgentManager(mockAdapter);
      const sessionId = await manager.spawnAgent('task-123', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      // Block the session
      if (mockAdapter.onMessageCallback) {
        await mockAdapter.onMessageCallback({} as SDKMessage, sessionId);
      }
      await new Promise(resolve => setTimeout(resolve, 0));

      // Try to inject - should fail and revert status
      await expect(manager.injectMessage(sessionId, 'Response')).rejects.toThrow(
        'Failed to inject message'
      );

      // Status should be back to blocked
      expect(manager.getSession(sessionId)?.status).toBe('blocked');
    });
  });

  describe('subagent support', () => {
    it('should spawn a subagent under a parent session', async () => {
      const manager = new AgentManager(mockAdapter);

      // Spawn parent agent
      const parentId = await manager.spawnAgent('parent-task', {
        model: 'opus',
        projectPath: '/test/path',
      });

      // Spawn subagent
      const childSession = await manager.spawnSubagent(parentId, 'child-task', 'Do subtask', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      expect(childSession).toBeDefined();
      expect(childSession.parentSessionId).toBe(parentId);
      expect(childSession.depth).toBe(1);
    });

    it('should throw error when spawning subagent for non-existent parent', async () => {
      const manager = new AgentManager(mockAdapter);

      await expect(
        manager.spawnSubagent('non-existent', 'child-task', 'Do subtask', {
          model: 'sonnet',
          projectPath: '/test/path',
        })
      ).rejects.toThrow('Parent session non-existent not found');
    });

    it('should enforce max depth limit for subagents', async () => {
      const manager = new AgentManager(mockAdapter, { maxSubagentDepth: 2 });

      // Spawn parent (depth 0)
      const parentId = await manager.spawnAgent('parent-task', {
        model: 'opus',
        projectPath: '/test/path',
      });

      // Spawn level 1 (depth 1)
      const level1 = await manager.spawnSubagent(parentId, 'level-1-task', 'Level 1', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      // Spawn level 2 (depth 2)
      const level2 = await manager.spawnSubagent(level1.id, 'level-2-task', 'Level 2', {
        model: 'haiku',
        projectPath: '/test/path',
      });

      // Attempt to spawn level 3 (depth 3) - should fail
      await expect(
        manager.spawnSubagent(level2.id, 'level-3-task', 'Level 3', {
          model: 'haiku',
          projectPath: '/test/path',
        })
      ).rejects.toThrow('Maximum subagent depth');
    });

    it('should track parent-child relationship correctly', async () => {
      const manager = new AgentManager(mockAdapter);

      const parentId = await manager.spawnAgent('parent-task', {
        model: 'opus',
        projectPath: '/test/path',
      });

      const child1 = await manager.spawnSubagent(parentId, 'child-1', 'Subtask 1', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      const child2 = await manager.spawnSubagent(parentId, 'child-2', 'Subtask 2', {
        model: 'haiku',
        projectPath: '/test/path',
      });

      const childSessions = manager.getChildSessions(parentId);
      expect(childSessions).toHaveLength(2);
      expect(childSessions.map(s => s.id)).toContain(child1.id);
      expect(childSessions.map(s => s.id)).toContain(child2.id);
    });

    it('should check if session can spawn subagent', async () => {
      const manager = new AgentManager(mockAdapter, { maxSubagentDepth: 1 });

      const parentId = await manager.spawnAgent('parent-task', {
        model: 'opus',
        projectPath: '/test/path',
      });

      expect(manager.canSpawnSubagent(parentId)).toBe(true);

      const child = await manager.spawnSubagent(parentId, 'child-task', 'Subtask', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      // Child is at max depth, cannot spawn further
      expect(manager.canSpawnSubagent(child.id)).toBe(false);
    });

    it('should return false for canSpawnSubagent with unknown session', () => {
      const manager = new AgentManager(mockAdapter);
      expect(manager.canSpawnSubagent('unknown')).toBe(false);
    });

    it('should get root session for subagent', async () => {
      const manager = new AgentManager(mockAdapter);

      const rootId = await manager.spawnAgent('root-task', {
        model: 'opus',
        projectPath: '/test/path',
      });

      const level1 = await manager.spawnSubagent(rootId, 'level-1', 'L1', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      const level2 = await manager.spawnSubagent(level1.id, 'level-2', 'L2', {
        model: 'haiku',
        projectPath: '/test/path',
      });

      expect(manager.getRootSession(level2.id)).toBe(rootId);
      expect(manager.getRootSession(level1.id)).toBe(rootId);
      expect(manager.getRootSession(rootId)).toBe(rootId);
    });

    it('should return null for getRootSession with unknown session', () => {
      const manager = new AgentManager(mockAdapter);
      expect(manager.getRootSession('unknown')).toBeNull();
    });

    describe('getAggregatedUsage', () => {
      it('should aggregate token usage from all descendants', async () => {
        // Set up adapter to track token usage per session
        let sessionTokens: Record<string, number> = {};
        let callCount = 0;

        mockAdapter.mapToAgentEvent = vi.fn().mockImplementation((msg, sid) => {
          callCount++;
          const tokens = callCount * 100;
          sessionTokens[sid] = tokens;
          return {
            type: 'completion',
            sessionId: sid,
            data: {
              success: true,
              usage: { totalTokens: tokens, inputTokens: tokens * 0.6, outputTokens: tokens * 0.4 },
            },
            timestamp: new Date(),
          };
        });

        const manager = new AgentManager(mockAdapter);

        // Spawn root
        const rootId = await manager.spawnAgent('root-task', {
          model: 'opus',
          projectPath: '/test/path',
        });

        // Complete root to get tokens
        if (mockAdapter.onMessageCallback) {
          await mockAdapter.onMessageCallback({} as SDKMessage, rootId);
        }
        await new Promise(resolve => setTimeout(resolve, 0));

        // Spawn child1
        const child1 = await manager.spawnSubagent(rootId, 'child-1', 'C1', {
          model: 'sonnet',
          projectPath: '/test/path',
        });

        if (mockAdapter.onMessageCallback) {
          await mockAdapter.onMessageCallback({} as SDKMessage, child1.id);
        }
        await new Promise(resolve => setTimeout(resolve, 0));

        // Spawn child2
        const child2 = await manager.spawnSubagent(rootId, 'child-2', 'C2', {
          model: 'haiku',
          projectPath: '/test/path',
        });

        if (mockAdapter.onMessageCallback) {
          await mockAdapter.onMessageCallback({} as SDKMessage, child2.id);
        }
        await new Promise(resolve => setTimeout(resolve, 0));

        // Root: 100, Child1: 200, Child2: 300 = 600 total
        const aggregated = manager.getAggregatedUsage(rootId);
        expect(aggregated.totalTokens).toBe(600);
      });

      it('should return session usage only for leaf sessions', async () => {
        mockAdapter.mapToAgentEvent = vi.fn().mockReturnValue({
          type: 'completion',
          sessionId: 'test',
          data: {
            success: true,
            usage: { totalTokens: 100, inputTokens: 60, outputTokens: 40 },
          },
          timestamp: new Date(),
        });

        const manager = new AgentManager(mockAdapter);

        const sessionId = await manager.spawnAgent('task', {
          model: 'sonnet',
          projectPath: '/test/path',
        });

        if (mockAdapter.onMessageCallback) {
          await mockAdapter.onMessageCallback({} as SDKMessage, sessionId);
        }
        await new Promise(resolve => setTimeout(resolve, 0));

        const usage = manager.getAggregatedUsage(sessionId);
        expect(usage.totalTokens).toBe(100);
      });

      it('should return zero usage for unknown session', () => {
        const manager = new AgentManager(mockAdapter);
        const usage = manager.getAggregatedUsage('unknown');
        expect(usage.totalTokens).toBe(0);
      });
    });

    it('should terminate all descendants when terminating parent', async () => {
      const manager = new AgentManager(mockAdapter);

      const rootId = await manager.spawnAgent('root-task', {
        model: 'opus',
        projectPath: '/test/path',
      });

      const child1 = await manager.spawnSubagent(rootId, 'child-1', 'C1', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      const child2 = await manager.spawnSubagent(rootId, 'child-2', 'C2', {
        model: 'haiku',
        projectPath: '/test/path',
      });

      // Terminate root
      await manager.terminateSession(rootId);

      // All sessions should be terminated
      expect(manager.getSession(rootId)?.status).toBe('failed');
      expect(manager.getSession(child1.id)?.status).toBe('failed');
      expect(manager.getSession(child2.id)?.status).toBe('failed');
    });

    it('should set depth 0 for root sessions', async () => {
      const manager = new AgentManager(mockAdapter);

      const sessionId = await manager.spawnAgent('task', {
        model: 'sonnet',
        projectPath: '/test/path',
      });

      const session = manager.getSession(sessionId);
      expect(session?.depth).toBe(0);
      expect(session?.parentSessionId).toBeNull();
    });
  });
});
