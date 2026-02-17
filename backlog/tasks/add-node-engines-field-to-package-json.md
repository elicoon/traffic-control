### Add Node.js Engines Field to package.json
- **Project:** traffic-control
- **Status:** not started
- **Priority:** low
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** package.json has no `engines` field, which means contributors and CI have no guidance on required Node.js version. The project uses ESM with `--moduleResolution node16`, TypeScript 5.x, and modern Node APIs. Adding the engines field prevents "works on my machine" issues and documents the minimum supported version. This also enables npm's `engine-strict` check in CI.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] package.json contains `"engines": { "node": ">=20.0.0" }` (or the correct minimum based on features used)
- [ ] `npm run build` and `npm run test` still pass after the change
- [ ] .npmrc contains `engine-strict=true` to enforce the constraint during `npm install`

#### Next steps
1. Check which Node.js APIs are used (e.g., `node:` prefix imports, fetch, structuredClone) to determine minimum version
2. Add `"engines": { "node": ">=20.0.0" }` to package.json
3. Create `.npmrc` with `engine-strict=true`
