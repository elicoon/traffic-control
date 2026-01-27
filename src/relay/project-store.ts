/**
 * Project Store for Slack Claude Relay
 *
 * Persisted store for mapping Slack channel IDs to project paths.
 * This allows the bot to remember which directory to use for each channel.
 *
 * Data is persisted to ~/.relay-projects.json
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { logger } from '../logging/index.js';

const log = logger.child('Relay.ProjectStore');

/**
 * Default file path for persisted project mappings
 */
const DEFAULT_FILE_PATH = join(homedir(), '.relay-projects.json');

/**
 * Persisted project store.
 * Maps Slack channel IDs to project directory paths.
 */
export class ProjectStore {
  /** Channel ID -> Project path mapping */
  private projects: Map<string, string> = new Map();

  /** File path for persistence */
  private filePath: string;

  /** Base directory for project discovery */
  private projectsBaseDir?: string;

  /**
   * Create a new ProjectStore.
   *
   * @param filePath - Path to the JSON file for persistence (default: ~/.relay-projects.json)
   * @param projectsBaseDir - Base directory for fuzzy project matching (optional)
   */
  constructor(filePath?: string, projectsBaseDir?: string) {
    this.filePath = filePath ?? DEFAULT_FILE_PATH;
    this.projectsBaseDir = projectsBaseDir;
  }

  /**
   * Set the base directory for project discovery.
   *
   * @param baseDir - Base directory path (e.g., "/path/to/your/projects")
   */
  setProjectsBaseDir(baseDir: string): void {
    this.projectsBaseDir = baseDir;
    log.info('Set projects base directory', { baseDir });
  }

  /**
   * Get the configured projects base directory.
   *
   * @returns The base directory, or undefined if not set
   */
  getProjectsBaseDir(): string | undefined {
    return this.projectsBaseDir;
  }

  /**
   * Get the project path for a Slack channel.
   *
   * @param channelId - Slack channel ID
   * @returns The project path, or undefined if not set
   */
  get(channelId: string): string | undefined {
    return this.projects.get(channelId);
  }

  /**
   * Store a project path for a Slack channel.
   * Automatically persists to disk.
   *
   * @param channelId - Slack channel ID
   * @param projectPath - Path to the project directory
   */
  set(channelId: string, projectPath: string): void {
    this.projects.set(channelId, projectPath);
    this.save();
  }

  /**
   * Delete the project mapping for a channel.
   * Automatically persists to disk.
   *
   * @param channelId - Slack channel ID
   * @returns true if the mapping existed and was deleted
   */
  delete(channelId: string): boolean {
    const result = this.projects.delete(channelId);
    if (result) {
      this.save();
    }
    return result;
  }

  /**
   * Check if a project mapping exists for a channel.
   *
   * @param channelId - Slack channel ID
   * @returns true if a mapping exists
   */
  has(channelId: string): boolean {
    return this.projects.has(channelId);
  }

  /**
   * Get the number of stored project mappings.
   *
   * @returns Number of channel-to-project mappings
   */
  size(): number {
    return this.projects.size;
  }

  /**
   * Get all channel IDs with project mappings.
   *
   * @returns Array of channel IDs
   */
  channels(): string[] {
    return Array.from(this.projects.keys());
  }

  /**
   * Get the file path used for persistence.
   *
   * @returns Path to the JSON file
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Load project mappings from disk.
   * Called automatically on construction if the file exists.
   *
   * @throws Error if the file exists but cannot be parsed
   */
  load(): void {
    if (!existsSync(this.filePath)) {
      log.debug('Project store file does not exist, starting fresh', {
        filePath: this.filePath,
      });
      return;
    }

    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, string>;

      this.projects.clear();
      for (const [channelId, projectPath] of Object.entries(data)) {
        if (typeof channelId === 'string' && typeof projectPath === 'string') {
          this.projects.set(channelId, projectPath);
        }
      }

      log.info('Loaded project mappings from disk', {
        filePath: this.filePath,
        count: this.projects.size,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to load project store', err, { filePath: this.filePath });
      throw err;
    }
  }

  /**
   * Save project mappings to disk.
   * Called automatically when mappings change.
   */
  save(): void {
    try {
      const data: Record<string, string> = {};
      for (const [channelId, projectPath] of this.projects) {
        data[channelId] = projectPath;
      }

      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');

      log.debug('Saved project mappings to disk', {
        filePath: this.filePath,
        count: this.projects.size,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to save project store', err, { filePath: this.filePath });
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Clear all project mappings.
   * Automatically persists to disk.
   */
  clear(): void {
    this.projects.clear();
    this.save();
  }

  /**
   * Get all mappings as a plain object.
   * Useful for debugging or display.
   *
   * @returns Object mapping channel IDs to project paths
   */
  toObject(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [channelId, projectPath] of this.projects) {
      result[channelId] = projectPath;
    }
    return result;
  }

  /**
   * Resolve a project path from user input.
   *
   * If the input is an absolute path, validates it exists and returns it.
   * If the input is a partial name (like "trafficcontrol"), searches the
   * projectsBaseDir for a matching directory using fuzzy matching.
   *
   * Fuzzy matching:
   * - Case-insensitive
   * - Ignores hyphens, underscores, and spaces
   * - First tries exact normalized match, then partial match
   *
   * @param input - User-provided path or project name
   * @returns Resolved full path, or null if not found
   */
  resolveProjectPath(input: string): string | null {
    const trimmed = input.trim();

    // If it's an absolute path, validate and return
    if (isAbsolute(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
      if (existsSync(trimmed)) {
        log.debug('Input is a valid absolute path', { input: trimmed });
        return trimmed;
      }
      log.debug('Input looks like a path but does not exist', { input: trimmed });
      return null;
    }

    // Try to resolve using projectsBaseDir
    if (!this.projectsBaseDir) {
      log.debug('No projectsBaseDir configured, cannot resolve partial name', { input: trimmed });
      return null;
    }

    if (!existsSync(this.projectsBaseDir)) {
      log.warn('projectsBaseDir does not exist', { baseDir: this.projectsBaseDir });
      return null;
    }

    const normalized = this.normalizeProjectName(trimmed);

    try {
      const entries = readdirSync(this.projectsBaseDir, { withFileTypes: true });

      // First pass: exact normalized match
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (this.normalizeProjectName(entry.name) === normalized) {
            const fullPath = join(this.projectsBaseDir, entry.name);
            log.info('Resolved project path (exact match)', {
              input: trimmed,
              resolved: fullPath,
            });
            return fullPath;
          }
        }
      }

      // Second pass: partial match (input is substring of directory name)
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (this.normalizeProjectName(entry.name).includes(normalized)) {
            const fullPath = join(this.projectsBaseDir, entry.name);
            log.info('Resolved project path (partial match)', {
              input: trimmed,
              resolved: fullPath,
            });
            return fullPath;
          }
        }
      }

      log.debug('No matching project found', { input: trimmed, baseDir: this.projectsBaseDir });
      return null;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Error searching projectsBaseDir', err, { baseDir: this.projectsBaseDir });
      return null;
    }
  }

  /**
   * Normalize a project name for fuzzy matching.
   * Converts to lowercase and removes hyphens, underscores, and spaces.
   *
   * @param name - Project name or directory name
   * @returns Normalized name
   */
  private normalizeProjectName(name: string): string {
    return name.toLowerCase().replace(/[-_\s]/g, '');
  }
}
