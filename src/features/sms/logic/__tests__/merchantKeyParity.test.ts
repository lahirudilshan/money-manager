import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { merchantKey } from '../merchantRules';
import { bucketForMinor } from '../catalogSync';
import { billMatchesHint, HINT_META, type CategoryHint } from '../smsCategoryHints';

/**
 * `merchantKey` exists twice: in the app (src/core/merchantRules.ts) and in the
 * API (server/lib/db.ts), because the two deploy separately and share no
 * bundle. The duplication is deliberate — this test is the thing that makes it
 * safe.
 *
 * Drift here fails silently and expensively: the server would store keys under
 * one spelling while devices look them up under another, so every pulled rule
 * would simply never match and detection would quietly stop improving, with no
 * error anywhere to explain why.
 */
describe('merchantKey parity between app and API', () => {
  /** Load the server copy without importing it — it needs DATABASE_URL at import. */
  function serverMerchantKey(): (raw: string) => string {
    const source = readFileSync(
      join(__dirname, '../../../../../server/lib/db.ts'),
      'utf8',
    );

    const start = source.indexOf('export function merchantKey');
    expect(start, 'merchantKey not found in server/lib/db.ts').toBeGreaterThan(-1);

    // Take the function through its closing brace at column 0.
    const end = source.indexOf('\n}', start);
    const body = source
      .slice(start, end + 2)
      .replace(/^export function merchantKey\(raw: string\): string \{/, '')
      .replace(/\}$/, '')
      // Strip the TS annotation the Function constructor cannot parse.
      .replace(/reduce<string\[\]>/, 'reduce');

    return new Function('raw', body) as (raw: string) => string;
  }

  const cases = [
    // The letter-spaced POS form that motivated the glue rule.
    'F L I TRADING',
    'FLI TRADING',
    'KEELLS SUPER SINHARAMUL',
    'Cargills Food City (Pvt) Ltd',
    'CEYPETCO FILLING STATION LK',
    'N.W.S.D.B',
    'dialog axiata plc',
    'A B C',
    'shop   with   spaces',
    '!!!',
    '',
    'Netflix.com',
    'UBER   *EATS',
    'SLT MOBITEL BRANCH',
  ];

  it('produces identical keys for the same input', () => {
    const server = serverMerchantKey();
    for (const input of cases) {
      expect(server(input), `mismatch for "${input}"`).toBe(merchantKey(input));
    }
  });

  it('still glues letter-spaced merchants in both copies', () => {
    // Guards the specific behaviour rather than just equality — two identically
    // broken copies would pass the test above.
    const server = serverMerchantKey();
    expect(merchantKey('F L I TRADING')).toBe('fli trading');
    expect(server('F L I TRADING')).toBe('fli trading');
  });
});

/**
 * Detection now lives on the server; `billMatchesHint` is the OFFLINE fallback.
 *
 * If the two disagree, the same message is categorised differently depending on
 * whether the network happened to be up — which is worse than either answer
 * alone, because it is not reproducible.
 */
describe('hint self-word parity between app and API', () => {
  it('matches a line plainly named after its own category', () => {
    // The bug this guards: the keyword lists recognise MESSAGES (merchant and
    // biller names), but board lines are named after the CATEGORY. "Groceries"
    // scored nothing while "Electricity" matched by coincidence, silently
    // costing the strongest ranking signal on plainly-named lines.
    const cases: [CategoryHint, string][] = [
      ['groceries', 'Groceries Living'],
      ['electricity', 'Electricity Housing'],
      ['water', 'Water Housing'],
      ['telecom', 'Mobile Living'],
      ['fuel', 'Fuel Transport'],
      ['subscription', 'Streaming Subscriptions'],
      ['loan', 'Personal loan Debt'],
      ['income', 'Salary Income'],
    ];

    for (const [hint, lineText] of cases) {
      expect(billMatchesHint(hint, lineText), `"${lineText}" should match ${hint}`).toBe(true);
    }
  });

  it('declares the same self-words as the server', () => {
    const source = readFileSync(join(__dirname, '../../../../../server/lib/hints.ts'), 'utf8');
    const start = source.indexOf('const HINT_SELF_WORDS');
    const block = source.slice(start, source.indexOf('\n};', start));

    // Every hint must appear in the server's map too; a hint present in one and
    // absent in the other is exactly the drift this file exists to catch.
    for (const hint of Object.keys(HINT_META) as CategoryHint[]) {
      expect(block, `server HINT_SELF_WORDS is missing "${hint}"`).toContain(`${hint}:`);
    }
  });
});

/**
 * The amount bands are duplicated for the same reason and fail the same way:
 * the server validates against its own `AMOUNT_BUCKETS`, so a band the app
 * invents is a 400 on every contribution — silently, since contributing is
 * best-effort and swallows errors.
 */
describe('amount bucket parity between app and API', () => {
  it('defines exactly the same bands, in the same order', () => {
    const source = readFileSync(
      join(__dirname, '../../../../../server/lib/contract.ts'),
      'utf8',
    );

    const block = source.slice(
      source.indexOf('export const AMOUNT_BUCKETS'),
      source.indexOf('] as const', source.indexOf('export const AMOUNT_BUCKETS')),
    );
    const serverBuckets = [...block.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);

    expect(serverBuckets).toEqual([
      'under_500',
      '500_2k',
      '2k_10k',
      '10k_50k',
      '50k_200k',
      'over_200k',
    ]);
  });

  it('places amounts in the band the server would', () => {
    // The app works in minor units and the server in major, so the boundary
    // conversion is the thing most likely to drift.
    const source = readFileSync(
      join(__dirname, '../../../../../server/lib/contract.ts'),
      'utf8',
    );
    const start = source.indexOf('export function bucketFor');
    const body = source
      .slice(start, source.indexOf('\n}', start) + 2)
      .replace(/^export function bucketFor\(amountMajor: number\): AmountBucket \{/, '')
      .replace(/: AmountBucket/g, '')
      .replace(/\}$/, '');
    const serverBucketFor = new Function('amountMajor', body) as (n: number) => string;

    for (const major of [0, 499, 500, 1999, 2000, 9999, 10_000, 49_999, 50_000, 199_999, 200_000]) {
      expect(bucketForMinor(major * 100), `band mismatch at ${major}`).toBe(
        serverBucketFor(major),
      );
    }
  });
});
