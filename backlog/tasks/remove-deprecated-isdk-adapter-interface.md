### Remove Deprecated ISDKAdapter Interface and Migrate Consumers to IAgentAdapter
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The `ISDKAdapter` interface in `src/agent/sdk-adapter.ts:171` is marked `@deprecated` with a note to "Use IAgentAdapter for new code." It extends `IAgentAdapter` with no additional members, making it a pure alias. Any consumers still referencing `ISDKAdapter` should switch to `IAgentAdapter` directly, and then the deprecated interface should be removed entirely. This is the only deprecated API in the codebase and removing it keeps the type surface clean.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] All imports of `ISDKAdapter` across the codebase are replaced with `IAgentAdapter`
- [ ] The `ISDKAdapter` interface is deleted from `src/agent/sdk-adapter.ts`
- [ ] `ISDKAdapter` is removed from the barrel export in `src/agent/index.ts` (if exported)
- [ ] `npm run build` succeeds with no type errors
- [ ] `npm test` passes with no failures

#### Next steps
1. Search for all references to `ISDKAdapter` in the codebase: `grep -r "ISDKAdapter" src/`
2. Replace each import/reference with `IAgentAdapter`
3. Delete the `ISDKAdapter` interface definition from `src/agent/sdk-adapter.ts`
4. Remove from any barrel exports
5. Run `npm run build && npm test` to verify
