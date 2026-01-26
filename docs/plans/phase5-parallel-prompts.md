# Phase 5: Integration & Orchestrator - Parallel Implementation Prompts

**Date:** 2026-01-26
**Phase:** 5 - Integration & Orchestrator
**Prerequisites:** Phases 1-4 completed (1540 tests passing)

---

## Overview

Phase 5 brings all components together into a unified orchestration system. This is the final phase that creates the complete TrafficControl system capable of:
1. Autonomous multi-agent management
2. Slack-based mobile interaction
3. Continuous learning from failures
4. Real-time monitoring and optimization

---

## Master Prompt for New Claude Code Agent

### Initial Context

You are taking over Phase 5 of TrafficControl development. This is an autonomous agent orchestration system that maximizes Claude usage capacity while minimizing manual intervention.

**Completed Phases:**
- Phase 1 (Foundation): Database schema, repositories, basic orchestrator
- Phase 2 (Automation): Capacity scheduler, agent SDK integration, backlog manager, reporter
- Phase 3 (Learning): Retrospectives, learning propagation, subagent support, visual review
- Phase 4 (Optimization): ROI tracking, estimate accuracy, prioritization engine, dashboard

**Current State:** 1540 tests passing, TypeScript builds clean

**Your Mission:** Implement Phase 5 - the integration layer that connects all modules into a working orchestration system.

---

## Phase 5 Components

### Component 1: Main Orchestration Loop
The central control loop that coordinates all subsystems.

### Component 2: Slack Router Integration
Complete Slack integration for mobile-first interaction.

### Component 3: Event Bus & Coordination
Central event system for inter-module communication.

### Component 4: CLI & Startup
Command-line interface and system startup/shutdown.

---

## Instance 1: Main Orchestration Loop

### Context
You are implementing the main orchestration loop that ties all TrafficControl components together. This is the brain of the system that coordinates agent spawning, monitoring, and task management.

### Your Task
Build the main orchestration loop that:
1. Continuously monitors capacity and spawns agents when available
2. Routes agent events (questions, completions, errors) to appropriate handlers
3. Coordinates between scheduler, agent manager, and reporter
4. Handles graceful shutdown and state persistence

### Files to Create/Modify
- `src/orchestrator/main-loop.ts` - Main orchestration loop
- `src/orchestrator/event-dispatcher.ts` - Dispatches events to handlers
- `src/orchestrator/state-manager.ts` - Persists and recovers state
- `src/orchestrator/main-loop.test.ts`
- `src/orchestrator/event-dispatcher.test.ts`
- `src/orchestrator/state-manager.test.ts`

### Key Interfaces
```typescript
interface OrchestrationConfig {
  pollIntervalMs: number;
  maxConcurrentAgents: number;
  gracefulShutdownTimeoutMs: number;
  stateFilePath: string;
}

interface OrchestrationState {
  isRunning: boolean;
  activeAgents: Map<string, AgentState>;
  pendingTasks: string[];
  lastCheckpoint: Date;
}

interface AgentEvent {
  type: 'question' | 'completion' | 'error' | 'blocker' | 'subagent_spawn';
  agentId: string;
  taskId: string;
  payload: unknown;
  timestamp: Date;
}

class MainLoop {
  constructor(config: OrchestrationConfig, deps: OrchestrationDependencies);

  async start(): Promise<void>;
  async stop(): Promise<void>;
  async pause(): Promise<void>;
  async resume(): Promise<void>;

  getState(): OrchestrationState;
  onEvent(handler: (event: AgentEvent) => void): void;
}

interface OrchestrationDependencies {
  scheduler: Scheduler;
  agentManager: AgentManager;
  backlogManager: BacklogManager;
  reporter: Reporter;
  capacityTracker: CapacityTracker;
  learningProvider: LearningProvider;
  retrospectiveTrigger: RetrospectiveTrigger;
}
```

### Integration Points
- Import `Scheduler` from `src/scheduler/scheduler.ts`
- Import `AgentManager` from `src/agent/manager.ts`
- Import `BacklogManager` from `src/backlog/backlog-manager.ts`
- Import `Reporter` from `src/reporter/reporter.ts`
- Import `CapacityTracker` from `src/scheduler/capacity-tracker.ts`
- Import `LearningProvider` from `src/learning/learning-provider.ts`
- Import `RetrospectiveTrigger` from `src/learning/retrospective-trigger.ts`

### Behavior Requirements
1. **Polling loop**: Check capacity every `pollIntervalMs`, spawn agents if capacity available
2. **Event handling**: Route agent events to appropriate handlers (Slack, logging, metrics)
3. **State persistence**: Save state to file periodically for crash recovery
4. **Graceful shutdown**: Wait for active agents to complete (up to timeout)
5. **Learning integration**: Load learnings for each agent context

### TDD Approach
1. Write tests for state management (save/load)
2. Write tests for event dispatching
3. Write tests for the main loop lifecycle (start/stop/pause/resume)
4. Write tests for capacity-based agent spawning
5. Write integration tests connecting real modules

---

## Instance 2: Slack Router Integration

### Context
You are completing the Slack integration for TrafficControl. The basic Slack bot exists but needs to be fully integrated with the orchestration system.

### Your Task
Build the complete Slack routing system that:
1. Routes agent questions/blockers to Slack with proper threading
2. Routes user responses back to the correct agent
3. Handles Slack commands (status, pause, resume, add task)
4. Manages notification batching and quiet hours

### Files to Create/Modify
- `src/slack/router.ts` - Routes messages between agents and Slack
- `src/slack/command-handler.ts` - Handles Slack commands
- `src/slack/notification-manager.ts` - Batching and quiet hours
- `src/slack/thread-tracker.ts` - Maps tasks to Slack threads
- Tests for each file

### Key Interfaces
```typescript
interface SlackRouterConfig {
  channelId: string;
  batchIntervalMs: number;
  quietHoursStart: number; // 0-23
  quietHoursEnd: number;
}

interface SlackThread {
  threadTs: string;
  taskId: string;
  projectName: string;
  agentId: string;
  status: 'active' | 'waiting_response' | 'resolved';
}

interface NotificationQueue {
  questions: PendingNotification[];
  reviews: PendingNotification[];
  blockers: PendingNotification[];
}

class SlackRouter {
  constructor(config: SlackRouterConfig, slackBot: SlackBot);

  // Agent -> Slack
  async routeQuestion(agentId: string, taskId: string, question: string): Promise<string>;
  async routeBlocker(agentId: string, taskId: string, reason: string): Promise<string>;
  async routeVisualReview(agentId: string, taskId: string, screenshot: Buffer): Promise<string>;
  async routeCompletion(agentId: string, taskId: string, summary: string): Promise<void>;

  // Slack -> Agent
  async handleResponse(threadTs: string, userId: string, text: string): Promise<void>;

  // Thread management
  getThreadForTask(taskId: string): SlackThread | undefined;
  getActiveThreads(): SlackThread[];
}

class NotificationManager {
  constructor(config: NotificationConfig);

  queue(notification: Notification): void;
  flush(): Promise<void>;
  isQuietHours(): boolean;
  setDnd(durationMs: number): void;
}

class CommandHandler {
  constructor(orchestrator: MainLoop, backlogManager: BacklogManager);

  async handleCommand(command: string, args: string[], userId: string): Promise<string>;
}
```

### Slack Message Formats
```
Question:
❓ [Project] Agent asks:
{question}
(Reply in thread to respond)

Blocker:
🚫 [Project] Blocked:
{reason}
(Reply "skip" to move to next task, or provide guidance)

Visual Review:
👁️ [Project] Review requested:
{screenshot}
(React with ✅ to approve, ❌ + reply with feedback to reject)

Completion:
✅ [Project] Task complete:
{summary}
```

### Commands to Support
- `status` - Current status of all agents
- `pause [project]` - Pause a project
- `resume [project]` - Resume a project
- `add task: [description]` - Add to backlog
- `prioritize [project]` - Bump project priority
- `report` - Trigger immediate status report
- `dnd [duration]` - Enable do-not-disturb
- `dnd off` - Disable do-not-disturb

### Integration Points
- Import `SlackBot` from `src/slack/bot.ts`
- Import `MainLoop` from `src/orchestrator/main-loop.ts`
- Import `BacklogManager` from `src/backlog/backlog-manager.ts`

---

## Instance 3: Event Bus & Coordination

### Context
You are implementing the central event bus that enables communication between all TrafficControl modules without tight coupling.

### Your Task
Build the event bus system that:
1. Provides pub/sub messaging between modules
2. Supports typed events with proper TypeScript generics
3. Handles async event handlers with error isolation
4. Provides event history for debugging

### Files to Create
- `src/events/event-bus.ts` - Central event bus
- `src/events/event-types.ts` - All event type definitions
- `src/events/event-logger.ts` - Event history and debugging
- `src/events/index.ts` - Module exports
- Tests for each file

### Key Interfaces
```typescript
// Event type definitions
type EventType =
  | 'agent:spawned'
  | 'agent:question'
  | 'agent:blocked'
  | 'agent:completed'
  | 'agent:failed'
  | 'task:queued'
  | 'task:assigned'
  | 'task:completed'
  | 'capacity:available'
  | 'capacity:exhausted'
  | 'learning:extracted'
  | 'retrospective:triggered'
  | 'slack:message_received'
  | 'slack:response_sent'
  | 'system:started'
  | 'system:stopped'
  | 'system:error';

interface TypedEvent<T extends EventType, P = unknown> {
  type: T;
  payload: P;
  timestamp: Date;
  correlationId?: string;
}

interface AgentSpawnedPayload {
  agentId: string;
  taskId: string;
  model: 'opus' | 'sonnet' | 'haiku';
  context: string[];
}

interface AgentQuestionPayload {
  agentId: string;
  taskId: string;
  question: string;
  threadTs?: string;
}

// ... more payload types

class EventBus {
  on<T extends EventType>(type: T, handler: EventHandler<T>): () => void;
  once<T extends EventType>(type: T, handler: EventHandler<T>): void;
  emit<T extends EventType>(event: TypedEvent<T, PayloadFor<T>>): void;

  // Pattern matching
  onPattern(pattern: RegExp, handler: (event: TypedEvent<any>) => void): () => void;

  // History
  getHistory(filter?: EventFilter): TypedEvent<any>[];
  clearHistory(): void;
}

class EventLogger {
  constructor(eventBus: EventBus, options: EventLoggerOptions);

  enable(): void;
  disable(): void;
  getEvents(filter?: EventFilter): TypedEvent<any>[];
  exportToFile(path: string): Promise<void>;
}
```

### Behavior Requirements
1. **Type safety**: Full TypeScript generics for event types and payloads
2. **Error isolation**: One handler error doesn't break other handlers
3. **Async support**: Handlers can be async, errors are caught and logged
4. **Correlation**: Events can be linked via correlationId for tracing
5. **History**: Last N events stored for debugging (configurable)

---

## Instance 4: CLI & Startup

### Context
You are implementing the CLI and startup system for TrafficControl. This is how users will interact with and configure the system.

### Your Task
Build the CLI that:
1. Starts/stops the orchestrator with proper configuration
2. Provides commands for status, manual operations
3. Handles configuration from environment and config files
4. Implements proper logging and error handling

### Files to Create
- `src/cli/index.ts` - CLI entry point
- `src/cli/commands.ts` - Command implementations
- `src/cli/config-loader.ts` - Configuration loading
- `src/cli/logger.ts` - Structured logging
- `bin/trafficcontrol.ts` - Executable entry point
- Tests for each file

### Key Interfaces
```typescript
interface TrafficControlConfig {
  // Database
  supabaseUrl: string;
  supabaseKey: string;

  // Slack
  slackToken: string;
  slackChannelId: string;

  // Capacity
  maxConcurrentAgents: number;
  opusSessionLimit: number;
  sonnetSessionLimit: number;

  // Scheduling
  pollIntervalMs: number;
  reportIntervalMs: number;

  // Paths
  learningsPath: string;
  retrospectivesPath: string;
  agentsPath: string;

  // Notifications
  quietHoursStart: number;
  quietHoursEnd: number;
  batchIntervalMs: number;
}

interface CliCommand {
  name: string;
  description: string;
  options: CliOption[];
  action: (options: Record<string, unknown>) => Promise<void>;
}

class ConfigLoader {
  static load(configPath?: string): TrafficControlConfig;
  static validate(config: Partial<TrafficControlConfig>): TrafficControlConfig;
  static fromEnv(): Partial<TrafficControlConfig>;
}

class Logger {
  static info(message: string, meta?: Record<string, unknown>): void;
  static warn(message: string, meta?: Record<string, unknown>): void;
  static error(message: string, error?: Error, meta?: Record<string, unknown>): void;
  static debug(message: string, meta?: Record<string, unknown>): void;
}
```

### CLI Commands
```bash
# Start the orchestrator
trafficcontrol start [--config path/to/config.json]

# Stop gracefully
trafficcontrol stop

# Check status
trafficcontrol status

# Manual task operations
trafficcontrol task add "description" --project <id> --priority <1-10>
trafficcontrol task list [--status queued|in_progress|blocked]
trafficcontrol task cancel <id>

# Project operations
trafficcontrol project list
trafficcontrol project pause <id>
trafficcontrol project resume <id>

# Reports
trafficcontrol report [--format json|text]
trafficcontrol metrics [--period day|week|month]

# Configuration
trafficcontrol config show
trafficcontrol config validate <path>
```

### Configuration File Format
```json
{
  "supabase": {
    "url": "https://xxx.supabase.co",
    "key": "your-service-key"
  },
  "slack": {
    "token": "xoxb-xxx",
    "channelId": "C12345"
  },
  "capacity": {
    "maxConcurrentAgents": 5,
    "opusSessionLimit": 50,
    "sonnetSessionLimit": 100
  },
  "scheduling": {
    "pollIntervalMs": 5000,
    "reportIntervalMs": 43200000
  },
  "paths": {
    "learnings": "./trafficControl/learnings",
    "retrospectives": "./trafficControl/retrospectives",
    "agents": "./trafficControl/agents.md"
  },
  "notifications": {
    "quietHoursStart": 0,
    "quietHoursEnd": 7,
    "batchIntervalMs": 1800000
  }
}
```

### Environment Variables
```
SUPABASE_URL
SUPABASE_SERVICE_KEY
SLACK_BOT_TOKEN
SLACK_CHANNEL_ID
TC_MAX_CONCURRENT_AGENTS
TC_POLL_INTERVAL_MS
TC_LEARNINGS_PATH
TC_LOG_LEVEL
```

---

## Execution Instructions

1. **Create Phase 5 prompts file**: Save this document to `docs/plans/phase5-parallel-prompts.md`

2. **Launch 4 parallel subagents** using the Task tool with the prompts above

3. **After all complete**: Run full test suite and TypeScript build

4. **Final integration**: Create a simple integration test that starts the full system

---

## Important Notes

### Avoid Merge Conflicts
- Another agent may be working on `CAPABILITIES.md` and `agents.md`
- Do NOT modify these files

### Existing Code
Reference existing implementations:
- `src/orchestrator.ts` - Basic orchestrator (extend, don't replace)
- `src/slack/bot.ts` - Slack client (use as dependency)
- `src/scheduler/scheduler.ts` - Task scheduling (integrate)

### TDD Approach
Each instance must:
1. Write failing tests first
2. Implement minimal code to pass
3. Refactor while keeping tests green
4. Commit after each logical unit

### Testing Strategy
- Unit tests for individual components
- Integration tests for module interactions
- Mock external dependencies (Supabase, Slack)
- Use existing test patterns from codebase

---

## Success Criteria

Phase 5 is complete when:
1. All tests pass (target: 1800+ tests)
2. TypeScript builds clean
3. CLI can start/stop the orchestrator
4. Events flow between all modules
5. Slack integration routes messages correctly
6. System recovers from restart
