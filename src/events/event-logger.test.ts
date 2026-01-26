import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventLogger, EventLoggerOptions } from './event-logger.js';
import { EventBus } from './event-bus.js';
import {
  createEvent,
  AgentSpawnedPayload,
  TaskQueuedPayload,
  SystemErrorPayload,
} from './event-types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs/promises for file operations
vi.mock('fs/promises');

describe('EventLogger', () => {
  let eventBus: EventBus;
  let logger: EventLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus({ logErrors: false });
  });

  afterEach(() => {
    if (logger) {
      logger.disable();
    }
    eventBus.destroy();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      logger = new EventLogger(eventBus);
      expect(logger).toBeDefined();
    });

    it('should accept custom options', () => {
      const options: EventLoggerOptions = {
        maxEvents: 50,
        includeTimestamp: true,
        logToConsole: false,
      };
      logger = new EventLogger(eventBus, options);
      expect(logger).toBeDefined();
    });

    it('should not auto-enable by default', () => {
      logger = new EventLogger(eventBus);

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(logger.getEvents()).toHaveLength(0);
    });

    it('should auto-enable if autoEnable option is true', () => {
      logger = new EventLogger(eventBus, { autoEnable: true });

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(logger.getEvents()).toHaveLength(1);
    });
  });

  describe('enable()', () => {
    it('should start capturing events when enabled', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(logger.getEvents()).toHaveLength(1);
    });

    it('should capture multiple event types', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

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

      expect(logger.getEvents()).toHaveLength(2);
    });

    it('should return this for chaining', () => {
      logger = new EventLogger(eventBus);
      const result = logger.enable();
      expect(result).toBe(logger);
    });
  });

  describe('disable()', () => {
    it('should stop capturing events when disabled', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));
      expect(logger.getEvents()).toHaveLength(1);

      logger.disable();

      eventBus.emit(createEvent('agent:spawned', payload));
      expect(logger.getEvents()).toHaveLength(1);
    });

    it('should return this for chaining', () => {
      logger = new EventLogger(eventBus);
      logger.enable();
      const result = logger.disable();
      expect(result).toBe(logger);
    });
  });

  describe('getEvents()', () => {
    it('should return empty array when no events logged', () => {
      logger = new EventLogger(eventBus);
      expect(logger.getEvents()).toEqual([]);
    });

    it('should return all logged events', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));
      eventBus.emit(createEvent('agent:spawned', payload));

      const events = logger.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('agent:spawned');
    });

    it('should filter by event type', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

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

      const events = logger.getEvents({ types: ['agent:spawned'] });
      expect(events).toHaveLength(2);
    });

    it('should filter by correlationId', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload, 'corr-1'));
      eventBus.emit(createEvent('agent:spawned', payload, 'corr-2'));
      eventBus.emit(createEvent('agent:spawned', payload, 'corr-1'));

      const events = logger.getEvents({ correlationId: 'corr-1' });
      expect(events).toHaveLength(2);
    });

    it('should filter by limit', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      for (let i = 0; i < 10; i++) {
        eventBus.emit(createEvent('agent:spawned', payload));
      }

      const events = logger.getEvents({ limit: 5 });
      expect(events).toHaveLength(5);
    });

    it('should respect maxEvents configuration', () => {
      logger = new EventLogger(eventBus, { maxEvents: 3 });
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      for (let i = 0; i < 5; i++) {
        eventBus.emit(
          createEvent('agent:spawned', { ...payload, agentId: `agent-${i}` })
        );
      }

      const events = logger.getEvents();
      expect(events).toHaveLength(3);
      // Should keep most recent
      expect((events[0].payload as AgentSpawnedPayload).agentId).toBe('agent-2');
    });
  });

  describe('clearEvents()', () => {
    it('should clear all logged events', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(logger.getEvents()).toHaveLength(2);

      logger.clearEvents();

      expect(logger.getEvents()).toHaveLength(0);
    });

    it('should return this for chaining', () => {
      logger = new EventLogger(eventBus);
      const result = logger.clearEvents();
      expect(result).toBe(logger);
    });
  });

  describe('exportToFile()', () => {
    it('should export events to a JSON file', async () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const filePath = '/tmp/events.json';
      await logger.exportToFile(filePath);

      expect(fs.writeFile).toHaveBeenCalledWith(
        filePath,
        expect.stringContaining('"agent:spawned"'),
        'utf-8'
      );
    });

    it('should create directory if it does not exist', async () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const filePath = '/tmp/logs/events.json';
      await logger.exportToFile(filePath);

      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(filePath), {
        recursive: true,
      });
    });

    it('should export with pretty format when specified', async () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const filePath = '/tmp/events.json';
      await logger.exportToFile(filePath, { pretty: true });

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const content = writeCall[1] as string;
      expect(content).toContain('\n'); // Pretty format has newlines
    });

    it('should filter events during export', async () => {
      logger = new EventLogger(eventBus);
      logger.enable();

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

      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const filePath = '/tmp/events.json';
      await logger.exportToFile(filePath, {
        filter: { types: ['agent:spawned'] },
      });

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const content = writeCall[1] as string;
      expect(content).toContain('agent:spawned');
      expect(content).not.toContain('task:queued');
    });
  });

  describe('isEnabled()', () => {
    it('should return false when not enabled', () => {
      logger = new EventLogger(eventBus);
      expect(logger.isEnabled()).toBe(false);
    });

    it('should return true when enabled', () => {
      logger = new EventLogger(eventBus);
      logger.enable();
      expect(logger.isEnabled()).toBe(true);
    });

    it('should return false after disable', () => {
      logger = new EventLogger(eventBus);
      logger.enable();
      logger.disable();
      expect(logger.isEnabled()).toBe(false);
    });
  });

  describe('getEventCount()', () => {
    it('should return 0 when no events', () => {
      logger = new EventLogger(eventBus);
      expect(logger.getEventCount()).toBe(0);
    });

    it('should return correct count of events', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));
      eventBus.emit(createEvent('agent:spawned', payload));
      eventBus.emit(createEvent('agent:spawned', payload));

      expect(logger.getEventCount()).toBe(3);
    });
  });

  describe('getEventsByType()', () => {
    it('should group events by type', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

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

      const byType = logger.getEventsByType();

      expect(byType.get('agent:spawned')).toHaveLength(2);
      expect(byType.get('task:queued')).toHaveLength(1);
    });
  });

  describe('getStats()', () => {
    it('should return statistics about logged events', () => {
      logger = new EventLogger(eventBus);
      logger.enable();

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
      const errorPayload: SystemErrorPayload = {
        error: new Error('test'),
        component: 'test',
        message: 'Test error',
      };

      eventBus.emit(createEvent('agent:spawned', agentPayload));
      eventBus.emit(createEvent('task:queued', taskPayload));
      eventBus.emit(createEvent('agent:spawned', agentPayload));
      eventBus.emit(createEvent('system:error', errorPayload));

      const stats = logger.getStats();

      expect(stats.totalEvents).toBe(4);
      expect(stats.eventsByType['agent:spawned']).toBe(2);
      expect(stats.eventsByType['task:queued']).toBe(1);
      expect(stats.eventsByType['system:error']).toBe(1);
      expect(stats.errorCount).toBe(1);
    });
  });

  describe('logging to console', () => {
    it('should log to console when logToConsole is true', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger = new EventLogger(eventBus, { logToConsole: true });
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not log to console when logToConsole is false', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger = new EventLogger(eventBus, { logToConsole: false });
      logger.enable();

      const payload: AgentSpawnedPayload = {
        agentId: 'agent-1',
        taskId: 'task-1',
        model: 'opus',
        context: [],
      };

      eventBus.emit(createEvent('agent:spawned', payload));

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('type filtering', () => {
    it('should only capture specified event types when filter is set', () => {
      logger = new EventLogger(eventBus, {
        typeFilter: ['agent:spawned', 'agent:completed'],
      });
      logger.enable();

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

      expect(logger.getEvents()).toHaveLength(1);
      expect(logger.getEvents()[0].type).toBe('agent:spawned');
    });
  });
});
