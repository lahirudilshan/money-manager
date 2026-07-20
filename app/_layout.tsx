import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { selectGroupViews, useAppStore } from '../src/store/useAppStore';
import { syncGroupReminders } from '../src/services/notifications';
import { T } from '../src/components/ui';

function RootNavigator() {
  const theme = useTheme();
  const ready = useAppStore((s) => s.ready);
  const initialise = useAppStore((s) => s.initialise);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Database setup must succeed for the app to work; reminders must not be
    // able to break startup, so they are awaited separately and swallowed.
    initialise()
      .then(() => {
        // Remind about groups that still need money moved into them.
        const state = useAppStore.getState();
        const reminders = selectGroupViews(state)
          .filter((view) => view.summary.shortfallMinor > 0)
          .map((view) => ({
            groupId: view.group.id,
            groupName: view.group.name,
            shortfallMinor: view.summary.shortfallMinor,
            dueDay: view.group.dueDay,
          }));

        void syncGroupReminders(reminders).catch((error) =>
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
      <Stack.Screen name="group/[id]" />
      <Stack.Screen name="group/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="group/edit/[id]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="category/[id]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <StatusBar style="auto" />
          <RootNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
