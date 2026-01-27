# Backlog Management: Single Source of Truth Design

**Created:** 2026-01-26
**Status:** Design Phase

---

## Problem Statement

Currently backlog items are stored inconsistently:
- Future ideas/features stored in `docs/backlog/*.md` files (6 items)
- Agent-generated proposals stored in `tc_proposals` Supabase table
- Approved tasks stored in `tc_tasks` Supabase table

This creates confusion about:
1. Where to look for what needs to be done
2. Which items are orphaned or duplicated
3. How to manage the full lifecycle from idea → proposal → task
4. How to query/filter/prioritize across all backlog types

## Semantic Model

After analysis, there are three distinct concepts:

### 1. **Backlog Items** (Future Ideas)
- **Purpose:** Long-term ideas, proposals, feature requests
- **Audience:** Humans making strategic decisions
- **Format:** Rich markdown with context, problem statements, solutions
- **Status:** Proposed, In Review, Accepted, Rejected, Implemented
- **Current Storage:** `docs/backlog/*.md`

### 2. **Proposals** (Agent Suggestions)
- **Purpose:** Agent-generated task suggestions awaiting approval
- **Audience:** Human reviewers to approve/reject
- **Format:** Structured data in database
- **Status:** Proposed, Approved, Rejected
- **Current Storage:** `tc_proposals` table

### 3. **Tasks** (Operational Work)
- **Purpose:** Approved, actionable work items being executed
- **Audience:** Orchestrator and agents
- **Format:** Structured data with execution metadata
- **Status:** Queued, Assigned, In Progress, Review, Complete, Blocked
- **Current Storage:** `tc_tasks` table

## Proposed Solution: Unified Backlog with Three Tiers

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  BACKLOG MANAGEMENT                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Tier 1: BACKLOG ITEMS (tc_backlog_items table)        │
│  ┌────────────────────────────────────────────┐        │
│  │ - Long-term ideas and feature proposals     │        │
│  │ - Rich metadata: priority, impact, complexity│        │
│  │ - Markdown description auto-generated        │        │
│  │ - Status: proposed → accepted → implemented  │        │
│  └────────────────────────────────────────────┘        │
│                      ↓ (approved)                        │
│                                                          │
│  Tier 2: PROPOSALS (tc_proposals table - existing)     │
│  ┌────────────────────────────────────────────┐        │
│  │ - Agent-generated task suggestions           │        │
│  │ - Can reference parent backlog_item_id       │        │
│  │ - Status: proposed → approved → rejected     │        │
│  └────────────────────────────────────────────┘        │
│                      ↓ (approved)                        │
│                                                          │
│  Tier 3: TASKS (tc_tasks table - existing)             │
│  ┌────────────────────────────────────────────┐        │
│  │ - Actionable work items                      │        │
│  │ - Can reference backlog_item_id or proposal_id│       │
│  │ - Status: queued → in_progress → complete    │        │
│  └────────────────────────────────────────────┘        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Database Schema: `tc_backlog_items`

```sql
CREATE TABLE tc_backlog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES tc_projects(id) ON DELETE CASCADE,

  -- Core fields
  title TEXT NOT NULL,
  description TEXT NOT NULL,

  -- Classification
  type TEXT NOT NULL CHECK (type IN (
    'feature', 'enhancement', 'architecture',
    'infrastructure', 'documentation', 'security',
    'testing', 'maintenance', 'research'
  )),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  impact_score TEXT CHECK (impact_score IN ('high', 'medium', 'low')),

  -- Estimates
  complexity_estimate TEXT CHECK (complexity_estimate IN ('small', 'medium', 'large', 'x-large')),
  estimated_sessions_opus INTEGER DEFAULT 0,
  estimated_sessions_sonnet INTEGER DEFAULT 0,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed',      -- Initial state
    'in_review',     -- Being evaluated
    'accepted',      -- Approved for future work
    'rejected',      -- Not moving forward
    'in_progress',   -- Work has started (task created)
    'implemented',   -- Work complete
    'archived'       -- Historical record
  )),

  -- Additional metadata
  reasoning TEXT,                    -- Why this is important
  acceptance_criteria TEXT,          -- What "done" looks like
  tags JSONB DEFAULT '[]'::jsonb,   -- Categorization tags
  related_items JSONB DEFAULT '[]'::jsonb,  -- Related backlog item IDs

  -- Links to work items
  proposal_ids JSONB DEFAULT '[]'::jsonb,  -- Generated proposals
  task_ids JSONB DEFAULT '[]'::jsonb,      -- Created tasks

  -- Source tracking
  source TEXT DEFAULT 'user' CHECK (source IN ('user', 'agent', 'imported')),
  source_file TEXT,  -- Original markdown file if imported

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  implemented_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_backlog_items_project_id ON tc_backlog_items(project_id);
CREATE INDEX idx_backlog_items_status ON tc_backlog_items(status);
CREATE INDEX idx_backlog_items_priority ON tc_backlog_items(priority);
CREATE INDEX idx_backlog_items_type ON tc_backlog_items(type);
CREATE INDEX idx_backlog_items_tags ON tc_backlog_items USING GIN (tags);
```

## Single Source of Truth: Database-First

**Decision: Supabase (`tc_backlog_items`) is the canonical source.**

**Rationale:**
1. **Structured queries:** Easy to filter, sort, aggregate
2. **Integration:** Works seamlessly with existing tc_proposals and tc_tasks
3. **Real-time sync:** Orchestrator can monitor changes
4. **Validation:** Database constraints ensure data integrity
5. **Auditability:** Built-in timestamps and tracking

**Markdown as View Layer:**
- Markdown files in `docs/backlog/` become **generated documentation**
- Auto-generated from database using templates
- Human-readable, git-trackable, but not edited directly
- Updated automatically on backlog item changes

## Sync Mechanism

### Database → Markdown (One-way)

```typescript
interface BacklogItemMarkdownGenerator {
  generate(item: BacklogItem): string;
  generateFile(item: BacklogItem): { filename: string; content: string };
  syncAll(): Promise<void>;
}
```

**Sync triggers:**
1. **On backlog item create/update:** Regenerate markdown file
2. **On CLI command:** `tc backlog sync` regenerates all markdown
3. **Scheduled:** Nightly sync to ensure consistency
4. **Pre-commit hook:** Validate markdown is up-to-date

### Markdown → Database (Migration Only)

For existing markdown files, one-time migration:
1. Parse markdown files
2. Extract metadata and content
3. Create `tc_backlog_items` records
4. Mark source_file for reference
5. Archive original markdown (move to `docs/backlog/archive/`)

## CLI Commands

### Backlog Item Management

```bash
# List backlog items
tc backlog list [--status <status>] [--priority <priority>] [--type <type>]

# Add new backlog item
tc backlog add "Title" --description "..." --type feature --priority high

# Show detailed view
tc backlog show <item-id>

# Update backlog item
tc backlog update <item-id> --status accepted --priority high

# Delete backlog item
tc backlog delete <item-id>

# Sync markdown files from database
tc backlog sync

# Import from markdown file (migration)
tc backlog import <markdown-file>

# Promote backlog item to task
tc backlog promote <item-id> --project <project-id>
```

### Validation

```bash
# Validate all backlog items have corresponding markdown
tc backlog validate

# Check for orphaned markdown files
tc backlog check-orphans

# Full consistency check
tc backlog audit
```

## Implementation Phases

### Phase 1: Database Schema & Repository (Foundation)
- Create `tc_backlog_items` table in Supabase
- Implement `BacklogItemRepository` with CRUD operations
- Add unit tests for repository
- Update database indexes

**Files to create/modify:**
- `src/db/schema.sql` - Add table definition
- `src/db/repositories/backlog-items.ts` - New repository
- `src/db/repositories/backlog-items.test.ts` - Tests
- `src/db/repositories/index.ts` - Export new repository

### Phase 2: Markdown Generator (Sync Mechanism)
- Create markdown template system
- Implement BacklogItemMarkdownGenerator
- Add sync command to update markdown files
- Test round-trip consistency

**Files to create/modify:**
- `src/backlog/markdown-generator.ts` - Template engine
- `src/backlog/markdown-generator.test.ts` - Tests
- `src/backlog/templates/` - Markdown templates

### Phase 3: CLI Commands (User Interface)
- Implement backlog CLI commands
- Add to existing CLI command structure
- Create help documentation
- Integration tests for CLI

**Files to modify:**
- `src/cli/commands.ts` - Add backlog commands
- `src/cli/commands.test.ts` - Test backlog commands
- `src/cli/index.ts` - Register backlog commands

### Phase 4: Migration Tool (One-time Import)
- Parse existing markdown files
- Extract metadata using frontmatter
- Bulk import to database
- Archive original files

**Files to create:**
- `src/backlog/markdown-importer.ts` - Import logic
- `src/backlog/markdown-importer.test.ts` - Tests
- `scripts/migrate-backlog.ts` - Migration script

### Phase 5: Validation & Monitoring (Quality Assurance)
- Implement validation checks
- Add orphan detection
- Create audit command
- Set up monitoring/alerts

**Files to create:**
- `src/backlog/validator.ts` - Validation logic
- `src/backlog/validator.test.ts` - Tests

## Migration Plan

### Step 1: Deploy Database Changes
```bash
# Apply schema changes to Supabase
# Via Supabase MCP or manual SQL execution
```

### Step 2: Import Existing Markdown Files
```bash
# Run migration script
node scripts/migrate-backlog.ts --input docs/backlog --archive

# This will:
# 1. Parse each markdown file
# 2. Create tc_backlog_items records
# 3. Move originals to docs/backlog/archive/
```

### Step 3: Generate Fresh Markdown
```bash
# Generate markdown from database
tc backlog sync

# Result: Clean, consistent markdown in docs/backlog/
```

### Step 4: Validate
```bash
# Check everything migrated correctly
tc backlog audit
tc backlog validate
tc backlog check-orphans
```

### Step 5: Update Workflows
- Update documentation to reference CLI commands
- Add pre-commit hook for markdown sync validation
- Update team processes

## Validation Rules

### Consistency Checks
1. **All database items have markdown files:** `backlog-item-id.md` exists for each record
2. **All markdown files have database records:** No orphaned `.md` files
3. **Markdown content matches database:** Generated markdown matches stored data
4. **References are valid:** All `proposal_ids` and `task_ids` point to existing records
5. **Status progression is valid:** Can't skip states in workflow

### Orphan Detection
- Markdown files without database records
- Tasks/proposals without parent backlog items (warning, not error)
- Backlog items with missing referenced proposals/tasks

## Success Criteria

- [x] Single canonical source defined: Supabase `tc_backlog_items`
- [ ] All existing backlog items migrated to database
- [ ] CLI commands implemented and working
- [ ] Markdown sync generates consistent, git-trackable files
- [ ] No orphaned items in non-canonical locations
- [ ] Validation tools detect inconsistencies
- [ ] Documentation updated with new workflows

## Benefits

1. **Single source of truth:** Database is authoritative
2. **Structured queries:** Easy to filter, sort, report on backlog
3. **Integration:** Backlog → Proposal → Task lifecycle tracked
4. **Human-friendly:** Markdown still available for reading
5. **Version control:** Markdown files track changes in git
6. **Automation:** Sync mechanism keeps everything consistent
7. **Validation:** Tools ensure no data loss or orphans

## Future Extensions

- **Web UI:** Dashboard for browsing/managing backlog items
- **AI-powered suggestions:** Agent analyzes codebase and suggests backlog items
- **Backlog grooming:** Automated prioritization based on project state
- **Cross-project dependencies:** Track dependencies between backlog items
- **Voting/comments:** Slack integration for team feedback on backlog items
