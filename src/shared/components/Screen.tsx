import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { AppHeader, FOOTER_CLEARANCE, useKeyboardHeight } from './ui';

/**
 * A full screen with a back button, a scrolling body and an optional pinned
 * action — the counterpart to `BottomSheet` for content that is a PLACE rather
 * than a task.
 *
 * The distinction matters for navigation: a sheet is something you finish and
 * dismiss, so it closes with an ✕ and returns you to where you were. A screen
 * is somewhere you go, may drill further into, and come back from — which wants
 * a back chevron and a title bar that stays put.
 *
 * The add-on features are the latter. A fuel log is browsed, drilled into
 * (vehicles, services, individual fill-ups) and returned from, and presenting
 * that as a stack of modal sheets made every level feel like an interruption of
 * the one beneath it.
 */
export function Screen({
  title,
  onBack,
  action,
  footer,
  inModal = false,
  children,
}: {
  title: string;
  onBack?: () => void;
  /**
   * Optional icon button on the right of the header.
   *
   * Typed by lifting `AppHeader`'s own action prop rather than re-deriving the
   * icon type through a conditional. The conditional version collapsed to
   * `never` — `action` is optional on AppHeader, so the type it was testing was
   * `{...} | undefined`, which does not extend `{ icon: infer I }` — and made
   * every `action` passed to `Screen` a type error. It went unnoticed because
   * until now no screen used it.
   */
  action?: NonNullable<React.ComponentProps<typeof AppHeader>['action']>;
  /** Pinned to the bottom, above the safe area — usually a GradientButton. */
  footer?: React.ReactNode;
  /**
   * This screen is presented as a modal sheet, not pushed.
   *
   * iOS already insets a presented sheet below the status bar, so the header
   * must not add the notch inset a second time — see `AppHeader.inModal`.
   */
  inModal?: boolean;
  children: React.ReactNode;
}) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(Boolean(footer));

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.canvas,
        /*
         * The whole column gets shorter while the keyboard is up.
         *
         * This screen had NO keyboard handling at all: the footer was pinned to
         * the physical bottom of the display, so the keyboard covered it
         * outright, and the scroll area kept believing it had the full height —
         * which meant a focused field low in a form (the health forms are all
         * long) could not be scrolled out from under the keyboard.
         *
         * Shrinking the column is what puts the footer directly on top of the
         * keyboard AND gives the ScrollView above a smaller viewport to scroll
         * within. Same fix as `SheetChrome` in ui.tsx; these two are the app's
         * only pinned-footer containers.
         */
        paddingBottom: keyboardHeight,
      }}
    >
      <AppHeader title={title} onBack={onBack} action={action} inModal={inModal} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: space.lg,
          /*
           * Room for the pinned footer, which DRAWS OVER this content.
           *
           * Was `space.lg + 72`, measured against a footer of roughly that
           * height with the keyboard closed — but a focused field needs to
           * clear the footer with room to spare, not sit flush behind its top
           * edge. `FOOTER_CLEARANCE` is the shared figure and deliberately errs
           * long: over-padding costs a little empty space at the end of a
           * scroll, under-padding costs content that cannot be reached at all.
           */
          paddingBottom: footer ? FOOTER_CLEARANCE : space.lg + insets.bottom,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>

      {footer ? (
        <View
          style={{
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
            // The home-indicator inset only applies with the keyboard CLOSED —
            // with it open the keyboard already covers that strip, and the gap
            // would read as a hole between the button and the keys.
            paddingBottom: (keyboardHeight > 0 ? 0 : insets.bottom) + space.sm,
            backgroundColor: colors.canvas,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
