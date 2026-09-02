import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Field, PillSelect } from '~/shared/components/forms';
import { AccountField } from '~/features/accounts/components/AccountPicker';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import { AppHeader, BottomSheet, Button, Divider, Empty, GradientButton, GradientCard, Glyph, Label, ListRow, Row, Surface, Text } from '~/shared/components/ui';
import { useTabBarClearance } from '~/shared/components/TabBar';
import { convertToLocalMinor, formatAmountInput, formatMoney, parseAmount } from '~/shared/lib/money';
import { accountName, resolveBrand } from '~/shared/data/banks';
import {
  selectBoardTotals,
  selectCategoryViews,
  selectTotalIncome,
  useAppStore,
} from '../../src/store/useAppStore';
import type { Income } from '../../src/db/schema';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { useScrollToTopOnFocus } from '~/shared/hooks/useScrollToTopOnFocus';

/** Income sources, including foreign-currency ones converted at a stored rate. */
export default function IncomeScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  // Every visit starts at the top — a tab screen stays mounted, so its scroll
  // offset otherwise survives being left and returned to. See the hook.
  const scrollRef = useScrollToTopOnFocus();
  const router = useRouter();
  const state = useAppStore();

  const total = useMemo(() => selectTotalIncome(state), [state]);
  const totals = useMemo(() => selectBoardTotals(state), [state]);
  const left = total - totals.plannedMinor;

  // Income typed onto the board as a category line. Onboarding writes a salary
  // both ways, so anything the `incomes` table already declares is filtered out
  // here — the same pairing `selectTotalIncome` skips, so this list shows
  // exactly the lines that add to the figure above.
  const boardIncome = useMemo(() => {
    const declared = new Set(
      state.incomes.map((income) => `${income.name.trim().toLowerCase()}:${income.amountMinor}`),
    );
    return selectCategoryViews(state).flatMap((view) =>
      view.rawSubcategories
        .filter(
          (line) =>
            line.type === 'income' &&
            !declared.has(`${line.name.trim().toLowerCase()}:${line.plannedMinor}`),
        )
        .map((line) => ({ line, category: view.category })),
    );
  }, [state]);

  // null closed; '' new; an id edits that source.
  const [formId, setFormId] = useState<string | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <AppHeader
        title="Income"
        onBack={() => router.back()}
        action={{ icon: 'add-circle', label: 'Add income', onPress: () => setFormId('') }}
      />

      <ScrollView
        ref={scrollRef}
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
              <Text variant="hero" color="#FFFFFF">
                {formatMoney(total)}
              </Text>
            </View>
            <Divider style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <Row justify="space-between">
              <View>
                <Label color="rgba(255,255,255,0.65)">PLANNED OUT</Label>
                <Text variant="figureLarge" color="#FFFFFF">
                  {formatMoney(totals.plannedMinor, { compact: true })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Label color="rgba(255,255,255,0.65)">LEFT</Label>
                <Text variant="figureLarge" color={left >= 0 ? '#FFFFFF' : '#FFE1E6'}>
                  {formatMoney(left, { compact: true })}
                </Text>
              </View>
            </Row>
          </View>
        </GradientCard>

        {state.incomes.length === 0 && boardIncome.length === 0 ? (
          <Empty
            icon="cash-outline"
            title="No income yet"
            message="Add your salary so the plan knows what it is working against."
            actionLabel="Add income"
            onAction={() => setFormId('')}
          />
        ) : null}

        {/* Income lines living on the board rather than in this table.
            `selectTotalIncome` counts both, so listing only the table meant a
            salary added as a board line drove the total above without appearing
            anywhere here — and, with no table rows at all, sat under an empty
            state that claimed there was no income. */}
        {boardIncome.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Label>ON THE BOARD</Label>
            <Surface padded={false} style={{ paddingVertical: space.xs }}>
              {boardIncome.map((entry, index) => (
                <View key={entry.line.id}>
                  {index > 0 ? <Divider style={{ marginLeft: 62 }} /> : null}
                  <ListRow
                    leading={
                      <Glyph
                        icon={(entry.line.icon ?? 'trending-up') as never}
                        color={entry.category.color}
                      />
                    }
                    title={entry.line.name}
                    subtitle={entry.category.name}
                    trailing={
                      <Text variant="figure" color={colors.completed}>
                        {formatMoney(entry.line.plannedMinor)}
                      </Text>
                    }
                    chevron
                    onPress={() => router.push(`/subcategory/${entry.line.id}`)}
                    accessibilityLabel={`Edit ${entry.line.name}, ${formatMoney(entry.line.plannedMinor)}`}
                  />
                </View>
              ))}
            </Surface>
          </View>
        ) : null}

        {state.incomes.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Label>SOURCES</Label>
            <Surface padded={false} style={{ paddingVertical: space.xs }}>
              {state.incomes.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider style={{ marginLeft: 62 }} /> : null}
                  <ListRow
                    leading={<Glyph icon={item.icon as never} color={item.color} />}
                    title={item.name}
                    subtitle={(() => {
                      if (item.foreignAmount) {
                        return `$${item.foreignAmount.toLocaleString()} @ ${item.foreignRate}`;
                      }

                      const card = state.cards.find((c) => c.id === item.cardId);
                      if (!card) return 'No account';

                      /*
                        The bank's mark beside the account it names.

                        The row's LEADING glyph belongs to the income source
                        itself — its own icon and colour — so the bank cannot
                        take that slot without losing what the source is. It
                        goes next to the account name instead, where the app's
                        other rows already put it, at a size that reads as a
                        mark on a caption line rather than a second avatar
                        competing with the one on the left.
                      */
                      return (
                        <Row gap={5} align="center">
                          <BankLogo
                            brand={resolveBrand({
                              bankId: card.bankId,
                              bankName: card.bankName,
                            })}
                            size={14}
                          />
                          <Text variant="caption" tone="muted" numberOfLines={1}>
                            {accountName(card)}
                          </Text>
                        </Row>
                      );
                    })()}
                    trailing={
                      <Text variant="figure" color={colors.completed}>
                        {formatMoney(item.amountMinor)}
                      </Text>
                    }
                    chevron
                    onPress={() => setFormId(item.id)}
                    accessibilityLabel={`Edit ${item.name}, ${formatMoney(item.amountMinor)}`}
                  />
                </View>
              ))}
            </Surface>
          </View>
        ) : null}
      </ScrollView>

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
  // Seeded through `formatAmountInput` so an existing amount opens grouped
  // rather than gaining its separators only on the first keystroke.
  const [amount, setAmount] = useState(
    existing
      ? existing.foreignAmount
        ? formatAmountInput(String(existing.foreignAmount))
        : formatAmountInput(String(existing.amountMinor / 100))
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
    <BottomSheet
      visible
      onClose={onClose}
      title={editId ? 'Edit income' : 'New income'}
      icon={isForeign ? 'logo-usd' : 'cash-outline'}
      iconColor={colors.accent}
      scroll
      footer={
        <GradientButton
          label={editId ? 'Save changes' : 'Add income'}
          icon={editId ? 'checkmark' : 'add'}
          onPress={handleSave}
          disabled={!canSave}
        />
      }
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
            money
          />
          {isForeign ? (
            <>
              <Field label="Exchange rate" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
              <Surface style={{ backgroundColor: colors.accentSoft }}>
                <Row justify="space-between">
                  <Text variant="small">Converts to</Text>
                  <Text variant="figure">{formatMoney(preview)}</Text>
                </Row>
              </Surface>
            </>
          ) : null}
          {/*
            Shown even with NO accounts yet.

            It used to disappear when the list was empty, which hid the one
            control that could fix that — someone recording their first salary
            had no way to say where it lands, and no hint that accounts existed.
            The picker now offers "Add an account", so an empty list is a
            starting point rather than a dead end.
          */}
          <AccountField
            label="Paid into"
            cards={state.cards}
            selectedId={cardId}
            onSelect={setCardId}
          />

          {editId ? (
            <Button label="Delete income" variant="danger" icon="trash-outline" onPress={confirmDelete} />
          ) : null}
    </BottomSheet>
  );
}
