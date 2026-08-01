import { describe, expect, it } from 'vitest';
import { parseSms } from '../smsParser';
import { reconcileSms } from '../smsReconcile';
import type { BoardSlice } from '../smsReconcile';

/**
 * Detection with no network and no crowd catalog whatsoever.
 *
 * Detection moved to the server, and the device no longer mirrors the shared
 * catalog — so the ONLY things left on-device are the shipped keywords and
 * whatever rules the user has personally taught. This file pins that the app is
 * still useful in that state, because it is the state every user is in on a
 * plane, on a bad connection, or before the backend exists.
 *
 * The empty `[]` rules array is the point: it is a fresh install that has never
 * reached the server. If these stop passing, offline detection has silently
 * become dependent on the backend.
 */

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
  ],
  categories: [
    { id: 'c-housing', name: 'Housing', cardId: null },
    { id: 'c-living', name: 'Living', cardId: null },
  ],
  cards: [],
};

/** Reconcile with NO learned rules — a device that has never seen the server. */
function offline(raw: string) {
  const parsed = parseSms(raw);
  expect(parsed, `parser rejected: ${raw}`).not.toBeNull();
  return reconcileSms(parsed!, board, 'draft-1', [], { currency: 'LKR', usdRate: 300 });
}

describe('offline detection, with an empty rules table', () => {
  it('still recognises a utility from the shipped keywords', () => {
    const draft = offline(
      'LKR 2,867.40 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 12:11 at National Water Supply Rathmalana. Avl Bal 174,121.03',
    );

    expect(draft.hint).toBe('water');
    expect(draft.subcategoryId).toBe('l-water');
  });

  it('still recognises a shipped supermarket chain', () => {
    const draft = offline(
      'LKR 4,320.00 debited from AC XXXXXXXX6796 as POS TXN on 01 Aug 2026 at KEELLS SUPER COLOMBO. Avl Bal 168,431.55',
    );

    expect(draft.hint).toBe('groceries');
    expect(draft.subcategoryId).toBe('l-groceries');
  });

  it('still recognises an electricity biller', () => {
    const draft = offline(
      'LKR 9,500.00 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 12:08 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 176,988.43',
    );

    expect(draft.hint).toBe('electricity');
    expect(draft.subcategoryId).toBe('l-electricity');
  });

  it('still parses the amount and account offline', () => {
    // Detection is the part that degrades without the server; the transaction
    // itself must always be readable, or the draft is useless.
    const draft = offline(
      'LKR 2,867.40 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 12:11 at National Water Supply Rathmalana. Avl Bal 174,121.03',
    );

    expect(draft.amountMinor).toBe(286_740);
    expect(draft.parsed.account).toBe('6796');
  });

  it('leaves a merchant nobody has taught it uncategorised, without failing', () => {
    /*
     * The honest limit: a merchant matching no keyword AND absent from the
     * mirrored catalog. The user picks manually, and that choice teaches this
     * device (and later the catalog).
     *
     * What must NOT happen is a crash or a wrong confident guess: the draft
     * still appears, with its amount, ready to categorise.
     */
    const draft = offline(
      'LKR 4,120.00 debited from AC XXXXXXXX6796 as POS TXN on 01 Aug 2026 at QQZZ HOLDINGS. Avl Bal 155,000.00',
    );

    expect(draft.subcategoryId).toBe('');
    expect(draft.confidence).toBe('unknown');
    expect(draft.amountMinor).toBe(412_000);
  });

  it('detects a CROWD-ONLY merchant offline once the catalog is mirrored', () => {
    /*
     * The reason the mirror exists, and the case that fails without it.
     *
     * "F L I TRADING" matches no shipped keyword — only the shared catalog knows
     * it is a supermarket. Mirroring stores it as a hint-only rule (no
     * subcategoryId, since the catalog cannot know THIS user's lines), and that
     * hint is enough to score the right line with no network at all.
     */
    const draft = reconcileSms(
      parseSms(
        'LKR 4,120.00 debited from AC XXXXXXXX6796 as POS TXN on 01 Aug 2026 at F L I TRADING GALLE. Avl Bal 155,000.00',
      )!,
      board,
      'draft-3',
      [
        {
          id: 'mirrored',
          pattern: 'fli trading',
          // Null, exactly as `applyCatalog` writes it: the crowd supplies the
          // hint, never the line.
          subcategoryId: null,
          hint: 'groceries',
          source: 'seed',
          hitCount: 0,
          updatedAt: 1,
        },
      ],
      { currency: 'LKR', usdRate: 300 },
    );

    expect(draft.hint).toBe('groceries');
    expect(draft.subcategoryId).toBe('l-groceries');
  });

  it('uses a rule the user taught, with no network involved', () => {
    // The learning loop still closes offline: a correction is written locally
    // and matched locally on the next message from that merchant.
    const draft = reconcileSms(
      parseSms(
        'LKR 4,120.00 debited from AC XXXXXXXX6796 as POS TXN on 01 Aug 2026 at F L I TRADING GALLE. Avl Bal 155,000.00',
      )!,
      board,
      'draft-2',
      [
        {
          id: 'r1',
          pattern: 'fli trading',
          subcategoryId: 'l-groceries',
          hint: 'groceries',
          source: 'learned',
          hitCount: 2,
          updatedAt: 1,
        },
      ],
      { currency: 'LKR', usdRate: 300 },
    );

    expect(draft.subcategoryId).toBe('l-groceries');
    expect(draft.confidence).toBe('likely');
  });
});
