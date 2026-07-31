import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './ui';

/**
 * The branded screen shown over the app while it gets ready.
 *
 * Two jobs, which is why it is an *overlay* rather than a route:
 *
 *  1. **Cold start** — covers the gap between the process launching and the
 *     dashboard having data to draw. Without it the user sees a bare canvas,
 *     then a spinner, then content popping in.
 *  2. **After unlocking** — the lock screen disappears the instant Face ID
 *     succeeds, but the dashboard behind it still has a frame or two of layout
 *     to do. Keeping this on top until the screen reports itself ready means the
 *     handoff is a fade from the brand, not a flash of half-drawn balances.
 *
 * Rendered absolutely over the navigator and faded out, so the content beneath
 * has already mounted and settled by the time it becomes visible. A route would
 * have to unmount to reveal anything, which is the pop this exists to avoid.
 *
 * Animation is deliberately short and non-blocking: it runs on the native
 * driver, and `onFinished` is driven by *readiness*, never by the animation —
 * a splash that outstays the app being ready is just a delay with a logo on it.
 */
export function SplashOverlay({
  /** Fade out once this is true. The animation never gates it. */
  ready,
  /** Called after the fade completes, so the parent can stop rendering this. */
  onFinished,
  /**
   * `waiting` holds the screen as a plain canvas — nothing drawn — for the
   * stretch where the system biometric sheet is up. `playing` runs the brand
   * sequence.
   *
   * One component for both because they are one surface: the app never shows a
   * lock screen and then a splash, it shows a single canvas that stays put and
   * begins animating once authentication has happened. Two components meant two
   * mounts, and every ordering bug in this flow came from the handoff between
   * them.
   */
  phase = 'playing',
}: {
  ready: boolean;
  onFinished: () => void;
  phase?: 'waiting' | 'playing';
}) {
  const MARK_SIZE = useMarkSize();
  // The *resolved* mode, so a user who forced light/dark gets that, not the OS.
  const { mode } = useTheme();
  const palette = SPLASH_THEME[mode === 'dark' ? 'dark' : 'light'];

  // Three separate values so the mark can settle while the wordmark is still
  // arriving — one shared value would force them to move in lockstep.
  const markScale = React.useRef(new Animated.Value(0.82)).current;
  const markOpacity = React.useRef(new Animated.Value(0)).current;
  const wordOpacity = React.useRef(new Animated.Value(0)).current;
  const wordShift = React.useRef(new Animated.Value(8)).current;
  const overlayOpacity = React.useRef(new Animated.Value(1)).current;
  /** The halos behind the mark: swell in with it, then collapse to nothing. */
  const haloOpacity = React.useRef(new Animated.Value(0)).current;
  /*
   * Starts at 0.5, not 0.9: the halo should read as *growing out of* the plain
   * canvas rather than easing in from something already almost full size. Paired
   * with `haloOpacity` at 0 the first frame is a blank white screen, which is
   * the "background circle white, then pulse in" beat.
   */
  const haloScale = React.useRef(new Animated.Value(0.5)).current;
  /**
   * 0 → 1 → 0, driving the halo's light → deeper → light cycle.
   *
   * Feeds **opacity**, not `backgroundColor`. That is the whole reason this
   * animation is smooth: `backgroundColor` has no native implementation, so
   * animating it drops the loop onto the JS driver — and the JS thread is
   * exactly what a cold launch blocks. `initialiseDatabase()` runs synchronous
   * SQLite (migrations, seeding, then a full store refresh), and every
   * JS-driven frame during that window is simply not rendered, which is the
   * freeze this replaces.
   *
   * The visual is identical: a fixed deep-tint layer fading in and out over a
   * fixed light one reads as the colour deepening, and opacity IS native.
   */
  const haloTint = React.useRef(new Animated.Value(0)).current;
  /**
   * True once the pulse has completed its in-and-out round trip.
   *
   * The fade waits for this so it always begins on the downbeat rather than
   * cutting the motion off mid-swell — the difference between the splash
   * *finishing* and merely stopping.
   */
  const [pulseComplete, setPulseComplete] = React.useState(false);


  /*
   * ONE choreographed sequence, not an entrance plus an open-ended loop.
   *
   * The brief is a single beat: pulse in, pulse out, fade. So the whole thing
   * is scripted end to end and the fade only starts once the pulse has fully
   * come back down — it lands as one motion instead of a loop being cut off
   * wherever it happened to be.
   *
   * Order of departure is staggered outside-in: the halo collapses to nothing,
   * the mark follows partway through and collapses too, and only then does the
   * overlay dissolve — by which point the screen is already an empty canvas.
   * Total ~1740ms.
   *
   * Every leg is native-driven. Measured on an iPhone 13 Pro, the JS thread
   * stalls ~550ms on the first frame of a dev launch no matter what is on
   * screen, so anything JS-driven here would visibly hitch.
   */
  React.useEffect(() => {
    // Nothing animates while waiting on authentication — the values stay at
    // their initial (invisible) state so the brand appears only once the
    // sequence genuinely starts.
    if (phase !== 'playing') return;

    const sequence = Animated.sequence([
      // 1 · Pulse IN. The mark and wordmark arrive while the halo swells from
      //     nothing to its widest — the "circle grows out of white" beat.
      Animated.parallel([
        Animated.timing(markScale, {
          toValue: 1,
          duration: PULSE_IN,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
        Animated.timing(markOpacity, {
          toValue: 1,
          duration: PULSE_IN * 0.55,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(haloOpacity, {
          toValue: 1,
          duration: PULSE_IN * 0.7,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(haloScale, {
          toValue: 1.12,
          duration: PULSE_IN,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(haloTint, {
          toValue: 1,
          duration: PULSE_IN,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(wordOpacity, {
          toValue: 1,
          duration: PULSE_IN * 0.6,
          delay: PULSE_IN * 0.25,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(wordShift, {
          toValue: 0,
          duration: PULSE_IN * 0.7,
          delay: PULSE_IN * 0.25,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
      ]),

      /*
       * 2 · Pulse OUT — everything collapses to nothing, outside-in.
       *
       * The halo goes first, then the mark and wordmark a beat behind it, so by
       * the time this leg ends the screen is a plain canvas with nothing on it.
       * Anything left standing here would have to be disposed of by the fade,
       * which reads as the splash being switched off rather than finishing.
       *
       * `haloOpacity` is driven here rather than left to the fade because
       * `tintOpacity` derives from it: taking it to 0 retires the deeper rings
       * on the same curve, so the whole halo leaves as one piece.
       */
      Animated.parallel([
        Animated.timing(haloScale, {
          toValue: 0,
          duration: PULSE_OUT,
          // Accelerating inward: slow release, then a decisive collapse, which
          // is what gives the downbeat something to land on.
          easing: Easing.bezier(0.55, 0, 0.75, 0.2),
          useNativeDriver: true,
        }),
        Animated.timing(haloOpacity, {
          toValue: 0,
          duration: PULSE_OUT,
          easing: Easing.bezier(0.55, 0, 0.75, 0.2),
          useNativeDriver: true,
        }),
        Animated.timing(haloTint, {
          toValue: 0,
          duration: PULSE_OUT * 0.8,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),

        /*
         * The mark follows the halo out, deliberately late, and shrinks all the
         * way to nothing — the same collapse the halo just made, one beat
         * behind, so the motion passes inward from the ring to the icon.
         *
         * `delay` rather than a separate sequence step: the two overlap, so the
         * icon is already contracting as the ring closes around it. Starting it
         * only after the halo had fully gone would read as two disconnected
         * events instead of one gesture.
         *
         * The wordmark goes with it. Leaving it behind would strand a line of
         * text on an empty canvas for the fade to clear, which is the same
         * mistake the halo's old `0.98` stop made.
         */
        Animated.timing(markScale, {
          toValue: 0,
          duration: MARK_OUT,
          delay: MARK_DELAY,
          easing: Easing.bezier(0.55, 0, 0.75, 0.2),
          useNativeDriver: true,
        }),
        Animated.timing(markOpacity, {
          toValue: 0,
          duration: MARK_OUT,
          delay: MARK_DELAY,
          easing: Easing.bezier(0.55, 0, 0.75, 0.2),
          useNativeDriver: true,
        }),
        Animated.timing(wordOpacity, {
          toValue: 0,
          // Slightly quicker than the mark: text reads as clutter once it starts
          // leaving, so it clears out from under the icon rather than lingering.
          duration: MARK_OUT * 0.75,
          delay: MARK_DELAY,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    sequence.start(() => setPulseComplete(true));
    return () => sequence.stop();
  }, [
    phase,
    markScale,
    markOpacity,
    wordOpacity,
    wordShift,
    haloOpacity,
    haloScale,
    haloTint,
  ]);

  /*
   * Exit — begins only once the app is ready AND the pulse has come back down.
   *
   * Gating on `pulseComplete` is what makes this land: the fade rides the
   * downbeat of the contraction rather than interrupting the motion wherever it
   * happened to be. The app is almost always ready long before the pulse
   * finishes, so in practice the pulse is what sets the pace — which is the
   * point, and why there is no separate minimum-duration timer any more.
   *
   * By the time this runs the halo has already collapsed to nothing, so this
   * leg only has the mark, the wordmark and the canvas left to take away.
   */
  React.useEffect(() => {
    if (phase !== 'playing' || !ready || !pulseComplete) return;

    const exit = Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: FADE_OUT,
        // Weighted late, so the content underneath is fully laid out by the
        // time it becomes visible through the overlay.
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      /*
       * `markScale` is deliberately NOT animated here.
       *
       * The stagger above already has the mark contracting, and lifting it back
       * up during the fade would be the two writing the same value in opposite
       * directions — visibly a stutter right at the handoff. The mark keeps
       * shrinking under its own curve and the overlay simply fades over it.
       */
      // The halo is deliberately absent here: pulse OUT already took it to 0.
      // Re-animating a value that is already at its target would be a no-op
      // that implies the halo is still on screen at this point. It is not.
    ]);

    /*
     * `onFinished` fires unconditionally, NOT only when `finished` is true.
     *
     * An interrupted animation reports `finished: false`, and gating the
     * callback on it means any interruption leaves the overlay mounted at
     * whatever opacity it reached, covering the app with no way out. The
     * callback only makes the parent stop rendering something already faded,
     * so calling it early is harmless; never calling it is not.
     */
    exit.start(() => onFinished());

    // If the driver never calls back at all (a backgrounded app can suspend
    // animations mid-flight), this still clears the overlay.
    const failsafe = setTimeout(onFinished, FADE_OUT + 500);

    return () => {
      exit.stop();
      clearTimeout(failsafe);
    };
  }, [phase, ready, pulseComplete, overlayOpacity, markScale, onFinished]);

  /*
   * Multiplied by `haloOpacity`, so the deeper rings inherit the entrance fade
   * and the exit. Without this they would be visible before the halos arrive
   * and would linger after they leave — `Animated.multiply` composes the two on
   * the native driver, so it stays free.
   */
  const tintOpacity = Animated.multiply(haloOpacity, haloTint);

  return (
    <Animated.View
      /*
       * `none` during the animation so a tap landing mid-fade reaches the
       * screen underneath. While *waiting* it must be `auto`, or the retry
       * button after a failed scan could not be pressed.
       */
      pointerEvents={phase === 'waiting' ? 'auto' : 'none'}
      style={[
        StyleSheet.absoluteFill,
        {
          /*
           * Pure white, not `colors.canvas` (#F7F9FB).
           *
           * The launch screen the OS shows before any JS runs is white, so
           * matching it exactly makes the handoff invisible — the faint blue-grey
           * canvas read as a subtle flash at the moment this mounted. Deliberately
           * not theme-dependent for the same reason: the native launch screen has
           * no dark variant, so a dark splash would flash against it.
           */
          backgroundColor: palette.canvas,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: overlayOpacity,
          zIndex: 10,
        },
      ]}
    >
      {/*
        While waiting on authentication this is a plain canvas with a status
        line held in the upper third — the system sheet sits over the middle,
        so anything centred would be hidden behind it.
      */}
      <View style={{ alignItems: 'center', gap: 30 }}>
        <Animated.View
          style={{
            opacity: markOpacity,
            transform: [{ scale: markScale }],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Two concentric halos in the brand tint, sized off the mark so the
              whole cluster scales together. They give the logo somewhere to sit
              — at this size a bare rounded square floats on the canvas — and
              they breathe, which is what keeps a launch screen from reading as
              a frozen frame while the database opens. */}
          {/*
            Each halo is a fixed LIGHT ring with a fixed DEEPER ring stacked on
            top of it, and only the deeper one's opacity animates.

            That is what makes the colour cycle native-drivable: `opacity` has a
            native implementation and `backgroundColor` does not, so this reads
            identically to interpolating the colour while never touching the JS
            thread — which a cold launch blocks solid with synchronous SQLite.
          */}
          <Animated.View
            style={{
              position: 'absolute',
              width: MARK_SIZE * 1.9,
              height: MARK_SIZE * 1.9,
              borderRadius: (MARK_SIZE * 1.9) / 2,
              backgroundColor: withAlpha(palette.accent, 0.05),
              opacity: haloOpacity,
              transform: [{ scale: haloScale }],
            }}
          />
          <Animated.View
            style={{
              position: 'absolute',
              width: MARK_SIZE * 1.9,
              height: MARK_SIZE * 1.9,
              borderRadius: (MARK_SIZE * 1.9) / 2,
              backgroundColor: withAlpha(palette.accent, 0.1),
              opacity: tintOpacity,
              transform: [{ scale: haloScale }],
            }}
          />

          <Animated.View
            style={{
              position: 'absolute',
              width: MARK_SIZE * 1.42,
              height: MARK_SIZE * 1.42,
              borderRadius: (MARK_SIZE * 1.42) / 2,
              backgroundColor: withAlpha(palette.accent, 0.1),
              opacity: haloOpacity,
              transform: [{ scale: haloScale }],
            }}
          />
          <Animated.View
            style={{
              position: 'absolute',
              width: MARK_SIZE * 1.42,
              height: MARK_SIZE * 1.42,
              borderRadius: (MARK_SIZE * 1.42) / 2,
              backgroundColor: withAlpha(palette.accent, 0.18),
              opacity: tintOpacity,
              transform: [{ scale: haloScale }],
            }}
          />

          <LinearGradient
            colors={palette.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: MARK_SIZE,
              height: MARK_SIZE,
              // iOS-style continuous-ish curvature: ~28% of the side reads as a
              // squircle rather than a rounded box at this scale.
              borderRadius: MARK_SIZE * 0.28,
              alignItems: 'center',
              justifyContent: 'center',
              // Lifts the mark off the canvas so the halos read as glow behind
              // it rather than as flat rings drawn around it.
              shadowColor: palette.accent,
              shadowOpacity: 0.32,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
              elevation: 12,
            }}
          >
            <Ionicons name="wallet" size={MARK_SIZE * 0.46} color="#FFFFFF" />
          </LinearGradient>
        </Animated.View>

        <Animated.View
          style={{
            opacity: wordOpacity,
            transform: [{ translateY: wordShift }],
            alignItems: 'center',
            gap: 6,
          }}
        >
          {/*
            Colours pinned, not taken from the theme.

            The background above is hardcoded white to match the OS launch
            screen, so theme ink cannot be used here: in dark mode `ink` is
            #F3F6FA — near-white text on a white field, effectively invisible.
            These are the light theme's own ink values, which is what this
            surface is regardless of the user's setting.
          */}
          <Text variant="display" color={palette.ink}>
            Money Manager
          </Text>
          <Text variant="small" color={palette.inkMuted}>
            Plan every rupee
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/**
 * Side of the logo tile, derived from the current window so it is generous on a
 * Pro and still comfortable on an SE rather than a fixed size that is wrong on
 * both. Everything else in the mark — corner radius, icon, halos — is a
 * multiple of this, so the cluster scales as one piece.
 *
 * A hook, not a module-level `Dimensions.get()`: that is evaluated once at
 * import and so is stale after a rotation or in split view, and it makes the
 * module's first render depend on a native module being ready at import time.
 */
/**
 * A hex colour at a given alpha, as `rgba(...)`.
 *
 * `Animated.interpolate` can only cross-fade colours it can parse into
 * channels, and it handles `rgba()` — but the theme stores `#RRGGBB`, and
 * appending an 8-digit alpha suffix (the `${color}1F` trick used elsewhere in
 * this app) is *not* interpolatable. Converting here keeps the theme as the one
 * source of the hue while giving the animation something it can actually blend.
 */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  // Expand the #abc shorthand so both forms are accepted.
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The three beats, summing to 1900ms — inside the 2s budget with headroom for
 * the frame the fade's callback lands on.
 *
 * Pulse OUT is shorter than IN on purpose: a contraction that takes as long as
 * the expansion reads as hesitant, and the fade overlaps it anyway.
 */
const PULSE_IN = 800;
/** The halo's collapse. The mark's is staggered behind it, below. */
const PULSE_OUT = 460;
/** How far into the halo's collapse the mark starts its own. */
const MARK_DELAY = 220;
/** The mark's collapse to nothing. */
const MARK_OUT = 460;
/**
 * The overlay's own dissolve.
 *
 * Short, because by the time it runs the screen is already empty — the halo,
 * mark and wordmark have all collapsed. This only has the plain canvas left to
 * take away, so a long fade here would just be dead time.
 */
const FADE_OUT = 260;

/**
 * The splash's palette, per theme.
 *
 * Exported because the blank canvases shown BEFORE the splash — the lock gate's
 * holding screens and the root layout's wrapper — must use the exact same
 * background. The app's own `colors.canvas` is #F7F9FB in light mode, so
 * pairing it with the splash's #FFFFFF put a visible seam at the moment the
 * overlay mounted.
 *
 * Held here rather than read from `useTheme` because this surface has to agree
 * with the OS launch screen that precedes it, not with the app's chrome. The
 * two are separate systems: iOS shows its own static image before any JS runs,
 * and a mismatch between that and the first React frame reads as a flash.
 *
 * Both variants are therefore explicit, and the accent is the LIGHT theme's in
 * both — dark mode's lighter blue is tuned for a dark app surface, and on the
 * splash's near-black it renders as a pale wash rather than a glow.
 */
export const SPLASH_THEME = {
  light: {
    canvas: '#FFFFFF',
    ink: '#101828',
    inkMuted: '#5B6472',
    accent: '#0F6FDE',
    gradient: ['#0F6FDE', '#0FA8A0'] as const,
  },
  dark: {
    canvas: '#0B1220',
    ink: '#F3F6FA',
    inkMuted: '#A7B1C2',
    accent: '#4A9BF5',
    gradient: ['#1E7FE0', '#1FBFAE'] as const,
  },
} as const;

function useMarkSize(): number {
  const { width } = useWindowDimensions();
  return Math.round(Math.max(112, Math.min(148, width * 0.34)));
}
