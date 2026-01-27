/**
 * Tests for ProjectStore
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProjectStore } from './project-store.js';
import { mkdtempSync, rmSync, mkdirSync, unlinkSync } from 'node:fs';
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
  });
});
