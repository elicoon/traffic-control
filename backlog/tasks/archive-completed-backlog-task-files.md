### Archive 12 Completed Backlog Task Files to backlog/tasks/done/
- **Project:** traffic-control
- **Status:** not started
- **Priority:** medium
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** 12 of 40 backlog task files have Status=done but remain in backlog/tasks/ alongside actionable items. This clutters automated scans (product-strategist, scoper, handler) and makes it harder to see remaining work at a glance. Moving completed files to backlog/tasks/done/ follows the same archive pattern used in dev-org's dispatch files.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Directory `backlog/tasks/done/` exists
- [ ] All 12 files with `Status: done` are moved to `backlog/tasks/done/`
- [ ] No files with `Status: not started` or other active statuses are moved
- [ ] The moved files retain their original content unchanged
- [ ] Backlog scanner (markdown-importer) still functions correctly with the new structure

#### Next steps
1. Run `grep -l 'Status.*done' backlog/tasks/*.md` to get the exact list of done files
2. Create `backlog/tasks/done/` directory
3. Move each done file: `git mv backlog/tasks/<file> backlog/tasks/done/`
4. Verify the markdown-importer doesn't break (check if it scans subdirectories)
5. Commit the move
