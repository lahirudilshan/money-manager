import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { selectCategoryViews, useAppStore } from '../src/store/useAppStore';
import { syncCategoryReminders } from '../src/services/notifications';
import { T } from '../src/components/ui';

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

        void syncCategoryReminders(reminders).catch((error) =>
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
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.canvas },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="category/[id]" />
      <Stack.Screen name="category/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="category/edit/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="subcategory/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="transaction/new" options={{ presentation: 'modal' }} />
    </Stack>
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
