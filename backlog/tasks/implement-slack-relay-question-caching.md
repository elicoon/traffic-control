### Implement Slack Relay Question Caching to Reduce User Blocking
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Relay module routes agent questions to Slack and waits for human responses. This creates blocking delays when agents ask similar questions repeatedly. Handler-state shows ongoing workforce testing with QE and user-tester roles — these roles will generate repeated questions as they iterate. HYPERVELOCITY Component 3 (Question Knowledge Base) proposes auto-answering when similarity >= 0.85. Start with simpler exact-match caching for MVP: cache question-answer pairs per project, check for exact matches before posting to Slack, track hit rate to validate approach before investing in similarity matching.
- **Added:** 2026-02-17
- **Updated:** 2026-02-17

#### Acceptance Criteria
- [ ] QuestionCache stores Q&A pairs keyed by (project_id, question_text)
- [ ] Before posting to Slack, check cache for exact match on normalized question text
- [ ] On cache hit, return cached answer immediately and log hit metric
- [ ] On cache miss, post to Slack as normal and store answer when received
- [ ] Cache metrics (hit_rate, total_questions, cached_questions) exposed via CLI or dashboard
- [ ] Integration test confirms cache hit avoids Slack post

#### Next steps
1. Create `src/relay/question-cache.ts` with in-memory Map storage
2. Add normalization function (lowercase, trim, remove punctuation) for question matching
3. Wire cache check into RelayHandler before Slack post
4. Add cache population when Slack answer received
5. Add tc_cached_questions table for persistence across restarts
6. Expose cache stats in dashboard API at /api/relay/cache-stats
