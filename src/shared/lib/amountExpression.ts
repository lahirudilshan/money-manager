import { toMinor, type Minor } from './money';

/**
 * A plan amount typed as a sum — "100+5000+1000".
 *
 * ## Why
 *
 * A plan amount is often several known costs rather than one figure: three
 * subscriptions on one line, a rent plus its fixed service charge, this term's
 * fees plus the bus pass. Without this the user does the addition in their head
 * (or in another app), types the total, and the parts are lost — so a year
 * later nothing on the line says how 6,100 was arrived at, and revising one
 * part means reconstructing the rest from memory.
 *
 * ## What it deliberately does not do
 *
 * No precedence, no brackets, no multiplication. `+` and `-` only, evaluated
 * left to right, which needs no parser and has no order-of-operations trap: a
 * money field that quietly read "100+50*2" as 200 rather than 300 would be
 * worse than one that refused it. If the need for `*` appears later it can be
 * added, but it cannot be added *silently* — the reading of existing input
 * would change.
 *
 * The whole expression is kept as the user typed it, so it can be stored and
 * re-edited. `evaluateAmountExpression` is what turns it into money.
 */

/** Only what this evaluator understands: digits, dot, `+`, `-`, spaces. */
const ALLOWED = /^[0-9.+\-\s,]*$/;

/** A term and the operator that precedes it. */
interface Term {
  sign: 1 | -1;
  value: number;
}

export interface AmountExpression {
  /** The expression as typed, minus the formatting this module applies. */
  text: string;
  /** The total, or null when the expression is empty or unfinished. */
  total: Minor | null;
  /** The individual terms, for the breakdown under the field. */
  terms: readonly Minor[];
  /** True when the text holds more than one term — "100+50", not "100". */
  isSum: boolean;
  /**
   * True when the text cannot be evaluated at all, as opposed to merely being
   * unfinished. A trailing "+" is unfinished; a stray letter is invalid.
   */
  invalid: boolean;
}

/**
 * Reshape a keystroke, the way `formatAmountInput` does for a plain amount.
 *
 * Each term is grouped with thousands separators on its own, so a long sum
 * stays readable while it is being typed. Operators keep a space either side —
 * "1,000 + 250" rather than "1000+250" — because the operators are the thing
 * the reader needs to pick out, and unspaced they disappear into the digits.
 */
export function formatAmountExpression(input: string): string {
  if (typeof input !== 'string' || input === '') return '';

  // Anything this module does not understand is dropped, exactly as
  // `formatAmountInput` drops a stray character rather than rejecting the
  // keystroke — the field stays usable and nothing unparseable accumulates.
  const cleaned = input.replace(/[^0-9.+\-]/g, '');
  if (cleaned === '') return '';

  /*
   * Split KEEPING the operators, so a trailing one survives.
   *
   * The user types "100+" and then the next number; dropping that "+" while it
   * is briefly the last character would delete the operator from under them
   * mid-keystroke.
   */
  const parts = cleaned.split(/([+\-])/).filter((p) => p !== '');

  const out: string[] = [];
  for (const part of parts) {
    if (part === '+' || part === '-') {
      out.push(part);
      continue;
    }
    out.push(groupTerm(part));
  }

  // A leading operator is meaningless — "+100" is just 100 — but a leading "-"
  // is a negative amount, which `parseAmount` already accepts, so both are
  // preserved and handled by the evaluator.
  return out
    .join(' ')
    .replace(/\s+/g, ' ')
    .trimStart();
}

/** Group one term's integer part, keeping at most two decimals. */
function groupTerm(term: string): string {
  const [rawInteger, ...rest] = term.split('.');
  const hasDot = rest.length > 0;
  const decimals = rest.join('').slice(0, 2);
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || (hasDot ? '0' : '');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return hasDot ? `${grouped}.${decimals}` : grouped;
}

/**
 * Evaluate an expression into a total and its parts.
 *
 * Returns `total: null` rather than throwing for anything unfinished, because
 * this runs on every keystroke: "100+" is a perfectly normal thing to have
 * typed a moment ago, and it should read as "no total yet", not as an error.
 */
export function evaluateAmountExpression(input: string): AmountExpression {
  const empty: AmountExpression = {
    text: typeof input === 'string' ? input : '',
    total: null,
    terms: [],
    isSum: false,
    invalid: false,
  };

  if (typeof input !== 'string' || input.trim() === '') return empty;
  if (!ALLOWED.test(input)) return { ...empty, invalid: true };

  const cleaned = input.replace(/[\s,]/g, '');
  if (cleaned === '') return empty;

  const terms: Term[] = [];
  let sign: 1 | -1 = 1;
  let current = '';

  for (const char of cleaned) {
    if (char === '+' || char === '-') {
      if (current === '') {
        /*
         * A sign with no number before it.
         *
         * Leading "-" makes the first term negative. Anything else here is a
         * double operator ("100++5"), which is a slip rather than a meaning —
         * the later sign wins, matching how a calculator behaves.
         */
        sign = char === '-' ? -1 : 1;
        continue;
      }
      terms.push({ sign, value: Number.parseFloat(current) });
      sign = char === '-' ? -1 : 1;
      current = '';
      continue;
    }
    current += char;
  }

  if (current !== '') {
    const value = Number.parseFloat(current);
    if (!Number.isFinite(value)) return { ...empty, invalid: true };
    terms.push({ sign, value });
  }

  if (terms.length === 0) return { ...empty, invalid: false };

  for (const term of terms) {
    if (!Number.isFinite(term.value)) return { ...empty, invalid: true };
  }

  /*
   * Each term is converted to minor units BEFORE summing.
   *
   * Summing in major units first would do the arithmetic in floating point and
   * round once at the end — 0.1 + 0.2 famously landing on 0.30000000000000004.
   * `toMinor` rounds each term to whole cents, so the total is the sum of what
   * the breakdown actually shows.
   */
  const minorTerms = terms.map((t) => t.sign * toMinor(t.value));
  const total = minorTerms.reduce((sum, value) => sum + value, 0);

  return {
    text: input,
    total,
    terms: minorTerms,
    isSum: terms.length > 1,
    // A trailing operator is unfinished, not invalid — the total still reads
    // from the terms typed so far.
    invalid: false,
  };
}

/**
 * The total as a plain formatted amount, for handing to `parseAmount`.
 *
 * Callers that only want the number — a save path, a validation check — use
 * this and never see the expression at all.
 */
export function amountExpressionTotal(input: string): Minor | null {
  return evaluateAmountExpression(input).total;
}

/** Whether the text is a sum rather than a single figure. */
export function isAmountSum(input: string): boolean {
  return evaluateAmountExpression(input).isSum;
}
