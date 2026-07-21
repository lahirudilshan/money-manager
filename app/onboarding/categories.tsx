import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategorySheet } from '../../src/components/CategorySheet';
import { Button, GradientButton, Label, Surface, T } from '../../src/components/ui';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Onboarding step 2: get a plan onto the board with the fewest possible
 * decisions. The sample template is the prominent default path — most users
 * tap through in seconds; "build my own" stays available for anyone who
 * wants to set things up by hand right away.
 */
export default function OnboardingCategoriesScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();

  const [buildOpen, setBuildOpen] = useState(false);

  // Onboarding's step 1 always creates exactly one card first.
  const defaultCardId = state.cards[0]?.id ?? null;

  return (
    <>
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
          <Label>STEP 2 OF 3</Label>
          <T variant="title">Build your plan</T>
          <T variant="small" tone="muted">
            A category holds your budget lines — rent, groceries, subscriptions,
            whatever you're tracking.
          </T>
        </View>

        <GradientButton
          label="Quick start with a sample plan"
          icon="flash-outline"
          onPress={() => router.push('/onboarding/sample')}
        />

        <Button
          label="Build my own categories"
          icon="add"
          variant="secondary"
          onPress={() => setBuildOpen(true)}
        />

        {state.categories.length > 0 ? (
          <View style={{ gap: space.sm }}>
            {state.categories.map((category) => (
              <Surface key={category.id} style={{ gap: 2 }}>
                <T variant="bodyStrong">{category.name}</T>
                <T variant="caption" tone="muted">
                  {state.subcategories.filter((s) => s.categoryId === category.id).length}{' '}
                  subcategories
                </T>
              </Surface>
            ))}
          </View>
        ) : null}

        {state.categories.length > 0 ? (
          <Button
            label={`Continue with ${state.categories.length} categor${state.categories.length === 1 ? 'y' : 'ies'}`}
            onPress={() => router.push('/onboarding/done')}
          />
        ) : null}
      </ScrollView>

      <CategorySheet
        visible={buildOpen}
        defaultCardId={defaultCardId}
        onClose={() => setBuildOpen(false)}
      />
    </>
  );
}
