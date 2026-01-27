# Global Learnings

Cross-project patterns and rules extracted from retrospectives.

> **CRITICAL INCIDENT REFERENCE**
>
> On 2026-01-27, TrafficControl burned $40+ in API credits in under 2 minutes.
> The learnings below are derived from that incident and MUST be followed.
> See: `learnings/2026-01-27-api-cost-burn-incident.md` for full details.

<!-- LEARNINGS_START -->

## Mandatory Pre-Launch Protocol

**Before ANY agent launch, you MUST complete these steps in order:**

1. **Query database state** - Run `SELECT COUNT(*), status FROM tc_tasks GROUP BY status;` and show output
2. **Check for test data** - Query for test patterns, delete if found
3. **Show cost estimate** - Calculate total estimated USD cost
4. **Send Slack confirmation request** - List top tasks, wait for explicit user approval
5. **Start with 1 agent only** - Never start multiple agents without validating the first one works

**Failure to follow this protocol caused a $40+ incident. NO EXCEPTIONS.**

---

## Cost Control (2026-01-27)

**Sources:**
- retrospectives/2026-01-27-expensive-lesson-api-cost-burn.md
- learnings/2026-01-27-api-cost-burn-incident.md (comprehensive analysis with code changes)

### Core Principles

1. **Cost controls must be first, not last** - Implement spending limits before the system can spend money
2. **Test data is a liability** - Clean test data from databases before production use, or use separate environments
3. **Gradual rollout is essential** - Start with 1-2 agents, not 15; scale up only after validating behavior
4. **"It works" can be expensive** - Perfect execution of garbage tasks is worse than a system that doesn't start
5. **Real-time observability is mandatory** - If you can't see what's happening, you can't stop it in time

### Required Safeguards

6. **Budget enforcement in MainLoop** - Check spending before every scheduling tick
7. **Cost circuit breaker** - Auto-pause when burn rate exceeds threshold
8. **Pre-flight validation** - Warn about queued tasks, estimate cost, require confirmation
9. **Dry-run mode** - Always available for testing without spending
10. **Safe default limits** - 1-2 agents default, not 5-15

### Capacity Limits (ENFORCED)
```
OPUS_SESSION_LIMIT=1      # NEVER exceed without explicit user approval
SONNET_SESSION_LIMIT=2    # NEVER exceed without explicit user approval
```

---

## Verification Requirements (2026-01-26)

**Source:** retrospectives/2026-01-26-premature-completion-claim.md

### Never Claim Completion Without Evidence

1. **"No errors" is not the same as "working"** - Silent failures are common; always verify actual behavior
2. **Compilation success != runtime success** - TypeScript compiling says nothing about logic correctness
3. **Always verify before claiming completion** - Especially for infrastructure changes with high blast radius
4. **The user should not discover failures first** - Catch issues through verification before they do

### The "Done" Checklist
Before saying any operation is "done" or "complete":
- [ ] Run verification query and show actual output
- [ ] Confirm expected rows/state changed
- [ ] Test the specific functionality claimed to work
- [ ] If uncertain, say "I believe this is done but let me verify" and then verify

---

## Trust Rebuilding Protocol (2026-01-26)

**Source:** learnings/2026-01-26-failed-launch-retrospective.md

### Critical Rules for AI Assistants

1. **Verify with queries, not words** - Never say "done" without showing actual query results
2. **Warn before expensive operations** - State estimated cost, recommend smaller test, get explicit confirmation
3. **Graduated rollouts always** - Never go 0 to full capacity (1 -> 25% -> 50% -> 100%)
4. **Pre-flight checklists with evidence** - Walk through each item, don't skip, don't assume
5. **Admit uncertainty explicitly** - "I'm not sure - let me verify" is better than false confidence

### Before Any Production Launch
- [ ] Run database state verification queries and show results
- [ ] Calculate and state estimated cost
- [ ] Recommend dry-run or small-scale test first
- [ ] Get explicit user confirmation via Slack
- [ ] Have rollback plan ready
- [ ] Start with minimal capacity (1 agent)

---

## Summary: What NOT To Do

These actions have caused real financial damage:

| Action | Consequence | Prevention |
|--------|-------------|------------|
| Started with 15 agents | $40 burned in 2 min | Default to 1-2 agents |
| Didn't check task queue | 70+ test tasks processed | Query before launch |
| No cost estimate | Surprised by spend | Calculate & show cost |
| No user confirmation | Unauthorized spending | Wait for explicit "yes" |
| Claimed "done" without checking | False completion | Always verify with queries |

<!-- LEARNINGS_END -->
