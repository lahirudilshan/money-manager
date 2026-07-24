import { create } from 'zustand';
import { CATALOG_SUBCATEGORY_BY_ID, CATEGORY_CATALOG } from '../data/categoryCatalog';
import type { Minor } from '../core/money';

/**
 * Scratch state for onboarding steps 2 and 3.
 *
 * Nothing is written to SQLite until the plan is confirmed at the end of step
 * 3, so abandoning onboarding halfway leaves no partial categories behind and
 * stepping backwards never has to undo database writes. Once committed, this
 * store is cleared and the app store becomes the only source of truth.
 */

/** One picked line, with the settings step 3 lets the user adjust. */
export interface DraftLine {
  /** Catalog subcategory id — also the draft's stable key. */
  id: string;
  name: string;
  categoryId: string;
  icon: string;
  type: 'income' | 'expense';
  plannedMinor: Minor;
  dueDay: number;
  frequency: 'monthly' | 'one_time' | 'yearly';
  /** Account this line is funded from; null means "use the category default". */
  cardId: string | null;
  /**
   * Currency the amount was entered in. Income is often paid in USD, so it is
   * captured as typed and converted to local minor units on commit — keeping
   * the original figure and rate for the record.
   */
  currency: 'local' | 'usd';
  /** Amount as typed when `currency` is 'usd'; null for local-currency lines. */
  foreignAmount: number | null;
}

interface OnboardingDraftState {
  picked: Set<string>;
  /** Per-line settings, keyed by catalog id. Populated on first pick. */
  lines: Map<string, DraftLine>;
  /** Explicit ordering across all picked lines, set by drag-and-drop in step 3. */
  order: string[];

  toggle: (catalogId: string) => void;
  pickAll: (catalogIds: string[], select: boolean) => void;
  updateLine: (catalogId: string, patch: Partial<DraftLine>) => void;
  setOrder: (orderedIds: string[]) => void;
  removeLine: (catalogId: string) => void;
  reset: () => void;

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
  };
}

/** Catalog order — the fallback ordering before the user drags anything. */
const CATALOG_ORDER = CATEGORY_CATALOG.flatMap((category) =>
  category.subcategories.map((subcategory) => subcategory.id),
);

export const useOnboardingDraft = create<OnboardingDraftState>((set, get) => ({
  picked: new Set(),
  lines: new Map(),
  order: [],

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
    set({ picked: new Set(), lines: new Map(), order: [] });
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
