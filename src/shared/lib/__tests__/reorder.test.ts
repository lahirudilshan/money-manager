import { describe, expect, it } from 'vitest';
import {
  dropIndexByRest,
  moveItem,
  restingOffset,
  rowDisplacement,
} from '~/shared/lib/reorder';

const IDS = ['a', 'b', 'c', 'd'];

describe('moveItem', () => {
  it('moves an item down', () => {
    expect(moveItem(IDS, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item up', () => {
    expect(moveItem(IDS, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('is a no-op when the indexes match', () => {
    expect(moveItem(IDS, 2, 2)).toEqual(IDS);
  });

  // The input is a render array; mutating it desynchronises state from what
  // was drawn.
  it('does not mutate the input', () => {
    const input = [...IDS];
    moveItem(input, 0, 3);
    expect(input).toEqual(IDS);
  });

  it('ignores an out-of-range index', () => {
    expect(moveItem(IDS, 0, 99)).toEqual(IDS);
    expect(moveItem(IDS, -1, 0)).toEqual(IDS);
  });
});

/**
 * The drag maths, which three earlier versions of the list got wrong in
 * different ways. These pin the rules that replaced them.
 */
describe('rowDisplacement', () => {
  const H = 100;

  it('never displaces the dragged row itself', () => {
    expect(rowDisplacement(2, 2, 5, H)).toBe(0);
  });

  it('is inert when no drag is in progress', () => {
    expect(rowDisplacement(3, -1, -1, H)).toBe(0);
  });

  // Dragging DOWN from 0 to 2: rows 1 and 2 move up to fill the gap.
  it('moves rows up when the drag passes them going down', () => {
    expect(rowDisplacement(1, 0, 2, H)).toBe(-H);
    expect(rowDisplacement(2, 0, 2, H)).toBe(-H);
  });

  it('leaves rows beyond the drop target alone', () => {
    expect(rowDisplacement(3, 0, 2, H)).toBe(0);
    expect(rowDisplacement(4, 0, 2, H)).toBe(0);
  });

  // Dragging UP from 4 to 2: rows 2 and 3 move down.
  it('moves rows down when the drag passes them going up', () => {
    expect(rowDisplacement(2, 4, 2, H)).toBe(H);
    expect(rowDisplacement(3, 4, 2, H)).toBe(H);
  });

  it('leaves rows above the drop target alone when dragging up', () => {
    expect(rowDisplacement(0, 4, 2, H)).toBe(0);
    expect(rowDisplacement(1, 4, 2, H)).toBe(0);
  });

  it('displaces nothing when the drag is back at its origin', () => {
    for (let i = 0; i < 5; i += 1) expect(rowDisplacement(i, 2, 2, H)).toBe(0);
  });

  /*
   * The bug that killed the accumulate-per-swap version: dragging out and back
   * must leave the list exactly as it started, with no residue.
   */
  it('is a pure function of the current span, not the path taken', () => {
    const outward = [0, 1, 2, 3, 4].map((i) => rowDisplacement(i, 1, 4, H));
    // Having gone 1 -> 4 and come back to 1, everything must be zero again.
    const returned = [0, 1, 2, 3, 4].map((i) => rowDisplacement(i, 1, 1, H));
    expect(outward).not.toEqual(returned);
    expect(returned).toEqual([0, 0, 0, 0, 0]);
  });

  it('uses the dragged row own height, not a constant', () => {
    expect(rowDisplacement(1, 0, 1, 340)).toBe(-340);
  });
});


/**
 * The end-to-end contract the list relies on: a drag reports (from, to), and
 * `moveItem` against the RENDERED order must produce what the user saw.
 *
 * This is the invariant that broke when heights were indexed by position — the
 * geometry described the wrong rows after the first reorder, so `to` was wrong
 * and the commit silently disagreed with the animation.
 */
describe('drag commit round-trip', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  /** Deliberately uneven, like collapsed and expanded cards. */
  const heights: Record<string, number> = { a: 80, b: 400, c: 90, d: 300, e: 70 };

  /** Rebuild the geometry the gesture builds, by id. */
  function geometry(order: readonly string[]) {
    const tops: number[] = [];
    const slots: number[] = [];
    let running = 0;
    for (const id of order) {
      const slot = heights[id] + 12;
      tops.push(running);
      slots.push(slot);
      running += slot;
    }
    return { tops, slots };
  }

  /** Simulate dragging `id` by `dy` and committing. */
  function drag(order: readonly string[], id: string, dy: number) {
    const from = order.indexOf(id);
    const { tops, slots } = geometry(order);
    const to = dropIndexByRest(from, dy, tops, slots);
    return { to, result: moveItem(order, from, to) };
  }

  it('leaves the order untouched when nothing moves', () => {
    expect(drag(ids, 'c', 0).result).toEqual(ids);
  });

  it('moves a row down past a tall neighbour', () => {
    // 'a' (80) must clear 'b' (400): its centre 40 must pass b's centre, 252.
    const { result } = drag(ids, 'a', 300);
    expect(result[0]).toBe('b');
    expect(result[1]).toBe('a');
  });

  it('moves a row up', () => {
    const { result } = drag(ids, 'e', -400);
    expect(result.indexOf('e')).toBeLessThan(4);
  });

  /*
   * The failure-4 regression: after one reorder the geometry must follow the
   * NEW arrangement. Keyed by id it does; keyed by position it would still
   * describe the old one and the second drag would land somewhere else.
   */
  it('stays correct across successive drags', () => {
    const first = drag(ids, 'a', 300).result;
    expect(first).toEqual(['b', 'a', 'c', 'd', 'e']);

    // Now drag 'a' (at index 1) down past 'c' (90 tall).
    const second = drag(first, 'a', 120).result;
    expect(second).toEqual(['b', 'c', 'a', 'd', 'e']);

    // Every id survives, exactly once — nothing lost or duplicated.
    expect([...second].sort()).toEqual([...ids].sort());
  });

  it('never loses or duplicates a row, wherever it is dropped', () => {
    for (const id of ids) {
      for (const dy of [-800, -300, -50, 0, 50, 300, 800]) {
        const { result } = drag(ids, id, dy);
        expect([...result].sort()).toEqual([...ids].sort());
        expect(result).toHaveLength(ids.length);
      }
    }
  });

  /*
   * Dragging to the target and back must be a no-op — the drift that killed the
   * accumulate-per-swap version showed up exactly here.
   */
  it('is path-independent: out and back leaves the order unchanged', () => {
    const { to, result } = drag(ids, 'a', 300);
    expect(to).toBeGreaterThan(0);
    // Returning to zero travel from the original order reports the origin.
    expect(drag(ids, 'a', 0).result).toEqual(ids);
    expect(result).not.toEqual(ids);
  });
});

/**
 * Where the dragged row settles.
 *
 * The finger releases wherever it is — usually just past a neighbour's centre,
 * not at the slot the row will occupy. Without animating to this offset first,
 * the card teleports the remaining distance on drop, which is the most visible
 * flaw a reorder can have.
 */
describe('restingOffset', () => {
  // Uneven on purpose: a collapsed card, an expanded one, two more.
  const heights = [100, 400, 100, 200];
  const tops = [0, 100, 500, 600];

  it('is zero when the row has not moved', () => {
    expect(restingOffset(1, 1, tops, heights)).toBe(0);
  });

  /*
   * A=100 dragged past B=400 lands directly under B. B shifts up by 100, so
   * A's final top is 400 — exactly B's height.
   */
  it('travels the passed rows height going down', () => {
    expect(restingOffset(0, 1, tops, heights)).toBe(400);
  });

  it('sums several passed rows going down', () => {
    // Past B (400) and C (100).
    expect(restingOffset(0, 2, tops, heights)).toBe(500);
  });

  /*
   * The case that exposes the bug: the distance depends on the heights of the
   * rows PASSED, not on the dragged row's own height.
   */
  it('uses the passed rows heights, not the dragged rows', () => {
    // The tall B (400) dragged up past the short A (100) travels only 100.
    expect(restingOffset(1, 0, tops, heights)).toBe(-100);
    // While the short A dragged down past the tall B travels 400.
    expect(restingOffset(0, 1, tops, heights)).toBe(400);
  });

  it('travels upward as a negative offset', () => {
    // D (index 3) up to index 1 passes B (400) and C (100).
    expect(restingOffset(3, 1, tops, heights)).toBe(-500);
  });

  /*
   * The whole point: after resting, the row's animated position and its new
   * layout position must coincide, so zeroing the transform is invisible.
   */
  it('lands exactly on the new layout position', () => {
    const from = 0;
    const to = 2;
    const offset = restingOffset(from, to, tops, heights);

    // Where the row actually ends up once the array is reordered.
    const reordered = moveItem([0, 1, 2, 3], from, to);
    let newTop = 0;
    for (const original of reordered) {
      if (original === from) break;
      newTop += heights[original];
    }

    expect(tops[from] + offset).toBe(newTop);
  });

  it('lands exactly on the new layout position going up too', () => {
    const from = 3;
    const to = 1;
    const offset = restingOffset(from, to, tops, heights);

    const reordered = moveItem([0, 1, 2, 3], from, to);
    let newTop = 0;
    for (const original of reordered) {
      if (original === from) break;
      newTop += heights[original];
    }

    expect(tops[from] + offset).toBe(newTop);
  });
});

/**
 * The drop target, decided by where the row would come to REST.
 *
 * Replaces a centre-against-centre comparison that fired far too early with
 * uneven rows — dragging the bottom card up 200pt chose a slot 500pt away, so
 * the card flew three times further than the finger had moved, and only ever in
 * the lower half of the list where the tall rows sit above.
 */
describe('dropIndexByRest', () => {
  // A short card, a tall expanded one, a short one, a medium one.
  const heights = [100, 400, 100, 200];
  const tops = [0, 100, 500, 600];

  it('reports the row own index when it has not moved', () => {
    for (let i = 0; i < 4; i += 1) {
      expect(dropIndexByRest(i, 0, tops, heights)).toBe(i);
    }
  });

  /*
   * The exact regression. Row 3 sits at top 600; slot 1 is at top 100, so
   * landing there is a 500pt journey and must not be chosen for a 200pt drag.
   */
  it('does not select a slot further away than the finger has travelled', () => {
    expect(dropIndexByRest(3, -200, tops, heights)).toBe(2);
    expect(dropIndexByRest(3, -100, tops, heights)).toBe(2);
  });

  it('reaches the far slot only once the finger really goes there', () => {
    expect(dropIndexByRest(3, -450, tops, heights)).toBe(1);
    expect(dropIndexByRest(3, -600, tops, heights)).toBe(0);
  });

  it('works the same way going down', () => {
    // Row 0 (top 0) reaching slot 1 means passing the 400-tall row.
    expect(dropIndexByRest(0, 100, tops, heights)).toBe(0);
    expect(dropIndexByRest(0, 400, tops, heights)).toBe(1);
  });

  it('clamps at both ends', () => {
    expect(dropIndexByRest(0, -9999, tops, heights)).toBe(0);
    expect(dropIndexByRest(0, 9999, tops, heights)).toBe(3);
  });

  it('handles an empty list', () => {
    expect(dropIndexByRest(0, 50, [], [])).toBe(0);
  });

  /*
   * The property that makes the drop feel proportional: the distance the row
   * flies must never exceed the distance the finger moved by more than one
   * row's height. The old rule violated this badly.
   */
  it('never flies much further than the finger travelled', () => {
    for (let from = 0; from < 4; from += 1) {
      for (const dy of [-600, -400, -200, -100, 0, 100, 200, 400, 600]) {
        const to = dropIndexByRest(from, dy, tops, heights);
        const rest = restingOffset(from, to, tops, heights);
        const overshoot = Math.abs(rest) - Math.abs(dy);
        const tallest = Math.max(...heights);
        expect(overshoot).toBeLessThanOrEqual(tallest);
      }
    }
  });
});

/**
 * A displaced row moves by exactly ONE ROW HEIGHT.
 *
 * The list feeds `rowDisplacement` the row's OWN live height rather than the
 * dragged row's. The two are equal while dragging (every card is collapsed for
 * the duration), but reading its own cannot go stale — the expanded heights
 * recorded before the collapse once shoved a 112pt row 436pt aside, which read
 * as rows flying away far further than the card being moved.
 */
describe('displacement is exactly one row height', () => {
  it('moves a passed row by its own slot, never a multiple of it', () => {
    const rowSlot = 112;
    // Rows 1 and 2 are passed when dragging 0 -> 2.
    expect(rowDisplacement(1, 0, 2, rowSlot)).toBe(-rowSlot);
    expect(rowDisplacement(2, 0, 2, rowSlot)).toBe(-rowSlot);
  });

  it('is the same single step however far the drag goes', () => {
    const rowSlot = 112;
    // A row passed by a drag spanning five positions still moves ONE slot —
    // it swaps with the dragged row, it does not travel with it.
    expect(rowDisplacement(1, 0, 5, rowSlot)).toBe(-rowSlot);
    expect(rowDisplacement(4, 0, 5, rowSlot)).toBe(-rowSlot);
  });

  /*
   * The regression: a stale expanded height would be several times the row's
   * real size, and the row would visibly overshoot its neighbour.
   */
  it('never exceeds the row own height', () => {
    const collapsedSlot = 112;
    for (let index = 0; index < 6; index += 1) {
      for (let to = 0; to < 6; to += 1) {
        const moved = Math.abs(rowDisplacement(index, 0, to, collapsedSlot));
        expect(moved).toBeLessThanOrEqual(collapsedSlot);
      }
    }
  });
});

/**
 * Dragging while the board COLLAPSES underneath the finger.
 *
 * The board folds every card down the instant a drag starts, so the layout the
 * gesture began in stops existing a frame later. These pin the arithmetic that
 * has to survive that switch: the drop target is computed against the CURRENT
 * heights, and the row's travel is measured from where the finger actually is,
 * so the answer must depend only on the collapsed table once the fold lands.
 */
describe('drag survives the mid-drag collapse', () => {
  // Before: one expanded card among short ones. After: all uniform.
  const expandedHeights = [112, 436, 112, 112];
  const expandedTops = [0, 112, 548, 660];
  const collapsedHeights = [112, 112, 112, 112];
  const collapsedTops = [0, 112, 224, 336];

  /*
   * The regression this guards. Holding the finger still across the collapse
   * must not change where the row would drop — the user has not moved.
   */
  it('keeps the same target when the finger has not moved', () => {
    for (let from = 0; from < 4; from += 1) {
      expect(dropIndexByRest(from, 0, expandedTops, expandedHeights)).toBe(from);
      expect(dropIndexByRest(from, 0, collapsedTops, collapsedHeights)).toBe(from);
    }
  });

  /*
   * With uniform rows the geometry becomes predictable: moving one full row
   * height down lands exactly one slot down. This is what makes a collapsed
   * board feel like it tracks the finger.
   */
  it('advances exactly one slot per row height once collapsed', () => {
    expect(dropIndexByRest(0, 112, collapsedTops, collapsedHeights)).toBe(1);
    expect(dropIndexByRest(0, 224, collapsedTops, collapsedHeights)).toBe(2);
    expect(dropIndexByRest(0, 336, collapsedTops, collapsedHeights)).toBe(3);
  });

  it('advances one slot per row height going up too', () => {
    expect(dropIndexByRest(3, -112, collapsedTops, collapsedHeights)).toBe(2);
    expect(dropIndexByRest(3, -224, collapsedTops, collapsedHeights)).toBe(1);
    expect(dropIndexByRest(3, -336, collapsedTops, collapsedHeights)).toBe(0);
  });

  /*
   * Every displaced row moves by ONE collapsed row height — never by the
   * expanded height recorded before the fold, which is the "moves away too
   * much" symptom.
   */
  it('displaces neighbours by one collapsed row, not one expanded row', () => {
    const slot = 112;
    // Dragging row 0 down to 2: rows 1 and 2 each move up exactly one slot.
    expect(rowDisplacement(1, 0, 2, slot)).toBe(-slot);
    expect(rowDisplacement(2, 0, 2, slot)).toBe(-slot);
    // Row 3 is outside the span and must not move at all.
    expect(rowDisplacement(3, 0, 2, slot)).toBe(0);
  });

  /*
   * The drop stays proportional on a collapsed board: the row never flies
   * further than the finger asked for, by more than a single row.
   */
  it('never overshoots the finger once collapsed', () => {
    for (let from = 0; from < 4; from += 1) {
      for (const dy of [-336, -224, -112, 0, 112, 224, 336]) {
        const to = dropIndexByRest(from, dy, collapsedTops, collapsedHeights);
        const rest = restingOffset(from, to, collapsedTops, collapsedHeights);
        expect(Math.abs(rest) - Math.abs(dy)).toBeLessThanOrEqual(112);
      }
    }
  });
});
