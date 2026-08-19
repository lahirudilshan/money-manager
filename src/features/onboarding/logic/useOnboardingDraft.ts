import { create } from 'zustand';
import { CATALOG_SUBCATEGORY_BY_ID, CATEGORY_CATALOG } from '~/shared/data/categoryCatalog';
import type { Minor } from '~/shared/lib/money';
import { hasContent, parseStoredDraft, serialiseDraft } from '~/features/onboarding/logic/onboardingDraft';
// Re-exported so the many screens importing `DraftLine` from here keep working;
// it lives in core to keep this module out of an import cycle.
export type { DraftLine } from '~/features/onboarding/logic/onboardingDraft';
import type { DraftLine } from '~/features/onboarding/logic/onboardingDraft';
import { settingsRepo, SETTINGS_KEYS } from '~/db/repositories';

/**
 * Scratch state for onboarding steps 2 and 3.
 *
 * Nothing is written to SQLite until the plan is confirmed at the end of step
 * 3, so abandoning onboarding halfway leaves no partial categories behind and
 * stepping backwards never has to undo database writes. Once committed, this
 * store is cleared and the app store becomes the only source of truth.
 */


interface OnboardingDraftState {
  /**
   * Step 1's bank/wallet ticks, and step 2's answers about the household.
   *
   * These lived in each screen's own `useState`, so they were the two things a
   * mid-setup kill still lost: the banks had to be re-ticked, and the three
   * "about you" questions re-answered. They are plain values that already
   * serialise, so they ride along in the same snapshot as the picked lines.
   *
   * `answers` is typed loosely on purpose — it is written and read only by
   * about.tsx, and importing the persona types here would couple the store to
   * a screen's shape for no gain.
   */
  banks: string[];
  answers: { household: string[]; transport: string | string[]; birthYear: string } | null;

  picked: Set<string>;
  /** Per-line settings, keyed by catalog id. Populated on first pick. */
  lines: Map<string, DraftLine>;
  /** Explicit ordering across all picked lines, set by drag-and-drop in step 3. */
  order: string[];

  setBanks: (ids: string[]) => void;
  setAnswers: (answers: { household: string[]; transport: string[]; birthYear: string }) => void;
  toggle: (catalogId: string) => void;
  pickAll: (catalogIds: string[], select: boolean) => void;
  updateLine: (catalogId: string, patch: Partial<DraftLine>) => void;
  setOrder: (orderedIds: string[]) => void;
  removeLine: (catalogId: string) => void;
  reset: () => void;
  /** Restore a saved draft, if one survived the app closing. Returns whether
   *  anything was restored, so the caller can resume at the right step. */
  restore: () => boolean;

  /** Picked lines in display order, grouped ready for commit. */
  orderedLines: () => DraftLine[];
}

/** Build a draft line from its catalog definition, applying catalog defaults. */
function lineFromCatalog(catalogId: string): DraftLine | null {
  const entry = CATALOG_SUBCATEGORY_BY_ID.get(catalogId);
  if (!entry) return null;

  const { category, subcategory } = entry;
  return {
    id: subcategory.id,
    name: subcategory.name,
    categoryId: category.id,
    icon: subcategory.icon,
    type: subcategory.type ?? 'expense',
    plannedMinor: 0,
    // Income tends to land late in the month; expenses default to the 1st.
    dueDay: subcategory.dueDay ?? (subcategory.type === 'income' ? 25 : 1),
    frequency: subcategory.frequency ?? 'monthly',
    cardId: null,
    currency: 'local',
    foreignAmount: null,
    // No plan until the user asks for one — see `DraftLine.planTargetMinor`.
    planTargetMinor: null,
    planDueDate: null,
  };
}

/** Catalog order — the fallback ordering before the user drags anything. */
const CATALOG_ORDER = CATEGORY_CATALOG.flatMap((category) =>
  category.subcategories.map((subcategory) => subcategory.id),
);

export const useOnboardingDraft = create<OnboardingDraftState>((set, get) => ({
  banks: [],
  answers: null,
  picked: new Set(),
  lines: new Map(),
  order: [],

  setBanks(ids) {
    set({ banks: ids });
  },

  setAnswers(answers) {
    set({ answers });
  },

  toggle(catalogId) {
    const { picked, lines, order } = get();
    const nextPicked = new Set(picked);
    const nextLines = new Map(lines);
    let nextOrder = [...order];

    if (nextPicked.has(catalogId)) {
      nextPicked.delete(catalogId);
      // Settings are kept, so re-picking a line restores what was typed.
      nextOrder = nextOrder.filter((id) => id !== catalogId);
    } else {
      nextPicked.add(catalogId);
      if (!nextLines.has(catalogId)) {
        const line = lineFromCatalog(catalogId);
        if (line) nextLines.set(catalogId, line);
      }
      nextOrder.push(catalogId);
    }

    set({ picked: nextPicked, lines: nextLines, order: nextOrder });
  },

  pickAll(catalogIds, select) {
    const { picked, lines, order } = get();
    const nextPicked = new Set(picked);
    const nextLines = new Map(lines);
    let nextOrder = [...order];

    for (const catalogId of catalogIds) {
      if (select) {
        if (!nextPicked.has(catalogId)) {
          nextPicked.add(catalogId);
          nextOrder.push(catalogId);
        }
        if (!nextLines.has(catalogId)) {
          const line = lineFromCatalog(catalogId);
          if (line) nextLines.set(catalogId, line);
        }
      } else {
        nextPicked.delete(catalogId);
      }
    }

    if (!select) nextOrder = nextOrder.filter((id) => nextPicked.has(id));

    set({ picked: nextPicked, lines: nextLines, order: nextOrder });
  },

  updateLine(catalogId, patch) {
    const nextLines = new Map(get().lines);
    const current = nextLines.get(catalogId);
    if (!current) return;
    nextLines.set(catalogId, { ...current, ...patch });
    set({ lines: nextLines });
  },

  setOrder(orderedIds) {
    set({ order: orderedIds });
  },

  removeLine(catalogId) {
    const { picked, order } = get();
    const nextPicked = new Set(picked);
    nextPicked.delete(catalogId);
    set({ picked: nextPicked, order: order.filter((id) => id !== catalogId) });
  },

  reset() {
    set({ banks: [], answers: null, picked: new Set(), lines: new Map(), order: [] });
    // Clearing the store must clear the saved copy too, or the next launch
    // would resurrect a plan the user just committed or abandoned.
    settingsRepo.set(SETTINGS_KEYS.onboardingDraft, '');
  },

  /**
   * Reload whatever was saved mid-setup.
   *
   * Returns false for "nothing worth resuming", which covers a missing key, a
   * draft from an older shape, and a valid-but-empty one — see `hasContent`.
   * The caller treats all three the same way: start clean.
   */
  /**
   * Restore ONCE, on whichever screen reads the draft first.
   *
   * Timing is the whole difficulty here. Restoring in the onboarding layout's
   * `useEffect` was too late — effects run after children mount, so every
   * screen's `useState` initialiser had already read an empty draft and then
   * overwritten the saved one with its defaults. Restoring at module scope was
   * too early: this module and the SQLite handle are both initialised at
   * import, so which one wins depends on import order.
   *
   * Doing it lazily on first access removes the ordering question entirely —
   * by the time any screen asks for the draft, the database is certainly open.
   */
  restore() {
    const stored = parseStoredDraft(settingsRepo.get(SETTINGS_KEYS.onboardingDraft));
    if (!hasContent(stored)) return false;

    set({
      // `banks` and `answers` restore too. They were missing here while the
      // rest of the pipeline carried them, so step 1 and step 2 saved
      // correctly and then came back blank — the write looked broken when it
      // was the read that dropped them.
      banks: stored!.banks,
      answers: stored!.answers,
      picked: new Set(stored!.picked),
      lines: new Map(stored!.lines),
      order: stored!.order,
    });
    return true;
  },

  orderedLines() {
    const { picked, lines, order } = get();
    // Anything picked but missing from `order` (defensive) falls back to
    // catalog order so no selection is silently dropped.
    const ids = [
      ...order.filter((id) => picked.has(id)),
      ...CATALOG_ORDER.filter((id) => picked.has(id) && !order.includes(id)),
    ];
    return ids.map((id) => lines.get(id)).filter((line): line is DraftLine => Boolean(line));
  },
}));

/*
 * Save after every change, from one place.
 *
 * A subscription rather than a write inside each action: `toggle`, `pickAll`,
 * `updateLine`, `setOrder` and `removeLine` all mutate the draft, and adding a
 * save call to each is five chances to forget one — the sixth action added
 * later would silently not persist. Subscribing means anything that changes the
 * state is covered by construction.
 *
 * Writes are cheap here (one settings row, a few KB of JSON, on a local SQLite
 * file) and happen at human speed — a tap or a keystroke — so there is nothing
 * to debounce.
 */
useOnboardingDraft.subscribe((state, previous) => {
  // Only the DATA matters; the action functions are stable but compared too.
  // `banks` and `answers` are in here because leaving them out meant step 1
  // and step 2 changed the store and saved nothing — the exact gap this was
  // extended to close.
  if (
    state.banks === previous.banks &&
    state.answers === previous.answers &&
    state.picked === previous.picked &&
    state.lines === previous.lines &&
    state.order === previous.order
  ) {
    return;
  }

  /*
   * An empty draft clears the key rather than storing "nothing picked".
   *
   * `reset()` already does this, but unticking the last line by hand reaches
   * the same state — and a stored empty draft would make the next launch think
   * setup was in progress when there is nothing to resume.
   */
  /*
   * Empty means NOTHING anywhere, not "no lines picked".
   *
   * Testing `picked` alone wiped the key on every step-1 change, because banks
   * are ticked long before any line is — so the ticks were written and then
   * immediately cleared by the next keystroke's save. Mirrors `hasContent`.
   */
  if (state.picked.size === 0 && state.banks.length === 0 && state.answers === null) {
    settingsRepo.set(SETTINGS_KEYS.onboardingDraft, '');
    return;
  }

  try {
    settingsRepo.set(SETTINGS_KEYS.onboardingDraft, serialiseDraft(state));
  } catch {
    // Losing the autosave is not worth breaking the step the user is on.
  }
});

/**
 * Whether the saved draft has been read back yet.
 *
 * Module-level rather than store state: it is about this JS instance's
 * lifecycle, not the user's plan, and putting it in the store would send it
 * through the autosave subscription for no reason.
 */
let hydrated = false;

/**
 * Load the saved draft, at most once per app launch.
 *
 * Call this from a `useState` initialiser — the first screen to ask for the
 * draft triggers it, which is both late enough that SQLite is open and early
 * enough that no component has read defaults yet. Repeat calls are free, so
 * every screen can call it without coordinating.
 */
export function hydrateOnboardingDraft(): void {
  if (hydrated) return;
  hydrated = true;
  useOnboardingDraft.getState().restore();
}
