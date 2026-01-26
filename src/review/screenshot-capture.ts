import * as fs from 'fs/promises';
import * as path from 'path';
import { chromium, Browser, Page } from 'playwright';

export interface ScreenshotConfig {
  url: string;
  viewport?: { width: number; height: number };
  fullPage?: boolean;
  selector?: string;
  waitFor?: string;
}

export interface ScreenshotResult {
  path: string;
  buffer: Buffer;
}

export interface ScreenshotCaptureOptions {
  outputDir?: string;
}

/**
 * Captures screenshots via Playwright for visual review.
 */
export class ScreenshotCapture {
  private outputDir: string;

  constructor(options: ScreenshotCaptureOptions = {}) {
    this.outputDir = options.outputDir ?? path.join(process.cwd(), 'screenshots');
  }

  /**
   * Captures a screenshot of the specified URL.
   * @param config Screenshot configuration
   * @returns Object containing the file path and image buffer
   */
  async capture(config: ScreenshotConfig): Promise<ScreenshotResult> {
    let browser: Browser | null = null;

    try {
      // Launch browser
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();

      // Set viewport
      const viewport = config.viewport ?? { width: 1280, height: 720 };
      await page.setViewportSize(viewport);

      // Navigate to URL
      await page.goto(config.url, { waitUntil: 'networkidle' });

      // Wait for specific selector if specified
      if (config.waitFor) {
        await page.waitForSelector(config.waitFor, { timeout: 10000 });
      }

      // Generate unique filename
      const filename = this.generateFilename();
      const filepath = path.join(this.outputDir, filename);

      // Ensure output directory exists
      await fs.mkdir(this.outputDir, { recursive: true });

      // Capture screenshot
      let buffer: Buffer;

      if (config.selector) {
        // Screenshot specific element
        const element = page.locator(config.selector);
        buffer = await element.screenshot({ path: filepath });
      } else {
        // Screenshot full page or viewport
        buffer = await page.screenshot({
          path: filepath,
          fullPage: config.fullPage ?? false
        });
      }

      await page.close();

      return { path: filepath, buffer };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to capture screenshot: ${message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Cleans up screenshots older than the specified date.
   * @param olderThan Date threshold for cleanup
   * @returns Number of files deleted
   */
  async cleanup(olderThan: Date): Promise<number> {
    try {
      // Check if directory exists
      try {
        await fs.access(this.outputDir);
      } catch {
        return 0; // Directory doesn't exist
      }

      const files = await fs.readdir(this.outputDir);
      let deletedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.png')) continue;

        const filepath = path.join(this.outputDir, file);
        const stats = await fs.stat(filepath);

        if (stats.mtime < olderThan) {
          await fs.unlink(filepath);
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error) {
      // Log error but don't throw - cleanup is not critical
      console.error('Error during screenshot cleanup:', error);
      return 0;
    }
  }

  /**
   * Returns the configured output directory.
   */
  getOutputDir(): string {
    return this.outputDir;
  }

  /**
   * Uploads a screenshot buffer to storage (placeholder for Supabase storage).
   * Returns the URL where the screenshot can be accessed.
   * @param buffer The image buffer to upload
   * @param filename The filename to use for storage
   * @returns URL to the uploaded screenshot
   */
  async upload(buffer: Buffer, filename: string): Promise<string> {
    // For now, save locally and return a file:// URL
    // In production, this would upload to Supabase storage
    await fs.mkdir(this.outputDir, { recursive: true });
    const filepath = path.join(this.outputDir, filename);
    await fs.writeFile(filepath, buffer);
    return `file://${filepath}`;
  }

  /**
   * Generates a unique filename for a screenshot.
   */
  private generateFilename(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `screenshot-${timestamp}-${random}.png`;
  }
}
