/**
 * Events Module
 *
 * Central pub/sub event system for TrafficControl inter-module communication.
 *
 * @module events
 *
 * @example
 * ```typescript
 * import {
 *   EventBus,
 *   EventLogger,
 *   createEvent,
 *   EventType,
 *   TypedEvent
 * } from './events/index.js';
 *
 * // Create event bus
 * const eventBus = new EventBus({ historySize: 100 });
 *
 * // Subscribe to events
 * eventBus.on('agent:spawned', (event) => {
 *   console.log(`Agent ${event.payload.agentId} spawned`);
 * });
 *
 * // Subscribe to pattern
 * eventBus.onPattern(/^agent:/, (event) => {
 *   console.log(`Agent event: ${event.type}`);
 * });
 *
 * // Emit events
 * eventBus.emit(createEvent('agent:spawned', {
 *   agentId: 'agent-123',
 *   taskId: 'task-456',
 *   model: 'opus',
 *   context: ['learning-1']
 * }));
 *
 * // Create logger for debugging
 * const logger = new EventLogger(eventBus, {
 *   maxEvents: 1000,
 *   logToConsole: true
 * });
 * logger.enable();
 *
 * // Export events to file
 * await logger.exportToFile('./events.json', { pretty: true });
 * ```
 */

// Event Types
export {
  // Core types
  EventType,
  TypedEvent,
  EventHandler,
  GenericEventHandler,
  EventFilter,
  PayloadFor,
  EventPayloads,
  ModelType,

  // Payload types
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
  BacklogValidationCompletePayload,

  // Utilities
  createEvent,
  isEventType,
} from './event-types.js';

// Event Bus
export {
  EventBus,
  EventBusConfig,
  getDefaultEventBus,
  resetDefaultEventBus,
} from './event-bus.js';

// Event Logger
export {
  EventLogger,
  EventLoggerOptions,
  ExportOptions,
  EventStats,
  createConsoleLogger,
  createDebugLogger,
} from './event-logger.js';
