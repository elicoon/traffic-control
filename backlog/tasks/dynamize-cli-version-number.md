### Dynamize CLI Version Number from package.json
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** CLI version number is hardcoded somewhere in the CLI code (likely bin/trafficcontrol.ts or src/cli/). This creates a maintenance burden — version must be updated in two places (package.json and CLI code) for every release. Single source of truth principle: read version dynamically from package.json at runtime. Node.js supports importing package.json as JSON module.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] CLI `--version` flag displays version read from package.json
- [ ] No hardcoded version strings remain in CLI code (verified via grep)
- [ ] Unit test verifies version matches package.json version
- [ ] Version display works correctly when CLI is run via `npm run cli` and via installed binary
- [ ] Build passes (`npm run build`)

#### Next steps
1. Grep for hardcoded version strings: `grep -r "version.*1\\.0" bin/ src/cli/`
2. Import package.json as JSON module: `import pkg from '../../package.json' assert { type: 'json' };`
3. Replace hardcoded version with `pkg.version`
4. Add unit test that compares CLI reported version to package.json version
5. Run `npm run build && npm run cli -- --version` to verify
