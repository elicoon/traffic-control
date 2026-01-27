# Retrospective: Slack Relay Testing Gap - "It Works" vs "It Actually Works"

**Date:** 2026-01-27
**Severity:** Medium (Process Issue, Trust Impact)
**Category:** Testing, Verification, Human-AI Collaboration
**Impact:** Multiple failed iterations, user frustration, delayed feature delivery

---

## Executive Summary

During Slack Relay bot development, Claude made changes to fix the @mention requirement issue and repeatedly claimed the fixes were "working" based on passing unit tests. However, when the user tested the actual bot, it still didn't work. This happened **multiple times** in the same session. The root cause was a fundamental gap between what unit tests can verify and what the actual Slack API does in production.

---

## What Happened

### The Pattern (Repeated 3+ Times)

1. **Claude identifies the issue** - e.g., bot requires @mention to respond
2. **Claude modifies the code** - changes like removing `channel_type === 'im'` filter
3. **Claude runs unit tests** - all tests pass
4. **Claude says "it's working, you can test now"**
5. **User tests the actual bot** - still doesn't work
6. **Repeat from step 1**

### Specific Code Changes That "Passed" But Failed

**Change 1: Removing channel_type filter**
```typescript
// BEFORE - Only DMs
if (messageEvent.channel_type === 'im') {
  // handle message
}

// AFTER - All messages
// Removed the filter entirely

// Unit test: PASSED
// Real Slack: FAILED - events still not received
```

**Change 2: Adding app_mention handler**
```typescript
// Added handler
this.app.event('app_mention', async ({ event, say }) => {
  // handle mention
});

// Unit test: PASSED (handler registered correctly)
// Real Slack: FAILED - still needed event subscription in Slack config
```

### What The Unit Tests Actually Tested

Looking at `src/relay/bot.test.ts`, the tests verified:
- Logic for detecting pending setup responses
- Path detection logic (`/` or `\` characters)
- Thread vs channel message distinction

**What the tests did NOT test:**
- Whether Slack actually sends `message` events for public channels
- Whether the OAuth scopes allow reading channel messages
- Whether event subscriptions are configured in the Slack app
- What the actual event payload structure looks like from Slack
- Whether `channel_type` values match our assumptions

---

## Root Cause Analysis

### 1. Unit Tests vs Integration Tests

**The Problem:** Unit tests only verify internal logic correctness. They cannot verify:
- External API behavior
- OAuth scope requirements
- Event subscription requirements
- Network configuration
- Real-world data formats

**Evidence:** The test file `bot.test.ts` doesn't import the actual `@slack/bolt` library or make any network calls. It tests isolated logic functions.

### 2. Mocking Limitations

**The Problem:** Unit tests mock Slack's behavior based on **assumptions** about how Slack works. If those assumptions are wrong, the mocks are wrong, and the tests pass while the real thing fails.

**Example:** We assumed `message` events would fire for all messages. In reality, Slack requires:
- OAuth scope: `channels:history`
- Event subscription: `message.channels`
- App must be in the channel

None of this can be verified by mocking.

### 3. Assumptions About Slack API

**Assumptions made in code:**
| Assumption | Reality |
|------------|---------|
| `message` events fire for all messages | Only if subscribed AND scoped |
| `channel_type === 'channel'` for public channels | Actually uses `channel_type === 'C...'` (channel ID prefix) |
| Bot receives events for channels it's in | Only with correct event subscriptions |
| @mentions work via `message` event | Requires separate `app_mention` subscription |

### 4. No End-to-End Testing

**The Problem:** There's no automated way to:
- Send a real Slack message
- Verify the bot receives it
- Check the event payload structure
- Confirm the response is sent

Manual testing is the only verification method, but it was being skipped.

### 5. Overconfidence in Code Changes

**The Problem:** Claude's response pattern was:
> "I've updated the code. Unit tests pass. It should work now."

This created false confidence. "Should work" is not "verified to work."

---

## The Testing Gap

### What Unit Tests CAN Verify

- Logic functions work correctly with expected inputs
- Code doesn't throw errors with valid inputs
- Edge cases are handled
- State management is correct
- Response formatting is correct

### What Unit Tests CANNOT Verify

| Category | Specific Gap |
|----------|--------------|
| **OAuth Scopes** | `channels:history`, `im:history`, `groups:history` requirements |
| **Event Subscriptions** | `message.channels`, `message.im`, `app_mention` configuration |
| **Event Payload Structure** | Actual fields Slack sends (`channel_type`, `bot_id`, etc.) |
| **Socket Mode Behavior** | Connection establishment, reconnection, event delivery |
| **Permissions** | Bot's membership in channels, workspace permissions |
| **Rate Limits** | Slack's throttling behavior |
| **Real-World Formatting** | How @mentions, links, and formatting appear in events |

---

## Recommendations

### 1. Add Integration Tests (When Possible)

Create a test mode that can:
- Use Slack's test tokens (if available)
- Connect to a real test workspace
- Send actual messages and verify receipt
- Log actual event payloads for debugging

```typescript
// src/relay/bot.integration.test.ts
describe('RelayBot integration', () => {
  it.skip('receives message events in test channel', async () => {
    // This test requires manual setup and can't run in CI
    // But documents the expected behavior
  });
});
```

### 2. Be Explicit About Test Limitations

When unit tests pass, explicitly state what was and wasn't verified:

**Good Response:**
> "Unit tests pass. These verify the internal logic is correct. However, I cannot verify:
> - Slack event delivery works
> - OAuth scopes are sufficient
> - Event subscriptions are configured
>
> Please test the actual bot in Slack to confirm the fix."

**Bad Response:**
> "Fixed! Tests pass. You can test it now."

### 3. Add Debug Logging for Real Events

Log the actual event data received so we can see exactly what Slack sends:

```typescript
this.app.event('message', async ({ event, say }) => {
  // Log EVERYTHING on first receipt to understand the actual payload
  log.debug('RAW message event received', {
    fullEvent: JSON.stringify(event, null, 2),
  });
  // ...
});
```

### 4. Document Assumptions That Need Manual Verification

Create a section in code comments listing assumptions:

```typescript
/**
 * ASSUMPTIONS (verified by manual testing only):
 * - App has `channels:history` OAuth scope
 * - `message.channels` event is subscribed
 * - Bot is added to target channels
 * - `channel_type` is 'channel' for public channels (VERIFY THIS)
 */
```

### 5. Never Claim "Working" Without Integration Evidence

The phrase "it works" should be reserved for one of:
- An integration test passed
- Manual testing succeeded
- User confirmed functionality

For unit test-only verification, use: "internal logic verified" or "unit tests pass, manual verification needed"

---

## Checklist for Future Slack Bot Changes

### Before Making Changes
- [ ] Understand what the current code assumes about Slack events
- [ ] Check Slack API documentation for the specific event/endpoint
- [ ] Review existing OAuth scopes and event subscriptions

### After Making Changes
- [ ] Unit tests pass (internal logic verified)
- [ ] Added/updated debug logging for actual event data
- [ ] Documented which behaviors can ONLY be verified manually
- [ ] Listed required OAuth scopes for this feature
- [ ] Listed required event subscriptions for this feature

### Before Claiming "It Works"
- [ ] Clarified what "works" means (unit tests? integration? manual?)
- [ ] If unit tests only: explicitly stated manual testing is needed
- [ ] If manual testing required: asked user to verify, didn't claim success

### If User Reports It Still Doesn't Work
- [ ] Request the actual error message or behavior observed
- [ ] Ask for log output showing actual event data received
- [ ] Check if the issue is configuration (Slack app settings) vs code
- [ ] Don't immediately change code - verify assumptions first

---

## Template for Slack Fix Responses

### When Unit Tests Pass (Integration Not Verified)

```
I've made the following changes to [file]:
[Brief description of changes]

Unit tests pass, which verifies:
- [What internal logic was tested]
- [What edge cases were covered]

MANUAL VERIFICATION NEEDED:
The following cannot be tested automatically:
- [ ] Slack receives the message event (requires correct event subscriptions)
- [ ] OAuth scopes are sufficient (check app settings)
- [ ] Bot responds to [specific trigger]

Please test in Slack and let me know what you observe. If it doesn't work,
please share:
1. The exact message you sent
2. Any bot response (or lack thereof)
3. Any errors in the relay logs
```

### When Uncertain About Slack Behavior

```
I'm making an assumption here that [assumption about Slack API].
I cannot verify this with unit tests.

The change I'm making:
[Code change]

If this doesn't work, we may need to:
1. Add debug logging to see actual event payloads
2. Check Slack app configuration for [specific setting]
3. Review Slack documentation for [specific endpoint]
```

---

## Lessons Learned

1. **"Tests pass" != "It works"** - Unit tests verify internal logic, not external integrations.

2. **Slack integration requires manual verification** - OAuth scopes, event subscriptions, and permissions cannot be tested automatically.

3. **Assumptions should be explicit** - When making assumptions about external APIs, document them and flag them for manual verification.

4. **Debug logging is essential** - When dealing with external events, log the raw data to understand what's actually happening.

5. **Be humble about uncertainty** - Saying "I'm not sure if this will work - please test" is more helpful than "Fixed!"

6. **Multiple failures = step back** - After 2+ failed fixes, stop changing code and verify assumptions first.

---

## Action Items

### Immediate
- [x] Created this retrospective documenting the testing gap
- [ ] Add comprehensive debug logging to relay bot event handlers
- [ ] Document all OAuth scope and event subscription requirements in CLAUDE.md

### Short-term
- [ ] Create a Slack integration testing checklist
- [ ] Add comments to bot.ts documenting which assumptions need manual verification
- [ ] Consider creating a mock Slack server for more realistic testing

### Long-term
- [ ] Investigate Slack's testing infrastructure for integration tests
- [ ] Create a "verify in production" workflow for Slack changes
- [ ] Build a library of known Slack event payloads for more accurate mocking

---

*This retrospective documents a recurring pattern where unit test confidence led to false claims of functionality. The gap between "code logic is correct" and "integration actually works" must be made explicit in future Slack-related work.*
