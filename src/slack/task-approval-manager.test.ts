import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskApprovalManager,
  TaskApprovalConfig,
  ApprovalSendFunction,
} from './task-approval-manager.js';
import { Task } from '../db/repositories/tasks.js';
import { SupabaseClient } from '@supabase/supabase-js';

// Mock task for testing
const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-123',
  project_id: 'project-456',
  title: 'Test Task',
  description: 'A task for testing approval workflow',
  status: 'queued',
  priority: 50,
  complexity_estimate: 'medium',
  estimated_sessions_opus: 2,
  estimated_sessions_sonnet: 3,
  actual_tokens_opus: 0,
  actual_tokens_sonnet: 0,
  actual_sessions_opus: 0,
  actual_sessions_sonnet: 0,
  assigned_agent_id: null,
  requires_visual_review: false,
  parent_task_id: null,
  tags: [],
  acceptance_criteria: null,
  source: 'user',
  blocked_by_task_id: null,
  eta: null,
  started_at: null,
  completed_at: null,
  priority_confirmed: false,
  priority_confirmed_at: null,
  priority_confirmed_by: null,
  created_at: '2026-01-26T12:00:00Z',
  updated_at: '2026-01-26T12:00:00Z',
  ...overrides,
});

// Create mock Supabase client
const createMockClient = () => {
  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gt: vi.fn().mockResolvedValue({ count: 5, error: null }),
      }),
    }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  });

  return {
    from: mockFrom,
  } as unknown as SupabaseClient;
};

/**
 * Helper to start an approval request and wait for it to be registered
 * Returns the approval promise which resolves when approved/rejected/timed out
 */
async function startApprovalRequest(
  manager: TaskApprovalManager,
  task: Task
): Promise<{ approvalPromise: Promise<{ taskId: string; status: string; approvedBy?: string; rejectedBy?: string; reason?: string; respondedAt?: Date }> }> {
  // Start the approval request
  const approvalPromise = manager.requestApproval(task);

  // Wait a tick for the async setup to complete (message sending, etc.)
  await vi.advanceTimersByTimeAsync(0);

  return { approvalPromise };
}

describe('TaskApprovalManager', () => {
  let manager: TaskApprovalManager;
  let mockSendFn: ApprovalSendFunction;
  let mockClient: SupabaseClient;
  let config: TaskApprovalConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-26T12:00:00Z'));

    mockSendFn = vi.fn().mockResolvedValue('1234567890.123456');
    mockClient = createMockClient();

    config = {
      channelId: 'C12345',
      timeoutMs: 5000, // 5 seconds for faster tests
    };

    manager = new TaskApprovalManager(config, mockClient, mockSendFn);
  });

  afterEach(() => {
    vi.useRealTimers();
    manager.destroy();
  });

  describe('constructor', () => {
    it('should throw if channelId is not provided', () => {
      expect(() => {
        new TaskApprovalManager({ channelId: '', timeoutMs: 5000 }, mockClient, mockSendFn);
      }).toThrow('TaskApprovalManager requires a channelId');
    });

    it('should use default timeout if not specified', () => {
      const mgr = new TaskApprovalManager(
        { channelId: 'C12345', timeoutMs: 300000 },
        mockClient,
        mockSendFn
      );
      expect(mgr).toBeDefined();
      mgr.destroy();
    });
  });

  describe('requestApproval', () => {
    it('should send approval request message', async () => {
      const task = createMockTask();

      const { approvalPromise } = await startApprovalRequest(manager, task);

      // Verify message was sent
      expect(mockSendFn).toHaveBeenCalledTimes(1);
      expect(mockSendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345',
          text: expect.stringContaining('Test Task'),
        }),
        undefined
      );

      // Clean up by approving
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });

    it('should include task details in message', async () => {
      const task = createMockTask({
        title: 'Complex Feature',
        description: 'Build a complex feature with many components',
        priority: 75,
        estimated_sessions_opus: 5,
        estimated_sessions_sonnet: 10,
      });

      const { approvalPromise } = await startApprovalRequest(manager, task);

      expect(mockSendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Complex Feature'),
        }),
        undefined
      );
      expect(mockSendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Priority:* 75'),
        }),
        undefined
      );

      // Clean up
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });

    it('should track pending approvals', async () => {
      const task = createMockTask();

      const { approvalPromise } = await startApprovalRequest(manager, task);

      const pending = manager.getPendingApprovals();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(task.id);

      // Clean up
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });

    it('should return timeout result if message send fails', async () => {
      const failingSendFn = vi.fn().mockResolvedValue(undefined);
      const failManager = new TaskApprovalManager(config, mockClient, failingSendFn);

      const task = createMockTask();
      const result = await failManager.requestApproval(task);

      expect(result.status).toBe('timeout');
      expect(result.reason).toContain('Failed to send');

      failManager.destroy();
    });
  });

  describe('handleReaction', () => {
    it('should approve on white_check_mark reaction', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReaction('white_check_mark', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
      expect(result.approvedBy).toBe('user-1');
      expect(result.respondedAt).toBeDefined();
    });

    it('should approve on heavy_check_mark reaction', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReaction('heavy_check_mark', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
    });

    it('should approve on thumbsup reaction', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReaction('+1', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
    });

    it('should reject on x reaction', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReaction('x', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('rejected');
      expect(result.rejectedBy).toBe('user-1');
    });

    it('should reject on thumbsdown reaction', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReaction('-1', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('rejected');
    });

    it('should ignore unknown reactions', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReaction('smile', task.id, 'user-1');

      // Should still be pending
      const pending = manager.getPendingApprovals();
      expect(pending).toHaveLength(1);

      // Clean up
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });

    it('should ignore reactions for non-pending tasks', async () => {
      // No error should be thrown
      await manager.handleReaction('white_check_mark', 'non-existent-task', 'user-1');
    });

    it('should remove from pending after approval', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      expect(manager.getPendingApprovals()).toHaveLength(1);

      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;

      expect(manager.getPendingApprovals()).toHaveLength(0);
    });
  });

  describe('handleReply', () => {
    it('should approve on "approve" reply', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('approve', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
      expect(result.approvedBy).toBe('user-1');
    });

    it('should approve on "yes" reply', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('yes', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
    });

    it('should approve on "lgtm" reply', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('LGTM', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
    });

    it('should approve on "go" reply', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('go', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
    });

    it('should reject on "reject" reply', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('reject', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('rejected');
      expect(result.rejectedBy).toBe('user-1');
    });

    it('should reject on "no" reply', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('no', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('rejected');
    });

    it('should reject on "cancel" reply', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('cancel', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('rejected');
    });

    it('should extract reason from "reject: reason" reply', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('reject: needs more detail', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('needs more detail');
    });

    it('should be case-insensitive', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('APPROVE', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
    });

    it('should ignore unrecognized replies', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      await manager.handleReply('what is this?', task.id, 'user-1');

      // Should still be pending
      expect(manager.getPendingApprovals()).toHaveLength(1);

      // Clean up
      await manager.handleReply('approve', task.id, 'user-1');
      await approvalPromise;
    });

    it('should ignore replies for non-pending tasks', async () => {
      // No error should be thrown
      await manager.handleReply('approve', 'non-existent-task', 'user-1');
    });
  });

  describe('timeout behavior', () => {
    it('should NOT auto-approve on timeout', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(6000);

      const result = await approvalPromise;
      expect(result.status).toBe('timeout');
      expect(result.reason).toContain('No response');
    });

    it('should clear pending on timeout', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      expect(manager.getPendingApprovals()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(6000);
      await approvalPromise;

      expect(manager.getPendingApprovals()).toHaveLength(0);
    });

    it('should not timeout if approved before timeout', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      // Approve before timeout
      await vi.advanceTimersByTimeAsync(3000);
      await manager.handleReaction('white_check_mark', task.id, 'user-1');

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
    });
  });

  describe('getPendingApprovals', () => {
    it('should return empty array when no pending approvals', () => {
      const pending = manager.getPendingApprovals();
      expect(pending).toHaveLength(0);
    });

    it('should return all pending tasks', async () => {
      const task1 = createMockTask({ id: 'task-1', title: 'Task 1' });
      const task2 = createMockTask({ id: 'task-2', title: 'Task 2' });
      const task3 = createMockTask({ id: 'task-3', title: 'Task 3' });

      const { approvalPromise: p1 } = await startApprovalRequest(manager, task1);
      const { approvalPromise: p2 } = await startApprovalRequest(manager, task2);
      const { approvalPromise: p3 } = await startApprovalRequest(manager, task3);

      const pending = manager.getPendingApprovals();
      expect(pending).toHaveLength(3);
      expect(pending.map(t => t.id)).toContain('task-1');
      expect(pending.map(t => t.id)).toContain('task-2');
      expect(pending.map(t => t.id)).toContain('task-3');

      // Clean up
      await manager.handleReaction('white_check_mark', 'task-1', 'user-1');
      await manager.handleReaction('white_check_mark', 'task-2', 'user-1');
      await manager.handleReaction('white_check_mark', 'task-3', 'user-1');
      await Promise.all([p1, p2, p3]);
    });
  });

  describe('getPendingApprovalByTaskId', () => {
    it('should return pending approval for task', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      const pending = manager.getPendingApprovalByTaskId(task.id);
      expect(pending).toBeDefined();
      expect(pending?.task.id).toBe(task.id);
      expect(pending?.requestedAt).toBeDefined();
      expect(pending?.timeoutAt).toBeDefined();

      // Clean up
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });

    it('should return undefined for non-pending task', () => {
      const pending = manager.getPendingApprovalByTaskId('non-existent');
      expect(pending).toBeUndefined();
    });
  });

  describe('findPendingByThreadTs', () => {
    it('should find pending by thread timestamp', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      const pending = manager.findPendingByThreadTs('1234567890.123456');
      expect(pending).toBeDefined();
      expect(pending?.task.id).toBe(task.id);

      // Clean up
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });

    it('should return undefined for unknown thread', () => {
      const pending = manager.findPendingByThreadTs('unknown-thread');
      expect(pending).toBeUndefined();
    });
  });

  describe('cancelApproval', () => {
    it('should cancel pending approval', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      manager.cancelApproval(task.id, 'User cancelled');

      const result = await approvalPromise;
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('User cancelled');
    });

    it('should remove from pending after cancel', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      expect(manager.getPendingApprovals()).toHaveLength(1);

      manager.cancelApproval(task.id);
      await approvalPromise;

      expect(manager.getPendingApprovals()).toHaveLength(0);
    });

    it('should do nothing for non-pending task', () => {
      // Should not throw
      manager.cancelApproval('non-existent-task');
    });
  });

  describe('destroy', () => {
    it('should clear all pending approvals', async () => {
      const task1 = createMockTask({ id: 'task-1' });
      const task2 = createMockTask({ id: 'task-2' });

      const { approvalPromise: promise1 } = await startApprovalRequest(manager, task1);
      const { approvalPromise: promise2 } = await startApprovalRequest(manager, task2);

      expect(manager.getPendingApprovals()).toHaveLength(2);

      manager.destroy();

      expect(manager.getPendingApprovals()).toHaveLength(0);

      // Promises should resolve with rejected status
      const result1 = await promise1;
      const result2 = await promise2;
      expect(result1.status).toBe('rejected');
      expect(result1.reason).toBe('Manager destroyed');
      expect(result2.status).toBe('rejected');
    });

    it('should clear all timeout timers', async () => {
      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(manager, task);

      manager.destroy();
      await approvalPromise;

      // Advancing time should not cause any issues
      await vi.advanceTimersByTimeAsync(10000);
    });
  });

  describe('database logging', () => {
    it('should log approval to database', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      const mockFromChain = {
        insert: mockInsert,
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gt: vi.fn().mockResolvedValue({ count: 5, error: null }),
          }),
        }),
      };
      const loggingClient = {
        from: vi.fn().mockReturnValue(mockFromChain),
      } as unknown as SupabaseClient;

      const loggingManager = new TaskApprovalManager(config, loggingClient, mockSendFn);

      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(loggingManager, task);

      await loggingManager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;

      // Should have called insert on tc_task_approvals
      expect(loggingClient.from).toHaveBeenCalledWith('tc_task_approvals');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: task.id,
          status: 'approved',
          approved_by: 'user-1',
        })
      );

      loggingManager.destroy();
    });

    it('should log rejection with reason to database', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      const mockFromChain = {
        insert: mockInsert,
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gt: vi.fn().mockResolvedValue({ count: 5, error: null }),
          }),
        }),
      };
      const loggingClient = {
        from: vi.fn().mockReturnValue(mockFromChain),
      } as unknown as SupabaseClient;

      const loggingManager = new TaskApprovalManager(config, loggingClient, mockSendFn);

      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(loggingManager, task);

      await loggingManager.handleReply('reject: not ready yet', task.id, 'user-1');
      await approvalPromise;

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: task.id,
          status: 'rejected',
          rejected_by: 'user-1',
          reason: 'not ready yet',
        })
      );

      loggingManager.destroy();
    });

    it('should handle database errors gracefully', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: { message: 'DB error' } });
      const mockFromChain = {
        insert: mockInsert,
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gt: vi.fn().mockResolvedValue({ count: 5, error: null }),
          }),
        }),
      };
      const errorClient = {
        from: vi.fn().mockReturnValue(mockFromChain),
      } as unknown as SupabaseClient;

      const errorManager = new TaskApprovalManager(config, errorClient, mockSendFn);

      const task = createMockTask();
      const { approvalPromise } = await startApprovalRequest(errorManager, task);

      // Should not throw even if DB fails
      await errorManager.handleReaction('white_check_mark', task.id, 'user-1');
      const result = await approvalPromise;

      expect(result.status).toBe('approved');

      errorManager.destroy();
    });
  });

  describe('message formatting', () => {
    it('should truncate long descriptions', async () => {
      const longDescription = 'A'.repeat(300);
      const task = createMockTask({ description: longDescription });

      const { approvalPromise } = await startApprovalRequest(manager, task);

      expect(mockSendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('...'),
        }),
        undefined
      );

      // Clean up
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });

    it('should include cost estimates using fallback pricing when DB pricing unavailable', async () => {
      const task = createMockTask({
        estimated_sessions_opus: 3,
        estimated_sessions_sonnet: 5,
      });

      const { approvalPromise } = await startApprovalRequest(manager, task);

      // CostTracker now uses fallback pricing when DB is unavailable,
      // so the message should show cost estimates instead of just session counts
      const call = mockSendFn as unknown as ReturnType<typeof vi.fn>;
      const messageText = call.mock.calls[0][0].text;
      expect(messageText).toContain('Estimated Cost');
      expect(messageText).toContain('Opus');
      expect(messageText).toContain('Sonnet');

      // Clean up
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });

    it('should include queue position', async () => {
      const task = createMockTask();

      const { approvalPromise } = await startApprovalRequest(manager, task);

      expect(mockSendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Queue Position'),
        }),
        undefined
      );

      // Clean up
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });

    it('should include approval instructions', async () => {
      const task = createMockTask();

      const { approvalPromise } = await startApprovalRequest(manager, task);

      const call = mockSendFn as unknown as ReturnType<typeof vi.fn>;
      const messageText = call.mock.calls[0][0].text;

      expect(messageText).toContain('white_check_mark');
      expect(messageText).toContain('approve');
      expect(messageText).toContain('reject');

      // Clean up
      await manager.handleReaction('white_check_mark', task.id, 'user-1');
      await approvalPromise;
    });
  });

  describe('concurrent approvals', () => {
    it('should handle multiple concurrent approval requests', async () => {
      const tasks = [
        createMockTask({ id: 'task-1', title: 'Task 1' }),
        createMockTask({ id: 'task-2', title: 'Task 2' }),
        createMockTask({ id: 'task-3', title: 'Task 3' }),
      ];

      const results = await Promise.all(
        tasks.map(task => startApprovalRequest(manager, task))
      );
      const promises = results.map(r => r.approvalPromise);

      expect(manager.getPendingApprovals()).toHaveLength(3);

      // Approve some, reject others
      await manager.handleReaction('white_check_mark', 'task-1', 'user-1');
      await manager.handleReaction('x', 'task-2', 'user-1');
      await manager.handleReply('approve', 'task-3', 'user-2');

      const finalResults = await Promise.all(promises);

      expect(finalResults[0].status).toBe('approved');
      expect(finalResults[1].status).toBe('rejected');
      expect(finalResults[2].status).toBe('approved');
      expect(manager.getPendingApprovals()).toHaveLength(0);
    });

    it('should handle interleaved timeouts and approvals', async () => {
      const task1 = createMockTask({ id: 'task-1' });
      const task2 = createMockTask({ id: 'task-2' });

      const { approvalPromise: promise1 } = await startApprovalRequest(manager, task1);
      const { approvalPromise: promise2 } = await startApprovalRequest(manager, task2);

      // Approve task1
      await manager.handleReaction('white_check_mark', 'task-1', 'user-1');

      // Let task2 timeout
      await vi.advanceTimersByTimeAsync(6000);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.status).toBe('approved');
      expect(result2.status).toBe('timeout');
    });
  });
});
