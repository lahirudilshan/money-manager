import { defineConfig } from 'vitest/config';

/**
 * Replaces `require('….png')` with an opaque asset handle.
 *
 * That call means something only to Metro, which rewrites it into an asset id
 * before node ever sees it. Vitest has no such step, so node parses the PNG as
 * TypeScript and dies on its first non-ASCII byte — enough to take down every
 * suite that transitively imports data/banks.ts, none of which care what a
 * logo looks like.
 *
 * A `resolve.alias` does not cover this: aliases rewrite import *specifiers*,
 * and a bare CommonJS `require()` inside an ES module is left alone. Rewriting
 * the call itself is what actually removes the PNG from the module graph. The
 * literal `1` mirrors the shape Metro yields, so a test asking "does this bank
 * have artwork" still sees a truthy handle.
 */
function stubImageRequires() {
  return {
    name: 'stub-image-requires',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.[jt]sx?$/.test(id) || !code.includes('require(')) return null;
      const stubbed = code.replace(
        /require\(\s*['"][^'"]+\.(?:png|jpe?g|gif|webp|svg)['"]\s*\)/g,
        '1',
      );
      return stubbed === code ? null : { code: stubbed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [stubImageRequires()],
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
