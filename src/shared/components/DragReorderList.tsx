import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { dropIndexByRest, moveItem, rowDisplacement } from '~/shared/lib/reorder';
import { useAppStore } from '~/store/useAppStore';

/**
 * Long-press-then-drag reorder for rows of DIFFERENT heights.
 *
 * ## The one idea
 *
 * Layout position and visual position are kept strictly apart. React lays the
 * rows out ONCE, in a fixed order, and never re-lays them out during a drag;
 * everything the user sees moving is a transform on top of that static layout.
 * On release the array is reordered — at which point every row is already
 * sitting exactly where the new order puts it, so the re-render is invisible.
 *
 * Mixing the two is what broke every earlier attempt, so each failure is named
 * below where the code that prevents it lives:
 *
 *   1. Reordering the array mid-drag and letting flex re-lay-out the rows.
 *      Re-parenting views into new flex slots is a jump; a layout animation has
 *      nothing to interpolate.
 *   2. Compensating the dragged row's own `translateY` on each swap (what
 *      `DragList` does for uniform rows). It yanks the card backward out from
 *      under the finger. The dragged row must be touched by nothing but the
 *      finger.
 *   3. Accumulating each neighbour's displacement per swap. It drifts: drag out
 *      and back and rows stay permanently offset. Displacement is DERIVED from
 *      (from, to, index) instead — see `rowDisplacement`.
 *   4. Indexing measured heights BY POSITION. Rows are keyed by id and only
 *      re-measure when their size changes, not when they move, so after one
 *      reorder every height described the wrong card. Heights are keyed by id.
 *   5. Calling a plain `function finish() { 'worklet' }` helper from inside a
 *      gesture callback. Reanimated captures shared values and compiled
 *      worklets across the boundary, not arbitrary function references — it
 *      crashed with "undefined is not a function" on the first release. Only
 *      shared values and imported worklets are used inside the callbacks here.
 *
 * A sixth is not this file's doing but breaks it just as completely: React
 * Native's `Pressable` claims touches through the legacy responder system and
 * starves the gesture. Rows containing tappable children must use
 * gesture-handler's `Pressable`.
 */
export function DragReorderList<T extends { id: string }>({
  items,
  renderItem,
  onReorder,
  gap = 12,
  estimatedHeight = 120,
  enabled = true,
  onDragActiveChange,
}: {
  items: T[];
  /** `dragging` lets the row mark itself — a border, a tint, a shadow. */
  renderItem: (item: T, index: number, dragging: boolean) => React.ReactNode;
  onReorder: (orderedIds: string[]) => void;
  gap?: number;
  /** Used for a row that has not reported its height yet. */
  estimatedHeight?: number;
  /**
   * Set false to render the rows with no gesture attached — used while a filter
   * or search narrows the list, where the visible order is not the real one and
   * a drag would write a misleading arrangement.
   */
  enabled?: boolean;
  /**
   * Fired when a drag starts and again when it ends.
   *
   * Lets the host reshape its rows for the duration — the board collapses every
   * card while dragging, so the whole list is short uniform rows and the user
   * can see where the card is going instead of scrolling past one expanded
   * category. The host restores whatever it had on release; this component
   * neither knows nor cares what "collapsed" means.
   */
  onDragActiveChange?: (dragging: boolean) => void;
}) {
  const [order, setOrder] = useState<string[]>(() => items.map((item) => item.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Reconcile the local arrangement with the source list so adds and removes
  // flow through without discarding an in-progress manual order.
  const ordered = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const kept = order.filter((id) => byId.has(id));
    const added = items.map((item) => item.id).filter((id) => !kept.includes(id));
    return [...kept, ...added].map((id) => byId.get(id)!).filter(Boolean);
  }, [items, order]);

  /**
   * Measured heights, BY ID — never by position (failure 4).
   *
   * A row is keyed by its id and only re-measures when its own size changes,
   * not when it moves, so a position-keyed table goes stale the instant
   * anything is reordered and every subsequent threshold is computed against
   * the wrong card.
   */
  const heights = useSharedValue<Record<string, number>>({});

  /**
   * The rendered order, mirrored onto the UI thread.
   *
   * The gesture needs to turn a position into an id (to look its height up) and
   * cannot read a JS array, so the ids come across as a shared value that is
   * refreshed whenever the rendered order changes.
   */
  const renderedIds = useMemo(() => ordered.map((item) => item.id), [ordered]);
  const orderIds = useSharedValue<string[]>(renderedIds);
  /*
   * Written during RENDER, not in an effect.
   *
   * An effect runs after paint, so a drag begun on the very first frame would
   * read an empty array — every id would be undefined, every height would fall
   * back to the estimate, and the thresholds would be wrong for exactly the
   * gesture most likely to be tried first. Assigning here keeps the mirror in
   * step with what was just rendered, and it is idempotent, so the extra write
   * on a re-render costs nothing.
   */
  orderIds.value = renderedIds;

  /** Which index is being dragged, or -1, and where it would land. */
  const fromIndex = useSharedValue(-1);
  const toIndex = useSharedValue(-1);
  /**
   * Bumped to tell every row to drop its transform.
   *
   * A counter rather than a boolean: consecutive drags would otherwise write
   * the same value and the reaction watching it would not fire the second time.
   */
  const resetToken = useSharedValue(0);

  const resetDrag = useCallback(() => {
    fromIndex.value = -1;
    toIndex.value = -1;
    resetToken.value += 1;
  }, [fromIndex, toIndex, resetToken]);

  const setHeight = useCallback(
    (id: string, height: number) => {
      // Ignore an unchanged measurement: `onLayout` fires on every re-render,
      // and rewriting the shared value each time would wake every row's
      // animated reaction for nothing.
      if (heights.value[id] === height) return;
      heights.value = { ...heights.value, [id]: height };
    },
    [heights],
  );

  /**
   * Apply the drag's outcome and clear its transforms IN ONE COMMIT.
   *
   * The order matters more than it looks. The reorder and the reset are batched
   * by React into a single render, so the row's new layout position and the
   * removal of its offset land on the same frame — the card never appears to
   * return home first.
   *
   * Resetting on the UI thread instead, at the moment of release, is what
   * produced the flicker: `runOnJS` is asynchronous, so zeroing the transform
   * there snapped the card back to its original slot and held it for the frame
   * or two until React caught up. This batching is also what lets the drop be
   * instant without looking like a jump.
   */
  const commit = useCallback(
    (from: number, to: number) => {
      onDragActiveChange?.(false);
      if (from >= 0 && to >= 0 && from !== to) {
        const next = moveItem(renderedIds, from, to);
        setOrder(next);
        onReorder(next);
      }

      setDraggingId(null);
      // Same tick as the state above, so the new layout and the cleared offsets
      // are painted together.
      resetDrag();
    },
    [renderedIds, onReorder, resetDrag, onDragActiveChange],
  );

  const tick = useCallback(() => {
    if (useAppStore.getState().hapticsEnabled) Haptics.selectionAsync().catch(() => {});
  }, []);

  return (
    <View style={{ gap }}>
      {ordered.map((item, index) => (
        <DragRow
          key={item.id}
          rowId={item.id}
          index={index}
          count={ordered.length}
          gap={gap}
          enabled={enabled && ordered.length > 1}
          estimatedHeight={estimatedHeight}
          heights={heights}
          orderIds={orderIds}
          fromIndex={fromIndex}
          toIndex={toIndex}
          resetToken={resetToken}
          onMeasure={setHeight}
          onStart={() => {
            setDraggingId(item.id);
            onDragActiveChange?.(true);
          }}
          onCommit={commit}
          onTick={tick}
        >
          {renderItem(item, index, draggingId === item.id)}
        </DragRow>
      ))}
    </View>
  );
}

function DragRow({
  rowId,
  index,
  count,
  gap,
  enabled,
  estimatedHeight,
  heights,
  orderIds,
  fromIndex,
  toIndex,
  resetToken,
  children,
  onMeasure,
  onStart,
  onCommit,
  onTick,
}: {
  rowId: string;
  index: number;
  count: number;
  gap: number;
  enabled: boolean;
  estimatedHeight: number;
  heights: SharedValue<Record<string, number>>;
  orderIds: SharedValue<string[]>;
  fromIndex: SharedValue<number>;
  toIndex: SharedValue<number>;
  /** Bumped when a drag ends, so every row drops its transform. */
  resetToken: SharedValue<number>;
  children: React.ReactNode;
  onMeasure: (id: string, height: number) => void;
  onStart: () => void;
  onCommit: (from: number, to: number) => void;
  onTick: () => void;
}) {
  /**
   * The dragged row's offset from its CURRENT layout slot. 0 on every other row.
   *
   * Not the raw finger delta any more: with the board collapsing mid-drag the
   * row's slot moves underneath it, so the delta is re-based each frame (see
   * `onUpdate`) to keep the card under the thumb.
   */
  const translateY = useSharedValue(0);
  const active = useSharedValue(false);
  /**
   * Where the row's top sat, in the layout that existed WHEN IT WAS GRABBED.
   *
   * The board collapses every card the instant a drag begins, so the layout the
   * finger delta was captured against stops existing a frame later. Without an
   * anchor the row's drawn position (origin + translation, where the origin is
   * now the collapsed one) and the geometry the drop target is computed from
   * disagree by the difference between an expanded and a collapsed card — a few
   * hundred points — and the card lurches out from under the thumb at exactly
   * the moment the user starts moving it.
   *
   * Holding the ORIGINAL top lets `onUpdate` express the row's live position in
   * absolute terms, so the collapse can rewrite every other row's geometry
   * without moving this one.
   */
  const grabTop = useSharedValue(0);
  const pan = Gesture.Pan()
    .enabled(enabled)
    /*
     * The recogniser `DragList` already uses successfully inside a plain
     * ScrollView: the long press wins on time before the scroll claims the
     * vertical axis. (Tappable children still have to be gesture-handler
     * Pressables, or they starve this before it ever runs.)
     */
    .activateAfterLongPress(220)
    .onStart(() => {
      active.value = true;
      translateY.value = 0;
      fromIndex.value = index;
      toIndex.value = index;

      /*
       * Anchor the grab BEFORE the collapse lands.
       *
       * This runs on the frame the long press fires, which is the last frame on
       * which the expanded layout is still the real one — `onStart` tells the
       * host to collapse, and that re-render arrives afterwards. Reading the
       * geometry here captures the layout the finger actually touched.
       */
      const ids = orderIds.value;
      let running = 0;
      for (let i = 0; i < index; i += 1) {
        running += (heights.value[ids[i]] ?? estimatedHeight) + gap;
      }
      grabTop.value = running;

      runOnJS(onStart)();
      runOnJS(onTick)();
    })
    .onUpdate((event) => {
      /*
       * The dragged row tracks the finger EXACTLY (failure 2). No accumulator,
       * no compensation, no easing — anything here reads as the card slipping
       * out from under the thumb. The transform itself is written below, once
       * the row's live top has been resolved against the current layout.
       */

      /*
       * The drop target, rebuilt from absolute geometry every frame (failure 3).
       *
       * Everything below is either a shared value or a plain number, and the
       * only functions called are imported worklets — nothing that could fail
       * to cross the boundary (failure 5).
       */
      const ids = orderIds.value;
      const tops: number[] = [];
      const slots: number[] = [];
      let running = 0;
      for (let i = 0; i < count; i += 1) {
        // By ID, so this stays correct after any number of reorders (failure 4).
        const slot = (heights.value[ids[i]] ?? estimatedHeight) + gap;
        tops.push(running);
        slots.push(slot);
        running += slot;
      }

      /*
       * Where the row's top is NOW, in the coordinates it was grabbed in.
       *
       * The finger has moved `translationY` from a row top of `grabTop`, and
       * neither of those is affected by the board collapsing — which is the
       * entire point.
       */
      const liveTop = grabTop.value + event.translationY;

      /*
       * Converted into a transform against the row's CURRENT slot.
       *
       * `tops` is rebuilt from the live heights every frame, so on the frame
       * the cards fold down `tops[index]` moves by several hundred points.
       * Subtracting it here is what absorbs that shift: the row stays drawn
       * under the finger while the layout beneath it changes size. Using the
       * raw `translationY` as the transform instead — against an origin the
       * collapse had already moved — is what made the card lurch away from the
       * thumb the moment a drag began.
       */
      const travel = liveTop - (tops[index] ?? 0);

      /*
       * The row is drawn from its live top too, so what the user sees and what
       * the drop target is computed from can never diverge. Before this, the
       * transform used the raw finger delta against an origin that the collapse
       * had already moved.
       */
      translateY.value = travel;

      /*
       * Decided by where the row would REST, not by comparing centres in the
       * untouched layout. Those centres describe a layout the row is no longer
       * part of, and with uneven heights the old rule fired long before the row
       * had travelled the implied distance — dragging a lower card up 200pt
       * chose a slot 500pt away, so it flew far further than the finger moved.
       */
      const target = dropIndexByRest(index, travel, tops, slots);
      if (target !== toIndex.value) {
        toIndex.value = target;
        runOnJS(onTick)();
      }
    })
    .onEnd(() => {
      const from = fromIndex.value;
      const to = toIndex.value;

      /*
       * The drop is INSTANT — no flight to the resting slot.
       *
       * The card previously sprang from wherever the finger released it to the
       * slot it had earned, and only then committed. That animation is gone by
       * request: the reorder now happens on release and the card is simply
       * there. Because the commit and the transform reset are batched into one
       * render (see `commit`), there is no frame in which the card is drawn at
       * its old position, so removing the travel costs no smoothness — it just
       * removes the wait.
       */
      runOnJS(onCommit)(from, to);
      /*
       * Cleared HERE, synchronously, not left to the commit.
       *
       * `onFinalize` runs immediately after this on the same thread and uses
       * `fromIndex` to tell a release from a cancel — and `runOnJS` above is
       * asynchronous, so waiting for the commit to clear it would let the
       * finalize see a stale value and commit the same drag a second time.
       */
      fromIndex.value = -1;
      toIndex.value = -1;
    })
    .onFinalize(() => {
      /*
       * Only a genuinely CANCELLED gesture — one that never reached `onEnd`
       * (an incoming call, a parent claiming the touch).
       *
       * This fires immediately after `onEnd` too, so it MUST be able to tell
       * the two apart or every release commits twice. `onEnd` clears
       * `fromIndex` synchronously on this same thread, so a still-set
       * `fromIndex` is exactly the "never reached onEnd" case.
       */
      if (fromIndex.value !== -1) {
        runOnJS(onCommit)(fromIndex.value, fromIndex.value);
      }
    });

  /*
   * Clear this row's transform when the list says the drag is over.
   *
   * Driven by the token rather than by each row deciding for itself, so every
   * row drops its offset on the SAME frame the reorder is painted — which is
   * what makes the hand-off invisible.
   */
  useAnimatedReaction(
    () => resetToken.value,
    (token, previous) => {
      if (previous === null || token === previous) return;
      active.value = false;
      translateY.value = 0;
    },
  );

  /**
   * How far this row must move aside — derived, never accumulated (failure 3).
   *
   * `useDerivedValue` rather than `useAnimatedReaction` writing a second shared
   * value: this is a pure function of three shared values, so expressing it as
   * a derivation removes the intermediate state that could fall out of step.
   */
  const displacement = useDerivedValue(() => {
    const from = fromIndex.value;
    const to = toIndex.value;
    if (from === -1 || from === index) return 0;

    /*
     * ONE ROW HEIGHT — this row's own, not the dragged row's.
     *
     * A passed row swaps places with the dragged one, so strictly it should
     * move by the dragged row's height. That is only correct while the two are
     * the same size, and the heights recorded before a collapse are the
     * expanded ones — using them shoved a 112pt row 436pt aside. That is the
     * "moves away too much".
     *
     * Reading THIS row's own live height sidesteps the staleness entirely: it
     * is the height the row is currently drawn at, so the row can never travel
     * further than its own slot however out of date the rest of the table is.
     * With every card collapsed the two heights are equal anyway, so this is
     * the same answer arrived at by a route that cannot go stale — and it stays
     * the safe answer for a host that does NOT collapse its rows, which is why
     * it survives now that the board's collapse actually works.
     */
    const ownSlot = (heights.value[rowId] ?? estimatedHeight) + gap;
    return rowDisplacement(index, from, to, ownSlot);
  });

  const animatedStyle = useAnimatedStyle(() => {
    /*
     * Two motions, deliberately different in kind.
     *
     * The dragged row is unanimated — it is wherever the finger is. Its
     * neighbours are springed, because "making room" is the one thing that
     * should look like motion. Only one is ever non-zero for a given row.
     */
    const shift = active.value
      ? translateY.value
      : withSpring(displacement.value, {
          // Critically damped: rows settle without overshooting past each
          // other, which at card size reads as bouncing rather than as making
          // space.
          damping: 20,
          stiffness: 200,
          mass: 0.55,
        });

    return {
      transform: [{ translateY: shift }],
      zIndex: active.value ? 30 : 0,
      // Android paints by elevation, not zIndex, so the dragged row needs this
      // to sit above its neighbours rather than under them.
      elevation: active.value ? 8 : 0,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle}>
        {/*
          Measured on a PLAIN inner view, not on the animated wrapper.

          The wrapper carries a transform, and a transformed view's reported
          layout is not something to derive geometry from — it also does not
          reliably re-report when its child resizes. That matters here because
          the board collapses every card the moment a drag starts: the heights
          captured while the cards were expanded would otherwise be the ones the
          displacement used, and a row 112pt tall would be shoved 436pt aside.
          Which is exactly the "moves away too much" symptom.

          A plain wrapper reports its own content height on every layout pass,
          including the one that follows the collapse, and `onUpdate` re-reads
          `heights` each frame — so the geometry corrects itself on the next
          frame rather than staying stale for the whole gesture.
        */}
        <View
          onLayout={(event: LayoutChangeEvent) => {
            // A view can measure 0 before its children lay out; recording that
            // would tell the gesture a card is zero tall and every threshold
            // would fire at once.
            const { height } = event.nativeEvent.layout;
            if (height > 0) onMeasure(rowId, height);
          }}
        >
          {children}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
