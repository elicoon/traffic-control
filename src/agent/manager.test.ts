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
});
