import { Stack, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppLockGate } from '../src/components/AppLockGate';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { extractSmsFromUrl } from '../src/core/smsIntakeUrl';
import { selectCategoryViews, selectSavingPlans, useAppStore } from '../src/store/useAppStore';
import { syncCategoryReminders } from '../src/services/notifications';
import { T } from '../src/components/ui';

/**
 * Options for a route whose screen renders its content inside the shared
 * BottomSheet. The route presents as the native iOS sheet (`presentation:
 * 'modal'` = pageSheet), and the screen renders `<BottomSheet asRoute ...>` so
 * the BottomSheet draws only its chrome inside that one native sheet — same
 * single-presentation behaviour as the inline "add bill" sheet. One constant so
 * every sheet route is configured identically.
 */
const SHEET_ROUTE = { presentation: 'modal' } as const;

function RootNavigator() {
  const theme = useTheme();
  const router = useRouter();
  const ready = useAppStore((s) => s.ready);
  const needsOnboarding = useAppStore((s) => s.needsOnboarding);
  const initialise = useAppStore((s) => s.initialise);
  const [startupError, setStartupError] = useState<string | null>(null);

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
    if (!ready) return;

    // The URL that launched the app, for the cold-start case.
    //
    // `sms/index` also reads this, but only if expo-router actually mounts that
    // route — and a launch that lands anywhere else (or is redirected away
    // before the effect runs) drops the message silently. That is the "Shortcut
    // opened the app but nothing appeared in the dashboard" case: the same text
    // pasted into the manual box works, because that path never depends on
    // routing. Ingesting here as well makes the message land regardless, and
    // the store's raw-text dedupe stops the two paths from double-queueing.
    void Linking.getInitialURL()
      .then((url) => {
        const text = url ? extractSmsFromUrl(url) : null;
        if (text) useAppStore.getState().ingestSmsText(text);
      })
      .catch(() => {
        // A failed read must not break startup; the route may still catch it.
      });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      const text = extractSmsFromUrl(url);
      if (text) useAppStore.getState().ingestSmsText(text);
    });

    return () => subscription.remove();
  }, [ready]);

  // Redirect into onboarding only once the navigator below is actually
  // mounted — dispatching `router.replace` while this component is still
  // returning the loading spinner (i.e. before the Stack exists) causes
  // expo-router to re-queue the navigation on every render, which is an
  // infinite "Maximum update depth exceeded" loop, not a real redirect.
  useEffect(() => {
    if (ready && needsOnboarding) {
      router.replace('/onboarding');
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
        <T variant="heading">Could not start</T>
        <T variant="small" tone="muted" style={{ textAlign: 'center' }}>
          {startupError}
        </T>
      </ScrollView>
    );
  }

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.canvas,
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <AppLockGate>
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
        <Stack.Screen name="transaction/unplanned" options={SHEET_ROUTE} />
        <Stack.Screen name="account/[id]" options={SHEET_ROUTE} />
        <Stack.Screen name="sms/index" />
        <Stack.Screen name="sms/new" options={SHEET_ROUTE} />
        <Stack.Screen name="sms/[id]" options={SHEET_ROUTE} />
        <Stack.Screen name="settings/sms-automation" options={SHEET_ROUTE} />
      </Stack>
    </AppLockGate>
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
