import './harness/nativeMocks';
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Three months of one household's money, end to end, against a BANK.
 *
 * Every step does two things:
 *
 *   1. what the user (or Smart Detect) does in the app — through the real store
 *      actions the screens call, on a real SQLite database, with bank SMS going
 *      through the real Shortcuts inbox drain;
 *   2. what actually happens at the bank — written out by hand on `bank`, an
 *      independent statement that knows nothing about the app.
 *
 * After each step every account the app shows must equal the bank to the cent.
 * That is the whole claim: whatever mix of manual entries, Smart Detect, splits,
 * refunds, fees, transfers and corrections a real month holds, the balance on
 * the Accounts screen is the balance in the banking app.
 */

const rs = (rupees: number) => Math.round(rupees * 100);

let store: typeof import('~/store/useAppStore');
let selectors: typeof import('~/store/selectors');
let repos: typeof import('~/db/repositories');
let ledgerLogic: typeof import('~/features/accounts/logic/accountLedger');
let INBOX: string;

const S = () => store.useAppStore.getState();
const ids: Record<string, string> = {};
const ACCOUNTS = ['Salary', 'Bills', 'Household', 'Savings'] as const;
type AccountName = (typeof ACCOUNTS)[number];

/** The bank's own statement — the oracle. Minor units, per account. */
const bank: Record<AccountName, number> = { Salary: 0, Bills: 0, Household: 0, Savings: 0 };
const debit = (account: AccountName, rupees: number) => (bank[account] -= rs(rupees));
const credit = (account: AccountName, rupees: number) => (bank[account] += rs(rupees));
const move = (from: AccountName, to: AccountName, rupees: number) => {
  debit(from, rupees);
  credit(to, rupees);
};

function at(iso: string) {
  vi.setSystemTime(new Date(iso));
}

function appBalances(): Record<AccountName, number> {
  const out = {} as Record<AccountName, number>;
  for (const view of selectors.selectCardViews(S())) out[view.card.nickname as AccountName] = view.balanceMinor;
  return out;
}

/** The assertion every step ends with. */
function reconciles(step: string) {
  const app = appBalances();
  // MM_TRACE=<file> writes the statement after every step, app beside bank.
  if (process.env.MM_TRACE) {
    appendFileSync(process.env.MM_TRACE, JSON.stringify({ step, app, bank }) + '\n');
  }
  expect(app, step).toEqual(bank);
}

const card = (name: AccountName) => S().cards.find((c) => c.nickname === name)!;
const line = (key: string) => ids[key];

/** Which account a message's number belongs to, by its last four digits. */
const ACCOUNT_BY_TAIL: Record<string, AccountName> = {
  '7068': 'Salary',
  '6796': 'Bills',
  '4150': 'Household',
  '1234': 'Savings',
};

/**
 * Stamp a message with what the BANK says the account holds — the balance on
 * `bank` after this step's movement. The app anchors balances to that figure,
 * so the test only stays honest if every alert reports the true balance, as a
 * real bank's does. Steps therefore book the bank movement BEFORE delivering.
 */
function withBankBalance(message: string): string {
  const tail = Object.keys(ACCOUNT_BY_TAIL).find((t) => message.includes(t));
  if (!tail) return message;
  const minor = bank[ACCOUNT_BY_TAIL[tail]];
  const grouped = (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plain = (minor / 100).toFixed(2);
  return message
    .replace(/(Avl Bal:\s*)[\d,.]+(\s*LKR)/, `$1${plain}$2`)
    .replace(/(Avl Bal\s+)[\d,.]+(\s+Call)/, `$1${grouped}$2`)
    .replace(/(AvlBal LKR\s*)[\d,.]+(\.)/, `$1${grouped}$2`)
    .replace(/(Your bal is LKR)[\d,.]+(\.)/, `$1${grouped}$2`);
}

/** A bank SMS arriving through the Shortcuts inbox file, then drained. */
function deliver(...messages: string[]) {
  const files = (globalThis as Record<string, unknown>).__mockFiles as Map<string, string>;
  files.set(INBOX, messages.map(withBankBalance).join('\n---\n') + '\n');
  return S().drainSmsInbox();
}

/** The pending Smart Detect draft for a message, by a piece of its text. */
function draft(fragment: string) {
  S().loadSmsDrafts();
  const found = S().smsDrafts.find((d) => d.parsed.raw.includes(fragment));
  expect(found, `no Smart Detect draft containing "${fragment}"`).toBeDefined();
  return found!;
}

/** The account form's "Current balance" field: the bank's figure, typed in. */
function setCurrentBalance(name: AccountName, rupees: number) {
  S().setAccountBalance(card(name).id, rs(rupees));
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-11-01T08:00:00');

  const client = await import('~/db/client');
  client.initialiseDatabase();
  store = await import('~/store/useAppStore');
  selectors = await import('~/store/selectors');
  repos = await import('~/db/repositories');
  ledgerLogic = await import('~/features/accounts/logic/accountLedger');
  const inbox = await import('~/features/sms/logic/smsInbox');
  INBOX = `file:///app/Documents/${inbox.INBOX_FILENAME}`;
  S().refresh();
  S().setPeriod('2026-11');

  // ── Accounts, as the user adds them (bank, nickname, account number) ──────
  const account = (nickname: AccountName, bankId: string, number: string) =>
    S().addCard({
      nickname,
      bankId,
      bankName: bankId.toUpperCase(),
      isCard: false,
      accountNumber: number,
      last4: number.slice(-4),
      sortOrder: 0,
      // SQLite stamps its own clock, not the test's.
      createdAt: new Date('2026-11-01T08:00:00'),
    } as never);
  account('Salary', 'dfcc', '101000007068');
  account('Bills', 'ndb', '106600006796');
  account('Household', 'hnb', '138020004150');
  account('Savings', 'nsb', '100200001234');

  // ── Income and the plan ───────────────────────────────────────────────────
  S().addIncome({ name: 'Salary', amountMinor: rs(300_000), cardId: card('Salary').id } as never);

  const category = (name: string, cardName: AccountName | null) =>
    S().addCategory({ name, cardId: cardName ? card(cardName).id : null, icon: 'albums-outline', dueDay: 1 } as never).id;
  const living = category('Living', 'Bills');
  const food = category('Food', 'Household');
  const transport = category('Transport', 'Household');
  const health = category('Health', 'Household');
  const fees = category('Bank & fees', null);
  const debt = category('Debt', 'Salary');
  const vehicle = category('Vehicle', 'Savings');
  const side = category('Side income', 'Bills');

  const add = (
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
  add('rent', 'Rent', living, 45_000, 'monthly');
  add('electricity', 'Electricity bill', living, 9_000, 'monthly');
  add('water', 'Water bill', living, 2_500, 'monthly');
  add('internet', 'Wifi bill', living, 6_990, 'monthly');
  add('groceries', 'Groceries', food, 60_000, 'ongoing');
  add('eating', 'Eating out & delivery', food, 15_000, 'ongoing');
  add('pet', 'Pet food', food, 5_000, 'ongoing');
  add('fuel', 'Fuel', transport, 20_000, 'ongoing');
  add('medicine', 'Medicine', health, 5_000, 'ongoing');
  add('cash', 'Cash / pocket money', food, 10_000, 'ongoing');
  add('charges', 'Bank charges', fees, 0, 'ongoing');
  add('lease', 'Car lease', debt, 52_340.5, 'monthly');
  add('insurance', 'Vehicle insurance', vehicle, 8_000, 'yearly', {
    planTargetMinor: rs(96_000),
    planDueDate: new Date('2027-10-01'),
    planStartDate: new Date('2026-11-01'),
  });
  add('freelance', 'Freelance', side, 0, 'ongoing', { type: 'income' });
  add('family', 'Family support', living, 10_000, 'ongoing');
});

afterAll(() => {
  vi.useRealTimers();
});

describe('November — setting up and the first month', () => {
  it('starts every account at what the bank shows', () => {
    // Typed into each account's "Current balance" field on 1 November.
    setCurrentBalance('Salary', 120_000);
    setCurrentBalance('Bills', 8_450.25);
    setCurrentBalance('Household', 15_000);
    setCurrentBalance('Savings', 250_000);
    credit('Salary', 120_000);
    credit('Bills', 8_450.25);
    credit('Household', 15_000);
    credit('Savings', 250_000);
    reconciles('opening balances');
  });

  it('a Smart Detect grocery shop, confirmed', () => {
    at('2026-11-02T18:15:00');
    debit('Household', 4_250.75);
    deliver(
      'Dear Customer,LKR 4,250.75 Debited from your A/c XXXXXXXX4150 on 02/11/2026 at 18:12.AvlBal LKR 10,749.25. @ KEELLS SUPER KELANIYA. POS Transaction.Thank you for banking with us.Call Centre 1972.',
    );
    const shop = draft('4,250.75');
    expect(shop.subcategoryId).toBe(line('groceries'));
    S().confirmDraft(shop.id, { subcategoryId: shop.subcategoryId });
    reconciles('Keells');
  });

  it('a cash meal typed in by hand', () => {
    at('2026-11-03T13:00:00');
    S().addTransaction({ subcategoryId: line('eating'), name: 'Lunch', amountMinor: rs(1_800), date: new Date() });
    debit('Household', 1_800);
    reconciles('lunch');
  });

  it('the electricity bill, paid and detected', () => {
    at('2026-11-05T09:15:00');
    debit('Bills', 8_734.4);
    deliver(
      'LKR 8,734.40 debited from AC XXXXXXXX6796 as POS TXN on 05 Nov 2026 09:10 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 1,000.00 Call 94112448888 for info',
    );
    const bill = draft('8,734.40');
    expect(bill.subcategoryId).toBe(line('electricity'));
    S().confirmDraft(bill.id, { subcategoryId: bill.subcategoryId });
    reconciles('electricity');
  });

  it('rent ticked off without typing a figure', () => {
    at('2026-11-06T10:00:00');
    S().setStatus(line('rent'), 'paid');
    debit('Bills', 45_000);
    reconciles('rent');
  });

  it('one shop split across groceries and pet food', () => {
    at('2026-11-07T18:15:00');
    debit('Household', 7_600);
    deliver(
      'Dear Customer,LKR 7,600.00 Debited from your A/c XXXXXXXX4150 on 07/11/2026 at 18:12.AvlBal LKR 10,749.25. @ KEELLS SUPER KELANIYA. POS Transaction.Thank you for banking with us.Call Centre 1972.',
    );
    S().confirmDraft(draft('7,600.00').id, {
      splits: [
        { subcategoryId: line('groceries'), amountMinor: rs(5_000) },
        { subcategoryId: line('pet'), amountMinor: rs(2_600) },
      ],
    });
    reconciles('split shop');
    const pet = selectors.selectCategoryViews(S()).flatMap((v) => v.subcategories).find((l) => l.id === line('pet'))!;
    expect(pet.actualMinor).toBe(rs(2_600));
  });

  it('fuel paid with the savings card', () => {
    at('2026-11-08T07:30:00');
    S().addTransaction({
      subcategoryId: line('fuel'),
      name: 'Fuel',
      amountMinor: rs(9_000),
      date: new Date(),
      cardId: card('Savings').id,
    });
    debit('Savings', 9_000);
    reconciles('fuel on savings');
  });

  it('a refund from Keells, detected and confirmed', () => {
    at('2026-11-09T11:05:00');
    credit('Household', 1_250);
    deliver(
      'Dear Customer,LKR 1,250.00 Credited to your A/c XXXXXXXX4150 on 09/11/2026 at 11:02.AvlBal LKR 3,000.00.Transaction REFUND KEELLS SUPER.Thank you for banking with us.Call Centre 1972.',
    );
    S().confirmDraft(draft('1,250.00').id, { subcategoryId: line('groceries') });
    reconciles('refund');
  });

  it('an ATM withdrawal and its fee', () => {
    at('2026-11-10T12:45:00');
    debit('Household', 10_030);
    deliver(
      'HNB ATM Withdrawal e-Receipt Amt(Approx.):  10000.00 LKR A/C: 1380***4150 Txn Fee: 30.00LKR Location: NSB MAKOLA ATM LK     , LKA Term ID: B15301   Date: 10.11.26 Time:12:40 Txn No: 3188241986 Avl Bal: 640099.67 LKR Hotline:941124',
    );
    S().confirmDraft(draft('10000.00').id, { subcategoryId: line('cash') });
    // The 30.00 fee either filed itself or waits as its own draft.
    S().loadSmsDrafts();
    const fee = S().smsDrafts.find((d) => d.amountMinor === rs(30));
    if (fee) S().confirmDraft(fee.id, { subcategoryId: line('charges') });
    reconciles('ATM + fee');
  });

  it('the internet bill', () => {
    at('2026-11-12T14:20:00');
    debit('Bills', 6_990);
    deliver(
      'LKR 6,990.00 debited from AC XXXXXXXX6796 as POS TXN on 12 Nov 2026 14:17 at STARLINK INTERNET.2DS 94. Avl Bal 2,031.19 Call 94112448888 for info',
    );
    S().confirmDraft(draft('6,990.00').id, { subcategoryId: line('internet') });
    reconciles('internet');
  });

  it('the car lease, debited from the salary account', () => {
    at('2026-11-15T06:05:00');
    debit('Salary', 52_341);
    deliver(
      'Your A/C No: ********7068 is debited with LKR52,341.00 on 15 NOV 2026 ref: Transfer Out. Your bal is LKR17,659.00. If unauthorized call 0112350035',
    );
    const lease = draft('52,341.00');
    expect(lease.subcategoryId).toBe(line('lease'));
    S().confirmDraft(lease.id, { subcategoryId: lease.subcategoryId });
    reconciles('lease');
  });

  it('salary day: the money lands and is moved out to each account', () => {
    at('2026-11-25T14:30:00');
    const billsPlan = moveRowPlan('Bills');
    const savingsPlan = moveRowPlan('Savings');
    expect(billsPlan).toBe(rs(45_000 + 9_000 + 2_500 + 6_990 + 10_000));
    expect(savingsPlan).toBe(rs(8_000));

    credit('Salary', 300_000);
    move('Salary', 'Bills', billsPlan / 100);
    move('Salary', 'Household', 120_000);
    move('Salary', 'Savings', savingsPlan / 100);

    // Bills and Household: both banks text, so the app SEES the moves. The
    // user moved more than planned to Household; Bills got exactly its plan.
    deliver(
      'Your A/C No: ********7068 is credited with LKR300,000.00 on 25 NOV 2026 ref: Credit Transfer. Your bal is LKR317,659.00. If unauthorized call 0112350035.',
      'Your A/C No: ********7068 is debited with LKR73,490.00 on 25 NOV 2026 ref: Outward CEFT Transfer. Your bal is LKR244,169.00. If unauthorized call 0112350035',
      'LKR 73,490.00 credited to AC XXXXXXXX6796 on 25 Nov 2026 14:20 as CEFTS Inward Transfer. Avl Bal 1.00 Call 94112448888 for info',
      'Your A/C No: ********7068 is debited with LKR120,000.00 on 25 NOV 2026 ref: Outward CEFT Transfer. Your bal is LKR207,659.00. If unauthorized call 0112350035',
      'Dear Customer,LKR 120,000.00 Credited to your A/c XXXXXXXX4150 on 25/11/2026 at 14:32.AvlBal LKR 120,000.00.Transaction CEFT Inward Transfer Deposit.Thank you for banking with us.Call Centre 1972.',
      // The savings bank sends no alerts: only the salary account's debit arrives.
      'Your A/C No: ********7068 is debited with LKR8,000.00 on 25 NOV 2026 ref: Outward CEFT Transfer. Your bal is LKR199,659.00. If unauthorized call 0112350035',
    );
    // The bank's confirmations ticked Bills and Household by themselves.
    expect(S().accountTransferStates.get(card('Bills').id)?.status).toBe('transferred');
    expect(S().accountTransferStates.get(card('Household').id)?.status).toBe('transferred');
    // Savings is ticked by hand — the app hears about it no other way.
    S().toggleAccountTransfer(card('Savings').id);

    // The own-account transfers are not spending: nothing to confirm for them.
    S().loadSmsDrafts();
    expect(S().smsDrafts.some((d) => d.amountMinor === rs(120_000))).toBe(false);
    expect(S().smsDrafts.some((d) => d.amountMinor === rs(73_490))).toBe(false);
    reconciles('salary day');
  });

  it('freelance income lands in the bills account', () => {
    at('2026-11-26T12:05:00');
    credit('Bills', 40_000);
    deliver(
      'LKR 40,000.00 credited to AC XXXXXXXX6796 on 26 Nov 2026 12:03 as CEFTS Inward Transfer. Avl Bal 186,488.43 Call 94112448888 for info',
    );
    S().confirmDraft(draft('40,000.00').id, { subcategoryId: line('freelance') });
    reconciles('freelance');
  });

  it('a bank charge for a transfer, from an account no line names', () => {
    at('2026-11-26T12:10:00');
    debit('Bills', 25);
    deliver(
      'LKR 25.00 debited from AC XXXXXXXX6796 on 26 Nov 2026 12:08 as CEFTS Transfer Charges. Avl Bal 8,747.20 Call 94112448888 for info',
    );
    S().loadSmsDrafts();
    const fee = S().smsDrafts.find((d) => d.amountMinor === rs(25));
    if (fee) S().confirmDraft(fee.id, { subcategoryId: line('charges') });
    reconciles('transfer charge');
  });

  it('dinner out and medicine at month end; the insurance set-aside ticked', () => {
    at('2026-11-28T20:15:00');
    debit('Household', 3_200);
    deliver(
      'Dear Customer,LKR 3,200.00 Debited from your A/c XXXXXXXX4150 on 28/11/2026 at 20:12.AvlBal LKR 50,000.00. @ PIZZA BUONA PVT LTD KIRIBATHGODA. POS Transaction.Thank you for banking with us.Call Centre 1972.',
    );
    S().confirmDraft(draft('3,200.00').id, { subcategoryId: line('eating') });
    S().addTransaction({ subcategoryId: line('medicine'), name: 'Pharmacy', amountMinor: rs(2_340.5), date: new Date() });
    debit('Household', 2_340.5);
    // A saving plan's monthly tick keeps the money in Savings.
    S().setStatus(line('insurance'), 'paid');
    reconciles('month end');
  });
});

describe('December — a heavy month, with corrections', () => {
  it('rent, ticked on the 1st of the new month', () => {
    at('2026-12-01T09:00:00');
    S().setPeriod('2026-12');
    S().setStatus(line('rent'), 'paid');
    debit('Bills', 45_000);
    reconciles('Dec rent');
  });

  it('a big grocery shop, then the water bill typed in with its figure', () => {
    at('2026-12-03T19:00:00');
    debit('Household', 18_400.6);
    debit('Bills', 2_875);
    deliver(
      'Dear Customer,LKR 18,400.60 Debited from your A/c XXXXXXXX4150 on 03/12/2026 at 18:55.AvlBal LKR 90,000.00. @ KEELLS SUPER KELANIYA. POS Transaction.Thank you for banking with us.Call Centre 1972.',
    );
    S().confirmDraft(draft('18,400.60').id, { subcategoryId: line('groceries') });

    at('2026-12-06T10:00:00');
    S().logTransaction(line('water'), { status: 'paid', actualMinor: rs(2_875), date: new Date() });
    reconciles('groceries + water');
  });

  it('a mistaken entry deleted, and a wrong amount corrected', () => {
    at('2026-12-08T21:00:00');
    S().addTransaction({ subcategoryId: line('eating'), name: 'Oops', amountMinor: rs(5_000), date: new Date() });
    const oops = repos.transactionRepo.bySubcategoryPeriod(line('eating'), '2026-12').find((t) => t.name === 'Oops')!;
    S().deleteTransaction(oops.id);

    at('2026-12-09T09:00:00');
    S().addTransaction({ subcategoryId: line('medicine'), name: 'Pharmacy', amountMinor: rs(1_500), date: new Date() });
    const pharmacy = repos.transactionRepo.bySubcategoryPeriod(line('medicine'), '2026-12')[0];
    S().updateTransaction(pharmacy.id, { amountMinor: rs(1_850) });
    debit('Household', 1_850);
    reconciles('delete + correct');
  });

  it('a shop confirmed whole, then split afterwards', () => {
    at('2026-12-10T18:30:00');
    debit('Household', 22_900);
    deliver(
      'Dear Customer,LKR 22,900.00 Debited from your A/c XXXXXXXX4150 on 10/12/2026 at 18:25.AvlBal LKR 70,000.00. @ KEELLS SUPER KELANIYA. POS Transaction.Thank you for banking with us.Call Centre 1972.',
    );
    S().confirmDraft(draft('22,900.00').id, { subcategoryId: line('groceries') });
    const shop = repos.transactionRepo
      .bySubcategoryPeriod(line('groceries'), '2026-12')
      .find((t) => t.amountMinor === rs(22_900))!;
    at('2026-12-11T08:00:00');
    S().setTransactionSplits(shop.id, [
      { subcategoryId: line('groceries'), amountMinor: rs(20_000) },
      { subcategoryId: line('pet'), amountMinor: rs(2_900) },
    ]);
    reconciles('re-split');
  });

  it('a one-time repair, paid from savings', () => {
    at('2026-12-12T15:00:00');
    S().addSubcategory({
      name: 'Laptop repair',
      categoryId: S().categories.find((c) => c.name === 'Living')!.id,
      plannedMinor: rs(18_500),
      frequency: 'one_time',
      onceInPeriod: '2026-12',
    } as never);
    ids.repair = S().subcategories.find((s) => s.name === 'Laptop repair')!.id;
    S().addTransaction({
      subcategoryId: line('repair'),
      name: 'Laptop repair',
      amountMinor: rs(18_500),
      date: new Date(),
      cardId: card('Savings').id,
    });
    debit('Savings', 18_500);
    reconciles('repair');
  });

  it('the lease again, and an over-budget grocery run', () => {
    at('2026-12-15T06:05:00');
    debit('Salary', 52_341);
    debit('Household', 26_300);
    deliver(
      'Your A/C No: ********7068 is debited with LKR52,341.00 on 15 DEC 2026 ref: Transfer Out. Your bal is LKR17,659.00. If unauthorized call 0112350035',
    );
    S().confirmDraft(draft('15 DEC 2026').id, { subcategoryId: line('lease') });

    at('2026-12-18T19:00:00');
    deliver(
      'Dear Customer,LKR 26,300.00 Debited from your A/c XXXXXXXX4150 on 18/12/2026 at 18:55.AvlBal LKR 40,000.00. @ KEELLS SUPER KELANIYA. POS Transaction.Thank you for banking with us.Call Centre 1972.',
    );
    S().confirmDraft(draft('26,300.00').id, { subcategoryId: line('groceries') });
    reconciles('lease + groceries');
  });

  it('money sent to family: a transfer Smart Detect cannot place, so the user does', () => {
    at('2026-12-20T10:10:00');
    debit('Bills', 11_025);
    deliver(
      'LKR 11,000.00 debited from AC XXXXXXXX6796 on 20 Dec 2026 10:05 as CEFTS Outward Transfer. Avl Bal 3,000.00 Call 94112448888 for info',
      'LKR 25.00 debited from AC XXXXXXXX6796 on 20 Dec 2026 10:05 as CEFTS Transfer Charges. Avl Bal 2,975.00 Call 94112448888 for info',
    );
    const sent = draft('11,000.00');
    // A bare transfer label names no payee: no confident guess.
    expect(sent.subcategoryId).toBe('');
    S().confirmDraft(sent.id, { subcategoryId: line('family') });
    S().loadSmsDrafts();
    const fee = S().smsDrafts.find((d) => d.amountMinor === rs(25));
    if (fee) S().confirmDraft(fee.id, { subcategoryId: line('charges') });
    reconciles('family + fee');
  });

  it('a charge and its reversal cancel out', () => {
    at('2026-12-22T20:40:00');
    deliver(
      'LKR 2,999.00 debited from AC XXXXXXXX6796 as POS TXN on 22 Dec 2026 20:31 at NETFLIX.COM. Avl Bal 1,000.00 Call 94112448888 for info',
      'A reversal for POS TXN of LKR 2,999.00 credited to AC XXXXXXXX6796 on 22 Dec 2026 20:35. Avl Bal 3,999.00 Call 94112448888 for info',
    );
    S().loadSmsDrafts();
    expect(S().smsDrafts.some((d) => d.amountMinor === rs(2_999))).toBe(false);
    reconciles('reversal');
  });

  it('salary day: one transfer confirmed by the bank, one ticked by hand', () => {
    at('2026-12-25T14:30:00');
    credit('Salary', 300_000);
    // Bills: plan includes the one-time repair this month.
    expect(moveRowPlan('Bills')).toBe(rs(45_000 + 9_000 + 2_500 + 6_990 + 10_000 + 18_500));
    move('Salary', 'Bills', 91_990);
    move('Salary', 'Household', 115_000);
    move('Salary', 'Savings', 8_000);
    deliver(
      'Your A/C No: ********7068 is credited with LKR300,000.00 on 25 DEC 2026 ref: Credit Transfer. Your bal is LKR317,659.00. If unauthorized call 0112350035.',
      'Your A/C No: ********7068 is debited with LKR91,990.00 on 25 DEC 2026 ref: Outward CEFT Transfer. Your bal is LKR225,669.00. If unauthorized call 0112350035',
      'LKR 91,990.00 credited to AC XXXXXXXX6796 on 25 Dec 2026 14:31 as CEFTS Inward Transfer. Avl Bal 90,000.00 Call 94112448888 for info',
    );
    // The bank's confirmation ticked the row by itself.
    expect(S().accountTransferStates.get(card('Bills').id)?.status).toBe('transferred');

    // Household: ticked by hand, then both banks text about the move.
    S().toggleAccountTransfer(card('Household').id);
    deliver(
      'Your A/C No: ********7068 is debited with LKR115,000.00 on 25 DEC 2026 ref: Outward CEFT Transfer. Your bal is LKR110,669.00. If unauthorized call 0112350035',
      'Dear Customer,LKR 115,000.00 Credited to your A/c XXXXXXXX4150 on 25/12/2026 at 14:40.AvlBal LKR 150,000.00.Transaction CEFT Inward Transfer Deposit.Thank you for banking with us.Call Centre 1972.',
    );
    // Savings: ticked by hand; its bank's alert arrives in the next step.
    S().toggleAccountTransfer(card('Savings').id);
    reconciles('Dec salary day');
  });

  it('the bank confirms the hand-ticked savings move: counted once, not twice', () => {
    at('2026-12-25T15:00:00');
    deliver(
      'Your A/C No: ********7068 is debited with LKR8,000.00 on 25 DEC 2026 ref: Outward CEFT Transfer. Your bal is LKR112,669.00. If unauthorized call 0112350035',
      'LKR 8,000.00 credited to AC XXXXXXXX1234 on 25 Dec 2026 14:58 as CEFTS Inward Transfer. Avl Bal 238,500.00 Call 94112448888 for info',
    );
    reconciles('savings confirmed');
  });

  it('a top-up to household later in the month counts on top of the funding', () => {
    at('2026-12-28T11:00:00');
    move('Salary', 'Household', 10_000);
    deliver(
      'Your A/C No: ********7068 is debited with LKR10,000.00 on 28 DEC 2026 ref: Outward CEFT Transfer. Your bal is LKR102,669.00. If unauthorized call 0112350035',
      'Dear Customer,LKR 10,000.00 Credited to your A/c XXXXXXXX4150 on 28/12/2026 at 10:58.AvlBal LKR 50,000.00.Transaction CEFT Inward Transfer Deposit.Thank you for banking with us.Call Centre 1972.',
    );
    reconciles('top-up');
  });

  it('the electricity bill after salary day; the set-aside ticked', () => {
    at('2026-12-27T09:15:00');
    debit('Bills', 12_150.8);
    deliver(
      'LKR 12,150.80 debited from AC XXXXXXXX6796 as POS TXN on 27 Dec 2026 09:10 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 1,000.00 Call 94112448888 for info',
    );
    S().confirmDraft(draft('12,150.80').id, { subcategoryId: line('electricity') });
    S().setStatus(line('insurance'), 'paid');
    reconciles('Dec electricity');
  });
});

describe('January — the month in progress', () => {
  it('raising the rent plan rewrites nothing already paid', () => {
    at('2027-01-02T09:00:00');
    S().setPeriod('2027-01');
    S().updateSubcategory(line('rent'), { plannedMinor: rs(50_000) });
    reconciles('plan change');
    S().setStatus(line('rent'), 'paid');
    debit('Bills', 50_000);
    reconciles('Jan rent');
  });

  it('a fee the app never heard about, fixed by typing the bank balance', () => {
    at('2027-01-05T09:00:00');
    debit('Household', 1_000); // annual card fee: no SMS arrived
    expect(appBalances().Household).toBe(bank.Household + rs(1_000));
    setCurrentBalance('Household', bank.Household / 100);
    reconciles('balance set to bank');
  });

  it('the monthly family transfer is recognised by its amount', () => {
    at('2027-01-06T10:10:00');
    debit('Bills', 11_000);
    deliver(
      'LKR 11,000.00 debited from AC XXXXXXXX6796 on 06 Jan 2027 10:05 as CEFTS Outward Transfer. Avl Bal 3,000.00 Call 94112448888 for info',
    );
    const sent = draft('06 Jan 2027');
    // Filed to Family support in December: same sum, same account.
    expect(sent.subcategoryId).toBe(line('family'));
    S().confirmDraft(sent.id, { subcategoryId: sent.subcategoryId });
    reconciles('family again');
  });

  it('a pasted message, confirmed', () => {
    at('2027-01-07T18:00:00');
    debit('Household', 3_450.5);
    const id = S().ingestSmsText(
      withBankBalance(
        'Dear Customer,LKR 3,450.50 Debited from your A/c XXXXXXXX4150 on 07/01/2027 at 17:55.AvlBal LKR 40,000.00. @ KEELLS SUPER KELANIYA. POS Transaction.Thank you for banking with us.Call Centre 1972.',
      ),
    );
    expect(typeof id).toBe('string');
    S().confirmDraft(draft('3,450.50').id, { subcategoryId: line('groceries') });
    reconciles('pasted');
  });
});

describe('the whole three months', () => {
  it('shows the same balances whichever month is on screen', () => {
    for (const period of ['2026-11', '2026-12', '2027-01', '2027-02']) {
      S().setPeriod(period);
      reconciles(`viewing ${period}`);
    }
    S().setPeriod('2027-01');
  });

  it('chains every month: closing of one is the opening of the next', () => {
    const ledgers = selectors.selectAccountLedgers(S());
    for (const name of ACCOUNTS) {
      const ledger = ledgers.get(card(name).id)!;
      const months = ['2026-11', '2026-12', '2027-01'];
      for (let i = 0; i < months.length; i++) {
        const flow = ledgerLogic.periodFlow(ledger, months[i]);
        expect(flow.closingMinor, `${name} ${months[i]}`).toBe(flow.openingMinor + flow.inMinor - flow.outMinor);
        if (i > 0) {
          expect(flow.openingMinor).toBe(ledgerLogic.periodFlow(ledger, months[i - 1]).closingMinor);
        }
      }
    }
  });

  it('deleting a line that has payments keeps its money in history', () => {
    const before = appBalances();
    S().deleteSubcategory(line('fuel'));
    // Gone from the plan…
    expect(S().subcategories.some((s) => s.id === line('fuel'))).toBe(false);
    // …but the fuel bought in November and December still left the accounts.
    expect(appBalances()).toEqual(before);
    expect(repos.transactionRepo.bySubcategoryPeriod(line('fuel'), '2026-11').length).toBeGreaterThan(0);
  });

  it('ends on these exact statements', () => {
    expect(appBalances()).toEqual(FINAL_STATEMENT);
  });
});

/**
 * Worked out by hand from the steps above, independently of `bank` — the
 * figures the four banking apps would show on 7 January.
 *
 *   Salary     120,000 − 52,341 + 300,000 − 73,490 − 8,000 − 120,000
 *              − 52,341 + 300,000 − 91,990 − 115,000 − 8,000 − 10,000
 *   Bills      8,450.25 − 8,734.40 − 45,000 − 6,990 + 73,490 + 40,000 − 25
 *              − 45,000 − 2,875 − 11,025 + 91,990 − 12,150.80 − 50,000 − 11,000
 *   Household  15,000 − 4,250.75 − 1,800 − 7,600 + 1,250 − 10,030 + 120,000
 *              − 3,200 − 2,340.50 − 18,400.60 − 1,850 − 22,900 − 26,300
 *              + 115,000 + 10,000 − 1,000 − 3,450.50
 *   Savings    250,000 − 9,000 + 8,000 − 18,500 + 8,000
 */
const FINAL_STATEMENT: Record<AccountName, number> = {
  Salary: rs(188_838),
  Bills: rs(21_130.05),
  Household: rs(158_127.65),
  Savings: rs(238_500),
};

function moveRowPlan(name: AccountName): number {
  return selectors.selectAccountTransfers(S()).find((a) => a.card.nickname === name)!.toTransferMinor;
}
