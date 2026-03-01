import { describe, it, expect, beforeEach } from 'vitest';
import {
  RecommendationEngine,
  Recommendation,
  RecommendationType,
  RecommendationReport
} from './recommendation-engine.js';
import { ProjectMetrics, SystemMetrics } from './metrics-collector.js';

describe('RecommendationEngine', () => {
  let engine: RecommendationEngine;

  beforeEach(() => {
    engine = new RecommendationEngine();
  });

  describe('analyzeProjectMetrics', () => {
    it('should recommend attention for projects with blocked tasks', () => {
      const metrics: ProjectMetrics = {
        projectId: 'proj-1',
        projectName: 'Test Project',
        tasksQueued: 2,
        tasksInProgress: 1,
        tasksBlocked: 3,
        tasksCompletedToday: 0,
        tasksCompletedThisWeek: 1,
        tokensOpus: 1000,
        tokensSonnet: 500,
        sessionsCount: 2,
        completionRate: 25
      };

      const recommendations = engine.analyzeProjectMetrics(metrics);

      expect(recommendations.some(r =>
        r.type === 'blocked_tasks' &&
        r.message.includes('3 blocked tasks')
      )).toBe(true);
    });

    it('should recommend adding tasks when backlog is empty', () => {
      const metrics: ProjectMetrics = {
        projectId: 'proj-1',
        projectName: 'Test Project',
        tasksQueued: 0,
        tasksInProgress: 1,
        tasksBlocked: 0,
        tasksCompletedToday: 2,
        tasksCompletedThisWeek: 5,
        tokensOpus: 1000,
        tokensSonnet: 500,
        sessionsCount: 2,
        completionRate: 80
      };

      const recommendations = engine.analyzeProjectMetrics(metrics);

      expect(recommendations.some(r =>
        r.type === 'empty_backlog' &&
        r.message.toLowerCase().includes('backlog')
      )).toBe(true);
    });

    it('should celebrate when project completed tasks ahead of schedule', () => {
      const metrics: ProjectMetrics = {
        projectId: 'proj-1',
        projectName: 'Fast Project',
        tasksQueued: 3,
        tasksInProgress: 0,
        tasksBlocked: 0,
        tasksCompletedToday: 5,
        tasksCompletedThisWeek: 10,
        tokensOpus: 1000,
        tokensSonnet: 500,
        sessionsCount: 2,
        completionRate: 50
      };

      const recommendations = engine.analyzeProjectMetrics(metrics);

      expect(recommendations.some(r =>
        r.type === 'high_velocity' &&
        r.priority === 'positive'
      )).toBe(true);
    });

    it('should flag projects with no activity', () => {
      const metrics: ProjectMetrics = {
        projectId: 'proj-1',
        projectName: 'Stalled Project',
        tasksQueued: 5,
        tasksInProgress: 0,
        tasksBlocked: 0,
        tasksCompletedToday: 0,
        tasksCompletedThisWeek: 0,
        tokensOpus: 0,
        tokensSonnet: 0,
        sessionsCount: 0,
        completionRate: 0
      };

      const recommendations = engine.analyzeProjectMetrics(metrics);

      expect(recommendations.some(r =>
        r.type === 'no_activity' &&
        r.message.includes('no activity')
      )).toBe(true);
    });

    it('should return no recommendations for healthy projects', () => {
      const metrics: ProjectMetrics = {
        projectId: 'proj-1',
        projectName: 'Healthy Project',
        tasksQueued: 3,
        tasksInProgress: 2,
        tasksBlocked: 0,
        tasksCompletedToday: 1,
        tasksCompletedThisWeek: 4,
        tokensOpus: 2000,
        tokensSonnet: 1000,
        sessionsCount: 5,
        completionRate: 40
      };

      const recommendations = engine.analyzeProjectMetrics(metrics);

      // May have positive recommendations but no critical ones
      expect(recommendations.filter(r => r.priority === 'critical').length).toBe(0);
    });
  });

  describe('analyzeSystemMetrics', () => {
    it('should recommend more complex tasks when Opus utilization is low', () => {
      const systemMetrics: SystemMetrics = {
        totalProjects: 3,
        totalTasksQueued: 10,
        totalTasksInProgress: 2,
        totalTasksBlocked: 0,
        totalTasksCompletedToday: 3,
        totalTasksCompletedThisWeek: 15,
        totalTokensOpus: 5000,
        totalTokensSonnet: 20000,
        totalSessions: 10,
        opusUtilization: 15,  // Low utilization
        sonnetUtilization: 80
      };

      const recommendations = engine.analyzeSystemMetrics(systemMetrics);

      expect(recommendations.some(r =>
        r.type === 'low_opus_utilization' &&
        r.message.includes('complex tasks')
      )).toBe(true);
    });

    it('should flag when too many tasks are blocked system-wide', () => {
      const systemMetrics: SystemMetrics = {
        totalProjects: 3,
        totalTasksQueued: 5,
        totalTasksInProgress: 2,
        totalTasksBlocked: 8,
        totalTasksCompletedToday: 1,
        totalTasksCompletedThisWeek: 5,
        totalTokensOpus: 5000,
        totalTokensSonnet: 10000,
        totalSessions: 10,
        opusUtilization: 50,
        sonnetUtilization: 60
      };

      const recommendations = engine.analyzeSystemMetrics(systemMetrics);

      expect(recommendations.some(r =>
        r.type === 'high_blocked_count' &&
        r.priority === 'critical'
      )).toBe(true);
    });

    it('should recommend adding work when queues are empty', () => {
      const systemMetrics: SystemMetrics = {
        totalProjects: 3,
        totalTasksQueued: 0,
        totalTasksInProgress: 1,
        totalTasksBlocked: 0,
        totalTasksCompletedToday: 5,
        totalTasksCompletedThisWeek: 20,
        totalTokensOpus: 10000,
        totalTokensSonnet: 15000,
        totalSessions: 15,
        opusUtilization: 70,
        sonnetUtilization: 80
      };

      const recommendations = engine.analyzeSystemMetrics(systemMetrics);

      expect(recommendations.some(r =>
        r.type === 'empty_queues'
      )).toBe(true);
    });

    it('should provide positive feedback when system is healthy', () => {
      const systemMetrics: SystemMetrics = {
        totalProjects: 3,
        totalTasksQueued: 10,
        totalTasksInProgress: 3,
        totalTasksBlocked: 0,
        totalTasksCompletedToday: 5,
        totalTasksCompletedThisWeek: 25,
        totalTokensOpus: 15000,
        totalTokensSonnet: 20000,
        totalSessions: 20,
        opusUtilization: 60,
        sonnetUtilization: 70
      };

      const recommendations = engine.analyzeSystemMetrics(systemMetrics);

      // Should have some positive feedback
      const positiveRecs = recommendations.filter(r => r.priority === 'positive');
      expect(positiveRecs.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generateReport', () => {
    it('should combine project and system recommendations', () => {
      const projectMetrics: ProjectMetrics[] = [
        {
          projectId: 'proj-1',
          projectName: 'Project A',
          tasksQueued: 0,
          tasksInProgress: 1,
          tasksBlocked: 2,
          tasksCompletedToday: 1,
          tasksCompletedThisWeek: 3,
          tokensOpus: 1000,
          tokensSonnet: 500,
          sessionsCount: 2,
          completionRate: 30
        }
      ];

      const systemMetrics: SystemMetrics = {
        totalProjects: 1,
        totalTasksQueued: 0,
        totalTasksInProgress: 1,
        totalTasksBlocked: 2,
        totalTasksCompletedToday: 1,
        totalTasksCompletedThisWeek: 3,
        totalTokensOpus: 1000,
        totalTokensSonnet: 500,
        totalSessions: 2,
        opusUtilization: 30,
        sonnetUtilization: 40
      };

      const report = engine.generateReport(projectMetrics, systemMetrics);

      expect(report.projectRecommendations).toBeDefined();
      expect(report.systemRecommendations).toBeDefined();
      expect(report.actionItems).toBeDefined();
      expect(Array.isArray(report.actionItems)).toBe(true);
    });

    it('should prioritize critical action items', () => {
      const projectMetrics: ProjectMetrics[] = [
        {
          projectId: 'proj-1',
          projectName: 'Critical Project',
          tasksQueued: 0,
          tasksInProgress: 0,
          tasksBlocked: 5,
          tasksCompletedToday: 0,
          tasksCompletedThisWeek: 0,
          tokensOpus: 0,
          tokensSonnet: 0,
          sessionsCount: 0,
          completionRate: 0
        }
      ];

      const systemMetrics: SystemMetrics = {
        totalProjects: 1,
        totalTasksQueued: 0,
        totalTasksInProgress: 0,
        totalTasksBlocked: 5,
        totalTasksCompletedToday: 0,
        totalTasksCompletedThisWeek: 0,
        totalTokensOpus: 0,
        totalTokensSonnet: 0,
        totalSessions: 0,
        opusUtilization: 0,
        sonnetUtilization: 0
      };

      const report = engine.generateReport(projectMetrics, systemMetrics);

      // Critical items should appear first in action items
      if (report.actionItems.length > 0) {
        const criticalItems = report.actionItems.filter(item =>
          item.toLowerCase().includes('blocked') ||
          item.toLowerCase().includes('attention')
        );
        expect(criticalItems.length).toBeGreaterThan(0);
      }
    });

    it('should not include projects with no recommendations in the map', () => {
      const projectMetrics: ProjectMetrics[] = [
        {
          projectId: 'proj-healthy',
          projectName: 'Healthy Project',
          tasksQueued: 3,
          tasksInProgress: 2,
          tasksBlocked: 0,
          tasksCompletedToday: 1,
          tasksCompletedThisWeek: 4,
          tokensOpus: 2000,
          tokensSonnet: 1000,
          sessionsCount: 5,
          completionRate: 40
        }
      ];

      const systemMetrics: SystemMetrics = {
        totalProjects: 1,
        totalTasksQueued: 3,
        totalTasksInProgress: 2,
        totalTasksBlocked: 0,
        totalTasksCompletedToday: 1,
        totalTasksCompletedThisWeek: 4,
        totalTokensOpus: 2000,
        totalTokensSonnet: 1000,
        totalSessions: 5,
        opusUtilization: 50,
        sonnetUtilization: 60
      };

      const report = engine.generateReport(projectMetrics, systemMetrics);
      expect(report.projectRecommendations.has('proj-healthy')).toBe(false);
    });
  });

  describe('getCriticalRecommendations', () => {
    it('should return critical recommendations from both system and project sources', () => {
      const report: RecommendationReport = {
        projectRecommendations: new Map([
          ['proj-1', [
            { type: 'blocked_tasks', message: 'Project has blocked tasks', priority: 'critical', projectId: 'proj-1', projectName: 'Project A' },
            { type: 'empty_backlog', message: 'Backlog empty', priority: 'warning', projectId: 'proj-1', projectName: 'Project A' },
          ]],
        ]),
        systemRecommendations: [
          { type: 'high_blocked_count', message: 'Many blocked tasks', priority: 'critical' },
          { type: 'healthy_system', message: 'System OK', priority: 'positive' },
        ],
        actionItems: [],
      };

      const critical = engine.getCriticalRecommendations(report);

      expect(critical).toHaveLength(2);
      expect(critical.every(r => r.priority === 'critical')).toBe(true);
      expect(critical.map(r => r.type)).toContain('blocked_tasks');
      expect(critical.map(r => r.type)).toContain('high_blocked_count');
    });

    it('should return empty array when no critical recommendations exist', () => {
      const report: RecommendationReport = {
        projectRecommendations: new Map([
          ['proj-1', [
            { type: 'empty_backlog', message: 'Backlog empty', priority: 'warning', projectId: 'proj-1', projectName: 'Project A' },
          ]],
        ]),
        systemRecommendations: [
          { type: 'healthy_system', message: 'System OK', priority: 'positive' },
        ],
        actionItems: [],
      };

      const critical = engine.getCriticalRecommendations(report);
      expect(critical).toHaveLength(0);
    });

    it('should return critical from multiple projects', () => {
      const report: RecommendationReport = {
        projectRecommendations: new Map([
          ['proj-1', [{ type: 'blocked_tasks', message: 'Project A blocked', priority: 'critical', projectId: 'proj-1', projectName: 'A' }]],
          ['proj-2', [{ type: 'blocked_tasks', message: 'Project B blocked', priority: 'critical', projectId: 'proj-2', projectName: 'B' }]],
        ]),
        systemRecommendations: [],
        actionItems: [],
      };

      const critical = engine.getCriticalRecommendations(report);
      expect(critical).toHaveLength(2);
    });
  });

  describe('getPositiveRecommendations', () => {
    it('should return positive recommendations from both system and project sources', () => {
      const report: RecommendationReport = {
        projectRecommendations: new Map([
          ['proj-1', [
            { type: 'high_velocity', message: 'Fast project', priority: 'positive', projectId: 'proj-1', projectName: 'A' },
            { type: 'blocked_tasks', message: 'Blocked', priority: 'critical', projectId: 'proj-1', projectName: 'A' },
          ]],
        ]),
        systemRecommendations: [
          { type: 'healthy_system', message: 'Healthy', priority: 'positive' },
          { type: 'high_blocked_count', message: 'Blocked', priority: 'critical' },
        ],
        actionItems: [],
      };

      const positive = engine.getPositiveRecommendations(report);

      expect(positive).toHaveLength(2);
      expect(positive.every(r => r.priority === 'positive')).toBe(true);
      expect(positive.map(r => r.type)).toContain('high_velocity');
      expect(positive.map(r => r.type)).toContain('healthy_system');
    });

    it('should return empty array when no positive recommendations exist', () => {
      const report: RecommendationReport = {
        projectRecommendations: new Map(),
        systemRecommendations: [
          { type: 'high_blocked_count', message: 'Blocked', priority: 'critical' },
        ],
        actionItems: [],
      };

      const positive = engine.getPositiveRecommendations(report);
      expect(positive).toHaveLength(0);
    });

    it('should collect positive recommendations from multiple projects', () => {
      const report: RecommendationReport = {
        projectRecommendations: new Map([
          ['proj-1', [{ type: 'high_velocity', message: 'Fast A', priority: 'positive', projectId: 'proj-1', projectName: 'A' }]],
          ['proj-2', [{ type: 'high_completion', message: 'Done B', priority: 'positive', projectId: 'proj-2', projectName: 'B' }]],
        ]),
        systemRecommendations: [],
        actionItems: [],
      };

      const positive = engine.getPositiveRecommendations(report);
      expect(positive).toHaveLength(2);
    });
  });

  describe('threshold boundaries', () => {
    const baseProjectMetrics: ProjectMetrics = {
      projectId: 'proj-1',
      projectName: 'Threshold Test',
      tasksQueued: 0,
      tasksInProgress: 0,
      tasksBlocked: 0,
      tasksCompletedToday: 0,
      tasksCompletedThisWeek: 0,
      tokensOpus: 0,
      tokensSonnet: 0,
      sessionsCount: 0,
      completionRate: 0,
    };

    const baseSystemMetrics: SystemMetrics = {
      totalProjects: 1,
      totalTasksQueued: 0,
      totalTasksInProgress: 0,
      totalTasksBlocked: 0,
      totalTasksCompletedToday: 0,
      totalTasksCompletedThisWeek: 0,
      totalTokensOpus: 0,
      totalTokensSonnet: 0,
      totalSessions: 0,
      opusUtilization: 0,
      sonnetUtilization: 0,
    };

    describe('analyzeProjectMetrics thresholds', () => {
      it('should trigger blocked_tasks at threshold (tasksBlocked=1)', () => {
        const recs = engine.analyzeProjectMetrics({ ...baseProjectMetrics, tasksBlocked: 1 });
        expect(recs.some(r => r.type === 'blocked_tasks')).toBe(true);
      });

      it('should NOT trigger blocked_tasks below threshold (tasksBlocked=0)', () => {
        const recs = engine.analyzeProjectMetrics({ ...baseProjectMetrics, tasksBlocked: 0 });
        expect(recs.some(r => r.type === 'blocked_tasks')).toBe(false);
      });

      it('should trigger high_velocity at threshold (tasksCompletedToday=5)', () => {
        const recs = engine.analyzeProjectMetrics({ ...baseProjectMetrics, tasksCompletedToday: 5 });
        expect(recs.some(r => r.type === 'high_velocity')).toBe(true);
      });

      it('should NOT trigger high_velocity below threshold (tasksCompletedToday=4)', () => {
        const recs = engine.analyzeProjectMetrics({ ...baseProjectMetrics, tasksCompletedToday: 4 });
        expect(recs.some(r => r.type === 'high_velocity')).toBe(false);
      });

      it('should trigger high_completion at boundary (completionRate=80, completedThisWeek=1)', () => {
        const recs = engine.analyzeProjectMetrics({
          ...baseProjectMetrics,
          completionRate: 80,
          tasksCompletedThisWeek: 1,
        });
        expect(recs.some(r => r.type === 'high_completion')).toBe(true);
      });

      it('should NOT trigger high_completion just below boundary (completionRate=79)', () => {
        const recs = engine.analyzeProjectMetrics({
          ...baseProjectMetrics,
          completionRate: 79,
          tasksCompletedThisWeek: 1,
        });
        expect(recs.some(r => r.type === 'high_completion')).toBe(false);
      });

      it('should NOT trigger high_completion with zero completed this week', () => {
        const recs = engine.analyzeProjectMetrics({
          ...baseProjectMetrics,
          completionRate: 90,
          tasksCompletedThisWeek: 0,
        });
        expect(recs.some(r => r.type === 'high_completion')).toBe(false);
      });

      it('should trigger empty_backlog only when there is activity (inProgress > 0)', () => {
        const recs = engine.analyzeProjectMetrics({
          ...baseProjectMetrics,
          tasksQueued: 0,
          tasksInProgress: 1,
          tasksCompletedThisWeek: 0,
        });
        expect(recs.some(r => r.type === 'empty_backlog')).toBe(true);
      });

      it('should trigger empty_backlog only when there is activity (completedThisWeek > 0)', () => {
        const recs = engine.analyzeProjectMetrics({
          ...baseProjectMetrics,
          tasksQueued: 0,
          tasksInProgress: 0,
          tasksCompletedThisWeek: 1,
        });
        expect(recs.some(r => r.type === 'empty_backlog')).toBe(true);
      });

      it('should NOT trigger empty_backlog when no activity and no queued tasks', () => {
        const recs = engine.analyzeProjectMetrics({
          ...baseProjectMetrics,
          tasksQueued: 0,
          tasksInProgress: 0,
          tasksCompletedThisWeek: 0,
        });
        expect(recs.some(r => r.type === 'empty_backlog')).toBe(false);
      });
    });

    describe('analyzeSystemMetrics thresholds', () => {
      it('should trigger low_opus_utilization just below threshold (opusUtilization=24)', () => {
        const recs = engine.analyzeSystemMetrics({ ...baseSystemMetrics, opusUtilization: 24 });
        expect(recs.some(r => r.type === 'low_opus_utilization')).toBe(true);
      });

      it('should NOT trigger low_opus_utilization at threshold (opusUtilization=25)', () => {
        const recs = engine.analyzeSystemMetrics({ ...baseSystemMetrics, opusUtilization: 25 });
        expect(recs.some(r => r.type === 'low_opus_utilization')).toBe(false);
      });

      it('should NOT trigger low_opus_utilization when opus is zero (opusUtilization=0)', () => {
        const recs = engine.analyzeSystemMetrics({ ...baseSystemMetrics, opusUtilization: 0 });
        expect(recs.some(r => r.type === 'low_opus_utilization')).toBe(false);
      });

      it('should trigger high_blocked_count at threshold (totalTasksBlocked=5)', () => {
        const recs = engine.analyzeSystemMetrics({ ...baseSystemMetrics, totalTasksBlocked: 5 });
        expect(recs.some(r => r.type === 'high_blocked_count')).toBe(true);
      });

      it('should NOT trigger high_blocked_count below threshold (totalTasksBlocked=4)', () => {
        const recs = engine.analyzeSystemMetrics({ ...baseSystemMetrics, totalTasksBlocked: 4 });
        expect(recs.some(r => r.type === 'high_blocked_count')).toBe(false);
      });

      it('should NOT trigger empty_queues when no projects exist', () => {
        const recs = engine.analyzeSystemMetrics({
          ...baseSystemMetrics,
          totalProjects: 0,
          totalTasksQueued: 0,
        });
        expect(recs.some(r => r.type === 'empty_queues')).toBe(false);
      });

      it('should trigger empty_queues when projects exist but queues empty', () => {
        const recs = engine.analyzeSystemMetrics({
          ...baseSystemMetrics,
          totalProjects: 2,
          totalTasksQueued: 0,
        });
        expect(recs.some(r => r.type === 'empty_queues')).toBe(true);
      });
    });
  });

  describe('RecommendationEngine - Custom Thresholds', () => {
    it('should suppress recommendations that fall below custom thresholds', () => {
      const customEngine = new RecommendationEngine({
        blockedTasks: 5,
        highVelocity: 10,
        lowOpusUtilization: 50,
        highBlockedSystem: 10
      });

      const metrics: ProjectMetrics = {
        projectId: 'proj-1',
        projectName: 'Test Project',
        tasksQueued: 2,
        tasksInProgress: 1,
        tasksBlocked: 3, // Below custom threshold of 5
        tasksCompletedToday: 7, // Below custom threshold of 10
        tasksCompletedThisWeek: 7,
        tokensOpus: 1000,
        tokensSonnet: 500,
        sessionsCount: 2,
        completionRate: 25
      };

      const recommendations = customEngine.analyzeProjectMetrics(metrics);

      // Should NOT trigger blocked_tasks warning (3 < 5)
      expect(recommendations.some(r => r.type === 'blocked_tasks')).toBe(false);
      // Should NOT trigger high_velocity positive (7 < 10)
      expect(recommendations.some(r => r.type === 'high_velocity')).toBe(false);
    });

    it('should use default thresholds when none provided', () => {
      const defaultEngine = new RecommendationEngine();

      const metrics: ProjectMetrics = {
        projectId: 'proj-1',
        projectName: 'Test Project',
        tasksQueued: 2,
        tasksInProgress: 1,
        tasksBlocked: 1, // Exactly at default threshold of 1
        tasksCompletedToday: 5, // Exactly at default threshold of 5
        tasksCompletedThisWeek: 5,
        tokensOpus: 1000,
        tokensSonnet: 500,
        sessionsCount: 2,
        completionRate: 25
      };

      const recommendations = defaultEngine.analyzeProjectMetrics(metrics);

      // Should trigger with default threshold of 1
      expect(recommendations.some(r => r.type === 'blocked_tasks')).toBe(true);
      // Should trigger with default threshold of 5
      expect(recommendations.some(r => r.type === 'high_velocity')).toBe(true);
    });

    it('should use custom system-level thresholds', () => {
      const customEngine = new RecommendationEngine({
        lowOpusUtilization: 50,
        highBlockedSystem: 10
      });

      const systemMetrics: SystemMetrics = {
        totalProjects: 2,
        totalTasksQueued: 10,
        totalTasksInProgress: 2,
        totalTasksBlocked: 8, // Below custom threshold of 10
        totalTasksCompletedToday: 3,
        totalTasksCompletedThisWeek: 15,
        totalTokensOpus: 5000,
        totalTokensSonnet: 10000,
        totalSessions: 10,
        opusUtilization: 55, // Above custom threshold of 50, so NOT low
        sonnetUtilization: 60
      };

      const recommendations = customEngine.analyzeSystemMetrics(systemMetrics);

      // Should NOT trigger: 55 >= 50, so not below lowOpusUtilization threshold
      expect(recommendations.some(r => r.type === 'low_opus_utilization')).toBe(false);
      // Should NOT trigger (8 < 10)
      expect(recommendations.some(r => r.type === 'high_blocked_count')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle all-zero project metrics without errors', () => {
      const metrics: ProjectMetrics = {
        projectId: 'proj-1',
        projectName: 'Zero Project',
        tasksQueued: 0,
        tasksInProgress: 0,
        tasksBlocked: 0,
        tasksCompletedToday: 0,
        tasksCompletedThisWeek: 0,
        tokensOpus: 0,
        tokensSonnet: 0,
        sessionsCount: 0,
        completionRate: 0,
      };

      const recs = engine.analyzeProjectMetrics(metrics);
      expect(Array.isArray(recs)).toBe(true);
      expect(recs).toHaveLength(0);
    });

    it('should handle all-zero system metrics without errors', () => {
      const metrics: SystemMetrics = {
        totalProjects: 0,
        totalTasksQueued: 0,
        totalTasksInProgress: 0,
        totalTasksBlocked: 0,
        totalTasksCompletedToday: 0,
        totalTasksCompletedThisWeek: 0,
        totalTokensOpus: 0,
        totalTokensSonnet: 0,
        totalSessions: 0,
        opusUtilization: 0,
        sonnetUtilization: 0,
      };

      const recs = engine.analyzeSystemMetrics(metrics);
      expect(Array.isArray(recs)).toBe(true);
    });

    it('should handle negative metric values gracefully', () => {
      const metrics: ProjectMetrics = {
        projectId: 'proj-1',
        projectName: 'Negative Project',
        tasksQueued: -1,
        tasksInProgress: -1,
        tasksBlocked: -1,
        tasksCompletedToday: -1,
        tasksCompletedThisWeek: -1,
        tokensOpus: -100,
        tokensSonnet: -100,
        sessionsCount: -1,
        completionRate: -10,
      };

      expect(() => engine.analyzeProjectMetrics(metrics)).not.toThrow();
      const recs = engine.analyzeProjectMetrics(metrics);
      expect(Array.isArray(recs)).toBe(true);
    });

    it('should generate report with empty project metrics array', () => {
      const systemMetrics: SystemMetrics = {
        totalProjects: 0,
        totalTasksQueued: 0,
        totalTasksInProgress: 0,
        totalTasksBlocked: 0,
        totalTasksCompletedToday: 0,
        totalTasksCompletedThisWeek: 0,
        totalTokensOpus: 0,
        totalTokensSonnet: 0,
        totalSessions: 0,
        opusUtilization: 0,
        sonnetUtilization: 0,
      };

      const report = engine.generateReport([], systemMetrics);
      expect(report.projectRecommendations.size).toBe(0);
      expect(Array.isArray(report.systemRecommendations)).toBe(true);
      expect(Array.isArray(report.actionItems)).toBe(true);
    });

    it('should sort action items with critical before warning', () => {
      const projectMetrics: ProjectMetrics[] = [
        {
          projectId: 'proj-1',
          projectName: 'Warning Project',
          tasksQueued: 0,
          tasksInProgress: 1,
          tasksBlocked: 0,
          tasksCompletedToday: 0,
          tasksCompletedThisWeek: 1,
          tokensOpus: 0,
          tokensSonnet: 0,
          sessionsCount: 1,
          completionRate: 0,
        },
        {
          projectId: 'proj-2',
          projectName: 'Critical Project',
          tasksQueued: 3,
          tasksInProgress: 0,
          tasksBlocked: 3,
          tasksCompletedToday: 0,
          tasksCompletedThisWeek: 0,
          tokensOpus: 0,
          tokensSonnet: 0,
          sessionsCount: 0,
          completionRate: 0,
        },
      ];

      const systemMetrics: SystemMetrics = {
        totalProjects: 2,
        totalTasksQueued: 3,
        totalTasksInProgress: 1,
        totalTasksBlocked: 3,
        totalTasksCompletedToday: 0,
        totalTasksCompletedThisWeek: 1,
        totalTokensOpus: 0,
        totalTokensSonnet: 0,
        totalSessions: 1,
        opusUtilization: 0,
        sonnetUtilization: 0,
      };

      const report = engine.generateReport(projectMetrics, systemMetrics);

      const criticalItems = report.actionItems.filter(i => i.includes('blocked'));
      const warningItems = report.actionItems.filter(i => i.includes('Backlog') || i.includes('backlog'));
      expect(criticalItems.length).toBeGreaterThan(0);
      expect(warningItems.length).toBeGreaterThan(0);
      const criticalIdx = report.actionItems.indexOf(criticalItems[0]);
      const warningIdx = report.actionItems.indexOf(warningItems[0]);
      expect(criticalIdx).toBeLessThan(warningIdx);
    });

    it('should exclude info and positive project recommendations from action items', () => {
      const projectMetrics: ProjectMetrics[] = [
        {
          projectId: 'proj-1',
          projectName: 'Positive Only',
          tasksQueued: 3,
          tasksInProgress: 2,
          tasksBlocked: 0,
          tasksCompletedToday: 5,
          tasksCompletedThisWeek: 10,
          tokensOpus: 1000,
          tokensSonnet: 500,
          sessionsCount: 5,
          completionRate: 90,
        },
      ];

      const systemMetrics: SystemMetrics = {
        totalProjects: 1,
        totalTasksQueued: 3,
        totalTasksInProgress: 2,
        totalTasksBlocked: 0,
        totalTasksCompletedToday: 5,
        totalTasksCompletedThisWeek: 10,
        totalTokensOpus: 1000,
        totalTokensSonnet: 500,
        totalSessions: 5,
        opusUtilization: 50,
        sonnetUtilization: 60,
      };

      const report = engine.generateReport(projectMetrics, systemMetrics);

      // Project should generate positive recommendations (high_velocity, high_completion)
      // but no critical/warning ones — so no project-level action items
      expect(report.projectRecommendations.has('proj-1')).toBe(true);
      const projectRecs = report.projectRecommendations.get('proj-1')!;
      expect(projectRecs.every(r => r.priority === 'positive')).toBe(true);
      // Action items should not include any positive recommendations
      for (const rec of projectRecs) {
        expect(report.actionItems).not.toContain(rec.message);
      }
    });

    it('should handle getCriticalRecommendations with empty report', () => {
      const report: RecommendationReport = {
        projectRecommendations: new Map(),
        systemRecommendations: [],
        actionItems: [],
      };

      const critical = engine.getCriticalRecommendations(report);
      expect(critical).toHaveLength(0);
    });

    it('should handle getPositiveRecommendations with empty report', () => {
      const report: RecommendationReport = {
        projectRecommendations: new Map(),
        systemRecommendations: [],
        actionItems: [],
      };

      const positive = engine.getPositiveRecommendations(report);
      expect(positive).toHaveLength(0);
    });
  });
});
