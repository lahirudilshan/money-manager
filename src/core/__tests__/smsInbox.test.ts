import { describe, expect, it } from 'vitest';
import {
  describeDrain,
  parseInbox,
  planDrain,
  EMPTY_SUMMARY,
  MAX_MESSAGES_PER_DRAIN,
  RECORD_SEPARATOR,
} from '../smsInbox';

/**
 * The file these tests describe is written by an automation the USER assembles
 * in Shortcuts, so the input is not under our control. Every tolerance below is
 * something a real Shortcuts action does — CRLF, a leading separator, a trailing
 * newline — and getting any of them wrong silently drops a transaction.
 */

const WATER =
  'LKR 2,867.40 debited from AC XXXXXXXX6796 as POS TXN at National Water Supply. Avl Bal 174,121.03';
const FUEL = 'LKR 9,500.00 debited from AC XXXXXXXX6796 at CEYPETCO. Avl Bal 160,000.00';

describe('parseInbox', () => {
  it('splits messages on a separator line', () => {
    expect(parseInbox(`${WATER}\n${RECORD_SEPARATOR}\n${FUEL}`)).toEqual([WATER, FUEL]);
  });

  it('reads a single message with no separator at all', () => {
    // The very first message an automation ever appends has nothing to separate
    // it from, so this is the common first-run case.
    expect(parseInbox(WATER)).toEqual([WATER]);
  });

  it('handles CRLF line endings', () => {
    // Some Shortcuts text actions emit Windows line endings.
    expect(parseInbox(`${WATER}\r\n${RECORD_SEPARATOR}\r\n${FUEL}`)).toEqual([WATER, FUEL]);
  });

  it('tolerates a leading and trailing separator', () => {
    // An automation that writes a separator BEFORE each message, rather than
    // between them, is an easy and reasonable thing for a user to build.
    expect(
      parseInbox(`${RECORD_SEPARATOR}\n${WATER}\n${RECORD_SEPARATOR}\n${FUEL}\n${RECORD_SEPARATOR}\n`),
    ).toEqual([WATER, FUEL]);
  });

  it('drops blank records from doubled separators', () => {
    expect(
      parseInbox(`${WATER}\n${RECORD_SEPARATOR}\n${RECORD_SEPARATOR}\n${FUEL}`),
    ).toEqual([WATER, FUEL]);
  });

  it('keeps newlines INSIDE a message', () => {
    // Bank alerts wrap across lines. Splitting on a bare newline would shred
    // one message into several unparseable fragments.
    const multiline = 'LKR 4,320.00 debited\nfrom AC XXXX6796\nat KEELLS SUPER';
    expect(parseInbox(`${multiline}\n${RECORD_SEPARATOR}\n${FUEL}`)).toEqual([multiline, FUEL]);
  });

  it('does not split on a dash line that has other text', () => {
    // Only a line that is ONLY dashes separates records; "--- END ---" inside a
    // promotional message must not break it in half.
    const withDashes = `${WATER}\n--- END ---\nmore text`;
    expect(parseInbox(withDashes)).toEqual([withDashes]);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(parseInbox('')).toEqual([]);
    expect(parseInbox('   \n\n  ')).toEqual([]);
    expect(parseInbox(`${RECORD_SEPARATOR}\n${RECORD_SEPARATOR}`)).toEqual([]);
  });
});

describe('planDrain', () => {
  it('takes everything when under the cap', () => {
    const plan = planDrain(`${WATER}\n${RECORD_SEPARATOR}\n${FUEL}`);

    expect(plan.messages).toEqual([WATER, FUEL]);
    expect(plan.remainder).toBe('');
    expect(plan.deferred).toBe(0);
  });

  it('leaves the overflow in a form it can read back', () => {
    /*
     * The important one. A capped drain rewrites the file with what it did not
     * take, so the remainder MUST round-trip through parseInbox — otherwise a
     * busy queue corrupts itself on the first drain.
     */
    const contents = [WATER, FUEL, WATER, FUEL].join(`\n${RECORD_SEPARATOR}\n`);
    const plan = planDrain(contents, 2);

    expect(plan.messages).toEqual([WATER, FUEL]);
    expect(plan.deferred).toBe(2);
    expect(parseInbox(plan.remainder)).toEqual([WATER, FUEL]);
  });

  it('preserves arrival order', () => {
    // The file is append-only, so file order is arrival order, and drafts should
    // appear in the order the transactions actually happened.
    const plan = planDrain(['a', 'b', 'c'].join(`\n${RECORD_SEPARATOR}\n`));
    expect(plan.messages).toEqual(['a', 'b', 'c']);
  });

  it('caps a runaway file rather than processing all of it', () => {
    const contents = Array.from({ length: 200 }, (_, i) => `msg ${i}`).join(
      `\n${RECORD_SEPARATOR}\n`,
    );
    const plan = planDrain(contents);

    expect(plan.messages).toHaveLength(MAX_MESSAGES_PER_DRAIN);
    expect(plan.deferred).toBe(200 - MAX_MESSAGES_PER_DRAIN);
    // Nothing is lost — the rest is still readable next time.
    expect(parseInbox(plan.remainder)).toHaveLength(200 - MAX_MESSAGES_PER_DRAIN);
  });

  it('plans nothing for an empty file', () => {
    const plan = planDrain('');
    expect(plan.messages).toEqual([]);
    expect(plan.remainder).toBe('');
  });
});

describe('describeDrain', () => {
  it('stays silent about zeroes', () => {
    // "3 to review, 0 duplicates, 0 ignored" reads like something went wrong.
    expect(describeDrain({ ...EMPTY_SUMMARY, queued: 3 })).toBe('3 transactions to review');
  });

  it('uses the singular for one', () => {
    expect(describeDrain({ ...EMPTY_SUMMARY, queued: 1 })).toBe('1 transaction to review');
  });

  it('reports every outcome that happened', () => {
    expect(
      describeDrain({ queued: 2, duplicates: 1, ignored: 3, deferred: 5 }),
    ).toBe('2 transactions to review · 1 already added · 3 not a transaction · 5 left for next time');
  });

  it('says something useful when nothing arrived', () => {
    expect(describeDrain(EMPTY_SUMMARY)).toBe('No new messages.');
  });
});
