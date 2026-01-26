/**
 * EventLogger - Event logging and debugging utility
 *
 * Provides:
 * - Event capture and storage
 * - Filtering and querying
 * - Export to file
 * - Statistics and analytics
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventBus } from './event-bus.js';
import {
  EventType,
  TypedEvent,
  EventFilter,
} from './event-types.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Options for EventLogger
 */
export interface EventLoggerOptions {
  /** Maximum events to store (default: 1000) */
  maxEvents?: number;
  /** Include timestamp in log output (default: true) */
  includeTimestamp?: boolean;
  /** Log events to console (default: false) */
  logToConsole?: boolean;
  /** Auto-enable logging on construction (default: false) */
  autoEnable?: boolean;
  /** Filter to only capture specific event types */
  typeFilter?: EventType[];
}

/**
 * Options for exporting events
 */
export interface ExportOptions {
  /** Pretty-print JSON (default: false) */
  pretty?: boolean;
  /** Filter to apply before export */
  filter?: EventFilter;
}

/**
 * Statistics about logged events
 */
export interface EventStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  errorCount: number;
  firstEventTime?: Date;
  lastEventTime?: Date;
}

const DEFAULT_OPTIONS: Required<Omit<EventLoggerOptions, 'typeFilter'>> & {
  typeFilter?: EventType[];
} = {
  maxEvents: 1000,
  includeTimestamp: true,
  logToConsole: false,
  autoEnable: false,
  typeFilter: undefined,
};

// ============================================================================
// EventLogger Class
// ============================================================================

/**
 * Event logger for debugging and analysis
 *
 * @example
 * ```typescript
 * const eventBus = new EventBus();
 * const logger = new EventLogger(eventBus, {
 *   maxEvents: 500,
 *   logToConsole: true
 * });
 *
 * logger.enable();
 *
 * // Later...
 * const events = logger.getEvents({ types: ['agent:spawned'] });
 * await logger.exportToFile('/path/to/events.json', { pretty: true });
 * ```
 */
export class EventLogger {
  private eventBus: EventBus;
  private options: Required<Omit<EventLoggerOptions, 'typeFilter'>> & {
    typeFilter?: EventType[];
  };
  private events: TypedEvent<EventType, unknown>[];
  private enabled: boolean = false;
  private unsubscribe: (() => void) | null = null;

  constructor(eventBus: EventBus, options: EventLoggerOptions = {}) {
    this.eventBus = eventBus;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.events = [];

    if (this.options.autoEnable) {
      this.enable();
    }
  }

  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================

  /**
   * Enable event logging
   *
   * @returns this for chaining
   */
  enable(): this {
    if (this.enabled) {
      return this;
    }

    this.enabled = true;

    // Subscribe to all events using pattern matching
    this.unsubscribe = this.eventBus.onPattern(/.*/, (event) => {
      this.handleEvent(event);
    });

    return this;
  }

  /**
   * Disable event logging
   *
   * @returns this for chaining
   */
  disable(): this {
    if (!this.enabled) {
      return this;
    }

    this.enabled = false;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    return this;
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ==========================================================================
  // Event Retrieval Methods
  // ==========================================================================

  /**
   * Get logged events with optional filtering
   *
   * @param filter - Optional filter options
   * @returns Array of events matching the filter
   */
  getEvents(filter?: EventFilter): TypedEvent<EventType, unknown>[] {
    let result = [...this.events];

    if (filter) {
      if (filter.types && filter.types.length > 0) {
        const typeSet = new Set(filter.types);
        result = result.filter((e) => typeSet.has(e.type));
      }

      if (filter.correlationId) {
        result = result.filter((e) => e.correlationId === filter.correlationId);
      }

      if (filter.startTime) {
        result = result.filter((e) => e.timestamp >= filter.startTime!);
      }

      if (filter.endTime) {
        result = result.filter((e) => e.timestamp <= filter.endTime!);
      }

      if (filter.limit !== undefined && filter.limit > 0) {
        result = result.slice(0, filter.limit);
      }
    }

    return result;
  }

  /**
   * Get the count of logged events
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Get events grouped by type
   */
  getEventsByType(): Map<EventType, TypedEvent<EventType, unknown>[]> {
    const byType = new Map<EventType, TypedEvent<EventType, unknown>[]>();

    for (const event of this.events) {
      if (!byType.has(event.type)) {
        byType.set(event.type, []);
      }
      byType.get(event.type)!.push(event);
    }

    return byType;
  }

  /**
   * Get statistics about logged events
   */
  getStats(): EventStats {
    const eventsByType: Record<string, number> = {};
    let errorCount = 0;

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;

      if (event.type === 'system:error' || event.type === 'agent:failed') {
        errorCount++;
      }
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      errorCount,
      firstEventTime: this.events.length > 0 ? this.events[0].timestamp : undefined,
      lastEventTime:
        this.events.length > 0
          ? this.events[this.events.length - 1].timestamp
          : undefined,
    };
  }

  /**
   * Clear all logged events
   *
   * @returns this for chaining
   */
  clearEvents(): this {
    this.events = [];
    return this;
  }

  // ==========================================================================
  // Export Methods
  // ==========================================================================

  /**
   * Export events to a JSON file
   *
   * @param filePath - Path to write the file
   * @param options - Export options
   */
  async exportToFile(filePath: string, options: ExportOptions = {}): Promise<void> {
    let events = this.events;

    // Apply filter if provided
    if (options.filter) {
      events = this.getEvents(options.filter);
    }

    // Serialize events
    const serialized = events.map((event) => this.serializeEvent(event));
    const content = options.pretty
      ? JSON.stringify(serialized, null, 2)
      : JSON.stringify(serialized);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write file
    await fs.writeFile(filePath, content, 'utf-8');
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Handle an incoming event
   */
  private handleEvent(event: TypedEvent<EventType, unknown>): void {
    // Apply type filter if configured
    if (this.options.typeFilter && !this.options.typeFilter.includes(event.type)) {
      return;
    }

    // Add event to storage
    this.events.push(event);

    // Trim if over limit
    while (this.events.length > this.options.maxEvents) {
      this.events.shift();
    }

    // Log to console if enabled
    if (this.options.logToConsole) {
      this.logToConsole(event);
    }
  }

  /**
   * Log an event to the console
   */
  private logToConsole(event: TypedEvent<EventType, unknown>): void {
    const parts: string[] = [];

    if (this.options.includeTimestamp) {
      parts.push(`[${event.timestamp.toISOString()}]`);
    }

    parts.push(`[${event.type}]`);

    if (event.correlationId) {
      parts.push(`[${event.correlationId}]`);
    }

    parts.push(JSON.stringify(event.payload));

    console.log(parts.join(' '));
  }

  /**
   * Serialize an event for export
   */
  private serializeEvent(
    event: TypedEvent<EventType, unknown>
  ): Record<string, unknown> {
    return {
      type: event.type,
      payload: this.serializePayload(event.payload),
      timestamp: event.timestamp.toISOString(),
      correlationId: event.correlationId,
    };
  }

  /**
   * Serialize a payload, handling special types like Error
   */
  private serializePayload(payload: unknown): unknown {
    if (payload === null || payload === undefined) {
      return payload;
    }

    if (payload instanceof Error) {
      return {
        name: payload.name,
        message: payload.message,
        stack: payload.stack,
      };
    }

    if (typeof payload !== 'object') {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => this.serializePayload(item));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      result[key] = this.serializePayload(value);
    }
    return result;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create an event logger with console output enabled
 */
export function createConsoleLogger(
  eventBus: EventBus,
  options: Omit<EventLoggerOptions, 'logToConsole'> = {}
): EventLogger {
  return new EventLogger(eventBus, {
    ...options,
    logToConsole: true,
    autoEnable: true,
  });
}

/**
 * Create an event logger for debugging with higher event limit
 */
export function createDebugLogger(
  eventBus: EventBus,
  options: EventLoggerOptions = {}
): EventLogger {
  return new EventLogger(eventBus, {
    maxEvents: 10000,
    logToConsole: true,
    includeTimestamp: true,
    autoEnable: true,
    ...options,
  });
}
