import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field } from '../../src/components/forms';
import { Button, Label, T } from '../../src/components/ui';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Onboarding step 1: add the one account money moves through. Kept to a
 * single required field — a lazy user just wants the app working, and every
 * other detail (type, opening balance, extra accounts) is editable later
 * from the Cards tab.
 */
export default function OnboardingAccountsScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();

  const [name, setName] = useState('');

  function handleContinue() {
    const trimmed = name.trim();
    if (!trimmed) return;

    state.addCard({
      name: trimmed,
      kind: 'bank',
      icon: 'wallet-outline',
      openingBalanceMinor: 0,
      sortOrder: 0,
    });

    router.push('/onboarding/categories');
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: 2 }}>
        <Label>STEP 1 OF 3</Label>
        <T variant="title">Add your account</T>
        <T variant="small" tone="muted">
          One account to get started — you can add more anytime from Cards.
        </T>
      </View>

      <Field
        label="Account name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. My Bank Account"
        autoFocus
      />

      <Button label="Continue" onPress={handleContinue} disabled={!name.trim()} />
    </ScrollView>
  );
}
