import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsCollector, ProjectMetrics, SystemMetrics } from './metrics-collector.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const TEST_PROJECT_ID = 'test-project-id-001';

const now = new Date();
const todayISO = now.toISOString();

const mockProject = { id: TEST_PROJECT_ID, name: 'Metrics Test Project', status: 'active' };

const mockTasks = [
  {
    id: 'task-1', project_id: TEST_PROJECT_ID, title: 'Queued Task',
    status: 'queued', priority: 1,
    actual_tokens_opus: 0, actual_tokens_sonnet: 0,
    actual_sessions_opus: 0, actual_sessions_sonnet: 0,
    estimated_sessions_opus: 0, estimated_sessions_sonnet: 0,
    completed_at: null,
  },
  {
    id: 'task-2', project_id: TEST_PROJECT_ID, title: 'In Progress Task',
    status: 'in_progress', priority: 2,
    actual_tokens_opus: 0, actual_tokens_sonnet: 0,
    actual_sessions_opus: 0, actual_sessions_sonnet: 0,
    estimated_sessions_opus: 0, estimated_sessions_sonnet: 0,
    completed_at: null,
  },
  {
    id: 'task-3', project_id: TEST_PROJECT_ID, title: 'Blocked Task',
    status: 'blocked', priority: 3,
    actual_tokens_opus: 0, actual_tokens_sonnet: 0,
    actual_sessions_opus: 0, actual_sessions_sonnet: 0,
    estimated_sessions_opus: 0, estimated_sessions_sonnet: 0,
    completed_at: null,
  },
  {
    id: 'task-4', project_id: TEST_PROJECT_ID, title: 'Completed Task',
    status: 'complete', priority: 4,
    actual_tokens_opus: 5000, actual_tokens_sonnet: 1000,
    actual_sessions_opus: 1, actual_sessions_sonnet: 0,
    estimated_sessions_opus: 2, estimated_sessions_sonnet: 0,
    completed_at: todayISO,
  },
];

const mockSessions = [
  { id: 'session-1', model: 'opus', task_id: 'task-4' },
];

/**
 * Creates a mock Supabase query builder that tracks filter state
 * and resolves with appropriate mock data when awaited.
 */
function createQueryBuilder(table: string) {
  const eqs: [string, unknown][] = [];
  const ins: [string, unknown[]][] = [];
  const gtes: [string, unknown][] = [];

  function resolveData(): unknown[] {
    switch (table) {
      case 'tc_projects': {
        let projects = [mockProject];
        for (const [col, val] of eqs) {
          projects = projects.filter((p: Record<string, unknown>) => p[col] === val);
        }
        return projects;
      }
      case 'tc_tasks': {
        let tasks = [...mockTasks];
        for (const [col, val] of eqs) {
          tasks = tasks.filter((t: Record<string, unknown>) => t[col] === val);
        }
        for (const [col, val] of gtes) {
          tasks = tasks.filter((t: Record<string, unknown>) => t[col] != null && (t[col] as string) >= (val as string));
        }
        return tasks;
      }
      case 'tc_agent_sessions': {
        let sessions = [...mockSessions];
        for (const [col, vals] of ins) {
          sessions = sessions.filter((s: Record<string, unknown>) => vals.includes(s[col]));
        }
        return sessions;
      }
      default:
        return [];
    }
  }

  const builder: Record<string, unknown> = {};

  builder.select = (_cols: string) => builder;
  builder.eq = (col: string, val: unknown) => { eqs.push([col, val]); return builder; };
  builder.in = (col: string, vals: unknown[]) => { ins.push([col, vals]); return builder; };
  builder.gte = (col: string, val: unknown) => { gtes.push([col, val]); return builder; };
  builder.limit = () => builder;

  builder.single = () => {
    const data = resolveData();
    const result = { data: data[0] ?? null, error: null };
    return {
      then: (resolve: (val: unknown) => void, reject?: (err: unknown) => void) =>
        Promise.resolve(result).then(resolve, reject),
    };
  };

  builder.then = (resolve: (val: unknown) => void, reject?: (err: unknown) => void) => {
    const result = { data: resolveData(), error: null };
    return Promise.resolve(result).then(resolve, reject);
  };

  return builder;
}

function createMockClient(): SupabaseClient {
  return {
    from: (table: string) => createQueryBuilder(table),
  } as unknown as SupabaseClient;
}

describe('MetricsCollector', () => {
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    metricsCollector = new MetricsCollector(createMockClient());
  });

  describe('collectProjectMetrics', () => {
    it('should collect metrics for a specific project', async () => {
      const metrics = await metricsCollector.collectProjectMetrics(TEST_PROJECT_ID);

      expect(metrics).toBeDefined();
      expect(metrics.projectId).toBe(TEST_PROJECT_ID);
      expect(metrics.projectName).toBe('Metrics Test Project');
    });

    it('should count tasks by status correctly', async () => {
      const metrics = await metricsCollector.collectProjectMetrics(TEST_PROJECT_ID);

      expect(metrics.tasksQueued).toBe(1);
      expect(metrics.tasksInProgress).toBe(1);
      expect(metrics.tasksBlocked).toBe(1);
      expect(metrics.tasksCompletedToday).toBeGreaterThanOrEqual(1);
    });

    it('should track token usage', async () => {
      const metrics = await metricsCollector.collectProjectMetrics(TEST_PROJECT_ID);

      expect(metrics.tokensOpus).toBeGreaterThanOrEqual(5000);
      expect(metrics.tokensSonnet).toBeGreaterThanOrEqual(1000);
    });

    it('should calculate completion rate', async () => {
      const metrics = await metricsCollector.collectProjectMetrics(TEST_PROJECT_ID);

      // 1 completed out of 4 total = 25%
      expect(metrics.completionRate).toBeGreaterThan(0);
    });
  });

  describe('collectAllProjectMetrics', () => {
    it('should collect metrics for all active projects', async () => {
      const allMetrics = await metricsCollector.collectAllProjectMetrics();

      expect(Array.isArray(allMetrics)).toBe(true);
      // Should include our test project
      const testProjectMetrics = allMetrics.find(m => m.projectId === TEST_PROJECT_ID);
      expect(testProjectMetrics).toBeDefined();
    });
  });

  describe('collectSystemMetrics', () => {
    it('should collect overall system metrics', async () => {
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      expect(systemMetrics).toBeDefined();
      expect(systemMetrics.totalProjects).toBeGreaterThanOrEqual(1);
      expect(systemMetrics.totalTasksQueued).toBeGreaterThanOrEqual(1);
      expect(systemMetrics.totalTasksInProgress).toBeGreaterThanOrEqual(1);
      expect(systemMetrics.totalTasksBlocked).toBeGreaterThanOrEqual(1);
    });

    it('should calculate total token usage across all projects', async () => {
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      expect(systemMetrics.totalTokensOpus).toBeGreaterThanOrEqual(5000);
      expect(systemMetrics.totalTokensSonnet).toBeGreaterThanOrEqual(1000);
    });

    it('should count total sessions', async () => {
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      expect(typeof systemMetrics.totalSessions).toBe('number');
    });

    it('should calculate utilization percentages', async () => {
      const systemMetrics = await metricsCollector.collectSystemMetrics();

      expect(typeof systemMetrics.opusUtilization).toBe('number');
      expect(systemMetrics.opusUtilization).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.opusUtilization).toBeLessThanOrEqual(100);
    });
  });

  describe('getTasksCompletedInPeriod', () => {
    it('should return tasks completed today', async () => {
      const count = await metricsCollector.getTasksCompletedInPeriod('today');
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('should return tasks completed this week', async () => {
      const count = await metricsCollector.getTasksCompletedInPeriod('week');
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('compareEstimatesVsActuals', () => {
    it('should compare estimated vs actual sessions', async () => {
      const comparison = await metricsCollector.compareEstimatesVsActuals(TEST_PROJECT_ID);

      expect(comparison).toBeDefined();
      expect(typeof comparison.estimatedSessionsOpus).toBe('number');
      expect(typeof comparison.actualSessionsOpus).toBe('number');
      expect(typeof comparison.variance).toBe('number');
    });
  });
});
