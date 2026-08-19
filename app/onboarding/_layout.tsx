import { Stack } from 'expo-router';
import React from 'react';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** Onboarding is deliberately outside `(tabs)` — no dock, no back-swipe to the board. */
export default function OnboardingLayout() {
  const { colors } = useTheme();


  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      {/* The fork: restore an existing backup, or build a new plan. */}
      <Stack.Screen name="welcome" />
      <Stack.Screen name="index" />
      <Stack.Screen name="about" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="plan" />
      <Stack.Screen name="loans" />
      <Stack.Screen name="done" />
    </Stack>
  );
}
