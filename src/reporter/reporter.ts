import { SupabaseClient } from '@supabase/supabase-js';
import { MetricsCollector, ProjectMetrics, SystemMetrics } from './metrics-collector.js';
import { RecommendationEngine, RecommendationReport } from './recommendation-engine.js';
import { sendMessage, formatStatusReport } from '../slack/bot.js';

export interface ReporterConfig {
  morningHour: number;
  eveningHour: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
  slackChannel: string;
}

export interface ReportResult {
  sent: boolean;
  reason?: 'quiet_hours' | 'error' | 'success';
  error?: string;
  timestamp?: string;
}

export interface GeneratedReport {
  metrics: {
    projectMetrics: ProjectMetrics[];
    systemMetrics: SystemMetrics;
  };
  recommendations: RecommendationReport;
  timestamp: Date;
}

const DEFAULT_CONFIG: ReporterConfig = {
  morningHour: 8,
  eveningHour: 18,
  quietHoursStart: 0,
  quietHoursEnd: 7,
  timezone: 'America/New_York',
  slackChannel: '#trafficcontrol'
};

export class Reporter {
  private config: ReporterConfig;
  private metricsCollector: MetricsCollector;
  private recommendationEngine: RecommendationEngine;
  private schedulerInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;

  constructor(private client: SupabaseClient, config?: Partial<ReporterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metricsCollector = new MetricsCollector(client);
    this.recommendationEngine = new RecommendationEngine();
  }

  /**
   * Creates a Reporter instance from environment variables.
   */
  static fromEnv(client: SupabaseClient): Reporter {
    const config: Partial<ReporterConfig> = {};

    if (process.env.REPORT_MORNING_HOUR) {
      config.morningHour = parseInt(process.env.REPORT_MORNING_HOUR, 10);
    }
    if (process.env.REPORT_EVENING_HOUR) {
      config.eveningHour = parseInt(process.env.REPORT_EVENING_HOUR, 10);
    }
    if (process.env.QUIET_HOURS_START) {
      config.quietHoursStart = parseInt(process.env.QUIET_HOURS_START, 10);
    }
    if (process.env.QUIET_HOURS_END) {
      config.quietHoursEnd = parseInt(process.env.QUIET_HOURS_END, 10);
    }
    if (process.env.TIMEZONE) {
      config.timezone = process.env.TIMEZONE;
    }
    if (process.env.SLACK_REPORT_CHANNEL) {
      config.slackChannel = process.env.SLACK_REPORT_CHANNEL;
    }

    return new Reporter(client, config);
  }

  /**
   * Returns the current configuration.
   */
  getConfig(): ReporterConfig {
    return { ...this.config };
  }

  /**
   * Checks if the current time is within quiet hours.
   */
  isQuietHours(): boolean {
    const now = new Date();
    const hour = now.getHours();

    // Handle quiet hours that span midnight
    if (this.config.quietHoursStart > this.config.quietHoursEnd) {
      // e.g., 23:00 to 06:00
      return hour >= this.config.quietHoursStart || hour < this.config.quietHoursEnd;
    } else {
      // e.g., 00:00 to 07:00
      return hour >= this.config.quietHoursStart && hour < this.config.quietHoursEnd;
    }
  }

  /**
   * Calculates the next scheduled report time.
   */
  getNextReportTime(): Date {
    const now = new Date();
    const hour = now.getHours();
    const result = new Date(now);
    result.setMinutes(0);
    result.setSeconds(0);
    result.setMilliseconds(0);

    if (hour < this.config.morningHour) {
      // Before morning report
      result.setHours(this.config.morningHour);
    } else if (hour < this.config.eveningHour) {
      // After morning, before evening
      result.setHours(this.config.eveningHour);
    } else {
      // After evening report - schedule for next morning
      result.setDate(result.getDate() + 1);
      result.setHours(this.config.morningHour);
    }

    return result;
  }

  /**
   * Starts the scheduled reporter.
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.scheduleNextReport();
    console.log('Reporter started');
  }

  /**
   * Stops the scheduled reporter.
   */
  stop(): void {
    if (this.schedulerInterval) {
      clearTimeout(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    this.running = false;
    console.log('Reporter stopped');
  }

  /**
   * Returns whether the reporter is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Schedules the next report.
   */
  private scheduleNextReport(): void {
    if (!this.running) return;

    const nextTime = this.getNextReportTime();
    const delay = nextTime.getTime() - Date.now();

    this.schedulerInterval = setTimeout(async () => {
      await this.sendScheduledReport();
      this.scheduleNextReport();
    }, delay);
  }

  /**
   * Sends a scheduled report (respects quiet hours).
   */
  async sendScheduledReport(): Promise<ReportResult> {
    if (this.isQuietHours()) {
      return { sent: false, reason: 'quiet_hours' };
    }

    return this.sendReport();
  }

  /**
   * Sends an immediate report (bypasses quiet hours).
   */
  async sendImmediateReport(): Promise<ReportResult> {
    return this.sendReport();
  }

  /**
   * Generates a report without sending it.
   */
  async generateReport(): Promise<GeneratedReport> {
    const metrics = await this.collectMetrics();
    const recommendations = this.recommendationEngine.generateReport(
      metrics.projectMetrics,
      metrics.systemMetrics
    );

    return {
      metrics,
      recommendations,
      timestamp: new Date()
    };
  }

  /**
   * Collects all metrics.
   */
  private async collectMetrics(): Promise<{
    projectMetrics: ProjectMetrics[];
    systemMetrics: SystemMetrics;
  }> {
    const projectMetrics = await this.metricsCollector.collectAllProjectMetrics();
    const systemMetrics = await this.metricsCollector.collectSystemMetrics();

    return { projectMetrics, systemMetrics };
  }

  /**
   * Sends a report to Slack.
   */
  private async sendReport(): Promise<ReportResult> {
    try {
      const report = await this.generateReport();

      // Format the report for Slack
      const formattedReport = formatStatusReport(
        report.metrics,
        report.recommendations
      );

      // Send to Slack
      await sendMessage({
        channel: this.config.slackChannel,
        text: formattedReport
      });

      return {
        sent: true,
        reason: 'success',
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send report: ${errorMessage}`);
      return {
        sent: false,
        reason: 'error',
        error: errorMessage
      };
    }
  }
}
