/**
 * The arithmetic behind drag-to-reorder, kept out of the gesture so it can be
 * tested without a touch.
 */

/**
 * Move one id from `from` to `to`, returning the new arrangement.
 *
 * Pure and non-mutating — the caller's array is a render input, and splicing it
 * in place is how a list ends up disagreeing with what was drawn.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  'worklet';
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * How far a row must move aside to make room for a row being dragged.
 *
 * With the rendered order frozen during a drag, every non-dragged row's
 * position is a pure function of three numbers: where the drag STARTED, where
 * it would drop RIGHT NOW, and this row's own index. Rows caught between those
 * two points shift by one dragged-row height, in whichever direction opens the
 * gap; everything outside that span stays exactly where it was.
 *
 * Derived rather than accumulated, deliberately. An earlier version added and
 * subtracted a displacement on each swap, which drifts out of step the moment
 * the finger moves erratically — dragging down past three rows and back up
 * again left rows permanently offset. Recomputing from the current (from, to)
 * pair is always self-consistent, however the finger got there.
 *
 * Returns 0 for the dragged row itself: it is positioned by the finger, not by
 * this.
 */
export function rowDisplacement(
  index: number,
  from: number,
  to: number,
  draggedHeight: number,
): number {
  // Called from a Reanimated worklet (the drag runs on the UI thread), so it
  // must be compilable as one — no closure over JS-thread state, hence the
  // heights coming in as plain numbers.
  'worklet';
  if (from === -1 || index === from) return 0;

  // Dragged DOWNWARD past this row: it moves up to fill the vacated space.
  if (from < index && index <= to) return -draggedHeight;
  // Dragged UPWARD past this row: it moves down.
  if (to <= index && index < from) return draggedHeight;

  return 0;
}

/**
 * Where the dragged row must come to REST, as a translation from where it
 * started.
 *
 * The finger lets go wherever it happens to be — typically only far enough to
 * have crossed a neighbour's centre, which is nowhere near the slot the row is
 * about to occupy. Zeroing the offset at that moment teleports the card the
 * remaining distance, and that jump is the single most visible flaw in a
 * reorder: everything else has animated, and then the thing under your finger
 * snaps.
 *
 * So the row is animated to this offset first, and only then does the array
 * reorder — at which point the row's real layout position and its animated
 * position coincide exactly, and resetting the transform to zero is invisible.
 *
 * The distance is the difference between the target slot's top and the row's
 * own, in the ORIGINAL layout, minus the space the row itself vacates when it
 * moves down (the rows it passed each shift up by its height, so the slot it
 * lands in has already moved toward it).
 */
export function restingOffset(
  from: number,
  to: number,
  tops: readonly number[],
  heights: readonly number[],
): number {
  'worklet';
  if (from === to || from < 0 || to < 0) return 0;

  if (to > from) {
    /*
     * Moving DOWN. The row lands directly beneath the last row it passed, and
     * all of those have shifted up by its own height — so its final top is the
     * passed rows' combined height, measured from where it started.
     */
    let travelled = 0;
    for (let i = from + 1; i <= to; i += 1) travelled += heights[i] ?? 0;
    return travelled;
  }

  // Moving UP: it lands on the target's original top, which is simply the sum
  // of the rows between them, travelled the other way.
  let travelled = 0;
  for (let i = to; i < from; i += 1) travelled += heights[i] ?? 0;
  return -travelled;
}

/**
 * Which slot a drag is over, decided by where the row would COME TO REST.
 *
 * The previous rule compared the dragged row's centre against each slot's
 * centre in the untouched layout. It reads plausibly and is wrong in a way that
 * gets worse the further down the list you go: those centres describe a layout
 * the row is no longer part of, so with uneven heights the threshold fires long
 * before the row has travelled the distance the drop implies. Dragging the
 * bottom card up by 200pt selected a slot 500pt away — the card then flew three
 * times further than the finger had moved, and only ever in the lower half,
 * because that is where the tall rows sit above it.
 *
 * The fix is to measure the same quantity the drop will use. The dragged row is
 * removed from the layout, leaving `count` possible insertion points; whichever
 * one's top is NEAREST the row's live top wins. Threshold and flight distance
 * are then the same number by construction, so the card can never move further
 * than the finger asked for — and the answer depends only on where the finger
 * is now, never on how it got there.
 */
export function dropIndexByRest(
  draggedIndex: number,
  translation: number,
  tops: readonly number[],
  heights: readonly number[],
): number {
  'worklet';
  const count = heights.length;
  if (count === 0) return 0;

  const liveTop = (tops[draggedIndex] ?? 0) + translation;

  /*
   * The tops of every insertion point once the dragged row is lifted out.
   * There are `count` of them: before each remaining row, plus the end.
   */
  let running = 0;
  let best = 0;
  let bestDistance = Infinity;
  let slot = 0;

  for (let i = 0; i < count; i += 1) {
    if (i === draggedIndex) continue;

    const distance = liveTop > running ? liveTop - running : running - liveTop;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slot;
    }
    running += heights[i] ?? 0;
    slot += 1;
  }

  // The final insertion point, past the last remaining row.
  const endDistance = liveTop > running ? liveTop - running : running - liveTop;
  if (endDistance < bestDistance) best = slot;

  return best;
}
