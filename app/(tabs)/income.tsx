import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import { BankLogo } from '../../src/components/BankLogo';
import {
  Button,
  Divider,
  Empty,
  GradientButton,
  GradientCard,
  Glyph,
  Label,
  PinnedFooter,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { convertToLocalMinor, formatMoney, parseAmount } from '../../src/core/money';
import { resolveBrand } from '../../src/data/banks';
import { selectBoardTotals, selectTotalIncome, useAppStore } from '../../src/store/useAppStore';
import type { Income } from '../../src/db/schema';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Income sources, including foreign-currency ones converted at a stored rate. */
export default function IncomeScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();

  const total = useMemo(() => selectTotalIncome(state), [state]);
  const totals = useMemo(() => selectBoardTotals(state), [state]);
  const left = total - totals.plannedMinor;

  // null closed; '' new; an id edits that source.
  const [formId, setFormId] = useState<string | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Fixed header. */}
      <View
        style={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: space.sm,
          backgroundColor: colors.canvas,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <Row justify="space-between" align="center">
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <T variant="title">Income</T>
          <Pressable
            onPress={() => setFormId('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Add income"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name="add-circle" size={28} color={colors.accent} />
          </Pressable>
        </Row>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: space.md,
          paddingBottom: tabClearance,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <GradientCard>
          <View style={{ gap: space.lg }}>
            <View style={{ gap: 2 }}>
              <Label color="rgba(255,255,255,0.75)">MONTHLY INCOME</Label>
              <T variant="hero" color="#FFFFFF">
                {formatMoney(total)}
              </T>
            </View>
            <Divider style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <Row justify="space-between">
              <View>
                <Label color="rgba(255,255,255,0.65)">PLANNED OUT</Label>
                <T variant="figureLarge" color="#FFFFFF">
                  {formatMoney(totals.plannedMinor, { compact: true })}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Label color="rgba(255,255,255,0.65)">LEFT</Label>
                <T variant="figureLarge" color={left >= 0 ? '#FFFFFF' : '#FFE1E6'}>
                  {formatMoney(left, { compact: true })}
                </T>
              </View>
            </Row>
          </View>
        </GradientCard>

        {state.incomes.length === 0 ? (
          <Empty
            icon="cash-outline"
            title="No income yet"
            message="Add your salary so the plan knows what it is working against."
            actionLabel="Add income"
            onAction={() => setFormId('')}
          />
        ) : (
          <View style={{ gap: space.sm }}>
            <Label>SOURCES</Label>
            <Surface padded={false} style={{ paddingVertical: space.xs }}>
              {state.incomes.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider style={{ marginLeft: 62 }} /> : null}
                  <Pressable
                    onPress={() => setFormId(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${item.name}, ${formatMoney(item.amountMinor)}`}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      paddingVertical: space.md,
                      paddingHorizontal: space.lg,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Glyph icon={item.icon as never} color={item.color} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <T variant="body">{item.name}</T>
                      {item.foreignAmount ? (
                        <T variant="caption" tone="muted">
                          ${item.foreignAmount.toLocaleString()} @ {item.foreignRate}
                        </T>
                      ) : (
                        <T variant="caption" tone="muted">
                          {state.cards.find((c) => c.id === item.cardId)?.name ?? 'No account'}
                        </T>
                      )}
                    </View>
                    <T variant="figure" color={colors.completed}>
                      {formatMoney(item.amountMinor)}
                    </T>
                    <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
                  </Pressable>
                </View>
              ))}
            </Surface>
          </View>
        )}
      </ScrollView>

      {/* Fixed add button above the tab bar (and, in the modal, the keyboard). */}
      {state.incomes.length > 0 ? (
        <View
          style={{
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
            paddingBottom: insets.bottom + space.sm,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
            backgroundColor: colors.surface,
          }}
        >
          <GradientButton label="Add income source" icon="add" onPress={() => setFormId('')} />
        </View>
      ) : null}

      {formId !== null ? (
        <IncomeFormModal editId={formId || null} onClose={() => setFormId(null)} />
      ) : null}
    </View>
  );
}

/** Create or edit one income source, with live foreign-currency conversion. */
function IncomeFormModal({ editId, onClose }: { editId: string | null; onClose: () => void }) {
  const { colors, space } = useTheme();
  const state = useAppStore();
  const existing = editId ? state.incomes.find((i) => i.id === editId) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [isForeign, setIsForeign] = useState(Boolean(existing?.foreignAmount));
  const [amount, setAmount] = useState(
    existing
      ? existing.foreignAmount
        ? String(existing.foreignAmount)
        : String(existing.amountMinor / 100)
      : '',
  );
  const [rate, setRate] = useState(existing?.foreignRate ? String(existing.foreignRate) : String(state.usdRate));
  const [cardId, setCardId] = useState<string | null>(existing?.cardId ?? state.cards[0]?.id ?? null);

  const preview = isForeign
    ? convertToLocalMinor(Number.parseFloat(amount) || 0, Number.parseFloat(rate) || 0)
    : (parseAmount(amount) ?? 0);
  const canSave = Boolean(name.trim()) && preview > 0;

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || preview <= 0) return;
    const patch = {
      name: trimmed,
      amountMinor: preview,
      cardId,
      foreignAmount: isForeign ? Number.parseFloat(amount) : null,
      foreignRate: isForeign ? Number.parseFloat(rate) : null,
      icon: isForeign ? 'logo-usd' : 'cash-outline',
    };
    if (editId) state.updateIncome(editId, patch);
    else
      state.addIncome({ ...patch, color: '#047857', isActive: true, sortOrder: state.incomes.length });
    onClose();
  }

  function confirmDelete() {
    if (!editId) return;
    Alert.alert(`Delete ${existing?.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteIncome(editId);
          onClose();
        },
      },
    ]);
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: colors.canvas }}
      >
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <SheetHeader title={editId ? 'Edit income' : 'New income'} onClose={onClose} />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.lg, paddingTop: space.md, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. LKR Salary" autoFocus={!editId} />
          <PillSelect
            label="Currency"
            options={[
              { key: 'local', label: 'LKR', icon: 'cash-outline' },
              { key: 'foreign', label: 'USD', icon: 'logo-usd' },
            ]}
            selectedKey={isForeign ? 'foreign' : 'local'}
            onSelect={(key) => setIsForeign(key === 'foreign')}
          />
          <Field
            label={isForeign ? 'Amount in USD' : 'Amount'}
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            keyboardType="numeric"
          />
          {isForeign ? (
            <>
              <Field label="Exchange rate" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
              <Surface style={{ backgroundColor: colors.accentSoft }}>
                <Row justify="space-between">
                  <T variant="small">Converts to</T>
                  <T variant="figure">{formatMoney(preview)}</T>
                </Row>
              </Surface>
            </>
          ) : null}
          {state.cards.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Label>PAID INTO</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {state.cards.map((card) => {
                  const brand = resolveBrand({ bankId: card.bankId, bankName: card.bankName, name: card.name });
                  const selected = cardId === card.id;
                  return (
                    <Pressable
                      key={card.id}
                      onPress={() => setCardId(card.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.sm,
                        paddingVertical: 7,
                        paddingHorizontal: space.md,
                        borderRadius: 999,
                        borderWidth: 1.5,
                        borderColor: selected ? brand.color : colors.hairline,
                        backgroundColor: selected ? `${brand.color}14` : colors.surface,
                        opacity: pressed ? 0.75 : 1,
                      })}
                    >
                      <BankLogo brand={brand} size={20} />
                      <T variant="small" style={{ fontWeight: selected ? '700' : '500' }}>
                        {card.name}
                      </T>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {editId ? (
            <Button label="Delete income" variant="danger" icon="trash-outline" onPress={confirmDelete} />
          ) : null}
        </ScrollView>

        <PinnedFooter followsKeyboard>
          <GradientButton
            label={editId ? 'Save changes' : 'Add income'}
            icon={editId ? 'checkmark' : 'add'}
            onPress={handleSave}
            disabled={!canSave}
          />
        </PinnedFooter>
      </KeyboardAvoidingView>
    </Modal>
  );
}
