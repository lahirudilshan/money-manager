import { Stack } from 'expo-router';
import React from 'react';
import { useTheme } from '../../src/theme/ThemeProvider';

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
      <Stack.Screen name="index" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="plan" />
      <Stack.Screen name="done" />
    </Stack>
  );
}
