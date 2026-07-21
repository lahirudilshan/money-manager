import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Divider, Glyph, Label, Row, Surface, T } from '../../src/components/ui';
import { formatMoney } from '../../src/core/money';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

const PREVIEW = [
  {
    category: 'Housing',
    icon: 'home-outline' as const,
    items: [
      { name: 'Rent', amount: 5_000_000 },
      { name: 'Utilities', amount: 1_000_000 },
    ],
  },
  {
    category: 'Living',
    icon: 'basket-outline' as const,
    items: [
      { name: 'Groceries', amount: 3_000_000 },
      { name: 'Transport', amount: 1_000_000 },
    ],
  },
  {
    category: 'Subscriptions',
    icon: 'repeat-outline' as const,
    items: [{ name: 'Subscriptions', amount: 500_000 }],
  },
];

/** Onboarding shortcut: preview and apply a genericized starter plan. */
export default function OnboardingSampleScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();
  const applySampleTemplate = useAppStore((s) => s.applySampleTemplate);

  function handleUse() {
    applySampleTemplate(state.cards[0]?.id ?? null);
    router.push('/onboarding/done');
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
    >
      <View style={{ gap: 2 }}>
        <Label>SAMPLE TEMPLATE</Label>
        <T variant="title">Start from a template</T>
        <T variant="small" tone="muted">
          A basic starter plan with round placeholder numbers — a salary
          income and these categories, using your account from step 1.
          Adjust everything afterward.
        </T>
      </View>

      {PREVIEW.map((category) => (
        <Surface key={category.category} style={{ gap: space.sm }}>
          <Row gap={space.sm}>
            <Glyph icon={category.icon} color={colors.accent} size={32} />
            <T variant="bodyStrong">{category.category}</T>
          </Row>
          <Divider />
          {category.items.map((item) => (
            <Row key={item.name} justify="space-between">
              <T variant="small" tone="secondary">
                {item.name}
              </T>
              <T variant="figure">{formatMoney(item.amount)}</T>
            </Row>
          ))}
        </Surface>
      ))}

      <Button label="Use this template" onPress={handleUse} />
    </ScrollView>
  );
}
