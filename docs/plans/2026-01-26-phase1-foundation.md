# TrafficControl Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the foundational infrastructure for TrafficControl - single agent spawning, Slack integration for question routing, Supabase schema, and manual task assignment.

**Architecture:** TypeScript Node.js application using Claude Agent SDK for agent management, Slack Bolt for messaging, and Supabase JS client for data persistence. Event-driven architecture with the orchestrator as the central coordinator.

**Tech Stack:** TypeScript, Node.js, @anthropic-ai/claude-agent-sdk, @slack/bolt, @supabase/supabase-js, Vitest for testing

---

## Prerequisites

Before starting, ensure you have:
- Node.js 20+ installed
- Slack workspace with permission to create apps
- Supabase project credentials (already configured via MCP)
- Anthropic API key for Claude Agent SDK

---

## Task 1: Project Setup

**Files:**
- Create: `traffic-control/src/index.ts`
- Create: `traffic-control/package.json`
- Create: `traffic-control/tsconfig.json`
- Create: `traffic-control/.env.example`
- Create: `traffic-control/.gitignore`

**Step 1: Initialize package.json**

```bash
cd traffic-control
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install @anthropic-ai/claude-agent-sdk @slack/bolt @supabase/supabase-js dotenv
npm install -D typescript @types/node vitest
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .env.example**

```
ANTHROPIC_API_KEY=sk-ant-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
.env
*.log
```

**Step 6: Create src/index.ts**

```typescript
import 'dotenv/config';

console.log('TrafficControl starting...');

// Placeholder - will be replaced with actual orchestrator
async function main() {
  console.log('TrafficControl Phase 1 - Foundation');
}

main().catch(console.error);
```

**Step 7: Add scripts to package.json**

Update package.json to add:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest"
  }
}
```

**Step 8: Verify setup**

```bash
npm run build
npm run start
```

Expected: "TrafficControl Phase 1 - Foundation" printed to console

**Step 9: Commit**

```bash
git add traffic-control/
git commit -m "feat(trafficcontrol): initialize project structure"
```

---

## Task 2: Supabase Schema Setup

**Files:**
- Create: `traffic-control/src/db/schema.sql` (reference only)
- Create: `traffic-control/src/db/client.ts`
- Test: `traffic-control/src/db/client.test.ts`

**Step 1: Write the failing test**

Create `traffic-control/src/db/client.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createSupabaseClient, testConnection } from './client.js';

describe('Supabase Client', () => {
  it('should create a client instance', () => {
    const client = createSupabaseClient();
    expect(client).toBeDefined();
  });

  it('should connect to database', async () => {
    const result = await testConnection();
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/db/client.test.ts
```

Expected: FAIL - module not found

**Step 3: Create the Supabase client**

Create `traffic-control/src/db/client.ts`:

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function createSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  client = createClient(url, key);
  return client;
}

export async function testConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const client = createSupabaseClient();
    const { error } = await client.from('tc_projects').select('count').limit(1);

    // Table might not exist yet, but connection worked if no network error
    if (error && !error.message.includes('does not exist')) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/db/client.test.ts
```

Expected: PASS (connection test may show table not found, but that's expected)

**Step 5: Apply database migration**

Use the Supabase MCP tool to create tables:

```sql
-- TrafficControl Projects
CREATE TABLE tc_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TrafficControl Tasks
CREATE TABLE tc_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES tc_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'assigned', 'in_progress', 'review', 'complete', 'blocked')),
  priority INTEGER NOT NULL DEFAULT 0,
  complexity_estimate TEXT,
  estimated_sessions_opus INTEGER DEFAULT 0,
  estimated_sessions_sonnet INTEGER DEFAULT 0,
  actual_tokens_opus BIGINT DEFAULT 0,
  actual_tokens_sonnet BIGINT DEFAULT 0,
  actual_sessions_opus INTEGER DEFAULT 0,
  actual_sessions_sonnet INTEGER DEFAULT 0,
  assigned_agent_id TEXT,
  requires_visual_review BOOLEAN DEFAULT false,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TrafficControl Agent Sessions
CREATE TABLE tc_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id) ON DELETE SET NULL,
  model TEXT NOT NULL CHECK (model IN ('opus', 'sonnet', 'haiku')),
  parent_session_id UUID REFERENCES tc_agent_sessions(id),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'blocked', 'waiting_approval', 'complete', 'failed')),
  tokens_used BIGINT DEFAULT 0,
  blocker_reason TEXT,
  blocker_sent_at TIMESTAMPTZ,
  blocker_resolved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

-- TrafficControl Usage Log
CREATE TABLE tc_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES tc_agent_sessions(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  tokens_input BIGINT NOT NULL DEFAULT 0,
  tokens_output BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TrafficControl Interventions
CREATE TABLE tc_interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('question', 'approval', 'blocker', 'review')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  duration_seconds INTEGER
);

-- Enable RLS
ALTER TABLE tc_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_interventions ENABLE ROW LEVEL SECURITY;

-- Service role policies (TrafficControl uses service key)
CREATE POLICY "Service role full access" ON tc_projects FOR ALL USING (true);
CREATE POLICY "Service role full access" ON tc_tasks FOR ALL USING (true);
CREATE POLICY "Service role full access" ON tc_agent_sessions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON tc_usage_log FOR ALL USING (true);
CREATE POLICY "Service role full access" ON tc_interventions FOR ALL USING (true);

-- Indexes for common queries
CREATE INDEX idx_tc_tasks_project_id ON tc_tasks(project_id);
CREATE INDEX idx_tc_tasks_status ON tc_tasks(status);
CREATE INDEX idx_tc_agent_sessions_task_id ON tc_agent_sessions(task_id);
CREATE INDEX idx_tc_agent_sessions_status ON tc_agent_sessions(status);
CREATE INDEX idx_tc_usage_log_session_id ON tc_usage_log(session_id);
```

**Step 6: Commit**

```bash
git add traffic-control/src/db/
git commit -m "feat(trafficcontrol): add Supabase client and schema"
```

---

## Task 3: Database Repository Layer

**Files:**
- Create: `traffic-control/src/db/repositories/projects.ts`
- Create: `traffic-control/src/db/repositories/tasks.ts`
- Test: `traffic-control/src/db/repositories/projects.test.ts`
- Test: `traffic-control/src/db/repositories/tasks.test.ts`

**Step 1: Write the failing test for projects**

Create `traffic-control/src/db/repositories/projects.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProjectRepository } from './projects.js';
import { createSupabaseClient } from '../client.js';

describe('ProjectRepository', () => {
  let repo: ProjectRepository;
  let testProjectId: string;

  beforeAll(() => {
    repo = new ProjectRepository(createSupabaseClient());
  });

  afterAll(async () => {
    if (testProjectId) {
      await repo.delete(testProjectId);
    }
  });

  it('should create a project', async () => {
    const project = await repo.create({
      name: 'Test Project',
      description: 'A test project',
      priority: 1
    });

    testProjectId = project.id;
    expect(project.name).toBe('Test Project');
    expect(project.status).toBe('active');
  });

  it('should get a project by id', async () => {
    const project = await repo.getById(testProjectId);
    expect(project).toBeDefined();
    expect(project?.name).toBe('Test Project');
  });

  it('should list active projects', async () => {
    const projects = await repo.listActive();
    expect(projects.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/db/repositories/projects.test.ts
```

Expected: FAIL - module not found

**Step 3: Create ProjectRepository**

Create `traffic-control/src/db/repositories/projects.ts`:

```typescript
import { SupabaseClient } from '@supabase/supabase-js';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  priority?: number;
}

export class ProjectRepository {
  constructor(private client: SupabaseClient) {}

  async create(input: CreateProjectInput): Promise<Project> {
    const { data, error } = await this.client
      .from('tc_projects')
      .insert({
        name: input.name,
        description: input.description ?? null,
        priority: input.priority ?? 0
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create project: ${error.message}`);
    return data as Project;
  }

  async getById(id: string): Promise<Project | null> {
    const { data, error } = await this.client
      .from('tc_projects')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get project: ${error.message}`);
    }
    return data as Project | null;
  }

  async listActive(): Promise<Project[]> {
    const { data, error } = await this.client
      .from('tc_projects')
      .select()
      .eq('status', 'active')
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to list projects: ${error.message}`);
    return data as Project[];
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('tc_projects')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete project: ${error.message}`);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/db/repositories/projects.test.ts
```

Expected: PASS

**Step 5: Write the failing test for tasks**

Create `traffic-control/src/db/repositories/tasks.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TaskRepository } from './tasks.js';
import { ProjectRepository } from './projects.js';
import { createSupabaseClient } from '../client.js';

describe('TaskRepository', () => {
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let testProjectId: string;
  let testTaskId: string;

  beforeAll(async () => {
    const client = createSupabaseClient();
    taskRepo = new TaskRepository(client);
    projectRepo = new ProjectRepository(client);

    const project = await projectRepo.create({ name: 'Task Test Project' });
    testProjectId = project.id;
  });

  afterAll(async () => {
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  it('should create a task', async () => {
    const task = await taskRepo.create({
      project_id: testProjectId,
      title: 'Test Task',
      description: 'A test task',
      priority: 1,
      estimated_sessions_opus: 1
    });

    testTaskId = task.id;
    expect(task.title).toBe('Test Task');
    expect(task.status).toBe('queued');
  });

  it('should get queued tasks', async () => {
    const tasks = await taskRepo.getQueued();
    expect(tasks.length).toBeGreaterThan(0);
  });

  it('should update task status', async () => {
    const task = await taskRepo.updateStatus(testTaskId, 'in_progress');
    expect(task.status).toBe('in_progress');
  });
});
```

**Step 6: Run test to verify it fails**

```bash
npm run test -- src/db/repositories/tasks.test.ts
```

Expected: FAIL - module not found

**Step 7: Create TaskRepository**

Create `traffic-control/src/db/repositories/tasks.ts`:

```typescript
import { SupabaseClient } from '@supabase/supabase-js';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: 'queued' | 'assigned' | 'in_progress' | 'review' | 'complete' | 'blocked';
  priority: number;
  complexity_estimate: string | null;
  estimated_sessions_opus: number;
  estimated_sessions_sonnet: number;
  actual_tokens_opus: number;
  actual_tokens_sonnet: number;
  actual_sessions_opus: number;
  actual_sessions_sonnet: number;
  assigned_agent_id: string | null;
  requires_visual_review: boolean;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  project_id: string;
  title: string;
  description?: string;
  priority?: number;
  estimated_sessions_opus?: number;
  estimated_sessions_sonnet?: number;
  requires_visual_review?: boolean;
}

export class TaskRepository {
  constructor(private client: SupabaseClient) {}

  async create(input: CreateTaskInput): Promise<Task> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .insert({
        project_id: input.project_id,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 0,
        estimated_sessions_opus: input.estimated_sessions_opus ?? 0,
        estimated_sessions_sonnet: input.estimated_sessions_sonnet ?? 0,
        requires_visual_review: input.requires_visual_review ?? false
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create task: ${error.message}`);
    return data as Task;
  }

  async getById(id: string): Promise<Task | null> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get task: ${error.message}`);
    }
    return data as Task | null;
  }

  async getQueued(): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .select()
      .eq('status', 'queued')
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to get queued tasks: ${error.message}`);
    return data as Task[];
  }

  async updateStatus(id: string, status: Task['status']): Promise<Task> {
    const updates: Partial<Task> = { status, updated_at: new Date().toISOString() };

    if (status === 'in_progress' && !updates.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (status === 'complete') {
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('tc_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update task: ${error.message}`);
    return data as Task;
  }

  async assignAgent(id: string, agentId: string): Promise<Task> {
    const { data, error } = await this.client
      .from('tc_tasks')
      .update({
        assigned_agent_id: agentId,
        status: 'assigned',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to assign agent: ${error.message}`);
    return data as Task;
  }
}
```

**Step 8: Run test to verify it passes**

```bash
npm run test -- src/db/repositories/tasks.test.ts
```

Expected: PASS

**Step 9: Commit**

```bash
git add traffic-control/src/db/repositories/
git commit -m "feat(trafficcontrol): add project and task repositories"
```

---

## Task 4: Slack Bot Setup

**Files:**
- Create: `traffic-control/src/slack/bot.ts`
- Create: `traffic-control/src/slack/handlers.ts`
- Test: `traffic-control/src/slack/bot.test.ts`

**Step 1: Write the failing test**

Create `traffic-control/src/slack/bot.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createSlackBot, formatQuestion, formatBlocker } from './bot.js';

describe('Slack Bot', () => {
  it('should create a bot instance', () => {
    // Mock environment
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    vi.stubEnv('SLACK_SIGNING_SECRET', 'test-secret');
    vi.stubEnv('SLACK_APP_TOKEN', 'xapp-test');

    const bot = createSlackBot();
    expect(bot).toBeDefined();
  });

  it('should format question messages', () => {
    const message = formatQuestion('TestProject', 'What database should I use?');
    expect(message).toContain('TestProject');
    expect(message).toContain('What database should I use?');
  });

  it('should format blocker messages', () => {
    const message = formatBlocker('TestProject', 'Cannot access API endpoint');
    expect(message).toContain('TestProject');
    expect(message).toContain('Cannot access API endpoint');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/slack/bot.test.ts
```

Expected: FAIL - module not found

**Step 3: Create the Slack bot**

Create `traffic-control/src/slack/bot.ts`:

```typescript
import { App, LogLevel } from '@slack/bolt';

let app: App | null = null;

export function createSlackBot(): App {
  if (app) return app;

  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!token || !signingSecret || !appToken) {
    throw new Error('Missing Slack credentials');
  }

  app = new App({
    token,
    signingSecret,
    appToken,
    socketMode: true,
    logLevel: LogLevel.INFO
  });

  return app;
}

export function formatQuestion(project: string, question: string): string {
  return `❓ *[${project}]* Agent asks:\n\n${question}`;
}

export function formatBlocker(project: string, blocker: string): string {
  return `🚫 *[${project}]* Blocked:\n\n${blocker}`;
}

export function formatVisualReview(project: string, taskTitle: string): string {
  return `👁️ *[${project}]* Visual review needed for: ${taskTitle}\n\nReact with ✅ to approve or ❌ to request changes.`;
}

export function formatStatus(projects: Array<{ name: string; activeTasks: number; blockedTasks: number }>): string {
  const lines = projects.map(p =>
    `• *${p.name}*: ${p.activeTasks} active, ${p.blockedTasks} blocked`
  );
  return `📊 *Status Report*\n\n${lines.join('\n')}`;
}

export interface SlackMessage {
  channel: string;
  text: string;
  thread_ts?: string;
}

export async function sendMessage(message: SlackMessage): Promise<string | undefined> {
  const bot = createSlackBot();

  const result = await bot.client.chat.postMessage({
    channel: message.channel,
    text: message.text,
    thread_ts: message.thread_ts
  });

  return result.ts;
}

export async function startBot(): Promise<void> {
  const bot = createSlackBot();
  await bot.start();
  console.log('Slack bot is running');
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/slack/bot.test.ts
```

Expected: PASS

**Step 5: Create message handlers**

Create `traffic-control/src/slack/handlers.ts`:

```typescript
import { App } from '@slack/bolt';
import { createSlackBot } from './bot.js';

export type MessageHandler = (text: string, userId: string, threadTs?: string) => Promise<void>;

let messageCallback: MessageHandler | null = null;

export function setMessageHandler(handler: MessageHandler): void {
  messageCallback = handler;
}

export function setupHandlers(): void {
  const app = createSlackBot();

  // Handle direct messages
  app.message(async ({ message, say }) => {
    if (message.subtype) return; // Ignore message updates, deletes, etc.

    const msg = message as { text?: string; user?: string; thread_ts?: string; ts?: string };

    if (msg.text && msg.user && messageCallback) {
      await messageCallback(msg.text, msg.user, msg.thread_ts ?? msg.ts);
    }
  });

  // Handle slash commands
  app.command('/tc', async ({ command, ack, respond }) => {
    await ack();

    const args = command.text.trim().split(' ');
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'status':
        await respond('Fetching status...');
        // Will be implemented in orchestrator
        break;

      case 'pause':
        await respond(`Pausing project: ${args[1] || '(none specified)'}`);
        break;

      case 'resume':
        await respond(`Resuming project: ${args[1] || '(none specified)'}`);
        break;

      case 'add':
        const taskDesc = args.slice(1).join(' ');
        await respond(`Adding task: ${taskDesc || '(no description)'}`);
        break;

      default:
        await respond(
          'TrafficControl commands:\n' +
          '• `/tc status` - Current status\n' +
          '• `/tc pause [project]` - Pause a project\n' +
          '• `/tc resume [project]` - Resume a project\n' +
          '• `/tc add [description]` - Add a task'
        );
    }
  });

  // Handle reactions (for visual review approvals)
  app.event('reaction_added', async ({ event }) => {
    const { reaction, item, user } = event;

    if (reaction === 'white_check_mark' || reaction === 'x') {
      console.log(`Reaction ${reaction} from ${user} on message ${item.ts}`);
      // Will be handled by orchestrator
    }
  });
}
```

**Step 6: Commit**

```bash
git add traffic-control/src/slack/
git commit -m "feat(trafficcontrol): add Slack bot with message formatting and handlers"
```

---

## Task 5: Agent Manager (Basic)

**Files:**
- Create: `traffic-control/src/agent/manager.ts`
- Create: `traffic-control/src/agent/types.ts`
- Test: `traffic-control/src/agent/manager.test.ts`

**Step 1: Create types**

Create `traffic-control/src/agent/types.ts`:

```typescript
export interface AgentConfig {
  model: 'opus' | 'sonnet' | 'haiku';
  projectPath: string;
  systemPrompt?: string;
  maxTurns?: number;
}

export interface AgentSession {
  id: string;
  taskId: string | null;
  model: AgentConfig['model'];
  status: 'running' | 'blocked' | 'waiting_approval' | 'complete' | 'failed';
  startedAt: Date;
  tokensUsed: number;
}

export interface AgentEvent {
  type: 'question' | 'tool_call' | 'completion' | 'error';
  sessionId: string;
  data: unknown;
  timestamp: Date;
}

export type AgentEventHandler = (event: AgentEvent) => Promise<void>;
```

**Step 2: Write the failing test**

Create `traffic-control/src/agent/manager.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentManager } from './manager.js';

describe('AgentManager', () => {
  it('should create an instance', () => {
    const manager = new AgentManager();
    expect(manager).toBeDefined();
  });

  it('should track active sessions', () => {
    const manager = new AgentManager();
    expect(manager.getActiveSessions()).toEqual([]);
  });

  it('should register event handlers', () => {
    const manager = new AgentManager();
    const handler = vi.fn();

    manager.onEvent('question', handler);
    expect(manager.hasHandler('question')).toBe(true);
  });
});
```

**Step 3: Run test to verify it fails**

```bash
npm run test -- src/agent/manager.test.ts
```

Expected: FAIL - module not found

**Step 4: Create AgentManager**

Create `traffic-control/src/agent/manager.ts`:

```typescript
import { AgentConfig, AgentSession, AgentEvent, AgentEventHandler } from './types.js';

export class AgentManager {
  private sessions: Map<string, AgentSession> = new Map();
  private eventHandlers: Map<AgentEvent['type'], AgentEventHandler[]> = new Map();

  constructor() {
    // Initialize event handler maps
    this.eventHandlers.set('question', []);
    this.eventHandlers.set('tool_call', []);
    this.eventHandlers.set('completion', []);
    this.eventHandlers.set('error', []);
  }

  getActiveSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.status === 'running' || s.status === 'blocked'
    );
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  onEvent(type: AgentEvent['type'], handler: AgentEventHandler): void {
    const handlers = this.eventHandlers.get(type) || [];
    handlers.push(handler);
    this.eventHandlers.set(type, handlers);
  }

  hasHandler(type: AgentEvent['type']): boolean {
    const handlers = this.eventHandlers.get(type);
    return handlers !== undefined && handlers.length > 0;
  }

  private async emitEvent(event: AgentEvent): Promise<void> {
    const handlers = this.eventHandlers.get(event.type) || [];
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`Error in event handler for ${event.type}:`, err);
      }
    }
  }

  async spawnAgent(taskId: string, config: AgentConfig): Promise<string> {
    const sessionId = crypto.randomUUID();

    const session: AgentSession = {
      id: sessionId,
      taskId,
      model: config.model,
      status: 'running',
      startedAt: new Date(),
      tokensUsed: 0
    };

    this.sessions.set(sessionId, session);

    // TODO: Integrate with Claude Agent SDK
    // For now, this is a placeholder that will be implemented
    // when we integrate the actual SDK
    console.log(`Spawned agent ${sessionId} for task ${taskId}`);

    return sessionId;
  }

  async injectMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'blocked') {
      throw new Error(`Session ${sessionId} is not blocked`);
    }

    // Update status
    session.status = 'running';
    this.sessions.set(sessionId, session);

    // TODO: Inject message into running session
    console.log(`Injected message into session ${sessionId}: ${message}`);
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'failed';
    this.sessions.set(sessionId, session);

    await this.emitEvent({
      type: 'completion',
      sessionId,
      data: { reason: 'terminated' },
      timestamp: new Date()
    });
  }
}
```

**Step 5: Run test to verify it passes**

```bash
npm run test -- src/agent/manager.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add traffic-control/src/agent/
git commit -m "feat(trafficcontrol): add basic agent manager with session tracking"
```

---

## Task 6: Orchestrator Core

**Files:**
- Create: `traffic-control/src/orchestrator.ts`
- Test: `traffic-control/src/orchestrator.test.ts`

**Step 1: Write the failing test**

Create `traffic-control/src/orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';

// Mock dependencies
vi.mock('./db/client.js', () => ({
  createSupabaseClient: vi.fn(() => ({}))
}));

vi.mock('./slack/bot.js', () => ({
  createSlackBot: vi.fn(() => ({ start: vi.fn() })),
  sendMessage: vi.fn()
}));

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    orchestrator = new Orchestrator();
  });

  it('should create an instance', () => {
    expect(orchestrator).toBeDefined();
  });

  it('should not be running initially', () => {
    expect(orchestrator.isRunning()).toBe(false);
  });

  it('should track pending questions', () => {
    expect(orchestrator.getPendingQuestions()).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test -- src/orchestrator.test.ts
```

Expected: FAIL - module not found

**Step 3: Create Orchestrator**

Create `traffic-control/src/orchestrator.ts`:

```typescript
import { createSupabaseClient } from './db/client.js';
import { ProjectRepository } from './db/repositories/projects.js';
import { TaskRepository, Task } from './db/repositories/tasks.js';
import { AgentManager } from './agent/manager.js';
import { createSlackBot, sendMessage, formatQuestion, formatBlocker, startBot } from './slack/bot.js';
import { setMessageHandler, setupHandlers } from './slack/handlers.js';

interface PendingQuestion {
  sessionId: string;
  taskId: string;
  projectName: string;
  question: string;
  slackThreadTs?: string;
  askedAt: Date;
}

export class Orchestrator {
  private running = false;
  private projectRepo: ProjectRepository;
  private taskRepo: TaskRepository;
  private agentManager: AgentManager;
  private pendingQuestions: Map<string, PendingQuestion> = new Map();
  private slackChannel: string;

  constructor() {
    const client = createSupabaseClient();
    this.projectRepo = new ProjectRepository(client);
    this.taskRepo = new TaskRepository(client);
    this.agentManager = new AgentManager();
    this.slackChannel = process.env.SLACK_CHANNEL || 'trafficcontrol';

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle agent questions
    this.agentManager.onEvent('question', async (event) => {
      const session = this.agentManager.getSession(event.sessionId);
      if (!session?.taskId) return;

      const task = await this.taskRepo.getById(session.taskId);
      if (!task) return;

      const project = await this.projectRepo.getById(task.project_id);
      const projectName = project?.name || 'Unknown';
      const question = String(event.data);

      // Send to Slack
      const message = formatQuestion(projectName, question);
      const threadTs = await sendMessage({
        channel: this.slackChannel,
        text: message
      });

      // Track pending question
      this.pendingQuestions.set(event.sessionId, {
        sessionId: event.sessionId,
        taskId: session.taskId,
        projectName,
        question,
        slackThreadTs: threadTs,
        askedAt: new Date()
      });
    });

    // Handle Slack replies
    setMessageHandler(async (text, userId, threadTs) => {
      // Find pending question by thread
      for (const [sessionId, pq] of this.pendingQuestions) {
        if (pq.slackThreadTs === threadTs) {
          // Inject response into agent
          await this.agentManager.injectMessage(sessionId, text);
          this.pendingQuestions.delete(sessionId);
          break;
        }
      }
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getPendingQuestions(): PendingQuestion[] {
    return Array.from(this.pendingQuestions.values());
  }

  async start(): Promise<void> {
    if (this.running) return;

    console.log('Starting TrafficControl orchestrator...');

    // Setup Slack handlers and start bot
    setupHandlers();
    await startBot();

    this.running = true;
    console.log('TrafficControl orchestrator is running');

    // Start the main loop
    this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log('TrafficControl orchestrator stopped');
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        console.error('Error in orchestrator loop:', err);
      }

      // Wait before next tick
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  private async tick(): Promise<void> {
    // Check for queued tasks that need agents
    const activeSessions = this.agentManager.getActiveSessions();

    // For Phase 1: limit to 1 concurrent agent
    if (activeSessions.length >= 1) return;

    // Get next queued task
    const queuedTasks = await this.taskRepo.getQueued();
    if (queuedTasks.length === 0) return;

    const task = queuedTasks[0];
    await this.assignTask(task);
  }

  private async assignTask(task: Task): Promise<void> {
    const project = await this.projectRepo.getById(task.project_id);
    if (!project) return;

    console.log(`Assigning task "${task.title}" to new agent`);

    // Spawn agent
    const sessionId = await this.agentManager.spawnAgent(task.id, {
      model: task.estimated_sessions_opus > 0 ? 'opus' : 'sonnet',
      projectPath: process.cwd(), // Will be project-specific in later phases
      systemPrompt: `You are working on project "${project.name}". Task: ${task.title}\n\n${task.description || ''}`
    });

    // Update task
    await this.taskRepo.assignAgent(task.id, sessionId);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test -- src/orchestrator.test.ts
```

Expected: PASS

**Step 5: Update main entry point**

Update `traffic-control/src/index.ts`:

```typescript
import 'dotenv/config';
import { Orchestrator } from './orchestrator.js';

async function main() {
  console.log('TrafficControl Phase 1 - Foundation');

  const orchestrator = new Orchestrator();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await orchestrator.stop();
    process.exit(0);
  });

  await orchestrator.start();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 6: Commit**

```bash
git add traffic-control/src/
git commit -m "feat(trafficcontrol): add orchestrator with main loop and Slack integration"
```

---

## Task 7: Integration Test & Manual Verification

**Files:**
- Create: `traffic-control/src/integration.test.ts`

**Step 1: Create integration test**

Create `traffic-control/src/integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSupabaseClient } from './db/client.js';
import { ProjectRepository } from './db/repositories/projects.js';
import { TaskRepository } from './db/repositories/tasks.js';

describe('Integration: Full Flow', () => {
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let testProjectId: string;
  let testTaskId: string;

  beforeAll(async () => {
    const client = createSupabaseClient();
    projectRepo = new ProjectRepository(client);
    taskRepo = new TaskRepository(client);
  });

  afterAll(async () => {
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  it('should create a project and task, then queue task for agent', async () => {
    // Create project
    const project = await projectRepo.create({
      name: 'Integration Test Project',
      description: 'Testing the full flow',
      priority: 10
    });
    testProjectId = project.id;
    expect(project.status).toBe('active');

    // Create task
    const task = await taskRepo.create({
      project_id: project.id,
      title: 'Test task for integration',
      description: 'This task tests the full flow',
      priority: 5,
      estimated_sessions_sonnet: 1
    });
    testTaskId = task.id;
    expect(task.status).toBe('queued');

    // Verify task appears in queue
    const queuedTasks = await taskRepo.getQueued();
    const found = queuedTasks.find(t => t.id === testTaskId);
    expect(found).toBeDefined();

    // Simulate assignment
    const assigned = await taskRepo.assignAgent(testTaskId, 'test-agent-123');
    expect(assigned.status).toBe('assigned');
    expect(assigned.assigned_agent_id).toBe('test-agent-123');

    // Simulate progress
    const inProgress = await taskRepo.updateStatus(testTaskId, 'in_progress');
    expect(inProgress.status).toBe('in_progress');
    expect(inProgress.started_at).toBeDefined();

    // Simulate completion
    const complete = await taskRepo.updateStatus(testTaskId, 'complete');
    expect(complete.status).toBe('complete');
    expect(complete.completed_at).toBeDefined();
  });
});
```

**Step 2: Run integration test**

```bash
npm run test -- src/integration.test.ts
```

Expected: PASS

**Step 3: Create run instructions**

Create `traffic-control/README.md`:

```markdown
# TrafficControl

Autonomous agent orchestration system for Claude Code.

## Setup

1. Copy `.env.example` to `.env` and fill in credentials
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Run: `npm run start`

## Development

- `npm run dev` - Run with hot reload
- `npm run test` - Run tests
- `npm run build` - Compile TypeScript

## Slack Setup

1. Create a Slack App at https://api.slack.com/apps
2. Enable Socket Mode
3. Add Bot Token Scopes: `chat:write`, `channels:read`, `channels:history`, `reactions:read`
4. Install to workspace
5. Copy tokens to `.env`

## Phase 1 Features

- Single agent spawning
- Slack question routing
- Manual task assignment via database
- Basic status tracking
```

**Step 4: Final commit**

```bash
git add traffic-control/
git commit -m "feat(trafficcontrol): complete Phase 1 foundation implementation"
```

---

## Summary

Phase 1 creates the foundation for TrafficControl:

| Component | Status |
|-----------|--------|
| Project setup (TypeScript, deps) | ✅ |
| Supabase schema | ✅ |
| Database repositories | ✅ |
| Slack bot with message routing | ✅ |
| Basic agent manager | ✅ |
| Orchestrator with main loop | ✅ |
| Integration tests | ✅ |

**Next Phase (Phase 2):** Capacity-aware scheduling, multi-agent parallel execution, backlog manager with proposals, and reporter with checkpoint reports.
