/**
 * Orchestrator module - Context budget tracking, management, and workflow templates
 */

// Context budget types and interfaces
export type {
  ContextBudget,
  ContextBudgetConfig,
  ContextCategory,
  ContextEntry,
  ContextEntryInput,
} from './context-budget.js';

// Context budget manager
export { ContextBudgetManager } from './context-budget-manager.js';

// Delegation metrics types and interfaces
export type {
  DelegationMetrics,
  DelegationStatus,
  DelegationOutcome,
  DelegationSummary,
  ModelDelegationStats,
  DelegationMetricsConfig,
  RecordDelegationInput,
  CompleteDelegationInput,
} from './delegation-metrics.js';

// Delegation metrics manager
export { DelegationMetricsManager } from './delegation-metrics.js';

// Workflow templates types and interfaces
export type {
  PhaseStatus,
  WorkflowPhase,
  WorkflowType,
  Workflow,
  WorkflowInput,
  PhaseAdvanceResult,
} from './workflow-templates.js';

// Workflow templates
export {
  createBugFixWorkflow,
  createFeatureWorkflow,
  createRefactorWorkflow,
  WorkflowManager,
} from './workflow-templates.js';
