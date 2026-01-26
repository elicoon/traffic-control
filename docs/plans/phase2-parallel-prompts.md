# TrafficControl Phase 2 - Parallel Instance Starter Prompts

These prompts are designed for parallel Claude Code instances to tackle Phase 2 tasks independently. Each prompt includes full context so instances can work without coordination.

---

## Instance 1: Capacity-Aware Scheduler

### Task
Implement the capacity-aware scheduler that tracks Opus/Sonnet usage limits and spawns agents only when capacity is available.

### Context
TrafficControl Phase 1 is complete with:
- `src/orchestrator.ts` - Basic main loop (currently limits to 1 concurrent agent)
- `src/agent/manager.ts` - Agent spawning (placeholder implementation)
- `src/db/repositories/tasks.ts` - Task repository with token/session tracking
- Supabase tables: `tc_tasks`, `tc_agent_sessions`, `tc_usage_log`

### Requirements
1. Create `src/scheduler/capacity-tracker.ts`:
   - Track current Opus session count (cap: configurable, default 5)
   - Track current Sonnet session count (cap: configurable, default 10)
   - Track daily/weekly token usage from `tc_usage_log`
   - Expose `hasCapacity(model)`, `reserveCapacity(model)`, `releaseCapacity(model)`

2. Create `src/scheduler/task-queue.ts`:
   - Priority queue for tasks sorted by priority + age
   - Methods: `enqueue()`, `dequeue()`, `peek()`, `getByModel()`
   - Respect model preference (tasks with `estimated_sessions_opus > 0` prefer Opus)

3. Create `src/scheduler/scheduler.ts`:
   - Replace hardcoded `activeSessions.length >= 1` check in orchestrator
   - Spawn multiple agents up to capacity limits
   - Balance between Opus and Sonnet based on task complexity
   - Log capacity utilization metrics

4. Update `src/orchestrator.ts`:
   - Integrate scheduler for capacity-aware spawning
   - Remove hardcoded single-agent limit

### Files to Create/Modify
- CREATE: `src/scheduler/capacity-tracker.ts`
- CREATE: `src/scheduler/capacity-tracker.test.ts`
- CREATE: `src/scheduler/task-queue.ts`
- CREATE: `src/scheduler/task-queue.test.ts`
- CREATE: `src/scheduler/scheduler.ts`
- CREATE: `src/scheduler/scheduler.test.ts`
- CREATE: `src/scheduler/index.ts`
- MODIFY: `src/orchestrator.ts`

### Environment Variables to Add
```
OPUS_SESSION_LIMIT=5
SONNET_SESSION_LIMIT=10
OPUS_DAILY_TOKEN_LIMIT=1000000
SONNET_DAILY_TOKEN_LIMIT=5000000
```

### Success Criteria
- [ ] All tests pass
- [ ] Multiple agents spawn when capacity available
- [ ] No agents spawn when at capacity
- [ ] Capacity releases when agents complete
- [ ] Metrics logged for utilization tracking

---

## Instance 2: Claude Agent SDK Integration

### Task
Replace the placeholder agent spawning with actual Claude Agent SDK integration.

### Context
TrafficControl Phase 1 has:
- `src/agent/manager.ts` - Has `spawnAgent()` and `injectMessage()` as placeholders
- `src/agent/types.ts` - Type definitions for AgentConfig, AgentSession, AgentEvent
- Package `@anthropic-ai/claude-agent-sdk` is installed

### Requirements
1. Update `src/agent/manager.ts`:
   - Implement actual SDK integration in `spawnAgent()`
   - Use `claudeCode()` or appropriate SDK method
   - Pass system prompt with task context and learnings
   - Stream events and emit them through the event system

2. Create `src/agent/sdk-adapter.ts`:
   - Wrap SDK calls for easier testing/mocking
   - Handle SDK-specific configurations
   - Map SDK events to our AgentEvent types

3. Implement event handling:
   - `on_question` - Capture when agent asks a question, emit 'question' event
   - `on_tool_call` - Log tool usage, track tokens
   - `on_completion` - Capture final state, emit 'completion' event
   - `on_error` - Handle errors gracefully, emit 'error' event

4. Implement `injectMessage()`:
   - Actually send user message to blocked agent
   - Resume agent execution

5. Token tracking:
   - Capture token usage from SDK
   - Update session `tokensUsed`
   - Log to `tc_usage_log` via repository

### Reference Documentation
- Claude Agent SDK: https://docs.anthropic.com/en/api/agent-sdk
- Check `node_modules/@anthropic-ai/claude-agent-sdk` for types

### Files to Create/Modify
- CREATE: `src/agent/sdk-adapter.ts`
- CREATE: `src/agent/sdk-adapter.test.ts`
- MODIFY: `src/agent/manager.ts`
- MODIFY: `src/agent/types.ts` (if needed for SDK types)

### Success Criteria
- [ ] Agents actually spawn and run via SDK
- [ ] Questions from agents are captured and emitted
- [ ] Token usage is tracked
- [ ] Messages can be injected to resume blocked agents
- [ ] All tests pass

---

## Instance 3: Backlog Manager with Proposals

### Task
Implement the backlog manager that proactively proposes new tasks when the backlog runs low.

### Context
TrafficControl Phase 1 has:
- `src/db/repositories/tasks.ts` - Task CRUD
- `src/db/repositories/projects.ts` - Project CRUD
- `src/slack/bot.ts` - Message formatting and sending
- Design doc specifies backlog manager should propose tasks with impact assessment

### Requirements
1. Create `src/backlog/backlog-manager.ts`:
   - Monitor backlog depth (configurable threshold, default: 5 tasks)
   - When below threshold, generate task proposals
   - Track proposal state: proposed, approved, rejected

2. Create `src/backlog/proposal-generator.ts`:
   - Analyze existing projects and completed tasks
   - Generate meaningful task proposals with:
     - Title and description
     - Impact assessment (high/medium/low)
     - Estimated sessions (Opus vs Sonnet)
     - Reasoning for the proposal
   - Use Claude to generate proposals (meta: agents proposing work for agents)

3. Create Slack integration for proposals:
   - Format proposals as interactive messages
   - Support approval commands: "approve all", "approve 1,3", "reject 2: reason"
   - Convert approved proposals to actual tasks

4. Create `src/db/repositories/proposals.ts`:
   - Store proposal history for learning
   - Track approval/rejection patterns

5. Add migration for `tc_proposals` table:
   - id, project_id, title, description
   - impact_score, estimated_sessions_opus, estimated_sessions_sonnet
   - reasoning, status (proposed/approved/rejected)
   - rejection_reason, created_at, resolved_at

### Files to Create/Modify
- CREATE: `src/backlog/backlog-manager.ts`
- CREATE: `src/backlog/backlog-manager.test.ts`
- CREATE: `src/backlog/proposal-generator.ts`
- CREATE: `src/backlog/proposal-generator.test.ts`
- CREATE: `src/backlog/index.ts`
- CREATE: `src/db/repositories/proposals.ts`
- CREATE: `src/db/repositories/proposals.test.ts`
- MODIFY: `src/slack/handlers.ts` (add proposal commands)
- MODIFY: `src/slack/bot.ts` (add proposal formatting)
- APPLY MIGRATION: `tc_proposals` table

### Success Criteria
- [ ] Backlog depth is monitored
- [ ] Proposals generated when backlog low
- [ ] Proposals sent to Slack with proper formatting
- [ ] Approval commands work
- [ ] Approved proposals become tasks
- [ ] All tests pass

---

## Instance 4: Reporter with Status Reports

### Task
Implement the reporter that sends twice-daily status reports with metrics and recommendations.

### Context
TrafficControl Phase 1 has:
- `src/db/repositories/tasks.ts` - Task data
- `src/db/repositories/projects.ts` - Project data
- Supabase tables for usage logs and sessions
- `src/slack/bot.ts` - Message formatting

### Requirements
1. Create `src/reporter/reporter.ts`:
   - Schedule twice-daily reports (morning 8 AM, evening 6 PM)
   - Respect quiet hours (midnight to 7 AM)
   - Trigger immediate report via Slack command

2. Create `src/reporter/metrics-collector.ts`:
   - Collect per-project metrics:
     - Tasks completed in period
     - Tasks in progress
     - Blocked tasks
     - Token usage (Opus + Sonnet)
     - Cost in USD
   - Calculate utilization percentages
   - Compare estimates vs actuals

3. Create `src/reporter/recommendation-engine.ts`:
   - Analyze metrics to provide recommendations:
     - "Project X is blocked, consider adding capacity"
     - "Project Y completed ahead of estimate, backlog running low"
     - "Opus underutilized, consider more complex tasks"
   - Priority reallocation suggestions based on ROI

4. Create Slack report formatting:
   - Clear, scannable status report
   - Per-project breakdown
   - Utilization dashboard
   - Action items / recommendations

5. Add Slack command: `/tc report` for immediate report

### Files to Create/Modify
- CREATE: `src/reporter/reporter.ts`
- CREATE: `src/reporter/reporter.test.ts`
- CREATE: `src/reporter/metrics-collector.ts`
- CREATE: `src/reporter/metrics-collector.test.ts`
- CREATE: `src/reporter/recommendation-engine.ts`
- CREATE: `src/reporter/recommendation-engine.test.ts`
- CREATE: `src/reporter/index.ts`
- MODIFY: `src/slack/bot.ts` (add report formatting)
- MODIFY: `src/slack/handlers.ts` (add report command)

### Environment Variables to Add
```
REPORT_MORNING_HOUR=8
REPORT_EVENING_HOUR=18
QUIET_HOURS_START=0
QUIET_HOURS_END=7
TIMEZONE=America/New_York
```

### Success Criteria
- [ ] Twice-daily reports sent automatically
- [ ] Reports include all required metrics
- [ ] Recommendations are actionable
- [ ] `/tc report` command works
- [ ] Quiet hours respected
- [ ] All tests pass

---

## Coordination Notes

These four tasks are independent and can run in parallel without conflicts:
- **Instance 1** (Scheduler) modifies `orchestrator.ts` capacity logic
- **Instance 2** (SDK) modifies `agent/manager.ts` internals
- **Instance 3** (Backlog) creates new backlog module, modifies Slack handlers
- **Instance 4** (Reporter) creates new reporter module, modifies Slack handlers

**Potential conflict**: Instances 3 and 4 both modify `slack/handlers.ts`. Resolution:
- Each adds their own command handlers
- Commands are independent (`approve`, `reject` vs `report`)
- Git merge should handle automatically

**Recommended order if running sequentially**:
1. Instance 2 (SDK) - Enables actual agent execution
2. Instance 1 (Scheduler) - Enables multi-agent
3. Instance 3 (Backlog) and Instance 4 (Reporter) - Can run in parallel

---

## Usage

Copy the relevant section to a new Claude Code session. Each instance will have full context to work independently.

Example:
```
[Copy Instance 1 prompt]

Additional context: This is TrafficControl Phase 2. Phase 1 is complete.
Working directory: c:\Users\Eli\portfolio-website\trafficControl
```
