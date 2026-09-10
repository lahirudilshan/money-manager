import { describe, expect, it } from 'vitest';
import { defaultDirection, offersLoanAction } from '../fromDraft';

/**
 * Recording a bank transfer as a LOAN instead of an expense.
 *
 * Lending a friend LKR 10,000 is not spending — the money is coming back. Every
 * confirm path wrote a transaction, so the only options were to overstate the
 * month by the full amount or dismiss the message and lose the record.
 */

describe('when the action is offered', () => {
  it('is offered on transfers out and in', () => {
    expect(offersLoanAction('transfer_out', true)).toBe(true);
    expect(offersLoanAction('transfer_in', true)).toBe(true);
  });

  it('is NOT offered on ordinary spending', () => {
    // A supermarket purchase is not a loan; offering it everywhere is noise.
    for (const kind of ['purchase', 'bank_charge', 'loan_payment', 'atm']) {
      expect(offersLoanAction(kind, true)).toBe(false);
    }
  });

  it('is NOT offered when the add-on is switched off', () => {
    expect(offersLoanAction('transfer_out', false)).toBe(false);
  });
});

describe('which way the money went', () => {
  it('defaults money leaving to lending, money arriving to borrowing', () => {
    expect(defaultDirection('transfer_out')).toBe('lent');
    expect(defaultDirection('transfer_in')).toBe('borrowed');
  });
});
