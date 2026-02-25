/**
 * EventBus - Central pub/sub system for TrafficControl
 *
 * Provides type-safe event emission and subscription with:
 * - Full TypeScript generics
 * - Error isolation between handlers
 * - Async handler support
 * - Event history for debugging
 * - Pattern matching subscriptions
 * - Correlation ID support for tracing
 */

import {
  EventType,
  TypedEvent,
  EventHandler,
  EventFilter,
  PayloadFor,
  SystemErrorPayload,
  createEvent,
} from './event-types.js';
import { logger } from '../logging/index.js';

// Create component logger for EventBus
const log = logger.child('EventBus');

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration options for the EventBus
 */
export interface EventBusConfig {
  /** Maximum number of events to keep in history (default: 100) */
  historySize?: number;
  /** Whether to log errors to console (default: true) */
  logErrors?: boolean;
}

const DEFAULT_CONFIG: Required<EventBusConfig> = {
  historySize: 100,
  logErrors: true,
};

// ============================================================================
// Internal Types
// ============================================================================

interface PatternHandler {
  pattern: RegExp;
  handler: (event: TypedEvent<EventType, unknown>) => void | Promise<void>;
}

/**
 * Fixed-capacity circular buffer with O(1) push and O(n) toArray.
 * Replaces the previous array + shift() approach which was O(n) per push
 * when the buffer was full.
 */
class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;  // next write position
  private count: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(capacity, 1);
    this.buffer = new Array(this.capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /** Return items in chronological order (oldest first). */
  toArray(): T[] {
    if (this.count === 0) return [];
    const result = new Array<T>(this.count);
    // start = oldest element position
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[(start + i) % this.capacity] as T;
    }
    return result;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  get length(): number {
    return this.count;
  }
}

// ============================================================================
// EventBus Class
// ============================================================================

/**
 * Central event bus for inter-module communication
 *
 * @example
 * ```typescript
 * const bus = new EventBus();
 *
 * // Subscribe to events
 * bus.on('agent:spawned', (event) => {
 *   console.log(`Agent ${event.payload.agentId} spawned`);
 * });
 *
 * // Emit events
 * bus.emit(createEvent('agent:spawned', {
 *   agentId: 'agent-123',
 *   taskId: 'task-456',
 *   model: 'opus',
 *   context: []
 * }));
 * ```
 */
// Internal handler type that accepts any typed event
type InternalHandler = (event: TypedEvent<EventType, unknown>) => void | Promise<void>;

export class EventBus {
  private config: Required<EventBusConfig>;
  private handlers: Map<EventType, Set<InternalHandler>>;
  private patternHandlers: Set<PatternHandler>;
  private history: CircularBuffer<TypedEvent<EventType, unknown>>;
  private emittingError: boolean = false;

  constructor(config: EventBusConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.handlers = new Map();
    this.patternHandlers = new Set();
    this.history = new CircularBuffer(this.config.historySize);
  }

  // ==========================================================================
  // Subscription Methods
  // ==========================================================================

  /**
   * Subscribe to an event type
   *
   * @param type - The event type to subscribe to
   * @param handler - The handler function to call when the event is emitted
   * @returns Unsubscribe function
   */
  on<T extends EventType>(
    type: T,
    handler: EventHandler<T>
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    const handlers = this.handlers.get(type)!;
    // Cast handler to internal type - type safety is maintained by the generic parameter
    const internalHandler = handler as unknown as InternalHandler;
    handlers.add(internalHandler);

    log.debug('Handler registered', { eventType: type, handlerCount: handlers.size });

    // Return unsubscribe function
    return () => {
      handlers.delete(internalHandler);
      log.debug('Handler unregistered', { eventType: type, handlerCount: handlers.size });
    };
  }

  /**
   * Subscribe to an event type for a single emission only
   *
   * @param type - The event type to subscribe to
   * @param handler - The handler function to call when the event is emitted
   * @returns Unsubscribe function
   */
  once<T extends EventType>(
    type: T,
    handler: EventHandler<T>
  ): () => void {
    const wrappedHandler: EventHandler<T> = (event) => {
      unsubscribe();
      return handler(event);
    };

    const unsubscribe = this.on(type, wrappedHandler);
    return unsubscribe;
  }

  /**
   * Subscribe to events matching a pattern
   *
   * @param pattern - Regular expression to match event types
   * @param handler - The handler function to call for matching events
   * @returns Unsubscribe function
   */
  onPattern(
    pattern: RegExp,
    handler: (event: TypedEvent<EventType, unknown>) => void | Promise<void>
  ): () => void {
    const patternHandler: PatternHandler = { pattern, handler };
    this.patternHandlers.add(patternHandler);

    log.debug('Pattern handler registered', { pattern: pattern.toString(), patternHandlerCount: this.patternHandlers.size });

    return () => {
      this.patternHandlers.delete(patternHandler);
      log.debug('Pattern handler unregistered', { pattern: pattern.toString(), patternHandlerCount: this.patternHandlers.size });
    };
  }

  /**
   * Remove a specific handler for an event type
   *
   * @param type - The event type
   * @param handler - The handler to remove
   */
  off<T extends EventType>(
    type: T,
    handler: EventHandler<T>
  ): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler as unknown as InternalHandler);
    }
  }

  /**
   * Remove all listeners for a specific event type, or all listeners if no type specified
   *
   * @param type - Optional event type to remove listeners for
   */
  removeAllListeners(type?: EventType): void {
    if (type) {
      const count = this.handlers.get(type)?.size ?? 0;
      this.handlers.delete(type);
      log.debug('All listeners removed for event type', { eventType: type, removedCount: count });
    } else {
      const typeCount = this.handlers.size;
      const patternCount = this.patternHandlers.size;
      this.handlers.clear();
      this.patternHandlers.clear();
      log.debug('All listeners removed', { typeHandlersCleared: typeCount, patternHandlersCleared: patternCount });
    }
  }

  /**
   * Get the number of listeners for a specific event type
   *
   * @param type - The event type
   * @returns Number of listeners
   */
  listenerCount(type: EventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  // ==========================================================================
  // Emission Methods
  // ==========================================================================

  /**
   * Emit an event to all registered handlers.
   *
   * **Important:** This method is fire-and-forget for async handlers.
   * Async handlers are executed but not awaited - the method returns
   * immediately after invoking all handlers. Errors in async handlers
   * are caught and emitted as 'system:error' events.
   *
   * For use cases requiring confirmation that all handlers have completed,
   * use `waitFor()` or implement a response pattern with correlation IDs.
   *
   * @param event - The event to emit
   */
  emit<T extends EventType>(
    event: TypedEvent<T, PayloadFor<T>>
  ): void {
    // Start timing event processing
    const timerLabel = `emit:${event.type}:${Date.now()}`;
    log.time(timerLabel);

    // Add to history
    this.addToHistory(event as TypedEvent<EventType, unknown>);

    // Get type-specific handlers
    const typeHandlers = this.handlers.get(event.type as EventType);
    const typeHandlerCount = typeHandlers?.size ?? 0;

    // Count matching pattern handlers
    let patternHandlerCount = 0;
    for (const { pattern } of this.patternHandlers) {
      if (pattern.test(event.type)) {
        patternHandlerCount++;
      }
    }

    // Log event emission with payload summary
    log.debug('Event emitted', {
      eventType: event.type,
      correlationId: event.correlationId,
      typeHandlerCount,
      patternHandlerCount,
      payloadKeys: event.payload ? Object.keys(event.payload as object) : [],
    });

    // Execute type-specific handlers
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        this.safeExecuteHandler(handler, event as TypedEvent<EventType, unknown>);
      }
    }

    // Execute pattern handlers
    for (const { pattern, handler } of this.patternHandlers) {
      if (pattern.test(event.type)) {
        this.safeExecuteHandler(handler, event as TypedEvent<EventType, unknown>);
      }
    }

    // End timing
    log.timeEnd(timerLabel, { eventType: event.type, totalHandlers: typeHandlerCount + patternHandlerCount });
  }

  /**
   * Wait for an event to be emitted
   *
   * @param type - The event type to wait for
   * @param timeoutMs - Optional timeout in milliseconds
   * @returns Promise that resolves with the event
   */
  waitFor<T extends EventType>(
    type: T,
    timeoutMs?: number
  ): Promise<TypedEvent<T, PayloadFor<T>>> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const unsubscribe = this.once(type, (event) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(event);
      });

      if (timeoutMs !== undefined) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for ${type}`));
        }, timeoutMs);
      }
    });
  }

  // ==========================================================================
  // History Methods
  // ==========================================================================

  /**
   * Get event history with optional filtering
   *
   * @param filter - Optional filter options
   * @returns Array of events matching the filter
   */
  getHistory(filter?: EventFilter): TypedEvent<EventType, unknown>[] {
    let result = this.history.toArray();

    if (filter) {
      if (filter.types && filter.types.length > 0) {
        const typeSet = new Set(filter.types);
        result = result.filter((e) => typeSet.has(e.type));
      }

      if (filter.correlationId) {
        result = result.filter((e) => e.correlationId === filter.correlationId);
      }

      if (filter.startTime) {
        result = result.filter(
          (e) => e.timestamp >= filter.startTime!
        );
      }

      if (filter.endTime) {
        result = result.filter(
          (e) => e.timestamp <= filter.endTime!
        );
      }

      if (filter.limit !== undefined && filter.limit > 0) {
        result = result.slice(0, filter.limit);
      }
    }

    return result;
  }

  /**
   * Clear all event history
   */
  clearHistory(): void {
    this.history.clear();
  }

  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================

  /**
   * Destroy the event bus, removing all listeners and clearing history
   */
  destroy(): void {
    this.removeAllListeners();
    this.clearHistory();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Add an event to history, respecting the size limit
   */
  private addToHistory(event: TypedEvent<EventType, unknown>): void {
    this.history.push(event);
  }

  /**
   * Safely execute a handler, catching and handling any errors
   */
  private safeExecuteHandler(
    handler: (event: TypedEvent<EventType, unknown>) => void | Promise<void>,
    event: TypedEvent<EventType, unknown>
  ): void {
    try {
      const result = handler(event);

      // Handle async handlers
      if (result instanceof Promise) {
        result.catch((error) => {
          this.handleHandlerError(error, event);
        });
      }
    } catch (error) {
      this.handleHandlerError(error, event);
    }
  }

  /**
   * Handle an error from a handler
   */
  private handleHandlerError(error: unknown, originalEvent: TypedEvent<EventType, unknown>): void {
    // Log error using structured logging
    if (this.config.logErrors) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      log.error('Event handler failed', errorObj, {
        eventType: originalEvent.type,
        correlationId: originalEvent.correlationId,
        payloadKeys: originalEvent.payload ? Object.keys(originalEvent.payload as object) : [],
      });
    }

    // Emit system:error event (with guard against infinite loops)
    if (!this.emittingError && originalEvent.type !== 'system:error') {
      this.emittingError = true;
      try {
        const errorPayload: SystemErrorPayload = {
          error: error instanceof Error ? error : new Error(String(error)),
          component: 'event-bus',
          message: `Handler error for event ${originalEvent.type}`,
        };
        this.emit(createEvent('system:error', errorPayload, originalEvent.correlationId));
      } finally {
        this.emittingError = false;
      }
    }
  }
}

// ============================================================================
// Singleton Instance (optional)
// ============================================================================

let defaultEventBus: EventBus | null = null;

/**
 * Get the default EventBus instance (singleton)
 */
export function getDefaultEventBus(): EventBus {
  if (!defaultEventBus) {
    defaultEventBus = new EventBus();
  }
  return defaultEventBus;
}

/**
 * Reset the default EventBus instance (useful for testing)
 */
export function resetDefaultEventBus(): void {
  if (defaultEventBus) {
    defaultEventBus.destroy();
    defaultEventBus = null;
  }
}
