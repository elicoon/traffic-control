### Add Vitest Coverage Reporting to Measure Actual Line Coverage
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The project has 2048+ tests and 103% test-to-source LOC ratio, but no coverage reporting is configured. vitest.config.ts has no coverage settings, and there's no CI step that measures line/branch/function coverage. Adding vitest's built-in coverage provider (v8 or istanbul) would provide visibility into which code paths are actually tested vs. which files just have test files. This is especially valuable given recent rapid feature additions — coverage metrics would highlight untested paths in new analytics, safety, and orchestrator code.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] `vitest.config.ts` includes coverage configuration with v8 or istanbul provider
- [ ] `npm run test:coverage` script added to package.json that runs tests with coverage
- [ ] Coverage report is generated in a `coverage/` directory (added to .gitignore)
- [ ] Running `npm run test:coverage` succeeds and outputs a coverage summary to stdout

#### Next steps
1. Install `@vitest/coverage-v8` as a dev dependency
2. Add coverage configuration to `vitest.config.ts` with reporter types (text, html)
3. Add `test:coverage` script to package.json: `vitest run --coverage`
4. Add `coverage/` to .gitignore
5. Run `npm run test:coverage` and verify output
