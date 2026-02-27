import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Reporter, ReporterConfig } from './reporter.js';
import { sendMessage } from '../slack/bot.js';

// Mock the Supabase client
const mockSupabaseClient = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { name: 'Test Project' }, error: null }),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  in: vi.fn().mockResolvedValue({ data: [], error: null }),
  gte: vi.fn().mockResolvedValue({ data: [], error: null }),
};

// Mock the Slack sendMessage function
vi.mock('../slack/bot.js', () => ({
  sendMessage: vi.fn().mockResolvedValue('mock-ts'),
  formatStatusReport: vi.fn().mockReturnValue('Formatted Report')
}));

describe('Reporter', () => {
  let reporter: Reporter;
  let config: ReporterConfig;

  beforeEach(() => {
    vi.useFakeTimers();

    config = {
      morningHour: 8,
      eveningHour: 18,
      quietHoursStart: 0,
      quietHoursEnd: 7,
      timezone: 'America/New_York',
      slackChannel: '#trafficcontrol'
    };

    reporter = new Reporter(mockSupabaseClient as any, config);
  });

  afterEach(() => {
    reporter.stop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('configuration', () => {
    it('should accept configuration options', () => {
      expect(reporter.getConfig()).toEqual(config);
    });

    it('should use default configuration when not provided', () => {
      const defaultReporter = new Reporter(mockSupabaseClient as any);
      const defaultConfig = defaultReporter.getConfig();

      expect(defaultConfig.morningHour).toBe(8);
      expect(defaultConfig.eveningHour).toBe(18);
      expect(defaultConfig.quietHoursStart).toBe(0);
      expect(defaultConfig.quietHoursEnd).toBe(7);
    });
  });

  describe('quiet hours', () => {
    it('should detect when in quiet hours', () => {
      // Set time to 3 AM (within quiet hours 0-7)
      const threeAM = new Date('2025-01-26T03:00:00');
      vi.setSystemTime(threeAM);

      expect(reporter.isQuietHours()).toBe(true);
    });

    it('should detect when outside quiet hours', () => {
      // Set time to 10 AM (outside quiet hours)
      const tenAM = new Date('2025-01-26T10:00:00');
      vi.setSystemTime(tenAM);

      expect(reporter.isQuietHours()).toBe(false);
    });

    it('should not send reports during quiet hours', async () => {
      const threeAM = new Date('2025-01-26T03:00:00');
      vi.setSystemTime(threeAM);

      const result = await reporter.sendScheduledReport();
      expect(result.sent).toBe(false);
      expect(result.reason).toBe('quiet_hours');
    });
  });

  describe('scheduling', () => {
    it('should calculate next report time correctly', () => {
      // Set time to 6 AM
      const sixAM = new Date('2025-01-26T06:00:00');
      vi.setSystemTime(sixAM);

      const nextTime = reporter.getNextReportTime();

      // Should be 8 AM (morning report)
      expect(nextTime.getHours()).toBe(8);
    });

    it('should schedule evening report after morning has passed', () => {
      // Set time to 10 AM (after morning report)
      const tenAM = new Date('2025-01-26T10:00:00');
      vi.setSystemTime(tenAM);

      const nextTime = reporter.getNextReportTime();

      // Should be 6 PM (evening report)
      expect(nextTime.getHours()).toBe(18);
    });

    it('should schedule next morning report after evening has passed', () => {
      // Set time to 8 PM (after evening report)
      const eightPM = new Date('2025-01-26T20:00:00');
      vi.setSystemTime(eightPM);

      const nextTime = reporter.getNextReportTime();

      // Should be 8 AM next day
      expect(nextTime.getHours()).toBe(8);
      expect(nextTime.getDate()).toBe(27);
    });

    it('should start the scheduler', () => {
      reporter.start();
      expect(reporter.isRunning()).toBe(true);
    });

    it('should stop the scheduler', () => {
      reporter.start();
      reporter.stop();
      expect(reporter.isRunning()).toBe(false);
    });
  });

  describe('immediate report', () => {
    it('should generate and send immediate report', async () => {
      // Set time outside quiet hours
      const tenAM = new Date('2025-01-26T10:00:00');
      vi.setSystemTime(tenAM);

      // Mock the metrics collector
      vi.spyOn(reporter as any, 'collectMetrics').mockResolvedValue({
        projectMetrics: [],
        systemMetrics: {
          totalProjects: 1,
          totalTasksQueued: 5,
          totalTasksInProgress: 2,
          totalTasksBlocked: 0,
          totalTasksCompletedToday: 3,
          totalTasksCompletedThisWeek: 10,
          totalTokensOpus: 5000,
          totalTokensSonnet: 3000,
          totalSessions: 5,
          opusUtilization: 50,
          sonnetUtilization: 60
        }
      });

      const result = await reporter.sendImmediateReport();
      expect(result.sent).toBe(true);
    });

    it('should bypass quiet hours for immediate reports', async () => {
      // Set time to 3 AM (quiet hours)
      const threeAM = new Date('2025-01-26T03:00:00');
      vi.setSystemTime(threeAM);

      // Mock the metrics collector
      vi.spyOn(reporter as any, 'collectMetrics').mockResolvedValue({
        projectMetrics: [],
        systemMetrics: {
          totalProjects: 1,
          totalTasksQueued: 5,
          totalTasksInProgress: 2,
          totalTasksBlocked: 0,
          totalTasksCompletedToday: 3,
          totalTasksCompletedThisWeek: 10,
          totalTokensOpus: 5000,
          totalTokensSonnet: 3000,
          totalSessions: 5,
          opusUtilization: 50,
          sonnetUtilization: 60
        }
      });

      const result = await reporter.sendImmediateReport();
      // Immediate reports bypass quiet hours
      expect(result.sent).toBe(true);
    });
  });

  describe('report generation', () => {
    it('should call metricsCollector methods directly (collectMetrics body)', async () => {
      const tenAM = new Date('2025-01-26T10:00:00');
      vi.setSystemTime(tenAM);

      // Spy on the internal metricsCollector methods — does NOT mock collectMetrics itself,
      // so lines 221-224 in reporter.ts execute.
      vi.spyOn((reporter as any).metricsCollector, 'collectAllProjectMetrics')
        .mockResolvedValue([]);
      vi.spyOn((reporter as any).metricsCollector, 'collectSystemMetrics')
        .mockResolvedValue({
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
          sonnetUtilization: 0
        });

      const report = await reporter.generateReport();

      expect(report.metrics.projectMetrics).toEqual([]);
      expect(report.metrics.systemMetrics.totalProjects).toBe(0);
    });

    it('should generate report with metrics and recommendations', async () => {
      const tenAM = new Date('2025-01-26T10:00:00');
      vi.setSystemTime(tenAM);

      // Mock metrics collection
      vi.spyOn(reporter as any, 'collectMetrics').mockResolvedValue({
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
      });

      const report = await reporter.generateReport();

      expect(report).toBeDefined();
      expect(report.metrics).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(report.timestamp).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should return error result when sendMessage throws', async () => {
      const tenAM = new Date('2025-01-26T10:00:00');
      vi.setSystemTime(tenAM);

      // Mock metrics so we reach the sendMessage call
      vi.spyOn(reporter as any, 'collectMetrics').mockResolvedValue({
        projectMetrics: [],
        systemMetrics: {
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
          sonnetUtilization: 0
        }
      });

      // Make sendMessage throw for this one call
      vi.mocked(sendMessage).mockRejectedValueOnce(new Error('Slack API error'));

      const result = await reporter.sendImmediateReport();

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('error');
      expect(result.error).toContain('Slack API error');
    });
  });

  describe('environment configuration', () => {
    it('should read configuration from environment variables', () => {
      // Set environment variables
      process.env.REPORT_MORNING_HOUR = '9';
      process.env.REPORT_EVENING_HOUR = '17';
      process.env.QUIET_HOURS_START = '23';
      process.env.QUIET_HOURS_END = '6';
      process.env.TIMEZONE = 'America/Los_Angeles';
      process.env.SLACK_REPORT_CHANNEL = '#reports';

      const envReporter = Reporter.fromEnv(mockSupabaseClient as any);
      const envConfig = envReporter.getConfig();

      expect(envConfig.morningHour).toBe(9);
      expect(envConfig.eveningHour).toBe(17);
      expect(envConfig.quietHoursStart).toBe(23);
      expect(envConfig.quietHoursEnd).toBe(6);
      expect(envConfig.timezone).toBe('America/Los_Angeles');
      expect(envConfig.slackChannel).toBe('#reports');

      // Cleanup
      delete process.env.REPORT_MORNING_HOUR;
      delete process.env.REPORT_EVENING_HOUR;
      delete process.env.QUIET_HOURS_START;
      delete process.env.QUIET_HOURS_END;
      delete process.env.TIMEZONE;
      delete process.env.SLACK_REPORT_CHANNEL;
    });
  });
});
