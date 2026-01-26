import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { LearningStore } from './learning-store.js';
import type {
  ExtendedLearning,
  CreateExtendedLearningInput,
  LearningStoreOptions,
  LearningStats
} from './types.js';
import * as fs from 'node:fs/promises';

// Mock fs module
vi.mock('node:fs/promises');

describe('LearningStore', () => {
  let store: LearningStore;
  let mockReadFile: Mock;
  let mockWriteFile: Mock;
  let mockMkdir: Mock;

  const testOptions: LearningStoreOptions = {
    basePath: '/test/learnings',
    agentsPath: '/test/agents.md'
  };

  beforeEach(() => {
    mockReadFile = vi.fn();
    mockWriteFile = vi.fn().mockResolvedValue(undefined);
    mockMkdir = vi.fn().mockResolvedValue(undefined);

    vi.mocked(fs.readFile).mockImplementation(mockReadFile as unknown as typeof fs.readFile);
    vi.mocked(fs.writeFile).mockImplementation(mockWriteFile as unknown as typeof fs.writeFile);
    vi.mocked(fs.mkdir).mockImplementation(mockMkdir as unknown as typeof fs.mkdir);

    store = new LearningStore(testOptions);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with options', () => {
      expect(store).toBeDefined();
    });
  });

  describe('addLearning', () => {
    it('should add a global learning to global.md', async () => {
      const input: CreateExtendedLearningInput = {
        category: 'testing',
        subcategory: 'edge-cases',
        pattern: 'async-race-condition',
        trigger: 'when testing async operations with shared state',
        rule: 'always use proper test isolation and cleanup in afterEach',
        appliesTo: ['typescript', 'vitest'],
        sourceRetrospective: 'retro-123'
      };

      // Mock existing file content
      mockReadFile.mockResolvedValue(`# Global Learnings

Cross-project patterns and rules.

<!-- LEARNINGS_START -->
<!-- LEARNINGS_END -->
`);

      const result = await store.addLearning(input);

      expect(result.id).toBeDefined();
      expect(result.category).toBe('testing');
      expect(result.pattern).toBe('async-race-condition');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should add a project-specific learning with projectId', async () => {
      const input: CreateExtendedLearningInput = {
        category: 'project-specific',
        subcategory: 'data-model',
        pattern: 'user-auth-flow',
        trigger: 'when implementing authentication',
        rule: 'always validate tokens server-side',
        sourceRetrospective: 'retro-456',
        projectId: 'project-001'
      };

      mockReadFile.mockResolvedValue(`# Project Learnings

<!-- LEARNINGS_START -->
<!-- LEARNINGS_END -->
`);

      const result = await store.addLearning(input);

      expect(result.projectId).toBe('project-001');
      // Should write to project-specific file
      const writeCall = mockWriteFile.mock.calls[0];
      expect(writeCall[0]).toContain('project-001');
    });

    it('should generate a unique ID for the learning', async () => {
      const input: CreateExtendedLearningInput = {
        category: 'tooling',
        subcategory: 'build',
        pattern: 'esm-config',
        trigger: 'when configuring ESM',
        rule: 'use NodeNext module resolution',
        sourceRetrospective: 'retro-789'
      };

      mockReadFile.mockResolvedValue(`# Global Learnings

<!-- LEARNINGS_START -->
<!-- LEARNINGS_END -->
`);

      const result1 = await store.addLearning(input);
      const result2 = await store.addLearning(input);

      expect(result1.id).not.toBe(result2.id);
    });
  });

  describe('getGlobalLearnings', () => {
    it('should return empty array when no learnings exist', async () => {
      mockReadFile.mockResolvedValue(`# Global Learnings

<!-- LEARNINGS_START -->
<!-- LEARNINGS_END -->
`);

      const learnings = await store.getGlobalLearnings();
      expect(learnings).toEqual([]);
    });

    it('should parse learnings from YAML frontmatter', async () => {
      mockReadFile.mockResolvedValue(`# Global Learnings

<!-- LEARNINGS_START -->
---
id: learning-001
category: testing
subcategory: edge-cases
pattern: async-race-condition
trigger: when testing async operations
rule: always use proper test isolation
applies_to:
  - typescript
  - vitest
source_retrospective: retro-123
created_at: "2026-01-26T00:00:00.000Z"
---

---
id: learning-002
category: architecture
subcategory: state-management
pattern: global-state-leak
trigger: when using global state
rule: avoid mutable global state
source_retrospective: retro-456
created_at: "2026-01-26T00:00:00.000Z"
---
<!-- LEARNINGS_END -->
`);

      const learnings = await store.getGlobalLearnings();

      expect(learnings).toHaveLength(2);
      expect(learnings[0].id).toBe('learning-001');
      expect(learnings[0].category).toBe('testing');
      expect(learnings[0].appliesTo).toEqual(['typescript', 'vitest']);
      expect(learnings[1].id).toBe('learning-002');
      expect(learnings[1].category).toBe('architecture');
    });

    it('should handle file not found gracefully', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      const learnings = await store.getGlobalLearnings();
      expect(learnings).toEqual([]);
    });
  });

  describe('getProjectLearnings', () => {
    it('should return learnings for a specific project', async () => {
      mockReadFile.mockResolvedValue(`# Project Learnings

<!-- LEARNINGS_START -->
---
id: learning-p001
category: project-specific
subcategory: api-design
pattern: rest-conventions
trigger: when designing REST endpoints
rule: use plural nouns for resources
source_retrospective: retro-proj-001
project_id: project-001
created_at: "2026-01-26T00:00:00.000Z"
---
<!-- LEARNINGS_END -->
`);

      const learnings = await store.getProjectLearnings('project-001');

      expect(learnings).toHaveLength(1);
      expect(learnings[0].projectId).toBe('project-001');
    });

    it('should return empty array for non-existent project', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      const learnings = await store.getProjectLearnings('non-existent');
      expect(learnings).toEqual([]);
    });
  });

  describe('getLearningById', () => {
    it('should return a specific learning by ID', async () => {
      mockReadFile.mockResolvedValue(`# Global Learnings

<!-- LEARNINGS_START -->
---
id: learning-001
category: testing
subcategory: edge-cases
pattern: async-race-condition
trigger: when testing async operations
rule: always use proper test isolation
source_retrospective: retro-123
created_at: "2026-01-26T00:00:00.000Z"
---
<!-- LEARNINGS_END -->
`);

      const learning = await store.getLearningById('learning-001');

      expect(learning).toBeDefined();
      expect(learning?.id).toBe('learning-001');
    });

    it('should return null for non-existent ID', async () => {
      const mockReaddir = vi.fn().mockResolvedValue([]);
      vi.mocked(fs.readdir).mockImplementation(mockReaddir as unknown as typeof fs.readdir);

      mockReadFile.mockResolvedValue(`# Global Learnings

<!-- LEARNINGS_START -->
<!-- LEARNINGS_END -->
`);

      const learning = await store.getLearningById('non-existent');
      expect(learning).toBeNull();
    });

    it('should search project files for learning by ID', async () => {
      const mockReaddir = vi.fn().mockResolvedValue(['project-001.md']);
      vi.mocked(fs.readdir).mockImplementation(mockReaddir as unknown as typeof fs.readdir);

      mockReadFile.mockImplementation(async (filePath: string | Buffer | URL) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('global.md')) {
          return `# Global Learnings

<!-- LEARNINGS_START -->
<!-- LEARNINGS_END -->
`;
        }
        if (pathStr.includes('project-001.md')) {
          return `# Project Learnings

<!-- LEARNINGS_START -->
---
id: learning-proj-001
category: project-specific
subcategory: api-design
pattern: rest-conventions
trigger: when designing REST endpoints
rule: use plural nouns
source_retrospective: retro-proj-001
project_id: project-001
created_at: "2026-01-26T00:00:00.000Z"
---
<!-- LEARNINGS_END -->
`;
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const learning = await store.getLearningById('learning-proj-001');

      expect(learning).toBeDefined();
      expect(learning?.id).toBe('learning-proj-001');
      expect(learning?.projectId).toBe('project-001');
    });
  });

  describe('hasSimilarLearning', () => {
    it('should return true when a similar learning exists', async () => {
      mockReadFile.mockResolvedValue(`# Global Learnings

<!-- LEARNINGS_START -->
---
id: learning-001
category: testing
subcategory: edge-cases
pattern: async-race-condition
trigger: when testing async operations
rule: always use proper test isolation and cleanup in afterEach
source_retrospective: retro-123
created_at: "2026-01-26T00:00:00.000Z"
---
<!-- LEARNINGS_END -->
`);

      const hasSimilar = await store.hasSimilarLearning({
        category: 'testing',
        pattern: 'async-race-condition',
        rule: 'always use proper test isolation and cleanup'
      });

      expect(hasSimilar).toBe(true);
    });

    it('should return false when no similar learning exists', async () => {
      mockReadFile.mockResolvedValue(`# Global Learnings

<!-- LEARNINGS_START -->
---
id: learning-001
category: testing
subcategory: edge-cases
pattern: async-race-condition
trigger: when testing async operations
rule: always use proper test isolation
source_retrospective: retro-123
created_at: "2026-01-26T00:00:00.000Z"
---
<!-- LEARNINGS_END -->
`);

      const hasSimilar = await store.hasSimilarLearning({
        category: 'architecture',
        pattern: 'different-pattern',
        rule: 'completely different rule about architecture'
      });

      expect(hasSimilar).toBe(false);
    });

    it('should check project-specific learnings when projectId provided', async () => {
      mockReadFile.mockResolvedValue(`# Project Learnings

<!-- LEARNINGS_START -->
---
id: learning-proj-001
category: project-specific
subcategory: api-design
pattern: rest-conventions
trigger: when designing REST endpoints
rule: use plural nouns for resource endpoints always
source_retrospective: retro-proj-001
project_id: project-001
created_at: "2026-01-26T00:00:00.000Z"
---
<!-- LEARNINGS_END -->
`);

      const hasSimilar = await store.hasSimilarLearning({
        category: 'project-specific',
        pattern: 'rest-conventions',
        rule: 'use plural nouns for resource endpoints',
        projectId: 'project-001'
      });

      expect(hasSimilar).toBe(true);
    });
  });

  describe('formatLearningAsYaml', () => {
    it('should format a learning as YAML frontmatter', () => {
      const learning: ExtendedLearning = {
        id: 'learning-001',
        category: 'testing',
        subcategory: 'edge-cases',
        pattern: 'async-race-condition',
        trigger: 'when testing async operations',
        rule: 'always use proper test isolation',
        appliesTo: ['typescript', 'vitest'],
        sourceRetrospective: 'retro-123',
        createdAt: new Date('2026-01-26T00:00:00.000Z')
      };

      const yaml = store.formatLearningAsYaml(learning);

      expect(yaml).toContain('---');
      expect(yaml).toContain('id: learning-001');
      expect(yaml).toContain('category: testing');
      expect(yaml).toContain('pattern: async-race-condition');
      expect(yaml).toContain('applies_to:');
      expect(yaml).toContain('  - typescript');
      expect(yaml).toContain('  - vitest');
    });

    it('should handle learning without optional fields', () => {
      const learning: ExtendedLearning = {
        id: 'learning-002',
        category: 'tooling',
        subcategory: 'build',
        pattern: 'esm-config',
        trigger: 'when configuring ESM',
        rule: 'use NodeNext',
        sourceRetrospective: 'retro-456',
        createdAt: new Date('2026-01-26T00:00:00.000Z')
      };

      const yaml = store.formatLearningAsYaml(learning);

      expect(yaml).toContain('id: learning-002');
      expect(yaml).not.toContain('applies_to');
      expect(yaml).not.toContain('project_id');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      // Mock global learnings
      mockReadFile.mockImplementation(async (filePath: string | Buffer | URL) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('global.md')) {
          return `# Global Learnings

<!-- LEARNINGS_START -->
---
id: learning-001
category: testing
subcategory: edge-cases
pattern: test-pattern
trigger: trigger
rule: rule
source_retrospective: retro-1
created_at: "2026-01-26T00:00:00.000Z"
---

---
id: learning-002
category: architecture
subcategory: design
pattern: arch-pattern
trigger: trigger
rule: rule
source_retrospective: retro-2
created_at: "2026-01-26T00:00:00.000Z"
---
<!-- LEARNINGS_END -->
`;
        }
        // Return empty for project files
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      const stats = await store.getStats();

      expect(stats.total).toBe(2);
      expect(stats.global).toBe(2);
      expect(stats.projectSpecific).toBe(0);
      expect(stats.byCategory.testing).toBe(1);
      expect(stats.byCategory.architecture).toBe(1);
    });
  });

  describe('updateIndex', () => {
    it('should update the index file with current stats', async () => {
      mockReadFile.mockImplementation(async (filePath: string | Buffer | URL) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('global.md')) {
          return `# Global Learnings

<!-- LEARNINGS_START -->
---
id: learning-001
category: testing
subcategory: edge-cases
pattern: test-pattern
trigger: trigger
rule: rule
source_retrospective: retro-1
created_at: "2026-01-26T00:00:00.000Z"
---
<!-- LEARNINGS_END -->
`;
        }
        if (pathStr.includes('index.md')) {
          return `# Learnings Index

## Statistics

- Total Learnings: 0
- Global Learnings: 0
- Project-Specific Learnings: 0

## Recent Learnings

<!-- RECENT_LEARNINGS_START -->
<!-- RECENT_LEARNINGS_END -->
`;
        }
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      await store.updateIndex();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const writeCall = (mockWriteFile.mock.calls as any[]).find(
        (call) => String(call[0]).includes('index.md')
      );
      expect(writeCall).toBeDefined();
      const content = String(writeCall[1]);
      expect(content).toContain('Total Learnings: 1');
    });
  });
});
