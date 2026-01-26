import { describe, it, expect } from 'vitest';
import {
  EventType,
  TypedEvent,
  createEvent,
  isEventType,
  EventPayloads,
  AgentSpawnedPayload,
  AgentQuestionPayload,
  AgentBlockedPayload,
  AgentCompletedPayload,
  AgentFailedPayload,
  TaskQueuedPayload,
  TaskAssignedPayload,
  TaskCompletedPayload,
  CapacityAvailablePayload,
  CapacityExhaustedPayload,
  LearningExtractedPayload,
  RetrospectiveTriggeredPayload,
  SlackMessageReceivedPayload,
  SlackResponseSentPayload,
  SystemStartedPayload,
  SystemStoppedPayload,
  SystemErrorPayload,
} from './event-types.js';

describe('EventType', () => {
  it('should include all agent event types', () => {
    const agentTypes: EventType[] = [
      'agent:spawned',
      'agent:question',
      'agent:blocked',
      'agent:completed',
      'agent:failed',
    ];
    agentTypes.forEach((type) => {
      expect(isEventType(type)).toBe(true);
    });
  });

  it('should include all task event types', () => {
    const taskTypes: EventType[] = [
      'task:queued',
      'task:assigned',
      'task:completed',
    ];
    taskTypes.forEach((type) => {
      expect(isEventType(type)).toBe(true);
    });
  });

  it('should include all capacity event types', () => {
    const capacityTypes: EventType[] = [
      'capacity:available',
      'capacity:exhausted',
    ];
    capacityTypes.forEach((type) => {
      expect(isEventType(type)).toBe(true);
    });
  });

  it('should include learning and retrospective event types', () => {
    const learningTypes: EventType[] = [
      'learning:extracted',
      'retrospective:triggered',
    ];
    learningTypes.forEach((type) => {
      expect(isEventType(type)).toBe(true);
    });
  });

  it('should include slack event types', () => {
    const slackTypes: EventType[] = [
      'slack:message_received',
      'slack:response_sent',
    ];
    slackTypes.forEach((type) => {
      expect(isEventType(type)).toBe(true);
    });
  });

  it('should include system event types', () => {
    const systemTypes: EventType[] = [
      'system:started',
      'system:stopped',
      'system:error',
    ];
    systemTypes.forEach((type) => {
      expect(isEventType(type)).toBe(true);
    });
  });

  it('should return false for invalid event types', () => {
    expect(isEventType('invalid:type')).toBe(false);
    expect(isEventType('')).toBe(false);
    expect(isEventType('agent')).toBe(false);
  });
});

describe('TypedEvent', () => {
  it('should have correct structure with all required fields', () => {
    const event: TypedEvent<'agent:spawned', AgentSpawnedPayload> = {
      type: 'agent:spawned',
      payload: {
        agentId: 'agent-123',
        taskId: 'task-456',
        model: 'opus',
        context: ['learning-1', 'learning-2'],
      },
      timestamp: new Date(),
    };

    expect(event.type).toBe('agent:spawned');
    expect(event.payload.agentId).toBe('agent-123');
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(event.correlationId).toBeUndefined();
  });

  it('should support optional correlationId', () => {
    const event: TypedEvent<'agent:spawned', AgentSpawnedPayload> = {
      type: 'agent:spawned',
      payload: {
        agentId: 'agent-123',
        taskId: 'task-456',
        model: 'opus',
        context: [],
      },
      timestamp: new Date(),
      correlationId: 'correlation-789',
    };

    expect(event.correlationId).toBe('correlation-789');
  });
});

describe('createEvent', () => {
  it('should create an agent:spawned event with timestamp', () => {
    const payload: AgentSpawnedPayload = {
      agentId: 'agent-123',
      taskId: 'task-456',
      model: 'opus',
      context: ['context-1'],
    };

    const event = createEvent('agent:spawned', payload);

    expect(event.type).toBe('agent:spawned');
    expect(event.payload).toEqual(payload);
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(event.correlationId).toBeUndefined();
  });

  it('should create an event with correlationId', () => {
    const payload: AgentQuestionPayload = {
      agentId: 'agent-123',
      taskId: 'task-456',
      question: 'What is the meaning of life?',
    };

    const event = createEvent('agent:question', payload, 'corr-123');

    expect(event.type).toBe('agent:question');
    expect(event.correlationId).toBe('corr-123');
  });

  it('should create task:queued event', () => {
    const payload: TaskQueuedPayload = {
      taskId: 'task-123',
      projectId: 'project-456',
      priority: 50,
      title: 'Test task',
    };

    const event = createEvent('task:queued', payload);

    expect(event.type).toBe('task:queued');
    expect(event.payload.taskId).toBe('task-123');
  });

  it('should create capacity:available event', () => {
    const payload: CapacityAvailablePayload = {
      model: 'opus',
      availableSlots: 3,
      totalSlots: 5,
    };

    const event = createEvent('capacity:available', payload);

    expect(event.type).toBe('capacity:available');
    expect(event.payload.model).toBe('opus');
    expect(event.payload.availableSlots).toBe(3);
  });

  it('should create system:error event', () => {
    const payload: SystemErrorPayload = {
      error: new Error('Something went wrong'),
      component: 'scheduler',
      message: 'Failed to schedule task',
    };

    const event = createEvent('system:error', payload);

    expect(event.type).toBe('system:error');
    expect(event.payload.component).toBe('scheduler');
    expect(event.payload.error).toBeInstanceOf(Error);
  });
});

describe('Payload Types', () => {
  it('should have correct AgentSpawnedPayload structure', () => {
    const payload: AgentSpawnedPayload = {
      agentId: 'agent-1',
      taskId: 'task-1',
      model: 'sonnet',
      context: ['ctx-1', 'ctx-2'],
    };

    expect(payload.model).toBe('sonnet');
    expect(payload.context).toHaveLength(2);
  });

  it('should have correct AgentQuestionPayload structure', () => {
    const payload: AgentQuestionPayload = {
      agentId: 'agent-1',
      taskId: 'task-1',
      question: 'Test question',
      threadTs: 'ts-123',
    };

    expect(payload.question).toBe('Test question');
    expect(payload.threadTs).toBe('ts-123');
  });

  it('should have correct AgentBlockedPayload structure', () => {
    const payload: AgentBlockedPayload = {
      agentId: 'agent-1',
      taskId: 'task-1',
      reason: 'Missing permissions',
      blockerType: 'external',
    };

    expect(payload.reason).toBe('Missing permissions');
    expect(payload.blockerType).toBe('external');
  });

  it('should have correct AgentCompletedPayload structure', () => {
    const payload: AgentCompletedPayload = {
      agentId: 'agent-1',
      taskId: 'task-1',
      summary: 'Task completed successfully',
      tokensUsed: 5000,
      durationMs: 120000,
    };

    expect(payload.tokensUsed).toBe(5000);
    expect(payload.durationMs).toBe(120000);
  });

  it('should have correct AgentFailedPayload structure', () => {
    const payload: AgentFailedPayload = {
      agentId: 'agent-1',
      taskId: 'task-1',
      error: new Error('Connection timeout'),
      retryable: true,
    };

    expect(payload.retryable).toBe(true);
    expect(payload.error).toBeInstanceOf(Error);
  });

  it('should have correct TaskAssignedPayload structure', () => {
    const payload: TaskAssignedPayload = {
      taskId: 'task-1',
      agentId: 'agent-1',
      projectId: 'project-1',
      model: 'opus',
    };

    expect(payload.model).toBe('opus');
    expect(payload.agentId).toBe('agent-1');
  });

  it('should have correct TaskCompletedPayload structure', () => {
    const payload: TaskCompletedPayload = {
      taskId: 'task-1',
      agentId: 'agent-1',
      success: true,
      summary: 'All done',
    };

    expect(payload.success).toBe(true);
    expect(payload.summary).toBe('All done');
  });

  it('should have correct CapacityExhaustedPayload structure', () => {
    const payload: CapacityExhaustedPayload = {
      model: 'opus',
      queuedTasks: 10,
      estimatedWaitMs: 300000,
    };

    expect(payload.queuedTasks).toBe(10);
    expect(payload.estimatedWaitMs).toBe(300000);
  });

  it('should have correct LearningExtractedPayload structure', () => {
    const payload: LearningExtractedPayload = {
      learningId: 'learning-1',
      taskId: 'task-1',
      category: 'debugging',
      content: 'Always check logs first',
    };

    expect(payload.category).toBe('debugging');
    expect(payload.content).toBe('Always check logs first');
  });

  it('should have correct RetrospectiveTriggeredPayload structure', () => {
    const payload: RetrospectiveTriggeredPayload = {
      retrospectiveId: 'retro-1',
      taskId: 'task-1',
      trigger: 'failure',
    };

    expect(payload.trigger).toBe('failure');
  });

  it('should have correct SlackMessageReceivedPayload structure', () => {
    const payload: SlackMessageReceivedPayload = {
      threadTs: 'ts-123',
      userId: 'U123',
      text: 'Hello world',
      channel: 'C456',
    };

    expect(payload.userId).toBe('U123');
    expect(payload.channel).toBe('C456');
  });

  it('should have correct SlackResponseSentPayload structure', () => {
    const payload: SlackResponseSentPayload = {
      threadTs: 'ts-123',
      taskId: 'task-1',
      responseType: 'question',
    };

    expect(payload.responseType).toBe('question');
  });

  it('should have correct SystemStartedPayload structure', () => {
    const payload: SystemStartedPayload = {
      version: '1.0.0',
      config: { maxAgents: 5 },
    };

    expect(payload.version).toBe('1.0.0');
    expect(payload.config.maxAgents).toBe(5);
  });

  it('should have correct SystemStoppedPayload structure', () => {
    const payload: SystemStoppedPayload = {
      reason: 'manual',
      activeAgentsCount: 2,
    };

    expect(payload.reason).toBe('manual');
    expect(payload.activeAgentsCount).toBe(2);
  });
});

describe('EventPayloads type mapping', () => {
  it('should correctly map event types to payloads', () => {
    // This is a compile-time check primarily, but we can verify at runtime too
    const payloadMap: Partial<EventPayloads> = {
      'agent:spawned': {
        agentId: 'a1',
        taskId: 't1',
        model: 'haiku',
        context: [],
      },
      'system:error': {
        error: new Error('test'),
        component: 'test',
        message: 'test message',
      },
    };

    expect(payloadMap['agent:spawned']?.agentId).toBe('a1');
    expect(payloadMap['system:error']?.component).toBe('test');
  });
});
