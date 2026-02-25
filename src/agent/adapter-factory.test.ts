import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  detectAgentMode,
  getAdapter,
  createAdapter,
  isSDKAvailable,
  isCLIAvailable,
  getAvailableModes,
  type AdapterConfig,
} from './adapter-factory.js';
import { SDKAdapter } from './sdk-adapter.js';
import { CLIAdapter } from './cli-adapter.js';

// Mock child_process for isCLIAvailable tests
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

/** Create a mock child process that emits close/stdout events asynchronously */
function createMockChildProcess(exitCode: number, emitOutput: boolean) {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    kill: vi.fn(),
  });
  process.nextTick(() => {
    if (emitOutput) {
      proc.stdout.emit('data', Buffer.from('1.0.0\n'));
    }
    proc.emit('close', exitCode);
  });
  return proc;
}

// Store original env
const originalEnv = { ...process.env };

describe('AdapterFactory', () => {
  beforeEach(async () => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    delete process.env.AGENT_MODE;
    delete process.env.ANTHROPIC_API_KEY;

    // Default: mock spawn to simulate CLI not available
    const cp = await import('node:child_process');
    vi.mocked(cp.spawn).mockImplementation(
      () => createMockChildProcess(1, false) as any,
    );
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('detectAgentMode', () => {
    it('should return explicit mode from config', () => {
      const config: AdapterConfig = { mode: 'sdk' };
      expect(detectAgentMode(config)).toBe('sdk');

      const config2: AdapterConfig = { mode: 'cli' };
      expect(detectAgentMode(config2)).toBe('cli');
    });

    it('should use AGENT_MODE env var when set to sdk', () => {
      process.env.AGENT_MODE = 'sdk';
      expect(detectAgentMode()).toBe('sdk');
    });

    it('should use AGENT_MODE env var when set to cli', () => {
      process.env.AGENT_MODE = 'cli';
      expect(detectAgentMode()).toBe('cli');
    });

    it('should be case-insensitive for AGENT_MODE', () => {
      process.env.AGENT_MODE = 'SDK';
      expect(detectAgentMode()).toBe('sdk');

      process.env.AGENT_MODE = 'CLI';
      expect(detectAgentMode()).toBe('cli');
    });

    it('should default to sdk when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      expect(detectAgentMode()).toBe('sdk');
    });

    it('should default to cli when no API key is set', () => {
      // No AGENT_MODE, no ANTHROPIC_API_KEY
      expect(detectAgentMode()).toBe('cli');
    });

    it('should prefer explicit config over environment', () => {
      process.env.AGENT_MODE = 'sdk';
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const config: AdapterConfig = { mode: 'cli' };
      expect(detectAgentMode(config)).toBe('cli');
    });

    it('should prefer AGENT_MODE over API key detection', () => {
      process.env.AGENT_MODE = 'cli';
      process.env.ANTHROPIC_API_KEY = 'test-key';

      expect(detectAgentMode()).toBe('cli');
    });
  });

  describe('getAdapter', () => {
    it('should return SDKAdapter when mode is sdk', () => {
      const config: AdapterConfig = { mode: 'sdk' };
      const adapter = getAdapter(config);

      // The adapter should have the SDK adapter interface
      expect(adapter).toBeDefined();
      expect(typeof adapter.startQuery).toBe('function');
      expect(typeof adapter.extractUsage).toBe('function');
      expect(typeof adapter.mapToAgentEvent).toBe('function');
    });

    it('should return CLIAdapter when mode is cli', () => {
      const config: AdapterConfig = { mode: 'cli' };
      const adapter = getAdapter(config);

      expect(adapter).toBeDefined();
      expect(typeof adapter.startQuery).toBe('function');
      expect(typeof adapter.extractUsage).toBe('function');
      expect(typeof adapter.mapToAgentEvent).toBe('function');
    });

    it('should return singleton instances', () => {
      const config: AdapterConfig = { mode: 'cli' };
      const adapter1 = getAdapter(config);
      const adapter2 = getAdapter(config);

      expect(adapter1).toBe(adapter2);
    });
  });

  describe('createAdapter', () => {
    it('should create new SDKAdapter instance', () => {
      const config: AdapterConfig = { mode: 'sdk' };
      const adapter1 = createAdapter(config);
      const adapter2 = createAdapter(config);

      // Should be different instances
      expect(adapter1).not.toBe(adapter2);
    });

    it('should create new CLIAdapter instance', () => {
      const config: AdapterConfig = { mode: 'cli' };
      const adapter1 = createAdapter(config);
      const adapter2 = createAdapter(config);

      expect(adapter1).not.toBe(adapter2);
    });

    it('should pass CLI options to CLIAdapter', () => {
      const config: AdapterConfig = {
        mode: 'cli',
        cliPath: '/custom/claude',
        cliTimeout: 30000,
      };

      const adapter = createAdapter(config);
      expect(adapter).toBeDefined();
      // Options are stored internally, verified through behavior
    });
  });

  describe('isSDKAvailable', () => {
    it('should return true when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      expect(isSDKAvailable()).toBe(true);
    });

    it('should return false when ANTHROPIC_API_KEY is not set', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(isSDKAvailable()).toBe(false);
    });

    it('should return false for empty string API key', () => {
      process.env.ANTHROPIC_API_KEY = '';
      expect(isSDKAvailable()).toBe(false);
    });
  });

  describe('isCLIAvailable', () => {
    it('should return a boolean', async () => {
      const result = await isCLIAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('should return true when claude CLI is installed', async () => {
      const cp = await import('node:child_process');
      vi.mocked(cp.spawn).mockImplementation(
        () => createMockChildProcess(0, true) as any,
      );

      const result = await isCLIAvailable();
      expect(result).toBe(true);
    });
  });

  describe('getAvailableModes', () => {
    it('should return mode availability status', async () => {
      const modes = await getAvailableModes();

      expect(modes).toHaveProperty('sdk');
      expect(modes).toHaveProperty('cli');
      expect(modes).toHaveProperty('recommended');
      expect(modes).toHaveProperty('reason');
      expect(typeof modes.sdk).toBe('boolean');
      expect(typeof modes.cli).toBe('boolean');
      expect(['sdk', 'cli']).toContain(modes.recommended);
      expect(typeof modes.reason).toBe('string');
    });

    it('should recommend sdk when only API key is available', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const modes = await getAvailableModes();

      expect(modes.sdk).toBe(true);
      expect(modes.cli).toBe(false);
      expect(modes.recommended).toBe('sdk');
      expect(modes.reason).toContain('Only SDK mode available');
    });

    it('should recommend sdk when both modes are available', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const cp = await import('node:child_process');
      vi.mocked(cp.spawn).mockImplementation(
        () => createMockChildProcess(0, true) as any,
      );

      const modes = await getAvailableModes();

      expect(modes.sdk).toBe(true);
      expect(modes.cli).toBe(true);
      expect(modes.recommended).toBe('sdk');
      expect(modes.reason).toContain('Both modes available');
    });

    it('should recommend cli when no API key but CLI available', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const cp = await import('node:child_process');
      vi.mocked(cp.spawn).mockImplementation(
        () => createMockChildProcess(0, true) as any,
      );

      const modes = await getAvailableModes();

      expect(modes.sdk).toBe(false);
      expect(modes.cli).toBe(true);
      expect(modes.recommended).toBe('cli');
      expect(modes.reason).toContain('Only CLI mode available');
    });
  });
});

describe('AdapterFactory with AgentManager', () => {
  // These tests verify the integration between adapter factory and manager

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENT_MODE;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should work with AgentManager using CLI mode', async () => {
    // Import dynamically to avoid module caching issues
    const { AgentManager } = await import('./manager.js');

    const manager = new AgentManager(undefined, { agentMode: 'cli' });
    expect(manager).toBeDefined();
  });

  it('should work with AgentManager using SDK mode', async () => {
    const { AgentManager } = await import('./manager.js');

    const manager = new AgentManager(undefined, { agentMode: 'sdk' });
    expect(manager).toBeDefined();
  });

  it('should work with AgentManager using adapterConfig', async () => {
    const { AgentManager } = await import('./manager.js');

    const manager = new AgentManager(undefined, {
      adapterConfig: {
        mode: 'cli',
        cliPath: '/custom/claude',
      },
    });
    expect(manager).toBeDefined();
  });
});
