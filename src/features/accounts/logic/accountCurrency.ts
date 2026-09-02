/**
 * Per-account currency.
 *
 * The app has always had ONE currency, held as a setting and applied to every
 * figure. That is right for most people and wrong for anyone holding foreign
 * currency: a USD savings account showed its balance formatted as rupees, so
 * "1,200" read as LKR 1,200 rather than USD 1,200 — off by the exchange rate,
 * with nothing on screen to say so.
 *
 * An account now names its own currency. Everything else stays as it was: the
 * board, the totals and the reminders are all in the HOME currency, and a
 * foreign account's figures are converted into it for those sums. Only the
 * account's own balance is shown in its own currency, because that is the one
 * number the bank itself would state that way.
 */

import { convertToLocalMinor, toMajor, type Minor } from '~/shared/lib/money';

/** An account as this module needs to see it. */
export interface AccountLike {
  /** ISO code, or null/empty for an account that predates this and is local. */
  currency?: string | null;
}

/**
 * The currency an account actually holds.
 *
 * Falls back to the home currency, which is what every existing row means:
 * the column is new, so `null` is "this was created before accounts had a
 * currency" and every one of those is in the user's own money.
 */
export function accountCurrency(account: AccountLike, homeCurrency: string): string {
  const code = account.currency?.trim();
  if (code && code.length > 0) return code.toUpperCase();

  /*
   * `homeCurrency` is defaulted rather than trusted.
   *
   * Every caller reads it from store state, which is populated from settings
   * — so it is a string in the running app but can be absent in a partial
   * state (a test fixture, a store mid-hydration). Throwing there took the
   * whole dashboard down over a display detail, which is a much worse failure
   * than falling back to the app's own default currency.
   */
  return (homeCurrency || 'LKR').toUpperCase();
}

/** Whether an account holds something other than the user's home currency. */
export function isForeignAccount(account: AccountLike, homeCurrency: string): boolean {
  // Both sides through the same defaulting, so an absent home currency cannot
  // make every account read as foreign.
  return accountCurrency(account, homeCurrency) !== (homeCurrency || 'LKR').toUpperCase();
}

/**
 * An account's amount expressed in the HOME currency, for any total that mixes
 * accounts together.
 *
 * A board total that added a USD balance to a rupee one without converting
 * would be wrong by a factor of the rate — and silently, since both are just
 * integers by the time they reach a sum. Converting here keeps every
 * cross-account figure in one unit.
 *
 * Only USD converts. The app stores exactly one rate (`usdRate`), so any other
 * foreign currency has no rate to convert BY — inventing one would produce a
 * confident wrong number, which is worse than leaving the figure alone. Those
 * accounts pass through unconverted and are flagged by `needsRate` so the UI
 * can say so rather than quietly misreport.
 */
export function toHomeMinor(
  amountMinor: Minor,
  account: AccountLike,
  homeCurrency: string,
  usdRate: number,
): Minor {
  if (!isForeignAccount(account, homeCurrency)) return amountMinor;
  if (accountCurrency(account, homeCurrency) !== 'USD') return amountMinor;
  if (!Number.isFinite(usdRate) || usdRate <= 0) return amountMinor;

  return convertToLocalMinor(toMajor(amountMinor), usdRate);
}

/**
 * Whether this account's figures cannot be converted to the home currency.
 *
 * True only for a foreign account in something other than USD — the one case
 * where the app holds no rate. The UI uses it to mark a total as excluding that
 * account rather than pretending the arithmetic worked.
 */
export function needsRate(account: AccountLike, homeCurrency: string): boolean {
  const code = accountCurrency(account, homeCurrency);
  return code !== homeCurrency.toUpperCase() && code !== 'USD';
}

/**
 * Sum a set of accounts in the home currency, saying what it could not include.
 *
 * Callers were summing `toHomeMinor` themselves, which quietly added the raw
 * figure of any account the app has no rate for — a EUR 500 balance landed in a
 * rupee total as 500, while the screen said that account was excluded. The
 * label and the arithmetic disagreed, and the label was the honest one.
 *
 * Returning both halves together makes that impossible: whatever is counted and
 * whatever is left out come from one pass, so a caller cannot show one without
 * the other.
 */
export function sumInHome<T extends AccountLike>(
  entries: readonly { account: T; amountMinor: Minor }[],
  homeCurrency: string,
  usdRate: number,
): { totalMinor: Minor; excluded: number } {
  let totalMinor = 0;
  let excluded = 0;

  for (const entry of entries) {
    if (needsRate(entry.account, homeCurrency)) {
      excluded += 1;
      continue;
    }
    totalMinor += toHomeMinor(entry.amountMinor, entry.account, homeCurrency, usdRate);
  }

  return { totalMinor, excluded };
}

/**
 * The inverse of {@link toHomeMinor} — a home-currency amount expressed in what
 * a given account HOLDS.
 *
 * Needed because the two directions answer different questions. `toHomeMinor`
 * is for SUMS ACROSS accounts ("what is everything worth in rupees"). This one
 * is for a figure that belongs to ONE account and will be acted on there: the
 * board plans bills in the home currency, but "move this much onto the USD
 * account" has to be stated in dollars or it is 323× wrong.
 *
 * Same guards as its inverse, and for the same reason: an account in a currency
 * the app holds no rate for passes through unconverted rather than being
 * multiplied by a made-up number. A confidently wrong figure is worse than an
 * unconverted one the UI can flag.
 */
export function fromHomeMinor(
  amountMinor: Minor,
  account: AccountLike,
  homeCurrency: string,
  usdRate: number,
): Minor {
  // Through `isForeignAccount` rather than comparing to `homeCurrency`
  // directly, so an absent home currency is defaulted once, in one place.
  if (!isForeignAccount(account, homeCurrency)) return amountMinor;
  if (accountCurrency(account, homeCurrency) !== 'USD') return amountMinor;
  if (!Number.isFinite(usdRate) || usdRate <= 0) return amountMinor;

  return Math.round(amountMinor / usdRate);
}
