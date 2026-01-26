import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus, EventBusConfig } from './event-bus.js';
import {
  EventType,
  TypedEvent,
  AgentSpawnedPayload,
  AgentQuestionPayload,
  TaskQueuedPayload,
  SystemErrorPayload,
  createEvent,
} from './event-types.js';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    vi.clearAllMocks();
  });

  afterEach(() => {
    eventBus.destroy();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const bus = new EventBus();
      expect(bus).toBeDefined();
      bus.destroy();
    });

    it('should accept custom config', () => {
      const config: EventBusConfig = {
        historySize: 50,
        logErrors: false,
      };
      const bus = new EventBus(config);
      expect(bus).toBeDefined();
      bus.destroy();
    });
  });

  describe('on()', () => {
    it('should register a handler for an event type', () => {
      const handler = vi.fn();
      eventBus.on('agent:spawned', handler);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:spawned',
          payload,
        })
      );
    });

    it('should return an unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.on('agent:spawned', handler);

      unsubscribe();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should allow multiple handlers for the same event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('agent:spawned', handler1);
      eventBus.on('agent:spawned', handler2);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should not call handlers for different event types', () => {
      const handler = vi.fn();
      eventBus.on('agent:spawned', handler);

      const payload: TaskQueuedPayload = {
        taskId: 'task-1',
        projectId: 'project-1',
        priority: 50,
        title: 'Test task',
      };
      eventBus.emit(createEvent('task:queued', payload));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once()', () => {
    it('should register a handler that only fires once', () => {
      const handler = vi.fn();
      eventBus.once('agent:spawned', handler);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should return an unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.once('agent:spawned', handler);

      unsubscribe();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('emit()', () => {
    it('should emit events to all registered handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('agent:spawned', handler1);
      eventBus.on('agent:spawned', handler2);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: ['ctx-1'],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should include timestamp in event', () => {
      const handler = vi.fn();
      eventBus.on('agent:spawned', handler);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      const beforeEmit = new Date();
      eventBus.emit(createEvent('agent:spawned', payload));
      const afterEmit = new Date();

      const calledEvent = handler.mock.calls[0][0] as TypedEvent<
        'agent:spawned',
        AgentSpawnedPayload
      >;
      expect(calledEvent.timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeEmit.getTime()
      );
      expect(calledEvent.timestamp.getTime()).toBeLessThanOrEqual(
        afterEmit.getTime()
      );
    });

    it('should pass correlationId in event', () => {
      const handler = vi.fn();
      eventBus.on('agent:spawned', handler);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload, 'corr-123'));

      const calledEvent = handler.mock.calls[0][0];
      expect(calledEvent.correlationId).toBe('corr-123');
    });
  });

  describe('error isolation', () => {
    it('should not break other handlers when one throws', () => {
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const successHandler = vi.fn();

      eventBus.on('agent:spawned', errorHandler);
      eventBus.on('agent:spawned', successHandler);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      // Should not throw
      expect(() =>
        eventBus.emit(createEvent('agent:spawned', payload))
      ).not.toThrow();

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit error event when handler throws', () => {
      const errorEventHandler = vi.fn();
      eventBus.on('system:error', errorEventHandler);

      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      eventBus.on('agent:spawned', errorHandler);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(errorEventHandler).toHaveBeenCalledTimes(1);
      const errorEvent = errorEventHandler.mock.calls[0][0];
      expect(errorEvent.type).toBe('system:error');
      expect(errorEvent.payload.component).toBe('event-bus');
    });
  });

  describe('async handler support', () => {
    it('should support async handlers', async () => {
      const asyncHandler = vi.fn().mockResolvedValue(undefined);
      eventBus.on('agent:spawned', asyncHandler);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      // Wait for async handlers to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(asyncHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle async handler errors', async () => {
      const errorEventHandler = vi.fn();
      eventBus.on('system:error', errorEventHandler);

      const asyncErrorHandler = vi
        .fn()
        .mockRejectedValue(new Error('Async error'));
      eventBus.on('agent:spawned', asyncErrorHandler);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      // Wait for async handlers to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errorEventHandler).toHaveBeenCalled();
    });
  });

  describe('onPattern()', () => {
    it('should match events by pattern', () => {
      const handler = vi.fn();
      eventBus.onPattern(/^agent:/, handler);

      const spawnedPayload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      const questionPayload: AgentQuestionPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        question: 'Test?',
      };
      const taskPayload: TaskQueuedPayload = {
        taskId: 'task-1',
        projectId: 'project-1',
        priority: 50,
        title: 'Test',
      };

      eventBus.emit(createEvent('agent:spawned', spawnedPayload));
      eventBus.emit(createEvent('agent:question', questionPayload));
      eventBus.emit(createEvent('task:queued', taskPayload));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should return an unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.onPattern(/^agent:/, handler);

      unsubscribe();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should match all events with wildcard pattern', () => {
      const handler = vi.fn();
      eventBus.onPattern(/.*/, handler);

      const agentPayload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      const taskPayload: TaskQueuedPayload = {
        taskId: 'task-1',
        projectId: 'project-1',
        priority: 50,
        title: 'Test',
      };

      eventBus.emit(createEvent('agent:spawned', agentPayload));
      eventBus.emit(createEvent('task:queued', taskPayload));

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('getHistory()', () => {
    it('should return empty array when no events emitted', () => {
      expect(eventBus.getHistory()).toEqual([]);
    });

    it('should return emitted events', () => {
      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      const history = eventBus.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe('agent:spawned');
    });

    it('should respect history size limit', () => {
      const bus = new EventBus({ historySize: 3 });

      for (let i = 0; i < 5; i++) {
        const payload: AgentSpawnedPayload = {
          agentId: `agent-${i}`,
          taskId: `task-${i}`,
          model: 'opus',
          context: [],
        };
        bus.emit(createEvent('agent:spawned', payload));
      }

      const history = bus.getHistory();
      expect(history).toHaveLength(3);
      // Should keep most recent
      expect((history[0].payload as AgentSpawnedPayload).agentId).toBe(
        'agent-2'
      );
      expect((history[2].payload as AgentSpawnedPayload).agentId).toBe(
        'agent-4'
      );

      bus.destroy();
    });

    it('should filter by event type', () => {
      const agentPayload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      const taskPayload: TaskQueuedPayload = {
        taskId: 'task-1',
        projectId: 'project-1',
        priority: 50,
        title: 'Test',
      };

      eventBus.emit(createEvent('agent:spawned', agentPayload));
      eventBus.emit(createEvent('task:queued', taskPayload));
      eventBus.emit(createEvent('agent:spawned', agentPayload));

      const history = eventBus.getHistory({ types: ['agent:spawned'] });
      expect(history).toHaveLength(2);
      expect(history.every((e) => e.type === 'agent:spawned')).toBe(true);
    });

    it('should filter by correlationId', () => {
      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload, 'corr-1'));
      eventBus.emit(createEvent('agent:spawned', payload, 'corr-2'));
      eventBus.emit(createEvent('agent:spawned', payload, 'corr-1'));

      const history = eventBus.getHistory({ correlationId: 'corr-1' });
      expect(history).toHaveLength(2);
      expect(history.every((e) => e.correlationId === 'corr-1')).toBe(true);
    });

    it('should filter by time range', async () => {
      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      // Emit first event before time range
      eventBus.emit(createEvent('agent:spawned', payload));
      await new Promise((resolve) => setTimeout(resolve, 20));

      const startTime = new Date();
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Emit second event within time range
      eventBus.emit(createEvent('agent:spawned', payload));

      await new Promise((resolve) => setTimeout(resolve, 20));
      const endTime = new Date();
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Emit third event after time range
      eventBus.emit(createEvent('agent:spawned', payload));

      const history = eventBus.getHistory({ startTime, endTime });
      expect(history).toHaveLength(1);
    });

    it('should filter by limit', () => {
      for (let i = 0; i < 10; i++) {
        const payload: AgentSpawnedPayload = {
          agentId: `agent-${i}`,
          taskId: `task-${i}`,
          model: 'opus',
          context: [],
        };
        eventBus.emit(createEvent('agent:spawned', payload));
      }

      const history = eventBus.getHistory({ limit: 5 });
      expect(history).toHaveLength(5);
    });
  });

  describe('clearHistory()', () => {
    it('should clear all event history', () => {
      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(eventBus.getHistory()).toHaveLength(2);

      eventBus.clearHistory();

      expect(eventBus.getHistory()).toHaveLength(0);
    });
  });

  describe('off()', () => {
    it('should remove a specific handler', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('agent:spawned', handler1);
      eventBus.on('agent:spawned', handler2);

      eventBus.off('agent:spawned', handler1);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeAllListeners()', () => {
    it('should remove all handlers for a specific event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      eventBus.on('agent:spawned', handler1);
      eventBus.on('agent:spawned', handler2);
      eventBus.on('task:queued', handler3);

      eventBus.removeAllListeners('agent:spawned');

      const agentPayload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      const taskPayload: TaskQueuedPayload = {
        taskId: 'task-1',
        projectId: 'project-1',
        priority: 50,
        title: 'Test',
      };

      eventBus.emit(createEvent('agent:spawned', agentPayload));
      eventBus.emit(createEvent('task:queued', taskPayload));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(handler3).toHaveBeenCalledTimes(1);
    });

    it('should remove all handlers when no type specified', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('agent:spawned', handler1);
      eventBus.on('task:queued', handler2);

      eventBus.removeAllListeners();

      const agentPayload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      const taskPayload: TaskQueuedPayload = {
        taskId: 'task-1',
        projectId: 'project-1',
        priority: 50,
        title: 'Test',
      };

      eventBus.emit(createEvent('agent:spawned', agentPayload));
      eventBus.emit(createEvent('task:queued', taskPayload));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount()', () => {
    it('should return the number of listeners for a type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      expect(eventBus.listenerCount('agent:spawned')).toBe(0);

      eventBus.on('agent:spawned', handler1);
      expect(eventBus.listenerCount('agent:spawned')).toBe(1);

      eventBus.on('agent:spawned', handler2);
      expect(eventBus.listenerCount('agent:spawned')).toBe(2);
    });
  });

  describe('destroy()', () => {
    it('should remove all listeners and clear history', () => {
      const handler = vi.fn();
      eventBus.on('agent:spawned', handler);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      eventBus.destroy();

      expect(eventBus.getHistory()).toHaveLength(0);
      expect(eventBus.listenerCount('agent:spawned')).toBe(0);
    });
  });

  describe('waitFor()', () => {
    it('should return a promise that resolves when event is emitted', async () => {
      const promise = eventBus.waitFor('agent:spawned');

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      setTimeout(() => {
        eventBus.emit(createEvent('agent:spawned', payload));
      }, 10);

      const event = await promise;
      expect(event.type).toBe('agent:spawned');
      expect(event.payload.agentId).toBe('agent-1');
    });

    it('should timeout if event is not emitted', async () => {
      const promise = eventBus.waitFor('agent:spawned', 50);

      await expect(promise).rejects.toThrow('Timeout waiting for agent:spawned');
    });

    it('should cancel timeout when event is received', async () => {
      const promise = eventBus.waitFor('agent:spawned', 1000);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      setTimeout(() => {
        eventBus.emit(createEvent('agent:spawned', payload));
      }, 10);

      const event = await promise;
      expect(event.type).toBe('agent:spawned');
    });
  });
});
