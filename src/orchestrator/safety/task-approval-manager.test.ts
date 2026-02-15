import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TaskApprovalManager,
  PendingApproval,
  ApprovalResponse,
  SendApprovalRequestFn,
} from './task-approval-manager.js';
import { Task } from '../../db/repositories/tasks.js';

// Mock the logger
vi.mock('../../logging/index.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

/**
 * Build a mock Task with sensible defaults.
 * Override any field via the partial parameter.
 */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    title: 'Test task',
    description: 'A task for testing',
    status: 'queued',
    priority: 5,
    complexity_estimate: null,
    estimated_sessions_opus: 1,
    estimated_sessions_sonnet: 2,
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
    priority_confirmed: false,
    priority_confirmed_at: null,
    priority_confirmed_by: null,
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('TaskApprovalManager', () => {
  let manager: TaskApprovalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new TaskApprovalManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Auto-Approve for Confirmed Tasks ───────────────────────────────────

  describe('auto-approve for confirmed tasks', () => {
    it('returns false from requiresApproval when autoApproveConfirmed is true and task is confirmed', () => {
      // Default config has autoApproveConfirmed: true
      const task = makeTask({ priority_confirmed: true });
      expect(manager.requiresApproval(task)).toBe(false);
    });

    it('returns true from requiresApproval when task is NOT confirmed', () => {
      const task = makeTask({ priority_confirmed: false });
      expect(manager.requiresApproval(task)).toBe(true);
    });

    it('skips the auto-approve shortcut when autoApproveConfirmed is false, falling through to default logic', () => {
      // With autoApproveConfirmed: false, the early-exit auto-approve path is skipped.
      // However, the default fallback is `return !task.priority_confirmed`, so a
      // confirmed task still does not require approval via the default path.
      // To truly require approval for confirmed tasks, use requireApprovalForAll: true.
      manager = new TaskApprovalManager({ autoApproveConfirmed: false });
      const confirmedTask = makeTask({ priority_confirmed: true });
      expect(manager.requiresApproval(confirmedTask)).toBe(false);

      const unconfirmedTask = makeTask({ priority_confirmed: false });
      expect(manager.requiresApproval(unconfirmedTask)).toBe(true);
    });
  });

  // ── 5-Minute Timeout ──────────────────────────────────────────────────

  describe('5-minute timeout', () => {
    it('times out after 300000ms (5 minutes)', async () => {
      const task = makeTask();
      await manager.requestApproval(task);

      // Not yet timed out
      const beforeTimeout = manager.getPendingApproval(task.id);
      expect(beforeTimeout?.status).toBe('pending');

      // Advance past the timeout
      vi.advanceTimersByTime(300_000);

      const afterTimeout = manager.getPendingApproval(task.id);
      expect(afterTimeout?.status).toBe('timeout');
    });

    it('changes status to timeout after expiry', async () => {
      const task = makeTask({ id: 'timeout-task' });
      const pending = await manager.requestApproval(task);
      expect(pending.status).toBe('pending');

      vi.advanceTimersByTime(300_001);

      expect(manager.getPendingApproval('timeout-task')?.status).toBe('timeout');
    });

    it('fires onApproval callback with timeout status', async () => {
      const callback = vi.fn();
      manager.onApproval(callback);

      const task = makeTask({ id: 'cb-timeout' });
      await manager.requestApproval(task);

      vi.advanceTimersByTime(300_000);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'cb-timeout',
          approved: false,
          reason: 'Approval timeout',
          respondedBy: 'system',
        })
      );
    });
  });

  // ── Rejection Handling ─────────────────────────────────────────────────

  describe('rejection handling', () => {
    it('sets status to rejected when handleResponse is called with approved=false', async () => {
      const task = makeTask({ id: 'reject-1' });
      await manager.requestApproval(task);

      manager.handleResponse('reject-1', false, 'user', 'too expensive');

      const approval = manager.getPendingApproval('reject-1');
      expect(approval?.status).toBe('rejected');
    });

    it('stores the rejection reason and it is accessible via getPendingApproval', async () => {
      const task = makeTask({ id: 'reject-2' });
      await manager.requestApproval(task);

      manager.handleResponse('reject-2', false, 'eli', 'too expensive');

      const approval = manager.getPendingApproval('reject-2');
      expect(approval?.rejectionReason).toBe('too expensive');
    });

    it('fires onApproval callback with rejection details', async () => {
      const callback = vi.fn();
      manager.onApproval(callback);

      const task = makeTask({ id: 'reject-cb' });
      await manager.requestApproval(task);

      manager.handleResponse('reject-cb', false, 'eli', 'not now');

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'reject-cb',
          approved: false,
          reason: 'not now',
          respondedBy: 'eli',
        })
      );
    });
  });

  // ── requestApproval ────────────────────────────────────────────────────

  describe('requestApproval', () => {
    it('calls sendRequestFn with the task and a formatted message', async () => {
      const sendFn = vi.fn().mockResolvedValue('thread-123');
      manager.setSendRequestFn(sendFn);

      const task = makeTask({ id: 'send-1', title: 'Important task' });
      await manager.requestApproval(task);

      expect(sendFn).toHaveBeenCalledOnce();
      expect(sendFn).toHaveBeenCalledWith(task, expect.stringContaining('Important task'));
    });

    it('stores thread ID returned by sendRequestFn', async () => {
      const sendFn = vi.fn().mockResolvedValue('ts-456');
      manager.setSendRequestFn(sendFn);

      const task = makeTask({ id: 'thread-1' });
      const pending = await manager.requestApproval(task);

      expect(pending.threadTs).toBe('ts-456');
    });

    it('catches errors from sendRequestFn without throwing', async () => {
      const sendFn = vi.fn().mockRejectedValue(new Error('Slack is down'));
      manager.setSendRequestFn(sendFn);

      const task = makeTask({ id: 'err-send' });

      // Should not throw
      const pending = await manager.requestApproval(task);
      expect(pending.status).toBe('pending');
      expect(pending.threadTs).toBeUndefined();
    });

    it('works without a sendRequestFn configured', async () => {
      const task = makeTask({ id: 'no-fn' });
      const pending = await manager.requestApproval(task);

      expect(pending.status).toBe('pending');
      expect(pending.threadTs).toBeUndefined();
    });
  });

  // ── handleResponse ─────────────────────────────────────────────────────

  describe('handleResponse', () => {
    it('sets status to approved when approved=true', async () => {
      const task = makeTask({ id: 'approve-1' });
      await manager.requestApproval(task);

      manager.handleResponse('approve-1', true, 'eli');

      const approval = manager.getPendingApproval('approve-1');
      expect(approval?.status).toBe('approved');
    });

    it('ignores duplicate responses for the same task', async () => {
      const callback = vi.fn();
      manager.onApproval(callback);

      const task = makeTask({ id: 'dup-1' });
      await manager.requestApproval(task);

      manager.handleResponse('dup-1', true, 'eli');
      manager.handleResponse('dup-1', false, 'bob', 'changed mind');

      // Only the first response should trigger the callback
      expect(callback).toHaveBeenCalledOnce();
      expect(manager.getPendingApproval('dup-1')?.status).toBe('approved');
    });

    it('ignores response after timeout', async () => {
      const callback = vi.fn();
      manager.onApproval(callback);

      const task = makeTask({ id: 'late-1' });
      await manager.requestApproval(task);

      vi.advanceTimersByTime(300_000);
      expect(callback).toHaveBeenCalledOnce(); // timeout callback

      // Late response should be ignored
      manager.handleResponse('late-1', true, 'eli');
      expect(callback).toHaveBeenCalledOnce(); // still only the timeout call
      expect(manager.getPendingApproval('late-1')?.status).toBe('timeout');
    });

    it('ignores response for unknown task', () => {
      // Should not throw
      manager.handleResponse('nonexistent', true, 'eli');
    });
  });

  // ── isApproved ─────────────────────────────────────────────────────────

  describe('isApproved', () => {
    it('returns true only for approved tasks', async () => {
      const task = makeTask({ id: 'approved-check' });
      await manager.requestApproval(task);

      expect(manager.isApproved('approved-check')).toBe(false);

      manager.handleResponse('approved-check', true, 'eli');

      expect(manager.isApproved('approved-check')).toBe(true);
    });

    it('returns false for rejected tasks', async () => {
      const task = makeTask({ id: 'rejected-check' });
      await manager.requestApproval(task);
      manager.handleResponse('rejected-check', false, 'eli');

      expect(manager.isApproved('rejected-check')).toBe(false);
    });

    it('returns false for timed-out tasks', async () => {
      const task = makeTask({ id: 'timeout-check' });
      await manager.requestApproval(task);
      vi.advanceTimersByTime(300_000);

      expect(manager.isApproved('timeout-check')).toBe(false);
    });

    it('returns false for unknown tasks', () => {
      expect(manager.isApproved('unknown')).toBe(false);
    });
  });

  // ── getPendingApproval ─────────────────────────────────────────────────

  describe('getPendingApproval', () => {
    it('returns undefined for an unknown task', () => {
      expect(manager.getPendingApproval('no-such-task')).toBeUndefined();
    });

    it('returns the PendingApproval object for a known task', async () => {
      const task = makeTask({ id: 'known-1' });
      await manager.requestApproval(task);

      const pending = manager.getPendingApproval('known-1');
      expect(pending).toBeDefined();
      expect(pending?.taskId).toBe('known-1');
      expect(pending?.status).toBe('pending');
    });
  });

  // ── getAllPending ──────────────────────────────────────────────────────

  describe('getAllPending', () => {
    it('returns only pending approvals', async () => {
      const task1 = makeTask({ id: 'p1' });
      const task2 = makeTask({ id: 'p2' });
      const task3 = makeTask({ id: 'p3' });

      await manager.requestApproval(task1);
      await manager.requestApproval(task2);
      await manager.requestApproval(task3);

      // Approve one, reject another
      manager.handleResponse('p1', true, 'eli');
      manager.handleResponse('p2', false, 'eli');

      const pending = manager.getAllPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].taskId).toBe('p3');
    });

    it('returns empty array when no pending approvals exist', () => {
      expect(manager.getAllPending()).toEqual([]);
    });
  });

  // ── clearApproval ─────────────────────────────────────────────────────

  describe('clearApproval', () => {
    it('removes the approval record entirely', async () => {
      const task = makeTask({ id: 'clear-1' });
      await manager.requestApproval(task);

      expect(manager.getPendingApproval('clear-1')).toBeDefined();

      manager.clearApproval('clear-1');

      expect(manager.getPendingApproval('clear-1')).toBeUndefined();
    });

    it('does not throw when clearing a nonexistent task', () => {
      expect(() => manager.clearApproval('no-task')).not.toThrow();
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns correct counts by status', async () => {
      const t1 = makeTask({ id: 's1' });
      const t2 = makeTask({ id: 's2' });
      const t3 = makeTask({ id: 's3' });
      const t4 = makeTask({ id: 's4' });

      await manager.requestApproval(t1);
      await manager.requestApproval(t2);
      await manager.requestApproval(t3);
      await manager.requestApproval(t4);

      manager.handleResponse('s1', true, 'eli');     // approved
      manager.handleResponse('s2', false, 'eli');     // rejected
      vi.advanceTimersByTime(300_000);                // s3 and s4 time out

      const stats = manager.getStats();
      expect(stats.approved).toBe(1);
      expect(stats.rejected).toBe(1);
      expect(stats.timedOut).toBe(2);
      expect(stats.pending).toBe(0);
    });

    it('returns all zeros when no approvals exist', () => {
      const stats = manager.getStats();
      expect(stats).toEqual({ pending: 0, approved: 0, rejected: 0, timedOut: 0 });
    });
  });

  // ── autoApprovePriorityThreshold ──────────────────────────────────────

  describe('autoApprovePriorityThreshold', () => {
    it('auto-approves tasks at or above the threshold', () => {
      manager = new TaskApprovalManager({
        autoApproveConfirmed: false,
        autoApprovePriorityThreshold: 7,
      });

      const highPriority = makeTask({ priority: 8 });
      const atThreshold = makeTask({ priority: 7 });
      const belowThreshold = makeTask({ priority: 6 });

      expect(manager.requiresApproval(highPriority)).toBe(false);
      expect(manager.requiresApproval(atThreshold)).toBe(false);
      expect(manager.requiresApproval(belowThreshold)).toBe(true);
    });

    it('auto-approves when priority equals threshold exactly', () => {
      manager = new TaskApprovalManager({
        autoApproveConfirmed: false,
        autoApprovePriorityThreshold: 5,
      });

      const task = makeTask({ priority: 5 });
      expect(manager.requiresApproval(task)).toBe(false);
    });
  });

  // ── requireApprovalForAll ─────────────────────────────────────────────

  describe('requireApprovalForAll', () => {
    it('requires approval even for confirmed tasks', () => {
      manager = new TaskApprovalManager({
        autoApproveConfirmed: false,
        requireApprovalForAll: true,
      });

      const task = makeTask({ priority_confirmed: true });
      expect(manager.requiresApproval(task)).toBe(true);
    });

    it('requires approval for unconfirmed tasks too', () => {
      manager = new TaskApprovalManager({
        autoApproveConfirmed: false,
        requireApprovalForAll: true,
      });

      const task = makeTask({ priority_confirmed: false });
      expect(manager.requiresApproval(task)).toBe(true);
    });
  });

  // ── Callback error handling ───────────────────────────────────────────

  describe('callback error handling', () => {
    it('catches errors thrown by onApproval callbacks', async () => {
      const badCallback = vi.fn(() => {
        throw new Error('callback boom');
      });
      const goodCallback = vi.fn();

      manager.onApproval(badCallback);
      manager.onApproval(goodCallback);

      const task = makeTask({ id: 'cb-err' });
      await manager.requestApproval(task);

      // Should not throw even though badCallback throws
      manager.handleResponse('cb-err', true, 'eli');

      expect(badCallback).toHaveBeenCalledOnce();
      expect(goodCallback).toHaveBeenCalledOnce();
    });

    it('catches errors thrown by callbacks during timeout', async () => {
      const badCallback = vi.fn(() => {
        throw new Error('timeout callback boom');
      });

      manager.onApproval(badCallback);

      const task = makeTask({ id: 'cb-timeout-err' });
      await manager.requestApproval(task);

      // Should not throw
      vi.advanceTimersByTime(300_000);

      expect(badCallback).toHaveBeenCalledOnce();
      // The task should still be marked as timed out
      expect(manager.getPendingApproval('cb-timeout-err')?.status).toBe('timeout');
    });
  });

  // ── Unsubscribe ───────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('removes the callback when unsubscribe function is called', async () => {
      const callback = vi.fn();
      const unsubscribe = manager.onApproval(callback);

      const task = makeTask({ id: 'unsub-1' });
      await manager.requestApproval(task);

      unsubscribe();

      manager.handleResponse('unsub-1', true, 'eli');

      expect(callback).not.toHaveBeenCalled();
    });

    it('does not affect other callbacks when one is unsubscribed', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsub1 = manager.onApproval(callback1);
      manager.onApproval(callback2);

      unsub1();

      const task = makeTask({ id: 'unsub-2' });
      await manager.requestApproval(task);
      manager.handleResponse('unsub-2', true, 'eli');

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledOnce();
    });
  });

  // ── Constructor defaults ──────────────────────────────────────────────

  describe('constructor defaults', () => {
    it('uses default config values when no config is provided', () => {
      const mgr = new TaskApprovalManager();
      // Verify default behavior: confirmed tasks are auto-approved
      const confirmed = makeTask({ priority_confirmed: true });
      expect(mgr.requiresApproval(confirmed)).toBe(false);

      // Unconfirmed tasks require approval
      const unconfirmed = makeTask({ priority_confirmed: false });
      expect(mgr.requiresApproval(unconfirmed)).toBe(true);
    });

    it('merges partial config with defaults', () => {
      const mgr = new TaskApprovalManager({ approvalTimeoutMs: 60_000 });
      // autoApproveConfirmed should still default to true
      const confirmed = makeTask({ priority_confirmed: true });
      expect(mgr.requiresApproval(confirmed)).toBe(false);
    });

    it('uses custom timeout when provided', async () => {
      const mgr = new TaskApprovalManager({ approvalTimeoutMs: 60_000 });
      const task = makeTask({ id: 'custom-timeout' });
      await mgr.requestApproval(task);

      // Should not timeout before 60s
      vi.advanceTimersByTime(59_999);
      expect(mgr.getPendingApproval('custom-timeout')?.status).toBe('pending');

      // Should timeout at 60s
      vi.advanceTimersByTime(1);
      expect(mgr.getPendingApproval('custom-timeout')?.status).toBe('timeout');
    });
  });
});
