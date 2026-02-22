/**
 * Tests for ProjectStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectStore } from './project-store.js';
import { mkdtempSync, rmSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ProjectStore', () => {
  let tempDir: string;
  let storePath: string;
  let projectStore: ProjectStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-test-'));
    storePath = join(tempDir, 'projects.json');
  });

  afterEach(() => {
    try {
      // Clean up temp files
      if (projectStore) {
        const filePath = projectStore.getFilePath();
        try {
          unlinkSync(filePath);
        } catch {
          // Ignore if file doesn't exist
        }
      }
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('basic operations', () => {
    beforeEach(() => {
      projectStore = new ProjectStore(storePath);
    });

    it('should store and retrieve project paths', () => {
      projectStore.set('C123', '/path/to/project');
      expect(projectStore.get('C123')).toBe('/path/to/project');
    });

    it('should return undefined for unknown channels', () => {
      expect(projectStore.get('unknown')).toBeUndefined();
    });

    it('should persist to disk on set', () => {
      projectStore.set('C123', '/path/to/project');

      // Create a new store from the same file
      const store2 = new ProjectStore(storePath);
      store2.load();

      expect(store2.get('C123')).toBe('/path/to/project');
    });
  });

  describe('utility methods', () => {
    beforeEach(() => {
      projectStore = new ProjectStore(storePath);
    });

    it('should return undefined when projectsBaseDir not set', () => {
      expect(projectStore.getProjectsBaseDir()).toBeUndefined();
    });

    it('should return projectsBaseDir when set via constructor', () => {
      const store = new ProjectStore(storePath, '/some/dir');
      expect(store.getProjectsBaseDir()).toBe('/some/dir');
    });

    it('should delete a mapping and return true', () => {
      projectStore.set('C123', '/path/to/project');
      expect(projectStore.delete('C123')).toBe(true);
      expect(projectStore.get('C123')).toBeUndefined();
    });

    it('should return false when deleting non-existent mapping', () => {
      expect(projectStore.delete('nonexistent')).toBe(false);
    });

    it('should persist deletion to disk', () => {
      projectStore.set('C123', '/path/a');
      projectStore.set('C456', '/path/b');
      projectStore.delete('C123');

      const store2 = new ProjectStore(storePath);
      store2.load();
      expect(store2.get('C123')).toBeUndefined();
      expect(store2.get('C456')).toBe('/path/b');
    });

    it('should check if mapping exists', () => {
      expect(projectStore.has('C123')).toBe(false);
      projectStore.set('C123', '/path/to/project');
      expect(projectStore.has('C123')).toBe(true);
    });

    it('should return the number of mappings', () => {
      expect(projectStore.size()).toBe(0);
      projectStore.set('C1', '/a');
      projectStore.set('C2', '/b');
      expect(projectStore.size()).toBe(2);
    });

    it('should return all channel IDs', () => {
      projectStore.set('C1', '/a');
      projectStore.set('C2', '/b');
      expect(projectStore.channels()).toEqual(expect.arrayContaining(['C1', 'C2']));
      expect(projectStore.channels()).toHaveLength(2);
    });
  });

  describe('load', () => {
    it('should start fresh when file does not exist', () => {
      projectStore = new ProjectStore(storePath);
      projectStore.load();
      expect(projectStore.size()).toBe(0);
    });

    it('should load existing mappings from disk', () => {
      projectStore = new ProjectStore(storePath);
      projectStore.set('C1', '/path/a');
      projectStore.set('C2', '/path/b');

      const store2 = new ProjectStore(storePath);
      store2.load();
      expect(store2.get('C1')).toBe('/path/a');
      expect(store2.get('C2')).toBe('/path/b');
      expect(store2.size()).toBe(2);
    });

    it('should throw on corrupt JSON file', () => {
      writeFileSync(storePath, 'NOT VALID JSON{{{', 'utf-8');

      projectStore = new ProjectStore(storePath);
      expect(() => projectStore.load()).toThrow();
    });

    it('should skip non-string values during load', () => {
      writeFileSync(storePath, JSON.stringify({ C1: '/valid', C2: 123, C3: null }), 'utf-8');

      projectStore = new ProjectStore(storePath);
      projectStore.load();
      expect(projectStore.get('C1')).toBe('/valid');
      expect(projectStore.get('C2')).toBeUndefined();
      expect(projectStore.get('C3')).toBeUndefined();
      expect(projectStore.size()).toBe(1);
    });
  });

  describe('save error handling', () => {
    it('should not throw when save fails', () => {
      projectStore = new ProjectStore('/nonexistent-dir/impossible/store.json');
      expect(() => {
        projectStore.set('C1', '/path');
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    beforeEach(() => {
      projectStore = new ProjectStore(storePath);
    });

    it('should remove all mappings', () => {
      projectStore.set('C1', '/a');
      projectStore.set('C2', '/b');
      projectStore.clear();
      expect(projectStore.size()).toBe(0);
    });

    it('should persist empty state to disk', () => {
      projectStore.set('C1', '/a');
      projectStore.clear();

      const store2 = new ProjectStore(storePath);
      store2.load();
      expect(store2.size()).toBe(0);
    });
  });

  describe('toObject', () => {
    beforeEach(() => {
      projectStore = new ProjectStore(storePath);
    });

    it('should return empty object when no mappings', () => {
      expect(projectStore.toObject()).toEqual({});
    });

    it('should return all mappings as plain object', () => {
      projectStore.set('C1', '/path/a');
      projectStore.set('C2', '/path/b');
      expect(projectStore.toObject()).toEqual({
        C1: '/path/a',
        C2: '/path/b',
      });
    });
  });

  describe('resolveProjectPath', () => {
    let projectsDir: string;

    beforeEach(() => {
      // Create a mock projects directory with some subdirectories
      projectsDir = join(tempDir, 'projects');
      mkdirSync(projectsDir);
      mkdirSync(join(projectsDir, 'traffic-control'));
      mkdirSync(join(projectsDir, 'portfolio-website'));
      mkdirSync(join(projectsDir, 'my_cool_app'));

      projectStore = new ProjectStore(storePath, projectsDir);
    });

    it('should resolve exact directory names', () => {
      const result = projectStore.resolveProjectPath('traffic-control');
      expect(result).toBe(join(projectsDir, 'traffic-control'));
    });

    it('should resolve normalized names (no hyphens)', () => {
      const result = projectStore.resolveProjectPath('trafficcontrol');
      expect(result).toBe(join(projectsDir, 'traffic-control'));
    });

    it('should resolve case-insensitively', () => {
      const result = projectStore.resolveProjectPath('TRAFFICCONTROL');
      expect(result).toBe(join(projectsDir, 'traffic-control'));
    });

    it('should resolve names with underscores removed', () => {
      const result = projectStore.resolveProjectPath('mycoolapp');
      expect(result).toBe(join(projectsDir, 'my_cool_app'));
    });

    it('should handle partial matches', () => {
      const result = projectStore.resolveProjectPath('portfolio');
      expect(result).toBe(join(projectsDir, 'portfolio-website'));
    });

    it('should return null for non-existent projects', () => {
      const result = projectStore.resolveProjectPath('nonexistent');
      expect(result).toBeNull();
    });

    it('should validate absolute paths that exist', () => {
      const existingPath = join(projectsDir, 'traffic-control');
      const result = projectStore.resolveProjectPath(existingPath);
      expect(result).toBe(existingPath);
    });

    it('should return null for absolute paths that do not exist', () => {
      const nonExistentPath = join(projectsDir, 'does-not-exist');
      const result = projectStore.resolveProjectPath(nonExistentPath);
      expect(result).toBeNull();
    });

    it('should return null when projectsBaseDir is not set', () => {
      const storeWithoutBase = new ProjectStore(storePath);
      const result = storeWithoutBase.resolveProjectPath('trafficcontrol');
      expect(result).toBeNull();
    });

    it('should allow setting projectsBaseDir after construction', () => {
      const storeWithoutBase = new ProjectStore(storePath);
      storeWithoutBase.setProjectsBaseDir(projectsDir);

      const result = storeWithoutBase.resolveProjectPath('trafficcontrol');
      expect(result).toBe(join(projectsDir, 'traffic-control'));
    });

    it('should return null when projectsBaseDir does not exist on disk', () => {
      const store = new ProjectStore(storePath, '/nonexistent/base/dir');
      const result = store.resolveProjectPath('someproject');
      expect(result).toBeNull();
    });

    it('should return null when readdirSync throws an error', () => {
      // Use a file as projectsBaseDir - existsSync returns true but readdirSync throws ENOTDIR
      const filePath = join(tempDir, 'not-a-dir.txt');
      writeFileSync(filePath, 'not a directory', 'utf-8');

      const store = new ProjectStore(storePath, filePath);
      const result = store.resolveProjectPath('someproject');
      expect(result).toBeNull();
    });

    it('should trim whitespace from input', () => {
      const result = projectStore.resolveProjectPath('  traffic-control  ');
      expect(result).toBe(join(projectsDir, 'traffic-control'));
    });

    it('should handle relative path-like input with slashes', () => {
      // Input containing "/" is treated as a path, not a project name
      const result = projectStore.resolveProjectPath('some/relative/path');
      expect(result).toBeNull();
    });
  });
});
