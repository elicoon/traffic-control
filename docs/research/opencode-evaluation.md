# OpenCode Evaluation: Offline Claude Code Integration

**Date:** 2026-03-01
**Status:** Research complete
**Unblocks:** Stream C (OpenCode customization) and Stream E (local provider scaffold)

---

## Section 1: OpenCode Provider API

### What OpenCode Is

OpenCode (github.com/sst/opencode, now anomalyco/opencode) is a TypeScript/Bun-based AI coding
agent. The project forked in 2025: the SST/Anomalyco fork rewrote in TypeScript using the Vercel
AI SDK; the original Go-based fork continued as "Crush" by Charm. The TypeScript fork is the one
with 48K+ stars and active development — this evaluation covers that version.

### Non-Interactive Mode

`opencode run` is the non-interactive equivalent of `claude -p`:

```bash
# Basic non-interactive run
opencode run "Fix the bug in src/scheduler/types.ts"

# JSON event stream on stdout (preferred for machine parsing)
opencode run --format json "Fix the bug in src/scheduler/types.ts"

# Attach to a warm server to avoid cold-start latency
opencode serve &                                  # start headless server once
opencode run --attach http://localhost:4096 "..."  # subsequent runs are fast
```

`opencode run` exits when the session completes. All tool permissions are auto-approved (equivalent
to `--dangerously-skip-permissions`). The `--format json` flag emits newline-delimited JSON events:

```json
{"type":"message.part.updated","part":{"type":"tool","name":"Read","state":"running"}}
{"type":"message.part.updated","part":{"type":"tool","name":"Read","state":"completed"}}
```

This is NOT equivalent to Claude CLI's `stream-json` format — it uses different event types and
does not emit a final `{"type":"result","subtype":"success"}` terminal event.

### Ollama Provider Configuration

Config lives at `~/.config/opencode/opencode.json` (global) or `./opencode.json` (project-local):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "local-qwen": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Qwen3-Coder (local)",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": {
        "qwen3-coder:30b-a3b": {
          "name": "Qwen3-Coder 30B A3B"
        }
      }
    }
  }
}
```

OpenCode uses the Vercel AI SDK under the hood. The `@ai-sdk/openai-compatible` package sends
tools in **OpenAI JSON format** (`tool_calls: [{id, type, function: {name, arguments}}]`), not
Anthropic format. This is the proximate cause of the Qwen3-Coder tool call issues (Section 2).

### MCP Server Configuration

OpenCode supports MCP servers in the same `opencode.json`:

```json
{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]
    },
    "supabase": {
      "type": "local",
      "command": ["node", "/path/to/supabase-mcp-server.js"],
      "environment": { "SUPABASE_URL": "...", "SUPABASE_KEY": "..." }
    }
  }
}
```

MCP servers are defined globally or per-project. There is no per-invocation flag to override
the config file path, so TC workers would need either a per-project `opencode.json` or a
shared global config.

---

## Section 2: Qwen3-Coder Tool-Calling Compatibility

### The Core Problem

Qwen3-Coder uses **XML-style function calling** natively:

```xml
<tool_call>
<function=read_file>
<parameter=path>src/agent/manager.ts</parameter>
</function>
</tool_call>
```

OpenCode sends tools to the model in **OpenAI JSON schema** and expects OpenAI JSON responses.
This format mismatch causes tool calls to fail silently or produce validation errors.

### Confirmed Issues (from GitHub tracker)

| Issue | Symptom | Affected Setup |
|-------|---------|----------------|
| [#1809](https://github.com/sst/opencode/issues/1809) | `qwen3-coder:30b-a3b` cannot call any tool | All OpenCode setups |
| [#6918](https://github.com/anomalyco/opencode/issues/6918) | edit tool fails; `Expected string, received object` | OpenCode + OpenRouter |
| [#4255](https://github.com/anomalyco/opencode/issues/4255) | Hangs indefinitely with LM Studio; empty `tool_calls: []` arrays | LM Studio + Ollama |
| [#10855](https://github.com/anomalyco/opencode/issues/10855) | Tool call metadata printed to chat instead of executed | OpenCode Zen |
| [lmstudio-ai/lmstudio-bug-tracker#825](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/825) | XML passed instead of JSON to agents | All agents |

### The Fix (vLLM only)

vLLM has an official tool-call parser for Qwen3-Coder that bridges the format gap:

```bash
vllm serve Qwen/Qwen3-Coder-30B-A3B-Instruct \
  --port 8000 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder
```

This parser intercepts the model's XML output and converts it to OpenAI JSON before returning to
the client. When using this flag, OpenCode receives well-formed tool calls.

**Ollama does NOT support custom tool parsers.** Ollama has no equivalent to `--tool-call-parser`.
This means `qwen3-coder:30b-a3b` via Ollama will have unreliable or broken tool calling with
OpenCode regardless of configuration.

### Workarounds Without vLLM

1. **llama.cpp with autoparser branch** — community PR that resolves both tool call issues and
   segfaults; as of 2026-02-17 confirmed working with OpenCode
2. **Proxy patches** — `qwen3-call-patch-proxy` intercepts XML responses and converts to JSON
3. **Unsloth GGUF quants** — specific quantizations with fixed chat templates (updated 2025-08-05)
   show better tool calling than stock AWQ quants
4. **LM Studio beta** — latest beta with Qwen's official Jinja template configured

### Summary Verdict

**Qwen3-Coder:30b-a3b + OpenCode via Ollama: not recommended.** Tool calling is broken without a
custom parser, and Ollama doesn't support one. vLLM with `--tool-call-parser qwen3_coder` is the
only production-grade path. The implementation plan's Phase 1 (Ollama for development testing) is
incompatible with this model for agentic use.

---

## Section 3: TrafficControl Integration Points

### Current Spawn Mechanism

TC has two adapters implementing `IAgentAdapter` (`src/agent/sdk-adapter.ts`):
- **SDKAdapter** — uses `@anthropic-ai/claude-agent-sdk` directly (API key mode)
- **CLIAdapter** — spawns `claude --print --output-format stream-json` (subscription/CLI mode)

`CLIAdapter` in `src/agent/cli-adapter.ts:175-321` is the closest analog to what an OpenCode
adapter would need: spawn a process, parse stdout lines as JSON events, handle termination.

### Files Requiring Changes

| File | Change | Effort |
|------|--------|--------|
| `src/scheduler/types.ts:14` | Add `\| 'local'` to `ModelType` union | Trivial |
| `src/agent/adapter-factory.ts:22-27` | Add `'local'` to `AgentMode`; add `local-qwen` detection | Small |
| `src/agent/adapter-factory.ts:67-77` | Add branch to return `OpenCodeAdapter` when mode is `local` | Small |
| `src/agent/opencode-adapter.ts` | New file implementing `IAgentAdapter`; mirrors `CLIAdapter` structure but parses OpenCode JSON events | Medium |
| `src/agent/types.ts` | Update `AgentConfig.model` to accept `'local'` | Trivial |

### The New Adapter Contract

`OpenCodeAdapter.startQuery()` would:
1. Spawn: `opencode run --format json "<prompt>"` in `config.cwd`
2. Parse stdout lines as `{"type":"message.part.updated",...}` events
3. Map OpenCode event types → `AgentEvent` types (`question`, `tool_call`, `completion`, `error`)
4. Return an `ActiveCLIQuery`-like object with `close()` via SIGTERM

Key difference from `CLIAdapter`: the output format schema differs. TC's `mapToAgentEvent` logic
in `cli-adapter.ts:342-432` must be rewritten for OpenCode's event vocabulary.

### MCP Server Wiring

TC workers currently get tool access via Claude Code's built-in tools (filesystem, git) and the
`bypassPermissions` mode. With OpenCode, tools come from MCP servers. Each worker session would
need a project-local `opencode.json` in the task's working directory, or TC must write a temp
config per invocation. The supabase MCP server TC workers use would need to be ported to the MCP
`local` server format.

### Capacity Tracking

`src/scheduler/capacity-tracker.ts` tracks `opus`, `sonnet`, `haiku` session counts against
Claude's weekly limits. Local inference has no such limits — the capacity model for `'local'`
type should be hardware-bound (GPU utilization), not quota-bound.

---

## Section 4: Open Questions

These must be resolved before starting implementation:

1. **Does `opencode run --format json` emit a reliable terminal event?**
   The JSON event stream has no documented "session complete" signal analogous to Claude CLI's
   `{"type":"result","subtype":"success"}`. TC needs to know definitively when a worker is done.
   GitHub issue [#2449](https://github.com/sst/opencode/issues/2449) asks for `stream-json`
   parity; status unclear. Must test empirically before writing the adapter.

2. **Does `opencode run` exit with a meaningful exit code?**
   Known issue [#752](https://github.com/sst/opencode/issues/752): errors on `opencode run` are
   silently hidden. TC's `CLIAdapter` relies on exit code 0 = success. If OpenCode always exits 0,
   error detection must come from parsing the event stream, which requires a known error event type.

3. **Can config be supplied per-invocation (not global)?**
   TC workers run in different project directories with different MCP needs. If `opencode.json`
   can only be set globally at `~/.config/opencode/opencode.json`, multiple concurrent workers
   would share config, which breaks per-project MCP server configuration. There is a `--config`
   flag mentioned in some issue comments but not documented officially.

4. **Is `opencode serve` + `--attach` required for production use?**
   Cold boot time per `opencode run` invocation is unknown. If each invocation spins up MCP
   servers from scratch (e.g., 2-5 seconds), that's acceptable. If it's 30+ seconds, the
   `opencode serve` + `--attach` pattern is required, which adds an always-on process TC must
   manage per local model.

5. **Is vLLM the mandatory inference backend for reliable tool calling?**
   Ollama is ruled out for Qwen3-Coder (no tool parser support). vLLM's `--tool-call-parser
   qwen3_coder` is the only confirmed working path. This means Phase 1 of the implementation
   plan (Ollama for development) needs to be reconsidered — either use a different model with
   Ollama (Qwen2.5-Coder-7B has better OpenAI-format tool calling) or go straight to vLLM.

---

## Recommendation Summary

OpenCode **can** serve as a `claude -p` replacement for TC workers with the following conditions:
- **Inference backend**: vLLM with `--tool-call-parser qwen3_coder` (not Ollama)
- **New adapter**: `OpenCodeAdapter` needed in TC (mirrors `CLIAdapter` structure, ~150 LOC)
- **Config strategy**: per-project `opencode.json` or per-invocation `--config` flag (verify first)
- **Resolve before coding**: Questions 1 and 2 above require empirical testing with `opencode run`

The integration is feasible but not plug-and-play. Estimate: 2–3 days of focused work after
open questions are resolved, not 2 weeks as budgeted in Stream E.
