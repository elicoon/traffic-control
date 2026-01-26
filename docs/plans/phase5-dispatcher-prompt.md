# Phase 5 Dispatcher Prompt

**Copy and paste everything below this line to a new Claude Code instance:**

---

## Your Mission

You are executing Phase 5 of TrafficControl - the Integration & Orchestrator phase. Your job is to dispatch 4 parallel subagents to implement the four Phase 5 components, then coordinate their completion.

**Working directory:** `c:\Users\Eli\projects\traffic-control`

**Current State:**
- Phases 1-4 complete with 1540 tests passing
- TypeScript builds clean
- All analytics, dashboard, learning, and review modules implemented

**Your Role:** Dispatcher/coordinator - you will NOT write code directly. You will:
1. Read the detailed prompts from `docs/plans/phase5-parallel-prompts.md`
2. Dispatch 4 subagents in parallel using the Task tool
3. Monitor their progress and handle any questions
4. Run final integration tests after all complete
5. Commit all work

## Step 1: Dispatch Subagents

Use the Task tool to dispatch these 4 subagents **in parallel** (single message with 4 Task tool calls):

### Subagent 1: Main Orchestration Loop
```
subagent_type: general-purpose
description: Phase 5 Main Loop
prompt: |
  You are implementing the main orchestration loop for TrafficControl in c:\Users\Eli\projects\traffic-control.

  Read docs/plans/phase5-parallel-prompts.md section "Instance 1: Main Orchestration Loop" for full requirements.

  Create these files using TDD:
  - src/orchestrator/main-loop.ts
  - src/orchestrator/event-dispatcher.ts
  - src/orchestrator/state-manager.ts
  - Tests for each

  Key integration points:
  - Import Scheduler from src/scheduler/scheduler.ts
  - Import AgentManager from src/agent/manager.ts
  - Import BacklogManager from src/backlog/backlog-manager.ts
  - Import Reporter from src/reporter/reporter.ts
  - Import CapacityTracker from src/scheduler/capacity-tracker.ts
  - Import LearningProvider from src/learning/learning-provider.ts

  Requirements:
  - Polling loop checks capacity every pollIntervalMs
  - Routes agent events (questions, completions, errors)
  - State persistence to file for crash recovery
  - Graceful shutdown with timeout

  Follow TDD: write failing tests first, then implement.
  Do NOT modify CAPABILITIES.md or agents.md (another agent is working on those).
  Commit your work when complete.
```

### Subagent 2: Slack Router Integration
```
subagent_type: general-purpose
description: Phase 5 Slack Router
prompt: |
  You are implementing the Slack router integration for TrafficControl in c:\Users\Eli\projects\traffic-control.

  Read docs/plans/phase5-parallel-prompts.md section "Instance 2: Slack Router Integration" for full requirements.

  Create these files using TDD:
  - src/slack/router.ts
  - src/slack/command-handler.ts
  - src/slack/notification-manager.ts
  - src/slack/thread-tracker.ts
  - Tests for each

  Key integration points:
  - Import SlackBot from src/slack/bot.ts (use as dependency)
  - Will integrate with MainLoop once Instance 1 completes
  - Import BacklogManager from src/backlog/backlog-manager.ts

  Requirements:
  - Route agent questions/blockers to Slack with threading
  - Handle user responses and route back to agents
  - Support commands: status, pause, resume, add task, dnd
  - Notification batching and quiet hours

  Follow TDD: write failing tests first, then implement.
  Do NOT modify CAPABILITIES.md or agents.md.
  Commit your work when complete.
```

### Subagent 3: Event Bus & Coordination
```
subagent_type: general-purpose
description: Phase 5 Event Bus
prompt: |
  You are implementing the event bus system for TrafficControl in c:\Users\Eli\projects\traffic-control.

  Read docs/plans/phase5-parallel-prompts.md section "Instance 3: Event Bus & Coordination" for full requirements.

  Create these files using TDD:
  - src/events/event-bus.ts
  - src/events/event-types.ts
  - src/events/event-logger.ts
  - src/events/index.ts
  - Tests for each

  Requirements:
  - Pub/sub messaging with full TypeScript generics
  - Event types: agent:spawned, agent:question, agent:completed, agent:failed, task:queued, capacity:available, etc.
  - Error isolation (one handler error doesn't break others)
  - Async handler support
  - Event history for debugging (configurable retention)
  - Correlation IDs for tracing

  Follow TDD: write failing tests first, then implement.
  Do NOT modify CAPABILITIES.md or agents.md.
  Commit your work when complete.
```

### Subagent 4: CLI & Startup
```
subagent_type: general-purpose
description: Phase 5 CLI
prompt: |
  You are implementing the CLI and startup system for TrafficControl in c:\Users\Eli\projects\traffic-control.

  Read docs/plans/phase5-parallel-prompts.md section "Instance 4: CLI & Startup" for full requirements.

  Create these files using TDD:
  - src/cli/index.ts
  - src/cli/commands.ts
  - src/cli/config-loader.ts
  - src/cli/logger.ts
  - bin/trafficcontrol.ts
  - Tests for each

  Requirements:
  - CLI commands: start, stop, status, task add/list/cancel, project list/pause/resume, report, config
  - Configuration from environment variables and JSON config file
  - Structured logging with levels (debug, info, warn, error)
  - Validation of required config values

  Environment variables to support:
  - SUPABASE_URL, SUPABASE_SERVICE_KEY
  - SLACK_BOT_TOKEN, SLACK_CHANNEL_ID
  - TC_MAX_CONCURRENT_AGENTS, TC_POLL_INTERVAL_MS
  - TC_LEARNINGS_PATH, TC_LOG_LEVEL

  Follow TDD: write failing tests first, then implement.
  Do NOT modify CAPABILITIES.md or agents.md.
  Commit your work when complete.
```

## Step 2: Monitor Progress

After dispatching, monitor subagent progress. If any ask questions:
- Answer based on context from the phase5-parallel-prompts.md document
- Ensure they follow TDD approach
- Remind them not to touch CAPABILITIES.md or agents.md

## Step 3: Final Integration

Once all 4 subagents complete:

1. **Run build and tests:**
   ```bash
   cd c:/Users/Eli/projects/traffic-control
   npm run build
   npm test
   ```

2. **Create integration test** in `src/orchestrator/integration.test.ts` that:
   - Starts the MainLoop with mocked dependencies
   - Verifies event flow through EventBus
   - Tests Slack routing works
   - Confirms graceful shutdown

3. **Run code review** using the code-reviewer subagent on all new Phase 5 files

4. **Fix any critical issues** identified by review

5. **Final commit:**
   ```bash
   git add .
   git commit -m "feat(trafficcontrol): complete Phase 5 integration & orchestrator

   - Main orchestration loop with state persistence
   - Slack router with threading and commands
   - Event bus with typed pub/sub
   - CLI with config loading and structured logging

   All tests passing.

   Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
   ```

6. **Push to GitHub:**
   ```bash
   git push origin master
   ```

## Important Constraints

1. **Avoid merge conflicts:** Another agent is working on CAPABILITIES.md and agents.md - do NOT modify these files
2. **TDD required:** All subagents must write failing tests first
3. **Commit often:** Each subagent should commit after completing logical units
4. **Integration last:** Only create the integration test after all 4 components exist

## Success Criteria

Phase 5 is complete when:
- All new tests pass (target: 1800+ total tests)
- TypeScript builds clean
- CLI can start/stop the orchestrator
- Events flow between all modules
- Slack integration routes messages correctly
- Code review passes with no critical issues
- Changes pushed to GitHub

---

**Begin by reading docs/plans/phase5-parallel-prompts.md to understand the full requirements, then dispatch all 4 subagents in parallel.**
