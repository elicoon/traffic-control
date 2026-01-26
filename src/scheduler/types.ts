/**
 * Shared types for the scheduler module.
 *
 * ModelType is used across multiple modules (scheduler, orchestrator)
 * and is centralized here to avoid duplication.
 */

/**
 * Available model types for agent sessions.
 * - opus: Most capable model, used for complex tasks
 * - sonnet: Balanced model for general tasks
 * - haiku: Fast model for simple tasks (shares capacity with sonnet)
 */
export type ModelType = 'opus' | 'sonnet' | 'haiku';
