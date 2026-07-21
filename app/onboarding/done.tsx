import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, T } from '../../src/components/ui';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Onboarding step 3: confirmation, then hand off to the board. */
export default function OnboardingDoneScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);

  function handleFinish() {
    completeOnboarding();
    router.replace('/(tabs)');
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.canvas,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingHorizontal: space.xl,
        gap: space.lg,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.completedSoft,
        }}
      >
        <Ionicons name="checkmark" size={36} color={colors.completed} />
      </View>
      <T variant="title" style={{ textAlign: 'center' }}>
        You're set up
      </T>
      <T variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 280 }}>
        Your accounts and plan are ready. From the board you can transfer money,
        tick off bills, and add more as you go.
      </T>
      <Button label="Go to Board" onPress={handleFinish} style={{ width: '100%' }} />
    </View>
  );
}
