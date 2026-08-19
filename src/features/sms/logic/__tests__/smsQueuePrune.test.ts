import { describe, expect, it } from 'vitest';
import { cancelInternalTransfers } from '../smsInbox';
import { isRejectedAsNoise, parseSms, type ParsedSms } from '../smsParser';

/**
 * The retroactive pass over rows ALREADY in the queue.
 *
 * The drain applies its rules to one batch as messages leave the file, which
 * leaves rows queued by an earlier build untouched forever. That gap was found
 * on the user's actual device: their Smart Detect showed eight pending rows
 * where the current rules would have produced far fewer — including a row whose
 * merchant was their own bank balance, stored by the pre-fix parser and never
 * revisited.
 *
 * These tests exercise the same pipeline `pruneSmsQueue` runs, over fixtures
 * taken from that real queue. The store function itself needs a database, so
 * what is asserted here is the decision logic it delegates to.
 */

/** Mirrors the row shape `pruneSmsQueue` reads. */
interface QueueRow {
  id: string;
  raw: string;
  receivedAt: Date;
}

function row(id: string, raw: string, receivedMs = 0): QueueRow {
  return { id, raw, receivedAt: new Date(receivedMs) };
}

/** The decision half of `pruneSmsQueue`: which row ids get dismissed. */
function prune(rows: QueueRow[], ownAccounts: string[]): Set<string> {
  const parsed = rows.map((r) => ({ row: r, sms: parseSms(r.raw) }));

  const doomed = new Set(
    parsed.filter((entry) => isRejectedAsNoise(entry.row.raw)).map((entry) => entry.row.id),
  );

  const movements = parsed.filter(
    (entry): entry is { row: QueueRow; sms: ParsedSms } =>
      entry.sms !== null && !doomed.has(entry.row.id),
  );

  const ordered = [...movements].sort((a, b) => {
    const byWhen = `${a.sms.date ?? ''}${a.sms.time ?? ''}`.localeCompare(
      `${b.sms.date ?? ''}${b.sms.time ?? ''}`,
    );
    return byWhen !== 0 ? byWhen : a.row.receivedAt.getTime() - b.row.receivedAt.getTime();
  });

  const survivors = new Set(
    cancelInternalTransfers(
      ordered.map((entry) => entry.sms),
      ownAccounts,
    ),
  );
  for (const entry of ordered) if (!survivors.has(entry.sms)) doomed.add(entry.row.id);

  return doomed;
}

const OWN = ['6796', '4150'];

const CEB =
  'LKR 2,500.00 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 00:45 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 3,043.06 Call 94112448888 for info';
const HNB_1157 =
  'LKR 10,025.00 debited to Ac No:13802XXXXX50 on 04/08/26 11:57:03 Reason:MB:ref Bal:LKR 405,757.29 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462';
const NDB_IN_1157 =
  'LKR 10,000.00 credited to AC XXXXXXXX6796 on 04 Aug 2026 11:57 as CEFTS Inward Transfer. Avl Bal 13,043.06 Call 94112448888 for info';
const WATER =
  'LKR 4,270.86 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 11:59 at National Water Supply Rathmalana. Avl Bal 8,772.20 Call 94112448888 for info';
const HNB_1200 =
  'LKR 10,025.00 debited to Ac No:13802XXXXX50 on 04/08/26 12:00:49 Reason:MB:ref Bal:LKR 395,732.29 Protect from scams DO NOT SHARE ACCOUNT DETAILS /OTP Hotline 0112462462';
const NDB_IN_1200 =
  'LKR 10,000.00 credited to AC XXXXXXXX6796 on 04 Aug 2026 12:00 as CEFTS Inward Transfer. Avl Bal 18,772.20 Call 94112448888 for info';
const CHARGE =
  'LKR 25.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Transfer Charges. Avl Bal 8,747.20 Call 94112448888 for info';
const TO_PARENTS =
  'LKR 10,000.00 debited from AC XXXXXXXX6796 on 04 Aug 2026 12:02 as CEFTS Outward Transfer. Avl Bal 8,747.20 Call 94112448888 for info';
const DIALOG =
  'LKR 10,000.00 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 13:28 at Dialog Axiata PLC Colombo 02. Avl Bal 8,747.20 Call 94112448888 for info';

describe('pruning a queue that already holds both halves', () => {
  const rows = [
    row('ceb', CEB, 1),
    row('hnb1', HNB_1157, 2),
    row('ndb1', NDB_IN_1157, 3),
    row('water', WATER, 4),
    row('hnb2', HNB_1200, 5),
    row('ndb2', NDB_IN_1200, 6),
    row('charge', CHARGE, 7),
    row('parents', TO_PARENTS, 8),
    row('dialog', DIALOG, 9),
  ];

  it('retires both transfer pairs and keeps the real spending', () => {
    const doomed = prune(rows, OWN);

    expect([...doomed].sort()).toEqual(['hnb1', 'hnb2', 'ndb1', 'ndb2']);

    const kept = rows.filter((r) => !doomed.has(r.id)).map((r) => r.id);
    expect(kept).toEqual(['ceb', 'water', 'charge', 'parents', 'dialog']);
  });

  it('keeps the 10,000 payment to the parents', () => {
    // Same amount as the internal transfers, minutes away — separable only by
    // the absence of a matching credit on another own account.
    expect(prune(rows, OWN).has('parents')).toBe(false);
  });

  it('is idempotent — a second pass retires nothing further', () => {
    // This runs on every launch, so a pass that kept finding new victims would
    // eventually empty the queue of real transactions.
    const doomed = prune(rows, OWN);
    const remaining = rows.filter((r) => !doomed.has(r.id));
    expect(prune(remaining, OWN).size).toBe(0);
  });
});

describe('pruning when only ONE half was ever captured', () => {
  /*
   * The user's real device state: their Shortcuts automation stored the 12:00
   * HNB debit but never the 11:57 one, so a credit sits in the queue whose
   * counterpart does not exist in the database at all.
   */
  const rows = [
    row('ceb', CEB, 1),
    row('ndb1', NDB_IN_1157, 2),
    row('water', WATER, 3),
    row('hnb2', HNB_1200, 4),
    row('ndb2', NDB_IN_1200, 5),
    row('charge', CHARGE, 6),
    row('parents', TO_PARENTS, 7),
    row('dialog', DIALOG, 8),
  ];

  it('cancels the one pair it can and leaves the orphan credit standing', () => {
    const doomed = prune(rows, OWN);

    // Exactly one pair is present, so exactly two rows go.
    expect(doomed.size).toBe(2);
    expect(doomed.has('hnb2')).toBe(true);

    // An orphan credit is REAL money that arrived with no visible counterpart.
    // Guessing it away would delete an unexplained 10,000 from the board; the
    // honest outcome is to leave it for the user to judge.
    const kept = rows.filter((r) => !doomed.has(r.id)).map((r) => r.id);
    expect(kept).toContain('ceb');
    expect(kept).toContain('parents');
    expect(kept.length).toBe(6);
  });
});

describe('pruning noise left by an older, more permissive parser', () => {
  it('retires an OTP and a promo that were queued before the filters existed', () => {
    const rows = [
      row('otp', 'Your one-time password for transaction LKR 2500.00 at CEB is 681854.', 1),
      row(
        'promo',
        'Enjoy 30% savings at Cinnamon Lakeside. Valid till 31st Aug. Max savings LKR 10,000. T&C Apply. visit bit.ly/Amex-Dining',
        2,
      ),
      row('ceb', CEB, 3),
    ];

    const doomed = prune(rows, OWN);
    expect([...doomed].sort()).toEqual(['otp', 'promo']);
  });

  it('does NOT retire a row the parser merely fails to understand', () => {
    // A parser gap must stay visible so the format can be learned later —
    // dismissing it would destroy the only evidence it ever arrived.
    const rows = [row('unknown', 'Card debited at SOME NEW MERCHANT, ref 99Z.', 1)];
    expect(prune(rows, OWN).size).toBe(0);
  });
});
