import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['scripts/lib/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 75,
        statements: 80,
        branches: 70,
      },
    },
  },
});
