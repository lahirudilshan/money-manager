import { describe, expect, it, beforeAll } from 'vitest';
import samples from '../../data/sms-samples.json';
import { parseSms } from '../smsParser';
import { reconcileSms, type BoardSlice } from '../smsReconcile';
import { bucketForMinor, planCatalogMerge, type SharedRule } from '../catalogSync';
import { merchantKey, type MerchantRule } from '../merchantRules';

/**
 * Full stack, exercised the way the APP actually works:
 *
 *   pull the catalog  →  merge into local rules  →  detect OFFLINE
 *
 * There is no per-transaction API call to test, because there isn't one: the
 * catalog is mirrored at launch and every message is categorised on-device.
 * What can still break is the seam between the two halves — a merchant key the
 * server normalises differently, a hint value the client does not recognise, a
 * response shape the merge cannot read. That is what this covers.
 *
 * SKIPPED unless a backend is reachable, so `yarn test` stays a fast offline
 * suite. To run it:
 *
 *   cd server && npm run build && npx next start -p 3210 &
 *   HINTS_API=http://127.0.0.1:3210 yarn test fullstack
 */

const BASE = process.env.HINTS_API ?? '';

/** Plainly-named lines, as a user actually builds a board. */
const board: BoardSlice = {
  subcategories: [
    {
      id: 'l-water',
      name: 'Water',
      type: 'expense',
      plannedMinor: 300_000,
      categoryId: 'c-housing',
      cardId: null,
      loanId: null,
    },
    {
      id: 'l-electricity',
      name: 'Electricity',
      type: 'expense',
      plannedMinor: 900_000,
      categoryId: 'c-housing',
      cardId: null,
      loanId: null,
    },
    {
      id: 'l-groceries',
      name: 'Groceries',
      type: 'expense',
      plannedMinor: 400_000,
      categoryId: 'c-living',
      cardId: null,
      loanId: null,
    },
    {
      id: 'l-salary',
      name: 'Salary',
      type: 'income',
      plannedMinor: 25_000_000,
      categoryId: 'c-income',
      cardId: null,
      loanId: null,
    },
  ],
  categories: [
    { id: 'c-housing', name: 'Housing', cardId: null },
    { id: 'c-living', name: 'Living', cardId: null },
    { id: 'c-income', name: 'Income', cardId: null },
  ],
  cards: [],
};

interface Sample {
  id: string;
  source: string;
  raw: string;
}

const cases = (samples as { samples: Sample[] }).samples;

let reachable = false;
/** The mirrored catalog, exactly as the device would hold it after a sync. */
let mirrored: MerchantRule[] = [];

beforeAll(async () => {
  if (!BASE) return;

  try {
    const response = await fetch(`${BASE}/api/hints?limit=2000`);
    if (!response.ok) return;

    const body = (await response.json()) as { rules?: SharedRule[] };
    if (!Array.isArray(body.rules)) return;

    // Run the real merge against an empty device, then materialise the rows the
    // repository would have written — same shape, same nulls.
    const plan = planCatalogMerge(body.rules, []);
    mirrored = plan.insert.map((row, index) => ({
      id: `m${index}`,
      pattern: row.pattern,
      subcategoryId: null,
      hint: row.hint,
      source: 'seed' as const,
      hitCount: 0,
      updatedAt: 1,
    }));

    reachable = true;
  } catch {
    reachable = false;
  }
});

/** Categorise with the mirrored catalog and NO network — the real code path. */
function detectLocally(raw: string) {
  const parsed = parseSms(raw);
  expect(parsed, `parser rejected: ${raw}`).not.toBeNull();
  return reconcileSms(parsed!, board, 'draft', mirrored, { currency: 'LKR', usdRate: 300 });
}

describe.runIf(BASE)('full stack: pull → mirror → detect offline', () => {
  it('pulls a usable catalog', () => {
    if (!reachable) return expect.unreachable('HINTS_API set but backend not reachable');

    // The shipped seed alone is 138 merchants; anything far below that means the
    // pull or the merge silently dropped rows.
    expect(mirrored.length).toBeGreaterThan(100);
  });

  it('mirrors merchant keys the client can actually match on', () => {
    if (!reachable) return expect.unreachable('HINTS_API set but backend not reachable');

    // Server-side normalisation must agree with the client's, or every mirrored
    // row would sit in the table matching nothing — silently, with no error.
    for (const rule of mirrored.slice(0, 50)) {
      expect(merchantKey(rule.pattern), `"${rule.pattern}" is not a normalised key`).toBe(
        rule.pattern,
      );
    }
  });

  it('categorises the real utility samples offline, from the mirror', () => {
    if (!reachable) return expect.unreachable('HINTS_API set but backend not reachable');

    const water = detectLocally(cases.find((c) => c.id === 'ndb-pos-water')!.raw);
    expect(water.hint).toBe('water');
    expect(water.subcategoryId).toBe('l-water');

    const electricity = detectLocally(cases.find((c) => c.id === 'ndb-pos-electricity')!.raw);
    expect(electricity.hint).toBe('electricity');
    expect(electricity.subcategoryId).toBe('l-electricity');
  });

  it('never matches a debit to the income line', () => {
    if (!reachable) return expect.unreachable('HINTS_API set but backend not reachable');

    for (const sample of cases) {
      const parsed = parseSms(sample.raw);
      if (!parsed || parsed.direction === 'credit') continue;

      const draft = detectLocally(sample.raw);
      expect(
        draft.matches.every((match) => match.subcategoryId !== 'l-salary'),
        `${sample.id} matched a debit to the income line`,
      ).toBe(true);
    }
  });

  it('handles every real sample without throwing', () => {
    if (!reachable) return expect.unreachable('HINTS_API set but backend not reachable');

    for (const sample of cases) {
      const parsed = parseSms(sample.raw);
      if (!parsed) continue;
      expect(() => detectLocally(sample.raw), `${sample.id} threw`).not.toThrow();
    }
  });

  it('sends the amount only as a band, never the figure', () => {
    // The privacy contract against a real parsed amount rather than a
    // hand-picked one: 2,867.40 must never appear on the wire.
    const parsed = parseSms(cases.find((c) => c.id === 'ndb-pos-water')!.raw)!;
    expect(parsed.amountMinor).toBe(286_740);
    expect(bucketForMinor(parsed.amountMinor)).toBe('2k_10k');
  });

  it('refuses a contribution carrying the raw message', async () => {
    if (!reachable) return expect.unreachable('HINTS_API set but backend not reachable');

    const parsed = parseSms(cases[0].raw)!;
    const response = await fetch(`${BASE}/api/contribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: '00000000-0000-4000-8000-000000000123',
        observations: [
          {
            merchant: parsed.merchant,
            hint: 'groceries',
            direction: 'debit',
            amountBucket: '2k_10k',
            // The thing that must never be sendable, using a real alert that
            // genuinely contains a balance and an account number.
            raw: parsed.raw,
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
  });
});
