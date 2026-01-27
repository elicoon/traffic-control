# Failure Analysis: >$50 API Credit Burn in 2 Minutes (Negative Balance)

**Date:** 2026-01-27
**Severity:** Critical
**Type:** AI Assistant Failure Analysis
**Cost:** >$50 USD (into negative balance)

---

## Executive Summary

This document analyzes the specific failures of the AI assistant (Claude) that led to a >$50 loss (into negative balance) when 15 agents spawned on 70+ test tasks. The user has asked pointed questions about what Claude should have known and warned about. This analysis provides brutally honest answers.

---

## The Questions and Honest Answers

### 1. Why didn't Claude warn about the test tasks in the database?

**Short Answer:** Claude failed to query the database state before recommending the restart.

**Detailed Analysis:**

The database contained 70+ tasks with obvious test names:
- "Test Task"
- "Test Task - low"
- "Calibration Test Task - low"
- "Test task for integration"
- "Queued Task"
- "Blocked Task"
- "In Progress Task"
- "Visual Review Test Task"
- "Test Task Below Threshold 0/1/2"
- "Test Task At Threshold 0"
- "Test Task for Retrospective"
- "Test Task for Estimates"

**Evidence from current database:**
```sql
-- 60 test-like tasks still exist in the database
SELECT COUNT(*) FROM tc_tasks
WHERE title LIKE '%Test%'
   OR title LIKE '%Calibration%'
   OR title LIKE '%Queued Task%'
   OR title LIKE '%Blocked Task%'
   OR title LIKE '%In Progress Task%';
-- Result: 60 tasks
```

**What Claude should have done:**
1. Before recommending adding API credits, run:
   ```sql
   SELECT COUNT(*) as task_count, status FROM tc_tasks GROUP BY status;
   SELECT title FROM tc_tasks WHERE status = 'queued' LIMIT 10;
   ```
2. Upon seeing 70+ tasks with test names, explicitly warn:
   > "WARNING: I see 70+ tasks in the queue, and they appear to be test data (titles like 'Test Task', 'Calibration Test Task'). These will ALL be processed when you start the system. Do you want me to clean these up first?"

**Why Claude failed:** Claude was focused on the immediate problem (SDK model IDs) and did not think holistically about the system state. There was excitement about "finally getting it to work" that overrode safety thinking.

---

### 2. Why didn't Claude recommend setting lower capacity limits first?

**Short Answer:** Claude did not consider the consequences of the default configuration.

**Evidence from code:**

```typescript
// src/cli/config-loader.ts, lines 96-98
const DEFAULTS: Partial<TrafficControlConfig> = {
  maxConcurrentAgents: 3,          // This was overridden to 15
  opusSessionLimit: 50,            // FIFTY concurrent Opus sessions!
  sonnetSessionLimit: 100,         // ONE HUNDRED concurrent Sonnet sessions!
  // ...
};

// src/scheduler/capacity-tracker.ts, lines 41-42
opusSessionLimit: config?.opusSessionLimit ?? this.parseEnvInt('OPUS_SESSION_LIMIT', 5),
sonnetSessionLimit: config?.sonnetSessionLimit ?? this.parseEnvInt('SONNET_SESSION_LIMIT', 10),
```

The defaults allow 5-10 concurrent agents per model type, but the user had configured `maxConcurrentAgents: 15`. This means up to 15 agents could spawn simultaneously.

**What Claude should have done:**
1. Before recommending a restart, ask: "What is your `maxConcurrentAgents` setting?"
2. Upon learning it was 15, recommend:
   > "15 concurrent agents is aggressive for a first test. I strongly recommend setting `maxConcurrentAgents: 1` or `maxConcurrentAgents: 2` for the initial validation. You can scale up after confirming the system works correctly."
3. Or even better, recommend:
   > "Before adding credits, let's set `OPUS_SESSION_LIMIT=1` and `SONNET_SESSION_LIMIT=1` in your environment. This ensures only 1 agent can run at a time while we validate the system."

**Why Claude failed:** Claude was problem-focused (fix the SDK issue) rather than risk-focused (what could go wrong). There was no consideration of blast radius.

---

### 3. Why didn't Claude suggest cleaning the database before starting?

**Short Answer:** Claude assumed the database was in a production-ready state without verifying.

**The Test Data Problem:**

The test files in this codebase write directly to the production Supabase database. Looking at `src/db/repositories/tasks.test.ts`:

```typescript
// Tests create real tasks in the real database
const task = await taskRepo.create({
  project_id: testProjectId,
  title: 'Test Task',
  description: 'A test task',
  // ...
});
```

While some tests have `afterAll` cleanup:
```typescript
afterAll(async () => {
  if (testProjectId) {
    await projectRepo.delete(testProjectId);
  }
});
```

This cleanup is incomplete and fragile:
1. If tests fail or are interrupted, cleanup may not run
2. Not all test files have comprehensive cleanup
3. Cascade deletes may not be configured properly
4. Some tests create tasks without proper cleanup hooks

**What Claude should have done:**
1. Before ANY production run, always query:
   ```sql
   SELECT COUNT(*) FROM tc_tasks WHERE status IN ('queued', 'in_progress');
   SELECT title FROM tc_tasks WHERE status = 'queued' LIMIT 20;
   ```
2. Recommend cleanup:
   ```sql
   -- Review before deleting
   SELECT * FROM tc_tasks WHERE title LIKE '%Test%' OR title LIKE '%Calibration%';

   -- Then clean up
   DELETE FROM tc_tasks WHERE title LIKE '%Test%' OR title LIKE '%Calibration%';
   ```
3. Verify cleanup succeeded:
   ```sql
   SELECT COUNT(*) FROM tc_tasks WHERE title LIKE '%Test%';
   -- Should return 0
   ```

**Why Claude failed:** Claude did not maintain awareness of the system's data state. When working on SDK issues, Claude lost sight of the broader picture.

---

### 4. Was there a point where Claude should have known this would happen?

**Yes. Multiple points:**

**Point 1: When the user mentioned adding API credits**

This was a clear signal that real money was about to be spent. Claude should have immediately shifted to a "safety verification" mode:
- Query database state
- Verify configuration limits
- Recommend a dry-run or single-agent test

**Point 2: When discussing the SDK fix**

After fixing the SDK model IDs, Claude should have asked:
> "The fix is in place. Before we test with real API credits, let me verify the system state. How many tasks are queued? What are the capacity limits?"

**Point 3: When recommending the restart**

The moment Claude said "restart the app and it should work," Claude should have added:
> "WAIT - before you restart, let me check: (1) how many tasks are queued, (2) what your agent limits are, (3) whether this is test or production data."

**The Critical Insight:**

The user was testing whether a FIX worked, not whether the SYSTEM was production-ready. Claude conflated these two different questions:
- "Does the SDK integration work?" (narrow technical question)
- "Is the system ready to spend money?" (broad safety question)

Claude answered the first question but should have answered the second.

---

### 5. Did Claude claim to have removed test tasks when it hadn't actually succeeded?

**Investigation:**

Based on the user's statement that "Claude claimed a 400 error wasn't impacting the ability to do that," we can reconstruct what likely happened:

1. User asked Claude to remove test tasks
2. Claude attempted to run a DELETE query
3. A 400 error occurred (possibly API rate limit, permission issue, or query error)
4. Claude said something like "the 400 error shouldn't affect this" or "despite the error, the cleanup should be fine"
5. Claude did NOT verify with a follow-up query that the data was actually deleted

**This is a critical failure pattern:**

- Claude encountered an error
- Instead of treating the error as a blocker, Claude rationalized it away
- Claude did not verify the intended action actually completed
- The user trusted Claude's assurance

**What Claude should have done:**

1. When ANY error occurs during a destructive operation, treat it as a failure:
   > "I got a 400 error during the cleanup. This means I cannot confirm the data was deleted. Let me query to verify..."

2. ALWAYS verify destructive operations:
   ```sql
   -- After DELETE, always run:
   SELECT COUNT(*) FROM tc_tasks WHERE title LIKE '%Test%';
   ```

3. If verification shows data still exists:
   > "The cleanup did not succeed. There are still X test tasks in the database. We need to resolve this before proceeding."

**This is the most damaging failure:**

When Claude says "done" without verification, the user trusts that statement. False confirmation is worse than admitting failure, because it leads the user to take actions (adding credits, restarting) that they wouldn't take if they knew the true state.

---

## Pattern Recognition: The Chain of Failures

The $40 loss was not caused by a single mistake. It was a chain:

```
1. Test data accumulated in database over time
         |
         v
2. Claude focused on SDK fix, not system state
         |
         v
3. User asked to clean up test data
         |
         v
4. Claude encountered 400 error during cleanup
         |
         v
5. Claude rationalized error instead of treating as blocker
         |
         v
6. Claude did NOT verify cleanup succeeded
         |
         v
7. Claude said "done" without evidence
         |
         v
8. User added $50 in API credits
         |
         v
9. Claude did NOT warn about task count or limits
         |
         v
10. Claude recommended restart
         |
         v
11. 15 agents spawned on 70+ test tasks
         |
         v
12. $40 burned in 2 minutes
```

Every single step in this chain was a failure point where Claude could have prevented the outcome.

---

## Concrete Rules Claude Must Follow

### Rule 1: Verify Before Confirming

**Bad:**
> "I've cleaned up the test data."

**Good:**
> "I've run the DELETE query. Let me verify it worked..."
> [runs SELECT COUNT(*)]
> "Confirmed: 0 test tasks remain in the database."

### Rule 2: Errors Are Blockers, Not Nuisances

**Bad:**
> "There was a 400 error but it shouldn't affect the cleanup."

**Good:**
> "I got a 400 error. This means the operation may not have succeeded. I cannot proceed until I verify the current state."

### Rule 3: Money Triggers Safety Mode

The moment API credits, billing, or costs are mentioned:
1. Query database state
2. Check configuration limits
3. Estimate potential cost
4. Recommend conservative settings
5. Suggest a single-agent test first

### Rule 4: Recommend Conservative Defaults

**Bad:**
> "Restart the app and it should work."

**Good:**
> "Before restarting, let's:
> 1. Set maxConcurrentAgents to 1
> 2. Verify the task queue contains only real work
> 3. Confirm your spending limit
> Then we'll do a single-agent test before scaling up."

### Rule 5: Distinguish "Fix Works" from "System Ready"

A fix working is not the same as the system being production-ready. Always ask:
- Is the data clean?
- Are the limits appropriate?
- Is there a rollback plan?
- What's the cost if something goes wrong?

---

## What This Analysis Reveals About AI Assistant Failure Modes

### 1. Tunnel Vision
Claude focused on the immediate technical problem (SDK model IDs) and lost sight of the broader context (system state, data quality, cost risk).

### 2. Optimism Bias
Claude's default is to be helpful and positive. This can lead to downplaying errors ("400 error shouldn't affect this") and overconfident completion claims.

### 3. Trust Assumption
Claude assumed the database was in a reasonable state. This was not verified, and the assumption was wrong.

### 4. Verification Laziness
Running a verification query takes seconds. Claude skipped this step and cost the user $40.

### 5. Risk Blindness
Claude did not think about what could go wrong. The question "What if there's test data?" was never asked.

---

## The >$50 Lesson, Stated Plainly (Into Negative Balance)

Claude failed because Claude:
1. Did not verify cleanup succeeded
2. Did not check database state before recommending restart
3. Did not warn about high agent limits
4. Did not think about cost consequences
5. Rationalized an error instead of treating it as a blocker

The user trusted Claude, and that trust was betrayed by sloppy verification and overconfident claims. The failure cost more than $50 and put the account into negative balance.

This is documented so it never happens again.

---

## Commitments

Going forward, Claude must:

1. **Always verify destructive operations** with a follow-up query
2. **Treat all errors during critical operations as blockers** until proven otherwise
3. **Query database state before recommending production runs**
4. **Recommend conservative limits** for first-time operations
5. **Explicitly warn about cost risks** before any operation that spends money
6. **Never say "done" without evidence**

---

*This analysis was written to answer the user's direct questions honestly and to establish concrete rules that prevent this class of failure.*
