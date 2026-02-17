import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadTracker, SlackThread } from './thread-tracker.js';

describe('ThreadTracker', () => {
  let tracker: ThreadTracker;

  beforeEach(() => {
    tracker = new ThreadTracker();
  });

  describe('createThread', () => {
    it('should create a new thread entry', () => {
      const thread = tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      expect(thread.threadTs).toBe('1234567890.123456');
      expect(thread.taskId).toBe('task-1');
      expect(thread.projectName).toBe('TestProject');
      expect(thread.agentId).toBe('agent-1');
      expect(thread.status).toBe('active');
    });

    it('should assign default status of active', () => {
      const thread = tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      expect(thread.status).toBe('active');
    });

    it('should allow custom status on creation', () => {
      const thread = tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1',
        status: 'waiting_response'
      });

      expect(thread.status).toBe('waiting_response');
    });
  });

  describe('getByThreadTs', () => {
    it('should return thread by thread timestamp', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const thread = tracker.getByThreadTs('1234567890.123456');
      expect(thread).toBeDefined();
      expect(thread?.taskId).toBe('task-1');
    });

    it('should return undefined for non-existent thread', () => {
      const thread = tracker.getByThreadTs('nonexistent');
      expect(thread).toBeUndefined();
    });
  });

  describe('getByTaskId', () => {
    it('should return thread by task ID', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const thread = tracker.getByTaskId('task-1');
      expect(thread).toBeDefined();
      expect(thread?.threadTs).toBe('1234567890.123456');
    });

    it('should return undefined for non-existent task', () => {
      const thread = tracker.getByTaskId('nonexistent');
      expect(thread).toBeUndefined();
    });
  });

  describe('getByAgentId', () => {
    it('should return all threads for an agent', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });
      tracker.createThread({
        threadTs: '1234567890.654321',
        taskId: 'task-2',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });
      tracker.createThread({
        threadTs: '1234567890.111111',
        taskId: 'task-3',
        projectName: 'TestProject',
        agentId: 'agent-2'
      });

      const threads = tracker.getByAgentId('agent-1');
      expect(threads).toHaveLength(2);
      expect(threads.map(t => t.taskId)).toContain('task-1');
      expect(threads.map(t => t.taskId)).toContain('task-2');
    });

    it('should return empty array for non-existent agent', () => {
      const threads = tracker.getByAgentId('nonexistent');
      expect(threads).toEqual([]);
    });
  });

  describe('getByProject', () => {
    it('should return all threads for a project', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'ProjectA',
        agentId: 'agent-1'
      });
      tracker.createThread({
        threadTs: '1234567890.654321',
        taskId: 'task-2',
        projectName: 'ProjectA',
        agentId: 'agent-2'
      });
      tracker.createThread({
        threadTs: '1234567890.111111',
        taskId: 'task-3',
        projectName: 'ProjectB',
        agentId: 'agent-1'
      });

      const threads = tracker.getByProject('ProjectA');
      expect(threads).toHaveLength(2);
    });

    it('should return empty array for non-existent project', () => {
      const threads = tracker.getByProject('NonExistent');
      expect(threads).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('should update thread status', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const updated = tracker.updateStatus('1234567890.123456', 'waiting_response');
      expect(updated).toBe(true);

      const thread = tracker.getByThreadTs('1234567890.123456');
      expect(thread?.status).toBe('waiting_response');
    });

    it('should return false for non-existent thread', () => {
      const updated = tracker.updateStatus('nonexistent', 'resolved');
      expect(updated).toBe(false);
    });
  });

  describe('getActiveThreads', () => {
    it('should return only active threads', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1',
        status: 'active'
      });
      tracker.createThread({
        threadTs: '1234567890.654321',
        taskId: 'task-2',
        projectName: 'TestProject',
        agentId: 'agent-1',
        status: 'waiting_response'
      });
      tracker.createThread({
        threadTs: '1234567890.111111',
        taskId: 'task-3',
        projectName: 'TestProject',
        agentId: 'agent-1',
        status: 'resolved'
      });

      const active = tracker.getActiveThreads();
      expect(active).toHaveLength(2); // active and waiting_response
    });

    it('should return empty array when no active threads', () => {
      tracker.createThread({
        threadTs: '1234567890.111111',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1',
        status: 'resolved'
      });

      const active = tracker.getActiveThreads();
      expect(active).toHaveLength(0);
    });
  });

  describe('getWaitingResponseThreads', () => {
    it('should return only threads waiting for response', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1',
        status: 'active'
      });
      tracker.createThread({
        threadTs: '1234567890.654321',
        taskId: 'task-2',
        projectName: 'TestProject',
        agentId: 'agent-1',
        status: 'waiting_response'
      });

      const waiting = tracker.getWaitingResponseThreads();
      expect(waiting).toHaveLength(1);
      expect(waiting[0].taskId).toBe('task-2');
    });
  });

  describe('resolveThread', () => {
    it('should mark thread as resolved', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const resolved = tracker.resolveThread('1234567890.123456');
      expect(resolved).toBe(true);

      const thread = tracker.getByThreadTs('1234567890.123456');
      expect(thread?.status).toBe('resolved');
    });

    it('should return false for non-existent thread', () => {
      const resolved = tracker.resolveThread('nonexistent');
      expect(resolved).toBe(false);
    });
  });

  describe('removeThread', () => {
    it('should remove a thread', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const removed = tracker.removeThread('1234567890.123456');
      expect(removed).toBe(true);

      const thread = tracker.getByThreadTs('1234567890.123456');
      expect(thread).toBeUndefined();
    });

    it('should return false for non-existent thread', () => {
      const removed = tracker.removeThread('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('getAllThreads', () => {
    it('should return all threads', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });
      tracker.createThread({
        threadTs: '1234567890.654321',
        taskId: 'task-2',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const all = tracker.getAllThreads();
      expect(all).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('should clear all threads', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });
      tracker.createThread({
        threadTs: '1234567890.654321',
        taskId: 'task-2',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      tracker.clear();

      const all = tracker.getAllThreads();
      expect(all).toHaveLength(0);
    });
  });

  describe('thread metadata', () => {
    it('should track createdAt timestamp', () => {
      const before = Date.now();
      const thread = tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });
      const after = Date.now();

      expect(thread.createdAt).toBeDefined();
      expect(thread.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(thread.createdAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('should track lastActivityAt timestamp', () => {
      const thread = tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      expect(thread.lastActivityAt).toBeDefined();
      expect(thread.lastActivityAt.getTime()).toBe(thread.createdAt.getTime());
    });

    it('should update lastActivityAt on status change', async () => {
      const thread = tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const originalActivity = thread.lastActivityAt.getTime();

      // Small delay to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      tracker.updateStatus('1234567890.123456', 'waiting_response');

      const updated = tracker.getByThreadTs('1234567890.123456');
      expect(updated?.lastActivityAt.getTime()).toBeGreaterThan(originalActivity);
    });
  });

  describe('thread message tracking', () => {
    it('should allow adding message to thread', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      tracker.addMessageToThread('1234567890.123456', {
        messageTs: '1234567890.999999',
        userId: 'user-1',
        text: 'Hello agent'
      });

      const thread = tracker.getByThreadTs('1234567890.123456');
      expect(thread?.messages).toHaveLength(1);
      expect(thread?.messages[0].text).toBe('Hello agent');
    });

    it('should track multiple messages in thread', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      tracker.addMessageToThread('1234567890.123456', {
        messageTs: '1234567890.999999',
        userId: 'user-1',
        text: 'First message'
      });
      tracker.addMessageToThread('1234567890.123456', {
        messageTs: '1234567891.000000',
        userId: 'agent-1',
        text: 'Response'
      });

      const thread = tracker.getByThreadTs('1234567890.123456');
      expect(thread?.messages).toHaveLength(2);
    });

    it('should return false when adding message to non-existent thread', () => {
      const result = tracker.addMessageToThread('nonexistent', {
        messageTs: '1234567890.999999',
        userId: 'user-1',
        text: 'Hello'
      });
      expect(result).toBe(false);
    });

    it('should update lastActivityAt when adding message', async () => {
      const thread = tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const originalActivity = thread.lastActivityAt.getTime();

      await new Promise(resolve => setTimeout(resolve, 10));

      tracker.addMessageToThread('1234567890.123456', {
        messageTs: '1234567890.999999',
        userId: 'user-1',
        text: 'Hello'
      });

      const updated = tracker.getByThreadTs('1234567890.123456');
      expect(updated?.lastActivityAt.getTime()).toBeGreaterThan(originalActivity);
    });
  });

  describe('TTL-based cleanup', () => {
    it('should track resolvedAt timestamp when thread is resolved', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const before = Date.now();
      tracker.resolveThread('1234567890.123456');
      const after = Date.now();

      const thread = tracker.getByThreadTs('1234567890.123456');
      expect(thread?.resolvedAt).toBeDefined();
      expect(thread?.resolvedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(thread?.resolvedAt!.getTime()).toBeLessThanOrEqual(after);
    });

    it('should not set resolvedAt for non-resolved threads', () => {
      tracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      const thread = tracker.getByThreadTs('1234567890.123456');
      expect(thread?.resolvedAt).toBeUndefined();
    });

    it('should remove resolved threads older than TTL', async () => {
      // Create tracker with 100ms TTL
      const shortTtlTracker = new ThreadTracker(100);

      shortTtlTracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      shortTtlTracker.resolveThread('1234567890.123456');

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const removed = shortTtlTracker.cleanupExpiredThreads();
      expect(removed).toBe(1);

      const thread = shortTtlTracker.getByThreadTs('1234567890.123456');
      expect(thread).toBeUndefined();

      shortTtlTracker.destroy();
    });

    it('should not remove active threads regardless of age', async () => {
      const shortTtlTracker = new ThreadTracker(100);

      shortTtlTracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1',
        status: 'active'
      });

      // Wait longer than TTL
      await new Promise(resolve => setTimeout(resolve, 150));

      const removed = shortTtlTracker.cleanupExpiredThreads();
      expect(removed).toBe(0);

      const thread = shortTtlTracker.getByThreadTs('1234567890.123456');
      expect(thread).toBeDefined();

      shortTtlTracker.destroy();
    });

    it('should not remove waiting_response threads regardless of age', async () => {
      const shortTtlTracker = new ThreadTracker(100);

      shortTtlTracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1',
        status: 'waiting_response'
      });

      await new Promise(resolve => setTimeout(resolve, 150));

      const removed = shortTtlTracker.cleanupExpiredThreads();
      expect(removed).toBe(0);

      const thread = shortTtlTracker.getByThreadTs('1234567890.123456');
      expect(thread).toBeDefined();

      shortTtlTracker.destroy();
    });

    it('should not remove recently resolved threads', async () => {
      const shortTtlTracker = new ThreadTracker(1000);

      shortTtlTracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      shortTtlTracker.resolveThread('1234567890.123456');

      // Wait less than TTL
      await new Promise(resolve => setTimeout(resolve, 50));

      const removed = shortTtlTracker.cleanupExpiredThreads();
      expect(removed).toBe(0);

      const thread = shortTtlTracker.getByThreadTs('1234567890.123456');
      expect(thread).toBeDefined();

      shortTtlTracker.destroy();
    });

    it('should remove task-to-thread mapping when cleaning up expired thread', async () => {
      const shortTtlTracker = new ThreadTracker(100);

      shortTtlTracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      shortTtlTracker.resolveThread('1234567890.123456');

      await new Promise(resolve => setTimeout(resolve, 150));

      shortTtlTracker.cleanupExpiredThreads();

      const thread = shortTtlTracker.getByTaskId('task-1');
      expect(thread).toBeUndefined();

      shortTtlTracker.destroy();
    });

    it('should return correct count of removed threads', async () => {
      const shortTtlTracker = new ThreadTracker(100);

      // Create 3 threads, resolve 2
      shortTtlTracker.createThread({
        threadTs: '1234567890.123456',
        taskId: 'task-1',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });
      shortTtlTracker.createThread({
        threadTs: '1234567890.654321',
        taskId: 'task-2',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });
      shortTtlTracker.createThread({
        threadTs: '1234567890.111111',
        taskId: 'task-3',
        projectName: 'TestProject',
        agentId: 'agent-1'
      });

      shortTtlTracker.resolveThread('1234567890.123456');
      shortTtlTracker.resolveThread('1234567890.654321');

      await new Promise(resolve => setTimeout(resolve, 150));

      const removed = shortTtlTracker.cleanupExpiredThreads();
      expect(removed).toBe(2);

      expect(shortTtlTracker.getAllThreads()).toHaveLength(1);

      shortTtlTracker.destroy();
    });

    it('should handle cleanup with no expired threads', () => {
      const removed = tracker.cleanupExpiredThreads();
      expect(removed).toBe(0);
    });
  });

  describe('stress test - memory stability', () => {
    it('should handle 1000+ thread lifecycle operations without memory leak', async () => {
      const shortTtlTracker = new ThreadTracker(50);
      const operations = 1100;

      // Create and resolve many threads
      for (let i = 0; i < operations; i++) {
        shortTtlTracker.createThread({
          threadTs: `1234567890.${i}`,
          taskId: `task-${i}`,
          projectName: 'TestProject',
          agentId: 'agent-1'
        });
        shortTtlTracker.resolveThread(`1234567890.${i}`);
      }

      // All threads are created and resolved
      expect(shortTtlTracker.getAllThreads()).toHaveLength(operations);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Cleanup should remove all resolved threads
      const removed = shortTtlTracker.cleanupExpiredThreads();
      expect(removed).toBe(operations);

      // Memory should be empty
      expect(shortTtlTracker.getAllThreads()).toHaveLength(0);

      shortTtlTracker.destroy();
    }, 10000); // 10 second timeout for stress test

    it('should maintain active threads while cleaning up resolved ones', async () => {
      const shortTtlTracker = new ThreadTracker(50);

      // Create mix of active and resolved threads
      for (let i = 0; i < 500; i++) {
        shortTtlTracker.createThread({
          threadTs: `1234567890.${i}`,
          taskId: `task-${i}`,
          projectName: 'TestProject',
          agentId: 'agent-1',
          status: i % 2 === 0 ? 'active' : 'resolved'
        });

        if (i % 2 !== 0) {
          shortTtlTracker.resolveThread(`1234567890.${i}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const removed = shortTtlTracker.cleanupExpiredThreads();
      expect(removed).toBe(250); // Half were resolved

      const remaining = shortTtlTracker.getAllThreads();
      expect(remaining).toHaveLength(250); // Half remain (active)
      expect(remaining.every(t => t.status === 'active')).toBe(true);

      shortTtlTracker.destroy();
    }, 10000);
  });

  describe('destroy', () => {
    it('should clear the cleanup interval', () => {
      const testTracker = new ThreadTracker();
      expect((testTracker as any).cleanupInterval).toBeDefined();

      testTracker.destroy();
      expect((testTracker as any).cleanupInterval).toBeUndefined();
    });

    it('should be safe to call destroy multiple times', () => {
      const testTracker = new ThreadTracker();
      testTracker.destroy();
      testTracker.destroy();
      expect((testTracker as any).cleanupInterval).toBeUndefined();
    });
  });
});
