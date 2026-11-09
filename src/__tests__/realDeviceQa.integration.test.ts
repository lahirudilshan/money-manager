import './harness/nativeMocks';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Money bugs found by running the app over a copy of the user's real phone
 * database (2026-11-09), replayed end to end through the real store, the real
 * Shortcuts inbox drain and a real SQLite database. Every message is verbatim
 * from the device except the balances, which are kept true to the scenario.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
let store: typeof import('~/store/useAppStore');
let selectors: typeof import('~/store/selectors');
let INBOX: string;
const S = () => store.useAppStore.getState();
const ids: Record<string, string> = {};

const balance = (nickname: string) =>
  selectors.selectCardViews(S()).find((v) => v.card.nickname === nickname)!.balanceMinor;
const card = (nickname: string) => S().cards.find((c) => c.nickname === nickname)!;

function deliver(...messages: string[]) {
  const files = (globalThis as Record<string, unknown>).__mockFiles as Map<string, string>;
  files.set(INBOX, messages.join('\n---\n') + '\n');
  S().drainSmsInbox();
  S().pruneSmsQueue();
  S().loadSmsDrafts();
}
const drafts = (fragment: string) => S().smsDrafts.filter((d) => d.parsed.raw.includes(fragment));
const ndb = (body: string) => `${body} Call 94112448888 for info`;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T08:00:00'));
  const client = await import('~/db/client');
  client.initialiseDatabase();
  store = await import('~/store/useAppStore');
  selectors = await import('~/store/selectors');
  INBOX = `file:///app/Documents/${(await import('~/features/sms/logic/smsInbox')).INBOX_FILENAME}`;
  S().refresh();
  S().setPeriod('2026-11');

  const createdAt = new Date('2026-10-01T08:00:00');
  S().addCard({ nickname: 'Online', bankId: 'ndb', bankName: 'National Development Bank', isCard: false, accountNumber: '106001916796', last4: '6796', sortOrder: 0, createdAt } as never);
  S().addCard({
    nickname: 'Salary', bankId: 'dfcc', bankName: 'DFCC Bank', isCard: false,
    accountNumber: '102060635584', last4: '5584',
    foreignAccountNumber: '102007417427', foreignLast4: '7427', foreignCurrency: 'USD',
    sortOrder: 1, createdAt,
  } as never);

  const living = S().addCategory({ name: 'Living', cardId: card('Online').id, icon: 'albums-outline', dueDay: 1 } as never).id;
  S().addSubcategory({ name: 'Mobile / phone bill', categoryId: living, plannedMinor: rs(1_000), frequency: 'monthly' } as never);
  ids.mobile = S().subcategories.find((s) => s.name === 'Mobile / phone bill')!.id;
  const salaryCat = S().addCategory({ name: 'Debt', cardId: card('Salary').id, icon: 'albums-outline', dueDay: 1 } as never).id;
  S().addSubcategory({ name: 'Cash / pocket money', categoryId: salaryCat, plannedMinor: 0, frequency: 'ongoing' } as never);
  ids.cash = S().subcategories.find((s) => s.name === 'Cash / pocket money')!.id;
  const fees = S().addCategory({ name: 'Bank & fees', cardId: null, icon: 'albums-outline', dueDay: 1 } as never).id;
  S().addSubcategory({ name: 'Bank charges', categoryId: fees, plannedMinor: 0, frequency: 'ongoing' } as never);
  ids.charges = S().subcategories.find((s) => s.name === 'Bank charges')!.id;

  S().setAccountBalance(card('Online').id, rs(200_000));
  S().setAccountBalance(card('Salary').id, rs(1_000));
  vi.setSystemTime(new Date('2026-11-09T20:00:00'));
});

describe('two payments on one monthly bill in the same month', () => {
  it('both count — the second no longer overwrites the first', () => {
    deliver(ndb('LKR 385.00 debited from AC XXXXXXXX6796 as POS TXN on 02 Nov 2026 04:49 at Dialog Axiata PLC Colombo 02. Avl Bal 199,615.00'));
    S().confirmDraft(drafts('02 Nov')[0].id, { subcategoryId: ids.mobile });
    deliver(ndb('LKR 385.00 debited from AC XXXXXXXX6796 as POS TXN on 05 Nov 2026 13:28 at Dialog Axiata PLC Colombo 02. Avl Bal 199,230.00'));
    S().confirmDraft(drafts('05 Nov')[0].id, { subcategoryId: ids.mobile });

    S().setPeriod('2026-11');
    const mobile = selectors
      .selectCategoryViews(S())
      .flatMap((v) => v.subcategories)
      .find((l) => l.id === ids.mobile)!;
    expect(mobile.actualMinor).toBe(rs(770));
    expect(balance('Online')).toBe(rs(199_230));
  });
});

describe('a failed transaction and its reversal', () => {
  it('cancel when they arrive in separate batches', () => {
    deliver(ndb('LKR 9,000.00 debited from AC XXXXXXXX6796 as ATM TXN on 07 Nov 2026 15:37 at LANKAPAY PAYABLES Kelaniya---------.Avl Bal 190,230.00'));
    deliver(ndb('A reversal for ATM Cash Withdrawal of LKR 9,000.00 credited to AC XXXXXXXX6796 on 07 Nov 2026 15:37. Avl Bal 199,230.00'));
    expect(drafts('9,000.00')).toEqual([]);
  });

  it('cancel when the reversal arrives first in the same minute, leaving the real retry', () => {
    deliver(
      ndb('A reversal for CEFTS Outward Transfer of LKR 1,500.00 credited to AC XXXXXXXX6796 on 08 Nov 2026 12:12. Avl Bal 199,230.00'),
      ndb('LKR 1,500.00 debited from AC XXXXXXXX6796 on 08 Nov 2026 12:12 as CEFTS Outward Transfer. Avl Bal 199,230.00'),
      ndb('LKR 1,500.00 debited from AC XXXXXXXX6796 on 08 Nov 2026 12:13 as CEFTS Outward Transfer. Avl Bal 197,730.00'),
    );
    expect(drafts('1,500.00').map((d) => d.parsed.time)).toEqual(['12:13']);
    expect(balance('Online')).toBe(rs(197_730));
  });
});

describe('a reversal left in the queue', () => {
  it('is offered as a refund when its charge was logged', () => {
    deliver(ndb('LKR 30.00 debited from AC XXXXXXXX6796 on 07 Nov 2026 15:37 as ATM Withdrawal Fee. Avl Bal 199,200.00'));
    S().confirmDraft(drafts('ATM Withdrawal Fee. Avl')[0].id, { subcategoryId: ids.charges });
    deliver(ndb('A reversal for ATM Withdrawal Fee of LKR 30.00 credited to AC XXXXXXXX6796 on 07 Nov 2026 15:37. Avl Bal 199,230.00'));
    const [refund] = drafts('reversal for ATM Withdrawal Fee');
    expect(refund.subcategoryId).toBe(ids.charges);
    S().confirmDraft(refund.id);
    S().setPeriod('2026-11');
    const charges = selectors.selectCategoryViews(S()).flatMap((v) => v.subcategories).find((l) => l.id === ids.charges)!;
    expect(charges.actualMinor ?? 0).toBe(0);
  });

  it('is NOT pre-filled when its charge never reached the app', () => {
    // The 16:50 fee's own message never arrived on the device.
    deliver(ndb('A reversal for CEFTS Transfer Charges of LKR 25.00 credited to AC XXXXXXXX6796 on 07 Nov 2026 16:50. Avl Bal 199,230.00'));
    const [orphan] = drafts('16:50');
    expect([orphan.subcategoryId, orphan.hint]).toEqual(['', null]);
    S().dismissDraft(orphan.id);
  });
});

describe('interest', () => {
  it('one tap files rupee interest on the account it was credited to', () => {
    deliver(ndb('LKR 306.54 credited to AC XXXXXXXX6796 on 08 Nov 2026 19:03 as Interest - Capitalise. Avl Bal 198,036.54'));
    const [interest] = drafts('306.54');
    const lineId = S().createLineForDraft(interest.id)!;
    const line = S().subcategories.find((s) => s.id === lineId)!;
    expect([line.name, line.type]).toEqual(['Interest / dividends', 'income']);
    const ledger = selectors.selectAccountLedgers(S()).get(card('Online').id)!;
    expect(ledger.movements.find((m) => m.label === 'Interest - Capitalise')?.amountMinor).toBe(rs(306.54));
    expect(balance('Online')).toBe(rs(198_036.54));
    // Received interest counts in the month's income, not just what was planned.
    S().setPeriod('2026-11');
    expect(selectors.selectTotalIncome(S())).toBe(rs(306.54));
  });

  it('the tax withheld on it comes off the interest, so the line reads net', () => {
    deliver(ndb('LKR 30.65 debited from AC XXXXXXXX6796 on 08 Nov 2026 19:03 as Debit Arrangement. Avl Bal 198,005.89'));
    const [tax] = drafts('Debit Arrangement');
    S().confirmDraft(tax.id);
    S().setPeriod('2026-11');
    expect(selectors.selectTotalIncome(S())).toBe(rs(275.89));
    expect(balance('Online')).toBe(rs(198_005.89));
  });

  it('USD interest on the Salary card’s USD leg does not inflate the rupee balance', () => {
    deliver('Your A/C No: ********7427 is credited with USD5.51 on 08 NOV 2026 ref: Interest Capitalise. Your bal is USD5,212.67. If unauthorized call 0112350035.');
    const [usd] = drafts('USD5.51');
    // The next interest is recognised outright now that the line exists.
    expect(usd.subcategoryId).not.toBe('');
    S().confirmDraft(usd.id);
    expect(balance('Salary')).toBe(rs(1_000));
  });

  it('a USD debit filed as spending leaves the rupee balance alone too', () => {
    deliver('Your A/C No: ********7427 is debited with USD1,800.00 on 09 NOV 2026 ref: Transfer Debit. Your bal is USD3,412.67. If unauthorized call 0112350035');
    S().confirmDraft(drafts('USD1,800.00')[0].id, { subcategoryId: ids.cash });
    expect(balance('Salary')).toBe(rs(1_000));
  });
});
