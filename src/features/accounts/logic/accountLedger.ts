/**
 * What each account HOLDS — a running balance built from every month on record.
 *
 * ## Why this exists
 *
 * The balance used to be `opening + funded − spent`, all three read from the
 * month on screen:
 *
 *   - `funded` came from the `fundings` table, which nothing in the UI writes,
 *     so it was always zero. The real "I moved the money" signal is the
 *     per-account tick in `account_transfers`, and the balance never read it;
 *   - `spent` was only the viewed month, so last month's spending vanished the
 *     moment the month rolled over, and paging between months changed what an
 *     account claimed to hold;
 *   - the opening balance had no field to set it, so every account opened at 0.
 *
 * Together that made every account read `0 − this month's spending`: negative,
 * and different on every month. A bank balance does not behave like that.
 *
 * ## The model
 *
 * A balance is a ledger: one signed movement per real money event, summed from
 * the month the account started being tracked up to today.
 *
 *   + opening balance          what was there before tracking began
 *   + income                   salary (Income screen) and income lines landing
 *   + transfer in              the dashboard's "money to move" tick
 *   − transfer out             the same move, leaving the funding account
 *   − bill                     a dated bill paid (its actual, else its plan)
 *   − spend                    each entry on an everyday-spending line
 *   + credit                   an entry logged against an income line
 *
 * Every figure is in the ACCOUNT's own currency: plans are in the home currency
 * and are converted through the supplied `toAccount`, while a stored transfer
 * amount is already what arrived in that account.
 *
 * Pure: no store, no database. The selector feeds it rows; tests feed it
 * fixtures; both get the same answer.
 */

import { appliesToPeriod, billActual, periodKey, shiftPeriod } from '~/features/budget/logic/planning';
import type { Minor } from '~/shared/lib/money';

export type MovementKind =
  | 'opening'
  | 'income'
  | 'transfer_in'
  | 'transfer_out'
  | 'bill'
  | 'spend'
  | 'credit';

export interface Movement {
  cardId: string;
  period: string;
  kind: MovementKind;
  /** Signed, in the account's own currency: + money arrived, − money left. */
  amountMinor: Minor;
  label: string;
  /** When it happened, if known — orders the movement list. */
  date: Date | null;
  /** The budget line it came from, for bills, spends and credits. */
  subcategoryId?: string;
}

export interface LedgerAccount {
  id: string;
  openingBalanceMinor: Minor;
  /** "YYYY-MM" tracking starts — movements before it are inside the opening. */
  startPeriod: string;
}

export interface LedgerLine {
  id: string;
  name: string;
  type: 'income' | 'expense';
  frequency: 'monthly' | 'one_time' | 'yearly' | 'ongoing';
  plannedMinor: Minor;
  planTargetMinor: Minor | null;
  onceInPeriod: string | null;
  createdAt: Date;
  /** Already resolved: the line's own account, else its category's. */
  cardId: string | null;
}

export interface LedgerState {
  subcategoryId: string;
  period: string;
  status: string;
  actualMinor: Minor | null;
  /** What the tick cost, frozen at the time; null on older rows. */
  paidAmountMinor?: Minor | null;
  updatedAt?: Date | null;
}

export interface LedgerTransaction {
  id: string;
  subcategoryId: string;
  period: string;
  name: string;
  /**
   * Signed as the LINE sees it: positive is a payment on an expense line (or
   * money received on an income line); negative is a refund of either.
   */
  amountMinor: Minor;
  date: Date;
  /** The account it moved through, when not the line's own. */
  cardId?: string | null;
}

export interface LedgerTransfer {
  cardId: string;
  period: string;
  status: string;
  /** What was moved, in the RECEIVING account's currency. Null on old rows. */
  amountMinor: Minor | null;
  /** What a bank message confirmed, when the tick was automatic. */
  matchedAmountMinor: Minor | null;
  transferredAt: Date | null;
}

export interface LedgerIncome {
  id: string;
  name: string;
  /** Home currency. */
  amountMinor: Minor;
  cardId: string | null;
  isActive: boolean;
}

export interface LedgerInput {
  accounts: readonly LedgerAccount[];
  lines: readonly LedgerLine[];
  states: readonly LedgerState[];
  transactions: readonly LedgerTransaction[];
  transfers: readonly LedgerTransfer[];
  incomes: readonly LedgerIncome[];
  /** Where moved money comes FROM — usually the salary account. */
  sourceCardId: string | null;
  /** The month "now" falls in. Nothing after it has happened yet. */
  currentPeriod: string;
  /** Home-currency minor units into one account's currency. */
  toAccount: (homeMinor: Minor, cardId: string) => Minor;
  /** One account's currency back into home-currency minor units. */
  toHome: (accountMinor: Minor, cardId: string) => Minor;
}

export interface AccountLedger {
  cardId: string;
  /** What the account holds now, in its own currency. */
  balanceMinor: Minor;
  /** Every movement, newest first. */
  movements: Movement[];
}

/**
 * What one dated bill costs when paid with no figure typed.
 *
 * A yearly line with a saving plan stores the MONTHLY set-aside as its plan and
 * the real bill as `planTargetMinor` — paying it moves the whole premium, not
 * one month of saving towards it.
 */
export function faceValue(
  line: Pick<LedgerLine, 'frequency' | 'plannedMinor' | 'planTargetMinor'>,
): Minor {
  if (isSavingPlan(line)) return line.planTargetMinor!;
  return line.plannedMinor;
}

/** A yearly bill saved for month by month — see `faceValue`. */
export function isSavingPlan(line: Pick<LedgerLine, 'frequency' | 'planTargetMinor'>): boolean {
  return line.frequency === 'yearly' && line.planTargetMinor != null;
}

/**
 * The plan for one account in one month, in the HOME currency — what the
 * dashboard asks the user to move there.
 *
 * Shared with `selectAccountTransfers` so "money to move" and the transfer a
 * tick records can never be two different numbers.
 *
 *   - a one-time line counts only in its own month;
 *   - a yearly line asks for a twelfth — the same monthly figure the board
 *     plans — unless it carries a saving plan, whose plan is already monthly;
 *   - income lines are money arriving, never money to move.
 */
export function plannedForAccount(
  lines: readonly LedgerLine[],
  cardId: string,
  period: string,
): Minor {
  let total = 0;
  for (const line of lines) {
    if (line.cardId !== cardId || line.type === 'income') continue;
    total += monthlyPlanOf(line, period);
  }
  return total;
}

/** One line's monthly plan in a given month — 0 when it does not apply. */
export function monthlyPlanOf(
  line: Pick<LedgerLine, 'frequency' | 'plannedMinor' | 'planTargetMinor' | 'onceInPeriod' | 'createdAt'>,
  period: string,
): Minor {
  const applies = appliesToPeriod(
    {
      id: '',
      name: '',
      plannedMinor: line.plannedMinor,
      status: 'pending',
      frequency: line.frequency,
      period: line.onceInPeriod ?? periodKey(line.createdAt),
    },
    period,
  );
  if (!applies) return 0;
  if (line.frequency === 'yearly' && line.planTargetMinor == null) {
    return Math.round(line.plannedMinor / 12);
  }
  return line.plannedMinor;
}

/** Every "YYYY-MM" from `from` to `to`, inclusive. Empty when from > to. */
export function periodsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  // Bounded: a corrupt period must not spin forever.
  for (let i = 0; i < 1200 && cursor <= to; i++) {
    out.push(cursor);
    cursor = shiftPeriod(cursor, 1);
  }
  return out;
}

/**
 * Where moved money comes from: the account income lands in.
 *
 * An explicit choice wins while it still names a live account. Otherwise the
 * account receiving the most active income — on a normal board, the salary
 * account. Null when no income names an account, in which case transfers are
 * treated as arriving from outside the app (nothing is debited).
 */
export function resolveSourceCardId(options: {
  accountIds: readonly string[];
  incomes: readonly LedgerIncome[];
  incomeLines: readonly LedgerLine[];
  chosenCardId?: string | null;
}): string | null {
  const { accountIds, incomes, incomeLines, chosenCardId } = options;
  const live = new Set(accountIds);
  if (chosenCardId && live.has(chosenCardId)) return chosenCardId;

  const byCard = new Map<string, Minor>();
  for (const income of incomes) {
    if (!income.isActive || !income.cardId || !live.has(income.cardId)) continue;
    byCard.set(income.cardId, (byCard.get(income.cardId) ?? 0) + income.amountMinor);
  }
  for (const line of incomeLines) {
    if (line.type !== 'income' || !line.cardId || !live.has(line.cardId)) continue;
    byCard.set(line.cardId, (byCard.get(line.cardId) ?? 0) + line.plannedMinor);
  }

  let best: string | null = null;
  let bestAmount = 0;
  for (const [cardId, amount] of byCard) {
    if (amount > bestAmount || (amount === bestAmount && best != null && cardId < best)) {
      best = cardId;
      bestAmount = amount;
    }
  }
  return best;
}

/**
 * Every money movement on record, per account.
 *
 * Movements outside an account's tracked window (before its start, after the
 * current month) are dropped: the first are already inside its opening
 * balance, the second have not happened.
 */
export function buildLedgers(input: LedgerInput): Map<string, AccountLedger> {
  const { accounts, lines, states, transactions, transfers, incomes, currentPeriod } = input;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const movements: Movement[] = [];

  const inWindow = (cardId: string | null, period: string): cardId is string => {
    if (!cardId) return false;
    const account = accountById.get(cardId);
    if (!account) return false;
    return period >= account.startPeriod && period <= currentPeriod;
  };

  const push = (m: Movement) => {
    if (m.amountMinor === 0) return;
    if (!inWindow(m.cardId, m.period)) return;
    movements.push(m);
  };

  // ── Entries: each logged payment moves money on the day it happened ──────
  const entriesByLinePeriod = new Map<string, LedgerTransaction[]>();
  for (const txn of transactions) {
    const key = `${txn.subcategoryId}|${txn.period}`;
    const list = entriesByLinePeriod.get(key);
    if (list) list.push(txn);
    else entriesByLinePeriod.set(key, [txn]);
  }

  for (const txn of transactions) {
    const line = lineById.get(txn.subcategoryId);
    if (!line) continue;
    const cardId = txn.cardId ?? line.cardId;
    if (!cardId) continue;
    const income = line.type === 'income';
    // A refund on a spending line is money coming back, whatever the line.
    const arriving = income ? txn.amountMinor > 0 : txn.amountMinor < 0;
    /*
     * The WHOLE payment, from the account of the line it was logged against.
     *
     * A split only re-allocates a payment across budget lines; the bank took
     * the full amount from one account. Charging each part to its own line's
     * account would move money between accounts that never moved.
     */
    push({
      cardId,
      period: txn.period,
      kind: arriving ? 'credit' : line.frequency === 'ongoing' ? 'spend' : 'bill',
      amountMinor: (income ? 1 : -1) * input.toAccount(txn.amountMinor, cardId),
      label: txn.name,
      date: txn.date,
      subcategoryId: line.id,
    });
  }

  // ── Dated bills ticked off without an entry: the month's single figure ────
  for (const state of states) {
    const line = lineById.get(state.subcategoryId);
    if (!line?.cardId || line.frequency === 'ongoing') continue;
    // Entries already moved this month's money for the line — see `billActual`.
    const entries = entriesByLinePeriod.get(`${line.id}|${state.period}`) ?? [];
    const entryTotal = entries.reduce((sum, t) => sum + t.amountMinor, 0);
    if (entryTotal > 0) continue;

    const paid = state.status !== 'pending';
    if (!paid) continue;
    const typed = billActual(0, state.actualMinor);
    /*
     * A SAVING-PLAN line ticked without a figure is a month's set-aside, not a
     * payment: the money is put by in the same account until the bill falls
     * due, which is what `paidPeriodCount` counts towards the plan's progress.
     * Charging the premium on every tick took 144,000 out of a savings account
     * for a month that had only saved 16,000 towards it. The real payment is
     * recorded with its figure (typed, or confirmed from the bank's SMS).
     */
    if (typed == null && isSavingPlan(line)) continue;
    const amount = typed ?? state.paidAmountMinor ?? faceValue(line);
    const income = line.type === 'income';
    push({
      cardId: line.cardId,
      period: state.period,
      kind: income ? 'income' : 'bill',
      amountMinor: (income ? 1 : -1) * input.toAccount(amount, line.cardId),
      label: line.name,
      date: state.updatedAt ?? null,
      subcategoryId: line.id,
    });
  }

  // ── Transfers: the dashboard tick, in to the account and out of the source ─
  const movedThisMonth = new Set<string>();
  for (const transfer of transfers) {
    if (transfer.status !== 'transferred') continue;
    movedThisMonth.add(transfer.period);
    if (transfer.cardId === input.sourceCardId) continue; // money already there
    const arrived =
      transfer.amountMinor ??
      transfer.matchedAmountMinor ??
      input.toAccount(plannedForAccount(lines, transfer.cardId, transfer.period), transfer.cardId);
    push({
      cardId: transfer.cardId,
      period: transfer.period,
      kind: 'transfer_in',
      amountMinor: arrived,
      label: 'Money moved in',
      date: transfer.transferredAt,
    });
    if (input.sourceCardId) {
      const home = input.toHome(arrived, transfer.cardId);
      push({
        cardId: input.sourceCardId,
        period: transfer.period,
        kind: 'transfer_out',
        amountMinor: -input.toAccount(home, input.sourceCardId),
        label: 'Money moved out',
        date: transfer.transferredAt,
      });
    }
  }

  // ── Declared income (Income screen): lands once a month ───────────────────
  /*
   * There is no per-month "received" tick for these, so arrival is inferred:
   * a finished month's salary has landed; the current month's has landed once
   * the user starts moving it (they cannot move money that is not there yet).
   * A salary that also exists as a board income line is counted there instead,
   * matching `selectTotalIncome`'s de-duplication.
   */
  const boardIncomeKeys = new Set(
    lines
      .filter((l) => l.type === 'income')
      .map((l) => `${l.name.trim().toLowerCase()}:${l.plannedMinor}`),
  );
  for (const income of incomes) {
    if (!income.isActive || !income.cardId) continue;
    if (boardIncomeKeys.has(`${income.name.trim().toLowerCase()}:${income.amountMinor}`)) continue;
    const account = accountById.get(income.cardId);
    if (!account) continue;
    for (const period of periodsBetween(account.startPeriod, currentPeriod)) {
      if (period === currentPeriod && !movedThisMonth.has(period)) continue;
      push({
        cardId: income.cardId,
        period,
        kind: 'income',
        amountMinor: input.toAccount(income.amountMinor, income.cardId),
        label: income.name,
        date: null,
      });
    }
  }

  // ── Fold into per-account ledgers ─────────────────────────────────────────
  const result = new Map<string, AccountLedger>();
  for (const account of accounts) {
    result.set(account.id, { cardId: account.id, balanceMinor: account.openingBalanceMinor, movements: [] });
  }
  for (const m of movements) {
    const ledger = result.get(m.cardId)!;
    ledger.movements.push(m);
    ledger.balanceMinor += m.amountMinor;
  }
  for (const ledger of result.values()) {
    ledger.movements.sort(compareMovements);
  }
  return result;
}

/** Newest first: by month, then by date, undated last within a month. */
function compareMovements(a: Movement, b: Movement): number {
  if (a.period !== b.period) return a.period < b.period ? 1 : -1;
  const at = a.date ? new Date(a.date).getTime() : -Infinity;
  const bt = b.date ? new Date(b.date).getTime() : -Infinity;
  return bt - at;
}

export interface PeriodFlow {
  /** Balance at the start of the month. */
  openingMinor: Minor;
  /** Everything that arrived: income, credits, transfers in. */
  inMinor: Minor;
  /** Everything that left, as a positive figure. */
  outMinor: Minor;
  /** Balance at the end of the month (or now, for the current one). */
  closingMinor: Minor;
  movements: Movement[];
}

/**
 * One month of one account: where it started, what came in, what went out.
 *
 * `closing = opening + in − out` holds by construction, and the closing of one
 * month is the opening of the next — the property a statement has to have.
 */
export function periodFlow(ledger: AccountLedger, period: string): PeriodFlow {
  let after = 0;
  let inMinor = 0;
  let outMinor = 0;
  const inMonth: Movement[] = [];
  for (const m of ledger.movements) {
    if (m.period > period) after += m.amountMinor;
    else if (m.period === period) {
      inMonth.push(m);
      if (m.amountMinor > 0) inMinor += m.amountMinor;
      else outMinor -= m.amountMinor;
    }
  }
  const closingMinor = ledger.balanceMinor - after;
  return {
    openingMinor: closingMinor - inMinor + outMinor,
    inMinor,
    outMinor,
    closingMinor,
    movements: inMonth,
  };
}

/**
 * The opening balance that makes an account read `target` today.
 *
 * Used when the user types what their banking app says: rather than asking for
 * a historical figure nobody knows ("what was in this account in August?"), the
 * app takes today's and works backwards through everything already recorded.
 */
export function openingForTarget(ledger: AccountLedger, currentOpening: Minor, target: Minor): Minor {
  return currentOpening + (target - ledger.balanceMinor);
}

/**
 * Board rows into ledger lines, with each line's account resolved.
 *
 * Structural rather than typed against the schema, so this module stays free
 * of database imports; the store and the selectors both pass their rows in.
 */
export function toLedgerLines(
  subcategories: readonly {
    id: string;
    name: string;
    type: 'income' | 'expense';
    frequency: LedgerLine['frequency'];
    plannedMinor: Minor;
    planTargetMinor: Minor | null;
    onceInPeriod: string | null;
    createdAt: Date;
    cardId: string | null;
    categoryId: string;
  }[],
  categories: readonly { id: string; cardId: string | null }[],
): LedgerLine[] {
  const categoryCard = new Map(categories.map((c) => [c.id, c.cardId]));
  return subcategories.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    frequency: s.frequency,
    plannedMinor: s.plannedMinor,
    planTargetMinor: s.planTargetMinor,
    onceInPeriod: s.onceInPeriod,
    createdAt: s.createdAt,
    cardId: s.cardId ?? categoryCard.get(s.categoryId) ?? null,
  }));
}
