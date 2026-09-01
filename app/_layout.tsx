import { Stack, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppLockGate } from '~/shared/components/AppLockGate';
import { SplashOverlay, SPLASH_THEME } from '~/shared/components/SplashOverlay';
import { ThemeProvider, useTheme } from '~/shared/theme/ThemeProvider';
import { extractSmsFromUrl, looksTruncated } from '~/features/sms/logic/smsIntakeUrl';
import { logSmsIntake } from '~/features/sms/logic/smsIntakeLog';
import { selectCategoryViews, selectSavingPlans, useAppStore } from '../src/store/useAppStore';
import { syncCategoryReminders } from '~/shared/lib/notifications';
import { Text } from '~/shared/components/ui';

/**
 * Options for a route whose screen renders its content inside the shared
 * BottomSheet. The route presents as the native iOS sheet (`presentation:
 * 'modal'` = pageSheet), and the screen renders `<BottomSheet asRoute ...>` so
 * the BottomSheet draws only its chrome inside that one native sheet — same
 * single-presentation behaviour as the inline "add bill" sheet. One constant so
 * every sheet route is configured identically.
 */
const SHEET_ROUTE = { presentation: 'modal' } as const;

/**
 * How long before the splash gives up waiting and leaves anyway.
 *
 * Every other condition it waits on can fail to arrive: a database that never
 * finishes opening, a biometric prompt the user walks away from, a bug that
 * leaves `ready` false. Without a ceiling the overlay covers the app forever
 * with no way to say why — which is exactly the "splash stuck" symptom. Eight
 * seconds is far past any healthy launch, so this only ever fires when
 * something is genuinely wrong, and revealing whatever is underneath (the lock
 * screen, an error, an empty dashboard) is strictly better than a frozen brand.
 */
const SPLASH_TIMEOUT_MS = 8000;

/**
 * How long the screen holds after a successful unlock, before the brand fades
 * in.
 *
 * Covers two things at once: the system biometric sheet dismissing with its own
 * animation, and the waiting text fading out. Starting the brand on the same
 * frame put all three on screen together. A second lets the sheet and the text
 * clear, leaving a plain canvas for the splash to rise into.
 */
const POST_UNLOCK_PAUSE_MS = 1000;

function RootNavigator() {
  const theme = useTheme();
  const router = useRouter();
  const ready = useAppStore((s) => s.ready);
  const needsOnboarding = useAppStore((s) => s.needsOnboarding);
  const initialise = useAppStore((s) => s.initialise);
  const [startupError, setStartupError] = useState<string | null>(null);
  /** True once the splash has faded; one-way, so it never replays on resume. */
  const [splashDone, setSplashDone] = useState(false);
  /**
   * True once the lock has been satisfied — or immediately when App Lock is off.
   * The splash waits on this so it can cover the unlock handoff.
   */
  const [unlockedOnce, setUnlockedOnce] = useState(false);
  /** True one frame after the content below has had a chance to lay out. */
  const [painted, setPainted] = useState(false);
  /**
   * True once we have waited long enough that something is clearly wrong. The
   * splash then leaves regardless — see the note on SPLASH_TIMEOUT_MS.
   */
  const [timedOut, setTimedOut] = useState(false);

  const appLockEnabled = useAppStore((s) => s.appLockEnabled);

  /*
   * Stable identity, deliberately.
   *
   * An inline arrow here is a new function every render, which re-runs the
   * overlay's exit effect and restarts the fade from the top each time — the
   * animation visibly stutters and can never complete. `useCallback` with an
   * empty dep list makes the exit run exactly once.
   */
  // Same canvas the splash uses, so the two never seam — see SPLASH_THEME.
  const splashCanvas = SPLASH_THEME[theme.mode === 'dark' ? 'dark' : 'light'].canvas;

  const handleSplashFinished = useCallback(() => setSplashDone(true), []);

  /*
   * Stable identity, same reason as above: `AppLockGate` lists this in an
   * effect's deps, so an inline arrow would re-run that effect on every render
   * and call back in a loop.
   */
  const handleUnlocked = useCallback(() => setUnlockedOnce(true), []);

  /**
   * True while the gate is closed and waiting on a biometric scan. Holds the
   * overlay in its `waiting` phase — a plain canvas — so the system sheet is the
   * only thing on screen until authentication succeeds.
   */
  const [waiting, setWaiting] = useState(false);
  const handleWaiting = useCallback((next: boolean) => setWaiting(next), []);

  /*
   * A beat between the scan succeeding and the splash appearing.
   *
   * The biometric sheet dismisses with its own animation, and starting the
   * brand immediately meant the two overlapped — the splash was already fading
   * up while iOS was still sliding the sheet away. A short pause lets the
   * system finish before the app's own sequence begins.
   *
   * Held separately from `unlockedOnce` rather than delaying that: it also
   * gates `contentReady` and the paint frame, and holding those back would
   * delay the dashboard's own layout for no reason.
   */
  const [splashArmed, setSplashArmed] = useState(false);
  useEffect(() => {
    if (!unlockedOnce) return;
    const timer = setTimeout(() => setSplashArmed(true), POST_UNLOCK_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [unlockedOnce]);

  /*
   * When the splash may go.
   *
   * Not simply `ready`: with App Lock on, the store is ready long before the
   * user has authenticated, and fading then would show the dashboard behind the
   * lock screen. So it waits for the unlock too — and then for one more frame,
   * because the screen underneath mounts on the tick the gate stops covering it
   * and needs that frame to lay out. Fading on the same tick is the flash of
   * half-drawn balances this is meant to prevent.
   *
   * There is no minimum-duration timer here any more: the overlay itself waits
   * for its pulse to complete before fading, so the animation sets the pace and
   * this only has to report when the *app* is ready.
   *
   * `timedOut` is the escape hatch, and the reason this cannot stick: every
   * other input can fail to arrive (a database that never opens, a biometric
   * prompt that is never answered), and without it the overlay would sit there
   * forever with no way to report why.
   */
  const contentReady = ready && (!appLockEnabled || unlockedOnce) && painted;
  const splashReady = timedOut || contentReady;

  /*
   * The ceiling, timed from when the splash actually goes UP — not from launch.
   *
   * With App Lock on, the overlay only mounts after authentication, which can
   * take as long as the user takes to look at their phone. A timer started at
   * launch could therefore already have expired by then, and the splash would
   * flash and vanish instead of playing. Starting it with `unlockedOnce` means
   * the eight seconds always measure the splash's own life.
   */
  /*
   * `ready` is required here for the same reason AppLockGate needs it:
   * `appLockEnabled` is `false` until SQLite answers, so `!appLockEnabled` is
   * briefly true on the first render even when the lock IS on. The splash
   * mounted in that gap and the Face ID sheet then appeared over it — the two
   * on screen together, which is not the order asked for. Waiting for the store
   * means the lock state is known before anything is shown.
   */
  /*
   * ONE surface for the whole launch.
   *
   * It is up from the moment the store is ready until the brand has played, and
   * its `phase` decides what it draws: a status line while authentication is
   * pending, the animation once that has succeeded. There is no separate lock
   * screen and no gap between the two to get wrong.
   */
  const splashPhase: 'waiting' | 'playing' = waiting || !splashArmed ? 'waiting' : 'playing';
  const splashShowing =
    ready && !splashDone && (waiting || !appLockEnabled || splashArmed);

  /*
   * Withhold the navigator until either the splash is covering it or the whole
   * sequence is done. Also covers the pre-`ready` frames, which is what the
   * bare `!ready` check used to do on its own.
   */
  const holdContent = !ready || (appLockEnabled && unlockedOnce && !splashArmed);
  useEffect(() => {
    if (!splashShowing) return;
    const timer = setTimeout(() => setTimedOut(true), SPLASH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [splashShowing]);

  // The extra frame. `requestAnimationFrame` rather than a timeout: it is tied
  // to the render loop, so it costs exactly one frame on a fast device instead
  // of an arbitrary wait everyone pays.
  useEffect(() => {
    if (!ready || (appLockEnabled && !unlockedOnce)) return;
    const handle = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(handle);
  }, [ready, appLockEnabled, unlockedOnce]);

  useEffect(() => {
    let cancelled = false;

    // Database setup must succeed for the app to work; reminders must not be
    // able to break startup, so they are awaited separately and swallowed.
    initialise()
      .then(() => {
        // Remind about categories that still need money moved into them.
        const state = useAppStore.getState();
        const reminders = selectCategoryViews(state)
          .filter((view) => view.summary.shortfallMinor > 0)
          .map((view) => ({
            categoryId: view.category.id,
            categoryName: view.category.name,
            shortfallMinor: view.summary.shortfallMinor,
            dueDay: view.category.dueDay,
          }));

        // Plus anything saving toward a date — insurance expiring, an
        // installment plan ending — warned ahead of its due day.
        const planReminders = selectSavingPlans(state)
          .filter((plan) => !plan.progress.isComplete)
          .map((plan) => ({
            categoryId: plan.subcategory.id,
            categoryName: `${plan.subcategory.name} due`,
            shortfallMinor: plan.progress.remainingMinor,
            dueDay: plan.plan.dueDate.getDate(),
          }));

        void syncCategoryReminders([...reminders, ...planReminders]).catch((error) =>
          console.warn('Reminder sync skipped:', error),
        );
      })
      .catch((error: unknown) => {
        console.error('Startup failed', error);
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialise]);

  /**
   * Catch SMS deep links that arrive while the app is *already running*.
   *
   * The `sms/index` route handles a cold start, but on a warm start iOS hands
   * the URL to this listener and expo-router may not remount that route at all
   * — which is why a second bank SMS in the same session appeared to do
   * nothing. Ingesting here makes every delivery behave the same, and the
   * store's raw-text dedupe keeps a doubled event from queuing twice.
   */
  useEffect(() => {
    /*
     * Attached immediately, NOT gated on `ready`.
     *
     * A Shortcut delivers its URL the instant the app launches — while the
     * database is still opening. Waiting for `ready` before subscribing meant
     * that event fired into a void and the message was lost, which is the
     * "Shortcut opened the app but no draft appeared" case. Anything arriving
     * before the store is ready is buffered and replayed by the effect below.
     */
    const pending: string[] = [];

    /**
     * Push whatever is buffered into the store, if it can accept it now.
     *
     * Called from BOTH the store subscription and directly after buffering.
     * The direct call is not redundant — it closes a race that silently ate
     * messages: `initialise()` and `Linking.getInitialURL()` are both async, so
     * `ready` can flip to true *before* the initial-URL promise settles. In that
     * ordering the text is buffered after the last `setState`, the subscription
     * never fires again, and the message is lost with no error — precisely the
     * "the Shortcut opened the app but no draft appeared" report.
     */
    const drain = () => {
      const state = useAppStore.getState();
      if (!state.ready || pending.length === 0) return;
      for (const text of pending.splice(0)) {
        const id = state.ingestSmsText(text);
        // The one outcome that looks identical to success from outside: the URL
        // arrived and was decoded, but `parseSms` did not recognise it as a
        // money movement, so nothing is queued and the dashboard stays empty.
        // Logging it turns "the app opened but no draft appeared" into a
        // specific, fixable fact about the message.
        logSmsIntake(
          id === 'duplicate'
            ? 'duplicate'
            : id
              ? 'ingested'
              : looksTruncated(text)
                ? 'truncated'
                : 'parser-rejected',
          text,
        );
      }
    };

    const handle = (url: string | null) => {
      if (!url) return;
      const text = extractSmsFromUrl(url);
      if (!text) {
        // The URL reached the app but carried no usable `text=` — a Shortcut
        // wired to the wrong action, or one that dropped the parameter.
        logSmsIntake('no-text-param', url);
        return;
      }
      pending.push(text);
      // Buffer first, then drain — so a message arriving while the database is
      // still opening waits, and one arriving afterwards lands immediately.
      drain();
    };

    // The URL that launched the app, for the cold-start case. `sms/index` also
    // reads this, but only if expo-router actually mounts that route — and a
    // launch that lands anywhere else drops the message silently. Reading it
    // here too makes the message land regardless of routing, and the store's
    // raw-text dedupe stops the two paths from double-queueing.
    void Linking.getInitialURL()
      .then(handle)
      .catch(() => {
        // A failed read must not break startup; the route may still catch it.
      });

    const subscription = Linking.addEventListener('url', ({ url }) => handle(url));

    // Drain whatever arrived before the store could accept it.
    const unsubscribe = useAppStore.subscribe(drain);

    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, []);

  // Redirect into onboarding only once the navigator below is actually
  // mounted — dispatching `router.replace` while this component is still
  // returning the loading spinner (i.e. before the Stack exists) causes
  // expo-router to re-queue the navigation on every render, which is an
  // infinite "Maximum update depth exceeded" loop, not a real redirect.
  useEffect(() => {
    if (ready && needsOnboarding) {
      /*
       * The welcome screen, not step 1 of setup.
       *
       * Someone opening the app on a NEW PHONE already has a plan and wants it
       * back — sending them straight into "pick your banks" asks them to
       * rebuild what they are about to restore, and the restore screen itself
       * lived behind this flow in Settings, so it was unreachable exactly when
       * it was needed. `welcome` offers the fork; picking "set up a new plan"
       * continues to `/onboarding/index` as before.
       */
      router.replace('/onboarding/welcome');
    }
  }, [ready, needsOnboarding, router]);

  // Surface the failure rather than spinning forever on a broken database.
  if (startupError) {
    return (
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 12,
          backgroundColor: theme.colors.canvas,
        }}
      >
        <Text variant="heading">Could not start</Text>
        <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>
          {startupError}
        </Text>
      </ScrollView>
    );
  }

  /*
   * The splash covers the launch instead of a bare spinner, and — when App Lock
   * is on — stays up past the unlock too.
   *
   * There is deliberately no early `if (!ready)` return rendering its own
   * overlay: that would mount a SECOND SplashOverlay, and the swap when `ready`
   * flipped would unmount one mid-animation and restart the other from the
   * beginning. One instance, mounted from the first render, is what makes the
   * entrance play exactly once. The navigator below simply renders nothing
   * useful until the store is ready, which the overlay is covering anyway.
   *
   * `splashDone` is one-way: once faded it never returns, so a later re-lock
   * shows the lock screen directly rather than replaying the brand.
   */
  return (
    /* Matches the splash's canvas — this is what shows during authentication
       and the pause before the brand fades in, so a mismatch would flash. */
    <View style={{ flex: 1, backgroundColor: splashCanvas }}>
      {/*
        `holdContent` covers the pause between the scan succeeding and the
        splash appearing. The gate reveals its children the instant `unlocked`
        flips, so without this the dashboard would be visible for that whole
        second — the balances on show before the brand covers them, which is
        the opposite of what the lock is for.
      */}
      <AppLockGate onUnlocked={handleUnlocked} onWaiting={handleWaiting}>
        {holdContent ? null : (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.canvas },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="category/[id]" />
          {/* Modal routes render their content inside the shared BottomSheet, so
              they present as the one app-wide sheet. `transparentModal` +
              `animation: none` lets the BottomSheet own the backdrop and slide. */}
          <Stack.Screen name="category/new" options={SHEET_ROUTE} />
          <Stack.Screen name="category/edit/[id]" options={SHEET_ROUTE} />
          <Stack.Screen name="subcategory/[id]" options={SHEET_ROUTE} />
          <Stack.Screen name="transaction/new" options={SHEET_ROUTE} />
          <Stack.Screen name="transaction/ongoing" options={SHEET_ROUTE} />
          <Stack.Screen name="account/[id]" options={SHEET_ROUTE} />
          <Stack.Screen name="sms/index" />
          <Stack.Screen name="sms/new" options={SHEET_ROUTE} />
          <Stack.Screen name="sms/[id]" options={SHEET_ROUTE} />
          <Stack.Screen name="settings/sms-automation" options={SHEET_ROUTE} />
          {/*
            Backup was missing from this list, so it rendered as a plain pushed
            screen: no sheet presentation, its header colliding with the status
            bar and no way to dismiss. A sheet route that is not registered here
            looks broken in a way the screen's own code cannot fix.
          */}
          <Stack.Screen name="settings/backup" options={SHEET_ROUTE} />
          <Stack.Screen name="settings/sms-history" options={SHEET_ROUTE} />
          {/*
            Fuel add-on — see core/miniApps.ts.

            Plain pushed screens, NOT sheets. This is a place the user goes and
            drills into (vehicles, services, individual fill-ups) rather than a
            task they finish and dismiss, so it wants a back chevron and a stack
            rather than modals piling on top of one another.

            Registered unconditionally: a route that exists but is unreachable
            costs nothing, whereas conditional registration would leave the
            dashboard card dead until the next reload.
          */}
          {/*
            Buddy loans add-on — see core/miniApps.ts.

            The list and one loan's detail are places you go and come back from,
            so they are pushed screens; the editor is a task that gets filled in
            and dismissed, so it is a sheet — the same split fuel and health use.
          */}
          <Stack.Screen name="mini/buddyloans/index" />
          <Stack.Screen name="mini/buddyloans/detail" />
          <Stack.Screen name="mini/buddyloans/edit" options={SHEET_ROUTE} />
          <Stack.Screen name="mini/fuel/index" />
          {/* Logging a fill-up IS a task — filled in once and dismissed — so it
              stays a sheet while the places around it are pushed screens. */}
          <Stack.Screen name="mini/fuel/entry" options={SHEET_ROUTE} />
          <Stack.Screen name="mini/fuel/vehicle" />
          <Stack.Screen name="mini/fuel/services" />
          {/*
            Health add-on — see core/miniApps.ts. Same reasoning as fuel above:
            pushed screens rather than sheets, because this is a place the user
            goes and drills into (people, medicines, individual visits).

            The forms are sheets, though. Each one is a task that gets filled in
            and dismissed, and the chooser that leads to them uses `replace` so
            backing out of a form returns to the timeline rather than to the
            chooser it came through.
          */}
          <Stack.Screen name="mini/health/index" />
          <Stack.Screen name="mini/health/prescriptions" />
          {/* Browsing destinations: places you go and come back from, so they
              are pushed screens like the timeline itself. */}
          <Stack.Screen name="mini/health/vitals" />
          <Stack.Screen name="mini/health/documents" />
          {/* One visit and everything that came out of it. A place you go
              and come back from, so a pushed screen rather than a sheet. */}
          <Stack.Screen name="mini/health/case" />
          <Stack.Screen name="mini/health/person" options={SHEET_ROUTE} />
          <Stack.Screen name="mini/health/medicine" options={SHEET_ROUTE} />
          <Stack.Screen name="mini/health/visit" options={SHEET_ROUTE} />
          <Stack.Screen name="mini/health/reading" options={SHEET_ROUTE} />
          <Stack.Screen name="mini/health/document" options={SHEET_ROUTE} />
        </Stack>
        )}
      </AppLockGate>

      {/*
        Outside the gate so it survives the gate swapping its children, but
        deliberately NOT rendered while the lock is still closed.

        The overlay draws at zIndex 10 over everything, including the lock
        screen — so mounting it during the lock hid the Face ID prompt behind
        the brand, which looked exactly like the lock never asking at all.
        Authentication comes first; the splash then covers the handoff from the
        (now empty) lock screen to the painted dashboard.
      */}
      {splashShowing ? (
        <SplashOverlay
          phase={splashPhase}
          ready={splashReady}
          onFinished={handleSplashFinished}
        />
      ) : null}
    </View>
  );
}

/** Status bar contrast follows the *resolved* theme, not the OS, so a forced
 *  light/dark mode still gets legible status-bar icons. */
function ThemedStatusBar() {
  const theme = useTheme();
  return <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedStatusBar />
          <RootNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
