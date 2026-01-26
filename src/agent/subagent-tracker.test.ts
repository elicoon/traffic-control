import { describe, it, expect, beforeEach } from 'vitest';
import { SubagentTracker } from './subagent-tracker.js';

describe('SubagentTracker', () => {
  let tracker: SubagentTracker;

  beforeEach(() => {
    tracker = new SubagentTracker();
  });

  describe('constructor', () => {
    it('should create an instance with default max depth of 2', () => {
      expect(tracker).toBeDefined();
      expect(tracker.getMaxDepth()).toBe(2);
    });

    it('should accept custom max depth', () => {
      const customTracker = new SubagentTracker(3);
      expect(customTracker.getMaxDepth()).toBe(3);
    });

    it('should enforce minimum max depth of 1', () => {
      const customTracker = new SubagentTracker(0);
      expect(customTracker.getMaxDepth()).toBe(1);
    });
  });

  describe('registerRootSession', () => {
    it('should register a root session with depth 0', () => {
      tracker.registerRootSession('session-1');
      expect(tracker.getDepth('session-1')).toBe(0);
    });

    it('should return the session hierarchy', () => {
      const hierarchy = tracker.registerRootSession('session-1');
      expect(hierarchy.sessionId).toBe('session-1');
      expect(hierarchy.parentId).toBeNull();
      expect(hierarchy.depth).toBe(0);
      expect(hierarchy.children).toEqual([]);
    });
  });

  describe('canSpawnSubagent', () => {
    it('should return true for root session', () => {
      tracker.registerRootSession('root');
      expect(tracker.canSpawnSubagent('root')).toBe(true);
    });

    it('should return true for first level subagent', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child-1');
      expect(tracker.canSpawnSubagent('child-1')).toBe(true);
    });

    it('should return false when at max depth', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'level-1');
      tracker.registerSubagent('level-1', 'level-2');
      expect(tracker.canSpawnSubagent('level-2')).toBe(false);
    });

    it('should return false for unknown session', () => {
      expect(tracker.canSpawnSubagent('unknown')).toBe(false);
    });

    it('should respect custom max depth', () => {
      const deepTracker = new SubagentTracker(3);
      deepTracker.registerRootSession('root');
      deepTracker.registerSubagent('root', 'level-1');
      deepTracker.registerSubagent('level-1', 'level-2');
      expect(deepTracker.canSpawnSubagent('level-2')).toBe(true);
      deepTracker.registerSubagent('level-2', 'level-3');
      expect(deepTracker.canSpawnSubagent('level-3')).toBe(false);
    });
  });

  describe('registerSubagent', () => {
    it('should register a subagent with correct depth', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child-1');
      expect(tracker.getDepth('child-1')).toBe(1);
    });

    it('should add child to parent hierarchy', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child-1');
      const hierarchy = tracker.getHierarchy('root');
      expect(hierarchy?.children).toHaveLength(1);
      expect(hierarchy?.children[0].sessionId).toBe('child-1');
    });

    it('should handle nested subagents', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'level-1');
      tracker.registerSubagent('level-1', 'level-2');
      expect(tracker.getDepth('level-2')).toBe(2);
    });

    it('should throw error if parent session not found', () => {
      expect(() => tracker.registerSubagent('unknown', 'child')).toThrow(
        'Parent session unknown not found'
      );
    });

    it('should throw error if max depth exceeded', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'level-1');
      tracker.registerSubagent('level-1', 'level-2');
      expect(() => tracker.registerSubagent('level-2', 'level-3')).toThrow(
        'Maximum subagent depth'
      );
    });

    it('should return the new subagent hierarchy', () => {
      tracker.registerRootSession('root');
      const hierarchy = tracker.registerSubagent('root', 'child-1');
      expect(hierarchy.sessionId).toBe('child-1');
      expect(hierarchy.parentId).toBe('root');
      expect(hierarchy.depth).toBe(1);
    });
  });

  describe('getDepth', () => {
    it('should return 0 for root session', () => {
      tracker.registerRootSession('root');
      expect(tracker.getDepth('root')).toBe(0);
    });

    it('should return correct depth for nested sessions', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'level-1');
      tracker.registerSubagent('level-1', 'level-2');
      expect(tracker.getDepth('level-2')).toBe(2);
    });

    it('should return -1 for unknown session', () => {
      expect(tracker.getDepth('unknown')).toBe(-1);
    });
  });

  describe('getDescendants', () => {
    it('should return empty array for session with no children', () => {
      tracker.registerRootSession('root');
      expect(tracker.getDescendants('root')).toEqual([]);
    });

    it('should return direct children', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child-1');
      tracker.registerSubagent('root', 'child-2');
      const descendants = tracker.getDescendants('root');
      expect(descendants).toContain('child-1');
      expect(descendants).toContain('child-2');
      expect(descendants).toHaveLength(2);
    });

    it('should return all descendants recursively', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child-1');
      tracker.registerSubagent('root', 'child-2');
      tracker.registerSubagent('child-1', 'grandchild-1');
      const descendants = tracker.getDescendants('root');
      expect(descendants).toContain('child-1');
      expect(descendants).toContain('child-2');
      expect(descendants).toContain('grandchild-1');
      expect(descendants).toHaveLength(3);
    });

    it('should return empty array for unknown session', () => {
      expect(tracker.getDescendants('unknown')).toEqual([]);
    });
  });

  describe('getRootSession', () => {
    it('should return session itself if it is root', () => {
      tracker.registerRootSession('root');
      expect(tracker.getRootSession('root')).toBe('root');
    });

    it('should return root for direct child', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child');
      expect(tracker.getRootSession('child')).toBe('root');
    });

    it('should return root for deeply nested session', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'level-1');
      tracker.registerSubagent('level-1', 'level-2');
      expect(tracker.getRootSession('level-2')).toBe('root');
    });

    it('should return null for unknown session', () => {
      expect(tracker.getRootSession('unknown')).toBeNull();
    });
  });

  describe('removeSession', () => {
    it('should remove a root session', () => {
      tracker.registerRootSession('root');
      tracker.removeSession('root');
      expect(tracker.getDepth('root')).toBe(-1);
    });

    it('should remove session from parent children', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child');
      tracker.removeSession('child');
      expect(tracker.getHierarchy('root')?.children).toHaveLength(0);
    });

    it('should remove all descendants when removing a session', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child');
      tracker.registerSubagent('child', 'grandchild');
      tracker.removeSession('child');
      expect(tracker.getDepth('child')).toBe(-1);
      expect(tracker.getDepth('grandchild')).toBe(-1);
    });

    it('should handle removing unknown session gracefully', () => {
      expect(() => tracker.removeSession('unknown')).not.toThrow();
    });
  });

  describe('getHierarchy', () => {
    it('should return full hierarchy for root session', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child-1');
      tracker.registerSubagent('child-1', 'grandchild');

      const hierarchy = tracker.getHierarchy('root');
      expect(hierarchy?.sessionId).toBe('root');
      expect(hierarchy?.children).toHaveLength(1);
      expect(hierarchy?.children[0].sessionId).toBe('child-1');
      expect(hierarchy?.children[0].children).toHaveLength(1);
      expect(hierarchy?.children[0].children[0].sessionId).toBe('grandchild');
    });

    it('should return null for unknown session', () => {
      expect(tracker.getHierarchy('unknown')).toBeNull();
    });
  });

  describe('getParentId', () => {
    it('should return null for root session', () => {
      tracker.registerRootSession('root');
      expect(tracker.getParentId('root')).toBeNull();
    });

    it('should return parent ID for child session', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child');
      expect(tracker.getParentId('child')).toBe('root');
    });

    it('should return null for unknown session', () => {
      expect(tracker.getParentId('unknown')).toBeNull();
    });
  });

  describe('getAllRootSessions', () => {
    it('should return empty array when no sessions', () => {
      expect(tracker.getAllRootSessions()).toEqual([]);
    });

    it('should return all root sessions', () => {
      tracker.registerRootSession('root-1');
      tracker.registerRootSession('root-2');
      const roots = tracker.getAllRootSessions();
      expect(roots).toContain('root-1');
      expect(roots).toContain('root-2');
      expect(roots).toHaveLength(2);
    });

    it('should not include child sessions', () => {
      tracker.registerRootSession('root');
      tracker.registerSubagent('root', 'child');
      const roots = tracker.getAllRootSessions();
      expect(roots).toEqual(['root']);
    });
  });
});
