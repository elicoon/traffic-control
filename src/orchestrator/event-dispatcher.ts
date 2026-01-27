import { logger } from '../logging/index.js';

const log = logger.child('EventDispatcher');

/**
 * Supported event types in the orchestration system
 */
export type EventType = 'question' | 'completion' | 'error' | 'blocker' | 'subagent_spawn';

/**
 * Agent event structure
 */
export interface AgentEvent {
  type: EventType;
  agentId: string;
  taskId: string;
  payload: unknown;
  timestamp: Date;
}

/**
 * Event handler function type
 */
export type EventHandler = (event: AgentEvent) => void | Promise<void>;

/**
 * Filter options for querying event history
 */
export interface HistoryFilter {
  type?: EventType;
  agentId?: string;
  taskId?: string;
}

/**
 * Options for waiting for an event
 */
export interface WaitOptions {
  timeoutMs?: number;
}

/**
 * Configuration for EventDispatcher
 */
export interface EventDispatcherConfig {
  maxHistorySize?: number;
  enableLogging?: boolean;
}

const DEFAULT_CONFIG: Required<EventDispatcherConfig> = {
  maxHistorySize: 1000,
  enableLogging: false,
};

/**
 * Dispatches agent events to registered handlers.
 * Provides pub/sub messaging for inter-module communication.
 */
export class EventDispatcher {
  private config: Required<EventDispatcherConfig>;
  private handlers: Map<EventType, EventHandler[]>;
  private globalHandlers: EventHandler[];
  private history: AgentEvent[];

  constructor(config: EventDispatcherConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.handlers = new Map();
    this.globalHandlers = [];
    this.history = [];

    // Initialize handler arrays for all event types
    const eventTypes: EventType[] = ['question', 'completion', 'error', 'blocker', 'subagent_spawn'];
    for (const type of eventTypes) {
      this.handlers.set(type, []);
    }
  }

  /**
   * Registers an event handler for a specific event type.
   * @returns Unsubscribe function
   */
  on(type: EventType, handler: EventHandler): () => void {
    const handlers = this.handlers.get(type) || [];
    handlers.push(handler);
    this.handlers.set(type, handlers);

    log.debug('Handler registered', { eventType: type, totalHandlers: handlers.length });

    // Return unsubscribe function
    return () => {
      this.off(type, handler);
    };
  }

  /**
   * Registers a one-time event handler
   */
  once(type: EventType, handler: EventHandler): void {
    const wrappedHandler: EventHandler = async (event) => {
      this.off(type, wrappedHandler);
      await handler(event);
    };

    this.on(type, wrappedHandler);
  }

  /**
   * Removes a specific handler for an event type
   */
  off(type: EventType, handler: EventHandler): void {
    const handlers = this.handlers.get(type) || [];
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
      this.handlers.set(type, handlers);
    }
  }

  /**
   * Removes all handlers for an event type
   */
  removeAllHandlers(type: EventType): void {
    this.handlers.set(type, []);
  }

  /**
   * Registers a global handler that receives all events
   * @returns Unsubscribe function
   */
  onGlobal(handler: EventHandler): () => void {
    this.globalHandlers.push(handler);

    return () => {
      const index = this.globalHandlers.indexOf(handler);
      if (index >= 0) {
        this.globalHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Dispatches an event to all registered handlers
   */
  async dispatch(event: AgentEvent): Promise<void> {
    log.time(`dispatch-${event.type}`);
    // Add to history
    this.addToHistory(event);

    // Log event dispatch
    if (this.config.enableLogging) {
      log.debug('Dispatching event', {
        type: event.type,
        agentId: event.agentId,
        taskId: event.taskId,
      });
    }

    // Get type-specific handlers
    const typeHandlers = this.handlers.get(event.type) || [];

    // Call type-specific handlers
    for (const handler of typeHandlers) {
      await this.safeCallHandler(handler, event);
    }

    // Call global handlers
    for (const handler of this.globalHandlers) {
      await this.safeCallHandler(handler, event);
    }

    log.timeEnd(`dispatch-${event.type}`, {
      agentId: event.agentId,
      typeHandlers: typeHandlers.length,
      globalHandlers: this.globalHandlers.length,
    });
  }

  /**
   * Dispatches multiple events
   */
  async dispatchBatch(events: AgentEvent[]): Promise<void> {
    for (const event of events) {
      await this.dispatch(event);
    }
  }

  /**
   * Waits for an event matching the filter criteria
   * @throws Error on timeout
   */
  waitFor(
    type: EventType,
    filter: Omit<HistoryFilter, 'type'> = {},
    options: WaitOptions = {}
  ): Promise<AgentEvent> {
    const timeoutMs = options.timeoutMs ?? 30000;

    log.debug('Waiting for event', { eventType: type, timeoutMs, filter });

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.off(type, handler);
        log.warn('Timeout waiting for event', { eventType: type, timeoutMs, filter });
        reject(new Error(`Timeout waiting for event: ${type}`));
      }, timeoutMs);

      const handler: EventHandler = (event) => {
        // Check if event matches filter
        if (filter.agentId && event.agentId !== filter.agentId) {
          return;
        }
        if (filter.taskId && event.taskId !== filter.taskId) {
          return;
        }

        // Event matches
        clearTimeout(timeoutId);
        this.off(type, handler);
        resolve(event);
      };

      this.on(type, handler);
    });
  }

  /**
   * Checks if there are handlers for an event type
   */
  hasHandlers(type: EventType): boolean {
    const handlers = this.handlers.get(type) || [];
    return handlers.length > 0;
  }

  /**
   * Gets the number of handlers for an event type
   */
  getHandlerCount(type: EventType): number {
    const handlers = this.handlers.get(type) || [];
    return handlers.length;
  }

  /**
   * Gets the event history with optional filtering
   */
  getHistory(filter: HistoryFilter = {}): AgentEvent[] {
    let result = [...this.history];

    if (filter.type) {
      result = result.filter(e => e.type === filter.type);
    }

    if (filter.agentId) {
      result = result.filter(e => e.agentId === filter.agentId);
    }

    if (filter.taskId) {
      result = result.filter(e => e.taskId === filter.taskId);
    }

    return result;
  }

  /**
   * Clears the event history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Adds an event to history, respecting maxHistorySize
   */
  private addToHistory(event: AgentEvent): void {
    this.history.push(event);

    // Trim history if needed
    while (this.history.length > this.config.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Safely calls a handler, catching any errors
   */
  private async safeCallHandler(handler: EventHandler, event: AgentEvent): Promise<void> {
    try {
      await handler(event);
    } catch (error) {
      log.error('Handler error', error instanceof Error ? error : new Error(String(error)), {
        eventType: event.type,
        agentId: event.agentId,
        taskId: event.taskId,
      });
      // Error isolation - don't rethrow, continue to other handlers
    }
  }
}
