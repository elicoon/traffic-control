import { describe, it, expect, vi } from 'vitest';
import { AgentManager } from './manager.js';

describe('AgentManager', () => {
  it('should create an instance', () => {
    const manager = new AgentManager();
    expect(manager).toBeDefined();
  });

  it('should track active sessions', () => {
    const manager = new AgentManager();
    expect(manager.getActiveSessions()).toEqual([]);
  });

  it('should register event handlers', () => {
    const manager = new AgentManager();
    const handler = vi.fn();

    manager.onEvent('question', handler);
    expect(manager.hasHandler('question')).toBe(true);
  });

  it('should spawn an agent and create a session', async () => {
    const manager = new AgentManager();
    const sessionId = await manager.spawnAgent('task-123', {
      model: 'sonnet',
      projectPath: '/test/path'
    });

    expect(sessionId).toBeDefined();
    const session = manager.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.status).toBe('running');
    expect(session?.taskId).toBe('task-123');
  });

  it('should return undefined for non-existent session', () => {
    const manager = new AgentManager();
    expect(manager.getSession('non-existent')).toBeUndefined();
  });

  it('should throw when injecting message to non-existent session', async () => {
    const manager = new AgentManager();
    await expect(manager.injectMessage('non-existent', 'test')).rejects.toThrow('not found');
  });

  it('should terminate a session and set status to failed', async () => {
    const manager = new AgentManager();
    const sessionId = await manager.spawnAgent('task-123', {
      model: 'sonnet',
      projectPath: '/test/path'
    });

    await manager.terminateSession(sessionId);
    const session = manager.getSession(sessionId);
    expect(session?.status).toBe('failed');
  });
});
