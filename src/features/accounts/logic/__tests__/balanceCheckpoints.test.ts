import { describe, expect, it } from 'vitest';
import { extractBalance, parseSms } from '~/features/sms/logic/smsParser';
import { accountFragmentOf, matchAccountLeg } from '~/features/sms/logic/accountMasks';
import { alertMoment, checkpointFromSms } from '../balanceCheckpoints';
import { buildLedgers, type LedgerInput } from '../accountLedger';

/** Formats and account numbers from the user's own phone (2026-11-01). */
const CARDS = [
  { id: 'online', accountNumber: '106001916796', last4: '3824', currency: null },
  { id: 'expenses', accountNumber: '138020174150', last4: '4150', currency: null },
  {
    id: 'salary',
    accountNumber: '102060635584',
    last4: '7427', // stale — the USD leg's tail
    foreignAccountNumber: '102007417427',
    foreignLast4: '7427',
    foreignCurrency: 'USD',
    currency: null,
  },
];

describe('extractBalance — every bank format on the phone', () => {
  it.each([
    ['NDB', 'LKR 25.00 debited from AC XXXXXXXX6796 on 01 Nov 2026 13:44 as CEFTS Transfer Charges. Avl Bal 285,825.28 Call 94112448888 for info', 28_582_528, null],
    ['HNB', 'Dear MR X,LKR 5,538.00 Debited from your A/c XXXXXXXX5891 on 19/10/2026 at 21:11.AvlBal LKR 375,922.96. @ SHOP. ATM POS Transaction.', 37_592_296, 'LKR'],
    ['HNB interest', 'LKR 4.05 credited to Ac No:13802XXXXX50 on 24/10/26 21:19:35 Reason:13802XXXXX50:Int.Pd:28-09-2026 to 24-10-2026 Bal:LKR 3,039.69 Protect from scams', 303_969, 'LKR'],
    ['HNB ATM', 'HNB ATM Withdrawal e-Receipt Amt(Approx.):  85000.00 LKR A/C: 1380***4150 Txn Fee: 30.00LKR Location: X Date: 14.07.26 Time:12:40 Avl Bal: 640099.67 LKR Hotline:941124', 64_009_967, 'LKR'],
    ['DFCC', 'Your A/C No: ********5584 is debited with LKR157,308.38 on 30 OCT 2026 ref: Loan Repayment. Your bal is LKR0.62. If unauthorized call 0112350035', 62, 'LKR'],
    ['DFCC USD', 'Your A/C No: ********7427 is debited with USD1,800.00 on 30 OCT 2026 ref: Transfer Debit. Your bal is USD5,912.67. If unauthorized call 0112350035', 591_267, 'USD'],
  ])('%s', (_bank, text, amountMinor, currency) => {
    expect(extractBalance(text)).toEqual({ amountMinor, currency });
  });

  it('is null when the bank sent no balance', () => {
    expect(extractBalance('Thank you for your payment of LKR 6,667.00 made to Card # 376657*****3055 on 30-09-2026.')).toBeNull();
  });
});

describe('matching a message to the account it is about', () => {
  it('reads HNB’s masked number by its prefix and suffix', () => {
    const parsed = parseSms(
      'LKR 4.05 credited to Ac No:13802XXXXX50 on 24/10/26 21:19:35 Reason:13802XXXXX50:Int.Pd:28-09-2026 to 24-10-2026 Bal:LKR 3,039.69 Protect from scams',
    )!;
    expect(matchAccountLeg(CARDS, accountFragmentOf(parsed))?.account.id).toBe('expenses');
    // A different HNB account (…40) is not this one.
    expect(matchAccountLeg(CARDS, '13802XXXXX40')).toBeNull();
  });

  it('uses the full number over a stale stored tail, and knows which leg', () => {
    expect(matchAccountLeg(CARDS, '5584')).toEqual({ account: CARDS[2], leg: 'primary' });
    expect(matchAccountLeg(CARDS, '7427')).toEqual({ account: CARDS[2], leg: 'foreign' });
    expect(matchAccountLeg(CARDS, '6796')?.account.id).toBe('online');
  });
});

describe('checkpointFromSms', () => {
  it('anchors an account to the balance its alert reports, at the alert’s moment', () => {
    const cp = checkpointFromSms(
      parseSms('LKR 25.00 debited from AC XXXXXXXX6796 on 01 Nov 2026 13:44 as CEFTS Transfer Charges. Avl Bal 285,825.28 Call 94112448888 for info')!,
      CARDS,
      'LKR',
    );
    expect(cp).toEqual({
      cardId: 'online',
      balanceMinor: 28_582_528,
      at: new Date(2026, 10, 1, 13, 44, 59),
      note: 'CEFTS Transfer Charges',
    });
  });

  it('never lets a USD leg overwrite the rupee balance', () => {
    const usd = parseSms(
      'Your A/C No: ********7427 is debited with USD1,800.00 on 30 OCT 2026 ref: Transfer Debit. Your bal is USD5,912.67. If unauthorized call 0112350035',
    )!;
    expect(checkpointFromSms(usd, CARDS, 'LKR')).toBeNull();
  });

  it('takes a message with no clock as the end of its day', () => {
    expect(alertMoment('2026-10-30', null)).toEqual(new Date(2026, 9, 30, 23, 59, 59));
    expect(alertMoment('2026-10-30', '13:44')).toEqual(new Date(2026, 9, 30, 13, 44, 59));
  });
});

describe('the ledger anchored to the bank', () => {
  const base = (partial: Partial<LedgerInput>): LedgerInput => ({
    accounts: [
      { id: 'pay', openingBalanceMinor: 0, startPeriod: '2026-09' },
      { id: 'bills', openingBalanceMinor: 0, startPeriod: '2026-09' },
    ],
    lines: [],
    states: [],
    transactions: [],
    transfers: [],
    incomes: [{ id: 's', name: 'Salary', amountMinor: 75_000_000, cardId: 'pay', isActive: true }],
    sourceCardId: 'pay',
    currentPeriod: '2026-11',
    toAccount: (m) => m,
    toHome: (m) => m,
    ...partial,
  });

  it('holds what the bank last reported, plus what happened after', () => {
    const ledgers = buildLedgers(
      base({
        lines: [{ id: 'g', name: 'Groceries', type: 'expense', frequency: 'ongoing', plannedMinor: 0, planTargetMinor: null, onceInPeriod: null, createdAt: new Date('2026-09-01'), cardId: 'bills' }],
        transactions: [
          { id: 'before', subcategoryId: 'g', period: '2026-10', name: 'shop', amountMinor: 500, date: new Date(2026, 9, 5) },
          { id: 'after', subcategoryId: 'g', period: '2026-10', name: 'shop', amountMinor: 300, date: new Date(2026, 9, 20) },
        ],
        checkpoints: [{ cardId: 'bills', balanceMinor: 10_000, at: new Date(2026, 9, 10), source: 'sms' }],
      }),
    );
    const bills = ledgers.get('bills')!;
    expect(bills.balanceMinor).toBe(10_000 - 300);
    // The correction is a visible line of its own, at the bank's moment.
    expect(bills.movements.find((m) => m.kind === 'adjustment')?.amountMinor).toBe(10_500);
  });

  it('does not guess for an account the bank reports on', () => {
    // Salary "landing" and money "leaving" to fund ticks are inferences; the
    // bank's figures replace them on a reported account.
    const ledgers = buildLedgers(
      base({
        transfers: [{ cardId: 'bills', period: '2026-10', status: 'transferred', amountMinor: 20_000, matchedAmountMinor: null, transferredAt: new Date(2026, 9, 26) }],
        checkpoints: [{ cardId: 'pay', balanceMinor: 62, at: new Date(2026, 9, 30, 23, 59, 59), source: 'sms' }],
      }),
    );
    expect(ledgers.get('pay')!.balanceMinor).toBe(62);
    // Bills has no bank alerts: the tick still moves money into it.
    expect(ledgers.get('bills')!.balanceMinor).toBe(20_000);
  });

  it('a balance the user typed anchors without switching guesses off', () => {
    const ledgers = buildLedgers(
      base({
        checkpoints: [{ cardId: 'pay', balanceMinor: 1_000, at: new Date(2026, 9, 15), source: 'manual' }],
        transfers: [{ cardId: 'bills', period: '2026-11', status: 'transferred', amountMinor: 300, matchedAmountMinor: null, transferredAt: new Date(2026, 10, 1) }],
      }),
    );
    // 1,000 typed in October, then November's salary lands and 300 moves out.
    expect(ledgers.get('pay')!.balanceMinor).toBe(1_000 + 75_000_000 - 300);
  });
});
