import 'server-only';

import { neon } from '@neondatabase/serverless';

/**
 * The only place the Neon connection string is read.
 *
 * `server-only` makes that structural rather than a convention: importing this
 * module from anything that could reach a client bundle is a build error, not a
 * leak discovered later. A connection string inside a shipped app is
 * extractable by anyone who unzips it, and this role can write — one leaked
 * build would let a stranger rewrite the hints every user receives.
 */
/**
 * The connection, created on first use rather than at import.
 *
 * Next evaluates route modules during `next build` to collect page data, so a
 * connection built at import time makes the BUILD require the production
 * secret — CI without it fails, and the failure looks like a code error rather
 * than a missing variable.
 *
 * Deferring moves the check to the first query, where it belongs: a request
 * arriving with no DATABASE_URL is a genuine misconfiguration and throws, which
 * every route already turns into a 500 with a logged cause.
 */
let connection: ReturnType<typeof neon> | null = null;

function client(): ReturnType<typeof neon> {
  if (connection) return connection;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — the API cannot reach the catalog.');
  }

  connection = neon(url);
  return connection;
}

/**
 * Tagged-template query, matching the neon client's own shape so callers read
 * as plain SQL. `sql.query(text)` stays available for the schema applier.
 */
export const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) =>
    (client() as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
      strings,
      ...values,
    ),
  {
    query: (text: string, params?: unknown[]) =>
      (client() as unknown as { query: (t: string, p?: unknown[]) => unknown }).query(text, params),
  },
) as unknown as ReturnType<typeof neon>;

/**
 * Reduce raw merchant text to a stable comparison key.
 *
 * MUST stay identical to `merchantKey()` in src/core/merchantRules.ts — devices
 * match locally against keys this server produced, so any drift silently stops
 * rules from ever matching, with no error to explain why. It is duplicated
 * rather than imported because the API deploys separately from the app bundle;
 * src/core/__tests__/merchantKeyParity.test.ts pins the two together.
 */
export function merchantKey(raw: string): string {
  const base = raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';

  const glued = base
    .split(' ')
    .reduce<string[]>((words, word) => {
      const previous = words[words.length - 1];
      if (word.length === 1 && previous && previous.length <= 2 && /^[a-z0-9]+$/.test(previous)) {
        words[words.length - 1] = previous + word;
        return words;
      }
      words.push(word);
      return words;
    }, [])
    .join(' ');

  return glued.replace(/\s+(lk|pvt|ltd|limited|branch)\b/g, '').trim();
}
