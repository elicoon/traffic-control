# Retrospective: >$50 API Cost Burn Incident (Negative Balance)

**Date:** 2026-01-27
**Severity:** Critical (Financial Impact)
**Category:** Cost Control, Configuration, Test Data Management
**Cost Impact:** >$50 burned in ~2 minutes (into negative balance)

---

## Executive Summary

TrafficControl orchestrator spawned 15 concurrent agents that consumed MORE than $50 in API credits in approximately 2 minutes while processing 70+ test tasks from the database, resulting in a NEGATIVE credit balance with Anthropic. The system worked exactly as designed - the fundamental problem was missing safeguards for cost control, test data isolation, and production readiness.

---

## What Happened

### The Setup
1. SDK integration was debugged and model IDs corrected
2. $50 in API credits added to test the system
3. System started without reviewing database state

### The Explosion
1. MainLoop started and found 70+ queued tasks in `tc_tasks`
2. CapacityTracker showed capacity for 15 agents (5 Opus + 10 Sonnet)
3. Scheduler immediately scheduled all available capacity
4. 15 agents began processing meaningless test data simultaneously
5. Burn rate: ~$20/minute
6. Manual intervention after ~2 minutes saved remaining $10

### Timeline
```
T+0:00  System starts, validates DB connection
T+0:01  MainLoop begins polling (5s interval)
T+0:02  First tick: 15 tasks scheduled, 15 agents spawned
T+0:10  All 15 agents active, processing test tasks
T+1:00  ~$25+ burned, no alerts triggered
T+2:00  >$50 burned (into negative balance), user notices and stops system
```

---

## Root Causes

### 1. No Budget Enforcement
**Problem:** The `BudgetTracker` class exists but was not integrated into the MainLoop or Scheduler.

**Evidence:**
- `src/analytics/budget-tracker.ts` has budget checking capability
- `MainLoop.tick()` never calls budget validation
- `Scheduler.scheduleNext()` has no cost checks

**Code Gap:**
```typescript
// main-loop.ts - tick() method has no budget check
private async tick(): Promise<void> {
  if (!this.running || this.paused) return;

  // MISSING: Budget check before scheduling
  // Should be: if (await this.isOverBudget()) return;

  if (this.deps.scheduler.canSchedule()) {
    const result = await this.deps.scheduler.scheduleNext();
    // ...
  }
}
```

### 2. Default Capacity Limits Too High
**Problem:** Default limits allow 15 concurrent agents (5 Opus + 10 Sonnet)

**Evidence:**
```typescript
// capacity-tracker.ts
this.config = {
  opusSessionLimit: config?.opusSessionLimit ?? this.parseEnvInt('OPUS_SESSION_LIMIT', 5),
  sonnetSessionLimit: config?.sonnetSessionLimit ?? this.parseEnvInt('SONNET_SESSION_LIMIT', 10),
};

// main-loop.ts
const DEFAULT_CONFIG: OrchestrationConfig = {
  maxConcurrentAgents: 5,  // Not actually enforced against model limits
  // ...
};
```

**The Real Issue:** `maxConcurrentAgents: 5` is misleading because `OPUS_SESSION_LIMIT=5` + `SONNET_SESSION_LIMIT=10` = 15 total possible agents.

### 3. Test Data Not Cleaned
**Problem:** 70+ test tasks existed in `tc_tasks` with status='queued'

**How It Got There:**
- Development and testing used the production database
- Test runs created tasks but never deleted them
- No cleanup in test teardown (tests use mocks, not real DB)

**Evidence:** Test files use mocks, not real cleanup:
```typescript
// integration.test.ts
afterEach(async () => {
  // Only cleans up temp files, not database
  await fs.rm(tempDir, { recursive: true, force: true });
});
```

### 4. No Pre-Flight Validation
**Problem:** System starts without warning about database state

**Missing Check:**
```typescript
// Should exist in start() method
async validateBeforeStart(): Promise<ValidationResult> {
  const queuedTasks = await this.taskRepo.getQueued();
  const estimatedCost = await this.estimateCost(queuedTasks);

  return {
    taskCount: queuedTasks.length,
    estimatedCost,
    warnings: estimatedCost > COST_WARNING_THRESHOLD ? ['High cost operation'] : [],
  };
}
```

### 5. No Real-Time Cost Tracking
**Problem:** Cost is logged but not monitored in real-time

**Evidence:**
- `UsageLogRepository` tracks costs retroactively
- No circuit breaker based on burn rate
- No alerts integrated with Slack

---

## Why It Happened

### Contributing Factors

1. **Momentum After Debugging**
   - Excitement about "fixing" the SDK issues
   - Desire to see the system actually work
   - Skipped normal validation steps

2. **False Confidence in "Test" Mode**
   - Assumed adding credits meant "testing"
   - No actual test mode or dry-run capability
   - Production behavior with test mindset

3. **Mixed Development/Production Environment**
   - Same Supabase database for dev and prod
   - No environment separation
   - Test data accumulated over time

4. **Missing Observability**
   - No dashboard showing real-time spend
   - No Slack alerts for unusual activity
   - Could only observe via Anthropic console (too late)

---

## Prevention: Concrete Code Changes

### 1. Integrate Budget Enforcement into MainLoop

**File:** `src/orchestrator/main-loop.ts`

**Changes Required:**

```typescript
// Add to OrchestrationConfig
export interface OrchestrationConfig {
  // ... existing fields
  /** Maximum hourly spend in USD before auto-pause */
  maxHourlySpendUsd: number;
  /** Maximum daily spend in USD before auto-pause */
  maxDailySpendUsd: number;
  /** Whether to require confirmation for operations over threshold */
  requireConfirmationOverUsd: number;
}

// Add to DEFAULT_CONFIG
const DEFAULT_CONFIG: OrchestrationConfig = {
  // ... existing defaults
  maxHourlySpendUsd: 10,
  maxDailySpendUsd: 50,
  requireConfirmationOverUsd: 5,
};

// Add to OrchestrationDependencies
export interface OrchestrationDependencies {
  // ... existing deps
  budgetTracker: BudgetTracker;
  costTracker: CostTracker;
}

// Add budget check to tick()
private async tick(): Promise<void> {
  if (!this.running || this.paused) return;

  // NEW: Check budget before scheduling
  const budgetStatus = await this.checkBudgetStatus();
  if (budgetStatus.shouldPause) {
    await this.pause();
    await this.notifyBudgetExceeded(budgetStatus);
    return;
  }

  // ... rest of existing tick logic
}

// NEW: Budget status check method
private async checkBudgetStatus(): Promise<BudgetCheckResult> {
  const hourlySpend = await this.deps.budgetTracker.getSpendingForPeriod(
    new Date(Date.now() - 3600000), // Last hour
    new Date()
  );

  const dailySpend = await this.deps.budgetTracker.getSpendingForPeriod(
    new Date(Date.now() - 86400000), // Last 24 hours
    new Date()
  );

  return {
    hourlySpend,
    dailySpend,
    shouldPause: hourlySpend >= this.config.maxHourlySpendUsd ||
                 dailySpend >= this.config.maxDailySpendUsd,
    reason: hourlySpend >= this.config.maxHourlySpendUsd
      ? 'Hourly spend limit exceeded'
      : 'Daily spend limit exceeded',
  };
}
```

### 2. Add Cost Circuit Breaker

**File:** `src/scheduler/cost-circuit-breaker.ts` (NEW)

```typescript
export interface CircuitBreakerConfig {
  /** Maximum cost per minute before tripping */
  maxCostPerMinute: number;
  /** Number of minutes to look back */
  windowMinutes: number;
  /** How long to stay open (ms) */
  openDurationMs: number;
  /** Callback when circuit trips */
  onTrip?: (reason: string) => void;
}

export class CostCircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private openedAt: Date | null = null;
  private costHistory: Array<{ timestamp: Date; cost: number }> = [];

  constructor(private config: CircuitBreakerConfig) {}

  recordCost(cost: number): void {
    this.costHistory.push({ timestamp: new Date(), cost });
    this.pruneOldEntries();
    this.checkTrip();
  }

  isOpen(): boolean {
    if (this.state === 'open' && this.openedAt) {
      const elapsed = Date.now() - this.openedAt.getTime();
      if (elapsed > this.config.openDurationMs) {
        this.state = 'half-open';
      }
    }
    return this.state === 'open';
  }

  private checkTrip(): void {
    const recentCost = this.costHistory.reduce((sum, entry) => sum + entry.cost, 0);
    const costPerMinute = recentCost / this.config.windowMinutes;

    if (costPerMinute > this.config.maxCostPerMinute) {
      this.trip(`Cost rate ${costPerMinute.toFixed(2)}/min exceeds limit ${this.config.maxCostPerMinute}/min`);
    }
  }

  private trip(reason: string): void {
    this.state = 'open';
    this.openedAt = new Date();
    this.config.onTrip?.(reason);
  }

  private pruneOldEntries(): void {
    const cutoff = Date.now() - (this.config.windowMinutes * 60000);
    this.costHistory = this.costHistory.filter(e => e.timestamp.getTime() > cutoff);
  }
}
```

### 3. Lower Default Capacity Limits

**File:** `src/scheduler/capacity-tracker.ts`

```typescript
// Change defaults from 5/10 to 1/2 for safety
this.config = {
  opusSessionLimit: config?.opusSessionLimit ?? this.parseEnvInt('OPUS_SESSION_LIMIT', 1),
  sonnetSessionLimit: config?.sonnetSessionLimit ?? this.parseEnvInt('SONNET_SESSION_LIMIT', 2),
};
```

**File:** `src/orchestrator/main-loop.ts`

```typescript
const DEFAULT_CONFIG: OrchestrationConfig = {
  maxConcurrentAgents: 2,  // Down from 5
  // ...
};
```

### 4. Add Dry Run Mode

**File:** `src/orchestrator/main-loop.ts`

```typescript
export interface OrchestrationConfig {
  // ... existing fields
  /** Dry run mode - log what would happen without executing */
  dryRun: boolean;
}

// In tick():
private async tick(): Promise<void> {
  // ... existing checks

  if (this.deps.scheduler.canSchedule()) {
    const result = await this.deps.scheduler.scheduleNext(
      this.config.dryRun ? this.dryRunSpawnCallback : undefined
    );

    if (this.config.dryRun && result.status === 'scheduled') {
      log.info('[DRY RUN] Would have scheduled tasks', {
        tasks: result.tasks?.map(t => ({ taskId: t.taskId, model: t.model })),
      });
      // Don't actually track these as scheduled
      return;
    }
    // ... rest of logic
  }
}

private dryRunSpawnCallback: SpawnCallback = async (task, model) => {
  log.info('[DRY RUN] Would spawn agent', {
    taskId: task.id,
    taskTitle: task.title,
    model,
    estimatedCost: await this.estimateTaskCost(task, model),
  });
  return `dry-run-${task.id}`;
};
```

### 5. Add Pre-Flight Checks

**File:** `src/orchestrator/pre-flight.ts` (NEW)

```typescript
export interface PreFlightCheckResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
    severity: 'info' | 'warning' | 'error';
  }>;
  summary: {
    queuedTaskCount: number;
    estimatedCost: number;
    testDataDetected: boolean;
    budgetAvailable: number;
  };
}

export async function runPreFlightChecks(
  taskRepo: TaskRepository,
  budgetTracker: BudgetTracker,
  costTracker: CostTracker
): Promise<PreFlightCheckResult> {
  const checks: PreFlightCheckResult['checks'] = [];

  // Check 1: Queued task count
  const queuedTasks = await taskRepo.getQueued();
  const taskCountCheck = {
    name: 'Queued Task Count',
    passed: queuedTasks.length <= 10,
    message: `${queuedTasks.length} tasks in queue`,
    severity: queuedTasks.length > 50 ? 'error' :
              queuedTasks.length > 10 ? 'warning' : 'info' as const,
  };
  checks.push(taskCountCheck);

  // Check 2: Test data detection
  const testDataPatterns = ['test', 'sample', 'example', 'placeholder', 'todo'];
  const suspiciousTasks = queuedTasks.filter(t =>
    testDataPatterns.some(p => t.title.toLowerCase().includes(p))
  );
  checks.push({
    name: 'Test Data Detection',
    passed: suspiciousTasks.length === 0,
    message: suspiciousTasks.length > 0
      ? `Found ${suspiciousTasks.length} tasks with test-like names`
      : 'No test data detected',
    severity: suspiciousTasks.length > 0 ? 'warning' : 'info',
  });

  // Check 3: Cost estimation
  const estimatedCost = await estimateTotalCost(queuedTasks, costTracker);
  checks.push({
    name: 'Estimated Cost',
    passed: estimatedCost <= 20,
    message: `Estimated cost: $${estimatedCost.toFixed(2)}`,
    severity: estimatedCost > 50 ? 'error' :
              estimatedCost > 20 ? 'warning' : 'info',
  });

  // Check 4: Budget availability
  const dailyBudget = await budgetTracker.getGlobalBudgetStatus('daily');
  const budgetAvailable = dailyBudget?.remainingUsd ?? Infinity;
  checks.push({
    name: 'Budget Availability',
    passed: budgetAvailable >= estimatedCost,
    message: budgetAvailable === Infinity
      ? 'No daily budget configured'
      : `$${budgetAvailable.toFixed(2)} remaining in daily budget`,
    severity: budgetAvailable < estimatedCost ? 'error' :
              !dailyBudget ? 'warning' : 'info',
  });

  return {
    passed: checks.every(c => c.severity !== 'error'),
    checks,
    summary: {
      queuedTaskCount: queuedTasks.length,
      estimatedCost,
      testDataDetected: suspiciousTasks.length > 0,
      budgetAvailable,
    },
  };
}

async function estimateTotalCost(
  tasks: Task[],
  costTracker: CostTracker
): Promise<number> {
  const opusTasks = tasks.filter(t => t.estimated_sessions_opus > 0).length;
  const sonnetTasks = tasks.length - opusTasks;

  const estimate = await costTracker.estimateCost({
    opusSessions: opusTasks,
    sonnetSessions: sonnetTasks,
  });

  return estimate.totalCost;
}
```

### 6. Add Confirmation Prompts

**File:** `src/cli/commands/start.ts`

```typescript
export async function startCommand(config: Config, options: StartOptions): Promise<void> {
  // Run pre-flight checks
  const preFlightResult = await runPreFlightChecks(taskRepo, budgetTracker, costTracker);

  // Display summary
  console.log('\n=== Pre-Flight Check Results ===\n');
  for (const check of preFlightResult.checks) {
    const icon = check.passed ? '✓' : check.severity === 'error' ? '✗' : '⚠';
    console.log(`${icon} ${check.name}: ${check.message}`);
  }

  // Require confirmation for warnings
  if (!preFlightResult.passed || preFlightResult.summary.estimatedCost > 5) {
    console.log(`\n⚠️  Estimated cost: $${preFlightResult.summary.estimatedCost.toFixed(2)}`);
    console.log(`   Queued tasks: ${preFlightResult.summary.queuedTaskCount}`);

    if (!options.force) {
      const confirmed = await confirm('Continue with these settings?');
      if (!confirmed) {
        console.log('Aborted.');
        return;
      }
    }
  }

  // Proceed with start
  await mainLoop.start();
}
```

### 7. Add Real-Time Cost Monitoring

**File:** `src/analytics/real-time-monitor.ts` (NEW)

```typescript
export class RealTimeMonitor {
  private costs: Array<{ timestamp: number; cost: number }> = [];
  private alertThresholds: { warn: number; critical: number };
  private alertCallback?: (level: string, message: string) => void;

  constructor(config: {
    warnThresholdPerMinute: number;
    criticalThresholdPerMinute: number;
    onAlert?: (level: string, message: string) => void;
  }) {
    this.alertThresholds = {
      warn: config.warnThresholdPerMinute,
      critical: config.criticalThresholdPerMinute,
    };
    this.alertCallback = config.onAlert;
  }

  recordCost(cost: number): void {
    this.costs.push({ timestamp: Date.now(), cost });
    this.checkThresholds();
    this.pruneOldData();
  }

  getBurnRate(): number {
    const oneMinuteAgo = Date.now() - 60000;
    const recentCosts = this.costs.filter(c => c.timestamp > oneMinuteAgo);
    return recentCosts.reduce((sum, c) => sum + c.cost, 0);
  }

  private checkThresholds(): void {
    const burnRate = this.getBurnRate();

    if (burnRate >= this.alertThresholds.critical) {
      this.alertCallback?.('critical', `Burn rate $${burnRate.toFixed(2)}/min exceeds critical threshold`);
    } else if (burnRate >= this.alertThresholds.warn) {
      this.alertCallback?.('warn', `Burn rate $${burnRate.toFixed(2)}/min exceeds warning threshold`);
    }
  }

  private pruneOldData(): void {
    const fiveMinutesAgo = Date.now() - 300000;
    this.costs = this.costs.filter(c => c.timestamp > fiveMinutesAgo);
  }
}
```

### 8. Clean Test Data After Test Runs

**File:** `src/db/test-utils.ts` (NEW)

```typescript
export async function cleanTestData(client: SupabaseClient): Promise<number> {
  const testPatterns = ['test', 'sample', 'example', 'placeholder', 'mock'];

  let totalDeleted = 0;

  for (const pattern of testPatterns) {
    const { data, error } = await client
      .from('tc_tasks')
      .delete()
      .ilike('title', `%${pattern}%`)
      .select('id');

    if (!error && data) {
      totalDeleted += data.length;
    }
  }

  return totalDeleted;
}

// Add to test setup
export function setupTestCleanup(client: SupabaseClient): void {
  // Run after each integration test
  afterEach(async () => {
    if (process.env.CLEAN_TEST_DATA === 'true') {
      await cleanTestData(client);
    }
  });
}
```

---

## Process Changes

### Pre-Flight Checklist (Before Any Production Run)

Add to `CLAUDE.md`:

```markdown
## Pre-Flight Checklist

Before starting TrafficControl in production:

1. **Review Database State**
   ```sql
   SELECT COUNT(*), status FROM tc_tasks GROUP BY status;
   SELECT title FROM tc_tasks WHERE status = 'queued' LIMIT 10;
   ```

2. **Clean Test Data**
   ```sql
   DELETE FROM tc_tasks WHERE title ILIKE '%test%' OR title ILIKE '%sample%';
   ```

3. **Verify Budget Settings**
   ```sql
   SELECT * FROM tc_budgets WHERE project_id IS NULL;
   ```

4. **Check Capacity Limits**
   - Verify `OPUS_SESSION_LIMIT` and `SONNET_SESSION_LIMIT` in `.env`
   - Default should be 1-2, not 5-10

5. **Run Dry Mode First**
   ```bash
   npm run start -- --dry-run
   ```

6. **Confirm Costs Before Start**
   - Review estimated cost from pre-flight checks
   - Confirm you want to proceed if cost > $5
```

### Environment Separation

1. **Create separate Supabase projects**
   - `trafficcontrol-dev` for development
   - `trafficcontrol-prod` for production

2. **Use environment-specific `.env` files**
   - `.env.development` with low limits
   - `.env.production` with production settings

3. **Add environment validation**
   ```typescript
   if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_URL?.includes('prod')) {
     throw new Error('Production environment must use production database');
   }
   ```

### Mandatory Code Review Items

For any PR touching scheduling or cost-related code:

1. [ ] Are there spending limits enforced?
2. [ ] Is there a circuit breaker for runaway costs?
3. [ ] Can this change cause unlimited agent spawning?
4. [ ] Are default values safe (low, not high)?
5. [ ] Is there a dry-run mode available?
6. [ ] Are costs logged before operations?

---

## Metrics for Prevention

Track these metrics going forward:

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Cost per minute | < $2 | > $5 |
| Concurrent agents | 1-3 | > 5 |
| Tasks before start | < 10 | > 50 |
| Test data in queue | 0 | > 0 |
| Pre-flight checks passed | 100% | < 100% |

---

## Summary of Required Changes

### Files to Create
- `src/scheduler/cost-circuit-breaker.ts`
- `src/orchestrator/pre-flight.ts`
- `src/analytics/real-time-monitor.ts`
- `src/db/test-utils.ts`

### Files to Modify
- `src/orchestrator/main-loop.ts` - Add budget integration, dry-run mode
- `src/scheduler/capacity-tracker.ts` - Lower default limits
- `src/cli/commands/start.ts` - Add confirmation prompts
- `CLAUDE.md` - Add pre-flight checklist

### Environment Changes
- `.env` - Lower default `OPUS_SESSION_LIMIT` and `SONNET_SESSION_LIMIT`
- Create environment separation (dev vs prod databases)

---

## Lessons Learned

1. **Cost controls must be in place BEFORE the system can spend money** - Not after the first expensive incident.

2. **Default values should be safe, not optimal** - Start with 1-2 agents, not 10-15.

3. **Test data is a liability** - Either clean it or use separate environments.

4. **"It works" is not the same as "it's ready"** - A system that executes perfectly on garbage data is worse than one that doesn't start.

5. **Observability is mandatory** - If you can't see what's happening in real-time, you can't stop problems in time.

6. **Pre-flight checks are not optional** - Every production run should validate database state and estimate costs.

---

*This retrospective documents a >$50 lesson (resulting in negative balance) in why cost controls, safe defaults, and pre-flight validation are non-negotiable features for any system that can spend money autonomously.*
