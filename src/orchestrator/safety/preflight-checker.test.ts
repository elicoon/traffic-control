import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreFlightChecker, PreFlightCheckResult, PreFlightStatus } from './preflight-checker.js';
import { checkHealth } from '../../db/client.js';

// Mock logger
vi.mock('../../logging/index.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      time: vi.fn(),
      timeEnd: vi.fn(),
    }),
  },
}));

// Mock the database health check
vi.mock('../../db/client.js', () => ({
  checkHealth: vi.fn(),
}));

const mockedCheckHealth = vi.mocked(checkHealth);

describe('PreFlightChecker', () => {
  // Save and restore env vars
  const savedEnv: Record<string, string | undefined> = {};
  const envVarsToManage = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_APP_TOKEN',
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Save current env values
    for (const key of envVarsToManage) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore env values
    for (const key of envVarsToManage) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  /**
   * Helper: set all required env vars so the environment check passes.
   */
  function setRequiredEnvVars() {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  }

  /**
   * Helper: clear all required env vars.
   */
  function clearRequiredEnvVars() {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  /**
   * Helper: set all optional env vars.
   */
  function setOptionalEnvVars() {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
    process.env.SLACK_APP_TOKEN = 'xapp-test';
  }

  /**
   * Helper: clear all optional env vars.
   */
  function clearOptionalEnvVars() {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_APP_TOKEN;
  }

  // ──────────────────────────────────────────────
  // Database Health Check
  // ──────────────────────────────────────────────
  describe('Database Health Check', () => {
    beforeEach(() => {
      setRequiredEnvVars();
      setOptionalEnvVars();
    });

    it('should pass when checkHealth returns healthy', async () => {
      mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 50 });
      const checker = new PreFlightChecker();

      const status = await checker.runChecks();

      const dbCheck = status.checks.find((c) => c.name === 'database');
      expect(dbCheck).toBeDefined();
      expect(dbCheck!.passed).toBe(true);
      expect(dbCheck!.critical).toBe(true);
      expect(dbCheck!.message).toContain('50');
    });

    it('should fail (critical) when checkHealth returns unhealthy', async () => {
      mockedCheckHealth.mockResolvedValue({
        healthy: false,
        latencyMs: 0,
        error: 'connection timeout',
      });
      const checker = new PreFlightChecker();

      const status = await checker.runChecks();

      const dbCheck = status.checks.find((c) => c.name === 'database');
      expect(dbCheck).toBeDefined();
      expect(dbCheck!.passed).toBe(false);
      expect(dbCheck!.critical).toBe(true);
      expect(dbCheck!.message).toContain('connection timeout');
    });

    it('should fail (critical) when checkHealth throws an error', async () => {
      mockedCheckHealth.mockRejectedValue(new Error('ECONNREFUSED'));
      const checker = new PreFlightChecker();

      const status = await checker.runChecks();

      const dbCheck = status.checks.find((c) => c.name === 'database');
      expect(dbCheck).toBeDefined();
      expect(dbCheck!.passed).toBe(false);
      expect(dbCheck!.critical).toBe(true);
      expect(dbCheck!.message).toContain('ECONNREFUSED');
    });

    it('should skip database check when skipDatabaseCheck is true', async () => {
      mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 10 });
      const checker = new PreFlightChecker({ skipDatabaseCheck: true });

      const status = await checker.runChecks();

      const dbCheck = status.checks.find((c) => c.name === 'database');
      expect(dbCheck).toBeUndefined();
      expect(mockedCheckHealth).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // Environment Variable Validation
  // ──────────────────────────────────────────────
  describe('Environment Variable Validation', () => {
    it('should pass when all required env vars are set', async () => {
      setRequiredEnvVars();
      setOptionalEnvVars();
      const checker = new PreFlightChecker({ skipDatabaseCheck: true });

      const status = await checker.runChecks();

      const envCheck = status.checks.find((c) => c.name === 'environment');
      expect(envCheck).toBeDefined();
      expect(envCheck!.passed).toBe(true);
      expect(envCheck!.message).toContain('All environment variables present');
    });

    it('should fail when required env vars are missing', async () => {
      clearRequiredEnvVars();
      const checker = new PreFlightChecker({ skipDatabaseCheck: true });

      const status = await checker.runChecks();

      const envCheck = status.checks.find((c) => c.name === 'environment');
      expect(envCheck).toBeDefined();
      expect(envCheck!.passed).toBe(false);
      expect(envCheck!.critical).toBe(true);
      expect(envCheck!.message).toContain('SUPABASE_URL');
      expect(envCheck!.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
    });

    it('should fail when only some required env vars are missing', async () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const checker = new PreFlightChecker({ skipDatabaseCheck: true });

      const status = await checker.runChecks();

      const envCheck = status.checks.find((c) => c.name === 'environment');
      expect(envCheck).toBeDefined();
      expect(envCheck!.passed).toBe(false);
      expect(envCheck!.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(envCheck!.message).not.toContain('SUPABASE_URL');
    });

    it('should produce warnings (not failure) when optional env vars are missing', async () => {
      setRequiredEnvVars();
      clearOptionalEnvVars();
      const checker = new PreFlightChecker({ skipDatabaseCheck: true });

      const status = await checker.runChecks();

      const envCheck = status.checks.find((c) => c.name === 'environment');
      expect(envCheck).toBeDefined();
      expect(envCheck!.passed).toBe(true);
      expect(envCheck!.critical).toBe(false);
      expect(envCheck!.message).toContain('Missing optional');
      expect(envCheck!.message).toContain('SLACK_BOT_TOKEN');
    });
  });

  // ──────────────────────────────────────────────
  // Custom Check Support
  // ──────────────────────────────────────────────
  describe('Custom Check Support', () => {
    beforeEach(() => {
      setRequiredEnvVars();
      setOptionalEnvVars();
    });

    it('should execute custom checks in order', async () => {
      const executionOrder: string[] = [];
      const customChecks = [
        async (): Promise<PreFlightCheckResult> => {
          executionOrder.push('first');
          return { name: 'check_first', passed: true, message: 'first ok', critical: false };
        },
        async (): Promise<PreFlightCheckResult> => {
          executionOrder.push('second');
          return { name: 'check_second', passed: true, message: 'second ok', critical: false };
        },
        async (): Promise<PreFlightCheckResult> => {
          executionOrder.push('third');
          return { name: 'check_third', passed: true, message: 'third ok', critical: false };
        },
      ];
      const checker = new PreFlightChecker({ skipDatabaseCheck: true, customChecks });

      const status = await checker.runChecks();

      expect(executionOrder).toEqual(['first', 'second', 'third']);
      // Verify order in results: environment first (always runs), then custom checks
      const checkNames = status.checks.map((c) => c.name);
      expect(checkNames.indexOf('check_first')).toBeLessThan(checkNames.indexOf('check_second'));
      expect(checkNames.indexOf('check_second')).toBeLessThan(checkNames.indexOf('check_third'));
    });

    it('should include a passing custom check in results', async () => {
      const customChecks = [
        async (): Promise<PreFlightCheckResult> => ({
          name: 'redis_check',
          passed: true,
          message: 'Redis connection healthy',
          critical: false,
        }),
      ];
      const checker = new PreFlightChecker({ skipDatabaseCheck: true, customChecks });

      const status = await checker.runChecks();

      const redisCheck = status.checks.find((c) => c.name === 'redis_check');
      expect(redisCheck).toBeDefined();
      expect(redisCheck!.passed).toBe(true);
      expect(redisCheck!.message).toBe('Redis connection healthy');
    });

    it('should fail overall status when a critical custom check fails', async () => {
      const customChecks = [
        async (): Promise<PreFlightCheckResult> => ({
          name: 'critical_service',
          passed: false,
          message: 'Critical service down',
          critical: true,
        }),
      ];
      const checker = new PreFlightChecker({ skipDatabaseCheck: true, customChecks });

      const status = await checker.runChecks();

      expect(status.passed).toBe(false);
      const failedCheck = status.checks.find((c) => c.name === 'critical_service');
      expect(failedCheck).toBeDefined();
      expect(failedCheck!.passed).toBe(false);
      expect(failedCheck!.critical).toBe(true);
    });

    it('should not fail overall status when a non-critical custom check fails', async () => {
      const customChecks = [
        async (): Promise<PreFlightCheckResult> => ({
          name: 'optional_service',
          passed: false,
          message: 'Optional service unavailable',
          critical: false,
        }),
      ];
      const checker = new PreFlightChecker({ skipDatabaseCheck: true, customChecks });

      const status = await checker.runChecks();

      expect(status.passed).toBe(true);
      const failedCheck = status.checks.find((c) => c.name === 'optional_service');
      expect(failedCheck).toBeDefined();
      expect(failedCheck!.passed).toBe(false);
      expect(failedCheck!.critical).toBe(false);
    });

    it('should catch and record a custom check that throws', async () => {
      const customChecks = [
        async (): Promise<PreFlightCheckResult> => {
          throw new Error('Unexpected failure in custom check');
        },
      ];
      const checker = new PreFlightChecker({ skipDatabaseCheck: true, customChecks });

      const status = await checker.runChecks();

      const errorCheck = status.checks.find((c) => c.name === 'custom_check');
      expect(errorCheck).toBeDefined();
      expect(errorCheck!.passed).toBe(false);
      expect(errorCheck!.critical).toBe(false);
      expect(errorCheck!.message).toContain('Unexpected failure in custom check');
    });

    it('should run multiple custom checks even if one throws', async () => {
      const customChecks = [
        async (): Promise<PreFlightCheckResult> => ({
          name: 'before_throw',
          passed: true,
          message: 'ok',
          critical: false,
        }),
        async (): Promise<PreFlightCheckResult> => {
          throw new Error('boom');
        },
        async (): Promise<PreFlightCheckResult> => ({
          name: 'after_throw',
          passed: true,
          message: 'still runs',
          critical: false,
        }),
      ];
      const checker = new PreFlightChecker({ skipDatabaseCheck: true, customChecks });

      const status = await checker.runChecks();

      const names = status.checks.map((c) => c.name);
      expect(names).toContain('before_throw');
      expect(names).toContain('custom_check'); // the thrown one
      expect(names).toContain('after_throw');
    });
  });

  // ──────────────────────────────────────────────
  // Overall Status Logic
  // ──────────────────────────────────────────────
  describe('Overall Status', () => {
    beforeEach(() => {
      setRequiredEnvVars();
      setOptionalEnvVars();
    });

    it('should be passed=false if ANY critical check fails', async () => {
      mockedCheckHealth.mockResolvedValue({
        healthy: false,
        latencyMs: 0,
        error: 'database down',
      });
      const checker = new PreFlightChecker();

      const status = await checker.runChecks();

      expect(status.passed).toBe(false);
      expect(status.summary).toContain('critical failure');
    });

    it('should be passed=true if only non-critical checks fail', async () => {
      mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 20 });
      // Non-critical custom check that fails
      const customChecks = [
        async (): Promise<PreFlightCheckResult> => ({
          name: 'non_critical',
          passed: false,
          message: 'not important',
          critical: false,
        }),
      ];
      const checker = new PreFlightChecker({ customChecks });

      const status = await checker.runChecks();

      expect(status.passed).toBe(true);
    });

    it('should be passed=true when all checks pass', async () => {
      mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 15 });
      const checker = new PreFlightChecker();

      const status = await checker.runChecks();

      expect(status.passed).toBe(true);
    });

    it('should include a timestamp', async () => {
      mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 10 });
      const checker = new PreFlightChecker();

      const before = new Date();
      const status = await checker.runChecks();
      const after = new Date();

      expect(status.timestamp).toBeInstanceOf(Date);
      expect(status.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(status.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should include all checks in order (database, environment, custom)', async () => {
      mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 5 });
      const customChecks = [
        async (): Promise<PreFlightCheckResult> => ({
          name: 'custom_alpha',
          passed: true,
          message: 'ok',
          critical: false,
        }),
        async (): Promise<PreFlightCheckResult> => ({
          name: 'custom_beta',
          passed: true,
          message: 'ok',
          critical: false,
        }),
      ];
      const checker = new PreFlightChecker({ customChecks });

      const status = await checker.runChecks();

      const names = status.checks.map((c) => c.name);
      expect(names).toEqual(['database', 'environment', 'custom_alpha', 'custom_beta']);
    });

    it('should include summary with pass count', async () => {
      mockedCheckHealth.mockResolvedValue({ healthy: true, latencyMs: 10 });
      const checker = new PreFlightChecker();

      const status = await checker.runChecks();

      // 2 checks: database and environment, both pass
      expect(status.summary).toContain('2/2');
    });
  });

  // ──────────────────────────────────────────────
  // formatForSlack
  // ──────────────────────────────────────────────
  describe('formatForSlack', () => {
    let checker: PreFlightChecker;

    beforeEach(() => {
      setRequiredEnvVars();
      setOptionalEnvVars();
      checker = new PreFlightChecker({ skipDatabaseCheck: true });
    });

    it('should produce readable output for a passing status', () => {
      const status: PreFlightStatus = {
        passed: true,
        checks: [
          { name: 'database', passed: true, message: 'Database healthy (latency: 10ms)', critical: true },
          { name: 'environment', passed: true, message: 'All environment variables present', critical: false },
        ],
        timestamp: new Date('2026-02-14T12:00:00Z'),
        summary: '2/2 checks passed',
      };

      const output = checker.formatForSlack(status);

      expect(output).toContain('[OK]');
      expect(output).toContain('Preflight Check');
      expect(output).toContain('database');
      expect(output).toContain('environment');
      expect(output).toContain('Check Results');
      // Should NOT contain the abort prompt when passed
      expect(output).not.toContain('abort');
    });

    it('should produce readable output for a failing status', () => {
      const status: PreFlightStatus = {
        passed: false,
        checks: [
          { name: 'database', passed: false, message: 'Database unhealthy: connection timeout', critical: true },
          { name: 'environment', passed: true, message: 'All environment variables present', critical: false },
        ],
        timestamp: new Date('2026-02-14T12:00:00Z'),
        summary: '1/2 checks passed, 1 critical failures',
      };

      const output = checker.formatForSlack(status);

      expect(output).toContain('[FAIL]');
      expect(output).toContain('database');
      expect(output).toContain('connection timeout');
      // Should contain abort prompt when failed
      expect(output).toContain('confirm start');
      expect(output).toContain('abort');
    });

    it('should show [WARN] for non-critical failures', () => {
      const status: PreFlightStatus = {
        passed: true,
        checks: [
          { name: 'optional_service', passed: false, message: 'Service unavailable', critical: false },
        ],
        timestamp: new Date('2026-02-14T12:00:00Z'),
        summary: '0/1 checks passed',
      };

      const output = checker.formatForSlack(status);

      expect(output).toContain('[WARN]');
      expect(output).toContain('optional_service');
    });

    it('should include the ISO timestamp', () => {
      const timestamp = new Date('2026-02-14T12:00:00Z');
      const status: PreFlightStatus = {
        passed: true,
        checks: [],
        timestamp,
        summary: '0/0 checks passed',
      };

      const output = checker.formatForSlack(status);

      expect(output).toContain(timestamp.toISOString());
    });

    it('should include the summary string', () => {
      const status: PreFlightStatus = {
        passed: true,
        checks: [],
        timestamp: new Date(),
        summary: '3/3 checks passed',
      };

      const output = checker.formatForSlack(status);

      expect(output).toContain('3/3 checks passed');
    });
  });

  // ──────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────
  describe('constructor', () => {
    it('should create an instance with default config', () => {
      const checker = new PreFlightChecker();
      expect(checker).toBeDefined();
    });

    it('should create an instance with partial config', () => {
      const checker = new PreFlightChecker({ skipDatabaseCheck: true });
      expect(checker).toBeDefined();
    });

    it('should create an instance with full config', () => {
      const checker = new PreFlightChecker({
        skipDatabaseCheck: true,
        skipSlackCheck: true,
        customChecks: [],
      });
      expect(checker).toBeDefined();
    });
  });
});
