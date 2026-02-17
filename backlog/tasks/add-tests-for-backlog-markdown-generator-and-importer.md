### Add Unit Tests for Backlog Markdown Generator and Importer
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The backlog/ directory has only 3 of 6 modules tested (validator, backlog-manager, and one other). markdown-generator.ts and markdown-importer.ts have zero test coverage. These modules handle serialization of backlog proposals to/from markdown files, which is critical for the backlog workflow. Bugs in parsing or generation could silently corrupt proposal data.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] markdown-generator.test.ts exists with tests covering: proposal-to-markdown conversion, edge cases (missing fields, special characters in titles), and multi-proposal batch generation
- [ ] markdown-importer.test.ts exists with tests covering: markdown-to-proposal parsing, malformed markdown handling, round-trip fidelity (generate then import produces equivalent data)
- [ ] All new tests pass (`npm run test`)
- [ ] Build passes (`npm run build`)

#### Next steps
1. Read src/backlog/markdown-generator.ts and src/backlog/markdown-importer.ts to understand the public API and edge cases
2. Create src/backlog/markdown-generator.test.ts with tests for normal generation, missing optional fields, and special characters
3. Create src/backlog/markdown-importer.test.ts with tests for normal parsing, malformed input, and round-trip consistency
4. Run the test suite to confirm all pass
