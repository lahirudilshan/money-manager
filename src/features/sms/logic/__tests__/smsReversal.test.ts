import { describe, expect, it } from 'vitest';
import { cancelReversals, planDrain } from '../smsInbox';
import { parseSms } from '../smsParser';

/**
 * Guards reversal pairing: a charge and the reversal that undoes it must BOTH
 * disappear, and exactly one charge may be cancelled per reversal.
 *
 * The bank sends two messages for one undone payment. Without pairing the user
 * sees a spend and a credit for the same money, and confirming either puts a
 * wrong figure on the board — which is why this happens before anything is
 * written to `sms_inbox` rather than being cleaned up afterwards.
 */

/** A minimal entry, shaped like the fields `cancelReversals` reads. */
function debit(amountMinor: number, account = '6796') {
  return { kind: 'purchase', direction: 'debit', amountMinor, account };
}

function reversal(amountMinor: number, account = '6796') {
  return { kind: 'reversal', direction: 'credit', amountMinor, account };
}

describe('cancelReversals', () => {
  it('drops a charge together with its reversal', () => {
    expect(cancelReversals([debit(103830), reversal(103830)])).toEqual([]);
  });

  /*
   * The sequence the user described, and the reason this is one-for-one rather
   * than "remove every debit of that amount": the payment was retried, so the
   * final charge is real money that must survive.
   */
  it('keeps the retry when a charge is reversed and then made again', () => {
    const retry = debit(103830);
    const entries = [debit(103830), reversal(103830), retry];

    expect(cancelReversals(entries)).toEqual([retry]);
  });

  it('cancels one pair per reversal, not all matching charges', () => {
    // Two identical charges, one reversal: exactly one charge is undone.
    //
    // The LATER charge is the one cancelled, because a double-charge followed
    // by a single reversal means the bank took back the erroneous second one.
    const first = debit(500);
    const second = debit(500);
    const result = cancelReversals([first, second, reversal(500)]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(first);
  });

  /*
   * A reversal with nothing to pair against is real money arriving — a refund
   * for something bought before the app existed, or in a batch already
   * reviewed. Dropping it would hide a genuine credit.
   */
  it('keeps a reversal that has no matching charge', () => {
    const orphan = reversal(103830);
    expect(cancelReversals([orphan])).toEqual([orphan]);
    expect(cancelReversals([debit(999), orphan])).toEqual([debit(999), orphan]);
  });

  it('does not pair across different accounts', () => {
    const entries = [debit(103830, '1111'), reversal(103830, '2222')];
    expect(cancelReversals(entries)).toEqual(entries);
  });

  it('pairs when one side omits the account, since some banks do', () => {
    expect(cancelReversals([debit(103830, '6796'), reversal(103830, '')])).toEqual([]);
  });

  it('leaves unrelated amounts alone', () => {
    const entries = [debit(500), reversal(103830)];
    expect(cancelReversals(entries)).toEqual(entries);
  });

  it('only cancels debits, never another credit', () => {
    const credit = { kind: 'transfer_in', direction: 'credit', amountMinor: 103830, account: '6796' };
    const entries = [credit, reversal(103830)];
    expect(cancelReversals(entries)).toEqual(entries);
  });
});

describe('the real UBER 852 reversal', () => {
  /*
   * Verbatim from a batch that reached the device: charged at 20:25, reversed
   * at 20:31. Both must vanish, leaving only the other four messages.
   */
  const CHARGE =
    'LKR 1,038.30 debited from AC XXXXXXXX6796 as POS TXN on 28 Jul 2026 20:25 at UBER 852. Avl Bal 126,658.73 Call 94112448888 for info';
  const REVERSAL =
    'A reversal for POS TXN of LKR 1,038.30 credited to AC XXXXXXXX6796 on 28 Jul 2026 20:31. Avl Bal 127,697.03 Call 94112448888 for info';
  const OTHER =
    'LKR 9,200.00 debited from AC XXXXXXXX6796 as POS TXN on 28 Jul 2026 15:17 at STARLINK INTERNET.2DS 94. Avl Bal 127,697.03 Call 94112448888 for info';

  it('classifies the reversal as a reversal, not a purchase', () => {
    // It contains "POS TXN", so a naive rule reads it as a spend.
    expect(parseSms(REVERSAL)?.kind).toBe('reversal');
    expect(parseSms(REVERSAL)?.direction).toBe('credit');
  });

  it('removes both halves and keeps everything else', () => {
    const batch = [CHARGE, REVERSAL, OTHER].join('\n---\n');
    const parsed = planDrain(batch, 99).messages.map(parseSms).filter((entry) => entry !== null);

    const surviving = cancelReversals(parsed);

    expect(surviving).toHaveLength(1);
    expect(surviving[0]?.merchant).toBe('STARLINK INTERNET.2DS 94');
  });
});
