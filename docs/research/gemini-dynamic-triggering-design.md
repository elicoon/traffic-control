# Design: Gemini Dynamic Triggering System

**Status:** Proposed — awaiting user approval
**Created:** 2026-03-01
**Author:** Worker session (dispatch: 2026-03-01-traffic-control-gemini-dynamic-triggering-design)
**Implements:** Phase 3 triggering spec for [Gemini Adversarial Code Review](../backlog/gemini-adversarial-code-review.md)

---

## Executive Summary

This document specifies the design for the Gemini dynamic review triggering system. Phase 1 (MCP server) is complete. Phase 2 (adversarial prompting templates) is queued. This design gives Phase 3 (TrafficControl orchestrator integration) a concrete spec to implement directly.

The triggering system answers: *when should TrafficControl automatically invoke Gemini review instead of requiring manual request?* The answer is a multi-criteria decision function evaluated when a task's code changes complete, before final status update.

---

## Trigger Criteria

Five criteria categories, each independently configurable. A review is triggered when **any enabled criterion matches** (OR logic). Multiple matches are merged into a single review call with combined focus areas.

### 1. Security-Sensitive Paths

Trigger when any changed file matches a security-sensitive glob pattern.

**Default patterns:**
```
src/auth/**
src/db/**
src/payments/**
**/crypto/**
**/secrets/**
**/middleware/**
**/permissions/**
```

**Example threshold:** Any file in `src/auth/**` → trigger with `focusAreas: ['security']` and model override to Pro.

**Implementation note:** Uses micromatch for glob matching against the set of changed file paths. The file list is available from the git diff at task completion time.

---

### 2. Change Size Thresholds

Trigger when the diff exceeds size limits indicating meaningful scope.

**Default thresholds:**

| Signal | Default | Rationale |
|--------|---------|-----------|
| `linesChanged` | 50 | Covers a typical feature; below this is minor cleanup |
| `filesChanged` | 5 | Multi-file change suggests non-trivial refactor |
| `hunksChanged` | 8 | High hunk count suggests scattered changes (higher risk) |

Both thresholds are OR'd: trigger if `linesChanged > 50` **or** `filesChanged > 5`.

**Model selection:** Flash by default. Pro if `linesChanged > 200` or `filesChanged > 10`.

---

### 3. Pattern Matching (Diff Content)

Trigger when the diff content matches patterns indicating higher-risk change types. Applied as regex matches against the raw diff string.

**Default patterns:**

| Pattern | Meaning | Focus |
|---------|---------|-------|
| `catch\s*\(` | Error handling changes | correctness, edge-case |
| `new\s+\w+Client\|fetch\(` | New external API call | security, correctness |
| `CREATE TABLE\|ALTER TABLE\|DROP TABLE` | DB schema mutation | correctness, design |
| `"dependencies"\|"devDependencies"` | Dependency update (package.json) | security |
| `process\.env\.\|getenv\(` | Env var access (potential secrets) | security |
| `eval\(\|exec\(\|execSync\(` | Dynamic execution (high risk) | security, correctness |

**Example threshold:** Diff contains `catch (` → trigger with `focusAreas: ['correctness', 'edge-case']`.

---

### 4. Historical Bug Density (Learning-Based)

Trigger when any changed file was the site of a previously confirmed Gemini finding.

**How it works:**
After Phase 2 reviews start running and `tc_review_log` accumulates data, query for files with confirmed findings (where `findings_validated > 0`). Files that previously had real issues are re-reviewed on any future change.

**Threshold:** File appears in `tc_review_log` with `findings_validated >= 1` in the last `lookbackDays` days (default: 90 days).

**Disabled initially** (no data yet). Enable once `tc_review_log` has ≥20 completed entries.

---

### 5. Author + Context Override

Always trigger when the task's `tags` include certain values regardless of other criteria.

**Default override tags:** `["security-review", "adversarial-review", "gemini-required"]`

This allows task-level opt-in without changing config. The task creator sets the tag, and triggering is guaranteed.

---

## TypeScript Interface

This interface goes in `src/orchestrator/review-trigger.ts` (new file, Phase 3). It should also be added to `TrafficControlConfig` in `src/cli/config-loader.ts`.

```typescript
import { ReviewFocusArea } from '../../gemini-review-mcp/src/types.js';

/** Glob patterns matching security-sensitive file paths */
export interface PathTriggerConfig {
  /** micromatch-compatible glob patterns */
  patterns: string[];
  /** Focus areas to pass to Gemini for these paths */
  focusAreas?: ReviewFocusArea[];
  /** Override model for security-path triggers (default: pro) */
  model?: GeminiModel;
}

/** Change size thresholds for triggering */
export interface SizeTriggerConfig {
  /** Trigger if total lines changed exceeds this value (default: 50) */
  linesChanged?: number;
  /** Trigger if total files changed exceeds this value (default: 5) */
  filesChanged?: number;
  /** Trigger if total diff hunks exceeds this value (default: 8) */
  hunksChanged?: number;
  /** Use Pro model when changes exceed this threshold (default: 200) */
  linesChangedProThreshold?: number;
}

/** Regex patterns matched against raw diff content */
export interface PatternTriggerConfig {
  /** Array of { pattern, focusAreas } objects */
  rules: Array<{
    /** Regex pattern to match against diff string */
    pattern: string;
    /** Focus areas to add when this pattern matches */
    focusAreas: ReviewFocusArea[];
  }>;
}

/** Historical bug density trigger */
export interface HistoricalTriggerConfig {
  /** Enable this trigger type (default: false until data accumulates) */
  enabled: boolean;
  /** Minimum confirmed findings in a file to flag it as high-risk (default: 1) */
  minConfirmedFindings?: number;
  /** How many days back to check tc_review_log (default: 90) */
  lookbackDays?: number;
}

/** Tag-based override — always trigger for tasks with these tags */
export interface TagOverrideConfig {
  /** Task tags that force a Gemini review regardless of other criteria */
  tags: string[];
}

/** Cost budget controls for auto-triggered reviews */
export interface ReviewBudgetConfig {
  /** Maximum USD to spend on auto-triggered reviews per day (default: 2.00) */
  dailyLimitUsd?: number;
  /** Maximum USD to spend on auto-triggered reviews per week (default: 10.00) */
  weeklyLimitUsd?: number;
  /** Pause auto-triggering when limit is hit; resume next day/week (default: true) */
  pauseWhenExhausted?: boolean;
}

/** Review fatigue controls to prevent overwhelming the system */
export interface ReviewFatigueConfig {
  /** Maximum auto-triggered reviews per hour (default: 5) */
  maxPerHour?: number;
  /** Maximum auto-triggered reviews per day (default: 15) */
  maxPerDay?: number;
  /** Whether to log skipped reviews as review debt (default: true) */
  trackReviewDebt?: boolean;
  /** Send Slack digest of skipped reviews when debt exceeds this value (default: 3) */
  debtAlertThreshold?: number;
}

/** Model selection for different trigger types */
export interface ReviewModelConfig {
  /** Default model for non-security reviews (default: gemini-2.5-flash) */
  default?: GeminiModel;
  /** Model for security-path and tag-override triggers (default: gemini-2.5-pro) */
  security?: GeminiModel;
  /** Model for architecture/design pattern triggers (default: gemini-2.5-pro) */
  architecture?: GeminiModel;
}

export type GeminiModel = 'gemini-2.5-pro' | 'gemini-2.5-flash';

/**
 * Complete triggering configuration.
 * Placed under `review.adversarial.triggers` in traffic-control config.
 */
export interface TriggerConfig {
  /** Enable the dynamic triggering system (default: false — manual only until Phase 3) */
  enabled: boolean;

  /** Security-sensitive path patterns — highest priority, always use Pro model */
  securityPaths?: PathTriggerConfig;

  /** Change size thresholds */
  size?: SizeTriggerConfig;

  /** Diff content pattern matching */
  patterns?: PatternTriggerConfig;

  /** Historical bug density (disabled until tc_review_log has sufficient data) */
  historical?: HistoricalTriggerConfig;

  /** Task-tag based overrides */
  tagOverrides?: TagOverrideConfig;

  /** Model selection per trigger type */
  model?: ReviewModelConfig;

  /** Cost budget limits */
  budget?: ReviewBudgetConfig;

  /** Review fatigue limits */
  fatigue?: ReviewFatigueConfig;
}
```

---

## YAML Config Example

The current config-loader uses JSON, not YAML. Phase 3 should either add YAML support via `js-yaml` or use the JSON equivalent. This example uses the YAML structure anticipated in the backlog item — Phase 3 will determine the actual format:

```yaml
review:
  adversarial:
    enabled: true
    provider: gemini-mcp
    triggers:
      enabled: false    # Start false; flip to true after Phase 2 data accumulates

      securityPaths:
        patterns:
          - "src/auth/**"
          - "src/db/**"
          - "**/crypto/**"
          - "**/secrets/**"
          - "**/middleware/**"
        focusAreas:
          - security
          - correctness
        model: gemini-2.5-pro

      size:
        linesChanged: 50
        filesChanged: 5
        hunksChanged: 8
        linesChangedProThreshold: 200

      patterns:
        rules:
          - pattern: "catch\\s*\\("
            focusAreas: [correctness, edge-case]
          - pattern: "new\\s+\\w+Client|fetch\\("
            focusAreas: [security, correctness]
          - pattern: "CREATE TABLE|ALTER TABLE|DROP TABLE"
            focusAreas: [correctness, design]
          - pattern: "\"dependencies\"|\"devDependencies\""
            focusAreas: [security]
          - pattern: "process\\.env\\.|getenv\\("
            focusAreas: [security]

      historical:
        enabled: false    # Enable after tc_review_log has ≥20 entries
        minConfirmedFindings: 1
        lookbackDays: 90

      tagOverrides:
        tags:
          - security-review
          - adversarial-review
          - gemini-required

      model:
        default: gemini-2.5-flash
        security: gemini-2.5-pro
        architecture: gemini-2.5-pro

      budget:
        dailyLimitUsd: 2.00
        weeklyLimitUsd: 10.00
        pauseWhenExhausted: true

      fatigue:
        maxPerHour: 5
        maxPerDay: 15
        trackReviewDebt: true
        debtAlertThreshold: 3
```

**JSON equivalent** (for current config-loader):
```json
{
  "review": {
    "adversarial": {
      "enabled": true,
      "triggers": {
        "enabled": false,
        "securityPaths": {
          "patterns": ["src/auth/**", "src/db/**", "**/crypto/**"],
          "focusAreas": ["security"],
          "model": "gemini-2.5-pro"
        },
        "size": { "linesChanged": 50, "filesChanged": 5 },
        "budget": { "dailyLimitUsd": 2.00, "weeklyLimitUsd": 10.00 },
        "fatigue": { "maxPerHour": 5, "maxPerDay": 15, "trackReviewDebt": true }
      }
    }
  }
}
```

---

## Review Metadata Logging Schema

### Recommendation: New `tc_review_log` table

Do **not** extend `tc_usage_log`. That table is token/cost-focused and keyed by session — it has a different cardinality and purpose. Review outcomes need file-level data, trigger reasons, finding distributions, and outcome validation fields that don't fit `tc_usage_log`'s schema.

### SQL Schema

```sql
CREATE TABLE tc_review_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Task & session linkage
  task_id UUID REFERENCES tc_tasks(id) ON DELETE SET NULL,
  session_id TEXT,                          -- tc_agent_sessions.id if triggered from a session

  -- Trigger metadata (critical for retrospective analysis)
  trigger_reason TEXT NOT NULL,             -- 'security-path' | 'size' | 'pattern' | 'historical' | 'tag-override' | 'manual'
  trigger_details JSONB,                    -- { matchedPattern: 'src/auth/**', linesChanged: 85, matchedTag: null }
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Review inputs
  files_reviewed TEXT[],                    -- list of file paths included in the review
  lines_changed INTEGER,
  files_changed INTEGER,
  model_used TEXT NOT NULL,                 -- 'gemini-2.5-pro' | 'gemini-2.5-flash'
  focus_areas TEXT[],                       -- focus areas passed to review-code

  -- Review outputs (from ReviewResult + ReviewSummary)
  total_findings INTEGER NOT NULL DEFAULT 0,
  findings_critical INTEGER NOT NULL DEFAULT 0,
  findings_major INTEGER NOT NULL DEFAULT 0,
  findings_minor INTEGER NOT NULL DEFAULT 0,
  findings_suggestion INTEGER NOT NULL DEFAULT 0,
  findings_by_category JSONB NOT NULL DEFAULT '{}', -- { security: 2, error-handling: 1 }
  claude_blind_spots INTEGER NOT NULL DEFAULT 0,
  assessment TEXT NOT NULL,                 -- 'clean' | 'minor-issues' | 'needs-attention' | 'critical-issues'
  merge_blocked BOOLEAN NOT NULL DEFAULT false,
  merge_requires_ack BOOLEAN NOT NULL DEFAULT false,
  raw_findings JSONB,                       -- full ReviewFinding[] array for retroactive analysis

  -- Outcome validation (filled in by human or automated follow-up)
  findings_validated INTEGER,              -- how many findings were confirmed as real issues
  false_positives INTEGER,                 -- how many findings were false positives
  outcome_notes TEXT,                      -- free-text notes from review outcome

  -- Cost & performance
  cost_usd NUMERIC(10, 6),
  duration_ms INTEGER,

  -- Review status
  status TEXT NOT NULL DEFAULT 'completed', -- 'completed' | 'skipped' | 'failed'
  skip_reason TEXT,                         -- if status='skipped': 'budget' | 'fatigue' | 'excluded' | 'disabled'
  error_message TEXT,                       -- if status='failed'

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for retrospective queries
CREATE INDEX idx_tc_review_log_task_id ON tc_review_log(task_id);
CREATE INDEX idx_tc_review_log_trigger_reason ON tc_review_log(trigger_reason);
CREATE INDEX idx_tc_review_log_status ON tc_review_log(status);
CREATE INDEX idx_tc_review_log_created_at ON tc_review_log(created_at DESC);
CREATE INDEX idx_tc_review_log_files_reviewed ON tc_review_log USING GIN(files_reviewed);
```

### Key Design Decisions

1. **`raw_findings JSONB`** — storing the full `ReviewFinding[]` array means we can retroactively query for any finding attribute (e.g., "which blind spots had high confidence?") without adding columns.

2. **`findings_validated` / `false_positives`** — these are nullable and filled in later. Phase 4 (learning) will use these columns to tune trigger criteria and prompts. Even Phase 3 can start recording them manually via Slack commands.

3. **`files_reviewed TEXT[]`** with GIN index — enables the historical trigger: `SELECT DISTINCT unnest(files_reviewed) FROM tc_review_log WHERE findings_validated > 0 AND created_at > now() - interval '90 days'`.

4. **`skipped` status** — tracking skipped reviews is essential for review debt. Without this, we cannot know how many times a high-risk file was changed without review.

---

## Orchestrator Integration Point

Phase 3 should add a `ReviewTrigger` class called from `MainLoop` when a task transitions to `complete` or `review` status. The hook point is after `agentManager.completeSession()` but before final Slack notification.

Pseudocode integration path:
```typescript
// In MainLoop.handleTaskCompletion() (new method in Phase 3)
async handleTaskCompletion(task: Task, agentState: AgentState): Promise<void> {
  const codeChanges = await this.getCodeChanges(agentState); // git diff from session

  const decision = await this.reviewTrigger.evaluate(task, codeChanges);

  if (decision.shouldReview) {
    const result = await this.geminiMcpClient.call('review-code', {
      code: codeChanges.diff,
      context: task.description,
      filePath: codeChanges.primaryFile,
      focusAreas: decision.focusAreas,
      originalAuthor: 'claude',
    });
    await this.reviewLogRepo.create({ taskId: task.id, triggerReason: decision.reason, ...result });
  } else {
    await this.reviewLogRepo.createSkipped({ taskId: task.id, skipReason: decision.skipReason });
  }
}
```

The `codeChanges` object Phase 3 needs to produce from git diff:
```typescript
interface CodeChanges {
  diff: string;           // full git diff text
  filePaths: string[];    // list of changed file paths
  linesChanged: number;   // total lines added + removed
  filesChanged: number;   // total files touched
  hunksChanged: number;   // total diff hunks
  primaryFile?: string;   // first/main file changed (for filePath param)
}
```

---

## Answers to Open Questions

### Q1: What is the acceptable cost budget per day/week?

**Proposed:**
- **Daily cap: $2.00 USD**
- **Weekly cap: $10.00 USD**

**Rationale:**
Gemini 2.5 Flash costs approximately $0.075/1M input tokens + $0.30/1M output tokens. A typical code review (5K tokens in, 1K tokens out) costs ~$0.05–0.15. At $2/day, that's 13–40 Flash reviews per day — more than enough for normal velocity. Pro reviews (~$0.50–1.50 each) are reserved for security-path triggers; at $2/day the system will do 1–4 Pro reviews before pausing.

The weekly cap prevents runaway spend during high-activity weeks while allowing single-day overages to be absorbed. Daily tracking resets at midnight; weekly tracking resets Monday 00:00.

**When budget exhausts:** Auto-triggering pauses. A Slack notification is sent: "Gemini review budget exhausted (daily: $2.00). Resuming tomorrow. N reviews skipped." Manual reviews remain available regardless of budget state.

**To override:** Set `budget.dailyLimitUsd` and `budget.weeklyLimitUsd` in config. Confirm with explicit user acknowledgment before raising limits.

---

### Q2: Should we implement a "review debt" concept?

**Proposed: Yes, implement review debt as a counter of skipped reviews in the rolling 24-hour window.**

**How it works:**
1. When auto-triggering is skipped (budget exhausted, fatigue limit hit, or disabled), record `status: 'skipped'` in `tc_review_log` with the skip reason.
2. Review debt = `COUNT(*) FROM tc_review_log WHERE status = 'skipped' AND created_at > now() - interval '24 hours'`.
3. When debt exceeds `fatigue.debtAlertThreshold` (default: 3), send a Slack digest listing the skipped reviews with their trigger reasons and file paths.
4. Debt is **informational only** — it does not automatically unlock budget or re-queue reviews. The user decides whether to manually request skipped reviews.
5. A weekly Slack report should include "reviews skipped this week: N" alongside the normal usage summary.

**Why not auto-resume:** Auto-resuming review debt could cause cost spikes at the start of a new day or week (all accumulated debt fires at once). Keep the user in control of when to clear debt.

---

### Q3: How to handle review fatigue if too many auto-triggers?

**Proposed: Hard rate limits with graceful degradation, not queuing.**

**Limits:**
- **Max 5 reviews per hour** — prevents bursts during high-commit periods
- **Max 15 reviews per day** — gives headroom for active development days while capping cost exposure

**Behavior when limit is hit:**
1. Mark the skipped review in `tc_review_log` with `status: 'skipped', skip_reason: 'fatigue'`
2. Do not queue the review for later — reviews of stale code are lower value
3. Increment the review debt counter
4. If debt exceeds threshold, send Slack digest (same as Q2 above)
5. Hourly counter resets each hour (rolling window); daily counter resets at midnight

**Exception:** Tag-override triggers (`gemini-required`, `security-review`) bypass fatigue limits and always fire, even if daily limit is hit. They do not bypass budget limits.

**Recommendation:** Start with the conservative defaults (5/hr, 15/day). After 2 weeks of data in `tc_review_log`, review the skip rate. If skips are frequent, consider raising daily limit. If costs are low, the limits are appropriate.

---

## Phasing Recommendation

| Phase | Config change | Description |
|-------|-------------|-------------|
| Phase 3 launch | `triggers.enabled: false` | Implement all trigger infrastructure but keep auto-triggering disabled. Log all *would-have-triggered* events as `status: 'skipped', skip_reason: 'disabled'` for calibration. |
| 2 weeks later | `triggers.enabled: true` | Enable triggering after reviewing calibration data. Adjust thresholds if too noisy. |
| After 20+ reviews | `historical.enabled: true` | Enable learning-based triggering once `tc_review_log` has sufficient data. |

This phased approach lets Phase 3 build the full infrastructure while giving operational data before enabling auto-spending.

---

## Open Issues Requiring User Input

These items are not blocking Phase 3 implementation but need user decisions before going live with `triggers.enabled: true`:

1. **Config format:** Current `config-loader.ts` is JSON-only. The backlog item shows YAML. Phase 3 should confirm whether to add `js-yaml` dependency or keep JSON for the review config block.

2. **Git diff extraction:** Phase 3 needs a way to get the code diff for a completed task. Confirm whether TrafficControl agents are already producing a git diff artifact, or whether Phase 3 needs to run `git diff HEAD~1` in the agent's working directory.

3. **Budget confirmation UX:** When daily budget is hit, should the Slack notification include an "unlock for today" button (interactive Slack component), or is manual config change sufficient?

4. **`findings_validated` workflow:** How will false positive / true positive feedback be collected? Options: (a) Slack button on review notification ("Mark as valid" / "Mark as false positive"), (b) manual SQL update, (c) future Phase 4 workflow. Phase 3 can leave this nullable and address in Phase 4.

5. **Threshold calibration values:** The thresholds in this document (50 lines, 5 files, $2/day) are initial proposals based on reasoning, not empirical data. Run Phase 3 in shadow mode (disabled, logging would-have-triggered events) for 1–2 weeks and adjust before enabling live triggering.
