/**
 * Per-BANK exchange rates, and why the app needs them at all.
 *
 * The mid-market rate (what `open.er-api.com` publishes, and what every
 * currency converter shows) is not a rate anyone is actually paid at. A bank
 * receiving an inward USD remittance credits its own **telegraphic transfer
 * buying** rate, which is always below mid-market — that spread is how the bank
 * makes money on the transfer.
 *
 * The gap is not rounding. At the time of writing mid-market was 327.82 while
 * the worst bank on the board bought at 322.80: 1.5%, or about LKR 15,000 on a
 * USD 3,000 salary, every month. A user planning against mid-market is
 * budgeting money the bank is never going to give them.
 *
 * So the figure that matters is the TT buying rate *of the specific bank the
 * salary lands in*. This module holds the shape of that data and the pure
 * functions over it; the fetch lives in `bankRatesApi.ts`, and the policy for
 * choosing between this and the mid-market figure stays in
 * `~/shared/lib/exchangeRate`.
 */

/** The rate columns a Sri Lankan bank publishes. */
export interface BankRate {
  /** The bank's name AS THE SOURCE SPELLS IT — see `matchBankId`. */
  bankName: string;
  /**
   * Telegraphic transfer BUYING — what the bank pays you for an inward wire.
   *
   * The one figure this feature exists for. Null when a source lists a bank
   * without it (some publish only cash rates), which is a real state rather
   * than a zero: a missing rate must not read as "this bank pays nothing".
   */
  ttBuying: number | null;
  /** Telegraphic transfer selling — what the bank charges to send USD out. */
  ttSelling: number | null;
  /** When the source last observed this row. */
  at: string;
}

/**
 * A bank rate resolved against the app's own bank catalog.
 *
 * `bankId` is the join back to `BANKS` — and to the `bankId` a card already
 * carries, which is what lets the app say "this is YOUR salary bank" without
 * asking the user to configure anything.
 */
export interface ResolvedBankRate extends BankRate {
  /** Matching `BankBrand.id`, or null for a source bank the app has no entry for. */
  bankId: string | null;
}

/**
 * Map a source's spelling of a bank to the app's `BankBrand.id`.
 *
 * Explicit table, NOT fuzzy matching. The source's `bank_name` is free text
 * that the app does not control, and a near-miss here is silent: a bank that
 * stops matching simply shows no rate, which looks like the bank not
 * publishing one rather than like a bug. An explicit table fails loudly in
 * tests instead, and documents exactly which spellings have been seen.
 *
 * Keys are lowercased and space-collapsed so trivial punctuation drift
 * ("People's" vs "Peoples") does not need a new entry.
 */
const BANK_NAME_TO_ID: Record<string, string> = {
  'amana bank': 'amana',
  'bank of ceylon': 'boc',
  'cargills bank': 'cargills',
  'commercial bank': 'commercial',
  'commercial bank of ceylon': 'commercial',
  'dfcc bank': 'dfcc',
  'hatton national bank': 'hnb',
  hnb: 'hnb',
  hsbc: 'hsbc',
  'national development bank': 'ndb',
  'national savings bank': 'nsb',
  'nations trust bank': 'nations-trust',
  'pan asia bank': 'pan-asia',
  'peoples bank': 'peoples',
  "people's bank": 'peoples',
  'sampath bank': 'sampath',
  'seylan bank': 'seylan',
  'standard chartered': 'standard-chartered',
  'standard chartered bank': 'standard-chartered',
  'union bank': 'union',
  /*
   * Anything absent here — Wise, and any bank a source adds that the catalog
   * has not caught up with — is filtered out by `resolveBankRates` rather than
   * shown as an unbranded row. Adding one is two lines: an entry in `BANKS`
   * and a line here.
   */
};

/** Normalise a source's bank name for lookup. */
export function normaliseBankName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The app's bank id for a source's bank name, or null when it has no entry. */
export function matchBankId(bankName: string): string | null {
  return BANK_NAME_TO_ID[normaliseBankName(bankName)] ?? null;
}

/**
 * Attach `bankId` to each row, keeping only banks the app actually knows.
 *
 * An unmatched row is DROPPED rather than listed with a placeholder. The list
 * is meant to be read as "the banks you could hold an account at", and a row
 * the catalog has no entry for cannot carry a logo, cannot be matched to a
 * card, and cannot ever be the highlighted "yours" — it renders as a grey
 * "Other" tile among real brands, which reads as a rendering fault rather than
 * as a deliberate inclusion.
 *
 * The cost is that a genuinely useful non-bank (Wise, which beats every
 * licensed bank here) disappears until it earns a catalog entry. That is the
 * right trade: adding the entry is a small, deliberate act, and until then the
 * screen stays a list of things the user's accounts can actually be.
 */
export function resolveBankRates(rates: readonly BankRate[]): ResolvedBankRate[] {
  return rates
    .map((rate) => ({ ...rate, bankId: matchBankId(rate.bankName) }))
    .filter((rate): rate is ResolvedBankRate & { bankId: string } => rate.bankId !== null);
}

/**
 * Sort best-paying first.
 *
 * The list answers "who gives me the most for my dollars", so the best rate
 * belongs at the top — and a bank with no TT buying rate sorts last rather
 * than as zero, since it is unknown, not worst.
 */
export function sortByBuying(rates: readonly ResolvedBankRate[]): ResolvedBankRate[] {
  return [...rates].sort((a, b) => {
    if (a.ttBuying === null && b.ttBuying === null) return a.bankName.localeCompare(b.bankName);
    if (a.ttBuying === null) return 1;
    if (b.ttBuying === null) return -1;
    return b.ttBuying - a.ttBuying;
  });
}

/** The row for one bank id, or null when that bank published nothing. */
export function rateForBank(
  rates: readonly ResolvedBankRate[],
  bankId: string | null | undefined,
): ResolvedBankRate | null {
  if (!bankId) return null;
  return rates.find((rate) => rate.bankId === bankId && rate.ttBuying !== null) ?? null;
}

/**
 * How much USD must be converted to land a given home-currency amount.
 *
 * This is the dashboard question in reverse. "Money to move" is a rupee total,
 * but someone paid in dollars does not hold rupees — they hold dollars and a
 * bank that will convert them at a known rate. What they actually need to know
 * is how many dollars to send, and dividing by the rate is that answer.
 *
 * Rounded UP to a WHOLE DOLLAR, twice over deliberately:
 *
 *   - Up, because the exact quotient lands a hair short once the bank does its
 *     own rounding, and being short on the rent is a materially worse error
 *     than sending a little extra.
 *   - Whole dollars, because this is a figure someone retypes into a transfer
 *     form. Nobody wires $1,788.76; they wire $1,789. Cents here were spurious
 *     precision on a number that is already an estimate — the rate itself moves
 *     more between breakfast and lunch than the cents could ever represent.
 *
 * Returned in MINOR units (cents) like every other amount in the app, so the
 * value is always a whole multiple of 100.
 */
export function usdNeededFor(homeMinor: number, rate: number): number | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(homeMinor) || homeMinor <= 0) return 0;

  return Math.ceil(homeMinor / rate / 100) * 100;
}

/**
 * What one bank's rate costs or saves against the best on the board, per USD.
 *
 * Shown so the comparison is a figure rather than a ranking: "yours is 6.70
 * below the best" is actionable in a way that "yours is 12th" is not.
 */
export function gapToBest(
  rates: readonly ResolvedBankRate[],
  bankId: string | null | undefined,
): { best: ResolvedBankRate; mine: ResolvedBankRate; gap: number } | null {
  const sorted = sortByBuying(rates).filter((rate) => rate.ttBuying !== null);
  const best = sorted[0];
  const mine = rateForBank(rates, bankId);

  if (!best || !mine || best.bankId === mine.bankId) return null;

  return { best, mine, gap: Math.round((best.ttBuying! - mine.ttBuying!) * 100) / 100 };
}

/**
 * The rate the app should convert at, given what it knows.
 *
 * The salary bank's published TT buying rate IS the answer whenever there is
 * one: it is not an estimate or a preference, it is the number that bank will
 * actually credit. There was briefly a picker here offering to plan a few
 * percent under it — but a cushion is a second opinion about a fact, and it
 * made the app quietly disagree with the bank for reasons the user had to
 * re-decide every month.
 *
 * The fallback chain matters more than any of that, because the rate has to
 * resolve to SOMETHING for the board to convert at all:
 *
 *   1. Today's fetched rate for the salary bank — the truth when we have it.
 *   2. The last rate we successfully stored. Rates move by fractions of a
 *      percent day to day, so yesterday's figure is far closer than any
 *      default, and offline is the normal case for a phone.
 *   3. Whatever the user last set by hand, which is the app's existing
 *      behaviour and the floor beneath everything else.
 *
 * Returns null only when there is nothing at all to go on, which the caller
 * reads as "leave the stored rate alone".
 */
export function resolveUsdRate(options: {
  /** Today's row for the salary bank, when the fetch found one. */
  bankRate: number | null | undefined;
  /** The last bank rate successfully stored. */
  lastKnown: number | null | undefined;
}): number | null {
  const { bankRate, lastKnown } = options;

  if (Number.isFinite(bankRate) && (bankRate as number) > 0) {
    return roundRate(bankRate as number);
  }
  if (Number.isFinite(lastKnown) && (lastKnown as number) > 0) {
    return roundRate(lastKnown as number);
  }
  return null;
}

/**
 * Two decimals, which is the precision banks publish at.
 *
 * One source quotes People's Bank to four (324.3372); carrying that through
 * would render a figure no bank statement will ever match, and the extra
 * digits are below the granularity of the thing being measured.
 */
export function roundRate(rate: number): number {
  return Math.round(rate * 100) / 100;
}
