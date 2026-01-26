/**
 * Orchestrator module - Context budget tracking, management, workflow templates,
 * main orchestration loop, state management, and event dispatching.
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

// State manager types and interfaces
export type {
  AgentStatus,
  AgentState,
  OrchestrationState,
  StateManagerConfig,
} from './state-manager.js';

// State manager
export { StateManager } from './state-manager.js';

// Event dispatcher types and interfaces
export type {
  EventType,
  AgentEvent,
  EventHandler,
  HistoryFilter,
  WaitOptions,
  EventDispatcherConfig,
} from './event-dispatcher.js';

// Event dispatcher
export { EventDispatcher } from './event-dispatcher.js';

// Main loop types and interfaces
export type {
  OrchestrationConfig,
  OrchestrationDependencies,
  OrchestrationStats,
} from './main-loop.js';

// Main loop
export { MainLoop } from './main-loop.js';
