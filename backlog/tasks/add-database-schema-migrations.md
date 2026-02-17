### Add Database Schema Migration Management System
- **Project:** TrafficControl
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Database schema is currently managed manually via SQL snippets in README and CLAUDE.md. As the project evolves, schema changes will need to be tracked, versioned, and applied consistently. Need a migration system to manage schema evolution safely.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Migration system tracks applied migrations in tc_schema_migrations table
- [ ] Migration files are numbered/timestamped (e.g., 001-initial-schema.sql, 002-add-priority-confirmed.sql)
- [ ] CLI command or startup check applies pending migrations automatically
- [ ] Migrations run in transaction (rollback on failure)
- [ ] Current schema is captured as migration 001 (baseline)
- [ ] Documentation updated with migration workflow

#### Next steps
1. Create tc_schema_migrations table for tracking applied migrations
2. Create migrations/ directory with 001-baseline.sql containing current schema
3. Add migration runner in src/db/migrations.ts
4. Add CLI command: npm run migrate
5. Add unit tests for migration runner
6. Document migration workflow in docs/DATABASE.md
