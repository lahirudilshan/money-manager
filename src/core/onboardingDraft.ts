/**
 * Making an in-progress onboarding draft survive the app closing.
 *
 * ## Why this exists
 *
 * The draft store (store/useOnboardingDraft.ts) is deliberately in-memory:
 * nothing reaches SQLite until the plan is confirmed, so abandoning setup
 * leaves no half-built categories behind. That is the right call and this does
 * not change it.
 *
 * What it cost, though, was everything typed so far. Onboarding is the longest
 * uninterrupted stretch of input the app ever asks for — pick your bills, then
 * set an amount and a due day on each — and a phone call, a low-memory kill or
 * an accidental swipe away lost the lot, with no way back but to start again.
 *
 * So the DRAFT is persisted, not the plan. One settings row holds a snapshot of
 * what has been picked and typed; the board is still written only on confirm.
 *
 * ## Why serialisation needs its own module
 *
 * The store keeps `picked` as a `Set` and `lines` as a `Map`, because that is
 * what the UI wants — membership tests and keyed lookup. Neither survives
 * `JSON.stringify`: a Set becomes `{}` and a Map becomes `{}`, silently. So the
 * snapshot is a plain shape, and converting is a pure function that can be
 * tested without a database or a React tree.
 */

import type { Minor } from './money';

/**
 * One picked line, with the settings step 3 lets the user adjust.
 *
 * Defined HERE rather than in the store, because the store imports this module
 * to serialise and this module needs the shape — a cycle that left
 * `useOnboardingDraft` undefined at runtime while typechecking cleanly, since
 * `import type` erases but the value import back the other way did not.
 */
export interface DraftLine {
  /** Catalog subcategory id — also the draft's stable key. */
  id: string;
  name: string;
  categoryId: string;
  icon: string;
  type: 'income' | 'expense';
  plannedMinor: Minor;
  dueDay: number;
  /** Includes `unplanned` — a house line accumulates its bills. */
  frequency: 'monthly' | 'one_time' | 'yearly' | 'unplanned';
  /** Account this line is funded from; null means "use the category default". */
  cardId: string | null;
  /**
   * Currency the amount was entered in.
   *
   * Not income-only: a software subscription is billed in USD as routinely as a
   * freelance payment is received in it, and forcing the user to convert by hand
   * meant the figure drifted with the rate. Expenses carry the same pair.
   */
  currency: 'local' | 'usd';
  /** Amount as typed when `currency` is 'usd'; null for local-currency lines. */
  foreignAmount: number | null;
  /**
   * "Save up for it monthly" on a yearly line — vehicle insurance, above all.
   *
   * A yearly bill entered as one big figure lands as a shock in the month it
   * falls due; the same line with a plan sets aside a twelfth each month and the
   * board stays honest. Onboarding offers this for the same reason the
   * subcategory editor does, so a plan built here does not have to be rebuilt
   * line by line afterwards.
   *
   * Null when the user has not asked for one. Only meaningful on `yearly`.
   */
  planTargetMinor: Minor | null;
  /** ISO date the yearly bill falls due; null when there is no plan. */
  planDueDate: string | null;
}

/**
 * A draft as stored — plain arrays only.
 *
 * `version` is here so a future change to `DraftLine` can be detected and the
 * stale draft discarded rather than restored into a shape the app no longer
 * understands. Discarding costs the user a re-pick; restoring a wrong shape
 * costs them a broken plan they then have to unpick.
 */
export interface StoredDraft {
  version: number;
  /** Step 1's bank ticks. */
  banks: string[];
  /** Step 2's answers, or null before that step is reached. */
  /*
   * `transport` is `string[]` now that the question is multi-select, but a
   * draft saved by an older build holds a bare string. Both are accepted here
   * and normalised by `normaliseTransport` on the way out, so an interrupted
   * setup that spans an app update does not lose the answer.
   */
  answers: { household: string[]; transport: string | string[]; birthYear: string } | null;
  /** Catalog ids the user ticked. */
  picked: string[];
  /** Per-line settings, as `[catalogId, line]` pairs. */
  lines: [string, DraftLine][];
  /** Explicit display order from step 3's drag-and-drop. */
  order: string[];
  /** When it was last written, for the "you were setting up" line. */
  savedAt: string;
}

/**
 * Bumped when `DraftLine` changes shape in a way an old draft cannot fill.
 *
 * 2: lines gained `planTargetMinor`/`planDueDate` (save-up plans on yearly
 * lines) and currency became meaningful on expenses, not just income.
 */
export const DRAFT_VERSION = 2;

/**
 * Read a stored `transport` answer as the array the app now uses.
 *
 * The question became multi-select after drafts already existed in the wild,
 * and those hold a bare string ('car'). Rather than bump `DRAFT_VERSION` — which
 * throws away the user's whole half-finished setup for a field that widened
 * compatibly — the old shape is accepted and lifted into an array.
 *
 * 'none' is the absence of a vehicle rather than a vehicle, so it never
 * survives into the array; an empty result means exactly that.
 */
export function normaliseTransport(value: string | string[] | null | undefined): string[] {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return list.filter((entry) => typeof entry === 'string' && entry !== 'none');
}

/** The live store's shape, narrowed to what a snapshot needs. */
export interface DraftSnapshotInput {
  banks: string[];
  /*
   * `transport` is `string[]` now that the question is multi-select, but a
   * draft saved by an older build holds a bare string. Both are accepted here
   * and normalised by `normaliseTransport` on the way out, so an interrupted
   * setup that spans an app update does not lose the answer.
   */
  answers: { household: string[]; transport: string | string[]; birthYear: string } | null;
  picked: Set<string>;
  lines: Map<string, DraftLine>;
  order: string[];
}

/** Flatten the live store into something `JSON.stringify` keeps. */
export function toStoredDraft(
  state: DraftSnapshotInput,
  now = new Date(),
): StoredDraft {
  return {
    version: DRAFT_VERSION,
    banks: state.banks,
    answers: state.answers,
    picked: [...state.picked],
    lines: [...state.lines.entries()],
    order: state.order,
    savedAt: now.toISOString(),
  };
}

/**
 * Read a stored draft back, or null when it cannot be trusted.
 *
 * Every failure mode returns null rather than throwing, because the caller's
 * response is identical in each case: start onboarding clean. A draft is a
 * convenience, so a damaged one must never be the reason the app cannot open.
 */
export function parseStoredDraft(raw: string | null | undefined): StoredDraft | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;

    // A draft from a build whose `DraftLine` had different fields would restore
    // lines missing an amount or a due day — worse than asking again.
    if (parsed?.version !== DRAFT_VERSION) return null;

    if (!Array.isArray(parsed.picked) || !Array.isArray(parsed.lines)) return null;

    return {
      version: DRAFT_VERSION,
      banks: Array.isArray(parsed.banks)
        ? parsed.banks.filter((id): id is string => typeof id === 'string')
        : [],
      // Kept only when it is a real object — a half-written answers block would
      // otherwise restore as `{}` and read as "answered, with nothing".
      answers:
        parsed.answers && typeof parsed.answers === 'object' && Array.isArray(parsed.answers.household)
          ? parsed.answers
          : null,
      picked: parsed.picked.filter((id): id is string => typeof id === 'string'),
      /*
       * Each entry must be a real `[id, line]` pair.
       *
       * A truncated write — the app killed mid-save — can leave valid JSON
       * with a half-written array in it, and a `[id, undefined]` pair would
       * restore a line the rest of the app then dereferences.
       */
      lines: parsed.lines.filter(
        (entry): entry is [string, DraftLine] =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === 'string' &&
          entry[1] !== null &&
          typeof entry[1] === 'object',
      ),
      order: Array.isArray(parsed.order)
        ? parsed.order.filter((id): id is string => typeof id === 'string')
        : [],
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Whether a restored draft actually holds anything worth resuming.
 *
 * Onboarding writes on every change, including the change that empties the
 * selection — so a user who ticked one line and unticked it leaves a valid but
 * empty draft. Resuming into that is indistinguishable from starting fresh, and
 * an empty draft should not survive to make the app think otherwise.
 */
export function hasContent(draft: StoredDraft | null): boolean {
  if (draft === null) return false;

  /*
   * Any of the three counts as progress.
   *
   * Picked lines were the only test while this covered step 3 alone, which
   * meant someone killed on step 1 or 2 — banks ticked, questions answered,
   * nothing picked yet — restored as empty and started over. Those are exactly
   * the steps that felt worst to redo.
   */
  return draft.picked.length > 0 || draft.banks.length > 0 || draft.answers !== null;
}

export function serialiseDraft(state: DraftSnapshotInput, now = new Date()): string {
  return JSON.stringify(toStoredDraft(state, now));
}
