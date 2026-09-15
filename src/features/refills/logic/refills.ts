/**
 * How long a thing lasts, and what it costs over time.
 *
 * ## Why this exists
 *
 * A 12.5kg gas cylinder is bought, used for some months, and replaced. The
 * question worth answering is not what it cost — the receipt says that — but
 * **how long it lasted**, and whether that is changing. Two cylinders ago it
 * went four months; the last one went ten weeks. Something changed, and no
 * expense list will ever show it, because an expense list is sorted by money.
 *
 * The same shape covers a water bottle, a filter cartridge, a bag of rice, a
 * contact-lens box, printer toner. All of them are "a thing you replace, and
 * the gap between replacements is the interesting number". So the module is
 * written once around that gap and the item is just a name and a unit.
 *
 * ## The model
 *
 * One event: **a refill**. It says "I replaced it on this date, for this
 * price". Nothing else is asked for, because anything else is a field the user
 * has to remember to fill in, and a tracker that needs maintenance stops being
 * used by the third cylinder.
 *
 * A **span** is derived, never entered: the stretch between one refill and the
 * next. This is the only place duration comes from, and it is why the first
 * refill of an item reports nothing — a single date is not a duration. That is
 * the same rule `spendHistory` applies to a one-month chart, for the same
 * reason: a lone data point invites a trend reading it cannot support.
 *
 * ## What is deliberately NOT here
 *
 * No draining quantity, no readings, no "how much is left". Measuring a
 * half-empty cylinder means weighing it, nobody does that twice, and a
 * half-maintained gauge is worse than no gauge because it looks authoritative.
 * The gap between refills is measured for free by the act of refilling.
 */

import type { Minor } from '~/shared/lib/money';

/** One replacement of the item. */
export interface Refill {
  id: string;
  /** When it was swapped or bought. */
  filledOn: Date;
  /**
   * What it cost, in minor units. Nullable because the price history is a
   * bonus, not the point — a refill with no price still measures a duration,
   * and refusing to save one without a figure would lose that.
   */
  priceMinor?: Minor | null;
  note?: string | null;
}

/** An item being tracked: a gas cylinder, a water bottle, a filter. */
export interface TrackedItem {
  id: string;
  name: string;
  /**
   * What one unit IS — "12.5kg cylinder", "20L bottle". Free text shown beside
   * the name, never parsed. The app has no business knowing what a kilogram is
   * here; the user is tracking "one of these", whatever it is.
   */
  unitLabel?: string | null;
  /**
   * The user's own expectation, in days, when they have one.
   *
   * Used only to say "this one is running short" before the replacement
   * happens. Null means no expectation, and then nothing is ever predicted
   * from a guess — see `nextDue`, which prefers measured history over this.
   */
  expectedDays?: number | null;
  archived?: boolean;
}

/** One measured stretch: from one refill to the next. */
export interface RefillSpan {
  /** The refill that OPENED the span — the figure is reported against it. */
  id: string;
  from: Date;
  to: Date;
  /** Whole days the item lasted. */
  days: number;
  /**
   * What the item cost for that stretch — the price of the refill that opened
   * it, which is the one that was consumed over these days.
   */
  costMinor: Minor | null;
  /** Cost per day, when a price is known. The comparable figure across items. */
  costPerDayMinor: number | null;
}

const MS_PER_DAY = 86_400_000;

/** Midnight-to-midnight day count, so a time of day never shifts the answer. */
function wholeDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/** Oldest first. Date is the only ordering this data has. */
function inOrder(refills: readonly Refill[]): Refill[] {
  return [...refills].sort((a, b) => a.filledOn.getTime() - b.filledOn.getTime());
}

/**
 * Every completed span, oldest first.
 *
 * The LAST refill never produces a span: the item bought then is still in use,
 * so its duration is not known yet. Reporting it as a short span would drag
 * every average down by exactly one partial period — the most common way a
 * tracker like this quietly lies.
 *
 * Same-day duplicates are skipped rather than reported as zero-day spans. Two
 * refills on one date is a double entry or a second unit bought at once;
 * neither means "it lasted no time at all", and a zero would poison the mean.
 */
export function refillSpans(refills: readonly Refill[]): RefillSpan[] {
  const ordered = inOrder(refills);
  const spans: RefillSpan[] = [];

  for (let i = 0; i < ordered.length - 1; i++) {
    const opened = ordered[i];
    const closed = ordered[i + 1];
    const days = wholeDaysBetween(opened.filledOn, closed.filledOn);
    if (days <= 0) continue;

    const costMinor = opened.priceMinor ?? null;
    spans.push({
      id: opened.id,
      from: opened.filledOn,
      to: closed.filledOn,
      days,
      costMinor,
      costPerDayMinor: costMinor === null ? null : costMinor / days,
    });
  }

  return spans;
}

/** The headline figures for one item. */
export interface RefillStats {
  /** Completed spans the figures are drawn from. */
  spanCount: number;
  /** Mean days per unit across every completed span, or null with none. */
  averageDays: number | null;
  /** Shortest and longest completed span, for the range. */
  shortestDays: number | null;
  longestDays: number | null;
  /** Mean cost per day, across spans that had a price. */
  averageCostPerDayMinor: number | null;
  /**
   * Mean of every PRICED refill — the item's normal price.
   *
   * Distinct from `lastPriceMinor`, which is what you paid most recently: a
   * single unusual purchase moves the last price entirely but the average
   * barely, so comparing a row against the mean says whether it was a good buy
   * rather than merely whether it differed from the one before.
   */
  averagePriceMinor: Minor | null;
  /** What the most recent priced refill cost — "the current price". */
  lastPriceMinor: Minor | null;
  /** The most recent refill date, which is when the current unit started. */
  lastFilledOn: Date | null;
  /** Days the current unit has been in use, or null before the first refill. */
  daysOnCurrent: number | null;
  /** Total spent across every priced refill. */
  totalSpentMinor: Minor;
}

export function refillStats(refills: readonly Refill[], now: Date = new Date()): RefillStats {
  const ordered = inOrder(refills);
  const spans = refillSpans(refills);
  const last = ordered.length > 0 ? ordered[ordered.length - 1] : null;

  const durations = spans.map((span) => span.days);
  const perDay = spans
    .map((span) => span.costPerDayMinor)
    .filter((value): value is number => value !== null);

  /*
   * The "current price" walks BACKWARDS to the newest refill that has one,
   * rather than reading the last refill blindly. A price left blank on the most
   * recent swap should fall back to the last one actually paid, not report the
   * item as having no known price at all.
   */
  const lastPriced = [...ordered].reverse().find((r) => (r.priceMinor ?? null) !== null);
  /** Every figure actually recorded — unpriced refills contribute nothing. */
  const pricedAmounts = ordered
    .map((r) => r.priceMinor ?? null)
    .filter((v): v is Minor => v !== null);

  return {
    spanCount: spans.length,
    averageDays: durations.length > 0 ? mean(durations) : null,
    shortestDays: durations.length > 0 ? Math.min(...durations) : null,
    longestDays: durations.length > 0 ? Math.max(...durations) : null,
    averageCostPerDayMinor: perDay.length > 0 ? mean(perDay) : null,
    averagePriceMinor:
      pricedAmounts.length > 0 ? Math.round(mean(pricedAmounts)) : null,
    lastPriceMinor: lastPriced?.priceMinor ?? null,
    lastFilledOn: last?.filledOn ?? null,
    daysOnCurrent: last ? Math.max(0, wholeDaysBetween(last.filledOn, now)) : null,
    totalSpentMinor: ordered.reduce((sum, r) => sum + (r.priceMinor ?? 0), 0),
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** When the current unit is expected to run out, and how sure we are. */
export interface NextDue {
  /** The projected date. */
  on: Date;
  /** Days from `now` — negative once it is overdue. */
  inDays: number;
  /**
   * Where the projection came from.
   *
   * `measured` means the item's own history; `expected` means the user's stated
   * guess, used only until there is history to beat it. The UI says which, so a
   * date derived from one span is never presented with the authority of six.
   */
  basis: 'measured' | 'expected';
  /**
   * True while the estimate rests on a single span. One observation is a data
   * point, not a pattern, and the card is worded more softly when this is set.
   */
  provisional: boolean;
}

/**
 * Project the next replacement, or null when there is nothing honest to say.
 *
 * Measured history always beats the user's expectation once it exists: people
 * guess "a cylinder lasts three months" and are routinely wrong, and the whole
 * value of the tracker is replacing that guess with what actually happened.
 *
 * Null when there is neither history nor an expectation — the card then shows
 * how long the current unit has been running and nothing more, which is the
 * truthful state for a freshly created item.
 */
export function nextDue(
  refills: readonly Refill[],
  item: Pick<TrackedItem, 'expectedDays'>,
  now: Date = new Date(),
): NextDue | null {
  const stats = refillStats(refills, now);
  if (!stats.lastFilledOn) return null;

  const measured = stats.averageDays;
  const expected = item.expectedDays && item.expectedDays > 0 ? item.expectedDays : null;

  const days = measured ?? expected;
  if (days === null) return null;

  const on = new Date(stats.lastFilledOn.getTime());
  on.setDate(on.getDate() + Math.round(days));

  return {
    on,
    inDays: wholeDaysBetween(now, on),
    basis: measured !== null ? 'measured' : 'expected',
    provisional: measured !== null && stats.spanCount < 2,
  };
}

/**
 * How the price has moved, oldest first — one point per PRICED refill.
 *
 * Unpriced refills are dropped rather than plotted as zero, which would draw a
 * cliff to the axis and read as "it became free". A gap in the line is honest;
 * a zero is not.
 */
export interface PricePoint {
  id: string;
  on: Date;
  priceMinor: Minor;
  /** Change from the previous priced refill — null for the first. */
  changeMinor: Minor | null;
  changePct: number | null;
}

export function priceHistory(refills: readonly Refill[]): PricePoint[] {
  const priced = inOrder(refills).filter(
    (r): r is Refill & { priceMinor: Minor } => (r.priceMinor ?? null) !== null,
  );

  return priced.map((refill, index) => {
    const previous = index > 0 ? priced[index - 1] : null;
    return {
      id: refill.id,
      on: refill.filledOn,
      priceMinor: refill.priceMinor,
      changeMinor: previous ? refill.priceMinor - previous.priceMinor : null,
      changePct:
        previous && previous.priceMinor > 0
          ? Math.round(((refill.priceMinor - previous.priceMinor) / previous.priceMinor) * 100)
          : null,
    };
  });
}

/**
 * The fewest spans worth charting duration.
 *
 * Two, matching `MIN_MONTHS_FOR_CHART` in the budget history for the same
 * reason: one bar is a number, and drawing it as a chart implies a trend that
 * a single observation cannot support.
 */
export const MIN_SPANS_FOR_CHART = 2;

/** A bar in the "how long each one lasted" chart. */
export interface DurationBar {
  id: string;
  days: number;
  /** Height as a fraction of the longest span, 0-1. */
  fraction: number;
  /** Short label for the axis — the month the span started ("Feb"). */
  label: string;
  /** How this span compares with the average of the window. */
  vsAverage: 'above' | 'about' | 'below';
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Spans as drawable bars, or empty when there are too few to chart.
 *
 * Heights are relative to the LONGEST span, so an unusually good cylinder reads
 * as the outlier it is rather than pinning every bar to the top.
 */
export function durationBars(spans: readonly RefillSpan[]): DurationBar[] {
  if (spans.length < MIN_SPANS_FOR_CHART) return [];

  const peak = Math.max(...spans.map((span) => span.days), 0);
  const average = mean(spans.map((span) => span.days));
  /** Within 5% of the mean is an ordinary run, not a deviation. */
  const band = average * 0.05;

  return spans.map((span) => ({
    id: span.id,
    days: span.days,
    fraction: peak > 0 ? span.days / peak : 0,
    label: MONTHS[span.from.getMonth()],
    vsAverage:
      span.days > average + band
        ? ('above' as const)
        : span.days < average - band
          ? ('below' as const)
          : ('about' as const),
  }));
}

/** How the current unit is doing against what this item usually manages. */
export type RefillStatus = 'fresh' | 'due-soon' | 'overdue' | 'unknown';

/**
 * Within this many days of the projection, the item reads as "due soon".
 *
 * A week: long enough to buy a replacement before running out, short enough
 * that the warning is not permanently on screen.
 */
export const DUE_SOON_DAYS = 7;

export function refillStatus(due: NextDue | null): RefillStatus {
  if (!due) return 'unknown';
  if (due.inDays < 0) return 'overdue';
  return due.inDays <= DUE_SOON_DAYS ? 'due-soon' : 'fresh';
}

/**
 * "3 months 14 days", "12 days" — a duration a person would say out loud.
 *
 * Months are approximated at 30 days on purpose. This reports how long a gas
 * cylinder lasted, where "about three and a half months" is the useful answer
 * and calendar-exact month arithmetic would be false precision.
 */
export function describeDays(days: number): string {
  if (days < 0) return '—';
  if (days < 31) return `${days} ${days === 1 ? 'day' : 'days'}`;

  const months = Math.floor(days / 30);
  const rest = days % 30;
  const monthPart = `${months} ${months === 1 ? 'month' : 'months'}`;
  if (rest === 0) return monthPart;
  return `${monthPart} ${rest} ${rest === 1 ? 'day' : 'days'}`;
}

/**
 * The add-on's colour, in one place.
 *
 * Every screen, chart and icon tile in the tracker draws from these. They were
 * literals scattered across five files, which is how the palette drifts: a
 * colour gets changed in the registry and three tinted backgrounds keep the old
 * one. `TRACKER_TINT` is the same hue at the low alpha the tiles and chips use.
 */
export const TRACKER_COLOR = '#7C3AED';
export const TRACKER_COLOR_SOFT = '#9F67F0';
export const TRACKER_TINT = 'rgba(124,58,237,0.12)';

/** A tracked item that needs replacing, for the dashboard's reminder list. */
export interface TrackerReminder {
  itemId: string;
  name: string;
  unitLabel: string | null;
  icon: string | null;
  /** Negative once the projected date has passed. */
  daysUntil: number;
  on: Date;
  status: Extract<RefillStatus, 'due-soon' | 'overdue'>;
  /** True while the projection rests on a single span — worded more softly. */
  provisional: boolean;
}

/**
 * Items due for replacement, soonest first.
 *
 * ## Why only measured projections reach the dashboard
 *
 * An item still running on the user's own guess (`basis: 'expected'`) is NOT
 * reported here. The dashboard is where the app tells you something you did not
 * already know; repeating your own estimate back at you as a warning is noise,
 * and it would fire on every item the day it was created. Once there is real
 * history the projection is the app's, and worth surfacing.
 *
 * Fresh items are dropped too — the list is things needing action, so an item
 * with two months left does not belong on it.
 */
export function trackerReminders(
  items: readonly (TrackedItem & { id: string })[],
  refillsByItem: ReadonlyMap<string, readonly Refill[]>,
  now: Date = new Date(),
): TrackerReminder[] {
  const due: TrackerReminder[] = [];

  for (const item of items) {
    if (item.archived) continue;

    const refills = refillsByItem.get(item.id) ?? [];
    const projection = nextDue(refills, item, now);
    if (!projection) continue;
    // The user's own guess is not news. See the note above.
    if (projection.basis !== 'measured') continue;

    const status = refillStatus(projection);
    if (status !== 'due-soon' && status !== 'overdue') continue;

    due.push({
      itemId: item.id,
      name: item.name,
      unitLabel: item.unitLabel ?? null,
      icon: (item as { icon?: string | null }).icon ?? null,
      daysUntil: projection.inDays,
      on: projection.on,
      status,
      provisional: projection.provisional,
    });
  }

  return due.sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * How one entry compares with the one BEFORE it.
 *
 * Deliberately against the previous entry rather than the average: the question
 * a reader asks scanning a timeline is "was this one better or worse than the
 * last?", and an average answers a different question they did not ask. The
 * average already appears once, in the summary sentence above the list.
 */
export interface RefillComparison {
  /** Days this one lasted minus the previous — null for the oldest entry. */
  daysDelta: number | null;
  /** Price change against the previous PRICED entry, in minor units. */
  priceDelta: Minor | null;
  /**
   * The verdict against the PREVIOUS entry, for the delta chip.
   *
   * `good` lasted meaningfully longer, `bad` meaningfully shorter, `same`
   * within the tolerance band. Null when there is nothing to compare against.
   */
  verdict: 'good' | 'bad' | 'same' | null;
  /**
   * The verdict against the AVERAGE of every completed span.
   *
   * A different question from `verdict`, and the one that colours the row: "was
   * this a good one?" is asked of the item's own norm, not of whichever entry
   * happened to precede it. Two mediocre runs in a row would both read as
   * `same` against each other while being plainly below average.
   *
   * Never null once there is a completed span — every span has an average to be
   * measured against, including the only one, which is trivially `about`.
   */
  vsAverage: 'above' | 'about' | 'below';
  /**
   * Days this one ran against the AVERAGE span — the amount behind
   * `vsAverage`, so a row can say "12 days more than usual" rather than only
   * being tinted green.
   */
  daysVsAverage: number | null;
  /**
   * What this one cost against the average price. Null when the refill has no
   * price, or when nothing else does — there is then no norm to compare with.
   */
  priceVsAverage: Minor | null;
}

/**
 * Within this fraction either way counts as "the same".
 *
 * 10%: on a three-month cylinder that is about ten days, which is ordinary
 * variation in how much cooking happened. Without a band every row would be
 * coloured green or red on arithmetic noise alone, and colour that always fires
 * carries no information.
 */
const SAME_BAND = 0.1;

/**
 * Compare each span with its predecessor, keyed by the refill that opened it.
 *
 * Returned as a map so the list can look up a row in O(1) rather than scanning,
 * and so a refill with no completed span (the one still in use) simply has no
 * entry instead of a fabricated one.
 */
export function refillComparisons(
  refills: readonly Refill[],
): Map<string, RefillComparison> {
  const spans = refillSpans(refills);

  /*
   * The mean every row is judged against.
   *
   * Computed over completed spans only — the one still in use has not finished
   * and would drag the average down by a partial period, which is the same
   * mistake `refillSpans` exists to avoid.
   */
  const average =
    spans.length > 0 ? spans.reduce((sum, sp) => sum + sp.days, 0) / spans.length : 0;
  const averageBand = average * SAME_BAND;

  /** The mean price, for the per-row price gap. Null when nothing is priced. */
  const pricedValues = refills
    .map((r) => r.priceMinor ?? null)
    .filter((v): v is Minor => v !== null);
  const averagePrice =
    pricedValues.length > 0
      ? Math.round(pricedValues.reduce((a, b) => a + b, 0) / pricedValues.length)
      : null;
  const priced = inOrder(refills).filter(
    (r): r is Refill & { priceMinor: Minor } => (r.priceMinor ?? null) !== null,
  );

  const out = new Map<string, RefillComparison>();

  spans.forEach((span, index) => {
    const previous = index > 0 ? spans[index - 1] : null;
    const daysDelta = previous ? span.days - previous.days : null;

    /*
     * The price comparison walks the PRICED list, not the span list: a refill
     * saved without a figure must not read as "the price dropped to nothing",
     * it simply has no price comparison at all.
     */
    const priceIndex = priced.findIndex((r) => r.id === span.id);
    const priceDelta =
      priceIndex > 0 ? priced[priceIndex].priceMinor - priced[priceIndex - 1].priceMinor : null;

    let verdict: RefillComparison['verdict'] = null;
    if (previous && previous.days > 0) {
      const ratio = Math.abs(daysDelta!) / previous.days;
      verdict = ratio <= SAME_BAND ? 'same' : daysDelta! > 0 ? 'good' : 'bad';
    }

    /*
     * Against the average, using the same 10% band as the previous-entry
     * comparison so the two verdicts cannot disagree about what counts as a
     * meaningful difference.
     */
    const vsAverage: RefillComparison['vsAverage'] =
      span.days > average + averageBand
        ? 'above'
        : span.days < average - averageBand
          ? 'below'
          : 'about';

    /*
     * The amounts behind the verdicts. `priceVsAverage` is measured on the
     * refill that OPENED the span — the unit actually consumed over those days
     * — which is the same row the duration describes.
     */
    const ownPrice = refills.find((r) => r.id === span.id)?.priceMinor ?? null;
    const priceVsAverage =
      ownPrice !== null && averagePrice !== null ? ownPrice - averagePrice : null;

    out.set(span.id, {
      daysDelta,
      priceDelta,
      verdict,
      vsAverage,
      daysVsAverage: Math.round(span.days - average),
      priceVsAverage,
    });
  });

  return out;
}

/**
 * How much room is left, as a traffic light.
 *
 * `refillStatus` answers a different question — it drives whether an item
 * appears on the dashboard at all, so it has only "soon or not". A countdown
 * the user is looking at wants the middle band too: comfortable, getting close,
 * nearly out, gone.
 */
export type RefillRunway = 'plenty' | 'getting-close' | 'nearly-out' | 'out';

/** Inside this many days the countdown turns amber. */
export const GETTING_CLOSE_DAYS = 21;

export function refillRunway(due: NextDue | null): RefillRunway | null {
  if (!due) return null;
  if (due.inDays < 0) return 'out';
  if (due.inDays <= DUE_SOON_DAYS) return 'nearly-out';
  return due.inDays <= GETTING_CLOSE_DAYS ? 'getting-close' : 'plenty';
}
