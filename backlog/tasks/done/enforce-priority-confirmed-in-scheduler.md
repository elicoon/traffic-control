### Enforce priority_confirmed Validation in Scheduler Before Task Assignment
- **Project:** traffic-control
- **Status:** done
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** CLAUDE.md explicitly requires that `priority_confirmed` must be `true` before any task is scheduled, but the Scheduler and TaskQueue do not validate this field. Tasks with `priority_confirmed = false` can currently be dequeued and assigned to agents without user approval. This violates the safety requirements added after the $40+ cost burn incident. The fix is a single filter check in TaskQueue.getNextTask() that rejects unconfirmed tasks.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] TaskQueue.getNextTask() skips tasks where `priority_confirmed` is not `true`
- [ ] A warning is logged when an unconfirmed task is encountered in the queue
- [ ] Existing tests pass and at least 2 new tests verify the filter behavior (one confirmed task scheduled, one unconfirmed task skipped)
- [ ] `npm run build` and `npm test` pass

#### Next steps
1. Read `src/scheduler/task-queue.ts` to find where tasks are dequeued and identify the insertion point for the filter
2. Add a `priority_confirmed` check that skips tasks where the field is falsy
3. Add a log.warn call when skipping unconfirmed tasks
4. Add tests in `src/scheduler/task-queue.test.ts` for confirmed and unconfirmed task scenarios
5. Run `npm test` and `npm run build` to verify
