import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScreenshotCapture, ScreenshotConfig } from './screenshot-capture.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock Playwright
const mockScreenshot = vi.fn();
const mockSetViewportSize = vi.fn();
const mockGoto = vi.fn();
const mockWaitForSelector = vi.fn();
const mockLocator = vi.fn();
const mockClose = vi.fn();
const mockNewPage = vi.fn();
const mockBrowserClose = vi.fn();

const mockPage = {
  setViewportSize: mockSetViewportSize,
  goto: mockGoto,
  waitForSelector: mockWaitForSelector,
  locator: mockLocator,
  screenshot: mockScreenshot,
  close: mockClose
};

const mockBrowser = {
  newPage: mockNewPage,
  close: mockBrowserClose
};

const mockLaunch = vi.fn();

vi.mock('playwright', () => ({
  chromium: {
    launch: () => mockLaunch()
  }
}));

describe('ScreenshotCapture', () => {
  let capture: ScreenshotCapture;
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock chain
    mockLaunch.mockResolvedValue(mockBrowser);
    mockNewPage.mockResolvedValue(mockPage);
    mockGoto.mockResolvedValue(undefined);
    mockSetViewportSize.mockResolvedValue(undefined);
    mockWaitForSelector.mockResolvedValue(undefined);
    mockLocator.mockReturnValue({ screenshot: mockScreenshot });
    mockScreenshot.mockResolvedValue(Buffer.from('fake-screenshot-data'));
    mockClose.mockResolvedValue(undefined);
    mockBrowserClose.mockResolvedValue(undefined);

    // Use unique directory per test run to avoid conflicts with parallel tests
    testDir = path.join(process.cwd(), `test-screenshots-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    capture = new ScreenshotCapture({ outputDir: testDir });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe('capture', () => {
    it('should capture a screenshot with default viewport', async () => {
      const config: ScreenshotConfig = {
        url: 'https://example.com'
      };

      const result = await capture.capture(config);

      expect(result.path).toBeDefined();
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(mockLaunch).toHaveBeenCalled();
      expect(mockNewPage).toHaveBeenCalled();
      expect(mockGoto).toHaveBeenCalledWith('https://example.com', expect.any(Object));
      expect(mockSetViewportSize).toHaveBeenCalledWith({ width: 1280, height: 720 });
      expect(mockScreenshot).toHaveBeenCalled();
      expect(mockBrowserClose).toHaveBeenCalled();
    });

    it('should capture a screenshot with custom viewport', async () => {
      const config: ScreenshotConfig = {
        url: 'https://example.com',
        viewport: { width: 1920, height: 1080 }
      };

      await capture.capture(config);

      expect(mockSetViewportSize).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    });

    it('should capture a full page screenshot', async () => {
      const config: ScreenshotConfig = {
        url: 'https://example.com',
        fullPage: true
      };

      await capture.capture(config);

      expect(mockScreenshot).toHaveBeenCalledWith(expect.objectContaining({
        fullPage: true
      }));
    });

    it('should capture a screenshot of a specific selector', async () => {
      const config: ScreenshotConfig = {
        url: 'https://example.com',
        selector: '#main-content'
      };

      await capture.capture(config);

      expect(mockLocator).toHaveBeenCalledWith('#main-content');
    });

    it('should wait for a selector before capturing', async () => {
      const config: ScreenshotConfig = {
        url: 'https://example.com',
        waitFor: '.loaded-indicator'
      };

      await capture.capture(config);

      expect(mockWaitForSelector).toHaveBeenCalledWith('.loaded-indicator', expect.any(Object));
    });

    it('should generate unique filenames', async () => {
      const config: ScreenshotConfig = {
        url: 'https://example.com'
      };

      const result1 = await capture.capture(config);
      const result2 = await capture.capture(config);

      expect(result1.path).not.toBe(result2.path);
    });

    it('should throw error when browser launch fails', async () => {
      mockLaunch.mockRejectedValue(new Error('Browser launch failed'));

      const config: ScreenshotConfig = {
        url: 'https://example.com'
      };

      await expect(capture.capture(config)).rejects.toThrow('Failed to capture screenshot');
    });

    it('should throw error when page navigation fails', async () => {
      mockGoto.mockRejectedValue(new Error('Navigation failed'));

      const config: ScreenshotConfig = {
        url: 'https://example.com'
      };

      await expect(capture.capture(config)).rejects.toThrow('Failed to capture screenshot');
    });

    it('should close browser even when capture fails', async () => {
      mockScreenshot.mockRejectedValue(new Error('Screenshot failed'));

      const config: ScreenshotConfig = {
        url: 'https://example.com'
      };

      await expect(capture.capture(config)).rejects.toThrow();
      expect(mockBrowserClose).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should delete screenshots older than specified date', async () => {
      // Create the output directory
      await fs.mkdir(testDir, { recursive: true });

      // Create some test files
      const oldFile = path.join(testDir, 'old-screenshot.png');
      const newFile = path.join(testDir, 'new-screenshot.png');

      await fs.writeFile(oldFile, 'old');
      await fs.writeFile(newFile, 'new');

      // Set the old file's mtime to the past
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      await fs.utimes(oldFile, oldDate, oldDate);

      // Cleanup files older than 3 days
      const cutoffDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const deletedCount = await capture.cleanup(cutoffDate);

      expect(deletedCount).toBe(1);

      // Verify old file was deleted
      await expect(fs.access(oldFile)).rejects.toThrow();

      // Verify new file still exists
      await expect(fs.access(newFile)).resolves.not.toThrow();
    });

    it('should return 0 when no files to cleanup', async () => {
      await fs.mkdir(testDir, { recursive: true });

      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const deletedCount = await capture.cleanup(cutoffDate);

      expect(deletedCount).toBe(0);
    });

    it('should handle non-existent directory gracefully', async () => {
      const captureWithNonexistentDir = new ScreenshotCapture({
        outputDir: '/nonexistent/directory'
      });

      const cutoffDate = new Date();
      const deletedCount = await captureWithNonexistentDir.cleanup(cutoffDate);

      expect(deletedCount).toBe(0);
    });
  });

  describe('getOutputDir', () => {
    it('should return the configured output directory', () => {
      expect(capture.getOutputDir()).toBe(testDir);
    });

    it('should use default directory when not specified', () => {
      const defaultCapture = new ScreenshotCapture();
      expect(defaultCapture.getOutputDir()).toContain('screenshots');
    });
  });

  describe('upload', () => {
    it('should save buffer to file and return file URL', async () => {
      const buffer = Buffer.from('test-screenshot-data');
      const filename = 'test-upload.png';

      const url = await capture.upload(buffer, filename);

      expect(url).toContain('file://');
      expect(url).toContain(filename);
      // Check that the path contains key directory name (works cross-platform)
      expect(url).toContain('test-screenshots');

      // Verify file exists and has correct content
      const filepath = path.join(testDir, filename);
      const savedContent = await fs.readFile(filepath);
      expect(savedContent.toString()).toBe('test-screenshot-data');
    });

    it('should create output directory if it does not exist', async () => {
      const nestedDir = path.join(testDir, 'nested', 'upload-dir');
      const newCapture = new ScreenshotCapture({ outputDir: nestedDir });
      const buffer = Buffer.from('nested-test-data');

      const url = await newCapture.upload(buffer, 'test.png');

      expect(url).toContain('test.png');

      // Verify directory was created and file exists
      const filepath = path.join(nestedDir, 'test.png');
      const savedContent = await fs.readFile(filepath);
      expect(savedContent.toString()).toBe('nested-test-data');

      // Cleanup the nested directory
      await fs.rm(nestedDir, { recursive: true, force: true });
    });
  });
});
