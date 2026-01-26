/**
 * Learning Module
 *
 * This module provides the retrospective system for TrafficControl.
 * It captures and analyzes failures to enable continuous learning.
 *
 * Key components:
 * - RetrospectiveRepository: Database operations for retrospectives
 * - RetrospectiveTrigger: Detects conditions that require retrospectives
 * - RetrospectiveGenerator: Generates retrospective content
 * - LearningExtractor: Extracts machine-readable learnings from retrospectives
 * - LearningStore: Manages learning files (markdown with YAML frontmatter)
 * - LearningProvider: Provides learning context for agent sessions
 */

// Repository
export { RetrospectiveRepository } from './retrospective-repository.js';

// Trigger system
export { RetrospectiveTrigger } from './retrospective-trigger.js';
export type { RetrospectiveTriggerConfig } from './retrospective-trigger.js';

// Generator
export { RetrospectiveGenerator } from './retrospective-generator.js';

// Learning Propagation System
export { LearningExtractor } from './learning-extractor.js';
export { LearningStore } from './learning-store.js';
export { LearningProvider } from './learning-provider.js';
export type { LearningProviderOptions } from './learning-provider.js';

// Types
export type {
  // Core types
  Retrospective,
  RetrospectiveTriggerType,
  Learning,
  LearningCategory,

  // Extended learning types (for propagation system)
  ExtendedLearning,
  CreateExtendedLearningInput,
  LearningYamlFrontmatter,
  LearningContext,
  LearningExtractionResult,
  LearningStoreOptions,
  LearningStats,

  // Input/output types
  CreateRetrospectiveInput,
  UpdateRetrospectiveInput,
  RetrospectiveRow,

  // Trigger types
  TriggerContext,
  TriggerResult,

  // Generator types
  GenerateRetrospectiveInput,
  GeneratedRetrospective
} from './types.js';
