import type { NextConfig } from 'next';

/**
 * The catalog API is a pure JSON backend — no pages, no client bundle.
 *
 * `cacheComponents` turns on `use cache` / `cacheLife` / `cacheTag`, which the
 * read path depends on: the catalog changes slowly but every device pulls it on
 * every launch, so serving it from cache is the difference between a handful of
 * Postgres queries an hour and one per user per launch. Neon bills by compute
 * time, so that is the single biggest cost lever in this service.
 */
const nextConfig: NextConfig = {
  cacheComponents: true,

  // This service lives inside the Expo app's repo, which has its own lockfile.
  // Without an explicit root, Turbopack walks up, finds it, and infers the
  // wrong project directory.
  turbopack: { root: import.meta.dirname },

  // No React is shipped to anyone; this is an API. Removing the header saves a
  // little bandwidth and volunteers less about the stack.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          // The API serves JSON only; a browser must never interpret a response
          // as HTML or script even if a merchant name contains markup.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          // Nothing here is served over plain HTTP once deployed.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
