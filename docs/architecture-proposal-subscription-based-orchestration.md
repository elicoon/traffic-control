# Architecture Proposal: Subscription-Based Orchestration for TrafficControl

**Author:** Claude Opus 4.5
**Date:** 2026-01-26 (Updated)
**Status:** Proposal
**Priority:** High
**Use Case:** Single-user personal orchestrator

---

## Executive Summary

This document proposes architectural approaches for TrafficControl to leverage Claude Pro/Max subscriptions instead of requiring separate API credits. The current implementation uses the Claude Agent SDK which mandates `ANTHROPIC_API_KEY` for authentication, incurring pay-per-token API costs. With Claude Max at $200/month offering 20x Pro usage, subscription-based orchestration could dramatically reduce costs for high-volume agent workflows.

**Key Finding:** As of January 2026, Anthropic has actively blocked third-party tools from using subscription OAuth tokens for programmatic automation. This is a deliberate policy to separate consumer subscriptions from commercial API usage. However, several legitimate and semi-legitimate approaches exist.

**Important Clarification:** This system is a **personal orchestrator** for a single user (Eli), not a multi-tenant platform. This significantly simplifies the architecture and changes which approaches are appropriate.

---

## Table of Contents

1. [Single-User Architecture](#1-single-user-architecture) **NEW**
2. [Current Architecture & Limitations](#2-current-architecture--limitations)
3. [Alternative Approaches](#3-alternative-approaches)
   - [Approach A: Claude Code CLI via Subprocess](#approach-a-claude-code-cli-via-subprocess) **RECOMMENDED**
   - [Approach B: ai-sdk-provider-claude-code](#approach-b-ai-sdk-provider-claude-code)
   - [Approach C: Claude-Flow Framework](#approach-c-claude-flow-framework)
   - [Approach D: Native Subagent Delegation](#approach-d-native-subagent-delegation)
   - [Approach E: Browser Automation](#approach-e-browser-automation) (Not Recommended)
   - ~~[Approach F: Hybrid Model Routing](#approach-f-hybrid-model-routing)~~ (Removed - unnecessary for single-user)
4. [Detailed Comparison Matrix](#4-detailed-comparison-matrix)
5. [TOS Analysis](#5-tos-analysis)
6. [Recommended Approach](#6-recommended-approach)
7. [Implementation Plan](#7-implementation-plan)
8. [Risk Assessment](#8-risk-assessment)
9. [References](#9-references)

---

## 1. Single-User Architecture

### Context: Personal Orchestrator vs Multi-Tenant System

TrafficControl is a **personal orchestrator** for a single developer. This fundamentally changes the architecture requirements:

| Concern | Multi-Tenant System | Personal Orchestrator (TrafficControl) |
|---------|--------------------|-----------------------------------------|
| Authentication | Multiple users, OAuth flows | Single user, local credentials |
| Deployment | Separate dev/staging/prod | Single deployment that works |
| Scaling | Horizontal, multi-instance | Single machine, sufficient |
| TOS Risk | High (offering service to others) | Low (personal automation) |
| Complexity | High (isolation, billing, etc.) | Minimal (just works) |

### Simplified Architecture

For a single-user system, the architecture can be dramatically simplified:

```
┌─────────────────────────────────────────────────────────────┐
│                TrafficControl (Single-User)                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │   Backlog    │  │   Scheduler   │  │   Slack Router   │ │
│  │   (Supabase) │  │               │  │   (Your Slack)   │ │
│  └──────────────┘  └───────────────┘  └──────────────────┘ │
│          │                │                    │            │
│          └────────────────┴────────────────────┘            │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  CLI Adapter                          │  │
│  │            (Uses Your Subscription)                   │  │
│  │                                                       │  │
│  │  - Spawns `claude` CLI processes                     │  │
│  │  - Uses your logged-in subscription                  │  │
│  │  - JSON streaming for real-time events               │  │
│  │  - Native subagent support                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Claude Code CLI                          │  │
│  │         (Authenticated via `claude login`)           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Why Dev/Prod Distinction is Unnecessary

The original proposal included a "Hybrid Model Routing" approach that routed between:
- **Development:** CLI with subscription
- **Production:** SDK with API key

**This is unnecessary for TrafficControl because:**

1. **No "production users"** - You're the only user. If the Slack integration works during development, it works period.

2. **No reliability SLA** - A multi-tenant system needs 99.9% uptime guarantees. Your personal orchestrator just needs to work well enough for you.

3. **No cost segregation** - There's no need to separate "dev costs" from "production costs" when it's all your money.

4. **Simpler failure modes** - If the CLI approach fails, you notice immediately and fix it. No need for automatic fallback to API.

5. **TOS risk is different** - Using your own subscription for your own automation is different from offering a service to others.

### Recommended Single-User Approach

**Use CLI Subprocess (Approach A) exclusively:**

```typescript
// Simplified single-adapter architecture
class CLIAdapter implements ISDKAdapter {
  async startQuery(
    sessionId: string,
    prompt: string,
    config: SDKAdapterConfig,
    onMessage?: SDKMessageHandler
  ): Promise<ActiveQuery> {
    // Always use CLI - no routing logic needed
    const proc = spawn('claude', [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--model', config.model,
      '--dangerously-skip-permissions'
    ], { cwd: config.cwd });

    // Parse JSON stream and emit events
    // ...
  }
}
```

### What You Lose (and Why It's Okay)

| Feature | SDK Approach | CLI Approach | Impact |
|---------|--------------|--------------|--------|
| Fine-grained streaming | Full control | JSON lines | Acceptable - CLI streaming is sufficient |
| Programmatic error handling | Typed exceptions | Exit codes + stderr | Acceptable - can be wrapped |
| Rate limit management | SDK handles | Manual implementation | Minor - subscription limits are generous |
| Token counting | Built-in | Parse from output | Minor - can track from JSON events |
| MCP server injection | SDK parameter | CLI flag | Same capability |

### What You Gain

1. **~$200/month flat cost** instead of pay-per-token (potentially $1000+/month)
2. **Simpler codebase** - One adapter instead of two
3. **No API key management** - Just stay logged in
4. **All CLI features** - Subagents, MCP, tools all work
5. **Same auth as interactive use** - No separate billing

---

## 2. Current Architecture & Limitations

> **Note:** This section describes the current API-based implementation. For the recommended single-user architecture, see [Section 1](#1-single-user-architecture).

### Current Implementation

TrafficControl currently uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) through our `SDKAdapter` class:

```typescript
// src/agent/sdk-adapter.ts
const sdk = await import('@anthropic-ai/claude-agent-sdk');
this.queryFn = sdk.query;

const options: Options = {
  cwd: config.cwd,
  model: MODEL_MAP[config.model],
  permissionMode: config.permissionMode ?? 'bypassPermissions',
  // ...
};

const query = this.queryFn({ prompt, options });
```

### Authentication Requirement

The Claude Agent SDK **requires** one of:
- `ANTHROPIC_API_KEY` - Traditional API key from console.anthropic.com
- Third-party providers (Bedrock, Vertex AI, Azure Foundry) - Still pay-per-token

**The SDK does NOT support `CLAUDE_CODE_OAUTH_TOKEN`** (subscription tokens).

This was confirmed in [GitHub Issue #6536](https://github.com/anthropics/claude-code/issues/6536):

> "The SDK is designed for programmatic use and requires traditional API key authentication. OAuth tokens are for interactive CLI usage only."
> - Anthropic Staff

### Cost Implications

| Usage Level | API Pricing (Opus) | API Pricing (Sonnet) | Max Subscription |
|-------------|-------------------|---------------------|------------------|
| Light (1M tokens/mo) | ~$75 | ~$15 | $100/mo (flat) |
| Medium (5M tokens/mo) | ~$375 | ~$75 | $100/mo (flat) |
| Heavy (20M tokens/mo) | ~$1,500 | ~$300 | $200/mo (flat) |
| Very Heavy (50M+ tokens/mo) | ~$3,750+ | ~$750+ | $200/mo (flat) |

**Potential Savings:** For heavy users, subscription-based access could save 80-95% on model costs.

---

## 3. Alternative Approaches

### Approach A: Claude Code CLI via Subprocess (RECOMMENDED for Single-User)

**Concept:** Spawn the `claude` CLI as a subprocess instead of using the SDK directly. The CLI authenticates via subscription login.

> **Single-User Verdict:** This is the recommended approach for TrafficControl. It provides the best balance of cost savings, simplicity, and feature parity for a personal orchestrator.

#### Technical Implementation

```typescript
import { spawn } from 'child_process';

interface CLIAgentOptions {
  prompt: string;
  cwd: string;
  model?: 'opus' | 'sonnet' | 'haiku';
  maxTurns?: number;
  outputFormat?: 'json' | 'text' | 'stream-json';
}

class CLIAdapter {
  async runAgent(options: CLIAgentOptions): Promise<AgentResult> {
    const args = [
      '-p', options.prompt,
      '--output-format', options.outputFormat || 'stream-json',
      '--model', options.model || 'sonnet',
      '--dangerously-skip-permissions',  // For automation
    ];

    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }

    const proc = spawn('claude', args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb' }
    });

    // Stream JSON output parsing
    const messages: SDKMessage[] = [];
    for await (const line of readline.createInterface({ input: proc.stdout })) {
      if (line.trim()) {
        try {
          messages.push(JSON.parse(line));
        } catch {}
      }
    }

    return this.processMessages(messages);
  }
}
```

#### Key CLI Flags for Automation

| Flag | Purpose |
|------|---------|
| `-p "prompt"` | Print mode - non-interactive |
| `--output-format stream-json` | Machine-readable output |
| `--dangerously-skip-permissions` | Skip permission prompts |
| `--max-turns N` | Limit execution cost |
| `--no-session-persistence` | Don't save to disk |
| `--system-prompt "..."` | Custom instructions |
| `--allowedTools "Read,Edit,Bash"` | Restrict tools |

#### Pros
- Uses existing subscription authentication
- No code changes to Claude Code itself
- All CLI features available (subagents, MCP, tools)
- JSON streaming enables real-time monitoring
- Officially supported CLI interface

#### Cons
- Process overhead for each agent spawn
- Less fine-grained control than SDK
- Error handling more complex
- No direct streaming to SDK event handlers
- May hit subscription rate limits faster

#### TOS Status: **GRAY AREA** (but acceptable for personal use)
- CLI is designed for interactive use
- `-p` flag is officially documented for automation
- Anthropic hasn't explicitly blocked this pattern
- Using `--dangerously-skip-permissions` for automation may violate spirit of TOS
- **For personal use:** Risk is minimal since you're not offering a service to others

---

### Approach B: ai-sdk-provider-claude-code

**Concept:** Use the community-developed Vercel AI SDK provider that wraps the Claude Agent SDK while using CLI authentication.

#### Source

[GitHub: ben-vargas/ai-sdk-provider-claude-code](https://github.com/ben-vargas/ai-sdk-provider-claude-code)

#### Installation

```bash
npm install ai-sdk-provider-claude-code ai@^6.0.0 zod@^4.0.0
```

#### Usage

```typescript
import { streamText, generateText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

// Uses subscription auth via CLI under the hood
const result = await streamText({
  model: claudeCode('sonnet'),
  prompt: 'Analyze this codebase and suggest improvements',
});

// With structured output
const analysis = await generateText({
  model: claudeCode('opus'),
  prompt: 'Extract all API endpoints from this project',
  schema: z.object({
    endpoints: z.array(z.object({
      path: z.string(),
      method: z.string(),
      handler: z.string(),
    }))
  })
});
```

#### Integration with TrafficControl

```typescript
// New provider-based adapter
class AISDKAdapter implements ISDKAdapter {
  async startQuery(
    sessionId: string,
    prompt: string,
    config: SDKAdapterConfig,
    onMessage?: SDKMessageHandler
  ): Promise<ActiveQuery> {
    const model = claudeCode(config.model, {
      tools: config.allowedTools,
      permissionMode: config.permissionMode,
      sandbox: { enabled: false },
    });

    const result = streamText({
      model,
      prompt,
      abortSignal: abortController.signal,
      onStreamPart: (part) => {
        // Map to our event types
        if (onMessage) {
          const event = this.mapStreamPartToMessage(part);
          if (event) onMessage(event, sessionId);
        }
      }
    });

    // Return ActiveQuery wrapper
  }
}
```

#### Pros
- Clean integration with Vercel AI SDK ecosystem
- Maintains subscription-based authentication
- Supports structured outputs via Zod schemas
- Active community maintenance
- Handles streaming automatically

#### Cons
- **Unofficial community project** - no Anthropic support
- Extra dependency layer
- May break with SDK/CLI updates
- Limited to Vercel AI SDK patterns
- Requires Zod 4 (potential version conflicts)

#### TOS Status: **GRAY AREA**
- Uses official CLI underneath
- Community project, not endorsed by Anthropic
- Same concerns as direct CLI usage

---

### Approach C: Claude-Flow Framework

**Concept:** Use the claude-flow orchestration framework which provides enterprise-grade multi-agent coordination with native Claude Code support.

#### Source

[GitHub: ruvnet/claude-flow](https://github.com/ruvnet/claude-flow)

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude-Flow Platform                      │
├─────────────┬─────────────┬────────────────┬────────────────┤
│   Router    │   Swarm     │    Memory      │   Security     │
│  (Q-Learn)  │   Queens    │   (RuVector)   │  (AIDefence)   │
├─────────────┴─────────────┴────────────────┴────────────────┤
│                 Agent Pool (60+ Specialized)                 │
│  researcher | coder | analyst | tester | architect | ...    │
├─────────────────────────────────────────────────────────────┤
│              Claude Code CLI / MCP Integration               │
└─────────────────────────────────────────────────────────────┘
```

#### Key Features
- **Smart Task Routing:** Uses Q-Learning + Mixture-of-Experts for optimal agent selection
- **Cost Optimization:** Routes simple tasks to WASM (free), medium to Haiku, complex to Opus
- **Token Optimization:** 30-50% reduction through context compression
- **Multi-Provider Failover:** Claude, GPT, Gemini, local models
- **Memory System:** HNSW vector search for fast retrieval

#### Integration Approach

```typescript
import { ClaudeFlow, createSwarm } from 'claude-flow';

const flow = new ClaudeFlow({
  primaryProvider: 'claude-code',  // Uses subscription
  fallbackProviders: ['ollama'],   // Local fallback
  costBudget: 50.00,               // USD limit
});

const swarm = createSwarm({
  topology: 'hierarchical',
  queen: 'tactical',
  workers: ['coder', 'tester', 'reviewer'],
  maxAgents: 8,
});

// Execute task through swarm
const result = await flow.execute({
  task: 'Implement authentication module',
  swarm,
  constraints: {
    maxTokens: 100000,
    timeoutMinutes: 30,
  }
});
```

#### Pros
- Production-ready orchestration platform
- Built-in cost optimization (claims 250% usage extension)
- Multi-model routing based on task complexity
- Robust failure handling and consensus algorithms
- Active development with strong community

#### Cons
- Heavy dependency (full platform vs. simple adapter)
- Learning curve for swarm concepts
- May overlap with TrafficControl's own orchestration
- Opinionated architecture decisions
- Unclear subscription authentication mechanism

#### TOS Status: **UNCLEAR**
- Uses Claude Code CLI internally
- May implement provider spoofing (blocked by Anthropic)
- Claims legitimate but warrants investigation

---

### Approach D: Native Subagent Delegation

**Concept:** Use Claude Code's built-in subagent system with custom CLAUDE.md configuration to create a self-orchestrating system.

#### How It Works

From [Claude Code Subagents Documentation](https://code.claude.com/docs/en/sub-agents):

> "When Claude encounters a task that matches a subagent's description, it delegates to that subagent, which works independently and returns results."

#### Implementation Pattern

1. **Create Orchestrator Subagent:**

```markdown
<!-- ~/.claude/agents/orchestrator.md -->
---
name: orchestrator
description: Coordinates multi-task workflows. Use when given complex tasks requiring parallel execution.
tools: Read, Write, Bash, Glob, Grep
model: sonnet
permissionMode: bypassPermissions
---

You are the TrafficControl orchestrator. When given a complex task:

1. Decompose into independent subtasks
2. Delegate to specialized subagents (code-reviewer, debugger, data-scientist)
3. Aggregate results and report status
4. Route questions through AskUserQuestion tool

Use the general-purpose subagent for tasks requiring both exploration and action.
```

2. **Launch via CLI with orchestrator:**

```bash
# Start with orchestrator context
claude --agent orchestrator \
  --append-system-prompt "$(cat trafficcontrol-context.md)" \
  -p "Execute backlog item: Implement user authentication"
```

3. **Monitor via Transcript Files:**

```typescript
// Watch ~/.claude/projects/{project}/{session}/subagents/
const watcher = chokidar.watch(transcriptPath, { persistent: true });
watcher.on('change', (path) => {
  const events = parseJSONL(fs.readFileSync(path));
  // Process agent events
});
```

#### Pros
- **Officially supported feature**
- Native parallel execution support
- Built-in context management
- Cost control via model selection per subagent
- Hooks for lifecycle events

#### Cons
- Limited programmatic control
- Can't spawn subagents from subagents (depth limit)
- Relies on Claude's decision-making for delegation
- Monitoring via file watching is indirect
- Still requires active Claude Code session

#### TOS Status: **COMPLIANT**
- Using Claude Code as designed
- Subagents are an official feature
- No authentication workarounds

---

### Approach E: Browser Automation

**Concept:** Automate the claude.ai web interface via Playwright/Puppeteer to submit prompts and retrieve responses.

#### Implementation Sketch

```typescript
import { chromium, Browser, Page } from 'playwright';

class BrowserAutomationAdapter {
  private browser: Browser;
  private page: Page;

  async initialize() {
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();

    // Load auth cookies
    await this.page.context().addCookies(
      JSON.parse(fs.readFileSync('claude-cookies.json'))
    );

    await this.page.goto('https://claude.ai/new');
  }

  async sendPrompt(prompt: string): Promise<string> {
    // Find and fill textarea
    await this.page.fill('textarea[placeholder*="Message"]', prompt);
    await this.page.keyboard.press('Enter');

    // Wait for response
    await this.page.waitForSelector('.assistant-message', { timeout: 300000 });

    // Extract response
    const response = await this.page.$eval(
      '.assistant-message:last-child',
      el => el.textContent
    );

    return response;
  }
}
```

#### Pros
- Uses actual subscription directly
- No CLI/SDK dependencies
- Access to web-only features

#### Cons
- **Very fragile** - UI changes break automation
- Rate limiting and captchas
- Session management complexity
- No streaming support
- Extremely slow compared to API
- Resource intensive (browser processes)

#### TOS Status: **VIOLATION**
From Anthropic's [Consumer Terms of Service Updates](https://www.anthropic.com/news/updates-to-our-consumer-terms):

> "Unless previously approved, Anthropic does not allow third party developers to offer Claude.ai login or rate limits for their products, including agents."

**This approach clearly violates TOS.**

---

### ~~Approach F: Hybrid Model Routing~~ (REMOVED)

> **Single-User Note:** This approach has been removed from consideration. It was designed for multi-tenant systems that need to separate development costs from production costs and provide reliability guarantees to multiple users.
>
> For TrafficControl (a single-user personal orchestrator), the dev/prod distinction is unnecessary overhead. See [Section 1: Single-User Architecture](#1-single-user-architecture) for details.

<details>
<summary>Original Approach F (collapsed for reference)</summary>

**Concept:** Use subscription for development/testing, API for production. Route based on environment and task criticality.

#### Why This Is Unnecessary for Single-User

1. **No separate "production environment"** - If it works with Slack, it works
2. **No SLA requirements** - No need for API fallback reliability
3. **Added complexity** - Two adapters to maintain instead of one
4. **No cost benefit** - You'd still pay for API usage

#### Original Architecture (for reference only)

```
┌─────────────────────────────────────────────────────────────┐
│                    TrafficControl                            │
├─────────────────────────────────────────────────────────────┤
│                    Model Router                              │
│  ┌─────────────────┐    ┌─────────────────┐                 │
│  │  Environment    │    │  Task Metadata  │                 │
│  │  - dev/staging  │    │  - priority     │                 │
│  │  - production   │    │  - cost_class   │                 │
│  └────────┬────────┘    └────────┬────────┘                 │
│           │                      │                           │
│           └──────────┬───────────┘                           │
│                      ▼                                       │
│           ┌─────────────────────┐                           │
│           │   Routing Logic     │                           │
│           └─────────────────────┘                           │
│                      │                                       │
│           ┌─────────┴─────────┐                             │
│           ▼                   ▼                              │
│  ┌─────────────────┐ ┌─────────────────┐                    │
│  │  CLI Adapter    │ │  SDK Adapter    │                    │
│  │  (Subscription) │ │  (API Key)      │                    │
│  └─────────────────┘ └─────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

</details>

#### Pros
- Optimizes costs while maintaining reliability
- Clear separation of concerns
- Graceful degradation
- Respects TOS for production workloads
- Preserves existing SDK infrastructure

#### Cons
- Dual infrastructure maintenance
- Complexity in routing logic
- Potential inconsistency between environments
- Still requires both subscription and API credits

#### TOS Status: **MOSTLY COMPLIANT**
- Production uses official API
- Development use of CLI is gray area but lower risk
- Not offering Claude login to third parties

---

## 4. Detailed Comparison Matrix

> **Single-User Recommendation:** For a personal orchestrator, **CLI Subprocess (Approach A)** is the clear winner. The Hybrid Routing approach has been removed as unnecessary complexity.

| Criterion | CLI Subprocess | ai-sdk-provider | claude-flow | Native Subagents | Browser Auto | ~~Hybrid Routing~~ |
|-----------|---------------|-----------------|-------------|------------------|--------------|----------------|
| **Implementation Effort** | Medium | Low | High | Low | High | ~~Medium~~ N/A |
| **Maintenance Burden** | Low | Medium | High | Low | Very High | ~~Medium~~ N/A |
| **Cost Savings** | 80-95% | 80-95% | 80-95% | 80-95% | 80-95% | ~~40-60%~~ N/A |
| **Reliability** | High | Medium | Medium | High | Low | ~~High~~ N/A |
| **TOS Compliance** | Gray (low risk for personal) | Gray | Unclear | Compliant | Violation | ~~Mostly Compliant~~ N/A |
| **Feature Parity** | Full | Most | Extended | Limited | Basic | ~~Full~~ N/A |
| **Streaming Support** | Yes | Yes | Yes | No | No | ~~Yes~~ N/A |
| **Subagent Support** | Yes | Limited | Yes | Yes | No | ~~Yes~~ N/A |
| **MCP Integration** | Yes | Limited | Yes | Yes | No | ~~Yes~~ N/A |
| **Personal Use Risk** | **Low** | Low-Medium | Medium | Very Low | Very High | ~~Low-Medium~~ N/A |

### Single-User Ranking

For TrafficControl's single-user use case, approaches are ranked:

1. **CLI Subprocess (A)** - Best overall: full features, low complexity, ~$200/mo flat
2. **Native Subagents (D)** - Can complement CLI approach
3. **ai-sdk-provider (B)** - Alternative if you prefer Vercel AI SDK patterns
4. **claude-flow (C)** - Overkill for single-user; adds unnecessary complexity
5. **Browser Automation (E)** - Do not use (TOS violation)

---

## 5. TOS Analysis

### Anthropic's Position (January 2026)

From [VentureBeat](https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses):

> "Anthropic has tightened safeguards against spoofing the Claude Code harness."

Anthropic has:
1. **Blocked OAuth token external use** - Subscription tokens only work within Claude Code
2. **Banned third-party harnesses** - Tools that pilot Claude via OAuth for automation
3. **Separated consumer/commercial billing** - Subscriptions for interactive use, API for automation

### What's Allowed

| Use Case | Status |
|----------|--------|
| Interactive Claude Code CLI usage | Allowed |
| `-p` print mode for scripting | Allowed (documented feature) |
| SDK with API key | Allowed |
| Native subagents within Claude Code | Allowed |
| Third-party OAuth automation | Blocked |
| Browser automation of claude.ai | Violation |
| Offering Claude login to users | Violation |

### Single-User vs Multi-Tenant TOS Risk

The TOS restrictions are primarily aimed at preventing third-party services from reselling Claude access:

| Scenario | TOS Risk | Why |
|----------|----------|-----|
| Building a SaaS that uses Claude subscriptions | **High** | Offering Claude to third parties |
| Personal CLI automation for your own projects | **Low** | Same as typing commands manually |
| Automating your own Slack notifications | **Low** | Personal productivity tool |
| Selling an orchestrator that uses subscriptions | **High** | Commercial use of consumer subscription |

**For TrafficControl:** Since this is a personal tool that only you use, CLI subprocess automation carries minimal TOS risk. You're essentially automating what you would do manually.

### Risk Assessment by Approach (Updated for Single-User)

1. **Native Subagents (Approach D):** Safest option - using features as designed
2. **CLI Subprocess (Approach A):** **Low risk for personal use** - documented `-p` flag, personal automation
3. **ai-sdk-provider (Approach B):** Low-medium risk - community wrapper but same underlying mechanism
4. **claude-flow (Approach C):** Medium risk - more visible third-party tool
5. **Browser Automation (Approach E):** Clear violation - don't use regardless of personal/commercial

---

## 6. Recommended Approach

### Primary Recommendation: CLI Subprocess with Optional Subagents

For a **single-user personal orchestrator**, use **Approach A (CLI Subprocess)** as the primary (and only) adapter, with **optional Approach D (Native Subagents)** for complex multi-step tasks.

> **Key Change:** The Hybrid Routing approach (Approach F) has been removed. There is no need to maintain separate dev/prod adapters when you're the only user.

#### Simplified Architecture

```
┌─────────────────────────────────────────────────────────────┐
│             TrafficControl (Single-User Edition)             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐ │
│  │   Backlog    │  │   Scheduler   │  │   Slack Router   │ │
│  │   (Supabase) │  │               │  │   (Your Slack)   │ │
│  └──────────────┘  └───────────────┘  └──────────────────┘ │
│          │                │                    │            │
│          └────────────────┴────────────────────┘            │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                  CLI Adapter                          │  │
│  │            (Your Logged-In Subscription)              │  │
│  │                                                       │  │
│  │  - Spawns `claude -p` processes                      │  │
│  │  - JSON streaming for events                         │  │
│  │  - Full tool access (Read, Edit, Bash, etc.)         │  │
│  │  - Optional: Native subagent delegation              │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐ │  │
│  │  │  Optional Subagents (for complex tasks)         │ │  │
│  │  │  - tc-orchestrator                              │ │  │
│  │  │  - tc-code-reviewer                             │ │  │
│  │  │  - tc-debugger                                  │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Why This Approach (Updated for Single-User)

1. **Maximum simplicity:** One adapter, one code path, one billing method
2. **Full cost savings:** ~$200/month flat vs potentially $1000+/month on API
3. **All features included:** Subagents, MCP servers, all tools work through CLI
4. **No routing complexity:** No need to decide which adapter to use
5. **Works with Slack:** If it works in development, it works period
6. **Low TOS risk:** Personal automation carries minimal risk
7. **Easy debugging:** One adapter means one place to look when things break

---

## 7. Implementation Plan (Simplified for Single-User)

> **Note:** This implementation plan has been simplified from the original 5-phase hybrid approach to a streamlined 3-phase single-adapter approach.

### Phase 1: CLI Adapter Foundation (1 week)

**Goal:** Create CLIAdapter that replaces SDKAdapter for all use cases

```typescript
// src/agent/cli-adapter.ts

export interface CLIAdapterConfig {
  cwd: string;
  model: 'opus' | 'sonnet' | 'haiku';
  maxTurns?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  outputFormat?: 'json' | 'stream-json';
}

export class CLIAdapter implements ISDKAdapter {
  async startQuery(
    sessionId: string,
    prompt: string,
    config: CLIAdapterConfig,
    onMessage?: SDKMessageHandler
  ): Promise<ActiveQuery> {
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--model', config.model,
      '--dangerously-skip-permissions'
    ];

    if (config.maxTurns) {
      args.push('--max-turns', String(config.maxTurns));
    }

    if (config.systemPrompt) {
      args.push('--system-prompt', config.systemPrompt);
    }

    const proc = spawn('claude', args, {
      cwd: config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb' }
    });

    // Parse JSON stream and emit events
    return this.createActiveQuery(proc, sessionId, onMessage);
  }
}
```

**Tasks:**
- [ ] Create CLIAdapter class implementing ISDKAdapter interface
- [ ] Implement JSON stream parsing for real-time events
- [ ] Map CLI output to existing AgentEvent types
- [ ] Add error handling for CLI failures (exit codes, stderr)
- [ ] Write unit tests with mocked CLI
- [ ] Verify subscription authentication works

### Phase 2: Replace SDK Adapter (3 days)

**Goal:** Swap out SDKAdapter for CLIAdapter throughout the codebase

**Tasks:**
- [ ] Update AgentManager to use CLIAdapter exclusively
- [ ] Remove SDK adapter dependency (can keep as fallback if desired)
- [ ] Update configuration to remove environment-based routing
- [ ] Test with actual Slack integration
- [ ] Verify all existing tests pass with new adapter

**Key change:** No routing logic needed. All tasks use CLIAdapter.

```typescript
// src/agent/agent-manager.ts (simplified)

export class AgentManager {
  private adapter: CLIAdapter;  // Single adapter, not a router

  constructor() {
    this.adapter = new CLIAdapter();
  }

  async runTask(task: Task): Promise<TaskResult> {
    // Always use CLI adapter - no routing decision needed
    return this.adapter.startQuery(
      task.sessionId,
      task.prompt,
      { cwd: task.projectPath, model: task.model }
    );
  }
}
```

### Phase 3: Optional Subagent Configuration (2 days)

**Goal:** Create TrafficControl-specific subagents for complex tasks

> This phase is optional. Subagents can improve handling of complex multi-step tasks but are not required for basic operation.

**Files to create:**
```
~/.claude/agents/
├── tc-orchestrator.md      # Main coordinator (optional)
├── tc-code-reviewer.md     # Code review tasks (optional)
└── tc-researcher.md        # Codebase exploration (optional)
```

**Example subagent:**
```markdown
---
name: tc-orchestrator
description: TrafficControl task coordinator. Use for complex multi-step tasks.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
permissionMode: bypassPermissions
---

You are the TrafficControl orchestrator. When given a complex task:
1. Decompose into independent subtasks
2. Delegate to specialized subagents
3. Aggregate results and report status
```

### Total Implementation Time: ~2 weeks

Compared to original 5-phase hybrid plan (~3 weeks), this simplified approach saves:
- **1 week of development time**
- **Ongoing maintenance of two adapters**
- **Routing logic complexity**

---

## 8. Risk Assessment (Updated for Single-User)

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| CLI interface changes | Medium | High | Abstract CLI calls, add version detection |
| Subscription rate limits | Medium | Medium | Implement backoff, natural pacing |
| Stream parsing errors | Low | Medium | Robust error handling, retries |
| CLI process crashes | Low | Low | Automatic retry with fresh process |

### Business Risks (Reduced for Single-User)

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| TOS enforcement tightening | Low | Medium | Monitor Anthropic updates; personal use is lower risk |
| Account suspension | Very Low | High | Personal automation is within reasonable use |
| Cost savings less than projected | Low | Low | Fixed subscription cost is predictable |

### What's Different for Single-User

Many risks from the original assessment were related to **multi-tenant** concerns that don't apply:

| Original Concern | Single-User Reality |
|-----------------|---------------------|
| "Use separate accounts for dev/prod" | Not needed - single account is fine |
| "Automatic fallback to SDK" | Optional - can manually intervene if needed |
| "Gradual rollout" | Just start using it; you're the only user |
| "Track usage across both paths" | Only one path to track |
| "Account suspension risk" | Much lower for personal automation |

### Simplified Safeguards

1. **Version Checking:** Detect CLI version changes that might break parsing
2. **Error Alerting:** Send Slack notification if CLI adapter fails repeatedly
3. **Manual Override:** Keep ability to run SDK adapter if absolutely needed
4. **TOS Monitoring:** Occasionally check Anthropic policy updates

---

## 9. References

### Official Documentation
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Agent SDK Overview](https://docs.claude.com/en/api/agent-sdk/overview)

### GitHub Issues & Discussions
- [Issue #5891: SDK vs Subscription Auth](https://github.com/anthropics/claude-code/issues/5891) - Documentation inconsistency clarified
- [Issue #6536: OAuth Token for SDK](https://github.com/anthropics/claude-code/issues/6536) - Confirmed not supported

### Community Projects
- [ai-sdk-provider-claude-code](https://github.com/ben-vargas/ai-sdk-provider-claude-code) - Vercel AI SDK provider
- [claude-flow](https://github.com/ruvnet/claude-flow) - Multi-agent orchestration platform
- [claude-squad](https://github.com/smtg-ai/claude-squad) - Multi-agent terminal manager

### News & Analysis
- [VentureBeat: Anthropic Cracks Down](https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses)
- [Hacker News Discussion](https://news.ycombinator.com/item?id=46549823)
- [Anthropic Consumer TOS Updates](https://www.anthropic.com/news/updates-to-our-consumer-terms)

### Related TrafficControl Docs
- [Multi-Agent Orchestration (dev.to)](https://dev.to/bredmond1019/multi-agent-orchestration-running-10-claude-instances-in-parallel-part-3-29da)
- [Building Agents with Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)

---

## Conclusion

### Updated Recommendation for Single-User Architecture

For TrafficControl as a **personal orchestrator**, the recommended approach is now simplified:

**Use CLI Subprocess (Approach A) exclusively**, with optional Native Subagents for complex tasks.

#### Key Changes from Original Proposal

| Original Recommendation | Updated Recommendation |
|------------------------|------------------------|
| Hybrid routing (dev vs prod) | Single CLI adapter for everything |
| SDK fallback for production | No SDK needed |
| Complex routing logic | No routing - just use CLI |
| ~3 week implementation | ~2 week implementation |

#### Why the Simplification

1. **No public users** - There's no "production" separate from "development"
2. **Slack works in dev** - If it works with Slack integration, it works
3. **Lower TOS risk** - Personal automation is different from offering a service
4. **Less code to maintain** - One adapter instead of two
5. **Predictable costs** - $200/month flat instead of variable API costs

#### Expected Outcomes

- **Cost:** ~$200/month flat (Claude Max subscription)
- **vs API:** Potentially $1000+/month for heavy usage
- **Savings:** 80-95% depending on usage patterns
- **Implementation time:** ~2 weeks
- **Maintenance burden:** Low (single adapter)

#### Next Steps

1. Implement CLIAdapter following Phase 1 specification
2. Replace SDKAdapter calls throughout codebase
3. Test with real Slack integration
4. Optionally configure subagents for complex tasks

---

*Document updated by Claude Opus 4.5 for TrafficControl project*
*Original proposal: 2026-01-26 | Single-user update: 2026-01-26*
