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
});
