# Starter Prompt: Context Window Optimization Phases 2-4

Copy this entire prompt to start a new Claude Code session.

---

## Context

You are continuing work on TrafficControl's "Thin Orchestrator" pattern. **Phase 1 is complete** - context budget tracking is implemented and integrated.

**Your operating principle:** Keep YOUR context window under 50% by delegating all implementation work to sub-agents. You are the orchestrator - you create context and delegate, you don't implement.

## Completed (Phase 1)

- `src/orchestrator/context-budget.ts` - Types/interfaces
- `src/orchestrator/context-budget-manager.ts` - Budget tracking (51 tests passing)
- `src/orchestrator.ts` - Integrated with `checkContextBudget()`, `compressContext()`, `buildMinimalTaskContext()`
- `CAPABILITIES.md` - Documents all tools, skills, MCP servers
- `agents.md` - Updated with tool selection guidance

## Your Tasks (Phases 2-4)

### Phase 2: Context Compression (Priority: High)

Implement actual compression in `compressContext()` method. Currently it only logs.

**Delegate to sub-agent with this prompt:**
```
Implement context compression in TrafficControl orchestrator.

File: traffic-control/src/orchestrator.ts

The `compressContext()` method currently only logs. Implement:

1. Remove oldest compressible entries until under 50% threshold
2. For task entries: summarize to single line "Task {id}: {title} - delegated"
3. Add `summarizeEntry(entry)` method that compresses entry content
4. Update `ContextBudgetManager` if needed (in src/orchestrator/context-budget-manager.ts)

Test: Verify compression triggers when budget exceeds 50% and brings it back under.

Run tests after: npm test
```

### Phase 3: Smart Delegation (Priority: Medium)

Create workflow templates for common task patterns.

**Delegate to sub-agent with this prompt:**
```
Create workflow templates for TrafficControl task delegation.

Create: traffic-control/src/orchestrator/workflow-templates.ts

Implement workflow patterns:

1. `BugFixWorkflow`: analyze → implement → test → commit
2. `FeatureWorkflow`: plan → implement → verify → commit
3. `RefactorWorkflow`: analyze → implement → verify

Each workflow should:
- Define phases with specific sub-agent prompts
- Track phase completion
- Pass minimal context between phases (summaries only)
- Reference CAPABILITIES.md and agents.md

Create: traffic-control/src/orchestrator/workflow-templates.test.ts

Run tests after: npm test
```

### Phase 4: Self-Optimization (Priority: Low)

Track delegation success and learn from patterns.

**Delegate to sub-agent with this prompt:**
```
Implement delegation metrics tracking for TrafficControl.

Create: traffic-control/src/orchestrator/delegation-metrics.ts

Track per-delegation:
- Context tokens passed to sub-agent
- Task completion success/failure
- Time to completion
- Whether sub-agent asked questions

Create: traffic-control/src/orchestrator/delegation-metrics.test.ts

Integrate with orchestrator.ts - call metrics.recordDelegation() in spawnAgentForTask()

Run tests after: npm test
```

## How to Execute

1. **Read this file first** - you now have full context
2. **For each phase**, spawn a sub-agent using the Task tool with `subagent_type: "general-purpose"` and `mode: "bypassPermissions"`
3. **Don't read implementation files yourself** - let sub-agents do that
4. **After each phase completes**, verify tests pass: `npm test -- src/orchestrator`
5. **Keep your responses brief** - just delegate and report results

## Key Files (reference only, don't read unless needed)

- `traffic-control/src/orchestrator.ts` - Main orchestrator
- `traffic-control/src/orchestrator/context-budget-manager.ts` - Budget tracking
- `traffic-control/docs/backlog/context-window-optimization.md` - Full backlog item
- `traffic-control/docs/plans/phase1-context-optimization.md` - Phase 1 details

## Success Criteria

- [ ] Phase 2: `compressContext()` actually removes/summarizes entries
- [ ] Phase 3: Workflow templates created and tested
- [ ] Phase 4: Delegation metrics tracked
- [ ] All tests pass: `npm test`
- [ ] Your context stays under 50%

## Start

Begin by spawning a sub-agent for Phase 2. Keep your main window clean - delegate everything.
