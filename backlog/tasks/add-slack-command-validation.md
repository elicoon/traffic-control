### Add Input Validation to SlackCommandHandler DND Duration
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** SlackCommandHandler in src/slack/command-handler.ts accepts DND (do-not-disturb) duration parameters without validation. Users could set absurdly long DND periods (e.g., 999999 hours) or negative values, causing undefined behavior. This is a security/reliability gap. Add max duration validation (24-hour ceiling recommended) with clear error messages for invalid inputs.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] DND duration is validated before state changes are applied
- [ ] Maximum duration is 24 hours (86400000 milliseconds)
- [ ] Minimum duration is 1 minute (60000 milliseconds)
- [ ] Invalid durations return helpful error message to Slack (e.g., "Duration must be between 1 minute and 24 hours")
- [ ] Unit tests cover: valid duration (accepted), too long (rejected), too short (rejected), negative value (rejected), non-numeric value (rejected)

#### Next steps
1. Read src/slack/command-handler.ts to locate DND command parsing logic
2. Add validation function validateDNDDuration(milliseconds: number): boolean
3. Check duration is >= 60000 (1 minute) and <= 86400000 (24 hours)
4. Return error response to Slack if validation fails
5. Add unit tests for all edge cases
6. Update SLACK_SETUP.md to document DND duration limits
