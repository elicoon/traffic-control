/**
 * Correlation ID management for request tracing across components
 * Enables tracking a single request/operation across multiple services
 */

import { randomUUID } from 'crypto';

// Module-level correlation ID storage
// Note: This uses a simple variable which works for TrafficControl's single-threaded
// orchestration model. For truly concurrent operations across multiple async contexts,
// consider migrating to Node.js AsyncLocalStorage. The withCorrelation/withCorrelationAsync
// helpers provide scoped correlation IDs but don't prevent clobbering in concurrent scenarios.
let currentCorrelationId: string | undefined;

/**
 * Generate a new correlation ID
 * Format: tc-{timestamp}-{uuid-prefix}
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const uuid = randomUUID().slice(0, 8);
  return `tc-${timestamp}-${uuid}`;
}

/**
 * Set the current correlation ID for the execution context
 */
export function setCorrelationId(id: string): void {
  currentCorrelationId = id;
}

/**
 * Get the current correlation ID from the execution context
 */
export function getCorrelationId(): string | undefined {
  return currentCorrelationId;
}

/**
 * Clear the current correlation ID
 */
export function clearCorrelationId(): void {
  currentCorrelationId = undefined;
}

/**
 * Execute a function with a specific correlation ID
 * The correlation ID will be automatically cleared after execution
 */
export function withCorrelation<T>(id: string, fn: () => T): T {
  const previousId = currentCorrelationId;
  currentCorrelationId = id;
  try {
    return fn();
  } finally {
    currentCorrelationId = previousId;
  }
}

/**
 * Execute an async function with a specific correlation ID
 */
export async function withCorrelationAsync<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previousId = currentCorrelationId;
  currentCorrelationId = id;
  try {
    return await fn();
  } finally {
    currentCorrelationId = previousId;
  }
}

/**
 * Decorator/wrapper to ensure a correlation ID exists
 * Creates one if none is present
 */
export function ensureCorrelationId(): string {
  if (!currentCorrelationId) {
    currentCorrelationId = generateCorrelationId();
  }
  return currentCorrelationId;
}
