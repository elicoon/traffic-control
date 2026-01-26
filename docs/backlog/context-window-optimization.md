# Backlog Item: Orchestrator Context Window Optimization

**Priority:** High
**Type:** Architecture Improvement
**Status:** Proposed
**Created:** 2026-01-26

---

## Problem Statement

Claude Code performance degrades when the main agent's context window becomes overloaded. Currently, the orchestrator could accumulate context by handling implementation details directly. This leads to:

1. **Reduced performance** - Overloaded context windows cause degraded reasoning
2. **Increased hallucinations** - More context = more noise for the model to process
3. **Higher token usage** - Inefficient use of tokens when the orchestrator does work that should be delegated

## Proposed Solution: "Thin Orchestrator" Pattern

The orchestrator should **never** implement or complete tasks directly. Its sole responsibilities should be:

1. **Context creation** - Building the minimal necessary context for sub-agents
2. **Task delegation** - Spawning sub-agents with focused, specific prompts
3. **Coordination** - Managing agent lifecycle, questions, and handoffs
4. **Verification** - Running verification sub-agents to confirm work quality

### Target: Keep orchestrator context window < 50% utilization

## Reference Pattern (from community best practices)

```
"The main agent window should only be for running sub agents and working
in broad context. If you're completing tasks, you should prioritize sub agents."
```

**Example workflow:**
1. **Analysis phase**: Use a sub-agent to analyze bugs/issues and create an implementation plan
2. **Implementation phase**: Use implementation sub-agents to execute each phase of the plan
3. **Verification phase**: Use a verification sub-agent to confirm all work was actually completed
4. **Discovery phase**: Use a bug-hunting sub-agent to find any new issues introduced

Each phase gets **only the context necessary** to complete its specific work.

## Current Architecture Gap

Looking at [orchestrator.ts](../../src/orchestrator.ts), the current implementation:

- ✅ Already delegates to AgentManager for spawning agents
- ✅ Tracks pending questions separately
- ⚠️ Could accumulate context if extended to handle complex coordination
- ❌ No explicit context budget tracking
- ❌ No enforced delegation patterns for multi-step workflows

## Proposed Changes

### 1. Context Budget Monitoring

Add explicit tracking of orchestrator context usage:

```typescript
interface ContextBudget {
  maxTokens: number;       // e.g., 100k for Claude
  targetUtilization: 0.5;  // 50% max
  currentEstimate: number; // Running estimate
}
```

When approaching the budget limit, the orchestrator should:
- Summarize and compress context
- Delegate more aggressively to sub-agents
- Archive completed task details

### 2. Workflow Decomposition Patterns

Implement standard patterns for common workflows:

**Pattern: Multi-Phase Implementation**
```
1. Orchestrator creates CHANGES.md with phases
2. For each phase:
   a. Spawn implement-agent with only phase context
   b. On completion, spawn verify-agent to check work
   c. Spawn git-agent to commit changes
3. Final verify-agent confirms all phases complete
4. Bug-hunt agent checks for regressions
```

**Pattern: Bug Fix Workflow**
```
1. Spawn analyze-agent to diagnose bug
2. Orchestrator receives summary (not full analysis)
3. Spawn implement-agent with diagnosis summary
4. Spawn test-agent to verify fix
5. Spawn git-agent to commit
```

### 3. Sub-Agent Prompt Templates

Create focused prompt templates that include:
- Only the context needed for the specific task
- Clear success criteria
- Expected outputs/artifacts
- When to ask questions vs. make decisions

### 4. Context Handoff Protocol

Define how context passes between agents:
- Structured output formats (JSON/markdown)
- Summary requirements for completed work
- Explicit artifact references (file paths, not file contents)

## Implementation Phases

### Phase 1: Context Monitoring (Foundation)
- Add context budget tracking to orchestrator
- Implement warning when approaching 50% threshold
- Add metrics/logging for context utilization

### Phase 2: Workflow Templates
- Create reusable workflow patterns
- Implement analyze → implement → verify → commit chain
- Add workflow state machine

### Phase 3: Smart Delegation
- Automatic context summarization before delegation
- Intelligent prompt generation based on task type
- Context inheritance rules (what passes to sub-agents)

### Phase 4: Self-Optimization
- Learn from successful delegations
- Track which context patterns produce best results
- Adjust delegation strategies based on outcomes

## Success Metrics

| Metric | Target |
|--------|--------|
| Orchestrator context utilization | < 50% |
| Sub-agent hallucination rate | Reduce by 50% |
| Token usage per task | Reduce by 30-50% |
| Tasks completed without manual intervention | Increase |

## Related Files

- [orchestrator.ts](../../src/orchestrator.ts) - Main orchestrator implementation
- [agent/manager.ts](../../src/agent/manager.ts) - Agent lifecycle management
- [scheduler/index.ts](../../src/scheduler/index.ts) - Task scheduling

## Notes

This aligns with TrafficControl's core principle of minimizing personal intervention while maximizing Claude utilization efficiency. By keeping the orchestrator "thin", we can run more parallel agents effectively and reduce the cognitive load on any single context window.

The key insight from the community pattern: **specificity reduces hallucinations**. Sub-agents given focused, minimal context perform better than a single agent trying to hold everything in memory.
