# TrafficControl Agent Capabilities

This document describes all tools, skills, and MCP servers available to agents spawned by TrafficControl. Reference this when deciding how to approach a task.

---

## Table of Contents

1. [Built-in Tools](#built-in-tools)
2. [Skills (Slash Commands)](#skills-slash-commands)
3. [MCP Servers](#mcp-servers)
4. [Decision Guide](#decision-guide)

---

## Built-in Tools

Core tools available in every Claude Code session.

### File Operations

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **Read** | Read file contents | Reading any file, including images, PDFs, notebooks |
| **Write** | Create new files | Only when creating genuinely new files |
| **Edit** | Modify existing files | Prefer over Write for any existing file changes |
| **Glob** | Find files by pattern | Finding files by name/extension (e.g., `**/*.ts`) |
| **Grep** | Search file contents | Finding code patterns, function definitions, usages |

**Best Practices:**
- Always Read before Edit to understand existing code
- Use Glob before Grep to narrow search scope
- Prefer Edit over Write for existing files

### Execution

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **Bash** | Run shell commands | Git operations, npm/yarn, build commands, tests |
| **Task** | Spawn sub-agents | Complex multi-step tasks, parallel work, exploration |

**Task Sub-Agent Types:**
- `Explore` - Codebase exploration, understanding architecture
- `Plan` - Designing implementation strategies
- `Bash` - Command execution specialist
- `general-purpose` - Multi-step tasks, research

### Communication

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **AskUserQuestion** | Get user input | Clarifying requirements, making decisions |
| **TodoWrite** | Track task progress | Multi-step tasks, showing progress to user |

### Web & Research

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **WebFetch** | Fetch and analyze URLs | Reading documentation, analyzing web content |
| **WebSearch** | Search the internet | Finding current information, documentation |

---

## Skills (Slash Commands)

Specialized capabilities invoked via the Skill tool. Use `skill: "name"` to invoke.

### Development Skills

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| **frontend-design** | Create production-grade UI | Building web components, pages, applications |
| **brainstorming** | Explore requirements before coding | BEFORE any creative/feature work |
| **test-driven-development** | TDD workflow | Before writing implementation code |
| **systematic-debugging** | Debug issues methodically | When encountering bugs or test failures |
| **writing-plans** | Create implementation plans | When you have specs for multi-step work |
| **executing-plans** | Execute written plans | When you have a plan ready to implement |

### Code Quality Skills

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| **code-review** | Review pull requests | After completing features, before merging |
| **requesting-code-review** | Request review of your work | After implementing major features |
| **receiving-code-review** | Process review feedback | When receiving feedback on your code |
| **verification-before-completion** | Verify work is actually done | Before claiming work is complete |

### Git & Workflow Skills

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| **using-git-worktrees** | Create isolated workspaces | Starting feature work needing isolation |
| **finishing-a-development-branch** | Complete and integrate work | When implementation is done, tests pass |

### Collaboration Skills

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| **dispatching-parallel-agents** | Coordinate parallel work | 2+ independent tasks to work on |
| **subagent-driven-development** | Execute with sub-agents | Implementing plans with independent tasks |

### Documentation Skills

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| **claude-md-improver** | Audit/improve CLAUDE.md | When asked to check or update CLAUDE.md |
| **revise-claude-md** | Update CLAUDE.md with learnings | After session with important learnings |
| **writing-skills** | Create/edit skills | When creating new skills or modifying existing |

---

## MCP Servers

External services available through MCP (Model Context Protocol).

### Supabase (Database)

**Prefix:** `mcp__supabase__`

| Tool | Purpose |
|------|---------|
| `search_docs` | Search Supabase documentation |
| `list_tables` | List database tables |
| `execute_sql` | Run SQL queries |
| `apply_migration` | Apply DDL migrations |
| `get_logs` | Get service logs (api, postgres, auth, etc.) |
| `get_advisors` | Get security/performance advisories |
| `generate_typescript_types` | Generate TS types from schema |
| `deploy_edge_function` | Deploy Deno edge functions |
| `list_edge_functions` | List deployed functions |
| `create_branch` / `list_branches` / `merge_branch` | Branch management |

**When to Use:** Database operations, migrations, edge functions, debugging database issues.

### Playwright (Browser Automation)

**Prefix:** `mcp__playwright__`

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Navigate to URL |
| `browser_snapshot` | Get accessibility snapshot (preferred over screenshot) |
| `browser_take_screenshot` | Capture visual screenshot |
| `browser_click` | Click elements |
| `browser_type` | Type text |
| `browser_fill_form` | Fill multiple form fields |
| `browser_evaluate` | Run JavaScript in browser |
| `browser_console_messages` | Get console logs |
| `browser_network_requests` | Get network activity |
| `browser_wait_for` | Wait for text/conditions |
| `browser_close` | Close browser |

**When to Use:** E2E testing, UI verification, web scraping, automated testing.

### Google Calendar

**Prefix:** `mcp__google-calendar__`

| Tool | Purpose |
|------|---------|
| `get-current-time` | Get current date/time (call FIRST) |
| `list-calendars` | List available calendars |
| `list-events` | List events in time range |
| `search-events` | Search events by query |
| `create-event` | Create new event |
| `update-event` | Modify existing event |
| `delete-event` | Delete event |
| `get-freebusy` | Check availability |
| `respond-to-event` | RSVP to invitations |

**When to Use:** Scheduling, calendar management, checking availability.

### Google Drive

**Prefix:** `mcp__google-drive__`

| Tool | Purpose |
|------|---------|
| `search` | Search for files |
| `listFolder` | List folder contents |
| `createTextFile` / `updateTextFile` | Text/markdown files |
| `createGoogleDoc` / `updateGoogleDoc` | Google Docs |
| `createGoogleSheet` / `updateGoogleSheet` | Google Sheets |
| `createGoogleSlides` / `updateGoogleSlides` | Google Slides |
| `formatGoogleDoc*` | Doc formatting |
| `formatGoogleSheet*` | Sheet formatting |
| `createFolder` / `moveItem` / `deleteItem` | File management |

**When to Use:** Document creation, spreadsheet data, presentations, file storage.

### Puppeteer (Alternative Browser Automation)

**Prefix:** `mcp__puppeteer__`

| Tool | Purpose |
|------|---------|
| `puppeteer_navigate` | Navigate to URL |
| `puppeteer_screenshot` | Take screenshot |
| `puppeteer_click` | Click element |
| `puppeteer_fill` | Fill input |
| `puppeteer_evaluate` | Run JavaScript |

**When to Use:** Alternative to Playwright for browser automation. Playwright is generally preferred.

---

## Decision Guide

### Choosing Between Similar Tools

**File Search: Glob vs Grep vs Task(Explore)**
- **Glob**: Know the file pattern, finding by name → `*.test.ts`
- **Grep**: Know the content pattern, finding by code → `function handleError`
- **Task(Explore)**: Open-ended exploration, understanding architecture

**Browser: Playwright vs Puppeteer**
- **Playwright**: Preferred for most browser automation
- **Puppeteer**: Fallback if Playwright has issues

**Database: execute_sql vs apply_migration**
- **execute_sql**: SELECT queries, data reads
- **apply_migration**: DDL changes (CREATE, ALTER, DROP)

**Sub-agents: Task vs Skill**
- **Task**: General sub-agent work, exploration, multi-step tasks
- **Skill**: Specific workflows with predefined best practices

### Task Complexity Guide

| Complexity | Approach |
|------------|----------|
| Simple (1-2 steps) | Direct tool use |
| Medium (3-5 steps) | TodoWrite + direct tools |
| Complex (5+ steps) | Task sub-agent or Skill |
| Multi-file refactor | Task(Explore) first, then Task(Plan) |
| UI work | frontend-design skill |
| Bug fix | systematic-debugging skill |

### Common Patterns

**Investigating an Issue:**
```
1. Task(Explore) to understand the area
2. Grep to find specific code
3. Read relevant files
4. systematic-debugging skill if needed
```

**Implementing a Feature:**
```
1. brainstorming skill (requirements)
2. writing-plans skill (design)
3. test-driven-development skill (implement)
4. verification-before-completion skill (verify)
```

**Database Changes:**
```
1. mcp__supabase__list_tables (understand schema)
2. mcp__supabase__apply_migration (DDL changes)
3. mcp__supabase__get_advisors (check for issues)
4. mcp__supabase__generate_typescript_types (update types)
```

**UI Verification:**
```
1. mcp__playwright__browser_navigate
2. mcp__playwright__browser_snapshot (accessibility)
3. mcp__playwright__browser_console_messages (errors)
4. mcp__playwright__browser_take_screenshot (visual)
```

---

## Notes for Orchestrator

When spawning sub-agents, reference this file rather than including all capability details in prompts. This keeps context minimal while ensuring agents know what's available.

```typescript
// Good: Reference the doc
systemPrompt: `See CAPABILITIES.md for available tools and MCP servers.`

// Bad: Include all details
systemPrompt: `You have access to Supabase with these tools: [...1000 lines...]`
```
