/**
 * Event Bus Type Definitions
 *
 * Defines all event types, payloads, and type utilities for the
 * TrafficControl event bus system.
 */

// ============================================================================
// Event Types
// ============================================================================

/**
 * All possible event types in the TrafficControl system
 */
export type EventType =
  // Agent events
  | 'agent:spawned'
  | 'agent:question'
  | 'agent:blocked'
  | 'agent:completed'
  | 'agent:failed'
  // Task events
  | 'task:queued'
  | 'task:assigned'
  | 'task:completed'
  // Capacity events
  | 'capacity:available'
  | 'capacity:exhausted'
  // Learning events
  | 'learning:extracted'
  | 'retrospective:triggered'
  // Slack events
  | 'slack:message_received'
  | 'slack:response_sent'
  // System events
  | 'system:started'
  | 'system:stopped'
  | 'system:error'
  // Database events
  | 'database:healthy'
  | 'database:degraded'
  | 'database:recovered'
  // Backlog events
  | 'backlog:validation:complete';

/**
 * Set of all valid event types for runtime validation
 */
const ALL_EVENT_TYPES: Set<string> = new Set([
  'agent:spawned',
  'agent:question',
  'agent:blocked',
  'agent:completed',
  'agent:failed',
  'task:queued',
  'task:assigned',
  'task:completed',
  'capacity:available',
  'capacity:exhausted',
  'learning:extracted',
  'retrospective:triggered',
  'slack:message_received',
  'slack:response_sent',
  'system:started',
  'system:stopped',
  'system:error',
  'database:healthy',
  'database:degraded',
  'database:recovered',
  'backlog:validation:complete',
]);

/**
 * Type guard to check if a string is a valid EventType
 */
export function isEventType(type: string): type is EventType {
  return ALL_EVENT_TYPES.has(type);
}

// ============================================================================
// Payload Types
// ============================================================================

export type ModelType = 'opus' | 'sonnet' | 'haiku';

/**
 * Payload for agent:spawned event
 */
export interface AgentSpawnedPayload {
  agentId: string;
  taskId: string;
  model: ModelType;
  context: string[];
}

/**
 * Payload for agent:question event
 */
export interface AgentQuestionPayload {
  agentId: string;
  taskId: string;
  question: string;
  threadTs?: string;
}

/**
 * Payload for agent:blocked event
 */
export interface AgentBlockedPayload {
  agentId: string;
  taskId: string;
  reason: string;
  blockerType?: 'external' | 'internal' | 'dependency';
}

/**
 * Payload for agent:completed event
 */
export interface AgentCompletedPayload {
  agentId: string;
  taskId: string;
  summary: string;
  tokensUsed?: number;
  durationMs?: number;
}

/**
 * Payload for agent:failed event
 */
export interface AgentFailedPayload {
  agentId: string;
  taskId: string;
  error: Error;
  retryable: boolean;
}

/**
 * Payload for task:queued event
 */
export interface TaskQueuedPayload {
  taskId: string;
  projectId: string;
  priority: number;
  title: string;
}

/**
 * Payload for task:assigned event
 */
export interface TaskAssignedPayload {
  taskId: string;
  agentId: string;
  projectId: string;
  model: ModelType;
}

/**
 * Payload for task:completed event
 */
export interface TaskCompletedPayload {
  taskId: string;
  agentId?: string;
  success: boolean;
  summary?: string;
}

/**
 * Payload for capacity:available event
 */
export interface CapacityAvailablePayload {
  model: ModelType;
  availableSlots: number;
  totalSlots: number;
}

/**
 * Payload for capacity:exhausted event
 */
export interface CapacityExhaustedPayload {
  model: ModelType;
  queuedTasks: number;
  estimatedWaitMs?: number;
}

/**
 * Payload for learning:extracted event
 */
export interface LearningExtractedPayload {
  learningId: string;
  taskId: string;
  category: string;
  content: string;
}

/**
 * Payload for retrospective:triggered event
 */
export interface RetrospectiveTriggeredPayload {
  retrospectiveId: string;
  taskId: string;
  trigger: 'failure' | 'success' | 'manual';
}

/**
 * Payload for slack:message_received event
 */
export interface SlackMessageReceivedPayload {
  threadTs: string;
  userId: string;
  text: string;
  channel: string;
}

/**
 * Payload for slack:response_sent event
 */
export interface SlackResponseSentPayload {
  threadTs: string;
  taskId?: string;
  responseType: 'question' | 'blocker' | 'completion' | 'review';
}

/**
 * Payload for system:started event
 */
export interface SystemStartedPayload {
  version: string;
  config: Record<string, unknown>;
}

/**
 * Payload for system:stopped event
 */
export interface SystemStoppedPayload {
  reason: 'manual' | 'error' | 'shutdown';
  activeAgentsCount: number;
}

/**
 * Payload for system:error event
 */
export interface SystemErrorPayload {
  error: Error;
  component: string;
  message: string;
}

/**
 * Payload for database:healthy event
 */
export interface DatabaseHealthyPayload {
  latencyMs: number;
}

/**
 * Payload for database:degraded event
 */
export interface DatabaseDegradedPayload {
  error: string;
  lastHealthyAt?: Date;
  retryCount: number;
}

/**
 * Payload for database:recovered event
 */
export interface DatabaseRecoveredPayload {
  latencyMs: number;
  downtimeMs: number;
}

/**
 * Payload for backlog:validation:complete event
 */
export interface BacklogValidationCompletePayload {
  issues: Array<{
    taskId: string;
    taskTitle: string;
    rule: string;
    severity: 'warning' | 'error';
    message: string;
  }>;
  checkedAt: string;
  taskCount: number;
  errorCount: number;
  warningCount: number;
}

// ============================================================================
// Event Payload Mapping
// ============================================================================

/**
 * Maps event types to their corresponding payload types
 */
export interface EventPayloads {
  'agent:spawned': AgentSpawnedPayload;
  'agent:question': AgentQuestionPayload;
  'agent:blocked': AgentBlockedPayload;
  'agent:completed': AgentCompletedPayload;
  'agent:failed': AgentFailedPayload;
  'task:queued': TaskQueuedPayload;
  'task:assigned': TaskAssignedPayload;
  'task:completed': TaskCompletedPayload;
  'capacity:available': CapacityAvailablePayload;
  'capacity:exhausted': CapacityExhaustedPayload;
  'learning:extracted': LearningExtractedPayload;
  'retrospective:triggered': RetrospectiveTriggeredPayload;
  'slack:message_received': SlackMessageReceivedPayload;
  'slack:response_sent': SlackResponseSentPayload;
  'system:started': SystemStartedPayload;
  'system:stopped': SystemStoppedPayload;
  'system:error': SystemErrorPayload;
  'database:healthy': DatabaseHealthyPayload;
  'database:degraded': DatabaseDegradedPayload;
  'database:recovered': DatabaseRecoveredPayload;
  'backlog:validation:complete': BacklogValidationCompletePayload;
}

/**
 * Helper type to get payload type for a specific event type
 */
export type PayloadFor<T extends EventType> = T extends keyof EventPayloads
  ? EventPayloads[T]
  : unknown;

// ============================================================================
// TypedEvent Interface
// ============================================================================

/**
 * A typed event with proper type inference for payload
 */
export interface TypedEvent<T extends EventType, P = PayloadFor<T>> {
  type: T;
  payload: P;
  timestamp: Date;
  correlationId?: string;
}

// ============================================================================
// Event Factory
// ============================================================================

/**
 * Creates a typed event with automatic timestamp
 *
 * @param type - The event type
 * @param payload - The event payload
 * @param correlationId - Optional correlation ID for tracing
 * @returns A fully typed event
 */
export function createEvent<T extends EventType>(
  type: T,
  payload: PayloadFor<T>,
  correlationId?: string
): TypedEvent<T, PayloadFor<T>> {
  return {
    type,
    payload,
    timestamp: new Date(),
    correlationId,
  };
}

// ============================================================================
// Event Handler Types
// ============================================================================

/**
 * Type for event handlers
 */
export type EventHandler<T extends EventType> = (
  event: TypedEvent<T, PayloadFor<T>>
) => void | Promise<void>;

/**
 * Type for generic event handlers (used for pattern matching)
 */
export type GenericEventHandler = (
  event: TypedEvent<EventType, unknown>
) => void | Promise<void>;

/**
 * Filter options for querying event history
 */
export interface EventFilter {
  types?: EventType[];
  correlationId?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}
