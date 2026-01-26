import { describe, it, expect, beforeEach } from 'vitest';
import { ContextBudgetManager } from './context-budget-manager.js';
import type { ContextCategory, ContextEntry } from './context-budget.js';

describe('ContextBudgetManager', () => {
  let manager: ContextBudgetManager;

  beforeEach(() => {
    manager = new ContextBudgetManager();
  });

  describe('constructor', () => {
    it('should create an instance with default config', () => {
      expect(manager).toBeDefined();
      const config = manager.getConfig();
      expect(config.maxTokens).toBe(200000);
      expect(config.targetUtilization).toBe(0.5);
      expect(config.warningThreshold).toBe(0.4);
      expect(config.tokensPerChar).toBe(0.25);
    });

    it('should create an instance with custom config', () => {
      const customManager = new ContextBudgetManager({
        maxTokens: 100000,
        targetUtilization: 0.6,
        warningThreshold: 0.5,
        tokensPerChar: 0.3,
      });

      const config = customManager.getConfig();
      expect(config.maxTokens).toBe(100000);
      expect(config.targetUtilization).toBe(0.6);
      expect(config.warningThreshold).toBe(0.5);
      expect(config.tokensPerChar).toBe(0.3);
    });

    it('should merge partial custom config with defaults', () => {
      const customManager = new ContextBudgetManager({
        maxTokens: 150000,
      });

      const config = customManager.getConfig();
      expect(config.maxTokens).toBe(150000);
      expect(config.targetUtilization).toBe(0.5); // default
      expect(config.warningThreshold).toBe(0.4); // default
      expect(config.tokensPerChar).toBe(0.25); // default
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens using default ratio (0.25 tokens per char)', () => {
      // 100 chars * 0.25 = 25 tokens
      const text = 'a'.repeat(100);
      expect(manager.estimateTokens(text)).toBe(25);
    });

    it('should estimate tokens with custom ratio', () => {
      const customManager = new ContextBudgetManager({ tokensPerChar: 0.5 });
      // 100 chars * 0.5 = 50 tokens
      const text = 'a'.repeat(100);
      expect(customManager.estimateTokens(text)).toBe(50);
    });

    it('should return 0 for empty string', () => {
      expect(manager.estimateTokens('')).toBe(0);
    });

    it('should return 0 for null/undefined-like input', () => {
      expect(manager.estimateTokens(null as unknown as string)).toBe(0);
      expect(manager.estimateTokens(undefined as unknown as string)).toBe(0);
    });

    it('should ceil the token estimate', () => {
      // 1 char * 0.25 = 0.25, ceiled to 1
      expect(manager.estimateTokens('a')).toBe(1);
      // 3 chars * 0.25 = 0.75, ceiled to 1
      expect(manager.estimateTokens('abc')).toBe(1);
      // 5 chars * 0.25 = 1.25, ceiled to 2
      expect(manager.estimateTokens('abcde')).toBe(2);
    });

    it('should handle realistic text content', () => {
      const paragraph =
        'The quick brown fox jumps over the lazy dog. This is a test paragraph with multiple sentences to simulate realistic content that might be added to the context window.';
      const tokens = manager.estimateTokens(paragraph);
      // ~170 chars * 0.25 = ~42.5, ceiled
      expect(tokens).toBeGreaterThan(40);
      expect(tokens).toBeLessThan(50);
    });
  });

  describe('addEntry', () => {
    it('should add entry with provided tokens', () => {
      const budget = manager.addEntry({
        category: 'system',
        tokens: 1000,
        compressible: false,
      });

      expect(budget.currentEstimate).toBe(1000);
      expect(manager.getAllEntries()).toHaveLength(1);
    });

    it('should add entry and estimate tokens from content', () => {
      const content = 'a'.repeat(400); // 400 chars * 0.25 = 100 tokens
      const budget = manager.addEntry({
        category: 'task',
        content,
        compressible: true,
      });

      expect(budget.currentEstimate).toBe(100);
    });

    it('should generate unique ID for each entry', () => {
      manager.addEntry({ category: 'system', tokens: 100, compressible: false });
      manager.addEntry({ category: 'task', tokens: 200, compressible: true });

      const entries = manager.getAllEntries();
      expect(entries[0].id).not.toBe(entries[1].id);
    });

    it('should set addedAt timestamp', () => {
      const before = new Date();
      manager.addEntry({ category: 'system', tokens: 100, compressible: false });
      const after = new Date();

      const entry = manager.getAllEntries()[0];
      expect(entry.addedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entry.addedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should store referenceId when provided', () => {
      manager.addEntry({
        category: 'task',
        tokens: 100,
        compressible: true,
        referenceId: 'task-123',
      });

      const entry = manager.getAllEntries()[0];
      expect(entry.referenceId).toBe('task-123');
    });

    it('should use 0 tokens when neither tokens nor content provided', () => {
      manager.addEntry({
        category: 'system',
        compressible: false,
      });

      const entry = manager.getAllEntries()[0];
      expect(entry.tokens).toBe(0);
    });

    it('should prefer explicit tokens over content estimation', () => {
      manager.addEntry({
        category: 'task',
        tokens: 500,
        content: 'a'.repeat(1000), // Would be 250 tokens if estimated
        compressible: true,
      });

      const entry = manager.getAllEntries()[0];
      expect(entry.tokens).toBe(500);
    });
  });

  describe('removeEntry', () => {
    it('should remove entry by ID', () => {
      manager.addEntry({ category: 'system', tokens: 100, compressible: false });
      const entries = manager.getAllEntries();
      const entryId = entries[0].id;

      manager.removeEntry(entryId);

      expect(manager.getAllEntries()).toHaveLength(0);
      expect(manager.getEntry(entryId)).toBeUndefined();
    });

    it('should not throw when removing non-existent entry', () => {
      expect(() => manager.removeEntry('non-existent-id')).not.toThrow();
    });

    it('should update budget after removal', () => {
      manager.addEntry({ category: 'system', tokens: 1000, compressible: false });
      const entry = manager.getAllEntries()[0];

      expect(manager.getBudget().currentEstimate).toBe(1000);

      manager.removeEntry(entry.id);

      expect(manager.getBudget().currentEstimate).toBe(0);
    });
  });

  describe('updateEntry', () => {
    it('should update entry with new content and recalculate tokens', () => {
      manager.addEntry({
        category: 'task',
        content: 'a'.repeat(400), // 100 tokens
        compressible: true,
        referenceId: 'task-1',
      });

      const entries = manager.getAllEntries();
      const entryId = entries[0].id;
      expect(entries[0].tokens).toBe(100);

      // Update with shorter content
      const updated = manager.updateEntry(entryId, 'Task task-1: delegated'); // ~6 tokens

      expect(updated).toBe(true);
      const updatedEntry = manager.getEntry(entryId);
      expect(updatedEntry?.tokens).toBeLessThan(100);
    });

    it('should return false when entry does not exist', () => {
      const updated = manager.updateEntry('non-existent-id', 'new content');
      expect(updated).toBe(false);
    });

    it('should preserve other entry properties when updating', () => {
      manager.addEntry({
        category: 'task',
        content: 'original content',
        compressible: true,
        referenceId: 'task-1',
      });

      const entries = manager.getAllEntries();
      const entryId = entries[0].id;
      const originalEntry = entries[0];

      manager.updateEntry(entryId, 'new shorter content');

      const updatedEntry = manager.getEntry(entryId);
      expect(updatedEntry?.id).toBe(originalEntry.id);
      expect(updatedEntry?.category).toBe(originalEntry.category);
      expect(updatedEntry?.compressible).toBe(originalEntry.compressible);
      expect(updatedEntry?.referenceId).toBe(originalEntry.referenceId);
      expect(updatedEntry?.addedAt).toEqual(originalEntry.addedAt);
    });

    it('should update budget after entry update', () => {
      manager.addEntry({
        category: 'task',
        tokens: 1000,
        compressible: true,
      });

      expect(manager.getBudget().currentEstimate).toBe(1000);

      const entries = manager.getAllEntries();
      manager.updateEntry(entries[0].id, 'short'); // ~2 tokens

      expect(manager.getBudget().currentEstimate).toBeLessThan(1000);
    });
  });

  describe('removeEntriesByReference', () => {
    it('should remove all entries with matching referenceId', () => {
      manager.addEntry({ category: 'task', tokens: 100, compressible: true, referenceId: 'task-1' });
      manager.addEntry({
        category: 'response',
        tokens: 200,
        compressible: true,
        referenceId: 'task-1',
      });
      manager.addEntry({ category: 'task', tokens: 300, compressible: true, referenceId: 'task-2' });

      const removed = manager.removeEntriesByReference('task-1');

      expect(removed).toBe(2);
      expect(manager.getAllEntries()).toHaveLength(1);
      expect(manager.getAllEntries()[0].referenceId).toBe('task-2');
    });

    it('should return 0 when no entries match', () => {
      manager.addEntry({ category: 'task', tokens: 100, compressible: true, referenceId: 'task-1' });

      const removed = manager.removeEntriesByReference('non-existent');

      expect(removed).toBe(0);
      expect(manager.getAllEntries()).toHaveLength(1);
    });
  });

  describe('getBudget', () => {
    it('should return current budget status', () => {
      manager.addEntry({ category: 'system', tokens: 5000, compressible: false });
      manager.addEntry({ category: 'task', tokens: 3000, compressible: true });

      const budget = manager.getBudget();

      expect(budget.maxTokens).toBe(200000);
      expect(budget.targetUtilization).toBe(0.5);
      expect(budget.currentEstimate).toBe(8000);
      expect(budget.lastEstimated).toBeInstanceOf(Date);
    });

    it('should return 0 currentEstimate when no entries', () => {
      const budget = manager.getBudget();
      expect(budget.currentEstimate).toBe(0);
    });
  });

  describe('isWithinBudget', () => {
    it('should return true when under target utilization', () => {
      // Target is 50% of 200000 = 100000
      manager.addEntry({ category: 'system', tokens: 50000, compressible: false });

      expect(manager.isWithinBudget()).toBe(true);
    });

    it('should return false when at target utilization', () => {
      // Target is 50% of 200000 = 100000
      manager.addEntry({ category: 'system', tokens: 100000, compressible: false });

      expect(manager.isWithinBudget()).toBe(false);
    });

    it('should return false when over target utilization', () => {
      manager.addEntry({ category: 'system', tokens: 150000, compressible: false });

      expect(manager.isWithinBudget()).toBe(false);
    });

    it('should respect custom target utilization', () => {
      const customManager = new ContextBudgetManager({
        maxTokens: 100000,
        targetUtilization: 0.8, // 80% = 80000 tokens
      });

      customManager.addEntry({ category: 'system', tokens: 70000, compressible: false });
      expect(customManager.isWithinBudget()).toBe(true);

      customManager.addEntry({ category: 'task', tokens: 15000, compressible: true });
      expect(customManager.isWithinBudget()).toBe(false);
    });
  });

  describe('shouldWarn', () => {
    it('should return false when under warning threshold', () => {
      // Warning at 40% of 200000 = 80000
      manager.addEntry({ category: 'system', tokens: 50000, compressible: false });

      expect(manager.shouldWarn()).toBe(false);
    });

    it('should return true when at warning threshold', () => {
      manager.addEntry({ category: 'system', tokens: 80000, compressible: false });

      expect(manager.shouldWarn()).toBe(true);
    });

    it('should return true when between warning and target threshold', () => {
      // Warning: 80000, Target: 100000
      manager.addEntry({ category: 'system', tokens: 90000, compressible: false });

      expect(manager.shouldWarn()).toBe(true);
    });

    it('should return false when at or over target threshold', () => {
      // At target (100000)
      manager.addEntry({ category: 'system', tokens: 100000, compressible: false });
      expect(manager.shouldWarn()).toBe(false);

      // Over target
      manager.clear();
      manager.addEntry({ category: 'system', tokens: 150000, compressible: false });
      expect(manager.shouldWarn()).toBe(false);
    });

    it('should work with custom thresholds', () => {
      const customManager = new ContextBudgetManager({
        maxTokens: 100000,
        warningThreshold: 0.3, // 30% = 30000
        targetUtilization: 0.5, // 50% = 50000
      });

      customManager.addEntry({ category: 'system', tokens: 25000, compressible: false });
      expect(customManager.shouldWarn()).toBe(false);

      customManager.addEntry({ category: 'task', tokens: 10000, compressible: true });
      expect(customManager.shouldWarn()).toBe(true);
    });
  });

  describe('getCompressibleEntries', () => {
    it('should return only compressible entries', () => {
      manager.addEntry({ category: 'system', tokens: 1000, compressible: false });
      manager.addEntry({ category: 'task', tokens: 500, compressible: true });
      manager.addEntry({ category: 'response', tokens: 800, compressible: true });
      manager.addEntry({ category: 'history', tokens: 200, compressible: false });

      const compressible = manager.getCompressibleEntries();

      expect(compressible).toHaveLength(2);
      expect(compressible.every(e => e.compressible)).toBe(true);
    });

    it('should return entries sorted by age (oldest first)', async () => {
      manager.addEntry({ category: 'task', tokens: 100, compressible: true, referenceId: 'first' });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.addEntry({
        category: 'task',
        tokens: 200,
        compressible: true,
        referenceId: 'second',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      manager.addEntry({ category: 'task', tokens: 300, compressible: true, referenceId: 'third' });

      const compressible = manager.getCompressibleEntries();

      expect(compressible[0].referenceId).toBe('first');
      expect(compressible[1].referenceId).toBe('second');
      expect(compressible[2].referenceId).toBe('third');
    });

    it('should return empty array when no compressible entries', () => {
      manager.addEntry({ category: 'system', tokens: 1000, compressible: false });

      expect(manager.getCompressibleEntries()).toHaveLength(0);
    });
  });

  describe('getUsageByCategory', () => {
    it('should return tokens grouped by category', () => {
      manager.addEntry({ category: 'system', tokens: 1000, compressible: false });
      manager.addEntry({ category: 'system', tokens: 500, compressible: false });
      manager.addEntry({ category: 'task', tokens: 2000, compressible: true });
      manager.addEntry({ category: 'response', tokens: 800, compressible: true });
      manager.addEntry({ category: 'history', tokens: 1500, compressible: true });

      const usage = manager.getUsageByCategory();

      expect(usage.system).toBe(1500);
      expect(usage.task).toBe(2000);
      expect(usage.response).toBe(800);
      expect(usage.history).toBe(1500);
    });

    it('should return 0 for categories with no entries', () => {
      manager.addEntry({ category: 'system', tokens: 1000, compressible: false });

      const usage = manager.getUsageByCategory();

      expect(usage.system).toBe(1000);
      expect(usage.task).toBe(0);
      expect(usage.response).toBe(0);
      expect(usage.history).toBe(0);
    });

    it('should return all zeros when no entries', () => {
      const usage = manager.getUsageByCategory();

      expect(usage.system).toBe(0);
      expect(usage.task).toBe(0);
      expect(usage.response).toBe(0);
      expect(usage.history).toBe(0);
    });
  });

  describe('getEntriesByCategory', () => {
    it('should return entries filtered by category', () => {
      manager.addEntry({ category: 'system', tokens: 1000, compressible: false });
      manager.addEntry({ category: 'task', tokens: 500, compressible: true });
      manager.addEntry({ category: 'task', tokens: 800, compressible: true });

      const taskEntries = manager.getEntriesByCategory('task');

      expect(taskEntries).toHaveLength(2);
      expect(taskEntries.every(e => e.category === 'task')).toBe(true);
    });

    it('should return empty array for category with no entries', () => {
      manager.addEntry({ category: 'system', tokens: 1000, compressible: false });

      expect(manager.getEntriesByCategory('history')).toHaveLength(0);
    });
  });

  describe('getEntry', () => {
    it('should return entry by ID', () => {
      manager.addEntry({ category: 'system', tokens: 1000, compressible: false });
      const entries = manager.getAllEntries();
      const entryId = entries[0].id;

      const entry = manager.getEntry(entryId);

      expect(entry).toBeDefined();
      expect(entry?.id).toBe(entryId);
      expect(entry?.tokens).toBe(1000);
    });

    it('should return undefined for non-existent ID', () => {
      expect(manager.getEntry('non-existent')).toBeUndefined();
    });
  });

  describe('getCurrentUtilization', () => {
    it('should return utilization ratio', () => {
      // 50000 / 200000 = 0.25 (25%)
      manager.addEntry({ category: 'system', tokens: 50000, compressible: false });

      expect(manager.getCurrentUtilization()).toBe(0.25);
    });

    it('should return 0 when no entries', () => {
      expect(manager.getCurrentUtilization()).toBe(0);
    });

    it('should return value > 1 when over max', () => {
      manager.addEntry({ category: 'system', tokens: 250000, compressible: false });

      expect(manager.getCurrentUtilization()).toBe(1.25);
    });
  });

  describe('getRemainingBudget', () => {
    it('should return tokens remaining before hitting target', () => {
      // Target: 100000, Current: 30000, Remaining: 70000
      manager.addEntry({ category: 'system', tokens: 30000, compressible: false });

      expect(manager.getRemainingBudget()).toBe(70000);
    });

    it('should return 0 when at or over target', () => {
      manager.addEntry({ category: 'system', tokens: 100000, compressible: false });
      expect(manager.getRemainingBudget()).toBe(0);

      manager.addEntry({ category: 'task', tokens: 50000, compressible: true });
      expect(manager.getRemainingBudget()).toBe(0);
    });

    it('should return full budget when empty', () => {
      // Target: 50% of 200000 = 100000
      expect(manager.getRemainingBudget()).toBe(100000);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      manager.addEntry({ category: 'system', tokens: 1000, compressible: false });
      manager.addEntry({ category: 'task', tokens: 500, compressible: true });
      manager.addEntry({ category: 'response', tokens: 800, compressible: true });

      manager.clear();

      expect(manager.getAllEntries()).toHaveLength(0);
      expect(manager.getBudget().currentEstimate).toBe(0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle typical orchestrator workflow', () => {
      // 1. Add system context (non-compressible)
      manager.addEntry({
        category: 'system',
        content: 'System prompt with guidelines and capabilities documentation...',
        compressible: false,
      });

      // 2. Start multiple tasks
      manager.addEntry({
        category: 'task',
        content: 'Task 1: Implement feature X with specifications...',
        compressible: true,
        referenceId: 'task-1',
      });

      manager.addEntry({
        category: 'task',
        content: 'Task 2: Fix bug Y with reproduction steps...',
        compressible: true,
        referenceId: 'task-2',
      });

      // 3. Receive responses
      manager.addEntry({
        category: 'response',
        content: 'Response from agent working on task 1...',
        compressible: true,
        referenceId: 'task-1',
      });

      // 4. Check budget status
      expect(manager.isWithinBudget()).toBe(true);

      // 5. Complete task 1, remove its entries
      const removed = manager.removeEntriesByReference('task-1');
      expect(removed).toBe(2);

      // 6. Verify cleanup
      const remainingEntries = manager.getAllEntries();
      expect(remainingEntries.some(e => e.referenceId === 'task-1')).toBe(false);
    });

    it('should correctly identify when compression is needed', () => {
      // Simulate building up history that pushes us toward threshold
      const customManager = new ContextBudgetManager({
        maxTokens: 1000,
        targetUtilization: 0.5, // 500 tokens
        warningThreshold: 0.4, // 400 tokens
      });

      // Add some system context
      customManager.addEntry({ category: 'system', tokens: 100, compressible: false });

      // Add history entries
      for (let i = 0; i < 5; i++) {
        customManager.addEntry({
          category: 'history',
          tokens: 50,
          compressible: true,
          referenceId: `history-${i}`,
        });
      }

      // Now at 350 tokens - still under warning
      expect(customManager.shouldWarn()).toBe(false);

      // Add one more
      customManager.addEntry({
        category: 'history',
        tokens: 100,
        compressible: true,
        referenceId: 'history-5',
      });

      // Now at 450 tokens - should warn
      expect(customManager.shouldWarn()).toBe(true);
      expect(customManager.isWithinBudget()).toBe(true);

      // Get compression candidates
      const compressible = customManager.getCompressibleEntries();
      expect(compressible.length).toBe(6);

      // Simulate compression by removing oldest
      customManager.removeEntriesByReference('history-0');
      customManager.removeEntriesByReference('history-1');

      // Back to safe zone
      expect(customManager.shouldWarn()).toBe(false);
    });
  });
});
