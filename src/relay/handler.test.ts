/**
 * Tests for RelayHandler - CLI spawning, streaming JSON parsing,
 * session ID extraction, error classification, response chunking, timeout behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock logging to silence output during tests
vi.mock('../logging/index.js', () => ({
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

// Mock child_process - must be before handler import
vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(),
    ChildProcess: class {},
  };
});

import { chunkResponse, relay, RelayHandler, RelayErrorType } from './handler.js';
import type { RelayContext } from './handler.js';

// ---------- Test helpers ----------

interface MockProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: ReturnType<typeof vi.fn> };
  pid: number;
  kill: ReturnType<typeof vi.fn>;
}

/** Create a mock process that completes immediately with given exit code */
function createMockProcess(exitCode = 0): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn() };
  proc.pid = 12345;
  proc.kill = vi.fn();

  process.nextTick(() => {
    proc.emit('exit', exitCode, null);
    proc.emit('close', exitCode, null);
  });

  return proc;
}

/** Create a mock process that emits stdout data chunks, then closes */
function createStreamingMockProcess(stdoutChunks: string[], exitCode = 0): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn() };
  proc.pid = 12345;
  proc.kill = vi.fn();

  process.nextTick(() => {
    for (const chunk of stdoutChunks) {
      proc.stdout.emit('data', Buffer.from(chunk));
    }
    proc.emit('exit', exitCode, null);
    proc.emit('close', exitCode, null);
  });

  return proc;
}

/** Create a mock process that does not auto-close (for timeout tests) */
function createHangingMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn() };
  proc.pid = 12345;
  proc.kill = vi.fn().mockImplementation(() => {
    process.nextTick(() => {
      proc.emit('exit', null, 'SIGTERM');
      proc.emit('close', null, 'SIGTERM');
    });
  });

  return proc;
}

const baseContext: RelayContext = {
  channelId: 'C123',
  threadTs: '1234567890.000001',
  projectPath: '/home/user/project',
};

/** Get the mocked spawn function */
async function getMockSpawn() {
  const cp = await import('node:child_process');
  return cp.spawn as unknown as ReturnType<typeof vi.fn>;
}

// Restore all mocks after each test to prevent leaking between describe blocks
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- Tests ----------

describe('chunkResponse', () => {
  it('should return single chunk for short text', () => {
    const result = chunkResponse('Hello world');
    expect(result).toEqual(['Hello world']);
  });

  it('should return single chunk for text exactly at limit', () => {
    const text = 'a'.repeat(3800);
    const result = chunkResponse(text);
    expect(result).toEqual([text]);
  });

  it('should split text exceeding maxLength', () => {
    const text = 'a'.repeat(4000);
    const result = chunkResponse(text, 3800);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(3800);
    }
  });

  it('should prefer splitting at paragraph boundaries', () => {
    const paragraph1 = 'First paragraph. '.repeat(100); // ~1700 chars
    const paragraph2 = 'Second paragraph. '.repeat(100); // ~1800 chars
    const paragraph3 = 'Third paragraph. '.repeat(100); // ~1800 chars
    const text = `${paragraph1}\n\n${paragraph2}\n\n${paragraph3}`;
    const result = chunkResponse(text, 3800);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Reassembled text should contain all content
    const reassembled = result.join(' ');
    expect(reassembled).toContain('First paragraph');
    expect(reassembled).toContain('Third paragraph');
  });

  it('should fall back to newline splitting', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}: ${'x'.repeat(20)}`);
    const text = lines.join('\n');
    const result = chunkResponse(text, 3800);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(3800);
    }
  });

  it('should fall back to space splitting when no newlines', () => {
    const text = 'word '.repeat(1000); // 5000 chars
    const result = chunkResponse(text, 3800);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(3800);
    }
  });

  it('should hard split when no good boundary found', () => {
    const text = 'a'.repeat(8000);
    const result = chunkResponse(text, 3800);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(3800);
    }
  });

  it('should accept custom maxLength', () => {
    const text = 'a'.repeat(200);
    const result = chunkResponse(text, 100);
    expect(result.length).toBe(2);
  });

  it('should handle empty string', () => {
    const result = chunkResponse('');
    expect(result).toEqual(['']);
  });

  it('should rejoin to contain all original content', () => {
    const text = 'Hello world. This is a test. '.repeat(200);
    const chunks = chunkResponse(text, 500);
    const rejoined = chunks.join(' ');
    // Every word from original should appear
    expect(rejoined).toContain('Hello world');
    expect(rejoined).toContain('This is a test');
  });
});

describe('CLI argument construction (via relay)', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn = await getMockSpawn();
  });

  it('should include --print, --output-format stream-json, --verbose, --dangerously-skip-permissions', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext);

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--print');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('should NOT include --model for default sonnet', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext, { model: 'sonnet' });

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).not.toContain('--model');
  });

  it('should include --model for opus', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext, { model: 'opus' });

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--model');
    expect(args).toContain('opus');
  });

  it('should include --resume with session ID when provided', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', { ...baseContext, sessionId: 'sess-abc123' });

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--resume');
    expect(args).toContain('sess-abc123');
  });

  it('should NOT include --resume when no session ID', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext);

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).not.toContain('--resume');
  });

  it('should put the message as last arg wrapped in quotes', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello world', baseContext);

    const args: string[] = mockSpawn.mock.calls[0][1];
    const lastArg = args[args.length - 1];
    expect(lastArg).toBe('"hello world"');
  });

  it('should escape double quotes in message', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('say "hi"', baseContext);

    const args: string[] = mockSpawn.mock.calls[0][1];
    const lastArg = args[args.length - 1];
    expect(lastArg).toBe('"say ""hi"""');
  });

  it('should set cwd to projectPath', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext);

    const options = mockSpawn.mock.calls[0][2];
    expect(options.cwd).toBe('/home/user/project');
  });

  it('should strip ANTHROPIC_API_KEY from child env', async () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    try {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc);

      await relay('hello', baseContext);

      const options = mockSpawn.mock.calls[0][2];
      expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      if (orig !== undefined) process.env.ANTHROPIC_API_KEY = orig;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('should strip CI from child env', async () => {
    const orig = process.env.CI;
    process.env.CI = 'true';
    try {
      const proc = createMockProcess(0);
      mockSpawn.mockReturnValue(proc);

      await relay('hello', baseContext);

      const options = mockSpawn.mock.calls[0][2];
      expect(options.env.CI).toBeUndefined();
    } finally {
      if (orig !== undefined) process.env.CI = orig;
      else delete process.env.CI;
    }
  });

  it('should use shell: true', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext);

    const options = mockSpawn.mock.calls[0][2];
    expect(options.shell).toBe(true);
  });

  it('should use custom cliPath when provided', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext, { cliPath: '/opt/claude-bin' });

    expect(mockSpawn.mock.calls[0][0]).toBe('/opt/claude-bin');
  });
});

describe('Streaming JSON parsing', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn = await getMockSpawn();
  });

  it('should extract session ID from result message', async () => {
    const resultMsg = JSON.stringify({
      type: 'result',
      session_id: 'sess-xyz789',
      result: 'Hello from Claude',
    });
    const proc = createStreamingMockProcess([resultMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.sessionId).toBe('sess-xyz789');
    expect(result.response).toBe('Hello from Claude');
    expect(result.success).toBe(true);
  });

  it('should extract response text from result field', async () => {
    const resultMsg = JSON.stringify({
      type: 'result',
      result: 'The answer is 42',
    });
    const proc = createStreamingMockProcess([resultMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('question', baseContext);

    expect(result.response).toBe('The answer is 42');
  });

  it('should extract response text from message.content text blocks', async () => {
    const resultMsg = JSON.stringify({
      type: 'result',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
    });
    const proc = createStreamingMockProcess([resultMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('question', baseContext);

    expect(result.response).toBe('Part 1\nPart 2');
  });

  it('should handle partial JSON chunks split across data events', async () => {
    const fullMsg = JSON.stringify({
      type: 'result',
      session_id: 'sess-partial',
      result: 'Split response',
    });
    const mid = Math.floor(fullMsg.length / 2);
    const chunk1 = fullMsg.substring(0, mid);
    const chunk2 = fullMsg.substring(mid) + '\n';

    const proc = createStreamingMockProcess([chunk1, chunk2]);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.sessionId).toBe('sess-partial');
    expect(result.response).toBe('Split response');
    expect(result.success).toBe(true);
  });

  it('should handle multiple JSON messages in stream', async () => {
    const msg1 = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/file.ts' } }],
      },
    });
    const msg2 = JSON.stringify({
      type: 'result',
      session_id: 'sess-multi',
      result: 'Final answer',
    });
    const proc = createStreamingMockProcess([msg1 + '\n' + msg2 + '\n']);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.sessionId).toBe('sess-multi');
    expect(result.response).toBe('Final answer');
  });

  it('should skip malformed JSON lines gracefully', async () => {
    const badLine = '{malformed json\n';
    const goodMsg = JSON.stringify({
      type: 'result',
      result: 'Good response',
    });
    const proc = createStreamingMockProcess([badLine + goodMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.response).toBe('Good response');
    expect(result.success).toBe(true);
  });

  it('should skip non-JSON lines (plain text)', async () => {
    const plainText = 'Some random CLI output\n';
    const goodMsg = JSON.stringify({
      type: 'result',
      result: 'Good response',
    });
    const proc = createStreamingMockProcess([plainText + goodMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.response).toBe('Good response');
  });

  it('should handle result in remaining line buffer on close', async () => {
    const resultMsg = JSON.stringify({
      type: 'result',
      session_id: 'sess-buffer',
      result: 'Buffered response',
    });
    // No trailing newline - stays in lineBuffer until close
    const proc = createStreamingMockProcess([resultMsg]);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.sessionId).toBe('sess-buffer');
    expect(result.response).toBe('Buffered response');
  });

  it('should return empty response when no result message received', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.response).toBe('');
    expect(result.sessionId).toBeNull();
    expect(result.success).toBe(true);
  });

  it('should fall back to message.content when result is empty string', async () => {
    const resultMsg = JSON.stringify({
      type: 'result',
      result: '',
      message: {
        content: [{ type: 'text', text: 'Content fallback' }],
      },
    });
    const proc = createStreamingMockProcess([resultMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.response).toBe('Content fallback');
  });

  it('should prefer result field over message.content when both present', async () => {
    const resultMsg = JSON.stringify({
      type: 'result',
      result: 'Result field text',
      message: {
        content: [{ type: 'text', text: 'Content block text' }],
      },
    });
    const proc = createStreamingMockProcess([resultMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.response).toBe('Result field text');
  });
});

describe('Error classification', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn = await getMockSpawn();
  });

  /** Helper: create a mock process that emits stderr then exits with code 1 */
  function createFailingProcessWithStderr(stderrText: string): MockProcess {
    const proc = new EventEmitter() as MockProcess;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end: vi.fn() };
    proc.pid = 12345;
    proc.kill = vi.fn();

    process.nextTick(() => {
      proc.stderr.emit('data', Buffer.from(stderrText));
      proc.emit('exit', 1, null);
      proc.emit('close', 1, null);
    });

    return proc;
  }

  it('should classify ENOENT as CLI_NOT_FOUND', async () => {
    const proc = createHangingMockProcess();
    proc.kill = vi.fn(); // Override so it doesn't auto-close
    mockSpawn.mockReturnValue(proc);

    const resultPromise = relay('hello', baseContext);

    process.nextTick(() => {
      const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      proc.emit('error', err);
    });

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('CLI not found');
  });

  it('should classify "not found" as CLI_NOT_FOUND', async () => {
    const proc = createHangingMockProcess();
    proc.kill = vi.fn();
    mockSpawn.mockReturnValue(proc);

    const resultPromise = relay('hello', baseContext);

    process.nextTick(() => {
      proc.emit('error', new Error('command not found'));
    });

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('CLI not found');
  });

  it('should classify auth errors from stderr', async () => {
    const proc = createFailingProcessWithStderr('Error: authentication required');
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('authentication');
  });

  it('should classify login requirement as AUTH_NEEDED', async () => {
    const proc = createFailingProcessWithStderr('Please login first');
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('authentication');
  });

  it('should classify session invalid as RESUME_FAILED', async () => {
    // Note: stderr must use "session" + "invalid" without "not found",
    // because classifyError checks "not found" for CLI_NOT_FOUND before
    // checking the session+invalid combination for RESUME_FAILED.
    const proc = createFailingProcessWithStderr('Error: session is invalid');
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', { ...baseContext, sessionId: 'old-sess' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('previous session unavailable');
  });

  it('should classify generic exit code as UNKNOWN error', async () => {
    const proc = createFailingProcessWithStderr('Something unexpected happened');
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Something went wrong');
  });

  it('should include stderr content in error message for non-zero exit', async () => {
    const proc = createFailingProcessWithStderr('Detailed error info here');
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.error).toContain('Detailed error info here');
  });
});

describe('Timeout behavior and process cleanup', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn = await getMockSpawn();
  });

  it('should kill process with SIGTERM on timeout', async () => {
    const proc = createHangingMockProcess();
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext, { timeoutMs: 50 });

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('should report durationMs on timeout', async () => {
    const proc = createHangingMockProcess();
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext, { timeoutMs: 50 });

    expect(result.durationMs).toBeGreaterThanOrEqual(40);
    expect(typeof result.durationMs).toBe('number');
  });

  it('should preserve partial response on timeout', async () => {
    const proc = createHangingMockProcess();
    mockSpawn.mockReturnValue(proc);

    const resultPromise = relay('hello', baseContext, { timeoutMs: 200 });

    // Emit a result before timeout fires
    const partialMsg = JSON.stringify({
      type: 'result',
      session_id: 'sess-timeout',
      result: 'Partial response before timeout',
    });
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from(partialMsg + '\n'));
    });

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.sessionId).toBe('sess-timeout');
    expect(result.response).toBe('Partial response before timeout');
  });

  it('should close stdin immediately after spawn', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext);

    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it('should report durationMs in successful result', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe('number');
  });

  it('should return sessionId as null on timeout without session data', async () => {
    const proc = createHangingMockProcess();
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext, { timeoutMs: 50 });

    expect(result.sessionId).toBeNull();
  });
});

describe('Progress callback', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn = await getMockSpawn();
  });

  it('should invoke progress callback for tool_use messages', async () => {
    const progressFn = vi.fn().mockResolvedValue(undefined);
    const toolMsg = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/test.ts' } }],
      },
    });
    const resultMsg = JSON.stringify({ type: 'result', result: 'done' });
    const proc = createStreamingMockProcess([toolMsg + '\n' + resultMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', { ...baseContext, onProgress: progressFn }, { progressIntervalMs: 0 });

    expect(progressFn).toHaveBeenCalled();
    const callArg = progressFn.mock.calls[0][0];
    expect(callArg).toContain('Reading');
  });

  it('should invoke progress callback for standalone tool_use message type', async () => {
    const progressFn = vi.fn().mockResolvedValue(undefined);
    const toolMsg = JSON.stringify({
      type: 'tool_use',
      tool_name: 'Bash',
    });
    const resultMsg = JSON.stringify({ type: 'result', result: 'done' });
    const proc = createStreamingMockProcess([toolMsg + '\n' + resultMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', { ...baseContext, onProgress: progressFn }, { progressIntervalMs: 0 });

    expect(progressFn).toHaveBeenCalled();
    const callArg = progressFn.mock.calls[0][0];
    expect(callArg).toContain('Running command');
  });

  it('should rate-limit progress updates', async () => {
    const progressFn = vi.fn().mockResolvedValue(undefined);
    // Two tool_use messages very close together
    const msg1 = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] },
    });
    const msg2 = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] },
    });
    const resultMsg = JSON.stringify({ type: 'result', result: 'done' });
    const proc = createStreamingMockProcess([msg1 + '\n' + msg2 + '\n' + resultMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    // Large interval so second update is suppressed
    await relay('hello', { ...baseContext, onProgress: progressFn }, { progressIntervalMs: 60000 });

    // Only one should get through due to rate limiting
    expect(progressFn).toHaveBeenCalledTimes(1);
  });
});

describe('RelayHandler class', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn = await getMockSpawn();
  });

  it('should use config values for CLI path and model', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    const handler = new RelayHandler({
      cliPath: '/custom/claude',
      timeoutMs: 30000,
      model: 'opus',
    });

    await handler.relay('hello', baseContext);

    expect(mockSpawn.mock.calls[0][0]).toBe('/custom/claude');
    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--model');
    expect(args).toContain('opus');
  });

  it('should delegate to the relay function', async () => {
    const resultMsg = JSON.stringify({
      type: 'result',
      session_id: 'sess-class',
      result: 'Class response',
    });
    const proc = createStreamingMockProcess([resultMsg + '\n']);
    mockSpawn.mockReturnValue(proc);

    const handler = new RelayHandler({
      cliPath: 'claude',
      timeoutMs: 60000,
      model: 'sonnet',
    });

    const result = await handler.relay('hello', baseContext);

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('sess-class');
    expect(result.response).toBe('Class response');
  });
});

describe('Context normalization', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn = await getMockSpawn();
  });

  it('should accept channelId field', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', {
      channelId: 'C123',
      threadTs: '123.456',
      projectPath: '/tmp/proj',
    });

    expect(result.success).toBe(true);
  });

  it('should accept channel field as fallback', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', {
      channel: 'C456',
      threadTs: '123.456',
      projectPath: '/tmp/proj',
    });

    expect(result.success).toBe(true);
  });

  it('should accept existingSessionId as fallback for sessionId', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', {
      channelId: 'C123',
      threadTs: '123.456',
      projectPath: '/tmp/proj',
      existingSessionId: 'sess-legacy',
    });

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--resume');
    expect(args).toContain('sess-legacy');
  });

  it('should prefer sessionId over existingSessionId', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', {
      channelId: 'C123',
      threadTs: '123.456',
      projectPath: '/tmp/proj',
      sessionId: 'sess-primary',
      existingSessionId: 'sess-fallback',
    });

    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--resume');
    expect(args).toContain('sess-primary');
    expect(args).not.toContain('sess-fallback');
  });
});
