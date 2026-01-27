# Slack Claude Relay - Design Specification

**Date:** 2026-01-26
**Status:** Ready for implementation
**Project:** TrafficControl (v0 MVP)

---

## Overview

A lightweight Slack bot that bridges messages from your phone to a Claude CLI running on your desktop PC, enabling remote coding assistance using your Claude Max subscription.

**Key Features:**
- Message from Slack (mobile) → Claude CLI (desktop) → response back to Slack
- Uses Claude Max subscription (not API billing)
- Channel-based project routing with dynamic discovery
- Conversation continuity via `--resume`
- Progress updates during long-running tasks

---

## User Experience

### First Use in a Channel

```
You: @relay fix the failing test in scheduler.test.ts

Bot: I don't have a project set for #traffic-control yet.
     Which directory should I work in?

You: C:\Users\Eli\projects\traffic-control

Bot: 📁 traffic-control
     Got it! Working on your request...

Bot: Reading scheduler.test.ts...
Bot: Found issue: missing mock for database client
Bot: Editing file...
Bot: Running tests... ✅ All passing

Bot: Fixed the failing test. The issue was [explanation]
```

### Subsequent Messages (Same Channel)
- Bot remembers the project mapping
- Just `@relay do the thing` works immediately

### Conversation Continuity
- Reply in a thread → continues same Claude session (`--resume`)
- New message in channel → new session
- Send `!reset` in thread → clears session, next message starts fresh

### Switch Projects
- `switch to C:\Users\Eli\projects\other-project` → updates channel mapping

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Your Phone (Slack App)                        │
└─────────────────────────────┬───────────────────────────────────┘
                              │ Socket Mode (outbound from desktop)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Desktop PC (running relay)                    │
│                                                                  │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │ Slack Bot   │───▶│ Relay Handler│───▶│ Claude CLI        │  │
│  │ (Bolt)      │    │              │    │ --print --resume  │  │
│  └─────────────┘    └──────────────┘    └───────────────────┘  │
│         │                  │                      │             │
│         │           ┌──────▼──────┐               │             │
│         │           │ Session     │◀──────────────┘             │
│         │           │ Store       │  (claude session ID)        │
│         │           │ (in-memory) │                             │
│         │           └─────────────┘                             │
│         │                                                       │
│         │           ┌─────────────┐                             │
│         └──────────▶│ Project     │                             │
│                     │ Store       │                             │
│                     │ (persisted) │                             │
│                     └─────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Create

All new files in `src/relay/`:

| File | Purpose |
|------|---------|
| `index.ts` | Entry point. Starts bot in Socket Mode. |
| `bot.ts` | Slack Bolt app setup, event handlers |
| `handler.ts` | Core relay logic: spawn CLI, stream output, post updates |
| `session-store.ts` | In-memory map: `threadTs` → `claudeSessionId` |
| `project-store.ts` | Persisted map: `channelId` → `projectPath` (JSON file) |
| `config.ts` | Environment variables and defaults |

### File Details

#### `src/relay/index.ts`
```typescript
// Entry point - minimal bootstrap
// - Load config from env
// - Create stores
// - Create handler
// - Create bot
// - Start Socket Mode
```

#### `src/relay/bot.ts`
```typescript
// Slack Bolt setup
// Event handlers:
// - app_mention: @relay in channels
// - message (DM): direct messages to bot
// - Dispatch to handler based on:
//   - Is this a !reset command?
//   - Is this a "switch to" command?
//   - Otherwise: relay to Claude
```

#### `src/relay/handler.ts`
```typescript
interface RelayResult {
  success: boolean
  response: string
  sessionId: string | null
  error?: string
}

class RelayHandler {
  // Main relay function
  async relay(message: string, context: RelayContext): Promise<RelayResult>

  // Spawn claude CLI with appropriate flags
  private spawnClaude(prompt: string, cwd: string, resumeId?: string): ChildProcess

  // Parse streaming JSON output
  private parseStream(stdout: Readable): AsyncGenerator<CLIMessage>

  // Post progress update to Slack
  private postProgress(text: string, channel: string, threadTs: string): Promise<void>

  // Chunk long responses for Slack's 4000 char limit
  private chunkResponse(text: string): string[]
}
```

#### `src/relay/session-store.ts`
```typescript
// In-memory store (no persistence needed - sessions are ephemeral)
class SessionStore {
  private sessions: Map<string, string>  // threadTs → claudeSessionId

  get(threadTs: string): string | undefined
  set(threadTs: string, sessionId: string): void
  delete(threadTs: string): void  // for !reset
}
```

#### `src/relay/project-store.ts`
```typescript
// Persisted to ~/.relay-projects.json
class ProjectStore {
  private projects: Map<string, string>  // channelId → projectPath
  private filePath: string

  get(channelId: string): string | undefined
  set(channelId: string, projectPath: string): void
  save(): void  // persist to file
  load(): void  // load from file on startup
}
```

---

## CLI Invocation

**New conversation:**
```bash
claude --print \
  --output-format stream-json \
  --dangerously-skip-permissions \
  "user's message"
```

**Continuing conversation:**
```bash
claude --print \
  --output-format stream-json \
  --dangerously-skip-permissions \
  --resume <sessionId> \
  "user's follow-up"
```

**Working directory:** Set to the project path for that channel

---

## Progress Updates

Parse `stream-json` output and post meaningful updates:

| CLI Message Type | Slack Update |
|------------------|--------------|
| `tool_use` with `Read` | "Reading {filename}..." |
| `tool_use` with `Edit` | "Editing {filename}..." |
| `tool_use` with `Write` | "Creating {filename}..." |
| `tool_use` with `Bash` | "Running command..." |
| `result` with `success` | Post final response |
| `result` with `error` | Post error message |

**Rate limiting:** Max 1 progress update per 3 seconds to avoid spam

---

## Error Handling

| Error | User-Facing Message |
|-------|---------------------|
| CLI not found | "Claude CLI not found. Is it installed and in PATH?" |
| Auth needed | "Claude CLI needs authentication. Run `claude` on your desktop to log in." |
| Timeout (10 min) | "Request timed out. Try breaking it into smaller tasks." |
| Resume failed | "Starting fresh (previous session unavailable)" |
| Unknown error | "Something went wrong: {error}" |

---

## Configuration

**Environment Variables:**
```
# Required (from existing Slack setup)
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...

# Optional
RELAY_TIMEOUT_MS=600000        # 10 minute default
RELAY_MODEL=sonnet             # or opus
RELAY_CLI_PATH=claude          # path to CLI if not in PATH
```

**Persisted Config:**
- `~/.relay-projects.json` - Channel → project mappings (auto-generated through conversation)

---

## package.json Addition

```json
{
  "scripts": {
    "relay": "tsx src/relay/index.ts",
    "relay:dev": "tsx watch src/relay/index.ts"
  }
}
```

---

## Verification Plan

1. **Build:** `npm run build` passes
2. **Start relay:** `npm run relay` starts without error
3. **Test DM:** Send DM to bot, verify response
4. **Test channel:** @mention bot in channel, verify project discovery flow
5. **Test continuity:** Reply in thread, verify `--resume` works
6. **Test reset:** Send `!reset`, verify new session starts
7. **Test progress:** Send complex task, verify progress updates appear
8. **Test long response:** Trigger response >4000 chars, verify chunking

---

## Implementation Order

1. **Phase 1: Basic relay** (MVP)
   - `config.ts` - load env vars
   - `project-store.ts` - channel→project mapping
   - `handler.ts` - spawn CLI, capture output
   - `bot.ts` - Slack events
   - `index.ts` - entry point

2. **Phase 2: Conversation continuity**
   - `session-store.ts` - thread→session mapping
   - Add `--resume` flag support
   - Add `!reset` command

3. **Phase 3: Polish**
   - Progress updates from stream-json
   - Response chunking
   - Error handling refinement
