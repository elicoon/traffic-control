### Make RecommendationEngine Analysis Thresholds Configurable via Constructor
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The RecommendationEngine in `src/reporter/recommendation-engine.ts` uses hardcoded thresholds: BLOCKED_TASKS_THRESHOLD=1, HIGH_VELOCITY_THRESHOLD=5, LOW_OPUS_UTILIZATION_THRESHOLD=25, HIGH_BLOCKED_SYSTEM_THRESHOLD=5. These constants are appropriate defaults but prevent customization per deployment or project size. Making them injectable via the constructor (with current values as defaults) enables tuning without code changes. The engine is already a pure-logic module with no I/O, making this a clean refactor.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] RecommendationEngine constructor accepts an optional `thresholds` config object
- [ ] All four hardcoded thresholds are replaced with instance properties that fall back to current defaults
- [ ] Existing tests pass without modification (proving backwards compatibility)
- [ ] New test verifies that custom thresholds change analysis behavior (e.g., setting BLOCKED_TASKS_THRESHOLD=3 means 2 blocked tasks no longer triggers a warning)
- [ ] TypeScript interface `RecommendationThresholds` is exported for external configuration

#### Next steps
1. Read `src/reporter/recommendation-engine.ts` to locate the four threshold constants
2. Define `RecommendationThresholds` interface with all four fields as optional
3. Add optional thresholds parameter to constructor, merge with defaults
4. Replace constant references with `this.thresholds.X`
5. Add test case that overrides one threshold and verifies changed behavior
