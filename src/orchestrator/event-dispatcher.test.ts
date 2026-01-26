import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EventDispatcher,
  AgentEvent,
  EventHandler,
  EventType,
} from './event-dispatcher.js';

describe('EventDispatcher', () => {
  let dispatcher: EventDispatcher;

  beforeEach(() => {
    dispatcher = new EventDispatcher();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create EventDispatcher with default config', () => {
      expect(dispatcher).toBeDefined();
    });

    it('should create EventDispatcher with custom config', () => {
      const custom = new EventDispatcher({
        maxHistorySize: 100,
        enableLogging: true,
      });
      expect(custom).toBeDefined();
    });
  });

  describe('on', () => {
    it('should register an event handler', () => {
      const handler = vi.fn();
      dispatcher.on('question', handler);

      expect(dispatcher.hasHandlers('question')).toBe(true);
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = dispatcher.on('question', handler);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
      expect(dispatcher.hasHandlers('question')).toBe(false);
    });

    it('should allow multiple handlers for same event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.on('question', handler1);
      dispatcher.on('question', handler2);

      expect(dispatcher.getHandlerCount('question')).toBe(2);
    });
  });

  describe('once', () => {
    it('should register a one-time handler', async () => {
      const handler = vi.fn();
      dispatcher.once('completion', handler);

      const event: AgentEvent = {
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: { summary: 'Done' },
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event);
      await dispatcher.dispatch(event);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispatch', () => {
    it('should call registered handlers with event', async () => {
      const handler = vi.fn();
      dispatcher.on('question', handler);

      const event: AgentEvent = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: { question: 'What should I do?' },
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should call all handlers for event type', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.on('completion', handler1);
      dispatcher.on('completion', handler2);

      const event: AgentEvent = {
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });

    it('should handle async handlers', async () => {
      const results: string[] = [];

      const handler1 = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        results.push('handler1');
      });

      const handler2 = vi.fn(async () => {
        results.push('handler2');
      });

      dispatcher.on('question', handler1);
      dispatcher.on('question', handler2);

      const event: AgentEvent = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event);

      expect(results).toContain('handler1');
      expect(results).toContain('handler2');
    });

    it('should isolate handler errors', async () => {
      const handler1 = vi.fn(() => {
        throw new Error('Handler error');
      });
      const handler2 = vi.fn();

      dispatcher.on('error', handler1);
      dispatcher.on('error', handler2);

      const event: AgentEvent = {
        type: 'error',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: { error: 'Something failed' },
        timestamp: new Date(),
      };

      // Should not throw
      await expect(dispatcher.dispatch(event)).resolves.not.toThrow();

      // Second handler should still be called
      expect(handler2).toHaveBeenCalled();
    });

    it('should add event to history', async () => {
      const event: AgentEvent = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event);

      const history = dispatcher.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]).toEqual(event);
    });

    it('should respect maxHistorySize', async () => {
      const limitedDispatcher = new EventDispatcher({ maxHistorySize: 3 });

      for (let i = 0; i < 5; i++) {
        await limitedDispatcher.dispatch({
          type: 'question',
          agentId: `agent-${i}`,
          taskId: 'task-1',
          payload: {},
          timestamp: new Date(),
        });
      }

      const history = limitedDispatcher.getHistory();
      expect(history.length).toBe(3);
      // Should keep the most recent events
      expect(history[0].agentId).toBe('agent-2');
      expect(history[2].agentId).toBe('agent-4');
    });
  });

  describe('off', () => {
    it('should remove a specific handler', async () => {
      const handler = vi.fn();
      dispatcher.on('question', handler);
      dispatcher.off('question', handler);

      const event: AgentEvent = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should only remove specified handler', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.on('question', handler1);
      dispatcher.on('question', handler2);
      dispatcher.off('question', handler1);

      const event: AgentEvent = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('removeAllHandlers', () => {
    it('should remove all handlers for event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.on('question', handler1);
      dispatcher.on('question', handler2);
      dispatcher.removeAllHandlers('question');

      expect(dispatcher.hasHandlers('question')).toBe(false);
    });

    it('should not affect handlers for other event types', () => {
      const questionHandler = vi.fn();
      const errorHandler = vi.fn();

      dispatcher.on('question', questionHandler);
      dispatcher.on('error', errorHandler);
      dispatcher.removeAllHandlers('question');

      expect(dispatcher.hasHandlers('question')).toBe(false);
      expect(dispatcher.hasHandlers('error')).toBe(true);
    });
  });

  describe('getHistory', () => {
    it('should return all events in history', async () => {
      const event1: AgentEvent = {
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      };

      const event2: AgentEvent = {
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event1);
      await dispatcher.dispatch(event2);

      const history = dispatcher.getHistory();
      expect(history.length).toBe(2);
    });

    it('should filter by event type', async () => {
      await dispatcher.dispatch({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      await dispatcher.dispatch({
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      await dispatcher.dispatch({
        type: 'question',
        agentId: 'agent-2',
        taskId: 'task-2',
        payload: {},
        timestamp: new Date(),
      });

      const questionHistory = dispatcher.getHistory({ type: 'question' });
      expect(questionHistory.length).toBe(2);
    });

    it('should filter by agentId', async () => {
      await dispatcher.dispatch({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      await dispatcher.dispatch({
        type: 'question',
        agentId: 'agent-2',
        taskId: 'task-2',
        payload: {},
        timestamp: new Date(),
      });

      const agent1History = dispatcher.getHistory({ agentId: 'agent-1' });
      expect(agent1History.length).toBe(1);
      expect(agent1History[0].agentId).toBe('agent-1');
    });

    it('should filter by taskId', async () => {
      await dispatcher.dispatch({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      await dispatcher.dispatch({
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      await dispatcher.dispatch({
        type: 'question',
        agentId: 'agent-2',
        taskId: 'task-2',
        payload: {},
        timestamp: new Date(),
      });

      const task1History = dispatcher.getHistory({ taskId: 'task-1' });
      expect(task1History.length).toBe(2);
    });
  });

  describe('clearHistory', () => {
    it('should clear all events from history', async () => {
      await dispatcher.dispatch({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      dispatcher.clearHistory();

      expect(dispatcher.getHistory().length).toBe(0);
    });
  });

  describe('onGlobal', () => {
    it('should receive all events regardless of type', async () => {
      const globalHandler = vi.fn();
      dispatcher.onGlobal(globalHandler);

      await dispatcher.dispatch({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      await dispatcher.dispatch({
        type: 'completion',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      expect(globalHandler).toHaveBeenCalledTimes(2);
    });

    it('should return unsubscribe function', async () => {
      const globalHandler = vi.fn();
      const unsubscribe = dispatcher.onGlobal(globalHandler);

      unsubscribe();

      await dispatcher.dispatch({
        type: 'question',
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      });

      expect(globalHandler).not.toHaveBeenCalled();
    });
  });

  describe('waitFor', () => {
    it('should return promise that resolves when event matches', async () => {
      const waitPromise = dispatcher.waitFor('completion', {
        agentId: 'agent-1',
      });

      // Dispatch after a small delay
      setTimeout(() => {
        dispatcher.dispatch({
          type: 'completion',
          agentId: 'agent-1',
          taskId: 'task-1',
          payload: { result: 'success' },
          timestamp: new Date(),
        });
      }, 10);

      const event = await waitPromise;
      expect(event.agentId).toBe('agent-1');
      expect(event.type).toBe('completion');
    });

    it('should timeout if event not received', async () => {
      const waitPromise = dispatcher.waitFor(
        'completion',
        { agentId: 'non-existent' },
        { timeoutMs: 50 }
      );

      await expect(waitPromise).rejects.toThrow('Timeout waiting for event');
    });
  });

  describe('dispatchBatch', () => {
    it('should dispatch multiple events', async () => {
      const handler = vi.fn();
      dispatcher.on('question', handler);

      const events: AgentEvent[] = [
        {
          type: 'question',
          agentId: 'agent-1',
          taskId: 'task-1',
          payload: {},
          timestamp: new Date(),
        },
        {
          type: 'question',
          agentId: 'agent-2',
          taskId: 'task-2',
          payload: {},
          timestamp: new Date(),
        },
      ];

      await dispatcher.dispatchBatch(events);

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('all event types', () => {
    const eventTypes: EventType[] = [
      'question',
      'completion',
      'error',
      'blocker',
      'subagent_spawn',
    ];

    it.each(eventTypes)('should handle %s event type', async (type) => {
      const handler = vi.fn();
      dispatcher.on(type, handler);

      const event: AgentEvent = {
        type,
        agentId: 'agent-1',
        taskId: 'task-1',
        payload: {},
        timestamp: new Date(),
      };

      await dispatcher.dispatch(event);

      expect(handler).toHaveBeenCalledWith(event);
    });
  });
});
