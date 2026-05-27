import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      LOG_LEVEL: 'error',
    },
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Use forks pool to isolate native modules (better-sqlite3)
    // This prevents "Cannot use import statement" and native binding issues
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      }
    },
    // Run tests sequentially to avoid SQLite file conflicts
    sequence: {
      concurrent: false,
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
});
