import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Field, PillSelect } from '../../src/components/forms';
import { AccountField } from '../../src/components/AccountPicker';
import { BankLogo } from '../../src/components/BankLogo';
import {
  AppHeader,
  BottomSheet,
  Button,
  Divider,
  Empty,
  GradientButton,
  GradientCard,
  Glyph,
  Label,
  ListRow,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { convertToLocalMinor, formatMoney, parseAmount } from '../../src/core/money';
import { resolveBrand } from '../../src/data/banks';
import {
  selectBoardTotals,
  selectCategoryViews,
  selectTotalIncome,
  useAppStore,
} from '../../src/store/useAppStore';
import type { Income } from '../../src/db/schema';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Income sources, including foreign-currency ones converted at a stored rate. */
export default function IncomeScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
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
                      <T variant="figure" color={colors.completed}>
                        {formatMoney(entry.line.plannedMinor)}
                      </T>
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
                    subtitle={
                      item.foreignAmount
                        ? `$${item.foreignAmount.toLocaleString()} @ ${item.foreignRate}`
                        : (state.cards.find((c) => c.id === item.cardId)?.name ?? 'No account')
                    }
                    trailing={
                      <T variant="figure" color={colors.completed}>
                        {formatMoney(item.amountMinor)}
                      </T>
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
            <AccountField
              label="Paid into"
              cards={state.cards}
              selectedId={cardId}
              onSelect={setCardId}
            />
          ) : null}

          {editId ? (
            <Button label="Delete income" variant="danger" icon="trash-outline" onPress={confirmDelete} />
          ) : null}
    </BottomSheet>
  );
}
