import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, T } from '../../src/components/ui';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Final onboarding screen: confirmation, then hand off to the dashboard. */
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
        Your accounts and plan are ready. The dashboard shows what's due, how
        much to move to each account, and your month at a glance.
      </T>
      <Button label="Go to Dashboard" onPress={handleFinish} style={{ width: '100%' }} />
    </View>
  );
}
