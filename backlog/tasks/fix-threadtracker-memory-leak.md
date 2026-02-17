### Fix ThreadTracker Memory Leak from Unremoved Resolved Threads
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** ThreadTracker in src/slack/thread-tracker.ts accumulates resolved threads indefinitely without cleanup, causing memory growth over time. Each Slack thread that gets resolved stays in memory forever. Under sustained operation (weeks/months), this will cause memory pressure. The fix is straightforward: add TTL-based expiration for resolved threads with periodic cleanup.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] ThreadTracker has configurable TTL parameter for resolved threads (default: 1 hour)
- [ ] Periodic cleanup mechanism removes resolved threads older than TTL
- [ ] Unit tests verify resolved threads are removed after TTL expires
- [ ] Unit tests verify active threads are never removed regardless of age
- [ ] Memory usage remains stable under sustained load (test with 1000+ thread lifecycle operations)

#### Next steps
1. Read src/slack/thread-tracker.ts to understand current storage mechanism
2. Add `resolvedThreadTTL` config parameter (milliseconds)
3. Track resolution timestamp when threads are marked resolved
4. Implement cleanup method that removes expired resolved threads
5. Add setInterval-based periodic cleanup (run every 15 minutes)
6. Write unit tests for TTL expiration and cleanup behavior
