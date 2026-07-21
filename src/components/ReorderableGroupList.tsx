import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, UIManager, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ROW_HEIGHT = 64;

/**
 * Long-press-then-drag vertical reorder list, built directly on gesture-handler
 * + reanimated (both already installed and wired at the app root) rather than
 * a dedicated draggable-list dependency. Only used in "reorder mode" — the
 * board's normal 2-column tile grid switches to this single-column list while
 * active, since a single drag axis is far simpler to get right than reordering
 * a wrapped grid.
 */
export function ReorderableGroupList<T extends { id: string }>({
  items,
  renderItem,
  onReorder,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  onReorder: (orderedIds: string[]) => void;
}) {
  const { colors, radius, shadow } = useTheme();
  const [order, setOrder] = useState(items.map((item) => item.id));

  // Keep local order in sync if the underlying list changes (add/delete).
  const orderedItems = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const known = order.filter((id) => byId.has(id));
    const missing = items.map((item) => item.id).filter((id) => !known.includes(id));
    return [...known, ...missing].map((id) => byId.get(id)!).filter(Boolean);
  }, [items, order]);

  function commitOrder(nextIds: string[]) {
    setOrder(nextIds);
    onReorder(nextIds);
  }

  return (
    <View style={{ gap: 8 }}>
      {orderedItems.map((item, index) => (
        <DraggableRow
          key={item.id}
          index={index}
          count={orderedItems.length}
          onDrop={(from, to) => {
            if (from === to) return;
            const next = [...orderedItems.map((i) => i.id)];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            commitOrder(next);
          }}
          style={{
            borderRadius: radius.lg,
            backgroundColor: colors.surface,
          }}
          shadowStyle={shadow.lifted}
        >
          {renderItem(item)}
        </DraggableRow>
      ))}
    </View>
  );
}

function DraggableRow({
  index,
  count,
  onDrop,
  children,
  style,
  shadowStyle,
}: {
  index: number;
  count: number;
  onDrop: (fromIndex: number, toIndex: number) => void;
  children: React.ReactNode;
  style?: object;
  shadowStyle?: object;
}) {
  const translateY = useSharedValue(0);
  const active = useSharedValue(false);

  function handleDrop(rawTranslateY: number) {
    const delta = Math.round(rawTranslateY / ROW_HEIGHT);
    const toIndex = Math.max(0, Math.min(count - 1, index + delta));
    onDrop(index, toIndex);
  }

  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => {
      active.value = true;
    })
    .onUpdate((event) => {
      translateY.value = event.translationY;
    })
    .onEnd(() => {
      const finalTranslation = translateY.value;
      translateY.value = withSpring(0);
      active.value = false;
      runOnJS(handleDrop)(finalTranslation);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: active.value ? 1.03 : 1 }],
    zIndex: active.value ? 10 : 0,
    opacity: active.value ? 0.96 : 1,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[style, shadowStyle, animatedStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}
