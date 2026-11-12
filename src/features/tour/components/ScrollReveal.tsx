import React, { createContext, useContext, useRef } from 'react';
import type { StyleProp, View, ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Scroll-driven reveal: content fades and rises into place as it scrolls into
 * view, so a long page unfolds as you read instead of arriving all at once.
 *
 * The page owns the scroll position (`scrollY`) and the bottom of the visible
 * area in window coordinates (`viewportBottom`); every `<Reveal>` measures
 * where it sits once and works out its own progress from those two numbers.
 * Nothing is ever hidden for good — content above the fold is fully shown on
 * the first frame, and anything off-screen is shown the moment it arrives.
 */
interface RevealContext {
  scrollY: SharedValue<number>;
  viewportBottom: number;
  /** Reduce Motion: show everything, animate nothing. */
  still: boolean;
}

const Ctx = createContext<RevealContext | null>(null);

export function RevealProvider({
  scrollY,
  viewportBottom,
  still,
  children,
}: RevealContext & { children: React.ReactNode }) {
  return <Ctx.Provider value={{ scrollY, viewportBottom, still }}>{children}</Ctx.Provider>;
}

/** How far (px) an item scrolls into view while it animates in. */
const RUN = 140;

export function Reveal({
  children,
  style,
  /** Extra px before this one starts — staggers items that enter together. */
  lag = 0,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  lag?: number;
}) {
  const ctx = useContext(Ctx);
  const ref = useRef<View>(null);
  // The item's top in window coordinates when the page is scrolled to 0.
  const top = useSharedValue(-1);
  const scrollY = ctx?.scrollY;
  const bottom = ctx?.viewportBottom ?? 0;
  const still = ctx?.still ?? true;

  const animated = useAnimatedStyle(() => {
    if (still || !scrollY) return { opacity: 1 };
    if (top.value < 0) return { opacity: 0 };
    const entered = bottom + scrollY.value - top.value - 24 - lag;
    const p = interpolate(entered, [0, RUN], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 32 }, { scale: 0.96 + 0.04 * p }],
    };
  });

  return (
    <Animated.View
      ref={ref as never}
      style={[style, animated]}
      onLayout={() => {
        (ref.current as unknown as View | null)?.measureInWindow((_x, y) => {
          top.value = y + (scrollY?.value ?? 0);
        });
      }}
    >
      {children}
    </Animated.View>
  );
}
