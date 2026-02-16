### Add GitHub Actions CI Pipeline for Build and Test Verification
- **Project:** traffic-control
- **Status:** not started
- **Priority:** high
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** No CI/CD configuration exists — no .github/workflows, no .circleci, no other CI config. The project has 2044 passing tests and a clean TypeScript build, but all verification runs locally only. Given the project's history with a $40+ cost-burn incident and the safety-critical nature of the orchestrator, automated regression detection on push/PR is essential. This is a standard GitHub Actions setup with no special infrastructure requirements.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] `.github/workflows/ci.yml` exists and runs on push to master and on pull requests
- [ ] CI job runs `npm ci`, `npm run build`, and `npm test` on ubuntu-latest with Node 20
- [ ] CI passes on the current master branch (verify by pushing and checking the Actions tab)
- [ ] PR #3 (dashboard costs refactor) shows CI status check

#### Next steps
1. Create `.github/workflows/ci.yml` with a single job: checkout, setup-node (v20), npm ci, npm run build, npm test
2. Push to master and verify the workflow runs and passes in the GitHub Actions tab
3. Confirm PR #3 picks up the new CI check automatically
