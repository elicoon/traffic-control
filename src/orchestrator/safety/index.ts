/**
 * Safety Systems
 *
 * Exports all safety-related components for the orchestrator.
 */

export { PreFlightChecker } from './preflight-checker.js';
export type {
  PreFlightCheckResult,
  PreFlightStatus,
  PreFlightConfig,
} from './preflight-checker.js';

export { TaskApprovalManager } from './task-approval-manager.js';
export type {
  ApprovalStatus,
  PendingApproval,
  ApprovalResponse,
  TaskApprovalConfig,
  SendApprovalRequestFn,
} from './task-approval-manager.js';

export { SpendMonitor } from './spend-monitor.js';
export type {
  SpendEntry,
  BudgetThreshold,
  SpendMonitorConfig,
  SpendStats,
  SpendAlertCallback,
} from './spend-monitor.js';

export { ProductivityMonitor } from './productivity-monitor.js';
export type {
  CompletionRecord,
  ProductivityStats,
  ProductivityAlertType,
  ProductivityAlert,
  ProductivityMonitorConfig,
  ProductivityAlertCallback,
} from './productivity-monitor.js';

export { CircuitBreaker } from './circuit-breaker.js';
export type {
  CircuitState,
  FailureRecord,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  StateChangeCallback,
} from './circuit-breaker.js';
