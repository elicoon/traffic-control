/**
 * PreFlight Checker
 *
 * Performs system health checks before starting the orchestration loop.
 * Ensures all required services are available and properly configured.
 */

import { checkHealth, HealthCheckResult } from '../../db/client.js';
import { logger } from '../../logging/index.js';

const log = logger.child('Safety.PreFlightChecker');

/**
 * Result of a single preflight check
 */
export interface PreFlightCheckResult {
  name: string;
  passed: boolean;
  message: string;
  critical: boolean;
}

/**
 * Overall preflight status
 */
export interface PreFlightStatus {
  passed: boolean;
  checks: PreFlightCheckResult[];
  timestamp: Date;
  summary: string;
}

/**
 * Configuration for preflight checks
 */
export interface PreFlightConfig {
  /** Skip database check */
  skipDatabaseCheck?: boolean;
  /** Skip Slack check */
  skipSlackCheck?: boolean;
  /** Custom checks to run */
  customChecks?: Array<() => Promise<PreFlightCheckResult>>;
}

/**
 * PreFlight Checker - validates system readiness before starting
 */
export class PreFlightChecker {
  private config: PreFlightConfig;

  constructor(config: PreFlightConfig = {}) {
    this.config = config;
  }

  /**
   * Run all preflight checks
   */
  async runChecks(): Promise<PreFlightStatus> {
    log.info('Starting preflight checks');
    const checks: PreFlightCheckResult[] = [];

    // Database check
    if (!this.config.skipDatabaseCheck) {
      const dbCheck = await this.checkDatabase();
      checks.push(dbCheck);
    }

    // Environment variables check
    const envCheck = this.checkEnvironment();
    checks.push(envCheck);

    // Run custom checks
    if (this.config.customChecks) {
      for (const customCheck of this.config.customChecks) {
        try {
          const result = await customCheck();
          checks.push(result);
        } catch (error) {
          checks.push({
            name: 'custom_check',
            passed: false,
            message: `Custom check failed: ${error instanceof Error ? error.message : String(error)}`,
            critical: false,
          });
        }
      }
    }

    const criticalFailures = checks.filter((c) => c.critical && !c.passed);
    const allPassed = criticalFailures.length === 0;
    const passedCount = checks.filter((c) => c.passed).length;

    const status: PreFlightStatus = {
      passed: allPassed,
      checks,
      timestamp: new Date(),
      summary: `${passedCount}/${checks.length} checks passed${
        criticalFailures.length > 0
          ? `, ${criticalFailures.length} critical failures`
          : ''
      }`,
    };

    if (allPassed) {
      log.info('Preflight checks passed', { summary: status.summary });
    } else {
      log.error('Preflight checks failed', undefined, {
        summary: status.summary,
        criticalFailures: criticalFailures.map((c) => c.name),
      });
    }

    return status;
  }

  /**
   * Check database connectivity
   */
  private async checkDatabase(): Promise<PreFlightCheckResult> {
    log.debug('Checking database connectivity');
    try {
      const result: HealthCheckResult = await checkHealth();
      return {
        name: 'database',
        passed: result.healthy,
        message: result.healthy
          ? `Database healthy (latency: ${result.latencyMs}ms)`
          : `Database unhealthy: ${result.error || 'Unknown error'}`,
        critical: true,
      };
    } catch (error) {
      return {
        name: 'database',
        passed: false,
        message: `Database check failed: ${error instanceof Error ? error.message : String(error)}`,
        critical: true,
      };
    }
  }

  /**
   * Check required environment variables
   */
  private checkEnvironment(): PreFlightCheckResult {
    log.debug('Checking environment variables');
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const optional = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_TOKEN'];

    const missingRequired = required.filter((key) => !process.env[key]);
    const missingOptional = optional.filter((key) => !process.env[key]);

    if (missingRequired.length > 0) {
      return {
        name: 'environment',
        passed: false,
        message: `Missing required env vars: ${missingRequired.join(', ')}`,
        critical: true,
      };
    }

    if (missingOptional.length > 0) {
      return {
        name: 'environment',
        passed: true,
        message: `All required vars present. Missing optional: ${missingOptional.join(', ')}`,
        critical: false,
      };
    }

    return {
      name: 'environment',
      passed: true,
      message: 'All environment variables present',
      critical: false,
    };
  }

  /**
   * Format preflight status for Slack notification
   */
  formatForSlack(status: PreFlightStatus): string {
    const statusIcon = status.passed ? '[OK]' : '[FAIL]';
    const lines: string[] = [
      `*Preflight Check ${statusIcon}*`,
      `_${status.timestamp.toISOString()}_`,
      '',
      status.summary,
      '',
      '*Check Results:*',
    ];

    for (const check of status.checks) {
      const icon = check.passed ? '[OK]' : check.critical ? '[FAIL]' : '[WARN]';
      lines.push(`${icon} ${check.name}: ${check.message}`);
    }

    if (!status.passed) {
      lines.push('');
      lines.push('_Reply "confirm start" to proceed anyway, or "abort" to cancel._');
    }

    return lines.join('\n');
  }
}
