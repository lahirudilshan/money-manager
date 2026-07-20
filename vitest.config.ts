import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The core is pure TypeScript with no React Native imports, so it runs in
    // plain node — no Metro/jest-expo transform needed, which keeps it fast.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/**/__tests__/**'],
    },
  },
});
