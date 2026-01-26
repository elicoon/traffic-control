# Phase 1: Context Window Optimization - Implementation Plan

**Status:** Ready for Implementation
**Priority:** High
**Estimated Complexity:** Medium
**Parent Backlog Item:** [context-window-optimization.md](../backlog/context-window-optimization.md)

---

## Objective

Implement context budget monitoring and establish the "thin orchestrator" pattern foundation. The orchestrator should track its context utilization and warn when approaching the 50% threshold.

## Prerequisites

- [ ] Create CAPABILITIES.md documenting all available tools, skills, and MCP servers
- [ ] Ensure agents.md references the capabilities documentation

## Implementation Tasks

### Task 1: Context Budget Types and Interfaces

**File:** `src/orchestrator/context-budget.ts` (new)

```typescript
export interface ContextBudget {
  /** Maximum tokens available (e.g., 200k for Claude) */
  maxTokens: number;

  /** Target utilization threshold (0.5 = 50%) */
  targetUtilization: number;

  /** Current estimated token usage */
  currentEstimate: number;

  /** Timestamp of last estimation */
  lastEstimated: Date;
}

export interface ContextEntry {
  /** Unique identifier for this context chunk */
  id: string;

  /** Category: 'system' | 'task' | 'response' | 'history' */
  category: 'system' | 'task' | 'response' | 'history';

  /** Estimated token count */
  tokens: number;

  /** When this context was added */
  addedAt: Date;

  /** Whether this can be summarized/compressed */
  compressible: boolean;

  /** Reference to task/session if applicable */
  referenceId?: string;
}

export interface ContextBudgetConfig {
  maxTokens?: number;          // Default: 200000
  targetUtilization?: number;  // Default: 0.5
  warningThreshold?: number;   // Default: 0.4 (warn at 40%)
  tokensPerChar?: number;      // Default: 0.25 (rough estimate)
}
```

### Task 2: Context Budget Manager

**File:** `src/orchestrator/context-budget-manager.ts` (new)

Implement a manager that:
1. Tracks all context entries added to the orchestrator
2. Estimates token usage using character count heuristics
3. Provides warnings when approaching thresholds
4. Suggests compression strategies when budget is tight

```typescript
export class ContextBudgetManager {
  private entries: Map<string, ContextEntry> = new Map();
  private config: Required<ContextBudgetConfig>;

  constructor(config?: ContextBudgetConfig);

  /** Add a context entry and get updated budget status */
  addEntry(entry: Omit<ContextEntry, 'id' | 'addedAt'>): ContextBudget;

  /** Remove a context entry (e.g., when task completes) */
  removeEntry(id: string): void;

  /** Get current budget status */
  getBudget(): ContextBudget;

  /** Check if we're within safe operating range */
  isWithinBudget(): boolean;

  /** Check if we should warn about approaching limit */
  shouldWarn(): boolean;

  /** Get entries that can be compressed to free up space */
  getCompressibleEntries(): ContextEntry[];

  /** Estimate tokens for a string */
  estimateTokens(text: string): number;

  /** Get summary of context usage by category */
  getUsageByCategory(): Record<string, number>;
}
```

### Task 3: Integrate with Orchestrator

**File:** `src/orchestrator.ts` (modify)

Add context budget tracking to the existing orchestrator:

```typescript
// Add to constructor
this.contextBudget = new ContextBudgetManager({
  maxTokens: 200000,
  targetUtilization: 0.5,
  warningThreshold: 0.4
});

// Add to tick() or wherever context accumulates
private checkContextBudget(): void {
  if (this.contextBudget.shouldWarn()) {
    console.warn('[Orchestrator] Context budget warning: approaching 50% utilization');
    // Log detailed breakdown
    const usage = this.contextBudget.getUsageByCategory();
    console.warn('[Orchestrator] Context by category:', usage);
  }

  if (!this.contextBudget.isWithinBudget()) {
    console.error('[Orchestrator] Context budget exceeded! Triggering compression...');
    this.compressContext();
  }
}

private compressContext(): void {
  const compressible = this.contextBudget.getCompressibleEntries();
  // For Phase 1: Just log what would be compressed
  // Phase 2 will implement actual compression/summarization
  console.log(`[Orchestrator] ${compressible.length} entries available for compression`);
}
```

### Task 4: Context-Aware Task Delegation

When spawning sub-agents, the orchestrator should:
1. Calculate the minimal context needed for the task
2. Track what context was passed to each sub-agent
3. Not retain full task details in orchestrator memory

**File:** `src/orchestrator.ts` (modify spawnAgentForTask)

```typescript
private async spawnAgentForTask(task: Task, model: ModelType): Promise<string> {
  // Build minimal context for sub-agent
  const taskContext = this.buildMinimalTaskContext(task);

  // Track that we delegated this (not the full context)
  this.contextBudget.addEntry({
    category: 'task',
    tokens: this.contextBudget.estimateTokens(
      `Delegated task ${task.id} to ${model} agent`
    ),
    compressible: true,
    referenceId: task.id
  });

  // Spawn with minimal context
  const sessionId = await this.agentManager.spawnAgent(task.id, {
    model,
    projectPath: process.cwd(),
    systemPrompt: taskContext
  });

  return sessionId;
}

private buildMinimalTaskContext(task: Task): string {
  // Only include what the sub-agent needs
  // Reference files by path, not content
  // Include success criteria
  // Include available tools/capabilities reference
  return `
You are working on: ${task.title}

## Task Description
${task.description || 'No additional description.'}

## Success Criteria
- Task marked complete in the system
- All tests pass
- Changes committed to git

## Available Capabilities
See CAPABILITIES.md for available tools, skills, and MCP servers.

## Guidelines
See agents.md for behavioral guidelines.
`.trim();
}
```

### Task 5: Metrics and Logging

Add context budget metrics to the orchestrator's reporting:

```typescript
getStats() {
  return {
    ...this.scheduler.getStats(),
    contextBudget: {
      current: this.contextBudget.getBudget(),
      usageByCategory: this.contextBudget.getUsageByCategory(),
      isWithinBudget: this.contextBudget.isWithinBudget()
    }
  };
}
```

### Task 6: Unit Tests

**File:** `src/orchestrator/context-budget-manager.test.ts` (new)

Test cases:
- Token estimation accuracy (within reasonable margin)
- Budget threshold detection
- Entry addition and removal
- Category-based usage tracking
- Compression candidate identification

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/orchestrator/context-budget.ts` | Create | Types and interfaces |
| `src/orchestrator/context-budget-manager.ts` | Create | Budget management logic |
| `src/orchestrator/context-budget-manager.test.ts` | Create | Unit tests |
| `src/orchestrator/index.ts` | Create | Module exports |
| `src/orchestrator.ts` | Modify | Integrate budget tracking |
| `CAPABILITIES.md` | Create | Document available tools |
| `agents.md` | Modify | Reference capabilities |

## Definition of Done

- [ ] ContextBudgetManager class implemented with full test coverage
- [ ] Orchestrator tracks context usage during operation
- [ ] Warning logs appear when approaching 50% threshold
- [ ] Stats endpoint includes context budget information
- [ ] CAPABILITIES.md documents all available tools/skills/MCP servers
- [ ] agents.md updated to reference capabilities
- [ ] All existing tests continue to pass
- [ ] Manual verification: run orchestrator and observe context logging

## Out of Scope (Future Phases)

- Automatic context compression/summarization (Phase 2)
- Smart prompt generation based on task type (Phase 3)
- Learning from delegation patterns (Phase 4)

## Parallel Execution Opportunities

This phase can be split into parallel tasks:

1. **Context Budget Core** (Tasks 1-2, 6): Types, manager, and tests
2. **Orchestrator Integration** (Tasks 3-5): Modify existing orchestrator
3. **Documentation** (Prerequisites): CAPABILITIES.md and agents.md updates

---

## Starter Prompts for Parallel Execution

### Prompt 1: Context Budget Core Implementation

```
You are implementing the context budget tracking system for TrafficControl.

**Context:**
- TrafficControl is an orchestrator that manages Claude Code sub-agents
- We need to track context window utilization to keep it under 50%
- This prevents performance degradation from overloaded context

**Your Task:**
Create the following files in `trafficControl/src/orchestrator/`:

1. `context-budget.ts` - Types and interfaces for context tracking
2. `context-budget-manager.ts` - Manager class that:
   - Tracks context entries by category (system, task, response, history)
   - Estimates token usage (use ~0.25 tokens per character as heuristic)
   - Provides budget status and warnings
   - Identifies compressible entries
3. `context-budget-manager.test.ts` - Comprehensive unit tests
4. `index.ts` - Module exports

**Success Criteria:**
- All tests pass
- Token estimation is within reasonable accuracy
- Budget thresholds trigger appropriate warnings
- Code follows existing TypeScript patterns in the codebase

**Reference:** See trafficControl/docs/plans/phase1-context-optimization.md for detailed specifications.
```

### Prompt 2: Orchestrator Integration

```
You are integrating context budget tracking into the TrafficControl orchestrator.

**Context:**
- TrafficControl orchestrates Claude Code sub-agents for task execution
- We've implemented a ContextBudgetManager (in src/orchestrator/)
- Now we need to integrate it into the main orchestrator

**Your Task:**
Modify `trafficControl/src/orchestrator.ts` to:

1. Import and initialize ContextBudgetManager in constructor
2. Add `checkContextBudget()` method called during tick()
3. Modify `spawnAgentForTask()` to:
   - Build minimal context (don't pass full file contents)
   - Track delegated tasks in budget manager
   - Reference CAPABILITIES.md and agents.md instead of inline docs
4. Add context budget to `getStats()` output
5. Add warning logs when approaching 50% threshold

**Success Criteria:**
- Orchestrator tracks context during operation
- Warnings appear when approaching budget limit
- Stats include context budget information
- Existing tests continue to pass
- Sub-agents receive minimal, focused context

**Reference:** See trafficControl/docs/plans/phase1-context-optimization.md for detailed specifications.
```

### Prompt 3: Capabilities Documentation

```
You are documenting the available tools and capabilities for TrafficControl agents.

**Context:**
- TrafficControl spawns Claude Code sub-agents to execute tasks
- Sub-agents need to know what tools, skills, and MCP servers are available
- Currently there's no documentation of these capabilities

**Your Task:**
1. Create `trafficControl/CAPABILITIES.md` documenting:
   - Available MCP servers (Supabase, Playwright, Google Calendar, Google Drive, etc.)
   - Available skills (frontend-design, code-review, brainstorming, etc.)
   - Built-in tools (Read, Write, Edit, Glob, Grep, Bash, etc.)
   - When to use each capability
   - Examples of effective usage

2. Update `trafficControl/agents.md` to:
   - Reference CAPABILITIES.md
   - Add section on "Selecting the Right Tool"

**Success Criteria:**
- Comprehensive documentation of all available capabilities
- Clear guidance on when to use each tool
- Agents can reference this to make informed decisions
- Documentation is accurate for the current environment

**Reference:** Look at the MCP servers and skills available in the current Claude Code session.
```
