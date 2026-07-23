import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, SheetHeader } from '../../src/components/forms';
import {
  Button,
  Divider,
  FundingBar,
  Glyph,
  GradientButton,
  Label,
  PinnedFooter,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { BankLogo } from '../../src/components/BankLogo';
import { formatMoney, parseAmount } from '../../src/core/money';
import { dueDateFor, formatPeriod } from '../../src/core/planning';
import { resolveBrand } from '../../src/data/banks';
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

  const [fundOpen, setFundOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState('');

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
        <T variant="heading">Category not found</T>
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
  const dueDate = dueDateFor(state.period, category.dueDay);

  function openFundSheet() {
    setFundAmount(summary.shortfallMinor > 0 ? String(summary.shortfallMinor / 100) : '');
    setFundOpen(true);
  }

  function handleFund() {
    const amount = parseAmount(fundAmount);
    if (!amount || amount <= 0) return;
    state.fundCategory(category.id, amount);
    setFundOpen(false);
    setFundAmount('');
  }

  function confirmDelete() {
    Alert.alert(`Delete ${category.name}?`, 'Its bills will be removed too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteCategory(category.id);
          router.back();
        },
      },
    ]);
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
            <T variant="title">{category.name}</T>
            <T variant="caption" tone="muted">
              {formatPeriod(state.period)} · {summary.subcategoryCount} bill
              {summary.subcategoryCount === 1 ? '' : 's'}
            </T>
          </View>
        </Row>

        {/* Money overview. */}
        <Surface style={{ gap: space.lg }}>
          <Row justify="space-between" align="flex-start">
            <View style={{ gap: 2 }}>
              <Label>TOTAL PLAN</Label>
              <T variant="display">{formatMoney(summary.totalMinor)}</T>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Label>PAID</Label>
              <T
                variant="figureLarge"
                color={summary.isSettled ? colors.completed : colors.ink}
              >
                {formatMoney(summary.paidMinor)}
              </T>
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
              <T variant="caption" tone="muted">
                {summary.counts.paid}/{summary.subcategoryCount} bills paid
              </T>
              <T
                variant="caption"
                color={summary.outstandingMinor > 0 ? colors.pending : colors.completed}
              >
                {summary.outstandingMinor > 0
                  ? `${formatMoney(summary.outstandingMinor, { compact: true })} left`
                  : 'All paid'}
              </T>
            </Row>
          </View>
        </Surface>

        {/* Bulk transfer — the salary→account move. */}
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
              <T
                variant="bodyStrong"
                color={transferred ? transferStyle.fg : colors.ink}
              >
                {transferred ? 'Money transferred' : 'Not transferred yet'}
              </T>
              <T
                variant="caption"
                color={transferred ? transferStyle.fg : colors.inkMuted}
                style={transferred ? { opacity: 0.85 } : undefined}
              >
                {transferred
                  ? 'The account holds this category’s money'
                  : 'Tap when the bulk money lands'}
              </T>
            </View>
          </Pressable>

          {/* Record an exact partial amount, for when it wasn't the full plan. */}
          <Row gap={space.sm}>
            <Button
              label="Log exact amount"
              icon="cash-outline"
              variant="secondary"
              onPress={openFundSheet}
              style={{ flex: 1 }}
            />
            {summary.fundedMinor > 0 ? (
              <Button
                label="Undo"
                icon="arrow-undo-outline"
                variant="secondary"
                onPress={() => state.unfundCategory(category.id)}
              />
            ) : null}
          </Row>
          {summary.fundedMinor > 0 ? (
            <T variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {formatMoney(summary.fundedMinor)} logged this month
            </T>
          ) : null}
        </View>

        {/* Settings summary. */}
        <View style={{ gap: space.sm }}>
          <Label>SETTINGS</Label>
          <Surface padded={false}>
            <SettingRow
              label="Funded to"
              value={card?.name ?? 'No account'}
              leading={brand ? <BankLogo brand={brand} size={28} /> : undefined}
              onPress={() => router.push(`/category/edit/${category.id}`)}
            />
            <Divider style={{ marginHorizontal: space.lg }} />
            <SettingRow
              label="Payment day"
              value={dueDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              onPress={() => router.push(`/category/edit/${category.id}`)}
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

      {/* Log-exact-amount sheet. */}
      <Modal
        visible={fundOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFundOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: colors.canvas }}
        >
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <SheetHeader title="Log transfer" onClose={() => setFundOpen(false)} />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.lg, paddingTop: space.md, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <Surface style={{ gap: space.sm }}>
            <Row>
              <Glyph icon={category.icon as never} color={category.color} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{category.name}</T>
                <T variant="caption" tone="muted">
                  to {card?.name ?? 'no account assigned'}
                </T>
              </View>
            </Row>
            <Divider />
            <Row justify="space-between">
              <T variant="small" tone="secondary">
                Needed
              </T>
              <T variant="figure">{formatMoney(summary.totalMinor)}</T>
            </Row>
            <Row justify="space-between">
              <T variant="small" tone="secondary">
                Already logged
              </T>
              <T variant="figure">{formatMoney(summary.fundedMinor)}</T>
            </Row>
          </Surface>

          <Field
            label="Amount transferred"
            value={fundAmount}
            onChangeText={setFundAmount}
            placeholder="0"
            keyboardType="numeric"
            autoFocus
          />

          <T variant="caption" tone="muted">
            This records the money as moved to the account and marks the category
            transferred. It doesn’t pay any bill — tick those off on the List.
          </T>

        </ScrollView>

        <PinnedFooter>
          <GradientButton
            label={`Log ${formatMoney(parseAmount(fundAmount) ?? 0)}`}
            icon="swap-horizontal"
            onPress={handleFund}
            disabled={!parseAmount(fundAmount)}
          />
        </PinnedFooter>
        </KeyboardAvoidingView>
      </Modal>
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
  const { colors, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.lg,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {leading}
      <T variant="body" tone="secondary" style={{ flex: 1 }}>
        {label}
      </T>
      <T variant="bodyStrong">{value}</T>
      <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
    </Pressable>
  );
}
