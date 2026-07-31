import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Divider, FundingBar, Glyph, Label, ListRow, Row, Surface, Text } from '../../src/components/ui';
import { AccountPickerSheet } from '../../src/components/AccountPicker';
import { BankLogo } from '../../src/components/BankLogo';
import { formatMoney } from '../../src/core/money';
import { formatPeriod } from '../../src/core/planning';
import { accountLabel, resolveBrand } from '../../src/data/banks';
import { selectCategoryView, useAppStore } from '../../src/store/useAppStore';
import { statusStyle } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * A category's overview and settings.
 *
 * Working through the bills happens on the List card — this page is where you
 * see the whole category's money at a glance, record the bulk transfer (with
 * an exact amount when it wasn't the full plan), and change its settings.
 */
export default function CategoryDetailScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = useAppStore();
  const view = useMemo(() => selectCategoryView(state, id!), [state, id]);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);

  if (!view) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.md,
        }}
      >
        <Text variant="heading">Category not found</Text>
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  const { category, card, summary } = view;
  const transferred = view.transferStatus === 'transferred';
  const transferStyle = statusStyle('transferred', colors);
  const brand = card
    ? resolveBrand({ bankId: card.bankId, bankName: card.bankName, name: card.name })
    : undefined;

  // A short summary of how this category's bills recur — e.g. "3 monthly · 1
  // yearly". Shown on the summary card so the cadence reads at a glance.
  const frequencyLabel = (() => {
    const labels: Record<string, string> = {
      monthly: 'monthly',
      yearly: 'yearly',
      one_time: 'one-time',
      unplanned: 'unplanned',
    };
    const counts = new Map<string, number>();
    for (const sub of view.rawSubcategories) {
      counts.set(sub.frequency, (counts.get(sub.frequency) ?? 0) + 1);
    }
    const parts = [...counts.entries()].map(([freq, n]) => `${n} ${labels[freq] ?? freq}`);
    return parts.join(' · ');
  })();

  function confirmDelete() {
    const billCount = view!.rawSubcategories.length;

    Alert.alert(
      `Delete ${category.name}?`,
      billCount > 0
        ? `This also removes its ${billCount} ${billCount === 1 ? 'bill' : 'bills'} and their logged history.`
        : 'This category has no bills yet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // The store refuses when the category holds a loan installment.
            // Say so and stay put — popping the screen on a refused delete is
            // what made this look like "delete doesn't work".
            const result = state.deleteCategory(category.id);
            if (!result.ok) {
              Alert.alert('Remove the loan first', result.reason);
              return;
            }
            router.back();
          },
        },
      ],
    );
  }

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxxl,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Nav row. */}
        <Row justify="space-between">
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
          <Pressable
            onPress={() => router.push(`/category/edit/${category.id}`)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Edit category"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name="create-outline" size={22} color={colors.inkSecondary} />
          </Pressable>
        </Row>

        {/* Identity. */}
        <Row>
          <Glyph icon={category.icon as never} color={category.color} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title">{category.name}</Text>
            <Text variant="caption" tone="muted">
              {formatPeriod(state.period)} · {summary.subcategoryCount} bill
              {summary.subcategoryCount === 1 ? '' : 's'}
            </Text>
          </View>
        </Row>

        {/* Money overview. */}
        <Surface style={{ gap: space.lg }}>
          <Row justify="space-between" align="flex-start">
            <View style={{ gap: 2 }}>
              <Label>TOTAL PLAN</Label>
              <Text variant="display">{formatMoney(summary.totalMinor)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Label>PAID</Label>
              <Text
                variant="figureLarge"
                color={summary.isSettled ? colors.completed : colors.ink}
              >
                {formatMoney(summary.paidMinor)}
              </Text>
            </View>
          </Row>

          <View style={{ gap: space.sm }}>
            <FundingBar
              pct={
                summary.subcategoryCount > 0
                  ? (summary.counts.paid / summary.subcategoryCount) * 100
                  : 0
              }
              color={category.color}
              height={10}
              surplus={summary.isSettled}
            />
            <Row justify="space-between">
              <Text variant="caption" tone="muted">
                {summary.counts.paid}/{summary.subcategoryCount} bills paid
              </Text>
              <Text
                variant="caption"
                color={summary.outstandingMinor > 0 ? colors.pending : colors.completed}
              >
                {summary.outstandingMinor > 0
                  ? `${formatMoney(summary.outstandingMinor, { compact: true })} left`
                  : 'All paid'}
              </Text>
            </Row>
          </View>

          {/* Frequency mix — how this category's bills recur, at a glance. */}
          {frequencyLabel ? (
            <>
              <Divider />
              <Row gap={6}>
                <Ionicons name="repeat-outline" size={14} color={colors.inkMuted} />
                <Text variant="caption" tone="secondary">
                  {frequencyLabel}
                </Text>
              </Row>
            </>
          ) : null}
        </Surface>

        {/* Bulk transfer — the salary→account move. Income categories skip it:
            that money arrives in the account on its own. */}
        {view.isIncomeOnly ? null : (
        <View style={{ gap: space.sm }}>
          <Label>BULK TRANSFER</Label>
          <Pressable
            onPress={() => state.toggleCategoryTransfer(category.id)}
            accessibilityRole="button"
            accessibilityState={{ checked: transferred }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              padding: space.lg,
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: transferred ? transferStyle.fg : colors.hairline,
              backgroundColor: transferred ? transferStyle.bg : colors.surface,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons
              name={transferred ? 'checkmark-circle' : 'swap-horizontal'}
              size={26}
              color={transferred ? transferStyle.fg : colors.inkSecondary}
            />
            <View style={{ flex: 1 }}>
              <Text
                variant="bodyStrong"
                color={transferred ? transferStyle.fg : colors.ink}
              >
                {transferred ? 'Money transferred' : 'Not transferred yet'}
              </Text>
              <Text
                variant="caption"
                color={transferred ? transferStyle.fg : colors.inkMuted}
                style={transferred ? { opacity: 0.85 } : undefined}
              >
                {transferred
                  ? 'The account holds this category’s money'
                  : 'Tap when the bulk money lands'}
              </Text>
            </View>
          </Pressable>

        </View>
        )}

        {/* Settings summary. */}
        <View style={{ gap: space.sm }}>
          <Label>SETTINGS</Label>
          <Surface padded={false}>
            <SettingRow
              label="Funded to"
              value={card ? accountLabel(card).primary : 'No account'}
              leading={brand ? <BankLogo brand={brand} size={28} /> : undefined}
              onPress={() => setAccountPickerOpen(true)}
            />
          </Surface>
        </View>

        <Button
          label="Delete category"
          variant="danger"
          icon="trash-outline"
          onPress={confirmDelete}
        />
      </ScrollView>

      {/* Reassign the funding account inline, using the shared picker. */}
      <AccountPickerSheet
        visible={accountPickerOpen}
        cards={state.cards}
        selectedId={category.cardId}
        allowNone
        onSelect={(cardId) => {
          state.updateCategory(category.id, { cardId });
          setAccountPickerOpen(false);
        }}
        onClose={() => setAccountPickerOpen(false)}
      />
    </>
  );
}

/** A tappable settings summary row with an optional leading visual. */
function SettingRow({
  label,
  value,
  leading,
  onPress,
}: {
  label: string;
  value: string;
  leading?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <ListRow
      leading={leading}
      title={<Text variant="body" tone="secondary">{label}</Text>}
      trailing={<Text variant="bodyStrong">{value}</Text>}
      chevron
      onPress={onPress}
      accessibilityLabel={`${label}: ${value}`}
    />
  );
}
