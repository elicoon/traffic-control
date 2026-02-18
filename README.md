# TrafficControl

Autonomous agent orchestration system for Claude Code.

## Overview

TrafficControl manages autonomous Claude Code agents, coordinating task assignment, status tracking, and human-in-the-loop communication via Slack. The system is designed to maximize Claude usage capacity (100% utilization) while minimizing manual intervention.

**Current Status:** Phase 5 complete with 1,683 passing tests.

## Features

### Core Orchestration
- **Multi-agent management** - Spawn and track multiple Claude Code agents
- **Task queue** - Priority-based task scheduling with dependency management
- **Capacity tracking** - Monitor Opus and Sonnet session limits
- **State persistence** - Recover from crashes with state files

### Resilience & Health Monitoring
- **Database health checks** - Startup validation with exponential backoff retry
- **Graceful degradation** - Continues operating in degraded mode during DB outages
- **Automatic recovery** - Detects when services recover and resumes normal operation
- **Slack retry logic** - Handles transient network failures with exponential backoff

### Slack Integration
- **Question routing** - Agent questions posted to Slack threads for human response
- **Thread tracking** - Maintains conversation context across interactions
- **Notification batching** - Efficient grouped message delivery
- **Command handling** - Respond to Slack commands

### Learning & Retrospectives
- **Automatic retrospectives** - Triggered after failures or blocked tasks
- **Learning storage** - Persist lessons learned across sessions
- **Calibration tracking** - Improve estimation accuracy over time

## Setup

1. Copy `.env.example` to `.env` and fill in credentials:
   ```bash
   cp .env.example .env
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Apply database schema (see Database Setup below)

4. Build:
   ```bash
   npm run build
   ```

5. Run:
   ```bash
   npm run start
   ```

## Development

```bash
# Run with hot reload
npm run dev

# Run tests (1683 tests)
npm run test

# Run specific test file
npm run test -- src/orchestrator/main-loop.test.ts

# Run tests in watch mode
npm run test:watch

# Compile TypeScript
npm run build

# Run CLI
npm run cli
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Yes |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (xoxb-...) for sending messages | Yes |
| `SLACK_SIGNING_SECRET` | Slack app signing secret for request verification | Yes |
| `SLACK_APP_TOKEN` | Slack app-level token (xapp-...) for Socket Mode | Yes |
| `SLACK_CHANNEL` | Channel name for agent notifications | No (default: trafficcontrol) |
| `SLACK_CHANNEL_ID` | Channel ID for notifications (more reliable than name) | No |
| `SLACK_REPORT_CHANNEL` | Channel for status reports | No (default: #trafficcontrol) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude | Yes |
| `OPUS_SESSION_LIMIT` | Max concurrent Opus sessions | No (default: 1, recommended max: 2) |
| `SONNET_SESSION_LIMIT` | Max concurrent Sonnet sessions | No (default: 2, recommended max: 5) |
| `TC_LEARNINGS_PATH` | Path to learnings directory | No (default: ./learnings) |
| `TC_RETROSPECTIVES_PATH` | Path to retrospectives | No (default: ./retrospectives) |
| `TC_AGENTS_PATH` | Path to agents.md | No (default: ./agents.md) |

## Slack Setup

TrafficControl requires Slack integration for agent-human communication. For detailed setup instructions, see [docs/SLACK_SETUP.md](docs/SLACK_SETUP.md).

### Quick Start

1. Create a Slack App at https://api.slack.com/apps
2. Enable Socket Mode and create an App-Level Token with `connections:write` scope
3. Add Bot Token Scopes: `chat:write`, `channels:read`, `channels:history`, `channels:manage`, `reactions:read`, `users:read`
4. Enable Event Subscriptions and subscribe to `message.channels`
5. Install the app to your workspace
6. Copy tokens to `.env`:
   - Bot User OAuth Token → `SLACK_BOT_TOKEN` (xoxb-...)
   - Signing Secret → `SLACK_SIGNING_SECRET`
   - App-Level Token → `SLACK_APP_TOKEN` (xapp-...)
   - Channel ID → `SLACK_CHANNEL_ID`
7. Invite the bot to your channel: `/invite @YourBotName`

For troubleshooting, security best practices, and advanced configuration options, refer to the [detailed setup guide](docs/SLACK_SETUP.md).

## Database Setup

TrafficControl uses Supabase (PostgreSQL). Core tables (all prefixed with `tc_`):

```sql
-- Projects table
CREATE TABLE tc_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tasks table
CREATE TABLE tc_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES tc_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'assigned', 'in_progress', 'review', 'complete', 'blocked')),
  priority INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  tags JSONB,
  acceptance_criteria TEXT,
  parent_task_id UUID REFERENCES tc_tasks(id),
  blocked_by_task_id UUID REFERENCES tc_tasks(id),
  eta TIMESTAMPTZ,
  complexity_estimate TEXT,
  estimated_sessions_opus INTEGER NOT NULL DEFAULT 0,
  estimated_sessions_sonnet INTEGER NOT NULL DEFAULT 0,
  actual_tokens_opus INTEGER NOT NULL DEFAULT 0,
  actual_tokens_sonnet INTEGER NOT NULL DEFAULT 0,
  actual_sessions_opus INTEGER NOT NULL DEFAULT 0,
  actual_sessions_sonnet INTEGER NOT NULL DEFAULT 0,
  assigned_agent_id TEXT,
  requires_visual_review BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Proposals table
CREATE TABLE tc_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES tc_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  impact_score TEXT CHECK (impact_score IN ('high', 'medium', 'low')),
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  estimated_sessions_opus INTEGER,
  estimated_sessions_sonnet INTEGER,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tc_tasks_project_id ON tc_tasks(project_id);
CREATE INDEX idx_tc_tasks_status ON tc_tasks(status);
CREATE INDEX idx_tc_projects_status ON tc_projects(status);
```

See the Supabase dashboard for additional tables: `tc_agent_sessions`, `tc_usage_log`, `tc_interventions`, `tc_budgets`, `tc_calibration_factors`, `tc_retrospectives`, `tc_visual_reviews`.

## Architecture

```
traffic-control/
├── src/
│   ├── index.ts              # Entry point
│   ├── orchestrator.ts       # Main coordination wrapper
│   ├── orchestrator/
│   │   ├── main-loop.ts      # Core orchestration loop
│   │   ├── state-manager.ts  # State persistence
│   │   ├── event-dispatcher.ts
│   │   └── delegation-metrics.ts
│   ├── db/
│   │   ├── client.ts         # Supabase client with health checks
│   │   └── repositories/     # Data access layer
│   ├── agent/
│   │   ├── manager.ts        # Agent lifecycle management
│   │   ├── sdk-adapter.ts    # Claude Agent SDK integration
│   │   └── subagent-tracker.ts
│   ├── scheduler/
│   │   ├── scheduler.ts      # Task scheduling
│   │   ├── task-queue.ts     # Priority queue
│   │   └── capacity-tracker.ts
│   ├── slack/
│   │   ├── bot.ts            # Slack bot with retry logic
│   │   ├── router.ts         # Message routing
│   │   ├── handlers.ts       # Event handlers
│   │   ├── notification-manager.ts
│   │   └── thread-tracker.ts
│   ├── learning/
│   │   ├── learning-store.ts
│   │   ├── learning-provider.ts
│   │   └── retrospective-trigger.ts
│   ├── reporter/
│   │   └── metrics-collector.ts
│   ├── backlog/
│   │   └── backlog-manager.ts
│   ├── events/
│   │   ├── event-bus.ts
│   │   └── event-types.ts
│   └── cli/
│       ├── index.ts
│       └── config-loader.ts
├── docs/
│   ├── backlog/              # Detailed backlog proposals
│   └── plans/                # Implementation plans
├── learnings/                # Stored learnings
├── CLAUDE.md                 # AI assistant instructions
├── agents.md                 # Agent behavior guidelines
├── CAPABILITIES.md           # Tools & skills reference
└── traffic-control-initial-spec.md         # Core philosophy
```

## How It Works

1. **Task Queue**: Tasks are created in the database with status `queued`
2. **Health Check**: Orchestrator validates database connectivity on startup
3. **Assignment**: The orchestrator picks up queued tasks and spawns Claude agents
4. **Execution**: Agents work on tasks, updating status to `in_progress`
5. **Questions**: When an agent needs human input, it posts to Slack
6. **Responses**: Humans reply in Slack thread, response is injected back to agent
7. **Completion**: Agent completes task, status updates to `complete`
8. **Learning**: On failures, retrospectives are triggered to capture learnings

## Resilience Features

### Database Health Checks
```typescript
// Startup validation with retry
const health = await checkHealth(5000); // 5s timeout
if (!health.healthy) {
  await waitForHealthy({ maxRetries: 5, initialDelayMs: 1000 });
}
```

### Graceful Degradation
The orchestrator enters degraded mode after consecutive database failures:
- Skips normal tick operations
- Attempts recovery via health checks
- Emits `database:degraded` and `database:recovered` events
- Automatically resumes when database is available

### Slack Retry Logic
```typescript
// Transient errors are retried with exponential backoff
// Auth/permission errors fail immediately
await sendMessage(channel, text, {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000
});
```

## Implemented Phases

- **Phase 1**: Single agent spawning, Slack question routing, basic status tracking
- **Phase 2**: Multi-agent coordination with dependency management
- **Phase 3**: Automatic task planning and decomposition
- **Phase 4**: Visual review integration, context optimization
- **Phase 5**: Resilience improvements, health checks, graceful degradation

## Planned Features

- **CLI Interface**: Interact with TrafficControl from Claude Code terminal
- **Cost optimization**: Intelligent model selection based on task complexity
- **Backlog sync**: Single source of truth between Supabase and markdown files

## License

MIT
