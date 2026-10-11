import './harness/nativeMocks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Four months of a real household, through the REAL store and a real SQLite
 * database — every write goes through the same actions the screens call, and
 * every figure is read through the same selectors the screens render.
 *
 *   July       a normal month
 *   August     a heavy one: a one-time repair, groceries over budget, a split
 *              shop, and a bank SMS confirming more than the plan was moved
 *   September  a light one, plus freelance income landing in the bills account
 *   October    the current month, part-way through
 *
 * Each account's balance is worked out by hand below and asserted month by
 * month. The previous balance (opening + an always-empty funding table − this
 * month's spending) failed every one of these: it read negative, and it changed
 * when the user paged between months.
 */

const rs = (rupees: number) => Math.round(rupees * 100);

let store: typeof import('~/store/useAppStore');
let selectors: typeof import('~/store/selectors');
let repos: typeof import('~/db/repositories');
let ledgerLogic: typeof import('~/features/accounts/logic/accountLedger');

const ids: Record<string, string> = {};

function S() {
  return store.useAppStore.getState();
}

/** Move the clock — "today" decides which months have happened. */
function at(iso: string) {
  vi.setSystemTime(new Date(iso));
}

function balances(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const view of selectors.selectCardViews(S())) out[view.card.nickname!] = view.balanceMinor;
  return out;
}

function view(name: string) {
  return selectors.selectCardViews(S()).find((v) => v.card.nickname === name)!;
}

function moveRow(name: string) {
  return selectors.selectAccountTransfers(S()).find((a) => a.card.nickname === name)!;
}

function spend(line: string, rupees: number, iso: string, name = 'Purchase') {
  S().addTransaction({ subcategoryId: ids[line], name, amountMinor: rs(rupees), date: new Date(iso) });
}

/** A dated bill paid at a typed figure (or its plan when none is given). */
function payBill(line: string, rupees?: number, iso?: string) {
  if (rupees === undefined) S().setStatus(ids[line], 'paid');
  else
    S().logTransaction(ids[line], {
      status: 'paid',
      actualMinor: rs(rupees),
      date: iso ? new Date(iso) : undefined,
    });
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-07-01T09:00:00');

  const client = await import('~/db/client');
  client.initialiseDatabase();
  store = await import('~/store/useAppStore');
  selectors = await import('~/store/selectors');
  repos = await import('~/db/repositories');
  ledgerLogic = await import('~/features/accounts/logic/accountLedger');
  S().refresh();
  S().setPeriod('2026-07');

  // ── Accounts ─────────────────────────────────────────────────────────────
  const account = (nickname: string, bankId: string) =>
    S().addCard({
      nickname,
      bankId,
      bankName: bankId.toUpperCase(),
      isCard: false,
      sortOrder: 0,
      // SQLite stamps its own clock, not the test's; tracking starts in July.
      createdAt: new Date('2026-07-01T09:00:00'),
    } as never).id;
  ids.salary = account('Salary', 'dfcc');
  ids.bills = account('Bills', 'ndb');
  ids.household = account('Household', 'hnb');
  ids.savings = account('Savings', 'nsb');

  // What each held on 1 July, as the banking app would show it.
  S().updateCard(ids.salary, { openingBalanceMinor: rs(50_000) });
  S().updateCard(ids.household, { openingBalanceMinor: rs(5_000) });

  // ── Income ───────────────────────────────────────────────────────────────
  S().addIncome({ name: 'Salary', amountMinor: rs(400_000), cardId: ids.salary } as never);

  // ── The plan ─────────────────────────────────────────────────────────────
  const category = (name: string, cardId: string | null) =>
    S().addCategory({ name, cardId, icon: 'albums-outline', dueDay: 1 } as never).id;
  ids.living = category('Living', ids.bills);
  ids.vehicle = category('Vehicle', ids.savings);
  ids.debt = category('Loans', ids.salary);
  ids.health = category('Health', ids.savings);
  ids.extra = category('Side income', ids.bills);

  const line = (
    key: string,
    name: string,
    categoryId: string,
    plannedRupees: number,
    frequency: 'monthly' | 'ongoing' | 'yearly' | 'one_time',
    extra: Record<string, unknown> = {},
  ) => {
    S().addSubcategory({ name, categoryId, plannedMinor: rs(plannedRupees), frequency, ...extra } as never);
    ids[key] = S().subcategories.find((s) => s.name === name)!.id;
  };
  line('rent', 'Rent', ids.living, 60_000, 'monthly');
  line('electricity', 'Electricity', ids.living, 9_000, 'monthly');
  line('water', 'Water', ids.living, 2_500, 'monthly');
  line('groceries', 'Groceries', ids.living, 50_000, 'ongoing', { cardId: ids.household });
  line('eating', 'Eating out', ids.living, 15_000, 'ongoing', { cardId: ids.household });
  line('fuel', 'Fuel', ids.vehicle, 25_000, 'ongoing', { cardId: ids.household });
  line('insurance', 'Insurance', ids.vehicle, 12_000, 'yearly', {
    planTargetMinor: rs(144_000),
    planDueDate: new Date('2026-12-15'),
    planStartDate: new Date('2026-01-01'),
  });
  line('loan', 'Car loan', ids.debt, 45_000, 'monthly');
  line('medicine', 'Medicine', ids.health, 8_000, 'ongoing');
  line('repair', 'Laptop repair', ids.living, 30_000, 'one_time', { onceInPeriod: '2026-08' });
  line('freelance', 'Freelance', ids.extra, 0, 'ongoing', { type: 'income' });
});

afterAll(() => {
  vi.useRealTimers();
});

describe('July — a normal month', () => {
  it('asks for the plan per account, excluding August’s one-time repair', () => {
    expect(moveRow('Bills').plannedMinor).toBe(rs(71_500));
    expect(moveRow('Household').plannedMinor).toBe(rs(90_000));
    // A saving-plan line is already monthly: 12,000, not 144,000 or 1,000.
    expect(moveRow('Savings').plannedMinor).toBe(rs(20_000)); // insurance 12,000 + medicine 8,000
    expect(moveRow('Salary').plannedMinor).toBe(rs(45_000));
  });

  it('holds the opening balances before anything happens', () => {
    expect(balances()).toEqual({
      Salary: rs(50_000),
      Bills: 0,
      Household: rs(5_000),
      Savings: 0,
    });
  });

  it('lands the salary and moves it out when the money is moved', () => {
    at('2026-07-25T10:00:00');
    S().toggleAccountTransfer(ids.bills);
    S().toggleAccountTransfer(ids.household);
    S().toggleAccountTransfer(ids.savings);
    // Ticking the salary account itself moves nothing anywhere.
    S().toggleAccountTransfer(ids.salary);

    expect(balances()).toEqual({
      // 50,000 + 400,000 salary − (71,500 + 90,000 + 20,000) moved out
      Salary: rs(268_500),
      Bills: rs(71_500),
      Household: rs(95_000),
      Savings: rs(20_000),
    });
  });

  it('deducts each bill and every everyday purchase from its own account', () => {
    payBill('rent');
    payBill('electricity', 8_740, '2026-07-26');
    payBill('water');
    payBill('loan');
    spend('groceries', 12_000, '2026-07-26');
    spend('groceries', 18_500, '2026-07-28');
    spend('groceries', 14_200, '2026-07-30');
    spend('eating', 6_000, '2026-07-27');
    spend('eating', 4_500, '2026-07-29');
    spend('fuel', 9_000, '2026-07-26');
    spend('fuel', 9_500, '2026-07-30');

    expect(balances()).toEqual({
      Salary: rs(268_500 - 45_000),
      Bills: rs(71_500 - 60_000 - 8_740 - 2_500),
      Household: rs(95_000 - 44_700 - 10_500 - 18_500),
      Savings: rs(20_000),
    });
  });

  it('reports what was really spent, budgets included', () => {
    const totals = selectors.selectBoardTotals(S());
    // rent + electricity + water + loan + groceries + eating out + fuel
    expect(totals.paidMinor).toBe(rs(60_000 + 8_740 + 2_500 + 45_000 + 44_700 + 10_500 + 18_500));
  });

  it('reads July as a statement on the Household account', () => {
    const flow = view('Household').flow;
    expect(flow.openingMinor).toBe(rs(5_000));
    expect(flow.inMinor).toBe(rs(90_000));
    expect(flow.outMinor).toBe(rs(73_700));
    expect(flow.closingMinor).toBe(rs(21_300));
    expect(flow.movements).toHaveLength(8);
  });

  it('says what is still to pay: what is left of each budget', () => {
    // groceries 5,300 + eating out 4,500 + fuel 6,500 left
    expect(view('Household').committedMinor).toBe(rs(16_300));
  });
});

describe('August — a heavy month', () => {
  it('adds the one-time repair to the bills account’s plan for August only', () => {
    at('2026-08-01T08:00:00');
    S().setPeriod('2026-08');
    expect(moveRow('Bills').plannedMinor).toBe(rs(101_500));
  });

  it('records the bank’s figure when an SMS confirms a bigger transfer', () => {
    at('2026-08-25T10:00:00');
    S().toggleAccountTransfer(ids.bills);
    S().toggleAccountTransfer(ids.savings);
    // The user moved 130,000 to Household; the bank texted to confirm it.
    expect(S().markAccountTransferred(ids.household, rs(130_000))).toBe(true);
    // A second matching credit must not move it twice.
    expect(S().markAccountTransferred(ids.household, rs(130_000))).toBe(false);

    expect(balances()).toEqual({
      // 223,500 + 400,000 − (101,500 + 130,000 + 20,000)
      Salary: rs(372_000),
      Bills: rs(260 + 101_500),
      Household: rs(21_300 + 130_000),
      Savings: rs(40_000),
    });
  });

  it('takes a split shop whole from the account that paid it', () => {
    spend('groceries', 7_000, '2026-08-26', 'Keells');
    const keells = repos.transactionRepo
      .bySubcategoryPeriod(ids.groceries, '2026-08')
      .find((t) => t.name === 'Keells')!;
    S().setTransactionSplits(keells.id, [
      { subcategoryId: ids.groceries, amountMinor: rs(5_000) },
      { subcategoryId: ids.medicine, amountMinor: rs(2_000) },
    ]);

    // The board allocates it: 5,000 groceries, 2,000 medicine…
    const health = selectors.selectCategoryViews(S()).find((v) => v.category.name === 'Health')!;
    expect(health.subcategories[0].actualMinor).toBe(rs(2_000));
    // …but the bank took 7,000 from Household and nothing from Savings.
    expect(view('Household').flow.outMinor).toBe(rs(7_000));
    expect(view('Savings').flow.outMinor).toBe(0);
  });

  it('balances a month of overspending', () => {
    payBill('rent');
    payBill('electricity', 9_800, '2026-08-27');
    payBill('water', 3_100, '2026-08-27');
    payBill('repair', 28_000, '2026-08-28');
    payBill('loan');
    spend('groceries', 21_000, '2026-08-26');
    spend('groceries', 26_500, '2026-08-28');
    spend('groceries', 24_800, '2026-08-30');
    spend('eating', 8_000, '2026-08-26');
    spend('eating', 9_500, '2026-08-28');
    spend('eating', 5_200, '2026-08-31');
    spend('fuel', 14_000, '2026-08-27');
    spend('fuel', 13_000, '2026-08-30');

    expect(balances()).toEqual({
      Salary: rs(372_000 - 45_000),
      Bills: rs(101_760 - 60_000 - 9_800 - 3_100 - 28_000),
      Household: rs(151_300 - 7_000 - 72_300 - 22_700 - 27_000),
      Savings: rs(40_000),
    });

    const totals = selectors.selectBoardTotals(S());
    expect(totals.paidMinor).toBe(
      rs(60_000 + 9_800 + 3_100 + 28_000 + 45_000 + 77_300 + 22_700 + 27_000 + 2_000),
    );
    // Over budget on groceries: nothing left to pay there, not a negative.
    expect(view('Household').committedMinor).toBe(0);
  });
});

describe('September — a light month', () => {
  it('counts income landing in an account, and a light month’s spending', () => {
    at('2026-09-25T10:00:00');
    S().setPeriod('2026-09');
    S().toggleAccountTransfer(ids.bills);
    S().toggleAccountTransfer(ids.household);
    S().toggleAccountTransfer(ids.savings);

    spend('freelance', 40_000, '2026-09-26', 'Client payment');
    payBill('rent');
    payBill('electricity', 7_600, '2026-09-27');
    payBill('water', 2_200, '2026-09-27');
    payBill('loan');
    spend('groceries', 15_000, '2026-09-26');
    spend('groceries', 13_000, '2026-09-29');
    spend('fuel', 11_000, '2026-09-28');
    spend('medicine', 3_000, '2026-09-28');

    expect(balances()).toEqual({
      Salary: rs(327_000 + 400_000 - 71_500 - 90_000 - 20_000 - 45_000),
      Bills: rs(860 + 71_500 + 40_000 - 60_000 - 7_600 - 2_200),
      Household: rs(22_300 + 90_000 - 28_000 - 11_000),
      Savings: rs(40_000 + 20_000 - 3_000),
    });

    const bills = view('Bills').flow;
    expect(bills.inMinor).toBe(rs(111_500));
    expect(bills.movements.find((m) => m.kind === 'credit')!.amountMinor).toBe(rs(40_000));

    // Income is not spending.
    expect(selectors.selectBoardTotals(S()).paidMinor).toBe(
      rs(60_000 + 7_600 + 2_200 + 45_000 + 28_000 + 11_000 + 3_000),
    );
  });
});

describe('October — the month in progress', () => {
  it('does not count this month’s salary until the money starts moving', () => {
    at('2026-10-11T12:00:00');
    S().setPeriod('2026-10');
    payBill('electricity', 8_100, '2026-10-05');
    spend('groceries', 9_500, '2026-10-06');

    expect(balances()).toEqual({
      Salary: rs(500_500),
      Bills: rs(42_560 - 8_100),
      Household: rs(73_300 - 9_500),
      Savings: rs(57_000),
    });
  });

  it('lands the salary once the first transfer is made', () => {
    S().toggleAccountTransfer(ids.household);
    expect(view('Salary').balanceMinor).toBe(rs(500_500 + 400_000 - 90_000));
    expect(view('Household').balanceMinor).toBe(rs(63_800 + 90_000));
  });

  it('undoes a mis-tapped transfer completely', () => {
    S().toggleAccountTransfer(ids.household);
    expect(view('Salary').balanceMinor).toBe(rs(500_500));
    expect(view('Household').balanceMinor).toBe(rs(63_800));
  });
});

describe('a saving plan', () => {
  it('keeps a month’s set-aside in the account, and pays the premium when it is paid', () => {
    const before = view('Savings').balanceMinor;
    // October's 12,000 set aside — ticked, no figure: the money stays put.
    S().setStatus(ids.insurance, 'paid');
    expect(view('Savings').balanceMinor).toBe(before);
    // The premium itself, confirmed with its real figure, leaves the account.
    S().logTransaction(ids.insurance, { status: 'paid', actualMinor: rs(141_500), date: new Date('2026-10-10') });
    expect(view('Savings').balanceMinor).toBe(before - rs(141_500));
    // Undone again, so the history checks below see the month as it was.
    S().logTransaction(ids.insurance, { status: 'pending', actualMinor: null });
    expect(view('Savings').balanceMinor).toBe(before);
  });
});

describe('across the whole history', () => {
  it('shows the same balance whichever month is on screen', () => {
    const now = balances();
    for (const period of ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']) {
      S().setPeriod(period);
      expect(balances()).toEqual(now);
    }
    S().setPeriod('2026-10');
  });

  it('chains each month’s closing into the next month’s opening', () => {
    for (const name of ['Salary', 'Bills', 'Household', 'Savings']) {
      const ledger = selectors.selectAccountLedgers(S()).get(view(name).card.id)!;
      const months = ['2026-07', '2026-08', '2026-09', '2026-10'];
      for (let i = 1; i < months.length; i++) {
        const prev = ledgerLogic.periodFlow(ledger, months[i - 1]);
        const next = ledgerLogic.periodFlow(ledger, months[i]);
        expect(next.openingMinor, `${name} ${months[i]}`).toBe(prev.closingMinor);
        expect(prev.closingMinor).toBe(prev.openingMinor + prev.inMinor - prev.outMinor);
      }
    }
  });

  it('conserves money: moving between own accounts creates or destroys nothing', () => {
    const total = Object.values(balances()).reduce((a, b) => a + b, 0);
    const openings = rs(50_000 + 5_000);
    const income = rs(400_000 * 3 + 40_000);
    const out =
      rs(45_000 * 3) + // loan
      rs(60_000 * 3 + 8_740 + 2_500 + 9_800 + 3_100 + 28_000 + 7_600 + 2_200 + 8_100) + // bills
      rs(44_700 + 10_500 + 18_500) + // July spending
      rs(7_000 + 72_300 + 22_700 + 27_000) + // August
      rs(28_000 + 11_000 + 3_000) + // September
      rs(9_500); // October
    expect(total).toBe(openings + income - out);
  });

  it('keeps a past transfer at what was moved, even after the plan changes', () => {
    const before = view('Bills').balanceMinor;
    S().updateSubcategory(ids.rent, { plannedMinor: rs(75_000) });
    expect(view('Bills').balanceMinor).toBe(before);
  });

  it('gives a deleted purchase its money back', () => {
    const before = view('Household').balanceMinor;
    const entry = repos.transactionRepo.bySubcategoryPeriod(ids.groceries, '2026-10')[0];
    S().deleteTransaction(entry.id);
    expect(view('Household').balanceMinor).toBe(before + rs(9_500));
  });

  it('sets a balance to what the bank says by working the opening backwards', () => {
    const household = view('Household');
    const ledger = selectors.selectAccountLedgers(S()).get(household.card.id)!;
    const opening = ledgerLogic.openingForTarget(ledger, household.card.openingBalanceMinor, rs(70_000));
    S().updateCard(household.card.id, { openingBalanceMinor: opening });
    expect(view('Household').balanceMinor).toBe(rs(70_000));
    // History is untouched: the months still chain.
    const after = selectors.selectAccountLedgers(S()).get(household.card.id)!;
    expect(ledgerLogic.periodFlow(after, '2026-09').closingMinor).toBe(
      ledgerLogic.periodFlow(after, '2026-10').openingMinor,
    );
  });
});

describe('money in, money out, and which account it went through', () => {
  const groceriesActual = () =>
    selectors
      .selectCategoryViews(S())
      .flatMap((v) => v.subcategories)
      .find((l) => l.id === ids.groceries)!.actualMinor ?? 0;

  it('puts a refund back in the account and takes it off the budget', () => {
    const household = view('Household').balanceMinor;
    const spent = groceriesActual();
    S().addTransaction({ subcategoryId: ids.groceries, name: 'Groceries refund', amountMinor: -rs(2_000), date: new Date('2026-10-11') });
    expect(view('Household').balanceMinor).toBe(household + rs(2_000));
    expect(groceriesActual()).toBe(spent - rs(2_000));
    const refund = view('Household').flow.movements.find((m) => m.label === 'Groceries refund')!;
    expect(refund.kind).toBe('credit');
  });

  it('charges a payment made from another account to THAT account only', () => {
    const household = view('Household').balanceMinor;
    const savings = view('Savings').balanceMinor;
    S().addTransaction({
      subcategoryId: ids.groceries,
      name: 'Paid with the savings card',
      amountMinor: rs(1_500),
      date: new Date('2026-10-11'),
      cardId: ids.savings,
    });
    expect(view('Savings').balanceMinor).toBe(savings - rs(1_500));
    expect(view('Household').balanceMinor).toBe(household);
    // The line still belongs to Household: its history did not move.
    expect(S().subcategories.find((s) => s.id === ids.groceries)!.cardId).toBe(ids.household);
  });

  it('a refund on a dated bill sits beside the payment rather than replacing it', () => {
    payBill('rent', 60_000, '2026-10-01');
    const bills = view('Bills').balanceMinor;
    S().addTransaction({ subcategoryId: ids.rent, name: 'Rent refund', amountMinor: -rs(5_000), date: new Date('2026-10-09') });
    expect(view('Bills').balanceMinor).toBe(bills + rs(5_000));
    // The month's payment is still recorded, and still paid.
    const rentState = S().states.get(ids.rent)!;
    expect(rentState.status).toBe('paid');
    expect(rentState.actualMinor).toBe(rs(60_000));
  });

  it('confirms a bank SMS against the account the message names, and a credit as a refund', () => {
    S().updateCard(ids.household, { last4: '4321' });
    S().updateCard(ids.bills, { last4: '9999' });

    // A Keells shop paid from the BILLS account, filed under groceries.
    const debitId = S().ingestSmsText(
      'LKR 3,450.00 debited from AC XXXXXXXX9999 on 12 Oct 2026 10:03 at KEELLS SUPER. Avl Bal 86,488.43',
    );
    expect(typeof debitId).toBe('string');
    const bills = view('Bills').balanceMinor;
    const household = view('Household').balanceMinor;
    const draft = S().smsDrafts.find((d) => d.id === debitId) ?? S().smsDrafts[S().smsDrafts.length - 1];
    S().confirmDraft(draft.id, { subcategoryId: ids.groceries });
    expect(view('Bills').balanceMinor).toBe(bills - rs(3_450));
    expect(view('Household').balanceMinor).toBe(household);

    // Keells refunds 2,000 into Household: money back, budget down.
    const spent = groceriesActual();
    const creditId = S().ingestSmsText(
      'Your A/C No: ********4321 is credited with LKR2,000.00 on 12 OCT 2026 ref: REFUND KEELLS. Your bal is LKR5,002.26.',
    );
    expect(typeof creditId).toBe('string');
    const credit = S().smsDrafts.find((d) => d.id === creditId) ?? S().smsDrafts[S().smsDrafts.length - 1];
    S().confirmDraft(credit.id, { subcategoryId: ids.groceries });
    expect(view('Household').balanceMinor).toBe(household + rs(2_000));
    expect(groceriesActual()).toBe(spent - rs(2_000));
  });
});
