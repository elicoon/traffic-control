# TrafficControl

Autonomous agent orchestration system for Claude Code.

## Overview

TrafficControl manages autonomous Claude Code agents, coordinating task assignment, status tracking, and human-in-the-loop communication via Slack.

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

# Run tests
npm run test

# Run specific test file
npm run test -- src/integration.test.ts

# Compile TypeScript
npm run build
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret |
| `SLACK_APP_TOKEN` | Slack app-level token (xapp-...) |
| `SLACK_CHANNEL` | Channel name for notifications (default: trafficcontrol) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |

## Slack Setup

1. Create a Slack App at https://api.slack.com/apps
2. Enable Socket Mode in Settings > Socket Mode
3. Create an App-Level Token with `connections:write` scope
4. Add Bot Token Scopes under OAuth & Permissions:
   - `chat:write`
   - `channels:read`
   - `channels:history`
   - `reactions:read`
5. Enable Events under Event Subscriptions and subscribe to:
   - `message.channels`
6. Install the app to your workspace
7. Copy tokens to `.env`:
   - Bot User OAuth Token -> `SLACK_BOT_TOKEN`
   - Signing Secret -> `SLACK_SIGNING_SECRET`
   - App-Level Token -> `SLACK_APP_TOKEN`
8. Invite the bot to your channel: `/invite @YourBotName`

## Database Setup

TrafficControl uses Supabase (PostgreSQL). Apply the following schema:

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

-- Indexes
CREATE INDEX idx_tc_tasks_project_id ON tc_tasks(project_id);
CREATE INDEX idx_tc_tasks_status ON tc_tasks(status);
CREATE INDEX idx_tc_projects_status ON tc_projects(status);
```

## Phase 1 Features

- Single agent spawning via Claude Agent SDK
- Slack question routing (agent asks question -> Slack -> human replies -> agent continues)
- Manual task assignment via database
- Basic status tracking (queued -> assigned -> in_progress -> complete)
- Token and session usage recording

## Architecture

```
trafficControl/
├── src/
│   ├── index.ts           # Entry point
│   ├── orchestrator.ts    # Main coordination logic
│   ├── db/
│   │   ├── client.ts      # Supabase client
│   │   └── repositories/  # Data access layer
│   │       ├── projects.ts
│   │       └── tasks.ts
│   ├── agent/
│   │   ├── manager.ts     # Agent lifecycle management
│   │   └── types.ts       # Agent-related types
│   └── slack/
│       ├── bot.ts         # Slack bot initialization
│       └── handlers.ts    # Message handlers
```

## How It Works

1. **Task Queue**: Tasks are created in the database with status `queued`
2. **Assignment**: The orchestrator picks up queued tasks and spawns Claude agents
3. **Execution**: Agents work on tasks, updating status to `in_progress`
4. **Questions**: When an agent needs human input, it posts to Slack
5. **Responses**: Humans reply in Slack thread, response is injected back to agent
6. **Completion**: Agent completes task, status updates to `complete`

## Future Phases

- Phase 2: Multi-agent coordination with dependency management
- Phase 3: Automatic task planning and decomposition
- Phase 4: Visual review integration
- Phase 5: Cost optimization and intelligent model selection
