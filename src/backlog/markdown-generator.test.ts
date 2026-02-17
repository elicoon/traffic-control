import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { BacklogMarkdownGenerator } from './markdown-generator.js';
import type { BacklogItem } from '../db/repositories/backlog-items.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs/promises
vi.mock('fs/promises');

// Mock logger to avoid side effects
vi.mock('../logging/index.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

/**
 * Helper to create a BacklogItem with sensible defaults.
 * Override any field via the `overrides` parameter.
 */
function makeBacklogItem(overrides?: Partial<BacklogItem>): BacklogItem {
  return {
    id: 'abcd1234-5678-9012-3456-789012345678',
    project_id: 'proj-0000-1111-2222-333344445555',
    title: 'Implement dark mode toggle',
    description: 'Add a dark mode toggle to the settings page.',
    type: 'feature',
    priority: 'high',
    impact_score: 'high',
    complexity_estimate: 'medium',
    estimated_sessions_opus: 2,
    estimated_sessions_sonnet: 3,
    status: 'proposed',
    reasoning: 'Users have requested dark mode support frequently.',
    acceptance_criteria: 'Toggle switches theme. Preference persists across sessions.',
    tags: ['ui', 'accessibility'],
    related_items: ['item-aaa', 'item-bbb'],
    proposal_ids: ['proposal-111'],
    task_ids: ['task-222', 'task-333'],
    source: 'user',
    source_file: 'docs/backlog/dark-mode.md',
    created_at: '2026-01-10T12:00:00.000Z',
    updated_at: '2026-01-15T18:30:00.000Z',
    reviewed_at: null,
    implemented_at: null,
    ...overrides,
  };
}

describe('BacklogMarkdownGenerator', () => {
  let generator: BacklogMarkdownGenerator;
  let mockMkdir: Mock;
  let mockWriteFile: Mock;
  let mockReaddir: Mock;
  let mockRename: Mock;

  const outputDir = '/tmp/test-backlog-output';

  beforeEach(() => {
    mockMkdir = vi.fn().mockResolvedValue(undefined);
    mockWriteFile = vi.fn().mockResolvedValue(undefined);
    mockReaddir = vi.fn().mockResolvedValue([]);
    mockRename = vi.fn().mockResolvedValue(undefined);

    vi.mocked(fs.mkdir).mockImplementation(mockMkdir as unknown as typeof fs.mkdir);
    vi.mocked(fs.writeFile).mockImplementation(mockWriteFile as unknown as typeof fs.writeFile);
    vi.mocked(fs.readdir).mockImplementation(mockReaddir as unknown as typeof fs.readdir);
    vi.mocked(fs.rename).mockImplementation(mockRename as unknown as typeof fs.rename);

    generator = new BacklogMarkdownGenerator({ outputDir });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ─── generate() ───────────────────────────────────────────────────

  describe('generate()', () => {
    it('should include all sections for a fully-populated item', () => {
      const item = makeBacklogItem();
      const md = generator.generate(item);

      // Title
      expect(md).toContain('# Backlog Item: Implement dark mode toggle');

      // Header metadata
      expect(md).toContain('**Priority:** High');
      expect(md).toContain('**Type:** Feature');
      expect(md).toContain('**Status:** Proposed');
      expect(md).toContain('**Created:** 2026-01-10');
      expect(md).toContain('**Updated:** 2026-01-15');

      // Separator
      expect(md).toContain('---');

      // Description
      expect(md).toContain('## Description');
      expect(md).toContain('Add a dark mode toggle to the settings page.');

      // Classification
      expect(md).toContain('## Classification');
      expect(md).toContain('**Impact:** High');
      expect(md).toContain('**Complexity:** Medium');

      // Effort Estimates
      expect(md).toContain('## Effort Estimates');
      expect(md).toContain('**Opus Sessions:** 2');
      expect(md).toContain('**Sonnet Sessions:** 3');

      // Reasoning
      expect(md).toContain('## Reasoning');
      expect(md).toContain('Users have requested dark mode support frequently.');

      // Acceptance Criteria
      expect(md).toContain('## Acceptance Criteria');
      expect(md).toContain('Toggle switches theme. Preference persists across sessions.');

      // Tags
      expect(md).toContain('## Tags');
      expect(md).toContain('`ui`');
      expect(md).toContain('`accessibility`');

      // Related Items
      expect(md).toContain('## Related Items');
      expect(md).toContain('- item-aaa');
      expect(md).toContain('- item-bbb');

      // Generated Work Items
      expect(md).toContain('## Generated Work Items');
      expect(md).toContain('**Proposals:** 1');
      expect(md).toContain('- proposal-111');
      expect(md).toContain('**Tasks:** 2');
      expect(md).toContain('- task-222');
      expect(md).toContain('- task-333');

      // Metadata footer
      expect(md).toContain('## Metadata');
      expect(md).toContain('`abcd1234-5678-9012-3456-789012345678`');
      expect(md).toContain('**Source:** user');
      expect(md).toContain('**Original File:** docs/backlog/dark-mode.md');
      expect(md).toContain('`proj-0000-1111-2222-333344445555`');

      // Auto-generated notice
      expect(md).toContain('auto-generated from the database');
    });

    it('should omit optional sections when fields are null or empty', () => {
      const item = makeBacklogItem({
        impact_score: null,
        complexity_estimate: null,
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 0,
        reasoning: null,
        acceptance_criteria: null,
        tags: [],
        related_items: [],
        proposal_ids: [],
        task_ids: [],
        source_file: null,
        project_id: null,
        // same dates so "Updated" is hidden
        updated_at: '2026-01-10T12:00:00.000Z',
      });
      const md = generator.generate(item);

      // Required sections present
      expect(md).toContain('# Backlog Item:');
      expect(md).toContain('## Description');
      expect(md).toContain('## Metadata');

      // Optional sections absent
      expect(md).not.toContain('## Classification');
      expect(md).not.toContain('## Effort Estimates');
      expect(md).not.toContain('## Reasoning');
      expect(md).not.toContain('## Acceptance Criteria');
      expect(md).not.toContain('## Tags');
      expect(md).not.toContain('## Related Items');
      expect(md).not.toContain('## Generated Work Items');
      expect(md).not.toContain('**Updated:**');
      expect(md).not.toContain('**Original File:**');
      expect(md).not.toContain('**Project ID:**');
    });

    it('should handle special characters in title without mangling them', () => {
      const item = makeBacklogItem({
        title: 'Fix `parseConfig` for # headers & *bold* | pipes',
      });
      const md = generator.generate(item);

      // The generate method outputs the title verbatim
      expect(md).toContain('# Backlog Item: Fix `parseConfig` for # headers & *bold* | pipes');
    });

    it('should show "Updated" line when updated_at differs from created_at', () => {
      const item = makeBacklogItem({
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-10T00:00:00.000Z',
      });
      const md = generator.generate(item);

      expect(md).toContain('**Created:** 2026-02-01');
      expect(md).toContain('**Updated:** 2026-02-10');
    });

    it('should hide "Updated" line when updated_at equals created_at', () => {
      const sameDate = '2026-02-01T00:00:00.000Z';
      const item = makeBacklogItem({
        created_at: sameDate,
        updated_at: sameDate,
      });
      const md = generator.generate(item);

      expect(md).toContain('**Created:** 2026-02-01');
      expect(md).not.toContain('**Updated:**');
    });

    it('should format multi-word type correctly', () => {
      const item = makeBacklogItem({ type: 'infrastructure' });
      const md = generator.generate(item);
      expect(md).toContain('**Type:** Infrastructure');
    });

    it('should format multi-word status correctly', () => {
      const item = makeBacklogItem({ status: 'in_progress' });
      const md = generator.generate(item);
      expect(md).toContain('**Status:** In Progress');
    });

    it('should format in_review status correctly', () => {
      const item = makeBacklogItem({ status: 'in_review' });
      const md = generator.generate(item);
      expect(md).toContain('**Status:** In Review');
    });

    it('should show Classification section with only impact_score', () => {
      const item = makeBacklogItem({
        impact_score: 'medium',
        complexity_estimate: null,
      });
      const md = generator.generate(item);

      expect(md).toContain('## Classification');
      expect(md).toContain('**Impact:** Medium');
      expect(md).not.toContain('**Complexity:**');
    });

    it('should show Classification section with only complexity_estimate', () => {
      const item = makeBacklogItem({
        impact_score: null,
        complexity_estimate: 'x-large',
      });
      const md = generator.generate(item);

      expect(md).toContain('## Classification');
      expect(md).not.toContain('**Impact:**');
      expect(md).toContain('**Complexity:** X-large');
    });

    it('should show Effort Estimates with only Opus sessions', () => {
      const item = makeBacklogItem({
        estimated_sessions_opus: 5,
        estimated_sessions_sonnet: 0,
      });
      const md = generator.generate(item);

      expect(md).toContain('## Effort Estimates');
      expect(md).toContain('**Opus Sessions:** 5');
      expect(md).not.toContain('**Sonnet Sessions:**');
    });

    it('should show Effort Estimates with only Sonnet sessions', () => {
      const item = makeBacklogItem({
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 4,
      });
      const md = generator.generate(item);

      expect(md).toContain('## Effort Estimates');
      expect(md).not.toContain('**Opus Sessions:**');
      expect(md).toContain('**Sonnet Sessions:** 4');
    });

    it('should render Generated Work Items with only proposals', () => {
      const item = makeBacklogItem({
        proposal_ids: ['p-1', 'p-2'],
        task_ids: [],
      });
      const md = generator.generate(item);

      expect(md).toContain('## Generated Work Items');
      expect(md).toContain('**Proposals:** 2');
      expect(md).not.toContain('**Tasks:**');
    });

    it('should render Generated Work Items with only tasks', () => {
      const item = makeBacklogItem({
        proposal_ids: [],
        task_ids: ['t-1'],
      });
      const md = generator.generate(item);

      expect(md).toContain('## Generated Work Items');
      expect(md).not.toContain('**Proposals:**');
      expect(md).toContain('**Tasks:** 1');
    });
  });

  // ─── generateFilename() ──────────────────────────────────────────

  describe('generateFilename()', () => {
    it('should produce a kebab-case slug with 8-char ID prefix and .md extension', () => {
      const item = makeBacklogItem({
        id: 'abcd1234-5678-9012-3456-789012345678',
        title: 'Implement dark mode toggle',
      });
      const filename = generator.generateFilename(item);

      expect(filename).toBe('implement-dark-mode-toggle-abcd1234.md');
    });

    it('should convert special characters to dashes in slug', () => {
      const item = makeBacklogItem({
        id: 'ff001122-3344-5566-7788-99aabbccddee',
        title: 'Fix `parseConfig` for #headers & *bold*!',
      });
      const filename = generator.generateFilename(item);

      // Special chars become dashes, leading/trailing dashes trimmed
      expect(filename).toMatch(/^fix-parseconfig-for-headers-bold-/);
      expect(filename).toMatch(/-ff001122\.md$/);
      // No consecutive special chars leaked through
      expect(filename).not.toMatch(/[^a-z0-9.\-]/);
    });

    it('should truncate slugs longer than 50 characters', () => {
      const item = makeBacklogItem({
        id: 'aabbccdd-1122-3344-5566-778899001122',
        title: 'This is a very long title that should definitely be truncated to fit within the fifty character limit',
      });
      const filename = generator.generateFilename(item);

      // The slug portion (before the ID suffix) must be at most 50 chars
      const slugPart = filename.replace(/-aabbccdd\.md$/, '');
      expect(slugPart.length).toBeLessThanOrEqual(50);
      expect(filename).toMatch(/-aabbccdd\.md$/);
    });

    it('should handle a title that is all special characters', () => {
      const item = makeBacklogItem({
        id: '11223344-5566-7788-99aa-bbccddeeff00',
        title: '!@#$%^&*()',
      });
      const filename = generator.generateFilename(item);

      // After slugifying, non-alphanumeric chars become dashes and leading/trailing dashes are trimmed
      // The slug could be empty, resulting in just the ID prefix
      expect(filename).toMatch(/-11223344\.md$/);
    });

    it('should lowercase the title in the slug', () => {
      const item = makeBacklogItem({
        id: 'aabb0011-2233-4455-6677-889900aabbcc',
        title: 'ADD New Feature',
      });
      const filename = generator.generateFilename(item);

      expect(filename).toMatch(/^add-new-feature-/);
    });
  });

  // ─── generateFile() ──────────────────────────────────────────────

  describe('generateFile()', () => {
    it('should return an object with both filename and content', () => {
      const item = makeBacklogItem();
      const result = generator.generateFile(item);

      expect(result).toHaveProperty('filename');
      expect(result).toHaveProperty('content');
      expect(typeof result.filename).toBe('string');
      expect(typeof result.content).toBe('string');
    });

    it('should return a filename matching generateFilename()', () => {
      const item = makeBacklogItem();
      const result = generator.generateFile(item);

      expect(result.filename).toBe(generator.generateFilename(item));
    });

    it('should return content matching generate()', () => {
      const item = makeBacklogItem();
      const result = generator.generateFile(item);

      expect(result.content).toBe(generator.generate(item));
    });
  });

  // ─── writeItem() ─────────────────────────────────────────────────

  describe('writeItem()', () => {
    it('should create the output directory with recursive option', async () => {
      const item = makeBacklogItem();
      await generator.writeItem(item);

      expect(mockMkdir).toHaveBeenCalledWith(outputDir, { recursive: true });
    });

    it('should write the file with correct path and content', async () => {
      const item = makeBacklogItem();
      const expectedFilename = generator.generateFilename(item);
      const expectedContent = generator.generate(item);
      const expectedPath = path.join(outputDir, expectedFilename);

      await generator.writeItem(item);

      expect(mockWriteFile).toHaveBeenCalledWith(expectedPath, expectedContent, 'utf-8');
    });

    it('should return the full filepath', async () => {
      const item = makeBacklogItem();
      const result = await generator.writeItem(item);
      const expectedFilename = generator.generateFilename(item);

      expect(result).toBe(path.join(outputDir, expectedFilename));
    });

    it('should propagate errors from fs.writeFile', async () => {
      mockWriteFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));
      const item = makeBacklogItem();

      await expect(generator.writeItem(item)).rejects.toThrow('EACCES: permission denied');
    });
  });

  // ─── syncAll() ────────────────────────────────────────────────────

  describe('syncAll()', () => {
    it('should write all items and return written count', async () => {
      const items = [
        makeBacklogItem({ id: 'aaaa1111-0000-0000-0000-000000000000', title: 'Task A' }),
        makeBacklogItem({ id: 'bbbb2222-0000-0000-0000-000000000000', title: 'Task B' }),
        makeBacklogItem({ id: 'cccc3333-0000-0000-0000-000000000000', title: 'Task C' }),
      ];

      const result = await generator.syncAll(items);

      expect(result.written).toBe(3);
      expect(result.errors).toHaveLength(0);
      // mkdir called once for syncAll + once per writeItem = 4 calls
      expect(mockMkdir).toHaveBeenCalled();
      // writeFile called once per item
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
    });

    it('should return errors for items that fail to write', async () => {
      const items = [
        makeBacklogItem({ id: 'aaaa1111-0000-0000-0000-000000000000', title: 'Good Item' }),
        makeBacklogItem({ id: 'bbbb2222-0000-0000-0000-000000000000', title: 'Bad Item' }),
      ];

      // First writeFile succeeds, second fails
      mockWriteFile
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Disk full'));

      const result = await generator.syncAll(items);

      expect(result.written).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('bbbb2222');
      expect(result.errors[0]).toContain('Disk full');
    });

    it('should handle empty items array', async () => {
      const result = await generator.syncAll([]);

      expect(result.written).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should archive orphaned files that no longer match any item', async () => {
      // Simulate existing files in the output directory
      mockReaddir.mockResolvedValueOnce([
        { name: 'old-item-aaaa1111.md', isFile: () => true },
        { name: 'current-item-bbbb2222.md', isFile: () => true },
        { name: 'readme.txt', isFile: () => true }, // not .md, should be ignored
        { name: 'subdir', isFile: () => false },     // directory, should be ignored
      ]);

      // Only one current item whose filename matches 'current-item-bbbb2222.md'
      const items = [
        makeBacklogItem({
          id: 'bbbb2222-0000-0000-0000-000000000000',
          title: 'Current Item',
        }),
      ];

      await generator.syncAll(items);

      // The orphaned file should be moved to archive dir
      expect(mockRename).toHaveBeenCalledWith(
        path.join(outputDir, 'old-item-aaaa1111.md'),
        path.join(outputDir, 'archive', 'old-item-aaaa1111.md'),
      );
      // The archive directory should be created
      expect(mockMkdir).toHaveBeenCalledWith(
        path.join(outputDir, 'archive'),
        { recursive: true },
      );
    });

    it('should not archive files that match current items', async () => {
      const item = makeBacklogItem({
        id: 'abcd1234-5678-9012-3456-789012345678',
        title: 'Implement dark mode toggle',
      });
      const expectedFilename = generator.generateFilename(item);

      mockReaddir.mockResolvedValueOnce([
        { name: expectedFilename, isFile: () => true },
      ]);

      await generator.syncAll([item]);

      // No files should be renamed since the only file matches the current item
      expect(mockRename).not.toHaveBeenCalled();
    });

    it('should handle readdir failure gracefully (no existing files)', async () => {
      // readdir throws when directory does not exist
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

      const items = [makeBacklogItem()];
      const result = await generator.syncAll(items);

      // Should still write the items successfully
      expect(result.written).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });
});
