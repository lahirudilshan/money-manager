import { useFocusEffect } from 'expo-router';
import React from 'react';
import type { ScrollView } from 'react-native';

/**
 * Send a tab's scroll position back to the top every time the tab is opened.
 *
 * A tab screen is MOUNTED ONCE and then kept alive as the user moves between
 * tabs, so its scroll offset survives — leaving a tab halfway down the plan and
 * coming back to it later dropped the user into the middle of a list with no
 * header in sight, which reads as the app having lost its place rather than as
 * having kept it. Each tab is a summary meant to be read from the top, so
 * arriving anywhere else is never what was wanted.
 *
 * `useFocusEffect` rather than `useEffect`, for exactly that reason: the mount
 * happens once, the focus happens on every visit, and it is the visit this is
 * about.
 *
 * Not animated. The scroll should have already happened by the time the tab is
 * on screen — animating it means the user watches the content slide, which
 * draws attention to a correction they did not ask for and did not need to see.
 *
 * Returns the ref to spread onto the screen's ROOT `ScrollView`. A nested
 * horizontal one (a chip strip, a card carousel) keeps its own position, which
 * is right: those are controls within the page, not the page itself.
 */
export function useScrollToTopOnFocus() {
  const ref = React.useRef<ScrollView>(null);

  useFocusEffect(
    React.useCallback(() => {
      ref.current?.scrollTo({ y: 0, animated: false });
    }, []),
  );

  return ref;
}
