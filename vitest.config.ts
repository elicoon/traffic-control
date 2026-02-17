import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test-setup.ts',
      ],
    },
  },
});
