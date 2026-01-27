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

// Rolling spend monitor types and interfaces (for short-term anomaly detection)
export type {
  SpendRecord,
  RollingSpendMonitorConfig,
  ThresholdCheckResult,
  SpendAlert,
  TaskSpend,
} from './spend-monitor.js';

// Rolling spend monitor (tracks spending in rolling time windows)
export { RollingSpendMonitor, formatSpendAlert } from './spend-monitor.js';

// Productivity monitor types and interfaces
export type {
  OutputType,
  ProductivityLevel,
  ProductivityStatus,
  OutputCounts,
  AgentProductivityStats,
  ProductivityAlert,
  ProductivityMonitorConfig,
  AlertCallback,
} from './productivity-monitor.js';

// Productivity monitor
export { ProductivityMonitor } from './productivity-monitor.js';

// Circuit breaker types and interfaces
export type {
  CircuitBreakerTripReason,
  CircuitBreakerStatus,
  OperationResult,
  CircuitBreakerConfig,
  CircuitBreakerEvent,
} from './circuit-breaker.js';

// Circuit breaker
export { CircuitBreaker, createCircuitBreaker } from './circuit-breaker.js';

// Pre-flight types and interfaces
export type {
  WarningType,
  PreFlightWarning,
  TaskSummary,
  PreFlightResult,
  PreFlightConfig,
  PreFlightDependencies,
} from './pre-flight.js';

// Pre-flight checker
export {
  PreFlightChecker,
  createPreFlightChecker,
  DEFAULT_PREFLIGHT_CONFIG,
} from './pre-flight.js';
