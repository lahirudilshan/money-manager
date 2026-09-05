import { describe, expect, it } from 'vitest';
import { cancelInternalTransfers, inferOwnAccounts } from '../smsInbox';
import { parseSms, type ParsedSms } from '../smsParser';

/**
 * Moving your own money between your own accounts is neither income nor
 * expense. Left on the board, each pair inflates BOTH sides of the month.
 *
 * The fixture is the user's real 2026-08-04 timeline, in time order. It is worth
 * reading as a whole, because it contains the exact trap this feature has to
 * survive: message 6 is a genuine 10,000.00 outward transfer to the user's
 * parents, sitting two minutes from two INTERNAL transfers of the same size.
 * Amount and wording cannot tell them apart — only the presence of a matching
 * credit on another of the user's own accounts can.
 */
const TIMELINE: [label: string, raw: string][] = [
  [
    'ceb',
    'LKR 2,500.00 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 00:45 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 3,043.06 Call 94112448888 for info',
  ],
  [
    'hnb-out-1',
    'LKR 10,025.00 debited to Ac No:13802XXXXX50 on 04/08/26 11:57:03 Reason:MB:ref Bal:LKR 405,757.29 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
  ],
  [
    'ndb-in-1',
    'LKR 10,000.00 credited to AC XXXXXXXX6796 on 04 Aug 2026 11:57 as CEFTS Inward Transfer. Avl Bal 13,043.06 Call 94112448888 for info',
  ],
  [
    'water',
    'LKR 4,270.86 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 11:59 at National Water Supply Rathmalana. Avl Bal 8,772.20 Call 94112448888 for info',
  ],
  [
    'hnb-out-2',
    'LKR 10,025.00 debited to Ac No:13802XXXXX50 on 04/08/26 12:00:49 Reason:MB:ref Bal:LKR 395,732.29 Protect from scams DO NOT SHARE ACCOUNT DETAILS /OTP Hotline 0112462462',
  ],
  [
    'ndb-in-2',
    'LKR 10,000.00 credited to AC XXXXXXXX6796 on 04 Aug 2026 12:00 as CEFTS Inward Transfer. Avl Bal 18,772.20 Call 94112448888 for info',
  ],
  [
    'charge',
    'LKR 25.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Transfer Charges. Avl Bal 8,747.20 Call 94112448888 for info',
  ],
  [
    'to-parents',
    'LKR 10,000.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Outward Transfer. Avl Bal 8,747.20 Call 94112448888 for info',
  ],
];

/** The user's accounts: NDB ...6796 and HNB ...4150. */
const OWN_ACCOUNTS = ['6796', '4150'];

function parseTimeline(): { label: string; sms: ParsedSms }[] {
  return TIMELINE.map(([label, raw]) => {
    const sms = parseSms(raw);
    if (!sms) throw new Error(`fixture failed to parse: ${label}`);
    return { label, sms };
  });
}

function survivingLabels(ownAccounts = OWN_ACCOUNTS): string[] {
  const entries = parseTimeline();
  const survivors = new Set(cancelInternalTransfers(entries.map((e) => e.sms), ownAccounts));
  return entries.filter((e) => survivors.has(e.sms)).map((e) => e.label);
}

describe('cancelInternalTransfers over the real 2026-08-04 timeline', () => {
  it('voids both own-account transfer pairs and keeps everything else', () => {
    expect(survivingLabels()).toEqual(['ceb', 'water', 'charge', 'to-parents']);
  });

  it('keeps the real payment to the parents despite an identical amount nearby', () => {
    // The whole point. 10,000.00 outward, two minutes after two internal
    // transfers of the same size — but with no matching credit on any account
    // of the user's, so it is real spending.
    expect(survivingLabels()).toContain('to-parents');
  });

  it('pairs across the transfer fee (10,025.00 out against 10,000.00 in)', () => {
    // The 25 difference is the CEFTS charge, which arrives as its own SMS.
    // Requiring an exact amount match would leave all four halves on the board.
    expect(survivingLabels()).not.toContain('hnb-out-1');
    expect(survivingLabels()).not.toContain('ndb-in-1');
  });

  it('keeps the bank charge, which is real money leaving', () => {
    expect(survivingLabels()).toContain('charge');
  });
});

describe('inferOwnAccounts — where ownAccounts actually comes from', () => {
  /*
   * The bug that made this whole feature a no-op in practice.
   *
   * `cancelInternalTransfers` keys off the user's own accounts, and the obvious
   * source is `cards.last4`. But onboarding picks banks from brand tiles and
   * never asks for an account number, so on a real device all five cards had
   * `last4 = NULL` — `ownAccounts` was empty, the function returned early, and
   * eight rows sat in the queue with four of them halves of two internal
   * transfers. The logic was right; it was being fed nothing.
   */
  it('infers the accounts from the messages when no card has a last4', () => {
    const accounts = inferOwnAccounts(['6796', '50', '6796', '6796'], []);

    expect(accounts.sort()).toEqual(['50', '6796']);
  });

  it('keeps a real recorded last4 as well as the inferred ones', () => {
    // Union, never replacement — a number the user typed is better evidence
    // than anything inferred, and must not be dropped.
    expect(inferOwnAccounts(['6796'], ['4150']).sort()).toEqual(['4150', '6796']);
  });

  it('includes a fragment seen only once', () => {
    // A second account often appears exactly once — one leg of one transfer —
    // so requiring repetition would defeat the case this exists for.
    expect(inferOwnAccounts(['6796', '50'], [])).toContain('50');
  });

  it('ignores empty fragments and single digits', () => {
    // Below two digits there is nothing to compare against.
    expect(inferOwnAccounts(['', '7', '6796'], [])).toEqual(['6796']);
  });

  it('makes the real timeline cancel with NO card last4 recorded', () => {
    /*
     * End to end over the user's real messages, with cards exactly as they are
     * on the device: no last4 anywhere. Four rows must survive.
     */
    const entries = parseTimeline();
    const own = inferOwnAccounts(entries.map((e) => e.sms.account), []);
    const survivors = new Set(cancelInternalTransfers(entries.map((e) => e.sms), own));

    expect(entries.filter((e) => survivors.has(e.sms)).map((e) => e.label)).toEqual([
      'ceb',
      'water',
      'charge',
      'to-parents',
    ]);
  });
});

describe('cancelInternalTransfers safety rules', () => {
  it('cancels nothing when only one account is known', () => {
    // With one account there is nowhere of the user's for the money to land, so
    // an apparent pair is a coincidence between their account and a stranger's.
    expect(survivingLabels(['6796'])).toEqual(TIMELINE.map(([label]) => label));
  });

  it('cancels nothing when the counterparty account is not the user\'s', () => {
    // HNB is no longer recognised as theirs: the outward halves become ordinary
    // payments to a third party and must survive.
    const surviving = survivingLabels(['6796', '9999']);
    expect(surviving).toContain('hnb-out-1');
    expect(surviving).toContain('ndb-in-1');
  });

  it('does not pair two messages on the SAME account', () => {
    const entries = [
      { kind: 'transfer_out', direction: 'debit', amountMinor: 500_000, account: '6796', date: '2026-08-04', time: '10:00' },
      { kind: 'transfer_in', direction: 'credit', amountMinor: 500_000, account: '6796', date: '2026-08-04', time: '10:01' },
    ];
    // A debit and a credit on one account are simply two transactions.
    expect(cancelInternalTransfers(entries, OWN_ACCOUNTS)).toHaveLength(2);
  });

  it('does not pair beyond the time window', () => {
    const entries = [
      { kind: 'transfer_out', direction: 'debit', amountMinor: 500_000, account: '4150', date: '2026-08-04', time: '09:00' },
      { kind: 'transfer_in', direction: 'credit', amountMinor: 500_000, account: '6796', date: '2026-08-04', time: '23:30' },
    ];
    expect(cancelInternalTransfers(entries, OWN_ACCOUNTS)).toHaveLength(2);
  });

  it('does not pair when either side has no timestamp', () => {
    // Pairing on amount alone is exactly how a real payment gets deleted.
    const entries = [
      { kind: 'transfer_out', direction: 'debit', amountMinor: 500_000, account: '4150', date: null, time: null },
      { kind: 'transfer_in', direction: 'credit', amountMinor: 500_000, account: '6796', date: '2026-08-04', time: '10:00' },
    ];
    expect(cancelInternalTransfers(entries, OWN_ACCOUNTS)).toHaveLength(2);
  });

  it('does not pair a POS purchase with a credit', () => {
    // A purchase is never half of an internal transfer, however well it lines up.
    const entries = [
      { kind: 'purchase', direction: 'debit', amountMinor: 500_000, account: '4150', date: '2026-08-04', time: '10:00' },
      { kind: 'transfer_in', direction: 'credit', amountMinor: 500_000, account: '6796', date: '2026-08-04', time: '10:01' },
    ];
    expect(cancelInternalTransfers(entries, OWN_ACCOUNTS)).toHaveLength(2);
  });

  it('consumes each half only once when three transfers of one size occur', () => {
    // Two credits cannot both cancel against a single debit.
    const entries = [
      { kind: 'transfer_out', direction: 'debit', amountMinor: 500_000, account: '4150', date: '2026-08-04', time: '10:00' },
      { kind: 'transfer_in', direction: 'credit', amountMinor: 500_000, account: '6796', date: '2026-08-04', time: '10:01' },
      { kind: 'transfer_in', direction: 'credit', amountMinor: 500_000, account: '6796', date: '2026-08-04', time: '10:02' },
    ];
    const survivors = cancelInternalTransfers(entries, OWN_ACCOUNTS);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].direction).toBe('credit');
  });
});

/**
 * Banks that print a DATE but no CLOCK.
 *
 * DFCC sends "on 02 SEP 2026" with no time, so a real LKR 282,534 transfer to
 * the user's own NDB account could never pair under the strict
 * both-sides-need-a-timestamp rule, and both halves surfaced as separate
 * spends. The relaxation rests on what pairing already requires: both accounts
 * the user's, and different from each other.
 */
describe('pairing when one side prints no time', () => {
  const pair = [
    {
      direction: 'credit' as const,
      kind: 'transfer_in' as const,
      amountMinor: 28_253_400,
      account: '6796',
      date: '2026-09-02',
      time: '15:41',
    },
    {
      direction: 'debit' as const,
      kind: 'transfer_out' as const,
      amountMinor: 28_253_400,
      account: '5584',
      date: '2026-09-02',
      time: null,
    },
  ];

  it('pairs a clockless message with one from the same day', () => {
    expect(cancelInternalTransfers(pair, ['6796', '5584'])).toHaveLength(0);
  });

  /** A different day is a different transfer, whatever the amount. */
  it('does not pair across days', () => {
    const nextDay = [pair[0], { ...pair[1], date: '2026-09-03' }];
    expect(cancelInternalTransfers(nextDay, ['6796', '5584'])).toHaveLength(2);
  });

  /** With no date at all there is nothing to place it against. */
  it('does not pair when the date is unknown too', () => {
    const undated = [pair[0], { ...pair[1], date: null }];
    expect(cancelInternalTransfers(undated, ['6796', '5584'])).toHaveLength(2);
  });

  /** Both ends must still be the user's — a stranger is a real expense. */
  it('does not pair when one account is not the user’s', () => {
    expect(cancelInternalTransfers(pair, ['6796'])).toHaveLength(2);
  });
});
