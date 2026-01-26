-- TrafficControl Database Schema
-- This file is for reference/documentation only.
-- The schema is applied via Supabase MCP migrations.

-- TrafficControl Projects
CREATE TABLE tc_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TrafficControl Tasks
CREATE TABLE tc_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES tc_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'assigned', 'in_progress', 'review', 'complete', 'blocked')),
  priority INTEGER NOT NULL DEFAULT 0,
  complexity_estimate TEXT,
  estimated_sessions_opus INTEGER DEFAULT 0,
  estimated_sessions_sonnet INTEGER DEFAULT 0,
  actual_tokens_opus BIGINT DEFAULT 0,
  actual_tokens_sonnet BIGINT DEFAULT 0,
  actual_sessions_opus INTEGER DEFAULT 0,
  actual_sessions_sonnet INTEGER DEFAULT 0,
  assigned_agent_id TEXT,
  requires_visual_review BOOLEAN DEFAULT false,
  -- Task management fields (added for project tracking)
  parent_task_id UUID REFERENCES tc_tasks(id) ON DELETE SET NULL,
  tags JSONB DEFAULT '[]'::jsonb,
  acceptance_criteria TEXT,
  source TEXT DEFAULT 'user' CHECK (source IN ('user', 'agent_proposal', 'decomposition')),
  blocked_by_task_id UUID REFERENCES tc_tasks(id) ON DELETE SET NULL,
  eta TIMESTAMPTZ,  -- Estimated completion time (PST). Compare with completed_at for delta.
  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,  -- Actual completion time. Delta = completed_at - eta
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TrafficControl Agent Sessions
CREATE TABLE tc_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id) ON DELETE SET NULL,
  model TEXT NOT NULL CHECK (model IN ('opus', 'sonnet', 'haiku')),
  parent_session_id UUID REFERENCES tc_agent_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'blocked', 'waiting_approval', 'complete', 'failed')),
  tokens_used BIGINT DEFAULT 0,
  blocker_reason TEXT,
  blocker_sent_at TIMESTAMPTZ,
  blocker_resolved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

-- TrafficControl Usage Log
CREATE TABLE tc_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES tc_agent_sessions(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  tokens_input BIGINT NOT NULL DEFAULT 0,
  tokens_output BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TrafficControl Interventions
CREATE TABLE tc_interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tc_tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('question', 'approval', 'blocker', 'review')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  duration_seconds INTEGER
);

-- Enable RLS
ALTER TABLE tc_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_interventions ENABLE ROW LEVEL SECURITY;

-- Service role policies (TrafficControl uses service key)
CREATE POLICY "Service role full access" ON tc_projects FOR ALL USING (true);
CREATE POLICY "Service role full access" ON tc_tasks FOR ALL USING (true);
CREATE POLICY "Service role full access" ON tc_agent_sessions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON tc_usage_log FOR ALL USING (true);
CREATE POLICY "Service role full access" ON tc_interventions FOR ALL USING (true);

-- TrafficControl Proposals
CREATE TABLE tc_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES tc_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  impact_score TEXT CHECK (impact_score IN ('high', 'medium', 'low')),
  estimated_sessions_opus INTEGER DEFAULT 0,
  estimated_sessions_sonnet INTEGER DEFAULT 0,
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Enable RLS for proposals
ALTER TABLE tc_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON tc_proposals FOR ALL USING (true);

-- Indexes for common queries
CREATE INDEX idx_tc_tasks_project_id ON tc_tasks(project_id);
CREATE INDEX idx_tc_tasks_status ON tc_tasks(status);
CREATE INDEX idx_tc_agent_sessions_task_id ON tc_agent_sessions(task_id);
CREATE INDEX idx_tc_agent_sessions_status ON tc_agent_sessions(status);
CREATE INDEX idx_tc_usage_log_session_id ON tc_usage_log(session_id);
CREATE INDEX idx_tc_interventions_task_id ON tc_interventions(task_id);
CREATE INDEX idx_tc_proposals_status ON tc_proposals(status);
CREATE INDEX idx_tc_proposals_project_id ON tc_proposals(project_id);

-- Task management field indexes
CREATE INDEX idx_tc_tasks_parent_task_id ON tc_tasks(parent_task_id);
CREATE INDEX idx_tc_tasks_blocked_by_task_id ON tc_tasks(blocked_by_task_id);
CREATE INDEX idx_tc_tasks_source ON tc_tasks(source);
CREATE INDEX idx_tc_tasks_tags ON tc_tasks USING GIN (tags);
