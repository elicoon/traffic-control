# Plan: Backlog Markdown Generator & Importer Tests

**Created:** 2026-02-16
**Source:** workforce-scoper dispatch
**Total Tasks:** 6 (3 implementation + 3 verification)

---

## Context

The backlog module has `markdown-generator.ts` and `markdown-importer.ts` with zero test coverage. These handle serialization of `BacklogItem` objects to/from markdown files. Bugs in parsing or generation could silently corrupt proposal data.

### Key Design Decision: Unit Tests, Not Integration Tests

The existing backlog tests (backlog-manager, validator) are integration tests hitting real Supabase. However, the markdown generator and importer have pure-function cores that can be tested without a database:

- **Generator**: `generate(item)` takes a `BacklogItem` and returns a string — pure function
- **Generator**: `generateFilename(item)` — pure function
- **Importer**: `parseMarkdown(content)` — private but exercised through `extractBacklogItemInput()` indirectly

For methods that touch the filesystem (`writeItem`, `syncAll`) or DB (`importFile`, `importAll`), we'll use `vi.mock()` to mock `fs/promises` and the repository.

---

## Task 1: Create markdown-generator.test.ts

**File:** `src/backlog/markdown-generator.test.ts`

Test the `BacklogMarkdownGenerator` class:

1. **`generate()` — full item**: Pass a complete `BacklogItem` with all fields populated, verify output contains all expected sections (title, priority, type, status, dates, description, classification, estimates, reasoning, acceptance criteria, tags, related items, work items, metadata)
2. **`generate()` — minimal item**: Pass a `BacklogItem` with only required fields (null/empty optionals), verify output omits optional sections cleanly
3. **`generate()` — special characters in title**: Title with `#`, `*`, backticks, pipes — verify they appear in output without breaking markdown structure
4. **`generate()` — updated_at differs from created_at**: Verify "Updated" line appears
5. **`generate()` — updated_at equals created_at**: Verify "Updated" line is absent
6. **`generateFilename()`**: Verify kebab-case slug + ID prefix + `.md` extension
7. **`generateFilename()` — special characters**: Title with spaces, symbols → clean slug
8. **`generateFilename()` — long title**: Title > 50 chars → truncated slug
9. **`generateFile()`**: Returns object with both filename and content
10. **`writeItem()`**: Mock `fs/promises`, verify `mkdir` + `writeFile` called with correct paths
11. **`syncAll()`**: Mock `fs/promises`, verify batch write + orphan archival logic

### Test Data Factory

Create a helper `makeBacklogItem(overrides)` that returns a complete `BacklogItem` with sensible defaults, allowing partial overrides for specific test cases.

---

## Task 2: Create markdown-importer.test.ts

**File:** `src/backlog/markdown-importer.test.ts`

Test the `BacklogMarkdownImporter` class:

1. **`parseMarkdown` via round-trip**: Generate markdown from a `BacklogItem` using the generator, then import it back and verify extracted fields match original
2. **Parsing — title extraction**: `# Backlog Item: Some Title` → title = "Some Title"
3. **Parsing — metadata extraction**: `**Priority:** High` → priority = "high"
4. **Parsing — section extraction**: `## Description\n\nSome text` → sections.description = "Some text"
5. **`parseType()`** — maps common variations: "feature", "enhancement", "Architecture Improvement", "docs", "test", "New Feature"
6. **`parsePriority()`** — maps "High", "low", "Medium", undefined → correct values
7. **`parseImpactScore()`** — maps values including undefined
8. **`parseComplexity()`** — maps "small", "medium", "large", "x-large", "xlarge"
9. **`parseTags()`** — handles backtick-wrapped comma-separated tags, empty input
10. **Malformed markdown** — missing title line, no sections, empty content
11. **Round-trip fidelity** — generate → parse → compare key fields (title, description, priority, type, tags, estimates)
12. **`importFile()`** — mock repository and fs, verify `getBySourceFile` + `create` calls
13. **`importFile()` — already imported** — mock repository returns existing item, verify skip behavior
14. **`importAll()`** — mock fs.readdir + importFile flow

### Accessing Private Methods

The parser methods (`parseType`, `parsePriority`, etc.) are private. We'll test them indirectly through `importFile()` by constructing markdown with specific metadata values and verifying the resulting `CreateBacklogItemInput`.

Alternatively, we can instantiate the class with a mock repository and use the generated markdown as input to exercise the full parse pipeline.

---

## Task 3: Run Tests & Build

```bash
npm run test -- --run src/backlog/markdown-generator.test.ts src/backlog/markdown-importer.test.ts
npm run build
```

Fix any failures before proceeding.

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 4: Code Review

**Invoke:** `/code-review`

Review all implementation work for:
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Test coverage matches acceptance criteria

**Expected:** All issues addressed before proceeding.

### Task 5: Feature Testing

Verify the complete test suite:
- All new tests pass
- No regressions in existing tests
- Build succeeds

**Expected:** All tests pass with evidence (actual output shown).

### Task 6: Final Commit

After verification passes:
```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
