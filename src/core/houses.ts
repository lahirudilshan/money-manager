/**
 * Which bills belong to a PROPERTY, and which house a payment should default to.
 *
 * The motivating case: the user pays the electricity and water bills for their
 * parents' house as well as their own. Both arrive as ordinary bank alerts, so
 * without a house dimension the two roll into one "Electricity" figure that
 * answers neither "what does my house cost" nor "what am I spending on my
 * parents".
 *
 * The design rule this module encodes is that the house dimension must be
 * INVISIBLE until it earns its place. Concretely:
 *
 *   - a user with one house is never asked which house — there is only one
 *     answer, and a picker with a single option is pure friction;
 *   - even with several houses, only *house-scoped* bills ask. Electricity,
 *     water, rent and transfers can each belong to a different property; a
 *     Netflix subscription or a salary cannot.
 *
 * Pure functions over plain data, so the rules are unit-testable and the store
 * can apply them without a database.
 */

/**
 * Catalog subcategory ids whose payments are per-property.
 *
 * Deliberately a small list rather than "everything under Housing". Two
 * judgements are encoded:
 *
 *   - the METERED utilities and the tenancy are per-property by nature — every
 *     house has its own meter, its own bill, its own landlord;
 *   - `parents` and `rent-income` are included because they are the lines a
 *     second property actually shows up on: money sent to support a parents'
 *     house, and rent received from a property let out.
 *
 * Groceries and fuel are excluded even though they are household spending: they
 * follow the PERSON, not the building, and tagging every supermarket run with a
 * house is exactly the busywork this feature must avoid.
 */
export const HOUSE_SCOPED_CATALOG_IDS: readonly string[] = [
  'rent',
  'electricity',
  'water',
  'gas',
  'internet',
  'maintenance',
  'garbage',
  'domestic-help',
  'parents',
  'rent-income',
];

/**
 * Category-hint tags whose SMS are per-property.
 *
 * Mirrors the list above, but keyed by what the *parser* concluded rather than
 * by a catalog id — an incoming CEB alert has a hint, not a catalog id. Both
 * lists exist because the two identify a bill at different points: the catalog
 * id when the user picks a line during onboarding, the hint when a message
 * arrives and must be attributed.
 *
 * `transfer` is here because sending money to a parents' house is how a second
 * property's costs are most often paid — which is precisely message 6 in the
 * user's real data.
 */
export const HOUSE_SCOPED_HINTS: readonly string[] = [
  'electricity',
  'water',
  'telecom',
  'transfer',
];

/**
 * Catalog ids under the "Houses" category — each one IS a property.
 *
 * These behave differently from every other catalog line: picking one does not
 * merely create a budget line, it creates a `houses` row, which is what makes
 * the house picker appear on the bills below. Recognised by prefix so a user
 * adding a fourth house needs no change here.
 */
export const HOUSE_CATALOG_PREFIX = 'house-';

/** Whether a catalog id names a PROPERTY rather than a bill. */
export function isHouseCatalogId(catalogId: string): boolean {
  return catalogId.startsWith(HOUSE_CATALOG_PREFIX);
}

/** Whether a catalog subcategory should default to being house-scoped. */
export function isHouseScopedCatalogId(catalogId: string): boolean {
  return HOUSE_SCOPED_CATALOG_IDS.includes(catalogId);
}

/** Whether an inferred SMS hint points at a per-property bill. */
export function isHouseScopedHint(hint: string | null): boolean {
  return hint !== null && HOUSE_SCOPED_HINTS.includes(hint);
}

/**
 * Whether an EXISTING budget line looks per-property, judged from its name.
 *
 * New lines are scoped at creation from their catalog id or SMS hint, but a
 * board built before houses existed has none of that — every line is
 * `house_scoped = 0`, so adding a second house would change nothing visible and
 * the feature would appear broken. This is the retroactive read: it recognises
 * the handful of bills that genuinely belong to a building.
 *
 * Matched on the line's own name plus its category, and kept deliberately tight.
 * A false positive here is a picker appearing on a bill that has nothing to do
 * with a house, which is precisely the noise this feature promises to avoid —
 * so "power" and "electricity" qualify while a vague "Home stuff" does not.
 */
const HOUSE_SCOPED_NAME_PATTERNS: RegExp[] = [
  /\belectric(?:ity)?\b/i,
  /\bceb\b/i,
  /\bleco\b/i,
  /\bwater\b/i,
  /\bnwsdb\b/i,
  /\brent\b/i,
  /\bgas\b/i,
  /\binternet\b/i,
  /\bbroadband\b/i,
  /\bgarbage\b/i,
  /\bmunicipal\b/i,
  /\bparents?\b/i,
  /\bmaintenance\b/i,
  /\brepairs?\b/i,
];

/** Whether a line's name/category marks it as a per-property bill. */
export function isHouseScopedName(lineText: string): boolean {
  return HOUSE_SCOPED_NAME_PATTERNS.some((pattern) => pattern.test(lineText));
}

/**
 * Placeholder houses seeded onto a board that has none.
 *
 * A stopgap with a deliberate shape: these are the user's real properties by
 * location, so the feature is usable immediately, but they are plain names the
 * user is expected to rewrite once they onboard properly. Nothing depends on
 * these strings — they are data, not identifiers.
 *
 * The first entry is marked as the user's own home, since `defaultHouseId`
 * needs a primary to fall back on and "my home" is the safest default for a
 * payment whose house the user has not chosen.
 */
export const PLACEHOLDER_HOUSES: readonly { name: string; isPrimary: boolean }[] = [
  { name: 'My home', isPrimary: true },
  { name: 'Weligama home', isPrimary: false },
  { name: 'Kelaniya home', isPrimary: false },
];

/** The minimum a house needs for the rules below. Matches the `houses` row. */
export interface HouseLike {
  id: string;
  isPrimary: boolean;
}

/**
 * Whether the UI should ASK which house a payment was for.
 *
 * Both conditions must hold: more than one house exists (otherwise there is
 * nothing to choose), and the line is house-scoped (otherwise the question is
 * meaningless). This single predicate is what keeps the feature from leaking
 * into every form in the app.
 */
export function shouldAskForHouse(
  houses: readonly HouseLike[],
  lineIsHouseScoped: boolean,
): boolean {
  return houses.length > 1 && lineIsHouseScoped;
}

/**
 * Which house a new payment should be attributed to before the user chooses.
 *
 * Order of preference:
 *   1. the line's own default, when it still names a live house — a bill the
 *      user has already told us is "the Weligama electricity" should not revert
 *      to their own home every month;
 *   2. the primary house — the user's own home is the overwhelmingly common
 *      answer for anything else;
 *   3. the only house there is, when none is flagged primary (a setup that
 *      predates the flag);
 *   4. null, meaning unattributed, when there is genuinely nothing to pick.
 *
 * Returning null rather than guessing matters: an attribution the user did not
 * make and cannot see would quietly load one property's total with another's
 * spending, which is worse than leaving it blank.
 */
export function defaultHouseId(
  houses: readonly HouseLike[],
  lineDefaultHouseId: string | null,
): string | null {
  if (houses.length === 0) return null;

  if (lineDefaultHouseId && houses.some((house) => house.id === lineDefaultHouseId)) {
    return lineDefaultHouseId;
  }

  const primary = houses.find((house) => house.isPrimary);
  if (primary) return primary.id;

  return houses.length === 1 ? houses[0].id : null;
}

/**
 * Sum spending per house.
 *
 * Entries carrying no house fall under the `null` key rather than being dropped
 * or silently folded into the primary house — "unattributed" is a real state
 * the summary must be able to show, and hiding it would make the per-house
 * figures quietly fail to add up to the month's total.
 */
export function totalsByHouse(
  entries: readonly { houseId: string | null; amountMinor: number }[],
): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const entry of entries) {
    totals.set(entry.houseId, (totals.get(entry.houseId) ?? 0) + entry.amountMinor);
  }
  return totals;
}
