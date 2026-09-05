/**
 * The one bottom sheet, and the keyboard/footer plumbing it needs.
 *
 * Every modal in the app is this component — there is no second sheet and no
 * per-screen modal, so a change to how sheets dismiss, pad for the keyboard or
 * clear the home indicator lands everywhere at once.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { Text } from './primitives';

/**
 * The standard bottom action bar for a scrolling screen or sheet: a hairline
 * top border, a surface fill, and safe-area-aware bottom padding, holding one
 * or more actions (usually a single full-width GradientButton). Every screen
 * with a fixed bottom button uses this, so the treatment stays identical.
 *
 * Place it as the last child of a flex column, after the ScrollView, so it
 * pins to the bottom while the content scrolls above it. In a bottom-sheet,
 * pass `flush` to drop the safe-area padding (the sheet already insets).
 */
/**
 * The keyboard's current height (0 when hidden), tracked via the Keyboard API.
 * `enabled` lets a caller opt out so screens that don't need it pay nothing.
 * Uses the `Will` events on iOS (they fire with the frame before the animation)
 * and the `Did` events on Android (which lacks the `Will` variants).
 */
export function useKeyboardHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled]);

  return enabled ? height : 0;
}

/**
 * A bottom action bar pinned below a scrolling body — a hairline-topped surface
 * holding the page's primary button(s). Used by full-screen flows (onboarding
 * steps) whose footer is part of the page rather than a modal; modals get their
 * pinned footer from `BottomSheet`'s `footer` prop instead.
 */
/**
 * Bottom padding a scroll view needs so its last item clears `PinnedFooter`.
 *
 * The footer is a SIBLING of the scrolling content, not part of it, so it draws
 * on top: anything within its height of the end of the list is unreachable no
 * matter how far the user scrolls. Screens were padding by `space.lg` (16pt)
 * against a footer that is 100–140pt tall, which silently ate the last card on
 * every onboarding step — including the one naming the plan the user's answers
 * had just produced.
 *
 * Sized for the tallest case (a primary button plus a secondary link above the
 * home indicator). Over-padding costs a little empty space at the end of a
 * scroll; under-padding costs content the user cannot reach at all, so this
 * deliberately errs long.
 */
export const FOOTER_CLEARANCE = 140;

export function PinnedFooter({
  children,
  flush = false,
  followsKeyboard = false,
}: {
  children: React.ReactNode;
  flush?: boolean;
  /**
   * Lift the footer by the keyboard's height while it is open, instead of
   * relying on a parent KeyboardAvoidingView. When the keyboard is up its own
   * inset replaces the safe-area bottom padding.
   */
  followsKeyboard?: boolean;
}) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight(followsKeyboard);
  const keyboardUp = keyboardHeight > 0;

  return (
    <View
      style={{
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        // While the keyboard is up, sit flush on top of it; otherwise fall back
        // to the safe-area inset (unless the caller asked to be flush).
        paddingBottom: (keyboardUp ? keyboardHeight : flush ? 0 : insets.bottom) + space.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.hairline,
        backgroundColor: colors.surface,
      }}
    >
      {children}
    </View>
  );
}

/**
 * THE single modal for the whole app — presented as the native iOS sheet
 * (`presentationStyle="pageSheet"`): the OS card that slides up from the bottom
 * with the system grab handle, a gap at the top showing the screen behind, and
 * swipe-down-to-dismiss. Inside it we render our own consistent chrome — a rich
 * header, a scroll/content area, and an optional pinned footer — so every modal
 * and sheet looks identical (the "new bill in" style).
 *
 * Header: always an icon tile + `title`; an optional `eyebrow` shows a small
 * uppercase context line above the title (e.g. "NEW BILL IN"). A close button
 * sits at the right (alongside the native swipe-down). Pass `footer` for a
 * pinned bottom action bar (it lifts with the keyboard).
 *
 * Note: the native sheet owns its own height and grab handle, so there is no
 * `heightPct`/`maxHeightPct` here — the OS sizes it, and the user can drag it.
 */
/**
 * Corner radius on a sheet's top edge. Deliberately larger than `radius.xl`
 * (24) so the curve is visibly the app's rather than the ~10pt iOS draws on a
 * pageSheet by default.
 */
const SHEET_TOP_RADIUS = 28;

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /**
   * Let the title wrap instead of truncating it to one line.
   *
   * Off by default: a sheet title is normally two or three words, and letting
   * every header grow would push the body down for no gain. Turned on where the
   * title carries something the user needs to read IN FULL and did not choose
   * the length of — a backup's heading is their own name plus the moment it was
   * taken, and truncating that hides the half that identifies which copy they
   * are about to restore from.
   */
  wrapTitle?: boolean;
  /** Small uppercase context line above the title (e.g. a parent category). */
  eyebrow?: string;
  /**
   * Leading header icon. Defaults to a neutral list glyph when a title is set.
   *
   * Accepts a rendered node as well as an Ionicons name, for the handful of
   * headers whose mark is a BRAND rather than a glyph — a backup opened from
   * Google Drive shows Drive's own four-colour triangle, matching the row it
   * was opened from. Passing a node also opts out of the white tint the glyph
   * path applies, since a multicolour logo must keep its own colours.
   */
  icon?: keyof typeof Ionicons.glyphMap | React.ReactNode;
  /**
   * Turns the leading icon tile into a BACK button.
   *
   * For a sheet that has a second step inside it — choosing a bank from a long
   * list, say — so the step reads as "further in" rather than as a new sheet
   * stacked on the old one. Close stays in its usual place on the right, so
   * leaving entirely is still one tap from anywhere.
   */
  onBack?: () => void;
  /** Background for the icon tile (e.g. a category colour). Defaults to accent. */
  iconColor?: string;
  /** Pinned footer action bar (keyboard-aware) — usually a GradientButton. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Wrap children in a keyboard-aware ScrollView (for forms). */
  scroll?: boolean;
  /**
   * Set when the sheet IS an expo-router route screen already presented as the
   * native sheet (`presentation: 'modal'`). Then this renders the chrome only —
   * no own `<Modal>` — so it doesn't double-present. Inline sheets omit it and
   * get their own native `<Modal presentationStyle="pageSheet">`.
   */
  asRoute?: boolean;
  /**
   * Present as a full-screen sheet rather than the inset iOS card.
   *
   * For content that needs the whole height and cannot usefully scroll — the PIN
   * pad is the case this exists for: a fixed 3×4 grid of 72pt keys plus a header
   * does not fit the pageSheet inset, and letting it scroll under the thumb is
   * exactly what makes a keypad mis-tap. Use sparingly; the card sheet is the
   * default for a reason.
   */
  fullScreen?: boolean;
};

/** The shared chrome: header + body + footer. Identical in every sheet. */
function SheetChrome({
  onClose,
  onBack,
  title,
  wrapTitle,
  eyebrow,
  icon,
  iconColor,
  footer,
  children,
  scroll,
  fullScreen,
}: SheetProps) {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  /*
   * Tracked whenever the sheet SCROLLS, not only when it has a footer.
   *
   * The footer uses it to lift itself; the scroll content uses it to add room
   * beneath the last field. A scrolling sheet with no footer still needs the
   * second.
   */
  const keyboardHeight = useKeyboardHeight(Boolean(footer) || Boolean(scroll));

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        /*
         * A fullScreen presentation starts at pixel zero, so its own header
         * would sit under the status bar (clock and battery drawn over the
         * title). A pageSheet is already inset below it by iOS and needs
         * nothing. Rounded corners are likewise a pageSheet affordance — a
         * full-screen surface has no card edge to round, and curving it just
         * exposes whatever is behind the notch.
         */
        paddingTop: fullScreen ? insets.top : 0,
        /*
         * The whole sheet gets shorter while the keyboard is up.
         *
         * This is what makes the footer sit ON the keyboard and the body
         * scrollable within what is left. Padding the footer bar alone (the
         * previous approach) moved the button's pixels but not the column's
         * height, so the ScrollView above still believed it had the full screen
         * and would not scroll a low field — the loan term — out from under the
         * keyboard.
         *
         * Only applied when there is a footer, matching `useKeyboardHeight`'s
         * own gate: a sheet without one has nothing to pin and iOS handles a
         * plain scroll view's keyboard avoidance perfectly well.
         */
        paddingBottom: keyboardHeight,
        ...(fullScreen
          ? null
          : {
              /*
               * A rounder top than the OS gives a pageSheet.
               *
               * The native presentation already curves its own corners, but at
               * a radius fixed by iOS — softer than the app's own cards, which
               * makes a sheet read as a system surface rather than part of the
               * product. Drawing our own on top matches the rest of the UI;
               * `overflow: hidden` keeps the header's fill inside the curve
               * rather than squaring it off.
               */
              borderTopLeftRadius: SHEET_TOP_RADIUS,
              borderTopRightRadius: SHEET_TOP_RADIUS,
              overflow: 'hidden' as const,
            }),
      }}
    >
      {/* Rich header: icon tile + optional eyebrow + title + close. Sits just
          below the native grabber. */}
      {title ? (
        <>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingLeft: space.lg,
              paddingRight: space.lg - space.xs,
              paddingTop: space.md,
              paddingBottom: space.md,
            }}
          >
            {onBack ? (
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={({ pressed }) => ({
                  width: 40,
                  height: 40,
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                })}
              >
                <Ionicons name="chevron-back" size={24} color={colors.inkSecondary} />
              </Pressable>
            ) : (
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.md,
                  backgroundColor: iconColor ?? colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* A node passed through as-is keeps its own colours; a name
                    is drawn as the usual white glyph on the tinted tile. */}
                {React.isValidElement(icon) ? (
                  icon
                ) : (
                  <Ionicons
                    name={((icon as keyof typeof Ionicons.glyphMap) ?? 'albums-outline') as never}
                    size={20}
                    color="#FFFFFF"
                  />
                )}
              </View>
            )}
            <View style={{ flex: 1 }}>
              {eyebrow ? (
                <Text variant="caption" tone="muted">
                  {eyebrow.toUpperCase()}
                </Text>
              ) : null}
              {/* Two lines when wrapping, so a long name is readable without
                  the header growing without bound. */}
              <Text variant="heading" numberOfLines={wrapTitle ? 2 : 1}>
                {title}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
              })}
            >
              <Ionicons name="close" size={24} color={colors.inkSecondary} />
            </Pressable>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline }} />
        </>
      ) : null}

      {/* Body — optionally a keyboard-aware scroll area so it flexes and the
          footer pins to the bottom. */}
      {scroll ? (
        /*
          `keyboardDismissMode="interactive"` lets a downward drag dismiss the
          keyboard. Deliberately NOT `automaticallyAdjustKeyboardInsets`: the
          column already shrinks by the keyboard height (see the wrapper's
          `paddingBottom`), and adding the OS inset on top would double-count
          it — leaving the body scrollable past a gap the size of the keyboard.
        */
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: space.lg,
            gap: space.lg,
            /*
             * Room at the end for the footer, which DRAWS OVER this content.
             *
             * The footer is a sibling of the scroll area, not part of it, so
             * anything within its height of the end could not be scrolled into
             * view at all — tapping the last field on a long form (the loan
             * term, say) focused an input that then sat behind the button, or
             * behind the keyboard, with no amount of scrolling able to reveal
             * it. Same failure `FOOTER_CLEARANCE` documents for `PinnedFooter`;
             * it was simply never applied to the sheet.
             *
             * `space.lg` alone is right when there is no footer to clear.
             */
            /*
             * Plus the KEYBOARD's height while it is up.
             *
             * Without it the content ends where it always did, so a field near
             * the bottom sits under the keyboard with nothing below it to
             * scroll into view. `decimal-pad` has no return key, so on a form
             * with two amounts — the split editor — typing into the first left
             * the second unreachable and the keyboard undismissable.
             *
             * Added to the existing clearance rather than replacing it: the
             * footer is still pinned above the keyboard and still needs its
             * own room.
             */
            paddingBottom: (footer ? FOOTER_CLEARANCE : space.lg) + keyboardHeight,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : footer ? (
        /*
          A non-scrolling body still has to FILL the sheet when there is a
          footer beneath it.

          Rendering `children` bare left the column exactly as tall as its
          content, so the footer stopped wherever the content happened to end —
          the date picker's Today/Yesterday buttons sat mid-screen with a tall
          band of empty sheet below them, rather than pinned at the bottom
          where a thumb is.

          `flex: 1` on a wrapper does what the ScrollView's own `flex: 1` does
          on the other branch: take the remaining height so the footer is
          pushed to the foot of the sheet. Only applied when there IS a footer
          — a footerless sheet is deliberately sized to its content, which is
          what lets a short one stay short.
        */
        <View style={{ flex: 1 }}>{children}</View>
      ) : (
        children
      )}

      {/*
        Pinned footer — sits directly on top of the keyboard when it is open.

        The lift is done by PADDING THE COLUMN (see the `paddingBottom` on the
        wrapper above), not by padding this bar. Growing this bar's own bottom
        padding by the keyboard height was the old approach and it did not work:
        the column stayed the same height, so the scroll area never shrank and
        the button merely grew a tall transparent skirt behind the keyboard
        while the body kept its original size.

        Padding the column instead makes the whole sheet genuinely shorter while
        the keyboard is up, which is what lets the ScrollView above scroll a
        focused field into the remaining space.
      */}
      {footer ? (
        <View
          style={{
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
            // No keyboard term here: the column carries it. The home-indicator
            // inset is only wanted when the keyboard is CLOSED — with it open,
            // the keyboard already covers that area and the gap reads as a hole.
            paddingBottom: (keyboardHeight > 0 ? 0 : insets.bottom) + space.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.hairline,
            backgroundColor: colors.surface,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

export function BottomSheet(props: SheetProps) {
  const { colors } = useTheme();

  // Route sheets are already the native sheet (the expo-router 'modal' screen),
  // so they render the chrome directly — one presentation, identical to the
  // inline "add bill" sheet. Inline sheets wrap the chrome in their own native
  // `<Modal presentationStyle="pageSheet">`.
  if (props.asRoute) {
    if (!props.visible) return null;
    return <SheetChrome {...props} />;
  }

  return (
    <Modal
      visible={props.visible}
      // The native iOS card sheet: slides up, shows the screen behind at the
      // top, has the system grabber, and can be swiped down to dismiss.
      // `fullScreen` opts out for content that needs the whole height (the PIN
      // pad), where the inset card would clip a fixed-size keypad.
      presentationStyle={props.fullScreen ? 'fullScreen' : 'pageSheet'}
      animationType="slide"
      /*
       * The modal's backdrop, which defaults to WHITE.
       *
       * `SheetChrome` rounds the sheet's top corners more than iOS rounds a
       * pageSheet, and the backdrop shows through that difference — four bright
       * notches at the top of every sheet, glaring against a dark surface.
       * Painting the backdrop with the same surface colour makes the gap
       * invisible.
       *
       * `transparent` would be the other way to do it, but RN explicitly warns
       * that it is unsupported alongside a presentationStyle.
       */
      backdropColor={colors.surface}
      // Fires for both the swipe-down dismiss and the Android hardware back.
      onRequestClose={props.onClose}
    >
      <SheetChrome {...props} />
    </Modal>
  );
}
