# Plan: Add Vitest Coverage Reporting

> **Total Tasks: 7** (4 implementation + 3 verification)

## Context

- Vitest 4.0.18 already configured as test runner
- 2042+ tests, no coverage reporting
- Need v8 coverage provider (faster than istanbul for Node.js)
- Files to modify: `vitest.config.ts`, `package.json`, `.gitignore`

## Implementation

### Task 1: Install @vitest/coverage-v8

```bash
cd /home/eli/projects/traffic-control && npm install -D @vitest/coverage-v8
```

**Verify:** `@vitest/coverage-v8` appears in `devDependencies` in package.json.

### Task 2: Add coverage configuration to vitest.config.ts

Add `coverage` block to the existing `test` config:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'html'],
  reportsDirectory: './coverage',
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/test-setup.ts',
  ],
},
```

**Verify:** File parses without syntax errors.

### Task 3: Add test:coverage script to package.json

Add to scripts:
```json
"test:coverage": "vitest run --coverage"
```

**Verify:** `npm run test:coverage --help` doesn't error.

### Task 4: Add coverage/ to .gitignore

Append `coverage/` line to `.gitignore`.

**Verify:** `grep coverage .gitignore` returns the line.

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 5: Run test:coverage and verify output

```bash
npm run test:coverage
```

**Expected:** All tests pass, coverage summary printed to stdout with line/branch/function percentages, `coverage/` directory created with HTML report.

### Task 6: Code Review

**Invoke:** `/code-review`

Review all implementation work for:
- Conventional commits (feat/fix/docs/chore prefixes)
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Documentation updated where needed

**Expected:** All issues addressed before proceeding.

### Task 7: Final Commit

After verification passes:
```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
