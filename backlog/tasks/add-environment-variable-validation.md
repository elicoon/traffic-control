### Add Environment Variable Validation at Startup
- **Project:** TrafficControl
- **Status:** not started
- **Priority:** high
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Currently the orchestrator starts up and may fail deep in execution when a required env var is missing. This wastes time and creates confusing error messages. Need startup validation that fails fast with clear messages about what's missing.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] All required environment variables are validated before orchestrator starts
- [ ] Missing required vars cause immediate startup failure with clear error message listing what's missing
- [ ] Optional vars with defaults show warning log if not set
- [ ] Validation covers: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, all Slack tokens
- [ ] Unit tests verify validation catches missing/invalid values

#### Next steps
1. Create `src/config/env-validator.ts` with validation logic
2. Call validator in `src/index.ts` before initializing orchestrator
3. Add unit tests in `src/config/env-validator.test.ts`
4. Test startup with missing env vars to verify error messages
