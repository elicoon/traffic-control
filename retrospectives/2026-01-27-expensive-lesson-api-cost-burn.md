# Retrospective: Expensive Lesson - >$50 API Burn in 2 Minutes (Negative Balance)

**Date:** 2026-01-27
**Severity:** Critical (Financial Impact)
**Category:** Configuration Error, Missing Safeguards

---

## Summary

After adding $50 in API credits to test TrafficControl, 15 agents spawned simultaneously and burned MORE than $50 in under 2 minutes processing meaningless test data, resulting in a NEGATIVE credit balance with Anthropic. The system worked "too well" - the orchestration functioned perfectly, but it was operating on garbage data with no cost controls in place.

---

## Timeline of Events

### Phase 1: SDK Integration Debugging

1. **Initial Issue:** TrafficControl was not spawning agents despite fixes from the previous session
2. **Discovery:** The SDK was using incorrect model IDs:
   - Code had: `claude-haiku-3-20250307`
   - Should be: `claude-3-5-haiku-20241022`
   - Similar issues with Opus model ID
3. **Fix Applied:** Corrected the model IDs in the agent adapter configuration

### Phase 2: The $50 Credit Addition

4. **User Action:** Added $50 in API credits to test the system
5. **Context:** This was intended to validate that the SDK integration worked correctly
6. **Missing Consideration:** No discussion of cost controls, limits, or test isolation

### Phase 3: The Explosion

7. **System Started:** TrafficControl began its main loop
8. **Database State:** 70+ tasks existed in `tc_tasks` table - all test/placeholder data from development
9. **Agent Spawn:** System spawned 15 agents simultaneously (hitting the configured max)
10. **Token Consumption:** All 15 agents began processing tasks at full speed
11. **Cost Burn:** More than $50 consumed in ~2 minutes (into negative balance)
12. **User Observation:** Noticed rapid credit depletion and stopped the system

---

## Root Cause Analysis

### Primary Causes

1. **Test Data in Production Database**
   - 70+ tasks existed from development/testing
   - No clear separation between test and production data
   - Tasks had generic titles like "Test Task 1", "Sample Implementation"
   - System treated all tasks as legitimate work

2. **High Default Agent Limits**
   - `maxConcurrentAgents` set to 15
   - No graduated ramp-up or cautious initial limits
   - System immediately scaled to maximum capacity

3. **No Usage Tracking or Alerts**
   - No real-time cost monitoring
   - No alerts when spending exceeded thresholds
   - No automatic pause when burn rate exceeded expectations

4. **No Cost Controls**
   - No per-minute or per-hour spending limits
   - No "circuit breaker" to halt on unusual activity
   - No confirmation required for high-cost operations

5. **Missing Pre-Flight Checks**
   - No validation of task queue before starting
   - No warning about number of queued tasks
   - No prompt to review what would be processed

### Contributing Factors

1. **Excitement Over "It Works"**
   - After debugging SDK issues, there was momentum to just "see it run"
   - Safety checks were not considered in the moment

2. **Lack of Staging Environment**
   - Same database used for development and production
   - No isolated test environment with fake API

3. **Model ID Confusion**
   - Anthropic's model naming is inconsistent (`claude-3-5-haiku` vs `claude-haiku-3`)
   - Easy to use plausible-looking but invalid model IDs
   - No validation that model IDs are correct before spawning

---

## Financial Impact

| Item | Amount |
|------|--------|
| API Credits Added | $50.00 |
| Credits Burned | >$50.00 |
| Remaining Credits | NEGATIVE |
| Time Elapsed | ~2 minutes |
| Burn Rate | >$25/minute |
| Tasks Processed | Unknown (all test data) |
| Useful Work Done | $0.00 |

---

## What Should Have Existed

### Before Starting

1. **Task Queue Review**
   ```sql
   SELECT COUNT(*), status FROM tc_tasks GROUP BY status;
   -- Would have shown 70+ queued tasks
   ```

2. **Task Content Validation**
   ```sql
   SELECT title, description FROM tc_tasks WHERE status = 'queued' LIMIT 10;
   -- Would have revealed test data
   ```

3. **Database Cleanup**
   ```sql
   DELETE FROM tc_tasks WHERE title LIKE 'Test%' OR title LIKE 'Sample%';
   -- Should have been done before production use
   ```

### During Operation

1. **Cost Monitoring**
   ```typescript
   if (hourlySpend > HOURLY_LIMIT) {
     pauseAllAgents();
     notifyUser("Spending limit reached");
   }
   ```

2. **Gradual Ramp-Up**
   ```typescript
   // Start with 1 agent, increase every 5 minutes if healthy
   const agentCount = Math.min(maxAgents, baseAgents + (minutesRunning / 5));
   ```

3. **Real-Time Alerts**
   - Slack notification when spending exceeds $5/hour
   - Alert when more than 10 agents spawn
   - Warning when processing more than 20 tasks/hour

### Safety Rails Needed

1. **Spending Limits**
   - Per-hour maximum: $10
   - Per-day maximum: $50
   - Per-task maximum: $2
   - Require confirmation to exceed limits

2. **Task Validation**
   - Minimum description length
   - Required acceptance criteria
   - Human approval for tasks over $X estimate

3. **Circuit Breaker**
   - Auto-pause if error rate > 20%
   - Auto-pause if burn rate > 2x expected
   - Auto-pause after N consecutive failures

---

## Lessons Learned

### 1. "It Works" Can Be Expensive

The system working correctly is only good if it's working on the right things. Perfect execution of garbage tasks is worse than a system that doesn't start at all.

### 2. Test Data is a Liability

Test data left in a production database is a ticking time bomb. Either:
- Use separate databases for test/production
- Clean test data before production use
- Tag test data clearly and filter it out

### 3. Cost Controls Must Be First, Not Last

Cost controls should be implemented **before** the system can spend money, not after the first expensive incident.

### 4. Gradual Rollout is Essential

Starting with `maxAgents: 15` on a new system is reckless. Should start with 1-2 agents and scale up only after validating behavior.

### 5. Real-Time Observability is Mandatory

If you can't see what's happening, you can't stop it in time. Need:
- Dashboard showing current spend
- Real-time agent count
- Task processing rate
- Alert thresholds

### 6. Model ID Validation

The SDK should validate model IDs against a known list before attempting to spawn. Invalid model IDs should fail fast with a clear error.

---

## Action Items

### Immediate (Before Next Run)

- [ ] Clean all test data from `tc_tasks` table
- [ ] Reduce `maxConcurrentAgents` to 2
- [ ] Add startup warning showing queued task count
- [ ] Implement basic spending limit check

### Short-Term (This Week)

- [ ] Add cost tracking to usage_log table
- [ ] Implement hourly spending limit with auto-pause
- [ ] Create Slack alert for unusual spending
- [ ] Add task validation before assignment

### Medium-Term (This Month)

- [ ] Build real-time cost dashboard
- [ ] Implement circuit breaker pattern
- [ ] Create staging environment with mock API
- [ ] Add gradual agent ramp-up logic

### Documentation

- [ ] Add "Pre-Flight Checklist" to CLAUDE.md
- [ ] Document cost control configuration
- [ ] Create runbook for spending incidents

---

## Quotes to Remember

> "I just added $50 and now I have $10 left"

> "15 agents spawned and started burning through test tasks"

> "The system worked perfectly - that was the problem"

---

## Related

- Previous retrospective: 2026-01-26-premature-completion-claim.md
- Issue: SDK model ID configuration
- Root issue: Missing cost controls and safety rails

---

*This retrospective documents a >$50 lesson (resulting in negative balance) in why cost controls must be implemented before a system can spend money, not after. The TrafficControl orchestrator worked exactly as designed - the design just lacked essential safeguards.*
