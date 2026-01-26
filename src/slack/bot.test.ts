import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSlackBot,
  formatQuestion,
  formatBlocker,
  formatVisualReview,
  formatStatus,
  resetSlackBot,
  formatProposal,
  formatProposalBatch,
  formatProposalApproved,
  formatProposalRejected,
  formatBacklogAlert,
  formatStatusReport,
  ProposalData,
  StatusReportMetrics,
  RecommendationData
} from './bot.js';

describe('Slack Bot', () => {
  beforeEach(() => {
    // Reset bot instance between tests
    resetSlackBot();
  });

  it('should create a bot instance', () => {
    // Mock environment
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    vi.stubEnv('SLACK_SIGNING_SECRET', 'test-secret');
    vi.stubEnv('SLACK_APP_TOKEN', 'xapp-test');

    const bot = createSlackBot();
    expect(bot).toBeDefined();
  });

  it('should return same bot instance on multiple calls', () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    vi.stubEnv('SLACK_SIGNING_SECRET', 'test-secret');
    vi.stubEnv('SLACK_APP_TOKEN', 'xapp-test');

    const bot1 = createSlackBot();
    const bot2 = createSlackBot();
    expect(bot1).toBe(bot2);
  });

  it('should throw error when environment variables are missing', () => {
    // Store original values
    const originalToken = process.env.SLACK_BOT_TOKEN;
    const originalSecret = process.env.SLACK_SIGNING_SECRET;
    const originalAppToken = process.env.SLACK_APP_TOKEN;

    // Reset bot and clear env vars
    resetSlackBot();
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_APP_TOKEN;

    expect(() => createSlackBot()).toThrow('Missing Slack credentials');

    // Restore env vars
    process.env.SLACK_BOT_TOKEN = originalToken;
    process.env.SLACK_SIGNING_SECRET = originalSecret;
    process.env.SLACK_APP_TOKEN = originalAppToken;
    resetSlackBot();
  });

  it('should format question messages', () => {
    const message = formatQuestion('TestProject', 'What database should I use?');
    expect(message).toContain('TestProject');
    expect(message).toContain('What database should I use?');
  });

  it('should format blocker messages', () => {
    const message = formatBlocker('TestProject', 'Cannot access API endpoint');
    expect(message).toContain('TestProject');
    expect(message).toContain('Cannot access API endpoint');
  });

  it('should format visual review messages', () => {
    const message = formatVisualReview('TestProject', 'Create login page');
    expect(message).toContain('TestProject');
    expect(message).toContain('Create login page');
    expect(message).toContain('Visual review');
  });

  it('should format status messages', () => {
    const projects = [
      { name: 'Project1', activeTasks: 3, blockedTasks: 1 },
      { name: 'Project2', activeTasks: 5, blockedTasks: 0 }
    ];
    const message = formatStatus(projects);
    expect(message).toContain('Project1');
    expect(message).toContain('Project2');
    expect(message).toContain('3 active');
    expect(message).toContain('1 blocked');
    expect(message).toContain('5 active');
    expect(message).toContain('0 blocked');
  });

  describe('Proposal Formatting', () => {
    const sampleProposal: ProposalData = {
      id: 'test-id-1',
      title: 'Add authentication',
      description: 'Implement JWT-based auth',
      impact_score: 'high',
      estimated_sessions_opus: 2,
      estimated_sessions_sonnet: 3,
      reasoning: 'Critical for security'
    };

    it('should format a single proposal', () => {
      const message = formatProposal(sampleProposal);
      expect(message).toContain('Add authentication');
      expect(message).toContain('JWT-based auth');
      expect(message).toContain('[HIGH]');
      expect(message).toContain('2 Opus');
      expect(message).toContain('3 Sonnet');
      expect(message).toContain('Critical for security');
    });

    it('should format proposal with index', () => {
      const message = formatProposal(sampleProposal, 0);
      expect(message).toContain('*1.*');
    });

    it('should format proposal with project name', () => {
      const proposalWithProject: ProposalData = {
        ...sampleProposal,
        projectName: 'TestProject'
      };
      const message = formatProposal(proposalWithProject);
      expect(message).toContain('[TestProject]');
    });

    it('should format medium impact proposals', () => {
      const mediumProposal: ProposalData = {
        ...sampleProposal,
        impact_score: 'medium'
      };
      const message = formatProposal(mediumProposal);
      expect(message).toContain('[MED]');
    });

    it('should format low impact proposals', () => {
      const lowProposal: ProposalData = {
        ...sampleProposal,
        impact_score: 'low'
      };
      const message = formatProposal(lowProposal);
      expect(message).toContain('[LOW]');
    });

    it('should handle null impact score', () => {
      const nullImpactProposal: ProposalData = {
        ...sampleProposal,
        impact_score: null
      };
      const message = formatProposal(nullImpactProposal);
      expect(message).toContain('[ ? ]');
    });

    it('should format a batch of proposals', () => {
      const proposals: ProposalData[] = [
        sampleProposal,
        {
          id: 'test-id-2',
          title: 'Add caching',
          description: 'Redis caching layer',
          impact_score: 'medium',
          estimated_sessions_opus: 1,
          estimated_sessions_sonnet: 1,
          reasoning: 'Performance improvement'
        }
      ];

      const message = formatProposalBatch(proposals);
      expect(message).toContain('Add authentication');
      expect(message).toContain('Add caching');
      expect(message).toContain('*1.*');
      expect(message).toContain('*2.*');
      expect(message).toContain('approve all');
      expect(message).toContain('reject');
    });

    it('should handle empty proposal batch', () => {
      const message = formatProposalBatch([]);
      expect(message).toContain('No proposals');
    });

    it('should format approval confirmation', () => {
      const approved: ProposalData[] = [sampleProposal];
      const message = formatProposalApproved(approved);
      expect(message).toContain('Approved 1 proposal');
      expect(message).toContain('Add authentication');
    });

    it('should format rejection confirmation', () => {
      const message = formatProposalRejected(sampleProposal, 'Not a priority right now');
      expect(message).toContain('Rejected');
      expect(message).toContain('Add authentication');
      expect(message).toContain('Not a priority right now');
    });

    it('should format backlog alert', () => {
      const message = formatBacklogAlert(3, 5, 2);
      expect(message).toContain('Backlog Running Low');
      expect(message).toContain('3');
      expect(message).toContain('5');
      expect(message).toContain('2');
    });
  });

  describe('Status Report Formatting', () => {
    const sampleMetrics: StatusReportMetrics = {
      projectMetrics: [
        {
          projectId: 'proj-1',
          projectName: 'Test Project',
          tasksQueued: 5,
          tasksInProgress: 2,
          tasksBlocked: 1,
          tasksCompletedToday: 3,
          tasksCompletedThisWeek: 10,
          tokensOpus: 5000,
          tokensSonnet: 3000,
          sessionsCount: 5,
          completionRate: 40
        }
      ],
      systemMetrics: {
        totalProjects: 1,
        totalTasksQueued: 5,
        totalTasksInProgress: 2,
        totalTasksBlocked: 1,
        totalTasksCompletedToday: 3,
        totalTasksCompletedThisWeek: 10,
        totalTokensOpus: 5000,
        totalTokensSonnet: 3000,
        totalSessions: 5,
        opusUtilization: 50,
        sonnetUtilization: 60
      }
    };

    const sampleRecommendations: RecommendationData = {
      projectRecommendations: new Map([
        ['proj-1', [
          {
            type: 'blocked_tasks',
            message: 'Project "Test Project" has 1 blocked task - needs attention',
            priority: 'critical' as const,
            projectId: 'proj-1',
            projectName: 'Test Project'
          }
        ]]
      ]),
      systemRecommendations: [
        {
          type: 'healthy_system',
          message: 'System is running smoothly',
          priority: 'positive' as const
        }
      ],
      actionItems: ['Resolve blocked task in Test Project']
    };

    it('should format status report with header', () => {
      const report = formatStatusReport(sampleMetrics, sampleRecommendations);
      expect(report).toContain('TrafficControl Status Report');
    });

    it('should include overview section', () => {
      const report = formatStatusReport(sampleMetrics, sampleRecommendations);
      expect(report).toContain('Overview');
      expect(report).toContain('1 active');
      expect(report).toContain('5 queued');
      expect(report).toContain('2 in progress');
      expect(report).toContain('1 blocked');
    });

    it('should include per-project breakdown', () => {
      const report = formatStatusReport(sampleMetrics, sampleRecommendations);
      expect(report).toContain('Per-Project Breakdown');
      expect(report).toContain('Test Project');
      expect(report).toContain('40% complete');
    });

    it('should include recommendations section', () => {
      const report = formatStatusReport(sampleMetrics, sampleRecommendations);
      expect(report).toContain('Recommendations');
      expect(report).toContain('Critical');
      expect(report).toContain('blocked task');
    });

    it('should include action items', () => {
      const report = formatStatusReport(sampleMetrics, sampleRecommendations);
      expect(report).toContain('Action Items');
      expect(report).toContain('Resolve blocked task');
    });

    it('should include footer with command hint', () => {
      const report = formatStatusReport(sampleMetrics, sampleRecommendations);
      expect(report).toContain('/tc report');
    });

    it('should show token usage for projects', () => {
      const report = formatStatusReport(sampleMetrics, sampleRecommendations);
      expect(report).toContain('Tokens:');
      expect(report).toContain('Opus');
      expect(report).toContain('Sonnet');
    });

    it('should show utilization percentages', () => {
      const report = formatStatusReport(sampleMetrics, sampleRecommendations);
      expect(report).toContain('Utilization');
      expect(report).toContain('50%');
      expect(report).toContain('60%');
    });

    it('should handle empty recommendations gracefully', () => {
      const emptyRecommendations: RecommendationData = {
        projectRecommendations: new Map(),
        systemRecommendations: [],
        actionItems: []
      };
      const report = formatStatusReport(sampleMetrics, emptyRecommendations);
      expect(report).toContain('TrafficControl Status Report');
      expect(report).not.toContain('Recommendations');
      expect(report).not.toContain('Action Items');
    });
  });
});
