/**
 * Positioning rules for a list the user can drag.
 *
 * `sort_order` is only ever compared between siblings, and every read of it
 * orders by that column ALONE — so two rows sharing a value is not a cosmetic
 * blemish, it is undefined order. SQLite may return a tie either way round on
 * successive reads, which means the list renders one arrangement, a drag writes
 * indexes computed against it, and the next read comes back different. That is
 * what a drag "not sticking" looks like from the outside.
 *
 * Kept out of the store so the decisions can be tested without a database; the
 * store owns the SQL, this owns the arithmetic.
 */

/** Anything positioned within a list. Both categories and bills qualify. */
interface Positioned {
  sortOrder: number;
}

/**
 * Where a newly created row belongs: after everything already present.
 *
 * NOT the sibling count. A count is only the right answer when the existing
 * rows occupy a dense `0..n-1` range, and onboarding does not produce one — it
 * hands out board-wide offsets, so a category can hold 4..9 with eight rows in
 * it. The count then names a position two of them are already using.
 *
 * Deriving from the maximum cannot collide however sparse the range is.
 */
export function nextSiblingSortOrder(siblings: readonly Positioned[]): number {
  if (siblings.length === 0) return 0;
  return Math.max(...siblings.map((sibling) => sibling.sortOrder)) + 1;
}

/**
 * True when two rows ADJACENT IN DISPLAY ORDER share a position.
 *
 * The caller passes rows already ordered as they are read from the database, so
 * comparing neighbours is enough to spot a tie — and it means the check costs
 * nothing on the overwhelmingly common tidy board.
 */
export function hasSiblingTie(siblings: readonly Positioned[]): boolean {
  return siblings.some(
    (sibling, index) => index > 0 && sibling.sortOrder === siblings[index - 1].sortOrder,
  );
}

/**
 * Renumber to a dense `0..n-1` range, PRESERVING the order passed in.
 *
 * This runs against whatever order the rows are currently displayed in, so it
 * only makes the existing arrangement explicit and stable. It must never
 * rearrange a board the user deliberately ordered.
 */
export function renumberSiblings<T extends Positioned>(siblings: readonly T[]): T[] {
  return siblings.map((sibling, index) => ({ ...sibling, sortOrder: index }));
}
