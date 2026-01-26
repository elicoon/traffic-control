# Phase 6: HYPERVELOCITY Implementation Plan

**Date:** 2026-01-26
**Phase:** 6 - Closed-Loop Acceleration
**Prerequisites:** Phase 5 completed (orchestrator, CLI, event bus, Slack integration)
**Source:** Lessons learned from [HYPERVELOCITY.md](https://github.com/dandriscoll/dandriscoll/blob/main/HYPERVELOCITY.md)

---

## Executive Summary

This phase implements five key improvements derived from the HYPERVELOCITY manifesto to transform TrafficControl from a capable orchestration system into a true **closed-loop development engine**. The core insight:

> "A mediocre model in a closed loop outperforms a strong model without feedback."
> The constraint is **verification capacity**, not intelligence.

---

## Gap Analysis

| HYPERVELOCITY Principle | TC Current State | Priority |
|------------------------|------------------|----------|
| Verification-driven development | ❌ Agents don't run tests automatically | **P0** |
| Total machine observability | ⚠️ Console logs only, not searchable | **P1** |
| Self-directed iteration | ⚠️ Blocks on Slack for every question | **P1** |
| CLI-first tooling | ⚠️ npm scripts only, no dedicated CLI | **P2** |
| Specs-first workflow | ⚠️ Plans exist but not enforced | **P2** |

---

## Implementation Components

### Component 1: Test Verification Loop (P0 - Critical)
**Impact:** Very High | **Effort:** Medium

Ensures agents verify their own work before claiming completion.

### Component 2: Searchable Trace Logging (P1)
**Impact:** High | **Effort:** Medium

Enables agents to learn from detailed history of past attempts.

### Component 3: Question Knowledge Base (P1)
**Impact:** High | **Effort:** Medium-High

Reduces Slack blocking by auto-answering previously-seen questions.

### Component 4: TC CLI Enhancement (P2)
**Impact:** Medium | **Effort:** Medium

Native CLI interface for LLM-friendly operations.

### Component 5: Specs-First Enforcement (P2)
**Impact:** Medium | **Effort:** Low

Mandates planning documents for complex tasks.

---

## Dispatcher Prompt

```
## Your Mission

You are executing Phase 6 of TrafficControl - the HYPERVELOCITY Closed-Loop Implementation. Your job is to dispatch 5 parallel subagents to implement the five Phase 6 components, then coordinate their completion.

**Working directory:** `c:\Users\Eli\portfolio-website\trafficControl`

**Current State:**
- Phases 1-5 complete with tests passing
- TypeScript builds clean
- Orchestrator, CLI, Event Bus, and Slack integration implemented

**Your Role:** Dispatcher/coordinator - you will NOT write code directly. You will:
1. Read this plan document thoroughly
2. Dispatch 5 subagents in parallel using the Task tool
3. Monitor their progress and handle any questions
4. Run final integration tests after all complete
5. Commit all work

## Step 1: Dispatch Subagents

Use the Task tool to dispatch these 5 subagents **in parallel** (single message with 5 Task tool calls). Use the detailed prompts in the sections below.

## Step 2: Monitor Progress

After dispatching, monitor subagent progress. If any ask questions:
- Answer based on context from this document
- Ensure they follow TDD approach
- Remind them to integrate with existing event bus

## Step 3: Final Integration

Once all 5 subagents complete:

1. **Run build and tests:**
   ```bash
   cd c:/Users/Eli/portfolio-website/trafficControl
   npm run build
   npm test
   ```

2. **Create integration test** in `src/hypervelocity/integration.test.ts` that:
   - Verifies test loop runs before completion
   - Traces are searchable
   - Question KB answers cached questions
   - CLI commands work
   - Specs enforcement triggers for complex tasks

3. **Run code review** using the code-reviewer subagent

4. **Final commit:**
   ```bash
   git add .
   git commit -m "feat(trafficcontrol): implement HYPERVELOCITY closed-loop system

   - Test verification loop (agents verify before completing)
   - Searchable trace logging (MCP-style query interface)
   - Question knowledge base (auto-answer cached Q&A)
   - Enhanced TC CLI (LLM-native operations)
   - Specs-first enforcement (plans required for complex tasks)

   Phase 6 complete. All tests passing.

   Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
   ```

5. **Push to GitHub:**
   ```bash
   git push origin master
   ```

## Success Criteria

Phase 6 is complete when:
- All new tests pass
- TypeScript builds clean
- Agents automatically run tests before completing
- Traces are searchable via TraceQuery interface
- Question KB reduces Slack questions by >30% (measured)
- CLI provides all core operations
- Complex tasks require planning docs
```

---

## Instance 1: Test Verification Loop

### Context
You are implementing the critical test verification loop for TrafficControl. This is the highest-priority HYPERVELOCITY improvement - it ensures agents verify their own work through automated testing before claiming task completion.

**HYPERVELOCITY principle:** "Verification defines correctness. Untested areas remain probabilistic."

### Your Task
Build the verification system that:
1. Requires agents to run `npm test` and `npm run build` before completion
2. Parses test/build results to detect failures
3. Triggers automatic retry (up to 3 attempts) on failure
4. Only emits completion event when verification passes
5. Marks task as blocked if all retries fail

### Files to Create
- `src/verification/verification-runner.ts` - Runs verification commands
- `src/verification/result-parser.ts` - Parses test/build output
- `src/verification/retry-manager.ts` - Manages retry logic
- `src/verification/verification-config.ts` - Configuration
- `src/verification/index.ts` - Module exports
- Tests for each file

### Key Interfaces
```typescript
interface VerificationConfig {
  testCommand: string;           // Default: 'npm test'
  buildCommand: string;          // Default: 'npm run build'
  maxRetries: number;            // Default: 3
  timeoutMs: number;             // Default: 300000 (5 min)
  requiredForCompletion: boolean; // Default: true
}

interface VerificationResult {
  success: boolean;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  buildSuccess: boolean;
  errors: string[];
  duration: number;
  attempt: number;
}

interface VerificationState {
  taskId: string;
  agentId: string;
  attempts: VerificationResult[];
  finalStatus: 'passed' | 'failed' | 'pending';
}

class VerificationRunner {
  constructor(config: VerificationConfig);

  async runVerification(taskId: string, agentId: string, workingDir: string): Promise<VerificationResult>;
  async runWithRetry(taskId: string, agentId: string, workingDir: string): Promise<VerificationState>;

  // Hook into agent completion flow
  shouldAllowCompletion(state: VerificationState): boolean;
}

class ResultParser {
  parseTestOutput(output: string): TestResults;
  parseBuildOutput(output: string): BuildResults;
  extractErrors(output: string): string[];
}

class RetryManager {
  constructor(maxRetries: number);

  shouldRetry(state: VerificationState): boolean;
  getRetryDelay(attempt: number): number;  // Exponential backoff
  recordAttempt(state: VerificationState, result: VerificationResult): void;
}
```

### Integration Points
- Import `EventBus` from `src/events/event-bus.ts`
- Emit events: `verification:started`, `verification:passed`, `verification:failed`, `verification:retry`
- Hook into `AgentManager` completion flow in `src/agent/manager.ts`
- Store verification results in `tc_verification_results` table

### Database Schema Addition
```sql
CREATE TABLE tc_verification_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id),
  agent_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  tests_passed INTEGER DEFAULT 0,
  tests_failed INTEGER DEFAULT 0,
  tests_skipped INTEGER DEFAULT 0,
  build_success BOOLEAN DEFAULT false,
  errors JSONB DEFAULT '[]',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_verification_task ON tc_verification_results(task_id);
```

### Agent Prompt Injection
Add to every agent's task context:
```typescript
const verificationPrompt = `
## Verification Requirements (MANDATORY)

Before completing this task, you MUST:
1. Run \`npm test\` - ALL tests must pass
2. Run \`npm run build\` - NO compilation errors

If either fails:
- Fix the issues in your code
- Re-run verification
- Repeat until passing (up to 3 attempts)

⚠️ DO NOT claim completion until verification passes.
⚠️ If you cannot fix after 3 attempts, report as blocked.
`;
```

### TDD Approach
1. Test result parsing (various output formats)
2. Test retry logic with exponential backoff
3. Test integration with agent completion flow
4. Test event emission
5. Test database persistence

### Commit Message
```
feat(verification): add test verification loop

- VerificationRunner executes tests before completion
- ResultParser extracts test/build results
- RetryManager handles automatic retry with backoff
- Hooks into AgentManager completion flow
- Events: verification:started/passed/failed/retry
```

---

## Instance 2: Searchable Trace Logging

### Context
You are implementing searchable trace logging for TrafficControl. This enables agents to learn from detailed history of past attempts, not just summarized learnings.

**HYPERVELOCITY principle:** "Implement devlogs and MCP servers for trace logging to searchable indexes."

### Your Task
Build the trace logging system that:
1. Logs every significant agent action with full context
2. Stores traces in a searchable format
3. Provides a query interface agents can use to search history
4. Links traces via correlation IDs for request tracing

### Files to Create
- `src/traces/trace-logger.ts` - Records traces
- `src/traces/trace-store.ts` - Database persistence
- `src/traces/trace-query.ts` - Search interface
- `src/traces/trace-types.ts` - Type definitions
- `src/traces/index.ts` - Module exports
- Tests for each file

### Key Interfaces
```typescript
interface Trace {
  id: string;
  sessionId: string;
  taskId: string;
  correlationId: string;
  timestamp: Date;

  // What happened
  actionType: TraceActionType;
  actionInput: Record<string, unknown>;
  actionOutput: Record<string, unknown>;

  // Context
  durationMs: number;
  success: boolean;
  errorMessage?: string;

  // Searchable metadata
  tags: string[];
  category: string;
}

type TraceActionType =
  | 'tool_call'
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'bash_command'
  | 'test_run'
  | 'build_run'
  | 'question_asked'
  | 'answer_received'
  | 'subagent_spawn'
  | 'completion_attempt'
  | 'error_occurred';

interface TraceQuery {
  taskId?: string;
  sessionId?: string;
  actionType?: TraceActionType;
  category?: string;
  tags?: string[];
  searchText?: string;      // Full-text search
  timeRange?: { start: Date; end: Date };
  success?: boolean;
  limit?: number;
  offset?: number;
}

interface TraceQueryResult {
  traces: Trace[];
  totalCount: number;
  hasMore: boolean;
}

class TraceLogger {
  constructor(store: TraceStore, eventBus: EventBus);

  // Main logging method
  async log(trace: Omit<Trace, 'id' | 'timestamp'>): Promise<string>;

  // Convenience methods
  async logToolCall(sessionId: string, taskId: string, tool: string, input: unknown, output: unknown, durationMs: number): Promise<void>;
  async logError(sessionId: string, taskId: string, error: Error, context: Record<string, unknown>): Promise<void>;
  async logQuestion(sessionId: string, taskId: string, question: string): Promise<void>;
  async logAnswer(sessionId: string, taskId: string, answer: string): Promise<void>;

  // Correlation
  startCorrelation(): string;
  withCorrelation(correlationId: string, fn: () => Promise<void>): Promise<void>;
}

class TraceStore {
  constructor(supabase: SupabaseClient);

  async insert(trace: Trace): Promise<string>;
  async query(query: TraceQuery): Promise<TraceQueryResult>;
  async getByCorrelation(correlationId: string): Promise<Trace[]>;

  // Cleanup
  async pruneOlderThan(days: number): Promise<number>;
}

class TraceQuery {
  constructor(store: TraceStore);

  // Agent-friendly search interface
  async searchSimilarProblems(description: string, limit?: number): Promise<Trace[]>;
  async getApproachesForTask(taskPattern: string): Promise<Trace[]>;
  async getErrorsForFile(filePath: string): Promise<Trace[]>;
  async getSuccessfulPatterns(category: string): Promise<Trace[]>;
}
```

### Database Schema Addition
```sql
CREATE TABLE tc_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  task_id UUID REFERENCES tc_tasks(id),
  correlation_id TEXT,
  timestamp TIMESTAMPTZ DEFAULT now(),

  action_type TEXT NOT NULL,
  action_input JSONB DEFAULT '{}',
  action_output JSONB DEFAULT '{}',

  duration_ms INTEGER,
  success BOOLEAN DEFAULT true,
  error_message TEXT,

  tags TEXT[] DEFAULT '{}',
  category TEXT,

  -- Full-text search
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(action_type, '') || ' ' ||
      coalesce(error_message, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(array_to_string(tags, ' '), '')
    )
  ) STORED
);

CREATE INDEX idx_traces_session ON tc_traces(session_id);
CREATE INDEX idx_traces_task ON tc_traces(task_id);
CREATE INDEX idx_traces_correlation ON tc_traces(correlation_id);
CREATE INDEX idx_traces_action ON tc_traces(action_type);
CREATE INDEX idx_traces_timestamp ON tc_traces(timestamp DESC);
CREATE INDEX idx_traces_search ON tc_traces USING GIN(search_vector);
```

### Integration Points
- Subscribe to EventBus events and auto-log
- Hook into AgentManager tool calls
- Provide TraceQuery to agents via system prompt

### Agent Prompt Injection
```typescript
const traceQueryPrompt = `
## Historical Context Available

You can search past agent traces to learn from previous attempts:
- Search by task pattern: "authentication", "database migration", etc.
- Search by error type to see how similar errors were resolved
- Search by file path to see what approaches worked

Use this to avoid repeating failed approaches.
`;
```

### TDD Approach
1. Test trace insertion and retrieval
2. Test full-text search
3. Test correlation ID linking
4. Test query filtering
5. Test pruning old traces

### Commit Message
```
feat(traces): add searchable trace logging

- TraceLogger records all agent actions
- TraceStore persists to Supabase with full-text search
- TraceQuery provides agent-friendly search interface
- Correlation IDs link related traces
- Auto-logs from EventBus subscriptions
```

---

## Instance 3: Question Knowledge Base

### Context
You are implementing the Question Knowledge Base for TrafficControl. This reduces Slack blocking by caching and auto-answering previously-seen questions.

**HYPERVELOCITY principle:** "Humans must resist intervening in individual problems and instead build systemic automated solutions."

### Your Task
Build the Question KB that:
1. Stores all Q&A pairs from Slack interactions
2. Computes similarity between new questions and cached ones
3. Auto-answers if similarity exceeds threshold
4. Tracks hit rates and escalation patterns
5. Falls back to Slack only for truly novel questions

### Files to Create
- `src/knowledge/question-store.ts` - Stores Q&A pairs
- `src/knowledge/similarity-matcher.ts` - Computes question similarity
- `src/knowledge/auto-responder.ts` - Decides when to auto-answer
- `src/knowledge/kb-metrics.ts` - Tracks hit rates
- `src/knowledge/index.ts` - Module exports
- Tests for each file

### Key Interfaces
```typescript
interface QuestionAnswer {
  id: string;
  question: string;
  questionEmbedding?: number[];  // For semantic search
  answer: string;
  projectId?: string;
  taskCategory?: string;

  // Quality signals
  wasHelpful: boolean;
  usageCount: number;
  lastUsed: Date;

  // Metadata
  originalTaskId: string;
  originalAgentId: string;
  answeredBy: string;  // User ID
  createdAt: Date;
}

interface SimilarityMatch {
  qa: QuestionAnswer;
  score: number;  // 0-1
  matchType: 'exact' | 'semantic' | 'keyword';
}

interface AutoResponseDecision {
  shouldAutoRespond: boolean;
  confidence: number;
  suggestedAnswer?: string;
  matchedQA?: QuestionAnswer;
  reason: string;
}

interface KBMetrics {
  totalQuestions: number;
  autoAnswered: number;
  escalatedToSlack: number;
  hitRate: number;
  averageConfidence: number;
  topCategories: { category: string; count: number }[];
}

class QuestionStore {
  constructor(supabase: SupabaseClient);

  async store(qa: Omit<QuestionAnswer, 'id' | 'createdAt'>): Promise<string>;
  async findSimilar(question: string, limit?: number): Promise<SimilarityMatch[]>;
  async markUsed(id: string): Promise<void>;
  async markHelpful(id: string, helpful: boolean): Promise<void>;
  async getByProject(projectId: string): Promise<QuestionAnswer[]>;
  async getByCategory(category: string): Promise<QuestionAnswer[]>;
}

class SimilarityMatcher {
  constructor(options: SimilarityOptions);

  // Multiple matching strategies
  computeExactMatch(q1: string, q2: string): number;
  computeKeywordMatch(q1: string, q2: string): number;
  computeSemanticMatch(q1: string, q2: string): Promise<number>;  // Uses embeddings

  // Combined score
  async computeSimilarity(q1: string, q2: string): Promise<number>;
}

class AutoResponder {
  constructor(
    store: QuestionStore,
    matcher: SimilarityMatcher,
    config: AutoResponderConfig
  );

  async shouldAutoRespond(question: string, context: QuestionContext): Promise<AutoResponseDecision>;
  async recordOutcome(questionId: string, wasHelpful: boolean): Promise<void>;

  // Learning from feedback
  async adjustThresholds(feedback: Feedback[]): Promise<void>;
}

interface AutoResponderConfig {
  minConfidenceThreshold: number;  // Default: 0.85
  minUsageCount: number;           // Only use answers used N+ times
  requireProjectMatch: boolean;    // Stricter matching
  maxAgedays: number;              // Don't use stale answers
}

class KBMetricsCollector {
  constructor(store: QuestionStore, eventBus: EventBus);

  async getMetrics(period?: { start: Date; end: Date }): Promise<KBMetrics>;
  async getHitRateByProject(projectId: string): Promise<number>;
  async getTopQuestions(limit?: number): Promise<QuestionAnswer[]>;
}
```

### Database Schema Addition
```sql
CREATE TABLE tc_question_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  question_normalized TEXT NOT NULL,  -- Lowercase, trimmed
  answer TEXT NOT NULL,
  project_id UUID REFERENCES tc_projects(id),
  task_category TEXT,

  was_helpful BOOLEAN DEFAULT true,
  usage_count INTEGER DEFAULT 0,
  last_used TIMESTAMPTZ,

  original_task_id UUID REFERENCES tc_tasks(id),
  original_agent_id TEXT,
  answered_by TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),

  -- Full-text search
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', question || ' ' || answer)
  ) STORED
);

CREATE INDEX idx_qa_project ON tc_question_answers(project_id);
CREATE INDEX idx_qa_category ON tc_question_answers(task_category);
CREATE INDEX idx_qa_usage ON tc_question_answers(usage_count DESC);
CREATE INDEX idx_qa_search ON tc_question_answers USING GIN(search_vector);
CREATE INDEX idx_qa_normalized ON tc_question_answers(question_normalized);

-- Metrics tracking
CREATE TABLE tc_kb_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,  -- 'auto_answered', 'escalated', 'feedback'
  question_id UUID REFERENCES tc_question_answers(id),
  confidence DECIMAL(3,2),
  was_helpful BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Integration Points
- Hook into SlackRouter before posting questions
- Store answers from Slack threads
- Emit events: `kb:hit`, `kb:miss`, `kb:feedback`
- Report hit rates in daily metrics

### Flow Diagram
```
Agent asks question
        ↓
[AutoResponder.shouldAutoRespond]
        ↓
   confidence >= 0.85? ──Yes──→ Return cached answer
        ↓ No                          ↓
   Post to Slack              Record KB hit
        ↓                             ↓
   Human answers             Mark answer used
        ↓
   Store Q&A pair
        ↓
   Inject to agent
```

### TDD Approach
1. Test Q&A storage and retrieval
2. Test similarity matching (exact, keyword, semantic)
3. Test auto-response decision logic
4. Test threshold adjustment
5. Test metrics collection

### Commit Message
```
feat(knowledge): add question knowledge base

- QuestionStore persists Q&A pairs with search
- SimilarityMatcher computes question similarity
- AutoResponder decides when to auto-answer
- KBMetricsCollector tracks hit rates
- Reduces Slack blocking for repeated questions
```

---

## Instance 4: TC CLI Enhancement

### Context
You are enhancing the TC CLI for TrafficControl. This provides a native LLM-friendly interface for all core operations.

**HYPERVELOCITY principle:** "Shell scripts and stdin/stdout are native LLM interfaces; prioritize CLI tooling."

### Your Task
Enhance the existing CLI (from Phase 5) to add:
1. Trace search commands
2. Knowledge base management
3. Verification control
4. JSON output for LLM parsing
5. Interactive mode for debugging

### Files to Create/Modify
- `src/cli/commands/trace.ts` - Trace search commands
- `src/cli/commands/kb.ts` - Knowledge base commands
- `src/cli/commands/verify.ts` - Verification commands
- `src/cli/commands/interactive.ts` - Interactive mode
- `src/cli/formatters/json.ts` - JSON output formatter
- `src/cli/formatters/table.ts` - Table output formatter
- Tests for each file

### New Commands
```bash
# Trace commands
tc trace search "authentication error" --limit 10
tc trace list --task <id> --format json
tc trace correlation <id>
tc trace prune --older-than 30d

# Knowledge base commands
tc kb search "how to fix rate limit"
tc kb stats [--project <id>]
tc kb add --question "..." --answer "..."
tc kb feedback <id> --helpful|--not-helpful

# Verification commands
tc verify run <task-id>
tc verify status <task-id>
tc verify config show
tc verify config set maxRetries 5

# Interactive mode
tc interactive
> task list
> trace search "bug"
> kb search "deployment"
> exit

# Output formatting (all commands)
tc task list --format json
tc task list --format table
tc task list --format csv
```

### Key Interfaces
```typescript
interface CliFormatter {
  format(data: unknown): string;
}

class JsonFormatter implements CliFormatter {
  format(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }
}

class TableFormatter implements CliFormatter {
  constructor(columns: ColumnDefinition[]);
  format(data: Record<string, unknown>[]): string;
}

interface InteractiveSession {
  start(): Promise<void>;
  executeCommand(input: string): Promise<string>;
  getHistory(): string[];
}

// Command registration
interface CliCommand {
  name: string;
  description: string;
  aliases?: string[];
  options: CliOption[];
  subcommands?: CliCommand[];
  action: (args: string[], options: Record<string, unknown>) => Promise<CommandResult>;
}

interface CommandResult {
  success: boolean;
  data?: unknown;
  message?: string;
  error?: string;
}
```

### Integration Points
- Import TraceQuery from `src/traces/trace-query.ts`
- Import QuestionStore from `src/knowledge/question-store.ts`
- Import VerificationRunner from `src/verification/verification-runner.ts`
- Use existing ConfigLoader from `src/cli/config-loader.ts`

### TDD Approach
1. Test each new command
2. Test output formatters
3. Test interactive mode parsing
4. Test error handling
5. Test help text generation

### Commit Message
```
feat(cli): enhance CLI with HYPERVELOCITY commands

- Trace search and management commands
- Knowledge base queries and stats
- Verification control commands
- Interactive mode for debugging
- JSON/table/CSV output formatters
```

---

## Instance 5: Specs-First Enforcement

### Context
You are implementing specs-first workflow enforcement for TrafficControl. This ensures complex tasks have planning documents before implementation begins.

**HYPERVELOCITY principle:** "New codebases begin in planning mode; legacy work starts with spec generation."

### Your Task
Build the specs enforcement system that:
1. Detects complex tasks (estimated sessions >= 2)
2. Requires a plan document before implementation
3. Tracks plan-to-implementation drift
4. Integrates with task assignment flow

### Files to Create
- `src/specs/complexity-detector.ts` - Identifies complex tasks
- `src/specs/plan-validator.ts` - Validates plan documents
- `src/specs/plan-tracker.ts` - Tracks implementation vs plan
- `src/specs/enforcement-config.ts` - Configuration
- `src/specs/index.ts` - Module exports
- Tests for each file

### Key Interfaces
```typescript
interface ComplexityThresholds {
  requiredPlanSessions: number;     // Default: 2
  requiredPlanTokens: number;       // Default: 50000
  requiredPlanFiles: number;        // Default: 5
}

interface PlanDocument {
  taskId: string;
  filePath: string;

  // Extracted structure
  sections: PlanSection[];
  estimatedSteps: number;
  affectedFiles: string[];
  dependencies: string[];
  testingStrategy: string;

  // Validation
  isValid: boolean;
  validationErrors: string[];

  createdAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
}

interface PlanSection {
  title: string;
  content: string;
  isRequired: boolean;
}

interface ImplementationDrift {
  planPath: string;
  plannedFiles: string[];
  actualFiles: string[];
  addedFiles: string[];      // Not in plan
  missingFiles: string[];    // In plan, not implemented
  driftScore: number;        // 0-1, higher = more drift
}

class ComplexityDetector {
  constructor(config: ComplexityThresholds);

  async isComplex(task: Task): Promise<boolean>;
  async getComplexityFactors(task: Task): Promise<ComplexityFactors>;
}

class PlanValidator {
  constructor(requiredSections: string[]);

  async validate(planPath: string): Promise<PlanDocument>;
  async extractStructure(content: string): Promise<PlanSection[]>;

  // Required sections
  static DEFAULT_SECTIONS = [
    'Overview',
    'Implementation Steps',
    'Files to Create/Modify',
    'Testing Strategy',
    'Success Criteria'
  ];
}

class PlanTracker {
  constructor(supabase: SupabaseClient);

  async requirePlan(taskId: string): Promise<void>;
  async registerPlan(taskId: string, planPath: string): Promise<PlanDocument>;
  async approvePlan(taskId: string, approver: string): Promise<void>;

  // Drift detection
  async checkDrift(taskId: string): Promise<ImplementationDrift>;
  async recordImplementation(taskId: string, files: string[]): Promise<void>;

  // Queries
  async getPlanForTask(taskId: string): Promise<PlanDocument | null>;
  async getTasksNeedingPlans(): Promise<Task[]>;
}

class EnforcementGate {
  constructor(
    detector: ComplexityDetector,
    validator: PlanValidator,
    tracker: PlanTracker
  );

  // Called before agent assignment
  async canAssign(task: Task): Promise<{ allowed: boolean; reason?: string }>;

  // Called before completion
  async canComplete(task: Task): Promise<{ allowed: boolean; drift?: ImplementationDrift }>;
}
```

### Database Schema Addition
```sql
CREATE TABLE tc_task_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id) UNIQUE,
  file_path TEXT NOT NULL,

  sections JSONB DEFAULT '[]',
  estimated_steps INTEGER,
  affected_files TEXT[] DEFAULT '{}',
  dependencies TEXT[] DEFAULT '{}',
  testing_strategy TEXT,

  is_valid BOOLEAN DEFAULT false,
  validation_errors TEXT[] DEFAULT '{}',

  approved_at TIMESTAMPTZ,
  approved_by TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tc_implementation_drift (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id),
  plan_id UUID REFERENCES tc_task_plans(id),

  planned_files TEXT[] DEFAULT '{}',
  actual_files TEXT[] DEFAULT '{}',
  drift_score DECIMAL(3,2),

  checked_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_plans_task ON tc_task_plans(task_id);
CREATE INDEX idx_drift_task ON tc_implementation_drift(task_id);
```

### Integration Points
- Hook into Scheduler before task assignment
- Hook into VerificationRunner before completion
- Emit events: `plan:required`, `plan:approved`, `plan:drift_detected`
- Add CLI commands: `tc plan create`, `tc plan validate`, `tc plan drift`

### Agent Prompt Injection
For complex tasks without approved plan:
```typescript
const planRequiredPrompt = `
## Planning Required

This task is complex (estimated ${sessions} sessions). Before implementing:

1. Create a plan document at: docs/plans/${taskId}.md
2. Include these sections:
   - Overview: What problem does this solve?
   - Implementation Steps: Numbered list of steps
   - Files to Create/Modify: List affected files
   - Testing Strategy: How will you verify?
   - Success Criteria: Definition of done

3. The plan will be reviewed before you can proceed with implementation.

⚠️ DO NOT start coding until the plan is approved.
`;
```

### TDD Approach
1. Test complexity detection
2. Test plan validation
3. Test enforcement gate
4. Test drift detection
5. Test integration with scheduler

### Commit Message
```
feat(specs): add specs-first workflow enforcement

- ComplexityDetector identifies tasks requiring plans
- PlanValidator validates plan document structure
- PlanTracker manages plan lifecycle
- EnforcementGate blocks assignment/completion without plan
- Drift detection compares plan vs implementation
```

---

## Coordination & Integration

### Event Types to Add
```typescript
// Verification events
'verification:started'
'verification:passed'
'verification:failed'
'verification:retry'

// Trace events
'trace:logged'
'trace:searched'

// Knowledge base events
'kb:hit'
'kb:miss'
'kb:stored'
'kb:feedback'

// Specs events
'plan:required'
'plan:created'
'plan:approved'
'plan:drift_detected'
```

### Cross-Component Dependencies

```
                    ┌─────────────────────┐
                    │    EventBus         │
                    │  (existing Phase 5) │
                    └──────────┬──────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       │                       │                       │
       ▼                       ▼                       ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Verification │      │    Traces    │      │  Specs-First │
│    Runner    │─────▶│    Logger    │◀─────│  Enforcement │
└──────────────┘      └──────────────┘      └──────────────┘
       │                       │                       │
       │                       ▼                       │
       │              ┌──────────────┐                 │
       └─────────────▶│  Question KB │◀────────────────┘
                      └──────────────┘
                               │
                               ▼
                      ┌──────────────┐
                      │   TC CLI     │
                      │ (enhanced)   │
                      └──────────────┘
```

### Integration Test Requirements
```typescript
describe('HYPERVELOCITY Integration', () => {
  it('should require verification before completion', async () => {
    // Agent completes task
    // Verification runs automatically
    // Only completes if tests pass
  });

  it('should log all actions to trace store', async () => {
    // Agent performs actions
    // Traces are searchable
    // Correlation IDs link related traces
  });

  it('should auto-answer cached questions', async () => {
    // Store Q&A pair
    // Agent asks similar question
    // Auto-response returned, Slack not called
  });

  it('should require plans for complex tasks', async () => {
    // Complex task queued
    // Assignment blocked until plan exists
    // Plan approved → assignment allowed
  });

  it('should detect implementation drift', async () => {
    // Plan specifies files A, B, C
    // Agent modifies A, B, D
    // Drift detected (missing C, extra D)
  });
});
```

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test verification rate | 100% | All completed tasks ran tests |
| Verification pass rate | >90% | First-attempt passes |
| KB hit rate | >30% | Questions auto-answered |
| Average question latency | <5s for hits | Time to answer |
| Plan compliance | >80% | Tasks with required plans |
| Drift score | <0.2 avg | Plan vs implementation alignment |

---

## Rollout Strategy

### Phase 6a: Foundation (Week 1)
- Deploy Verification Runner (P0)
- Deploy Trace Logger (P1)
- Monitor: verification pass rates, trace volume

### Phase 6b: Intelligence (Week 2)
- Deploy Question KB (P1)
- Deploy Enhanced CLI (P2)
- Monitor: KB hit rate, CLI usage

### Phase 6c: Governance (Week 3)
- Deploy Specs Enforcement (P2)
- Enable drift detection
- Monitor: plan compliance, drift scores

### Phase 6d: Tuning (Week 4)
- Adjust KB similarity thresholds based on feedback
- Tune complexity detection thresholds
- Optimize trace retention policy

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Verification slows completion | Set reasonable timeouts, allow bypass for emergencies |
| KB returns wrong answers | Require high confidence threshold (0.85+), easy feedback mechanism |
| Plans become bureaucracy | Only require for truly complex tasks, auto-detect complexity |
| Trace storage grows unbounded | Implement pruning policy, configure retention |
| Agents bypass verification | Make verification mandatory in SDK, audit logs |

---

## Appendix: Full Subagent Prompts

### Subagent 1 Prompt
```
subagent_type: general-purpose
description: Phase 6 Verification Loop
prompt: |
  You are implementing the test verification loop for TrafficControl in c:\Users\Eli\portfolio-website\trafficControl.

  Read docs/plans/phase6-hypervelocity-implementation.md section "Instance 1: Test Verification Loop" for full requirements.

  Create these files using TDD:
  - src/verification/verification-runner.ts
  - src/verification/result-parser.ts
  - src/verification/retry-manager.ts
  - src/verification/verification-config.ts
  - src/verification/index.ts
  - Tests for each

  Key requirements:
  - Agents MUST run tests before completion
  - Parse test/build output to detect failures
  - Retry up to 3 times with exponential backoff
  - Emit events to EventBus
  - Store results in tc_verification_results table

  Follow TDD: write failing tests first, then implement.
  Commit your work when complete.
```

### Subagent 2 Prompt
```
subagent_type: general-purpose
description: Phase 6 Trace Logging
prompt: |
  You are implementing searchable trace logging for TrafficControl in c:\Users\Eli\portfolio-website\trafficControl.

  Read docs/plans/phase6-hypervelocity-implementation.md section "Instance 2: Searchable Trace Logging" for full requirements.

  Create these files using TDD:
  - src/traces/trace-logger.ts
  - src/traces/trace-store.ts
  - src/traces/trace-query.ts
  - src/traces/trace-types.ts
  - src/traces/index.ts
  - Tests for each

  Key requirements:
  - Log every agent action with full context
  - Store in Supabase with full-text search
  - Provide TraceQuery interface for searching
  - Link traces via correlation IDs
  - Subscribe to EventBus for auto-logging

  Follow TDD: write failing tests first, then implement.
  Commit your work when complete.
```

### Subagent 3 Prompt
```
subagent_type: general-purpose
description: Phase 6 Question KB
prompt: |
  You are implementing the Question Knowledge Base for TrafficControl in c:\Users\Eli\portfolio-website\trafficControl.

  Read docs/plans/phase6-hypervelocity-implementation.md section "Instance 3: Question Knowledge Base" for full requirements.

  Create these files using TDD:
  - src/knowledge/question-store.ts
  - src/knowledge/similarity-matcher.ts
  - src/knowledge/auto-responder.ts
  - src/knowledge/kb-metrics.ts
  - src/knowledge/index.ts
  - Tests for each

  Key requirements:
  - Store Q&A pairs from Slack interactions
  - Compute similarity between questions
  - Auto-answer if confidence >= 0.85
  - Track hit rates and feedback
  - Integrate with SlackRouter

  Follow TDD: write failing tests first, then implement.
  Commit your work when complete.
```

### Subagent 4 Prompt
```
subagent_type: general-purpose
description: Phase 6 CLI Enhancement
prompt: |
  You are enhancing the TC CLI for TrafficControl in c:\Users\Eli\portfolio-website\trafficControl.

  Read docs/plans/phase6-hypervelocity-implementation.md section "Instance 4: TC CLI Enhancement" for full requirements.

  Create/modify these files using TDD:
  - src/cli/commands/trace.ts
  - src/cli/commands/kb.ts
  - src/cli/commands/verify.ts
  - src/cli/commands/interactive.ts
  - src/cli/formatters/json.ts
  - src/cli/formatters/table.ts
  - Tests for each

  Key requirements:
  - Add trace search/list/prune commands
  - Add kb search/stats/add/feedback commands
  - Add verify run/status/config commands
  - Add interactive mode
  - Support --format json|table|csv

  Follow TDD: write failing tests first, then implement.
  Commit your work when complete.
```

### Subagent 5 Prompt
```
subagent_type: general-purpose
description: Phase 6 Specs Enforcement
prompt: |
  You are implementing specs-first workflow enforcement for TrafficControl in c:\Users\Eli\portfolio-website\trafficControl.

  Read docs/plans/phase6-hypervelocity-implementation.md section "Instance 5: Specs-First Enforcement" for full requirements.

  Create these files using TDD:
  - src/specs/complexity-detector.ts
  - src/specs/plan-validator.ts
  - src/specs/plan-tracker.ts
  - src/specs/enforcement-config.ts
  - src/specs/index.ts
  - Tests for each

  Key requirements:
  - Detect complex tasks (estimated sessions >= 2)
  - Require plan document before assignment
  - Validate plan structure (required sections)
  - Track plan-to-implementation drift
  - Integrate with Scheduler assignment flow

  Follow TDD: write failing tests first, then implement.
  Commit your work when complete.
```
