# Phase 3: Learning System - Parallel Implementation Prompts

**Date:** 2026-01-26
**Phase:** 3 - Learning
**Prerequisites:** Phase 1 (Foundation) and Phase 2 (Automation) completed

---

## Overview

Phase 3 implements the learning and continuous improvement systems:
1. Retrospective system for capturing failures
2. Learning propagation to prevent repeat mistakes
3. Subagent support with depth limits
4. Visual review pipeline for UI tasks

---

## Instance 1: Retrospective System

### Context
You are implementing the retrospective system for TrafficControl - an autonomous agent orchestration system. This system captures and analyzes failures to enable continuous learning.

### Your Task
Build the retrospective system that:
1. Detects when retrospectives should be triggered
2. Generates structured retrospective documents
3. Stores retrospectives in the database and as markdown files
4. Extracts machine-readable learnings from retrospectives

### Files to Create
- `src/learning/retrospective-trigger.ts` - Detects conditions that require retrospectives
- `src/learning/retrospective-generator.ts` - Generates retrospective content
- `src/learning/retrospective-repository.ts` - Database operations for retrospectives
- `src/learning/index.ts` - Module exports
- Tests for each file

### Database Schema
Add this migration:
```sql
-- Retrospectives table
CREATE TABLE tc_retrospectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id),
  session_id UUID,
  project_id UUID REFERENCES tc_projects(id),
  title TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('validation_failures', 'blocker', 'review_rejected', 'test_regression', 'manual')),
  what_happened TEXT NOT NULL,
  root_cause TEXT,
  correct_approach TEXT,
  learning_category TEXT,
  learning_pattern TEXT,
  learning_rule TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE tc_retrospectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for tc_retrospectives" ON tc_retrospectives FOR ALL USING (true);
```

### Retrospective Triggers
From the design doc:
- Task fails validation 3+ times
- Agent explicitly blocked
- Visual review rejected
- Test suite regression
- Corrective feedback given

### Retrospective Structure
```typescript
interface Retrospective {
  id: string;
  taskId: string;
  sessionId?: string;
  projectId: string;
  title: string;
  triggerType: 'validation_failures' | 'blocker' | 'review_rejected' | 'test_regression' | 'manual';
  whatHappened: string;
  rootCause?: string;
  correctApproach?: string;
  learning?: {
    category: string;
    pattern: string;
    rule: string;
    appliesTo?: string[];
  };
  createdAt: Date;
  resolvedAt?: Date;
}
```

### Key Methods
```typescript
// retrospective-trigger.ts
class RetrospectiveTrigger {
  constructor(taskRepo: TaskRepository, sessionRepo: AgentSessionRepository);

  // Check if task has failed validation 3+ times
  async checkValidationFailures(taskId: string): Promise<boolean>;

  // Check if agent is blocked and needs retrospective
  async checkBlockerNeedsRetrospective(sessionId: string): Promise<boolean>;

  // Check for test regression
  async checkTestRegression(taskId: string, previousResults: TestResults, currentResults: TestResults): Promise<boolean>;

  // Get all pending retrospective triggers
  async getPendingTriggers(): Promise<RetrospectiveTriggerEvent[]>;
}

// retrospective-generator.ts
class RetrospectiveGenerator {
  // Generate retrospective content from a trigger event
  async generate(trigger: RetrospectiveTriggerEvent): Promise<RetrospectiveContent>;

  // Generate markdown file content
  generateMarkdown(retrospective: Retrospective): string;

  // Save markdown file to disk
  async saveToFile(retrospective: Retrospective, basePath: string): Promise<string>;
}
```

### Test Requirements
- Unit tests with mocks for database operations
- Test trigger detection logic
- Test markdown generation
- Test file saving

### Important Notes
- Follow TDD: write failing tests first
- Use existing patterns from Phase 1/2 code
- Integrate with existing TaskRepository and session tracking
- Markdown files go to `trafficControl/retrospectives/` directory

---

## Instance 2: Learning Propagation

### Context
You are implementing the learning propagation system for TrafficControl. This system extracts learnings from retrospectives and propagates them to prevent repeat mistakes.

### Your Task
Build the learning propagation system that:
1. Extracts machine-readable learnings from retrospectives
2. Updates learning files (global and project-specific)
3. Provides learnings to agents when starting sessions
4. Tracks which learnings have been applied

### Files to Create
- `src/learning/learning-extractor.ts` - Extracts learnings from retrospectives
- `src/learning/learning-store.ts` - Manages learning files (markdown)
- `src/learning/learning-provider.ts` - Provides context for agent sessions
- Tests for each file

### Learning File Structure
```
trafficControl/
├── learnings/
│   ├── global.md           # Cross-project patterns
│   ├── project-{id}.md     # Project-specific learnings
│   └── index.md            # Index of all learnings
└── agents.md               # Agent behavior guidelines
```

### Learning Format
```yaml
# In markdown files with YAML front matter
---
id: learning-001
category: testing
subcategory: edge-cases
pattern: async-race-condition
trigger: "when testing async operations with shared state"
rule: "always use proper test isolation and cleanup in afterEach"
applies_to: [typescript, vitest]
source_retrospective: retro-123
created_at: 2026-01-26
---
```

### Key Interfaces
```typescript
interface Learning {
  id: string;
  category: 'testing' | 'architecture' | 'tooling' | 'communication' | 'project-specific';
  subcategory: string;
  pattern: string;
  trigger: string;
  rule: string;
  appliesTo?: string[];
  sourceRetrospective: string;
  projectId?: string; // null for global learnings
  createdAt: Date;
}

interface LearningContext {
  globalLearnings: Learning[];
  projectLearnings: Learning[];
  agentGuidelines: string;
}
```

### Key Methods
```typescript
// learning-extractor.ts
class LearningExtractor {
  // Extract structured learning from retrospective
  extractLearning(retrospective: Retrospective): Learning | null;

  // Determine if learning is global or project-specific
  determineScope(learning: Learning): 'global' | 'project';
}

// learning-store.ts
class LearningStore {
  constructor(basePath: string);

  // Add a new learning
  async addLearning(learning: Learning): Promise<void>;

  // Get all global learnings
  async getGlobalLearnings(): Promise<Learning[]>;

  // Get learnings for a specific project
  async getProjectLearnings(projectId: string): Promise<Learning[]>;

  // Update the index file
  async updateIndex(): Promise<void>;

  // Check if a similar learning already exists
  async hasSimilarLearning(learning: Learning): Promise<boolean>;
}

// learning-provider.ts
class LearningProvider {
  constructor(store: LearningStore);

  // Get complete context for an agent session
  async getContextForSession(projectId: string): Promise<LearningContext>;

  // Format learnings as system prompt addition
  formatAsSystemPrompt(context: LearningContext): string;
}
```

### Test Requirements
- Test learning extraction from various retrospective types
- Test file reading/writing for learning store
- Test deduplication of similar learnings
- Test context generation for sessions

### Important Notes
- Learning files are markdown with YAML front matter
- Parse existing files when adding new learnings
- Deduplicate learnings to avoid redundancy
- Format learnings clearly for agent consumption

---

## Instance 3: Subagent Support

### Context
You are implementing subagent support for TrafficControl's AgentManager. This enables agents to spawn child agents with proper tracking and depth limits.

### Your Task
Extend the AgentManager to:
1. Track parent-child relationships between agent sessions
2. Enforce subagent depth limit (max 2 levels)
3. Roll up token usage from subagents to parent
4. Handle subagent lifecycle events

### Files to Modify/Create
- `src/agent/subagent-tracker.ts` - Tracks subagent hierarchy
- `src/agent/manager.ts` - Extend to support subagents (modify existing)
- `src/agent/types.ts` - Add subagent-related types (modify existing)
- `src/db/repositories/sessions.ts` - Add parent_session_id support
- Tests for new functionality

### Database Migration
```sql
-- Add parent_session_id to agent_sessions if not exists
ALTER TABLE tc_agent_sessions
ADD COLUMN IF NOT EXISTS parent_session_id UUID REFERENCES tc_agent_sessions(id),
ADD COLUMN IF NOT EXISTS depth INTEGER DEFAULT 0;

-- Index for efficient hierarchy queries
CREATE INDEX IF NOT EXISTS idx_agent_sessions_parent ON tc_agent_sessions(parent_session_id);
```

### Key Interfaces
```typescript
interface SubagentConfig {
  parentSessionId: string;
  maxDepth?: number; // Default: 2
}

interface AgentHierarchy {
  sessionId: string;
  parentId: string | null;
  depth: number;
  children: AgentHierarchy[];
}

interface SubagentSpawnEvent {
  parentSessionId: string;
  childSessionId: string;
  depth: number;
  taskId: string;
  model: ModelType;
}
```

### Key Methods
```typescript
// subagent-tracker.ts
class SubagentTracker {
  private maxDepth: number;
  private hierarchy: Map<string, AgentHierarchy>;

  constructor(maxDepth?: number);

  // Check if spawning a subagent would exceed depth limit
  canSpawnSubagent(parentSessionId: string): boolean;

  // Register a new subagent
  registerSubagent(parentSessionId: string, childSessionId: string): void;

  // Get the depth of a session
  getDepth(sessionId: string): number;

  // Get all descendants of a session
  getDescendants(sessionId: string): string[];

  // Get root session for any session in hierarchy
  getRootSession(sessionId: string): string;

  // Remove session and all descendants
  removeSession(sessionId: string): void;
}

// Extend AgentManager
class AgentManager {
  // Existing methods...

  // Spawn a subagent for an existing session
  async spawnSubagent(
    parentSessionId: string,
    taskId: string,
    prompt: string,
    config: AgentConfig
  ): Promise<AgentSession>;

  // Get aggregated usage for session including all subagents
  getAggregatedUsage(sessionId: string): TokenUsage;

  // Handle subagent completion - roll up usage to parent
  private handleSubagentCompletion(sessionId: string, usage: TokenUsage): void;
}
```

### Event Handling
When SDK emits subagent spawn event:
1. Check depth limit via SubagentTracker
2. If allowed: register subagent, create session record
3. If denied: log warning, let SDK handle denial

### Test Requirements
- Test depth limit enforcement (0, 1, 2, 3+ levels)
- Test hierarchy tracking
- Test usage rollup from children to parent
- Test cleanup when parent session ends

### Important Notes
- Subagent depth limit is 2 (configurable)
- Token usage rolls up: child → parent → root
- When parent terminates, all subagents should terminate
- Session records track parent_session_id for persistence

---

## Instance 4: Visual Review Pipeline

### Context
You are implementing the visual review pipeline for TrafficControl. This enables screenshot-based review for UI tasks before completion.

### Your Task
Build the visual review pipeline that:
1. Detects tasks requiring visual review
2. Captures screenshots via Playwright
3. Sends screenshots to Slack for human review
4. Handles approval/rejection responses

### Files to Create
- `src/review/visual-reviewer.ts` - Coordinates visual review process
- `src/review/screenshot-capture.ts` - Captures screenshots via Playwright
- `src/review/review-repository.ts` - Tracks review status
- `src/review/index.ts` - Module exports
- Tests for each file

### Database Migration
```sql
-- Visual reviews table
CREATE TABLE tc_visual_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id) NOT NULL,
  session_id UUID,
  screenshot_url TEXT,
  screenshot_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  feedback TEXT,
  slack_message_ts TEXT,
  slack_thread_ts TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE tc_visual_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for tc_visual_reviews" ON tc_visual_reviews FOR ALL USING (true);
```

### Key Interfaces
```typescript
interface VisualReview {
  id: string;
  taskId: string;
  sessionId?: string;
  screenshotUrl?: string;
  screenshotPath?: string;
  status: 'pending' | 'approved' | 'rejected';
  feedback?: string;
  slackMessageTs?: string;
  slackThreadTs?: string;
  createdAt: Date;
  reviewedAt?: Date;
}

interface ScreenshotConfig {
  url: string;
  viewport?: { width: number; height: number };
  fullPage?: boolean;
  selector?: string; // Capture specific element
  waitFor?: string; // Selector to wait for before capture
}

interface ReviewResult {
  approved: boolean;
  feedback?: string;
  reviewedBy?: string;
  reviewedAt: Date;
}
```

### Key Methods
```typescript
// visual-reviewer.ts
class VisualReviewer {
  constructor(
    screenshotCapture: ScreenshotCapture,
    reviewRepo: ReviewRepository,
    slackBot: SlackBot
  );

  // Check if task requires visual review
  requiresVisualReview(task: Task): boolean;

  // Initiate visual review for a task
  async initiateReview(taskId: string, sessionId: string, config: ScreenshotConfig): Promise<VisualReview>;

  // Handle Slack response (approval/rejection)
  async handleSlackResponse(messageTs: string, response: string, userId: string): Promise<ReviewResult>;

  // Get pending reviews
  async getPendingReviews(): Promise<VisualReview[]>;

  // Retry review with new screenshot
  async retryReview(reviewId: string, config: ScreenshotConfig): Promise<VisualReview>;
}

// screenshot-capture.ts
class ScreenshotCapture {
  // Capture screenshot using Playwright
  async capture(config: ScreenshotConfig): Promise<{ path: string; buffer: Buffer }>;

  // Upload screenshot to storage (returns URL)
  async upload(buffer: Buffer, filename: string): Promise<string>;

  // Cleanup old screenshots
  async cleanup(olderThan: Date): Promise<number>;
}

// review-repository.ts
class ReviewRepository {
  constructor(client: SupabaseClient);

  async create(review: Omit<VisualReview, 'id' | 'createdAt'>): Promise<VisualReview>;
  async getById(id: string): Promise<VisualReview | null>;
  async getByTaskId(taskId: string): Promise<VisualReview[]>;
  async getBySlackMessageTs(messageTs: string): Promise<VisualReview | null>;
  async updateStatus(id: string, status: VisualReview['status'], feedback?: string): Promise<VisualReview>;
  async getPending(): Promise<VisualReview[]>;
}
```

### Slack Integration
Visual review message format:
```
👁️ [Project Name] Visual Review Required

Task: {task title}
Screenshot attached

Reply with:
✅ - Approve
❌ - Reject (include feedback)
```

### Test Requirements
- Unit tests with mocked Playwright
- Test review status transitions
- Test Slack message parsing
- Integration test for full review flow (with mocks)

### Important Notes
- Use Playwright MCP server for screenshots if available, otherwise direct Playwright
- Screenshots stored locally with optional Supabase storage upload
- Tasks with `requires_visual_review: true` flag trigger this pipeline
- Rejected reviews should trigger retrospective (integrate with Instance 1)

---

## Execution Instructions

Each instance should:
1. Read this prompt and existing codebase
2. Follow TDD: write failing tests first
3. Implement the feature
4. Ensure all tests pass
5. Run `npm run build` to verify TypeScript compiles
6. Commit changes with descriptive message

All instances can run in parallel as they work on separate modules.

---

## Integration Points

After all instances complete:
1. Instance 1 (Retrospectives) integrates with Instance 4 (Visual Review) - rejected reviews trigger retrospectives
2. Instance 2 (Learning) integrates with Instance 1 (Retrospectives) - extract learnings from retrospectives
3. Instance 3 (Subagents) integrates with existing AgentManager
4. Instance 4 (Visual Review) integrates with Slack bot and task completion flow

Final integration will wire these together in the main orchestrator.
