import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LearningProvider } from './learning-provider.js';
import type { LearningStore } from './learning-store.js';
import type { ExtendedLearning, LearningContext, LearningStats } from './types.js';
import * as fs from 'node:fs/promises';

// Mock fs module
vi.mock('node:fs/promises');

describe('LearningProvider', () => {
  let provider: LearningProvider;
  let mockStore: {
    getGlobalLearnings: ReturnType<typeof vi.fn>;
    getProjectLearnings: ReturnType<typeof vi.fn>;
    getStats: ReturnType<typeof vi.fn>;
  };

  const mockGlobalLearnings: ExtendedLearning[] = [
    {
      id: 'learning-001',
      category: 'testing',
      subcategory: 'edge-cases',
      pattern: 'async-race-condition',
      trigger: 'when testing async operations',
      rule: 'always use proper test isolation',
      appliesTo: ['typescript', 'vitest'],
      sourceRetrospective: 'retro-123',
      createdAt: new Date('2026-01-26')
    },
    {
      id: 'learning-002',
      category: 'architecture',
      subcategory: 'state-management',
      pattern: 'global-state-leak',
      trigger: 'when using global state',
      rule: 'avoid mutable global state',
      sourceRetrospective: 'retro-456',
      createdAt: new Date('2026-01-26')
    }
  ];

  const mockProjectLearnings: ExtendedLearning[] = [
    {
      id: 'learning-p001',
      category: 'project-specific',
      subcategory: 'api-design',
      pattern: 'rest-conventions',
      trigger: 'when designing REST endpoints',
      rule: 'use plural nouns for resources',
      sourceRetrospective: 'retro-proj-001',
      projectId: 'project-001',
      createdAt: new Date('2026-01-26')
    }
  ];

  beforeEach(() => {
    mockStore = {
      getGlobalLearnings: vi.fn().mockResolvedValue(mockGlobalLearnings),
      getProjectLearnings: vi.fn().mockResolvedValue(mockProjectLearnings),
      getStats: vi.fn().mockResolvedValue({
        total: 3,
        global: 2,
        projectSpecific: 1,
        byCategory: {
          testing: 1,
          architecture: 1,
          tooling: 0,
          communication: 0,
          'project-specific': 1
        }
      } as LearningStats)
    };

    // Mock fs.readFile for agents.md
    vi.mocked(fs.readFile).mockResolvedValue(`# Agent Behavior Guidelines

## Core Principles

1. Always verify completion
2. Test-first development

<!-- AGENT_RULES_START -->
<!-- AGENT_RULES_END -->
`);

    // Use dependency injection to pass mock store
    provider = new LearningProvider({
      basePath: '/test/learnings',
      agentsPath: '/test/agents.md',
      store: mockStore as unknown as LearningStore
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with options', () => {
      expect(provider).toBeDefined();
    });
  });

  describe('getContextForSession', () => {
    it('should return context with global and project learnings', async () => {
      const context = await provider.getContextForSession('project-001');

      expect(context.globalLearnings).toHaveLength(2);
      expect(context.projectLearnings).toHaveLength(1);
      expect(context.agentGuidelines).toBeDefined();
    });

    it('should call store methods correctly', async () => {
      await provider.getContextForSession('project-001');

      expect(mockStore.getGlobalLearnings).toHaveBeenCalled();
      expect(mockStore.getProjectLearnings).toHaveBeenCalledWith('project-001');
    });

    it('should return empty project learnings when projectId is undefined', async () => {
      mockStore.getProjectLearnings.mockResolvedValue([]);

      const context = await provider.getContextForSession();

      expect(context.projectLearnings).toHaveLength(0);
    });

    it('should include agent guidelines', async () => {
      const context = await provider.getContextForSession('project-001');

      expect(context.agentGuidelines).toContain('Agent Behavior Guidelines');
      expect(context.agentGuidelines).toContain('Core Principles');
    });
  });

  describe('formatAsSystemPrompt', () => {
    it('should format context as a system prompt', async () => {
      const context = await provider.getContextForSession('project-001');
      const prompt = provider.formatAsSystemPrompt(context);

      expect(prompt).toContain('LEARNINGS FROM PREVIOUS SESSIONS');
      expect(prompt).toContain('async-race-condition');
      expect(prompt).toContain('global-state-leak');
      expect(prompt).toContain('rest-conventions');
    });

    it('should include rule details in formatted prompt', async () => {
      const context = await provider.getContextForSession('project-001');
      const prompt = provider.formatAsSystemPrompt(context);

      expect(prompt).toContain('always use proper test isolation');
      expect(prompt).toContain('avoid mutable global state');
      expect(prompt).toContain('use plural nouns for resources');
    });

    it('should separate global and project learnings', async () => {
      const context = await provider.getContextForSession('project-001');
      const prompt = provider.formatAsSystemPrompt(context);

      expect(prompt).toContain('Global Learnings');
      expect(prompt).toContain('Project-Specific Learnings');
    });

    it('should include agent guidelines', async () => {
      const context = await provider.getContextForSession('project-001');
      const prompt = provider.formatAsSystemPrompt(context);

      expect(prompt).toContain('AGENT GUIDELINES');
    });

    it('should handle empty learnings gracefully', async () => {
      mockStore.getGlobalLearnings.mockResolvedValue([]);
      mockStore.getProjectLearnings.mockResolvedValue([]);

      const context = await provider.getContextForSession('project-001');
      const prompt = provider.formatAsSystemPrompt(context);

      expect(prompt).toContain('No global learnings recorded');
      expect(prompt).toContain('No project-specific learnings recorded');
    });
  });

  describe('formatLearningForPrompt', () => {
    it('should format a single learning', () => {
      const learning = mockGlobalLearnings[0];
      const formatted = provider.formatLearningForPrompt(learning);

      expect(formatted).toContain('Pattern: async-race-condition');
      expect(formatted).toContain('When: when testing async operations');
      expect(formatted).toContain('Rule: always use proper test isolation');
    });

    it('should include applies_to when present', () => {
      const learning = mockGlobalLearnings[0];
      const formatted = provider.formatLearningForPrompt(learning);

      expect(formatted).toContain('Applies to: typescript, vitest');
    });

    it('should omit applies_to when not present', () => {
      const learning = mockGlobalLearnings[1];
      const formatted = provider.formatLearningForPrompt(learning);

      expect(formatted).not.toContain('Applies to:');
    });
  });

  describe('getRelevantLearnings', () => {
    it('should filter learnings by technology', async () => {
      const learnings = await provider.getRelevantLearnings('project-001', ['typescript']);

      expect(learnings.length).toBeGreaterThan(0);
      expect(learnings.some(l => l.appliesTo?.includes('typescript'))).toBe(true);
    });

    it('should include learnings without appliesTo', async () => {
      const learnings = await provider.getRelevantLearnings('project-001', ['typescript']);

      // Should include learning-002 which has no appliesTo
      expect(learnings.some(l => l.id === 'learning-002')).toBe(true);
    });

    it('should include all learnings when no technologies specified', async () => {
      const learnings = await provider.getRelevantLearnings('project-001', []);

      expect(learnings.length).toBe(3); // 2 global + 1 project
    });
  });

  describe('getLearningsSummary', () => {
    it('should return a summary of learnings for logging', async () => {
      const summary = await provider.getLearningsSummary('project-001');

      expect(summary).toContain('Global: 2');
      expect(summary).toContain('Project: 1');
    });
  });
});
