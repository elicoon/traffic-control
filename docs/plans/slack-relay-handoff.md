# Slack Claude Relay - FIXED ✅

**Date:** 2026-01-27
**Status:** WORKING

---

## Resolution Summary

The Slack Claude Relay is now fully functional. Two bugs were found and fixed:

### Bug 1: Shell Argument Escaping
**Problem:** Messages with special characters (?, *, etc.) were being interpreted by the shell.
**Cause:** Using `shell: true` without quoting the message argument.
**Fix:** Added `escapeShellArg()` function to wrap the message in double quotes.

```typescript
function escapeShellArg(arg: string): string {
  const escaped = arg.replace(/"/g, '""');
  return `"${escaped}"`;
}
```

### Bug 2: API Key Causing Wrong Billing Mode
**Problem:** Claude CLI returned "Credit balance is too low" instead of using Max subscription.
**Cause:** `ANTHROPIC_API_KEY` in `.env` was being passed to the child process, causing Claude CLI to use API billing instead of the Max subscription.
**Fix:** Exclude `ANTHROPIC_API_KEY` and `CI` from the child process environment.

```typescript
const childEnv = { ...process.env };
delete childEnv.ANTHROPIC_API_KEY;
delete childEnv.CI;
```

---

## Files Modified

### `src/relay/handler.ts`
1. Added `escapeShellArg()` function (line ~356)
2. Updated `buildCLIArgs()` to quote the message argument
3. Updated spawn to exclude `ANTHROPIC_API_KEY` and `CI` from child env (line ~460)

---

## Testing

After fixes, the relay:
- ✅ Receives messages from Slack
- ✅ Spawns Claude CLI correctly
- ✅ Captures stdout/stderr events
- ✅ Uses Max subscription (not API billing)
- ✅ Returns responses to Slack
- ✅ All 1681 tests pass

---

## How to Use

1. Start the relay:
   ```bash
   npm run relay
   ```

2. Send a message to the bot in Slack (in a channel where it's been invited)

3. If this is a new channel, the bot will ask for the project directory

4. The bot will relay your message to Claude CLI and post the response

---

## Original Problem (SOLVED)

The original issue was that CLI spawn hung with no stdout events. This was actually **two separate issues**:

1. The message was being corrupted by shell interpretation (only first word was sent)
2. Claude CLI was using API billing due to `ANTHROPIC_API_KEY` in the environment

Both issues made it appear that the spawn was hanging, when in fact:
- Claude was responding, but to a truncated message
- Claude was responding with "Credit balance is too low" due to wrong billing mode

---

## Retrospective

See `learnings/2026-01-27-slack-relay-testing-gap.md` for lessons learned.

Key insight: The "spawn hanging" symptom was actually two unrelated bugs causing misleading error messages. Systematic debugging (capturing full stdout, testing each variable in isolation) was essential to finding the root causes.
