### Implement Project-Specific Learning Counts in LearningStore.getStats()
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** `src/learning/learning-store.ts:201` has the only TODO in the production codebase: "Add project-specific learning counts." The `getStats()` method currently returns `projectSpecific: 0` as a hardcoded value, while global learnings are correctly counted. The learning system stores learnings per project via `tc_retrospectives` table. The fix involves querying for learnings with a non-null `project_id` and counting them, making the stats endpoint accurate for dashboard reporting.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] `LearningStore.getStats()` returns accurate `projectSpecific` count by querying learnings with non-null project_id
- [ ] The TODO comment at line 201 is removed
- [ ] `total` field equals `global + projectSpecific` (currently broken since projectSpecific is always 0)
- [ ] Existing learning tests pass without modification
- [ ] New test verifies project-specific counts are correctly returned

#### Next steps
1. Read `src/learning/learning-store.ts` to understand the current `getStats()` implementation and available Supabase queries
2. Add a query for project-specific learnings (where project_id IS NOT NULL) and count them
3. Update `projectSpecific` to use the query result instead of hardcoded 0
4. Remove the TODO comment
5. Add a test in `src/learning/learning-store.test.ts` that verifies project-specific learning counts
