### Add Unit Tests for RecommendationEngine Scoring Algorithm
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** RecommendationEngine (src/reporter/recommendation-engine.ts) is at 72.3% coverage with gaps in edge case testing for scoring algorithm and threshold behavior. Lines 234-277 are untested — likely covering edge cases in urgency scoring, cost-effectiveness calculation, or threshold-based recommendations. This is the intelligence layer that decides which tasks to prioritize, so edge cases (tied scores, zero cost tasks, negative urgency) must be handled correctly.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Test coverage for recommendation-engine.ts reaches >= 90% statement coverage
- [ ] Tests cover edge case: multiple tasks with identical scores (deterministic ordering)
- [ ] Tests cover edge case: task with zero estimated cost (doesn't cause division by zero)
- [ ] Tests cover edge case: task with negative urgency score (handled gracefully)
- [ ] Tests cover threshold behavior: tasks just above threshold are recommended
- [ ] Tests cover threshold behavior: tasks just below threshold are not recommended
- [ ] All new tests pass (`npm test`)

#### Next steps
1. Read src/reporter/recommendation-engine.ts focusing on lines 234-277
2. Read existing recommendation-engine.test.ts to understand current test patterns
3. Create edge case tests for scoring algorithm (tied scores, zero cost, negative urgency)
4. Create threshold boundary tests (at threshold, above threshold, below threshold)
5. Run `npm run test:coverage` to verify coverage increase to >= 90%
