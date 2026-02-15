# RelayHandler Unit Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive unit tests for `src/relay/handler.ts` covering all exported functions and the `relay()` async flow.

**Architecture:** Test each function in isolation. For the `relay()` function, mock `node:child_process` spawn to return controllable EventEmitter-based process objects. Use the same mock pattern established in `src/agent/cli-adapter.test.ts`.

**Tech Stack:** vitest, node:events (EventEmitter), vi.mock for child_process

**Total Tasks:** 9

---

### Task 1: Scaffold test file with mocks

**Files:**
- Create: `src/relay/handler.test.ts`

**Step 1: Create the test file with child_process mock and logger mock**

```typescript
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
```

**Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/relay/handler.test.ts` or just run `npm run build`
Expected: No errors

---

### Task 2: Test `chunkResponse` (pure function, no mocks needed)

**Files:**
- Modify: `src/relay/handler.test.ts`

**Step 1: Write failing tests for chunkResponse**

```typescript
import { chunkResponse } from './handler.js';

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
    // All chunks should be within limit
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
    // First chunk should end cleanly (not mid-word)
    expect(result[0]).not.toMatch(/\S$/); // Should be trimmed
  });

  it('should fall back to newline splitting', () => {
    // Create text with single newlines but no double newlines
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}: ${'x'.repeat(20)}`);
    const text = lines.join('\n');
    const result = chunkResponse(text, 3800);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(3800);
    }
  });

  it('should fall back to space splitting when no newlines', () => {
    // Long text with spaces but no newlines
    const text = 'word '.repeat(1000); // 5000 chars
    const result = chunkResponse(text, 3800);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(3800);
    }
  });

  it('should hard split when no good boundary found', () => {
    // Single long word with no spaces/newlines
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
});
```

**Step 2: Run tests**

Run: `npx vitest run src/relay/handler.test.ts`
Expected: All chunkResponse tests pass (these test an exported pure function)

**Step 3: Commit**

```bash
git add src/relay/handler.test.ts
git commit -m "test: add chunkResponse unit tests for relay handler"
```

---

### Task 3: Test `buildCLIArgs` via the `relay()` function

Since `buildCLIArgs` is not exported, we test it indirectly by calling `relay()` and inspecting the args passed to `spawn`.

**Files:**
- Modify: `src/relay/handler.test.ts`

**Step 1: Write tests for CLI argument construction**

```typescript
import { relay } from './handler.js';
import type { RelayContext } from './handler.js';
import { spawn } from 'node:child_process';

// Helper to create a mock process that completes immediately
function createMockProcess(exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: ReturnType<typeof vi.fn> };
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn() };
  proc.pid = 12345;
  proc.kill = vi.fn();

  // Schedule process completion on next tick
  process.nextTick(() => {
    proc.emit('exit', exitCode, null);
    proc.emit('close', exitCode, null);
  });

  return proc;
}

const baseContext: RelayContext = {
  channelId: 'C123',
  threadTs: '1234567890.000001',
  projectPath: '/home/user/project',
};

describe('CLI argument construction (via relay)', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cp = await import('node:child_process');
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
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

  it('should set cwd to projectPath', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext);

    const options = mockSpawn.mock.calls[0][2];
    expect(options.cwd).toBe('/home/user/project');
  });

  it('should strip ANTHROPIC_API_KEY from child env', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    // Temporarily set env var
    const orig = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';

    await relay('hello', baseContext);

    const options = mockSpawn.mock.calls[0][2];
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();

    // Restore
    if (orig) process.env.ANTHROPIC_API_KEY = orig;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it('should use shell: true', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    await relay('hello', baseContext);

    const options = mockSpawn.mock.calls[0][2];
    expect(options.shell).toBe(true);
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/relay/handler.test.ts`
Expected: All CLI arg tests pass

**Step 3: Commit**

```bash
git add src/relay/handler.test.ts
git commit -m "test: add CLI argument construction tests for relay handler"
```

---

### Task 4: Test streaming JSON parsing and session ID extraction

**Files:**
- Modify: `src/relay/handler.test.ts`

**Step 1: Write tests for streaming JSON and session extraction**

```typescript
// Helper to create a mock process that emits data, then closes
function createStreamingMockProcess(stdoutChunks: string[], exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: ReturnType<typeof vi.fn> };
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn() };
  proc.pid = 12345;
  proc.kill = vi.fn();

  // Emit data chunks, then close
  process.nextTick(() => {
    for (const chunk of stdoutChunks) {
      proc.stdout.emit('data', Buffer.from(chunk));
    }
    proc.emit('exit', exitCode, null);
    proc.emit('close', exitCode, null);
  });

  return proc;
}

describe('Streaming JSON parsing', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cp = await import('node:child_process');
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
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
    // Split the message in half
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
    // Send result WITHOUT trailing newline - it stays in lineBuffer
    const resultMsg = JSON.stringify({
      type: 'result',
      session_id: 'sess-buffer',
      result: 'Buffered response',
    });
    const proc = createStreamingMockProcess([resultMsg]); // no \n
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.sessionId).toBe('sess-buffer');
    expect(result.response).toBe('Buffered response');
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/relay/handler.test.ts`
Expected: All streaming tests pass

**Step 3: Commit**

```bash
git add src/relay/handler.test.ts
git commit -m "test: add streaming JSON parsing and session ID extraction tests"
```

---

### Task 5: Test error classification

**Files:**
- Modify: `src/relay/handler.test.ts`

**Step 1: Write tests for error classification**

```typescript
import { RelayErrorType } from './handler.js';

describe('Error classification', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cp = await import('node:child_process');
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
  });

  it('should classify ENOENT as CLI_NOT_FOUND', async () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end: vi.fn() };
    proc.pid = 12345;
    proc.kill = vi.fn();
    mockSpawn.mockReturnValue(proc);

    const resultPromise = relay('hello', baseContext);

    // Emit an ENOENT error (CLI not found)
    process.nextTick(() => {
      const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      proc.emit('error', err);
    });

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('CLI not found');
  });

  it('should classify auth errors from stderr', async () => {
    const proc = createStreamingMockProcess([], 1);
    // Override to add stderr
    const origEmit = proc.emit.bind(proc);
    const origProc = proc;
    process.nextTick(() => {
      origProc.stderr.emit('data', Buffer.from('Error: authentication required'));
    });
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('authentication');
  });

  it('should classify timeout errors', async () => {
    // Use a very short timeout
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end: vi.fn() };
    proc.pid = 12345;
    proc.kill = vi.fn();
    mockSpawn.mockReturnValue(proc);

    const resultPromise = relay('hello', baseContext, { timeoutMs: 50 });

    // Don't emit close - let the timeout fire
    // But we need the close event to resolve, which happens after kill
    proc.kill.mockImplementation(() => {
      process.nextTick(() => {
        proc.emit('exit', null, 'SIGTERM');
        proc.emit('close', null, 'SIGTERM');
      });
    });

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('should classify non-zero exit as error with stderr content', async () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end: vi.fn() };
    proc.pid = 12345;
    proc.kill = vi.fn();
    mockSpawn.mockReturnValue(proc);

    const resultPromise = relay('hello', baseContext);

    process.nextTick(() => {
      proc.stderr.emit('data', Buffer.from('Some generic error'));
      proc.emit('exit', 1, null);
      proc.emit('close', 1, null);
    });

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should classify session invalid as RESUME_FAILED', async () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end: vi.fn() };
    proc.pid = 12345;
    proc.kill = vi.fn();
    mockSpawn.mockReturnValue(proc);

    const resultPromise = relay('hello', { ...baseContext, sessionId: 'old-sess' });

    process.nextTick(() => {
      proc.stderr.emit('data', Buffer.from('Error: session not found or invalid'));
      proc.emit('exit', 1, null);
      proc.emit('close', 1, null);
    });

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('previous session unavailable');
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/relay/handler.test.ts`
Expected: All error classification tests pass

**Step 3: Commit**

```bash
git add src/relay/handler.test.ts
git commit -m "test: add error classification tests for relay handler"
```

---

### Task 6: Test timeout behavior and process cleanup

**Files:**
- Modify: `src/relay/handler.test.ts`

**Step 1: Write tests for timeout and cleanup**

```typescript
describe('Timeout behavior and process cleanup', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cp = await import('node:child_process');
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
  });

  it('should kill process with SIGTERM on timeout', async () => {
    const proc = new EventEmitter() as any;
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
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext, { timeoutMs: 50 });

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.success).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(40); // ~50ms timeout
  });

  it('should preserve partial response on timeout', async () => {
    const proc = new EventEmitter() as any;
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
    mockSpawn.mockReturnValue(proc);

    const resultPromise = relay('hello', baseContext, { timeoutMs: 100 });

    // Emit a partial result before timeout
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

  it('should report durationMs in result', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    const result = await relay('hello', baseContext);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe('number');
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/relay/handler.test.ts`
Expected: All timeout tests pass

**Step 3: Commit**

```bash
git add src/relay/handler.test.ts
git commit -m "test: add timeout and process cleanup tests for relay handler"
```

---

### Task 7: Test RelayHandler class and context normalization

**Files:**
- Modify: `src/relay/handler.test.ts`

**Step 1: Write tests for RelayHandler class and context variants**

```typescript
import { RelayHandler } from './handler.js';

describe('RelayHandler class', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cp = await import('node:child_process');
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
  });

  it('should use config values for CLI path and timeout', async () => {
    const proc = createMockProcess(0);
    mockSpawn.mockReturnValue(proc);

    const handler = new RelayHandler({
      cliPath: '/custom/claude',
      timeoutMs: 30000,
      model: 'opus',
    });

    await handler.relay('hello', baseContext);

    expect(mockSpawn).toHaveBeenCalledWith(
      '/custom/claude',
      expect.any(Array),
      expect.any(Object),
    );
    const args: string[] = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--model');
    expect(args).toContain('opus');
  });
});

describe('Context normalization', () => {
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cp = await import('node:child_process');
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
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
});
```

**Step 2: Run tests**

Run: `npx vitest run src/relay/handler.test.ts`
Expected: All class and context tests pass

**Step 3: Commit**

```bash
git add src/relay/handler.test.ts
git commit -m "test: add RelayHandler class and context normalization tests"
```

---

### Task 8: Build and full test suite

**Step 1: Run build**

Run: `npm run build`
Expected: Clean build, no errors

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass, including the new handler.test.ts tests

**Step 3: Final commit (if any adjustments needed)**

```bash
git add src/relay/handler.test.ts
git commit -m "test: add comprehensive unit tests for relay handler (CLI args, streaming, errors, timeout)"
```

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 9: Code Review

**Invoke:** `/code-review`

Review all implementation work for:
- Conventional commits (feat/fix/docs/chore prefixes)
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Test quality: meaningful assertions, no false positives

**Expected:** All issues addressed before proceeding.

### Task 10: Final Verification

After code review passes:
```bash
npm run build    # Must compile cleanly
npm test         # All tests pass
git status       # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
