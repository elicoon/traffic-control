# Slack Interaction Thresholds Design Document

**Version:** 1.0
**Status:** Proposed
**Created:** 2026-01-26
**Author:** TrafficControl Development Team

---

## Executive Summary

This document defines mandatory Slack interaction thresholds for TrafficControl to ensure the orchestrator **proactively engages with the user** rather than running autonomously. The core philosophy is: **no work happens without explicit user approval**.

These thresholds address a critical gap in the current implementation where the orchestrator can consume significant resources without user oversight.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Threshold 1: Task Start Confirmation](#2-threshold-1-task-start-confirmation)
3. [Threshold 2: Orchestrator Startup Confirmation](#3-threshold-2-orchestrator-startup-confirmation)
4. [Threshold 3: Excessive Spend Alerts](#4-threshold-3-excessive-spend-alerts)
5. [Threshold 4: Token Consumption Without Output](#5-threshold-4-token-consumption-without-output)
6. [Threshold 5: Periodic Check-ins](#6-threshold-5-periodic-check-ins)
7. [Threshold 6: Circuit Breaker](#7-threshold-6-circuit-breaker)
8. [Configuration Schema](#8-configuration-schema)
9. [New Event Types](#9-new-event-types)
10. [Database Schema Changes](#10-database-schema-changes)
11. [Implementation Phases](#11-implementation-phases)
12. [Error Handling](#12-error-handling)

---

## 1. Design Principles

### 1.1 Core Philosophy
- **Explicit Consent**: The user must explicitly approve all work before it begins
- **Cost Transparency**: Users should always know the estimated and actual cost of work
- **Fail-Safe**: When in doubt, pause and ask rather than continue spending
- **Non-Blocking Awareness**: Notifications should not block work indefinitely but establish clear timeout behaviors

### 1.2 Confirmation Hierarchy
```
HARD STOP (requires confirmation):
  - Starting the orchestrator
  - Starting any new task
  - Exceeding budget limits
  - Circuit breaker triggers

SOFT ALERT (notification, continues unless user intervenes):
  - Periodic check-ins
  - Token consumption warnings
  - Approaching budget thresholds
```

### 1.3 Response Mechanisms
Users can respond via:
1. **Emoji Reactions**: Quick approval/rejection (checkmark/X)
2. **Thread Replies**: Detailed responses or commands
3. **Slash Commands**: `/tc approve`, `/tc reject`, `/tc pause`

---

## 2. Threshold 1: Task Start Confirmation

### 2.1 Overview
Before starting ANY new task, the orchestrator must:
1. Send a detailed task summary to Slack
2. Wait for explicit user confirmation
3. Never start work without approval

### 2.2 Message Format
```
*Task Ready for Approval*

*Title:* Implement user authentication flow
*Description:* Add JWT-based authentication with refresh tokens...

*Estimated Cost:* $2.35 - $4.50
  - Opus sessions: 2 (est. $1.80 - $3.60)
  - Sonnet sessions: 1 (est. $0.55 - $0.90)

*Priority:* 75 (High)
*Queue Position:* 1 of 5

*Project:* TrafficControl Internal

---
React with:
  :white_check_mark: to approve and start
  :x: to reject/skip
  :arrows_counterclockwise: to defer (move to end of queue)

Reply to adjust priority or add context.
```

### 2.3 Implementation Details

#### New Interface: `TaskApprovalRequest`
```typescript
// src/slack/task-approval.ts

export interface TaskApprovalRequest {
  taskId: string;
  title: string;
  description: string;
  estimatedCostRange: {
    min: number;
    max: number;
    breakdown: {
      opusSessions: number;
      sonnetSessions: number;
      opusCostRange: { min: number; max: number };
      sonnetCostRange: { min: number; max: number };
    };
  };
  priority: number;
  queuePosition: number;
  totalInQueue: number;
  projectId: string;
  projectName: string;
  tags?: string[];
  acceptanceCriteria?: string;
}

export interface TaskApprovalResponse {
  approved: boolean;
  userId: string;
  responseType: 'reaction' | 'reply' | 'command' | 'timeout';
  modifiedPriority?: number;
  additionalContext?: string;
  timestamp: Date;
}

export type ApprovalStatus =
  | 'pending'      // Waiting for user response
  | 'approved'     // User approved, ready to start
  | 'rejected'     // User rejected, skip task
  | 'deferred'     // User deferred, move to end of queue
  | 'timeout'      // No response within timeout, handled by config
  | 'expired';     // Task no longer valid
```

#### New Class: `TaskApprovalManager`
```typescript
// src/slack/task-approval-manager.ts

export interface TaskApprovalConfig {
  /** Timeout in ms before auto-action (default: 5 minutes) */
  approvalTimeoutMs: number;
  /** Action on timeout: 'pause' | 'approve' | 'reject' (default: 'pause') */
  timeoutAction: 'pause' | 'approve' | 'reject';
  /** Whether to require confirmation for low-priority tasks (default: true) */
  requireConfirmationForAllTasks: boolean;
  /** Priority threshold below which confirmation is optional (if above flag is false) */
  autoApproveThreshold: number;
  /** Maximum cost for auto-approval (only applies if requireConfirmationForAllTasks is false) */
  autoApproveCostLimit: number;
}

export class TaskApprovalManager {
  private pendingApprovals: Map<string, PendingApproval>;
  private config: TaskApprovalConfig;

  constructor(
    private slackRouter: SlackRouter,
    private sendMessage: SendMessageFn,
    config: Partial<TaskApprovalConfig>
  );

  /**
   * Request approval for a task. Returns a promise that resolves
   * when the user responds or times out.
   */
  async requestApproval(request: TaskApprovalRequest): Promise<TaskApprovalResponse>;

  /**
   * Handle a reaction on an approval message.
   */
  async handleReaction(messageTs: string, reaction: string, userId: string): Promise<void>;

  /**
   * Handle a reply to an approval message.
   */
  async handleReply(threadTs: string, text: string, userId: string): Promise<void>;

  /**
   * Get all pending approvals.
   */
  getPendingApprovals(): PendingApproval[];

  /**
   * Cancel a pending approval.
   */
  cancelApproval(taskId: string): void;
}
```

#### Cost Estimation Helper
```typescript
// src/scheduler/cost-estimator.ts

export interface CostEstimate {
  min: number;
  max: number;
  expected: number;
  breakdown: {
    model: 'opus' | 'sonnet' | 'haiku';
    sessions: number;
    tokensPerSession: { min: number; max: number; expected: number };
    costPerSession: { min: number; max: number; expected: number };
  }[];
}

export class CostEstimator {
  constructor(private modelPricing: ModelPricingRepository);

  /**
   * Estimate cost for a task based on historical data and estimates.
   */
  async estimateCost(task: Task): Promise<CostEstimate>;

  /**
   * Get cost range for a specific model and session count.
   */
  async getModelCostRange(
    model: 'opus' | 'sonnet' | 'haiku',
    sessions: number
  ): Promise<{ min: number; max: number }>;
}
```

### 2.4 Integration with Scheduler

Modify `Scheduler.scheduleNext()` to include approval step:

```typescript
// Modified src/scheduler/scheduler.ts

async scheduleNext(spawnCallback?: SpawnCallback): Promise<SchedulerResult> {
  // ... existing capacity checks ...

  if (!queuedTask) {
    return { status: 'idle', scheduled: 0 };
  }

  // NEW: Request approval before spawning
  if (this.approvalManager && this.config.requireApproval) {
    const estimate = await this.costEstimator.estimateCost(queuedTask.task);

    const approvalRequest: TaskApprovalRequest = {
      taskId: queuedTask.task.id,
      title: queuedTask.task.title,
      description: queuedTask.task.description || '',
      estimatedCostRange: estimate,
      priority: queuedTask.task.priority,
      queuePosition: this.getQueuePosition(queuedTask.task.id),
      totalInQueue: this.taskQueue.size(),
      projectId: queuedTask.task.project_id,
      projectName: await this.getProjectName(queuedTask.task.project_id),
    };

    const approval = await this.approvalManager.requestApproval(approvalRequest);

    if (!approval.approved) {
      if (approval.responseType === 'timeout') {
        // Handle based on config
        return this.handleApprovalTimeout(queuedTask.task);
      }
      // Task rejected - remove or defer
      return { status: 'rejected', scheduled: 0, taskId: queuedTask.task.id };
    }
  }

  // ... continue with existing spawn logic ...
}
```

---

## 3. Threshold 2: Orchestrator Startup Confirmation

### 3.1 Overview
Before the orchestrator begins any work, it must:
1. Send a summary of queued tasks with priorities
2. Allow user to review and reorder
3. Wait for explicit confirmation to begin

### 3.2 Message Format
```
*TrafficControl Ready to Start*

*Queued Tasks (5):*

1. [P:90] *Implement user authentication flow*
   Project: TrafficControl Internal | Est: $2.35 - $4.50

2. [P:75] *Add database migrations*
   Project: TrafficControl Infrastructure | Est: $1.20 - $2.00

3. [P:50] *Update documentation*
   Project: TrafficControl Internal | Est: $0.50 - $1.00

4. [P:50] *Fix Slack retry logic*
   Project: TrafficControl Infrastructure | Est: $0.80 - $1.50

5. [P:25] *Refactor logging module*
   Project: TrafficControl Internal | Est: $0.60 - $1.20

---
*Total Estimated Cost:* $5.45 - $10.20
*Active Budget:* $50.00 remaining

---
Reply with:
  `start` - Begin with current order
  `reorder 3,1,2,4,5` - Change priority order
  `remove 5` - Remove task from queue
  `hold` - Don't start yet, wait for more tasks

React :white_check_mark: to start with current order.
```

### 3.3 Implementation Details

#### New Interface: `StartupConfirmation`
```typescript
// src/orchestrator/startup-confirmation.ts

export interface QueueSummary {
  tasks: Array<{
    id: string;
    title: string;
    projectName: string;
    priority: number;
    estimatedCost: { min: number; max: number };
  }>;
  totalEstimatedCost: { min: number; max: number };
  remainingBudget: number;
  capacityInfo: {
    opusSlots: { current: number; limit: number };
    sonnetSlots: { current: number; limit: number };
  };
}

export interface StartupConfirmationResult {
  confirmed: boolean;
  userId: string;
  modifications?: {
    reorderedTaskIds?: string[];
    removedTaskIds?: string[];
    addedTasks?: string[];
  };
  timestamp: Date;
}

export class StartupConfirmationManager {
  constructor(
    private slackRouter: SlackRouter,
    private sendMessage: SendMessageFn,
    private taskQueue: TaskQueue,
    private budgetRepo: BudgetRepository
  );

  /**
   * Request confirmation before starting the orchestrator.
   * Returns when user confirms or specifies hold.
   */
  async requestStartupConfirmation(): Promise<StartupConfirmationResult>;

  /**
   * Format the queue summary message.
   */
  private formatQueueSummary(summary: QueueSummary): string;

  /**
   * Apply user modifications to the queue.
   */
  private applyModifications(modifications: StartupConfirmationResult['modifications']): void;
}
```

#### Integration with MainLoop

```typescript
// Modified src/orchestrator/main-loop.ts

async start(): Promise<void> {
  if (this.running) {
    return;
  }

  log.info('Starting orchestration loop');

  // ... existing database validation ...

  // NEW: Request startup confirmation
  if (this.config.requireStartupConfirmation) {
    const confirmation = await this.startupConfirmation.requestStartupConfirmation();

    if (!confirmation.confirmed) {
      log.info('Startup not confirmed, entering hold state');
      this.holdState = true;
      return;
    }

    if (confirmation.modifications) {
      await this.applyStartupModifications(confirmation.modifications);
    }

    log.info('Startup confirmed by user', { userId: confirmation.userId });
  }

  // ... continue with existing start logic ...
}
```

---

## 4. Threshold 3: Excessive Spend Alerts

### 4.1 Overview
If cost in the last N minutes exceeds a configurable threshold:
1. Immediately pause all agents
2. Send an alert to Slack with cost breakdown
3. Wait for user confirmation to continue

### 4.2 Configuration
```typescript
export interface ExcessiveSpendConfig {
  /** Time window in minutes (default: 5) */
  windowMinutes: number;
  /** Spend threshold in USD (default: $5.00) */
  thresholdUsd: number;
  /** Whether to auto-pause on threshold breach (default: true) */
  autoPause: boolean;
  /** Cooldown period before next alert in minutes (default: 15) */
  cooldownMinutes: number;
}
```

### 4.3 Message Format
```
:rotating_light: *Excessive Spend Alert*

Spend in last 5 minutes: *$6.73* (threshold: $5.00)

*Breakdown:*
  - Opus: $5.20 (2 sessions, 145K tokens)
  - Sonnet: $1.53 (3 sessions, 89K tokens)

*Active Tasks:*
  - Implement user authentication flow (Opus) - running 4m 23s
  - Add database migrations (Sonnet) - running 2m 11s
  - Fix Slack retry logic (Sonnet) - running 1m 45s

*All agents have been PAUSED.*

---
Reply with:
  `continue` - Resume all agents
  `continue [task-id]` - Resume specific task only
  `abort` - Stop all agents and mark tasks as blocked
  `budget +10` - Increase session budget by $10

React :white_check_mark: to continue all agents.
```

### 4.4 Implementation Details

#### New Class: `SpendMonitor`
```typescript
// src/reporter/spend-monitor.ts

export interface SpendWindow {
  startTime: Date;
  endTime: Date;
  totalSpend: number;
  breakdown: {
    model: 'opus' | 'sonnet' | 'haiku';
    spend: number;
    sessions: number;
    tokens: number;
  }[];
  activeTasks: {
    taskId: string;
    title: string;
    model: 'opus' | 'sonnet' | 'haiku';
    runningDurationMs: number;
    tokensConsumed: number;
  }[];
}

export interface SpendAlertResult {
  action: 'continue' | 'continue_specific' | 'abort' | 'budget_increase';
  userId: string;
  specificTaskIds?: string[];
  budgetIncrease?: number;
  timestamp: Date;
}

export class SpendMonitor {
  private lastAlertTime: Date | null = null;

  constructor(
    private config: ExcessiveSpendConfig,
    private usageLogRepo: UsageLogRepository,
    private slackRouter: SlackRouter,
    private mainLoop: MainLoop
  );

  /**
   * Check spend in the current window. Called on each usage log entry.
   */
  async checkSpend(): Promise<void>;

  /**
   * Get current spend in the monitoring window.
   */
  async getCurrentSpend(): Promise<SpendWindow>;

  /**
   * Trigger a spend alert and pause agents.
   */
  private async triggerAlert(spend: SpendWindow): Promise<SpendAlertResult>;

  /**
   * Handle user response to spend alert.
   */
  private async handleAlertResponse(response: SpendAlertResult): Promise<void>;
}
```

#### Integration with Usage Logging

```typescript
// Modified src/db/repositories/usage-log.ts

async create(input: CreateUsageLogInput): Promise<UsageLog> {
  const log = await this.createInternal(input);

  // NEW: Notify spend monitor
  if (this.spendMonitor) {
    await this.spendMonitor.checkSpend();
  }

  return log;
}
```

---

## 5. Threshold 4: Token Consumption Without Output

### 5.1 Overview
If an agent consumes significant tokens without producing meaningful output:
1. Send a warning to Slack
2. Ask user if they want to continue or abort
3. Provide context on what the agent has been doing

### 5.2 Detection Criteria
```typescript
export interface ProductivityConfig {
  /** Minimum tokens before checking productivity (default: 50,000) */
  minTokensBeforeCheck: number;
  /** Maximum tokens without meaningful output (default: 100,000) */
  maxTokensWithoutOutput: number;
  /** What counts as meaningful output */
  meaningfulOutputCriteria: {
    /** Files written/modified (default: 1) */
    filesModified: number;
    /** Tests passing (if test task) */
    testsPassingIncrease: number;
    /** Task status change */
    statusChange: boolean;
  };
  /** Check interval in ms (default: 30000) */
  checkIntervalMs: number;
}
```

### 5.3 Message Format
```
:warning: *High Token Consumption Alert*

Agent working on: *Implement user authentication flow*

*Statistics:*
  - Tokens consumed: 87,500
  - Running time: 12m 34s
  - Files modified: 0
  - Commits: 0

*Recent Activity (last 5 tool calls):*
  1. Read file: src/auth/handler.ts
  2. Read file: src/auth/middleware.ts
  3. Grep search: "jwt"
  4. Read file: src/auth/types.ts
  5. Read file: package.json

_Agent appears to be exploring the codebase without making changes._

---
Reply with:
  `continue` - Let agent continue (may be legitimate research)
  `nudge` - Send reminder to agent to produce output
  `abort` - Stop agent and mark task as blocked
  `context: [additional instructions]` - Provide guidance to agent

React :white_check_mark: to continue, :x: to abort.
```

### 5.4 Implementation Details

#### New Class: `ProductivityMonitor`
```typescript
// src/agent/productivity-monitor.ts

export interface AgentActivity {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  startedAt: Date;
  tokensConsumed: number;
  filesModified: string[];
  commits: number;
  toolCalls: Array<{
    tool: string;
    args: string;
    timestamp: Date;
  }>;
  meaningfulOutputProduced: boolean;
}

export interface ProductivityAlertResult {
  action: 'continue' | 'nudge' | 'abort' | 'context';
  userId: string;
  additionalContext?: string;
  timestamp: Date;
}

export class ProductivityMonitor {
  private agentActivities: Map<string, AgentActivity>;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    private config: ProductivityConfig,
    private agentManager: AgentManager,
    private slackRouter: SlackRouter
  );

  /**
   * Start monitoring agent productivity.
   */
  start(): void;

  /**
   * Stop monitoring.
   */
  stop(): void;

  /**
   * Record a tool call for an agent.
   */
  recordToolCall(sessionId: string, tool: string, args: string): void;

  /**
   * Record tokens consumed for an agent.
   */
  recordTokens(sessionId: string, tokens: number): void;

  /**
   * Record file modification for an agent.
   */
  recordFileModification(sessionId: string, filePath: string): void;

  /**
   * Check productivity for all agents.
   */
  private async checkProductivity(): Promise<void>;

  /**
   * Trigger alert for low productivity agent.
   */
  private async triggerAlert(activity: AgentActivity): Promise<ProductivityAlertResult>;
}
```

---

## 6. Threshold 5: Periodic Check-ins

### 6.1 Overview
Every N minutes, send a status update to Slack:
- Active tasks and their progress
- Tokens used and estimated cost
- Completed work since last check-in
- Any blockers or questions

### 6.2 Configuration
```typescript
export interface PeriodicCheckInConfig {
  /** Interval in minutes (default: 30) */
  intervalMinutes: number;
  /** Whether to send during quiet hours (default: false) */
  sendDuringQuietHours: boolean;
  /** Include cost breakdown (default: true) */
  includeCostBreakdown: boolean;
  /** Include task progress (default: true) */
  includeTaskProgress: boolean;
  /** Suppress if no activity (default: true) */
  suppressIfNoActivity: boolean;
}
```

### 6.3 Message Format
```
*Periodic Check-in* (30m interval)

*Since Last Check-in:*
  - Tasks completed: 2
  - Tasks started: 1
  - Tokens used: 45,200
  - Cost: $1.23

*Currently Active:*
  1. *Implement user authentication flow* (Opus)
     Running: 12m | Tokens: 23,400 | Cost: $0.78
     Last action: Writing src/auth/jwt.ts

  2. *Add database migrations* (Sonnet)
     Running: 5m | Tokens: 8,100 | Cost: $0.22
     Last action: Creating migration file

*Completed Since Last Check-in:*
  - :white_check_mark: Fix Slack retry logic (Sonnet) - 15m, $0.45
  - :white_check_mark: Update documentation (Sonnet) - 8m, $0.23

*Queued:* 3 tasks | *Budget Remaining:* $42.50

---
_Next check-in in 30 minutes. Reply `pause` to stop, `status` for detailed report._
```

### 6.4 Implementation Details

#### New Class: `PeriodicCheckInManager`
```typescript
// src/slack/periodic-checkin.ts

export interface CheckInData {
  sinceLast: {
    tasksCompleted: number;
    tasksStarted: number;
    tokensUsed: number;
    cost: number;
  };
  activeAgents: Array<{
    taskId: string;
    taskTitle: string;
    model: 'opus' | 'sonnet' | 'haiku';
    runningMinutes: number;
    tokens: number;
    cost: number;
    lastAction: string;
  }>;
  completedTasks: Array<{
    taskId: string;
    taskTitle: string;
    model: 'opus' | 'sonnet' | 'haiku';
    durationMinutes: number;
    cost: number;
  }>;
  queuedCount: number;
  budgetRemaining: number;
}

export class PeriodicCheckInManager {
  private checkInInterval: NodeJS.Timeout | null = null;
  private lastCheckInTime: Date | null = null;
  private lastCheckInData: CheckInData | null = null;

  constructor(
    private config: PeriodicCheckInConfig,
    private slackRouter: SlackRouter,
    private sendMessage: SendMessageFn,
    private metricsCollector: MetricsCollector,
    private agentManager: AgentManager
  );

  /**
   * Start periodic check-ins.
   */
  start(): void;

  /**
   * Stop periodic check-ins.
   */
  stop(): void;

  /**
   * Send an immediate check-in (bypasses interval).
   */
  async sendImmediateCheckIn(): Promise<void>;

  /**
   * Collect data for check-in.
   */
  private async collectCheckInData(): Promise<CheckInData>;

  /**
   * Format check-in message.
   */
  private formatCheckInMessage(data: CheckInData): string;

  /**
   * Check if there's been activity since last check-in.
   */
  private hasActivity(data: CheckInData): boolean;
}
```

---

## 7. Threshold 6: Circuit Breaker

### 7.1 Overview
Automatic safety stops when:
1. Any agent errors 3 times in a row
2. Total spend exceeds budget
3. System health degrades

### 7.2 Configuration
```typescript
export interface CircuitBreakerConfig {
  /** Consecutive errors before triggering (default: 3) */
  maxConsecutiveErrors: number;
  /** Whether to track errors per-agent or globally (default: 'per-agent') */
  errorScope: 'per-agent' | 'global';
  /** Hard budget limit in USD (default: from tc_budgets table) */
  hardBudgetLimit: number | null;
  /** Soft budget warning threshold as percentage (default: 80) */
  softBudgetWarningPercent: number;
  /** System health check interval in ms (default: 60000) */
  healthCheckIntervalMs: number;
  /** Actions to take on trigger */
  triggerActions: {
    /** Pause all agents (default: true) */
    pauseAgents: boolean;
    /** Send Slack notification (default: true) */
    sendNotification: boolean;
    /** Save state to disk (default: true) */
    saveState: boolean;
    /** Require manual restart (default: true for hard triggers) */
    requireManualRestart: boolean;
  };
}
```

### 7.3 Message Formats

#### Agent Error Circuit Breaker
```
:octagonal_sign: *Circuit Breaker Triggered - Agent Errors*

Agent has failed 3 consecutive times:

*Task:* Implement user authentication flow
*Agent ID:* agent-abc123
*Model:* Opus

*Error History:*
  1. [14:23:45] TypeError: Cannot read property 'id' of undefined
  2. [14:25:12] Error: Failed to write file - permission denied
  3. [14:26:33] Error: Test suite failed with 5 errors

*All agents have been PAUSED.*

---
Reply with:
  `restart` - Clear error count and restart this agent
  `skip` - Mark task as blocked and move to next
  `investigate` - Keep paused, I'll look into it
  `resume-all` - Resume all agents (risky)
```

#### Budget Circuit Breaker
```
:octagonal_sign: *Circuit Breaker Triggered - Budget Exceeded*

*Budget Status:*
  - Total Budget: $50.00
  - Total Spent: $52.35
  - Overage: $2.35 (4.7%)

*All agents have been STOPPED.*
_No more work will be scheduled until budget is increased._

*Spend Breakdown (Today):*
  - Opus: $38.20 (12 sessions)
  - Sonnet: $14.15 (28 sessions)

---
Reply with:
  `budget +25` - Increase budget by $25
  `budget set 100` - Set new budget to $100
  `report` - Get detailed cost report
```

### 7.4 Implementation Details

#### New Class: `CircuitBreaker`
```typescript
// src/orchestrator/circuit-breaker.ts

export type CircuitBreakerTrigger =
  | 'consecutive_errors'
  | 'budget_exceeded'
  | 'budget_warning'
  | 'system_health'
  | 'manual';

export interface CircuitBreakerState {
  isOpen: boolean;
  trigger: CircuitBreakerTrigger | null;
  triggeredAt: Date | null;
  errorCounts: Map<string, number>; // agentId -> consecutive errors
  totalSpend: number;
  budgetLimit: number;
}

export interface CircuitBreakerEvent {
  trigger: CircuitBreakerTrigger;
  details: Record<string, unknown>;
  timestamp: Date;
}

export class CircuitBreaker {
  private state: CircuitBreakerState;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    private config: CircuitBreakerConfig,
    private mainLoop: MainLoop,
    private slackRouter: SlackRouter,
    private budgetRepo: BudgetRepository,
    private usageLogRepo: UsageLogRepository
  );

  /**
   * Start the circuit breaker monitoring.
   */
  start(): void;

  /**
   * Stop monitoring.
   */
  stop(): void;

  /**
   * Record an agent error.
   */
  recordError(agentId: string, error: Error): void;

  /**
   * Record a successful agent action (resets error count).
   */
  recordSuccess(agentId: string): void;

  /**
   * Check budget status.
   */
  async checkBudget(): Promise<void>;

  /**
   * Manually trip the circuit breaker.
   */
  trip(trigger: CircuitBreakerTrigger, details: Record<string, unknown>): void;

  /**
   * Reset the circuit breaker.
   */
  async reset(userId: string): Promise<void>;

  /**
   * Get current state.
   */
  getState(): CircuitBreakerState;

  /**
   * Handle trigger event.
   */
  private async handleTrigger(event: CircuitBreakerEvent): Promise<void>;

  /**
   * Send appropriate notification based on trigger.
   */
  private async sendNotification(event: CircuitBreakerEvent): Promise<void>;
}
```

---

## 8. Configuration Schema

### 8.1 Environment Variables
```bash
# Task Approval
TC_REQUIRE_TASK_APPROVAL=true
TC_APPROVAL_TIMEOUT_MS=300000
TC_APPROVAL_TIMEOUT_ACTION=pause

# Startup Confirmation
TC_REQUIRE_STARTUP_CONFIRMATION=true

# Spend Monitoring
TC_SPEND_WINDOW_MINUTES=5
TC_SPEND_THRESHOLD_USD=5.00
TC_SPEND_AUTO_PAUSE=true

# Productivity Monitoring
TC_MIN_TOKENS_BEFORE_CHECK=50000
TC_MAX_TOKENS_WITHOUT_OUTPUT=100000
TC_PRODUCTIVITY_CHECK_INTERVAL_MS=30000

# Periodic Check-ins
TC_CHECKIN_INTERVAL_MINUTES=30
TC_CHECKIN_DURING_QUIET_HOURS=false

# Circuit Breaker
TC_MAX_CONSECUTIVE_ERRORS=3
TC_ERROR_SCOPE=per-agent
TC_HARD_BUDGET_LIMIT=50.00
TC_SOFT_BUDGET_WARNING_PERCENT=80
```

### 8.2 Database Table: `tc_interaction_config`
```sql
CREATE TABLE tc_interaction_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES tc_projects(id),

  -- Task Approval
  require_task_approval BOOLEAN DEFAULT true,
  approval_timeout_ms INTEGER DEFAULT 300000,
  approval_timeout_action TEXT DEFAULT 'pause',
  auto_approve_priority_threshold INTEGER DEFAULT NULL,
  auto_approve_cost_limit DECIMAL(10,4) DEFAULT NULL,

  -- Startup Confirmation
  require_startup_confirmation BOOLEAN DEFAULT true,

  -- Spend Monitoring
  spend_window_minutes INTEGER DEFAULT 5,
  spend_threshold_usd DECIMAL(10,4) DEFAULT 5.00,
  spend_auto_pause BOOLEAN DEFAULT true,
  spend_cooldown_minutes INTEGER DEFAULT 15,

  -- Productivity Monitoring
  min_tokens_before_check INTEGER DEFAULT 50000,
  max_tokens_without_output INTEGER DEFAULT 100000,
  productivity_check_interval_ms INTEGER DEFAULT 30000,

  -- Periodic Check-ins
  checkin_interval_minutes INTEGER DEFAULT 30,
  checkin_during_quiet_hours BOOLEAN DEFAULT false,
  suppress_if_no_activity BOOLEAN DEFAULT true,

  -- Circuit Breaker
  max_consecutive_errors INTEGER DEFAULT 3,
  error_scope TEXT DEFAULT 'per-agent',
  hard_budget_limit DECIMAL(10,4) DEFAULT NULL,
  soft_budget_warning_percent INTEGER DEFAULT 80,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for project lookups
CREATE INDEX idx_tc_interaction_config_project ON tc_interaction_config(project_id);

-- RLS policies
ALTER TABLE tc_interaction_config ENABLE ROW LEVEL SECURITY;
```

### 8.3 Full Configuration Interface
```typescript
// src/config/interaction-thresholds.ts

export interface InteractionThresholdsConfig {
  taskApproval: TaskApprovalConfig;
  startupConfirmation: {
    required: boolean;
  };
  spendMonitor: ExcessiveSpendConfig;
  productivityMonitor: ProductivityConfig;
  periodicCheckIn: PeriodicCheckInConfig;
  circuitBreaker: CircuitBreakerConfig;
}

export const DEFAULT_INTERACTION_CONFIG: InteractionThresholdsConfig = {
  taskApproval: {
    approvalTimeoutMs: 300000, // 5 minutes
    timeoutAction: 'pause',
    requireConfirmationForAllTasks: true,
    autoApproveThreshold: 0,
    autoApproveCostLimit: 0,
  },
  startupConfirmation: {
    required: true,
  },
  spendMonitor: {
    windowMinutes: 5,
    thresholdUsd: 5.00,
    autoPause: true,
    cooldownMinutes: 15,
  },
  productivityMonitor: {
    minTokensBeforeCheck: 50000,
    maxTokensWithoutOutput: 100000,
    meaningfulOutputCriteria: {
      filesModified: 1,
      testsPassingIncrease: 0,
      statusChange: true,
    },
    checkIntervalMs: 30000,
  },
  periodicCheckIn: {
    intervalMinutes: 30,
    sendDuringQuietHours: false,
    includeCostBreakdown: true,
    includeTaskProgress: true,
    suppressIfNoActivity: true,
  },
  circuitBreaker: {
    maxConsecutiveErrors: 3,
    errorScope: 'per-agent',
    hardBudgetLimit: null,
    softBudgetWarningPercent: 80,
    healthCheckIntervalMs: 60000,
    triggerActions: {
      pauseAgents: true,
      sendNotification: true,
      saveState: true,
      requireManualRestart: true,
    },
  },
};
```

---

## 9. New Event Types

Add to `src/events/event-types.ts`:

```typescript
// Approval events
| 'approval:requested'
| 'approval:granted'
| 'approval:denied'
| 'approval:timeout'

// Spend events
| 'spend:threshold_warning'
| 'spend:threshold_exceeded'
| 'spend:resumed'

// Productivity events
| 'productivity:warning'
| 'productivity:nudge_sent'
| 'productivity:aborted'

// Check-in events
| 'checkin:sent'
| 'checkin:response'

// Circuit breaker events
| 'circuit:warning'
| 'circuit:tripped'
| 'circuit:reset'

// New payload types
export interface ApprovalRequestedPayload {
  taskId: string;
  taskTitle: string;
  estimatedCost: { min: number; max: number };
  messageTs: string;
}

export interface ApprovalGrantedPayload {
  taskId: string;
  userId: string;
  responseTime: number; // ms
}

export interface SpendThresholdExceededPayload {
  windowMinutes: number;
  spend: number;
  threshold: number;
  pausedAgents: string[];
}

export interface CircuitTrippedPayload {
  trigger: CircuitBreakerTrigger;
  details: Record<string, unknown>;
  pausedAgents: string[];
}
```

---

## 10. Database Schema Changes

### 10.1 New Table: `tc_approval_log`
```sql
CREATE TABLE tc_approval_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id),
  request_type TEXT NOT NULL, -- 'task_start', 'startup', 'spend_resume', 'circuit_reset'
  message_ts TEXT NOT NULL,
  thread_ts TEXT,
  status TEXT NOT NULL, -- 'pending', 'approved', 'denied', 'timeout', 'expired'
  user_id TEXT,
  response_text TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_tc_approval_log_task ON tc_approval_log(task_id);
CREATE INDEX idx_tc_approval_log_status ON tc_approval_log(status);
CREATE INDEX idx_tc_approval_log_message ON tc_approval_log(message_ts);
```

### 10.2 New Table: `tc_circuit_breaker_events`
```sql
CREATE TABLE tc_circuit_breaker_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger TEXT NOT NULL, -- 'consecutive_errors', 'budget_exceeded', etc.
  state TEXT NOT NULL, -- 'tripped', 'reset', 'warning'
  details JSONB NOT NULL,
  affected_agents TEXT[], -- Array of agent IDs
  user_id TEXT, -- Who reset it, if applicable
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tc_circuit_events_trigger ON tc_circuit_breaker_events(trigger);
CREATE INDEX idx_tc_circuit_events_state ON tc_circuit_breaker_events(state);
CREATE INDEX idx_tc_circuit_events_created ON tc_circuit_breaker_events(created_at DESC);
```

### 10.3 New Table: `tc_checkin_log`
```sql
CREATE TABLE tc_checkin_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_type TEXT NOT NULL, -- 'periodic', 'manual', 'startup'
  message_ts TEXT NOT NULL,
  data JSONB NOT NULL, -- Full CheckInData
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tc_checkin_log_type ON tc_checkin_log(checkin_type);
CREATE INDEX idx_tc_checkin_log_created ON tc_checkin_log(created_at DESC);
```

---

## 11. Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create configuration schema and database tables
- [ ] Implement `TaskApprovalManager` with basic approval flow
- [ ] Add approval integration to `Scheduler.scheduleNext()`
- [ ] Basic Slack message formatting for approvals
- [ ] Unit tests for approval flow

### Phase 2: Startup and Spend (Week 2)
- [ ] Implement `StartupConfirmationManager`
- [ ] Integrate startup confirmation into `MainLoop.start()`
- [ ] Implement `SpendMonitor` with basic threshold detection
- [ ] Connect spend monitoring to usage log creation
- [ ] Add spend alert Slack messages

### Phase 3: Productivity and Check-ins (Week 3)
- [ ] Implement `ProductivityMonitor`
- [ ] Add tool call and token tracking
- [ ] Implement `PeriodicCheckInManager`
- [ ] Create check-in message formatting
- [ ] Integration tests for monitoring flows

### Phase 4: Circuit Breaker and Polish (Week 4)
- [ ] Implement `CircuitBreaker` class
- [ ] Add error tracking to agent manager
- [ ] Budget monitoring integration
- [ ] Comprehensive Slack command support
- [ ] End-to-end integration tests
- [ ] Documentation and deployment guide

---

## 12. Error Handling

### 12.1 Slack Unavailability
When Slack is unavailable:
1. Log the error and continue retrying
2. Queue notifications for retry
3. If critical (circuit breaker, budget), pause agents locally
4. On reconnection, send summary of missed notifications

### 12.2 Database Unavailability
When database is unavailable:
1. Use in-memory state for approvals
2. Queue approval logs for later persistence
3. Continue enforcing thresholds from cached config
4. On reconnection, sync state

### 12.3 User Non-Response
When user doesn't respond within timeout:
1. Follow configured `timeoutAction`
2. Log the timeout
3. Send reminder notification
4. For critical thresholds, default to safe action (pause)

### 12.4 Conflicting Responses
When multiple users respond differently:
1. Use first response
2. Log all responses for audit
3. Notify other users of the outcome
4. Admin can override via `/tc admin override`

---

## Appendix A: Slash Commands

New commands to add to `/tc`:

```
/tc approve [task-id]     - Approve pending task
/tc reject [task-id]      - Reject pending task
/tc approvals             - List pending approvals
/tc spend                 - Show current spend window
/tc spend reset           - Reset spend tracking window
/tc budget                - Show budget status
/tc budget +N             - Increase budget by $N
/tc circuit               - Show circuit breaker status
/tc circuit reset         - Reset circuit breaker (requires confirmation)
/tc checkin               - Send immediate check-in
/tc checkin interval N    - Set check-in interval to N minutes
```

---

## Appendix B: Reaction Mappings

| Reaction | Meaning | Contexts |
|----------|---------|----------|
| :white_check_mark: | Approve/Continue | Task approval, spend alerts, circuit reset |
| :x: | Reject/Abort | Task approval, productivity alerts |
| :arrows_counterclockwise: | Defer/Later | Task approval (move to end of queue) |
| :octagonal_sign: | Emergency Stop | Any context (triggers circuit breaker) |
| :eyes: | Acknowledge/Seen | Check-ins, informational alerts |
| :hourglass: | Extend Timeout | Any approval (adds 5 more minutes) |

---

## Appendix C: Message Templates Repository

All message templates should be centralized in:
```
src/slack/templates/
  - task-approval.ts
  - startup-confirmation.ts
  - spend-alert.ts
  - productivity-alert.ts
  - periodic-checkin.ts
  - circuit-breaker.ts
```

Each template file exports formatting functions that accept structured data and return formatted Slack message strings. This allows for:
- Easy customization
- Consistent styling
- i18n support (future)
- Testing message formats independently
