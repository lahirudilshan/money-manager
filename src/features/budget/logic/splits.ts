/**
 * Splitting one payment across several budget lines.
 *
 * A 5,000 shop at Keells is a single debit — one line on the bank statement,
 * one SMS — but it is rarely a single budget line: 3,000 of it was groceries
 * and 2,000 was pet food. This module is the arithmetic behind that, kept out
 * of the components so the rules are testable and stated once.
 *
 * ## The invariant
 *
 * The parts must sum to the parent transaction's amount, EXACTLY. Not "close
 * enough": an unallocated remainder is money that left the account and appears
 * in no line's total, which is precisely the silent under-counting a budget app
 * exists to prevent. Minor units make this a plain integer comparison, with no
 * float slack to reason about.
 *
 * A transaction with zero parts is not a violation — it is simply *unsplit*,
 * and counts whole against its own line. That is the state every transaction
 * starts in and returns to when a split is undone.
 */

/** One part of a split, as the editor holds it while being edited. */
export interface SplitPart {
  /**
   * Stable identity for the row while editing — NOT the database id.
   *
   * The editor's rows are reordered, removed and re-added before anything is
   * saved, and React needs a key that survives that. Splits are written
   * wholesale (`transactionSplitRepo.replace`), so database ids are minted at
   * save time and never round-trip through here.
   */
  key: string;
  subcategoryId: string | null;
  /**
   * Minor units, DERIVED from `amountText` — never the other way round.
   *
   * The editor used to hold only this and re-render the input as
   * `(amountMinor / 100).toFixed(2)`. That makes the field unusable: typing "2"
   * stores 2 minor units, which renders back as "0.02", which moves the caret
   * and turns the next keystroke into nonsense. Nobody could type "2000".
   *
   * So the TEXT is what the user owns and this is computed from it on every
   * change. Null while the field is empty or holds no usable number.
   */
  amountMinor: number | null;
  /**
   * Exactly what the user typed, kept verbatim so the input is never fought.
   *
   * Preserves the states a number cannot represent mid-typing — "", "2.",
   * "1,2" — which is precisely why the derived-display version misbehaved.
   */
  amountText: string;
  note?: string | null;
}

/**
 * Read a typed amount into minor units.
 *
 * Tolerates the separators `formatAmountInput` produces ("1,250.50") and the
 * half-finished shapes typing passes through ("2.", ""), returning null rather
 * than 0 for anything unusable — a zero would count as allocated and make the
 * remainder claim the row is finished.
 */
export function parsePartAmount(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned || cleaned === '.') return null;

  const major = Number.parseFloat(cleaned);
  if (!Number.isFinite(major) || major <= 0) return null;

  // Rounded, not truncated: 0.1 + 0.2 style float drift would otherwise lose a
  // cent, and a split that is one cent short cannot be saved at all.
  return Math.round(major * 100);
}

/** A fresh empty part, with a key that will not collide with a removed row's. */
export function emptyPart(): SplitPart {
  return {
    // Time + randomness rather than an index: an index is reused after a
    // removal, and React would carry the deleted row's input state into the
    // new one.
    key: `part-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    subcategoryId: null,
    amountMinor: null,
    amountText: '',
  };
}

export interface SplitValidation {
  /** Total currently allocated across the parts. */
  allocatedMinor: number;
  /**
   * What is left to allocate. Positive when short, NEGATIVE when the parts
   * overshoot the payment — the sign is the whole message, so it is preserved
   * rather than reported as an absolute "difference".
   */
  remainderMinor: number;
  /** Every part names a line and an amount, and the amounts sum exactly. */
  valid: boolean;
  /** Parts that are complete enough to be saved. */
  usableCount: number;
}

/**
 * Whether a set of parts is ready to save against a payment of `totalMinor`.
 *
 * A part is only counted once it has BOTH a line and a positive amount — a
 * half-filled row the user is still typing into should read as "not yet
 * allocated" rather than as an error, which is what keeps the remainder
 * counting down naturally as the form is filled in.
 */
export function validateSplit(
  parts: readonly SplitPart[],
  totalMinor: number,
): SplitValidation {
  const usable = parts.filter(
    (part) => part.subcategoryId !== null && (part.amountMinor ?? 0) > 0,
  );
  const allocatedMinor = usable.reduce((sum, part) => sum + (part.amountMinor ?? 0), 0);

  return {
    allocatedMinor,
    remainderMinor: totalMinor - allocatedMinor,
    /*
     * At least TWO parts, or it is not a split.
     *
     * One part covering the whole amount is just the transaction itself with
     * extra rows in the database, and it would render as "split across 1 line"
     * — so the editor treats that as unfinished rather than saving a split that
     * means nothing.
     */
    valid:
      usable.length >= 2 &&
      usable.length === parts.length &&
      allocatedMinor === totalMinor,
    usableCount: usable.length,
  };
}

/**
 * Split `totalMinor` into `count` as-equal-as-possible parts.
 *
 * Powers the "split evenly" shortcut. The remainder from the integer division
 * is handed out one unit at a time from the FIRST part rather than dumped on
 * the last, so 1000 across 3 gives 334/333/333 — the discrepancy sits where the
 * eye lands first and reads as deliberate, and no part is ever short by more
 * than one minor unit. The parts sum to exactly `totalMinor` by construction.
 */
export function splitEvenly(totalMinor: number, count: number): number[] {
  if (count <= 0) return [];

  const base = Math.floor(totalMinor / count);
  const remainder = totalMinor - base * count;

  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/**
 * Fill the FIRST empty amount with whatever is left over.
 *
 * The common shape of a split is "the whole thing was groceries, except the
 * 2,000 of pet food" — the user knows one part exactly and wants the rest to
 * fall out. Typing 2,000 and tapping the remainder onto the other row is the
 * two-tap version of that, and it lands on the invariant by construction
 * rather than by the user doing the subtraction in their head.
 *
 * Returns the parts unchanged when there is nothing left to give or no empty
 * row to give it to, so the caller can wire this to a button that is simply
 * inert rather than having to guard it.
 */
export function assignRemainder(
  parts: readonly SplitPart[],
  totalMinor: number,
): SplitPart[] {
  const { remainderMinor } = validateSplit(parts, totalMinor);
  if (remainderMinor <= 0) return [...parts];

  const target = parts.findIndex((part) => (part.amountMinor ?? 0) <= 0);
  if (target === -1) return [...parts];

  return parts.map((part, index) =>
    index === target ? { ...part, ...withAmount(remainderMinor) } : part,
  );
}

/**
 * The pair of fields that must move together whenever code (not the user) sets
 * an amount — "split evenly", "use remainder", seeding the editor.
 *
 * `amountText` is the display, `amountMinor` the value; setting one without the
 * other is how the field and the running total end up disagreeing. Formatted to
 * 2dp so a programmatic amount reads like a typed one.
 */
export function withAmount(minor: number): Pick<SplitPart, 'amountMinor' | 'amountText'> {
  return { amountMinor: minor, amountText: (minor / 100).toFixed(2) };
}

/**
 * How a split reads in one line on an entry row — "Groceries 3,000 · Pet 2,000".
 *
 * Takes the resolved names rather than looking them up, so this stays pure and
 * the caller (which already has the board loaded) does the one lookup it
 * already has the data for.
 */
export function describeSplit(
  parts: readonly { name: string; amountMinor: number }[],
  formatAmount: (minor: number) => string,
): string {
  return parts.map((part) => `${part.name} ${formatAmount(part.amountMinor)}`).join(' · ');
}

/**
 * "1ST", "2ND", "3RD", "4TH"… for labelling the rows.
 *
 * The 11/12/13 exception is real English and cheap to honour — "11TH", not
 * "11ST" — and a long receipt genuinely reaches those numbers.
 */
export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}TH`;
  return `${n}${({ 1: 'ST', 2: 'ND', 3: 'RD' } as Record<number, string>)[n % 10] ?? 'TH'}`;
}
