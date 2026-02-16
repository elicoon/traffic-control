### Upgrade @anthropic-ai/claude-agent-sdk from 0.2.19 to Latest
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The claude-agent-sdk is 25 minor versions behind (0.2.19 installed, 0.2.44 latest). The SDK is used in src/agent/sdk-adapter.ts for spawning and managing Claude Code agent sessions. Being this far behind risks missing bug fixes, API changes that could break the integration later, and new features that could simplify the adapter code. The upgrade scope is small because the SDK surface area used is narrow (session creation, message streaming, usage extraction).
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] package.json updated to latest claude-agent-sdk version
- [ ] `npm install` succeeds with no peer dependency conflicts
- [ ] `npm run build` compiles without type errors against the new SDK types
- [ ] All existing sdk-adapter tests pass (`npm test -- src/agent/sdk-adapter.test.ts`)
- [ ] Full test suite passes (`npm test`)

#### Next steps
1. Run `npm info @anthropic-ai/claude-agent-sdk versions` to confirm latest available version
2. Read the SDK changelog or release notes for breaking changes between 0.2.19 and latest
3. Run `npm install @anthropic-ai/claude-agent-sdk@latest`
4. Fix any TypeScript compilation errors in src/agent/sdk-adapter.ts
5. Run the full test suite and fix any broken tests
