import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, useState } from 'react';
import { LayoutAnimation, Platform, UIManager, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useAppStore } from '../store/useAppStore';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Long-press-then-drag vertical reorder list that reorders *live* as the
 * dragged row crosses its neighbours, rather than only settling on drop.
 *
 * Rows are a fixed `rowHeight` by contract. That constraint is what keeps the
 * gesture logic entirely on the UI thread: the slot the finger is over is a
 * pure function of the translation, so no per-row measurement has to be read
 * back across the JS bridge mid-drag. Callers render uniform rows and pass
 * their height; `ReorderableGroupList` remains for the board's tile grid.
 */
export function DragList<T extends { id: string }>({
  items,
  renderItem,
  onReorder,
  rowHeight,
  gap = 8,
}: {
  items: T[];
  renderItem: (item: T, index: number, dragging: boolean) => React.ReactNode;
  onReorder: (orderedIds: string[]) => void;
  rowHeight: number;
  gap?: number;
}) {
  const [order, setOrder] = useState<string[]>(() => items.map((item) => item.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Reconcile local order with the source list so adds/removes flow through
  // without discarding an in-progress manual arrangement.
  const ordered = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const kept = order.filter((id) => byId.has(id));
    const added = items.map((item) => item.id).filter((id) => !kept.includes(id));
    return [...kept, ...added].map((id) => byId.get(id)!).filter(Boolean);
  }, [items, order]);

  const slot = rowHeight + gap;

  /** Move a row to a new index, animating the rows that shift around it. */
  const move = useCallback(
    (from: number, to: number) => {
      setOrder((current) => {
        const ids = current.length === ordered.length ? [...current] : ordered.map((i) => i.id);
        if (to < 0 || to >= ids.length || from === to) return current;
        const [moved] = ids.splice(from, 1);
        ids.splice(to, 0, moved);
        return ids;
      });
      LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'));
      if (useAppStore.getState().hapticsEnabled) {
        Haptics.selectionAsync().catch(() => {});
      }
    },
    [ordered],
  );

  const commit = useCallback(() => {
    setDraggingId(null);
    onReorder(ordered.map((item) => item.id));
  }, [ordered, onReorder]);

  return (
    <View style={{ gap }}>
      {ordered.map((item, index) => (
        <DragRow
          key={item.id}
          index={index}
          count={ordered.length}
          slot={slot}
          height={rowHeight}
          onMove={move}
          onStart={() => setDraggingId(item.id)}
          onEnd={commit}
        >
          {renderItem(item, index, draggingId === item.id)}
        </DragRow>
      ))}
    </View>
  );
}

function DragRow({
  index,
  count,
  slot,
  height,
  children,
  onMove,
  onStart,
  onEnd,
}: {
  index: number;
  count: number;
  slot: number;
  height: number;
  children: React.ReactNode;
  onMove: (from: number, to: number) => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const translateY = useSharedValue(0);
  const active = useSharedValue(false);
  /**
   * Distance already absorbed by completed swaps. Each swap relocates this row
   * by one slot, so shedding that much from the visual offset keeps the row
   * pinned under the finger across a long drag.
   */
  const settled = useSharedValue(0);
  /** Live index during the drag; `index` prop lags until React re-renders. */
  const position = useSharedValue(index);

  const pan = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart(() => {
      active.value = true;
      settled.value = 0;
      position.value = index;
      runOnJS(onStart)();
    })
    .onUpdate((event) => {
      const offset = event.translationY - settled.value;

      // Crossed a neighbour's midpoint: swap, then absorb one slot so the
      // row keeps tracking the finger.
      if (Math.abs(offset) >= slot / 2) {
        const direction = offset > 0 ? 1 : -1;
        const target = position.value + direction;
        if (target >= 0 && target < count) {
          runOnJS(onMove)(position.value, target);
          position.value = target;
          settled.value += slot * direction;
        }
      }

      translateY.value = event.translationY - settled.value;
    })
    .onEnd(() => {
      translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
      active.value = false;
      settled.value = 0;
      runOnJS(onEnd)();
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: active.value ? 1.02 : 1 }],
    zIndex: active.value ? 20 : 0,
    height,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}
