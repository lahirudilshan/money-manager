/**
 * Load the shipped catalog into the shared database.
 *
 * Idempotent and non-destructive: seed pairings are inserted if missing and
 * left alone if present, so re-running after adding merchants to
 * seed-catalog.ts adds only the new ones. Learned rows and every vote survive —
 * this script must be safe to run against production, because that is the only
 * way new seed merchants ever ship.
 *
 * Usage:  DATABASE_URL=... node server/seed.mjs
 */

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

/**
 * Read the merchant lists straight out of seed-catalog.ts.
 *
 * The catalog is a .ts file the app also type-checks, and this script runs as
 * plain node with no build step — so the arrays are extracted textually rather
 * than imported. Parsing only string literals inside the SEED_CATALOG object
 * keeps the seed and the typed source as one file with no duplication.
 */
function loadCatalog() {
  const src = readFileSync(join(here, 'seed-catalog.ts'), 'utf8');
  const body = src.slice(
    src.indexOf('SEED_CATALOG: Record<SeedHint, string[]> = {'),
    src.indexOf('\n};', src.indexOf('SEED_CATALOG')),
  );

  const pairs = [];
  // Each `hint: [ ... ],` block, with its quoted entries.
  const blockRe = /(\w+):\s*\[([\s\S]*?)\]/g;
  let block;
  while ((block = blockRe.exec(body))) {
    const hint = block[1];
    for (const m of block[2].matchAll(/'([^']+)'/g)) pairs.push([m[1], hint]);
  }
  return pairs;
}

/** Seed rows start above the learned threshold so they serve immediately. */
const SEED_VOTES = 5;

const pairs = loadCatalog();
if (pairs.length === 0) {
  console.error('parsed 0 merchants from seed-catalog.ts — aborting rather than seeding nothing');
  process.exit(1);
}

let inserted = 0;
for (const [merchant, hint] of pairs) {
  const rows = await sql`
    INSERT INTO merchant_hints (merchant, hint, votes, source)
    VALUES (${merchant}, ${hint}, ${SEED_VOTES}, 'seed')
    ON CONFLICT (merchant, hint) DO NOTHING
    RETURNING id
  `;
  if (rows.length > 0) inserted++;
}

const [{ count }] = await sql`SELECT count(*)::int AS count FROM merchant_hints`;
const byHint = await sql`
  SELECT hint, count(*)::int AS n FROM merchant_hints GROUP BY hint ORDER BY n DESC
`;

console.log(`parsed ${pairs.length} pairs, inserted ${inserted} new, catalog now ${count} rows`);
for (const row of byHint) console.log(`  ${row.hint.padEnd(14)} ${row.n}`);
