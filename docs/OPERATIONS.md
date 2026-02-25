# TrafficControl Operations Guide

Manual operational health checks, expected log patterns, failure modes, and remediation steps for the TrafficControl orchestrator.

> **Scope:** This guide covers manual operational checks only. It does not cover automated alerting, Grafana/Prometheus integration, or SLA definitions.

---

## Quick Health Check

Run these in order to verify the orchestrator is operating correctly:

1. **Process running?** Check for the Node.js process:
   ```bash
   ps aux | grep traffic-control
   # or if using npm:
   ps aux | grep "npm run start"
   ```

2. **Recent log output?** Tail the logs and look for tick activity:
   ```bash
   # If running in foreground:
   # Look for "[MainLoop] Scheduled task" or "[MainLoop] Orchestration loop started"
   # Silence (no log output) = something is wrong
   ```

3. **Database reachable?**
   ```sql
   SELECT 1 AS health_check;
   ```

4. **Tasks being processed?** Check for recent status changes:
   ```sql
   SELECT id, title, status, updated_at
   FROM tc_tasks
   WHERE updated_at > now() - interval '1 hour'
   ORDER BY updated_at DESC
   LIMIT 10;
   ```

5. **Agents active?** Check for recent sessions:
   ```sql
   SELECT id, task_id, status, model, created_at
   FROM tc_agent_sessions
   WHERE created_at > now() - interval '1 hour'
   ORDER BY created_at DESC
   LIMIT 5;
   ```

If any of these fail, jump to [Common Issues & Remediation](#common-issues--remediation).

---

## SQL Health Queries

### Task Status Distribution

Overall view of where tasks are in the pipeline:

```sql
SELECT status, COUNT(*) AS total
FROM tc_tasks
GROUP BY status
ORDER BY total DESC;
```

### Queued Tasks Awaiting Scheduling

```sql
SELECT id, title, priority, priority_confirmed, created_at
FROM tc_tasks
WHERE status = 'queued'
ORDER BY priority DESC
LIMIT 20;
```

### Unconfirmed Priorities (Blocks Scheduling)

Tasks without confirmed priorities will **not** be scheduled. This query must return 0 rows for normal operation:

```sql
SELECT id, title, priority
FROM tc_tasks
WHERE status = 'queued'
  AND (priority_confirmed IS NULL OR priority_confirmed = false);
```

**Fix:** Confirm priorities after review:
```sql
UPDATE tc_tasks
SET priority_confirmed = true,
    priority_confirmed_at = now(),
    priority_confirmed_by = 'user'
WHERE id IN ('<task_id_1>', '<task_id_2>');
```

### Stuck Tasks

Tasks assigned or in-progress but not updated recently:

```sql
SELECT id, title, status, assigned_agent_id, updated_at,
       EXTRACT(EPOCH FROM (now() - updated_at)) / 3600 AS hours_since_update
FROM tc_tasks
WHERE status IN ('assigned', 'in_progress')
  AND updated_at < now() - interval '2 hours'
ORDER BY updated_at ASC;
```

**Fix:** Investigate the assigned agent session. If the agent is dead, reset the task:
```sql
UPDATE tc_tasks
SET status = 'queued', assigned_agent_id = NULL
WHERE id = '<stuck_task_id>';
```

### Test Data in Queue

Test data should never be in the production queue:

```sql
SELECT id, title
FROM tc_tasks
WHERE status = 'queued'
  AND (title ILIKE '%test%' OR title ILIKE '%sample%'
       OR title ILIKE '%example%' OR title ILIKE '%placeholder%'
       OR title ILIKE '%dummy%' OR title ILIKE '%fake%');
```

**Fix:**
```sql
DELETE FROM tc_tasks WHERE id IN ('<test_task_ids>');
```

### Recent Agent Sessions

```sql
SELECT id, task_id, status, model, created_at, completed_at
FROM tc_agent_sessions
ORDER BY created_at DESC
LIMIT 10;
```

### Recent Interventions (Human Actions)

```sql
SELECT id, type, description, created_at
FROM tc_interventions
ORDER BY created_at DESC
LIMIT 10;
```

### Usage and Spend

```sql
SELECT model, SUM(cost_usd) AS total_cost,
       SUM(input_tokens) AS total_input,
       SUM(output_tokens) AS total_output,
       COUNT(*) AS events
FROM tc_usage_log
WHERE created_at > now() - interval '24 hours'
GROUP BY model;
```

### Budget Status

```sql
SELECT project_id, period_type, budget_usd, spent_usd,
       ROUND((spent_usd / NULLIF(budget_usd, 0)) * 100, 1) AS percent_used,
       period_start, period_end
FROM tc_budgets
WHERE period_end > now()
ORDER BY period_start DESC;
```

---

## Log Pattern Reference

TrafficControl uses structured logging with component prefixes. Set log level via `TC_LOG_LEVEL` environment variable (`DEBUG`, `INFO`, `WARN`, `ERROR`; default: `INFO`). Set format via `TC_LOG_FORMAT` (`json` or `pretty`; default: `pretty`).

### Healthy Startup Sequence

These log messages appear in order during a successful startup:

| Order | Component | Message | Meaning |
|-------|-----------|---------|---------|
| 1 | `[MainLoop]` | `Starting orchestration loop` | Startup initiated |
| 2 | `[MainLoop]` | `Validating database connection` | DB check beginning |
| 3 | `[Database]` | `Database health check passed` | DB is reachable |
| 4 | `[MainLoop]` | `Database healthy` | DB validation passed |
| 5 | `[MainLoop]` | `Running pre-flight checks` | Pre-flight beginning |
| 6 | `[PreFlight]` | `Fetched queued tasks` | Task queue read |
| 7 | `[PreFlight]` | `Pre-flight checks completed` | All checks done |
| 8 | `[MainLoop]` | `Pre-flight summary sent to Slack` | Slack confirmation requested |
| 9 | `[MainLoop]` | `Pre-flight checks confirmed by user` | User approved |
| 10 | `[MainLoop]` | `Orchestration loop started` | Main loop running |

### Healthy Tick Operation

During normal operation, you should see these messages periodically:

| Component | Message | Frequency |
|-----------|---------|-----------|
| `[MainLoop]` | `Scheduled task {taskId, model, sessionId}` | Per task assignment |
| `[MainLoop]` | `Sending status check-in` | Every 30 min (configurable) |
| `[MainLoop]` | `Task approval response` | When tasks are approved |

### Warning Signals

These indicate problems that may require attention:

| Component | Message | Meaning | Action |
|-----------|---------|---------|--------|
| `[DatabaseHealthMonitor]` | `Database not ready, retrying` | DB connection failing | Check Supabase status |
| `[DatabaseHealthMonitor]` | `Entering DEGRADED MODE` | Multiple consecutive DB failures | DB is down; orchestrator skips ticks |
| `[MainLoop]` | `Circuit breaker preventing operation` | Too many agent failures | Check agent error logs |
| `[MainLoop]` | `Spend monitor triggered stop` | Budget limit reached | Review spend, increase budget or wait |
| `[MainLoop]` | `Budget exceeded, pausing task scheduling` | DB-backed budget exceeded | Next budget period or increase limit |
| `[MainLoop]` | `Pre-flight confirmation declined or timed out` | User didn't confirm startup | Re-run startup, confirm in Slack |
| `[MainLoop]` | `Graceful shutdown timeout reached` | Agents didn't stop in time | Agents may still be running |
| `[MainLoop]` | `Error in tick` | Non-DB error in main loop | Check error details in logs |
| `[Database]` | `Missing required environment variables` | SUPABASE_URL or key not set | Check .env file |
| `[MainLoop]` | `Circuit breaker state changed` | Circuit breaker tripped/reset | Check for agent failure pattern |

### Recovery Signals

These indicate the system is self-healing:

| Component | Message | Meaning |
|-----------|---------|---------|
| `[DatabaseHealthMonitor]` | `Database recovered, exiting degraded mode` | DB reconnected |
| `[MainLoop]` | `Budget recovered, resuming task scheduling` | New budget period started |
| `[MainLoop]` | `Circuit breaker manually reset` | Operator reset the breaker |

---

## Common Issues & Remediation

### Database Connectivity

**Symptoms:**
- `[DatabaseHealthMonitor] Entering DEGRADED MODE due to database unavailability`
- `[Database] Health check threw exception`
- Tasks stuck, no new assignments

**Diagnosis:**
```sql
SELECT 1 AS health_check;  -- Does this work from your Supabase dashboard?
```

**Remediation:**
1. Check Supabase project status at your Supabase dashboard
2. Verify environment variables: `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
3. Check network connectivity from the orchestrator host
4. The orchestrator will auto-recover once the database is reachable — look for `Database recovered, exiting degraded mode` in logs

### Slack Authentication

**Symptoms:**
- No messages appearing in Slack channel
- `Failed to send startup notification` in logs
- Agent questions not being routed

**Diagnosis:**
1. Verify tokens in `.env`:
   - `SLACK_BOT_TOKEN` (starts with `xoxb-`)
   - `SLACK_APP_TOKEN` (starts with `xapp-`)
   - `SLACK_SIGNING_SECRET`
2. Check that the bot is invited to the channel: `/invite @trafficcontrol`
3. Verify `SLACK_CHANNEL_ID` matches the target channel

**Remediation:**
1. Regenerate tokens at https://api.slack.com/apps if expired
2. Re-invite the bot to the channel
3. Restart the orchestrator after fixing tokens
4. See [docs/SLACK_SETUP.md](SLACK_SETUP.md) for detailed setup

### Agent Spawn Failures

**Symptoms:**
- Tasks stay in `assigned` status but no agent sessions appear
- `[MainLoop] Error in tick` logs
- Circuit breaker tripped

**Diagnosis:**
```sql
-- Check for tasks assigned but no matching agent session
SELECT t.id, t.title, t.status, t.assigned_agent_id
FROM tc_tasks t
LEFT JOIN tc_agent_sessions s ON t.assigned_agent_id = s.id
WHERE t.status = 'assigned'
  AND s.id IS NULL;
```

**Remediation:**
1. Check `ANTHROPIC_API_KEY` is valid
2. Check API rate limits / account status
3. Reset stuck tasks:
   ```sql
   UPDATE tc_tasks SET status = 'queued', assigned_agent_id = NULL
   WHERE status = 'assigned' AND updated_at < now() - interval '1 hour';
   ```
4. If circuit breaker is tripped, reset via Slack: reply `reset circuit` in the channel

### Circuit Breaker Tripped

**Symptoms:**
- `Circuit breaker state changed {from: "closed", to: "open"}`
- `Circuit breaker preventing operation` on every tick
- Slack notification: `[!] Circuit Breaker TRIPPED`

**Diagnosis:** Check what caused the failures:
```sql
SELECT task_id, event_type, model, cost_usd, created_at
FROM tc_usage_log
WHERE event_type = 'error'
ORDER BY created_at DESC
LIMIT 10;
```

**Remediation:**
1. Fix the underlying issue (bad API key, network problem, recurring task error)
2. Reset via Slack: reply `reset circuit` in the TrafficControl channel
3. The circuit breaker also auto-resets after the configured timeout (default: 5 minutes)

### Budget Limit Reached

**Symptoms:**
- `Spend monitor triggered stop due to budget limit`
- `Budget Exceeded` Slack notification
- Orchestrator paused, no new tasks scheduled

**Diagnosis:**
```sql
SELECT model, SUM(cost_usd) AS total_cost
FROM tc_usage_log
WHERE created_at > now() - interval '24 hours'
GROUP BY model;
```

**Remediation:**
1. Wait for the next budget period (daily/weekly reset)
2. Or increase budget limits in `tc_budgets` table:
   ```sql
   UPDATE tc_budgets SET budget_usd = <new_amount>
   WHERE period_end > now() AND period_type = 'daily';
   ```
3. The orchestrator auto-resumes when budget recovers

### Tasks Not Being Scheduled

**Symptoms:**
- Tasks in `queued` status but no assignments happening
- Orchestrator running but idle

**Diagnosis checklist:**
1. **Priorities confirmed?**
   ```sql
   SELECT COUNT(*) FROM tc_tasks
   WHERE status = 'queued' AND (priority_confirmed IS NULL OR priority_confirmed = false);
   ```
2. **Capacity available?** Check if all agent slots are full
3. **Circuit breaker open?** Check logs for `Circuit breaker preventing operation`
4. **Budget exceeded?** Check logs for `Spend monitor triggered stop`
5. **Degraded mode?** Check logs for `DEGRADED MODE`

---

## Troubleshooting Flowchart

```
Is the orchestrator process running?
├── NO → Start it: npm run start
└── YES
    ↓
Are there recent log messages? (last 5 minutes)
├── NO → Process may be hung. Restart.
└── YES
    ↓
Do logs show "Orchestration loop started"?
├── NO → Check startup errors (DB connection, pre-flight failures)
└── YES
    ↓
Are tasks being scheduled? (look for "Scheduled task" in logs)
├── NO
│   ↓
│   Are there queued tasks with confirmed priorities?
│   ├── NO → Confirm priorities (see SQL above)
│   └── YES
│       ↓
│       Is the circuit breaker open?
│       ├── YES → Fix underlying issue, reset circuit breaker
│       └── NO
│           ↓
│           Is the system over budget?
│           ├── YES → Wait for reset or increase budget
│           └── NO
│               ↓
│               Is the system in degraded mode?
│               ├── YES → Fix database connectivity
│               └── NO → Check capacity limits and agent manager logs
└── YES
    ↓
    Are tasks completing successfully?
    ├── NO → Check agent error logs, tc_usage_log for errors
    └── YES → System is healthy
```

---

## Verification Checklist

Use this checklist after deployments, restarts, or when investigating issues.

### Startup & Connectivity
- [ ] Application starts without errors
- [ ] Database connection is healthy: `SELECT 1 AS health_check;`
- [ ] No crashes or error logs in the first 30 seconds

### Agent Operations
- [ ] Agent sessions appear in the database:
  ```sql
  SELECT * FROM tc_agent_sessions
  WHERE created_at > now() - interval '5 minutes'
  ORDER BY created_at DESC;
  ```
- [ ] Agents can spawn and execute basic operations
- [ ] Agent status is correctly tracked in `tc_tasks`

### Slack Integration
- [ ] Slack bot is connected and online
- [ ] Test @mention receives a response
- [ ] Recent interventions are logged:
  ```sql
  SELECT * FROM tc_interventions
  ORDER BY created_at DESC LIMIT 5;
  ```
- [ ] Messages appear in the configured channel

### Main Loop Activity
- [ ] Tasks are being assigned (status changes from `queued` to `assigned`):
  ```sql
  SELECT * FROM tc_tasks
  WHERE status IN ('in_progress', 'assigned')
  ORDER BY updated_at DESC;
  ```
- [ ] Main loop shows tick activity in logs
- [ ] State file is being updated (if configured)

### Safety Systems
- [ ] Circuit breaker is in `closed` state (normal)
- [ ] Spend is within budget limits
- [ ] No unconfirmed priority tasks blocking the queue

### Red Flags (Never Ignore)
- **Silent startup** (no logs) = process failed to start
- **Database queries timing out** = connectivity issue
- **Agent sessions not appearing** = spawn logic broken
- **Slack messages not sending** = integration broken
- **Tasks stuck in "assigned"** with no progress = main loop or agent issue
- **"No errors" is not enough** — always verify end-to-end functionality
