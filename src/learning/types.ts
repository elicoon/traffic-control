/**
 * Retrospective System Types
 *
 * Types for capturing and analyzing failures to enable continuous learning.
 */

export type RetrospectiveTriggerType =
  | 'validation_failures'
  | 'blocker'
  | 'review_rejected'
  | 'test_regression'
  | 'manual';

/**
 * Learning categories for classification
 */
export type LearningCategory =
  | 'testing'
  | 'architecture'
  | 'tooling'
  | 'communication'
  | 'project-specific';

/**
 * Basic learning extracted from a retrospective (stored in DB)
 */
export interface Learning {
  category: string;
  pattern: string;
  rule: string;
  appliesTo?: string[];
}

/**
 * Extended learning with full metadata for propagation
 */
export interface ExtendedLearning {
  /** Unique identifier for the learning */
  id: string;
  /** High-level category */
  category: LearningCategory;
  /** More specific subcategory */
  subcategory: string;
  /** Short pattern name for quick reference */
  pattern: string;
  /** Description of when this learning applies */
  trigger: string;
  /** The actionable rule or guideline */
  rule: string;
  /** Technologies or contexts this applies to */
  appliesTo?: string[];
  /** ID of the retrospective this was extracted from */
  sourceRetrospective: string;
  /** Project ID if project-specific, undefined for global */
  projectId?: string;
  /** When this learning was created */
  createdAt: Date;
  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Input for creating a new extended learning
 */
export interface CreateExtendedLearningInput {
  category: LearningCategory;
  subcategory: string;
  pattern: string;
  trigger: string;
  rule: string;
  appliesTo?: string[];
  sourceRetrospective: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * YAML frontmatter structure for learning files
 */
export interface LearningYamlFrontmatter {
  id: string;
  category: LearningCategory;
  subcategory: string;
  pattern: string;
  trigger: string;
  rule: string;
  applies_to?: string[];
  source_retrospective: string;
  project_id?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

/**
 * Context provided to agents at session start
 */
export interface LearningContext {
  /** Learnings that apply across all projects */
  globalLearnings: ExtendedLearning[];
  /** Learnings specific to the current project */
  projectLearnings: ExtendedLearning[];
  /** General agent behavior guidelines */
  agentGuidelines: string;
}

/**
 * Result from attempting to extract learnings
 */
export interface LearningExtractionResult {
  /** Successfully extracted learnings */
  learnings: CreateExtendedLearningInput[];
  /** Confidence score 0-1 */
  confidence: number;
  /** Reasoning for extraction decisions */
  reasoning: string;
}

/**
 * Options for the learning store
 */
export interface LearningStoreOptions {
  /** Base directory for learning files */
  basePath: string;
  /** Path to agents.md file */
  agentsPath: string;
}

/**
 * Statistics about learnings
 */
export interface LearningStats {
  total: number;
  global: number;
  projectSpecific: number;
  byCategory: Record<LearningCategory, number>;
}

export interface Retrospective {
  id: string;
  taskId: string | null;
  sessionId: string | null;
  projectId: string;
  title: string;
  triggerType: RetrospectiveTriggerType;
  whatHappened: string;
  rootCause: string | null;
  correctApproach: string | null;
  learning: Learning | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface CreateRetrospectiveInput {
  taskId?: string;
  sessionId?: string;
  projectId: string;
  title: string;
  triggerType: RetrospectiveTriggerType;
  whatHappened: string;
  rootCause?: string;
  correctApproach?: string;
  learning?: Learning;
}

export interface UpdateRetrospectiveInput {
  title?: string;
  whatHappened?: string;
  rootCause?: string;
  correctApproach?: string;
  learning?: Learning;
  resolvedAt?: Date;
}

/**
 * Database row representation for tc_retrospectives table
 */
export interface RetrospectiveRow {
  id: string;
  task_id: string | null;
  session_id: string | null;
  project_id: string;
  title: string;
  trigger_type: RetrospectiveTriggerType;
  what_happened: string;
  root_cause: string | null;
  correct_approach: string | null;
  learning_category: string | null;
  learning_pattern: string | null;
  learning_rule: string | null;
  created_at: string;
  resolved_at: string | null;
}

/**
 * Context provided to the retrospective trigger system
 */
export interface TriggerContext {
  taskId: string;
  projectId: string;
  sessionId?: string;
  validationFailureCount?: number;
  isBlocked?: boolean;
  blockerReason?: string;
  reviewRejected?: boolean;
  reviewFeedback?: string;
  testsFailing?: boolean;
  testsFailedCount?: number;
  previousTestsPassedCount?: number;
}

/**
 * Result from checking if a retrospective should be triggered
 */
export interface TriggerResult {
  shouldTrigger: boolean;
  triggerType: RetrospectiveTriggerType | null;
  reason: string | null;
  context: Record<string, unknown>;
}

/**
 * Input for generating retrospective content
 */
export interface GenerateRetrospectiveInput {
  triggerType: RetrospectiveTriggerType;
  taskId: string;
  projectId: string;
  sessionId?: string;
  context: Record<string, unknown>;
  taskTitle?: string;
  taskDescription?: string;
  errorLogs?: string[];
  validationMessages?: string[];
  reviewFeedback?: string;
}

/**
 * Generated retrospective content
 */
export interface GeneratedRetrospective {
  title: string;
  whatHappened: string;
  rootCause: string | null;
  correctApproach: string | null;
  suggestedLearning: Learning | null;
}
