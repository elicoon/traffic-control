### Add Unit Tests for RelayHandler CLI Spawning and JSON Streaming
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** src/relay/handler.ts is 698 lines handling Claude CLI spawning, streaming JSON output parsing, session ID extraction, progress update callbacks, error classification, and response chunking for Slack's 4000-char limit. It has 0 test coverage. The relay bot.ts and project-store.ts have tests, but the handler — the core execution path — does not. Key untested behaviors: process spawn argument construction, JSON stream parsing, session ID extraction from streamed output, timeout handling, error classification (CLI not found, auth needed, etc.), and response chunking.
- **Added:** 2026-02-14
- **Updated:** 2026-02-14

#### Acceptance Criteria
- [ ] Tests cover CLI argument construction with correct flags (--print, --stream-json, --verbose)
- [ ] Tests verify streaming JSON output parsing handles partial chunks and malformed JSON
- [ ] Tests verify session ID extraction from valid streamed output
- [ ] Tests cover error classification for at least 3 error types (CLI not found, auth needed, timeout)
- [ ] Tests verify response chunking respects Slack's 4000-character limit
- [ ] Tests cover timeout behavior and process cleanup
- [ ] All tests pass (`npm test`)

#### Next steps
1. Read `src/relay/handler.ts` to catalog all public methods and error paths
2. Create `src/relay/handler.test.ts` with vitest mocks for `child_process.spawn`
3. Test the JSON streaming parser with various input shapes (complete messages, partial chunks, errors)
4. Test error classification logic with mock process exit codes and stderr output
5. Run `npm test` to verify
