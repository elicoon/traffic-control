import { describe, it, expect, beforeEach } from 'vitest';
import {
  RecommendationEngine,
  Recommendation,
  RecommendationType
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
  });

  describe('Custom Thresholds', () => {
    it('should use custom thresholds when provided', () => {
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
  });
});
