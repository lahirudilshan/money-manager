/**
 * Map a detected SMS hint onto the SAME catalog onboarding uses.
 *
 * Smart detect can read what a message is *for* ("Looks like Loan", "Looks like
 * ATM cash") without the board having anywhere to put it. Before this, that was
 * a dead end: the hint chip named a category the user had never created, the
 * picker could not contain the right answer, and "Yes, log this" stayed
 * disabled forever. Detection worked and the user still could not act on it.
 *
 * Rather than invent a new naming scheme for lines created this way, a hint
 * resolves to an entry in CATEGORY_CATALOG — the identical group/line pairs
 * offered during onboarding. A "Loan" detected from an SMS therefore proposes
 * exactly the "Personal loan" line under "Loans & credit" that the user would
 * have seen in step 2, so a board grown by detection is indistinguishable from
 * one built by hand.
 *
 * Pure data + pure functions: no store, no database, no React. The store layer
 * decides whether to write; this only answers "what would we create, and does
 * something like it already exist?".
 */

import {
  CATEGORY_CATALOG,
  type CatalogCategory,
  type CatalogSubcategory,
} from '~/shared/data/categoryCatalog';
import { type CategoryHint } from './smsCategoryHints';
import { lineMatchesCategory } from './merchantSignals';

/**
 * Which catalog line each hint proposes, as `[categoryId, subcategoryId]`.
 *
 * Deliberately one target per hint rather than a list: this drives a single
 * "create this and log it" button, and offering three near-identical options
 * ("Personal loan"/"Housing loan"/"Lease") at the moment someone is trying to
 * clear a notification is a worse experience than one sensible default they can
 * rename later. The most common Sri Lankan household case wins each time.
 *
 * `atm` and `transfer` are the interesting ones. Neither is a bill — cash out
 * of an ATM has not been *spent* yet, and a bare transfer says nothing about
 * purpose. They map to a general "Cash & transfers" holding line so the money
 * is recorded rather than lost, which is the point of a funding board.
 */
const HINT_TARGET: Record<string, readonly [string, string]> = {
  water: ['housing', 'water'],
  electricity: ['housing', 'electricity'],
  telecom: ['living', 'mobile'],
  groceries: ['living', 'groceries'],
  fuel: ['transport', 'fuel'],
  subscription: ['subscriptions', 'streaming'],
  loan: ['loans', 'personal-loan'],
  atm: ['living', 'cash'],
  /*
   * A transfer out is money SENT, not bought.
   *
   * Pointed at the cash line rather than "Household items" for the same reason
   * as `atm`: nothing was purchased, so filing it under a spending category
   * silently inflates that category's total.
   */
  transfer: ['living', 'cash'],
  income: ['income', 'salary'],
  bank_charge: ['bank-fees', 'bank-charges'],

  /*
   * The wider categories `merchantSignals` can detect.
   *
   * `CategoryHint` covers only the ten buckets the shared catalog votes on, so
   * a hospital, a restaurant or a clothes shop had nowhere to go — the app
   * could READ the merchant perfectly and still offer the user nothing. These
   * map each additional category onto a real catalog line so "create it for me"
   * works for them too.
   */
  health: ['health', 'medicine'],
  dining: ['living', 'dining'],
  clothing: ['living', 'clothing'],
  education: ['family', 'tuition'],
  transport: ['transport', 'public-transport'],
  entertainment: ['lifestyle', 'entertainment'],
  household: ['living', 'household'],
  insurance: ['health', 'health-insurance'],
};

/** A concrete proposal: the group and line a hint would create. */
export interface HintProposal {
  category: CatalogCategory;
  subcategory: CatalogSubcategory;
  /** `income` lines must not be created as expenses, and vice versa. */
  type: 'income' | 'expense';
}

/**
 * What a hint proposes creating, or null when the hint has no catalog home.
 *
 * Returning null rather than a fabricated default matters: a hint with no
 * mapping should fall back to the plain picker, not offer to create something
 * arbitrary the user then has to find and delete.
 */
export function proposalForHint(hint: CategoryHint | string | null): HintProposal | null {
  if (!hint) return null;

  const target = HINT_TARGET[hint];
  if (!target) return null;

  const [categoryId, subcategoryId] = target;
  const category = CATEGORY_CATALOG.find((entry) => entry.id === categoryId);
  const subcategory = category?.subcategories.find((entry) => entry.id === subcategoryId);
  if (!category || !subcategory) return null;

  return { category, subcategory, type: subcategory.type ?? 'expense' };
}

/** The minimal shape this module needs from a board line. */
export interface ExistingLine {
  id: string;
  name: string;
  type: 'income' | 'expense';
  categoryId: string;
  /** Loose type: the DB stores a Date, tests use a number. Only null matters. */
  archivedAt?: Date | number | null;
}

/** The minimal shape this module needs from a board group. */
export interface ExistingGroup {
  id: string;
  name: string;
}

/**
 * Find a live line that already serves this hint, so the UI never offers to
 * create a duplicate of something the user has.
 *
 * Two ways a line can qualify, in order:
 *
 *  1. its name matches the catalog line the hint proposes ("Water" ≈ "Water") —
 *     the user built the same thing under a different group;
 *  2. its own text matches the hint's keywords, via the same `billMatchesHint`
 *     the reconciler scores with — so a hand-named "CEB bill" is recognised as
 *     electricity without appearing in any catalog.
 *
 * Archived lines never match: they are deleted, and resurrecting one silently
 * would undo a decision the user made deliberately.
 */
export function findLineForHint(
  hint: CategoryHint | string | null,
  lines: readonly ExistingLine[],
  groups: readonly ExistingGroup[],
): ExistingLine | null {
  const proposal = proposalForHint(hint);
  if (!hint || !proposal) return null;

  const live = lines.filter(
    (line) => line.archivedAt == null && line.type === proposal.type,
  );

  const wanted = normalise(proposal.subcategory.name);
  const byName = live.find((line) => normalise(line.name) === wanted);
  if (byName) return byName;

  // Keyword match over the line plus its group name, mirroring how the
  // reconciler decides a bill "belongs to" a hint.
  const groupName = new Map(groups.map((group) => [group.id, group.name]));
  /*
   * Matched through `lineMatchesCategory`, which covers the WIDER set.
   *
   * `billMatchesHint` only knows the ten catalog buckets, so a user's existing
   * "Medicine" line was invisible to a health-categorised message and the app
   * would have created a second one beside it.
   */
  return (
    live.find((line) =>
      lineMatchesCategory(
        hint as Parameters<typeof lineMatchesCategory>[0],
        `${line.name} ${groupName.get(line.categoryId) ?? ''}`,
      ),
    ) ?? null
  );
}

/**
 * Strip the parenthetical qualifiers the catalog uses for clarity but users
 * rarely type: "Electricity (CEB / LECO)" and a hand-made "Electricity" are the
 * same line for matching purposes.
 */
function normalise(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The group a proposed line should join: an existing group with the catalog
 * name, else null meaning "create it".
 *
 * Matching by name keeps detection from growing a second "Housing" beside the
 * one the user already has — the single most visible way this feature could
 * make a board worse.
 */
export function findGroupForProposal(
  proposal: HintProposal,
  groups: readonly ExistingGroup[],
): ExistingGroup | null {
  const wanted = normalise(proposal.category.name);
  return groups.find((group) => normalise(group.name) === wanted) ?? null;
}
