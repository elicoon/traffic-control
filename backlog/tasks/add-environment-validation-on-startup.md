### Add Environment Variable Validation on Startup
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** TrafficControl requires multiple environment variables (ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, Slack tokens) but doesn't validate them on startup. The system currently fails at runtime when trying to use missing variables, leading to cryptic errors instead of clear startup failures. The .env.example lists 20+ variables, some required and some optional, but there's no programmatic check. A preflight environment validator would fail fast with a clear message listing missing/invalid variables.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] Create src/config/env-validator.ts with validation logic
- [ ] Validate required variables (ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY)
- [ ] Validate optional variables have correct format (e.g., SLACK_CHANNEL_ID starts with C)
- [ ] validateEnv() called in src/index.ts before starting orchestrator
- [ ] Missing required variables cause immediate process.exit(1) with clear error message
- [ ] Invalid optional variables log warnings but don't block startup
- [ ] Add 10+ tests for validation logic (missing vars, invalid format, all valid)

#### Next steps
1. Create src/config/env-validator.ts with validateEnv() function
2. Define required vs optional variables (reference .env.example)
3. Add format validators for each variable type (URL, token prefix, integer)
4. Call validateEnv() in src/index.ts before orchestrator.start()
5. Write tests for all validation scenarios
