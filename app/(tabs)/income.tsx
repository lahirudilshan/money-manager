import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import {
  Button,
  Divider,
  Empty,
  Glyph,
  GradientCard,
  Label,
  Row,
  ScreenHeader,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { convertToLocalMinor, formatMoney, parseAmount } from '../../src/core/money';
import {
  selectBoardTotals,
  selectTotalIncome,
  useAppStore,
} from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Income sources, including foreign-currency ones converted at a stored rate. */
export default function IncomeScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const state = useAppStore();

  const total = useMemo(() => selectTotalIncome(state), [state]);
  const totals = useMemo(() => selectBoardTotals(state), [state]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [isForeign, setIsForeign] = useState(false);
  const [rate, setRate] = useState('300');
  const [cardId, setCardId] = useState<string | null>(state.cards[0]?.id ?? null);

  const preview = isForeign
    ? convertToLocalMinor(Number.parseFloat(amount) || 0, Number.parseFloat(rate) || 0)
    : (parseAmount(amount) ?? 0);

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || preview <= 0) return;

    state.addIncome({
      name: trimmed,
      amountMinor: preview,
      cardId,
      foreignAmount: isForeign ? Number.parseFloat(amount) : null,
      foreignRate: isForeign ? Number.parseFloat(rate) : null,
      icon: isForeign ? 'logo-usd' : 'cash-outline',
      color: '#047857',
      isActive: true,
      sortOrder: state.incomes.length,
    });

    setName('');
    setAmount('');
    setIsForeign(false);
    setOpen(false);
  }

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingBottom: tabClearance,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="EARNINGS"
          title="Income"
          action={{ icon: 'add', onPress: () => setOpen(true), label: 'Add income' }}
        />

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
                <T
                  variant="figureLarge"
                  color={total - totals.plannedMinor >= 0 ? '#FFFFFF' : '#FFE1E6'}
                >
                  {formatMoney(total - totals.plannedMinor, { compact: true })}
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
            onAction={() => setOpen(true)}
          />
        ) : (
          <Surface padded={false} style={{ paddingVertical: space.xs }}>
            {state.incomes.map((item, index) => (
              <View key={item.id}>
                <Row style={{ paddingVertical: space.md, paddingHorizontal: space.lg }}>
                  <Glyph icon={item.icon as never} color={item.color} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <T variant="body">{item.name}</T>
                    {item.foreignAmount ? (
                      <T variant="caption" tone="muted">
                        ${item.foreignAmount.toLocaleString()} @ {item.foreignRate}
                      </T>
                    ) : (
                      <T variant="caption" tone="muted">
                        {state.cards.find((c) => c.id === item.cardId)?.name ?? 'No card'}
                      </T>
                    )}
                  </View>
                  <T variant="figure" color={colors.completed}>
                    {formatMoney(item.amountMinor)}
                  </T>
                  <Ionicons
                    name="trash-outline"
                    size={17}
                    color={colors.inkMuted}
                    suppressHighlighting
                    onPress={() =>
                      Alert.alert(`Delete ${item.name}?`, undefined, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => state.deleteIncome(item.id),
                        },
                      ])
                    }
                  />
                </Row>
                {index < state.incomes.length - 1 ? (
                  <Divider style={{ marginLeft: 62 }} />
                ) : null}
              </View>
            ))}
          </Surface>
        )}
      </ScrollView>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.canvas }}
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <SheetHeader title="New income" onClose={() => setOpen(false)} />
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. LKR Salary"
            autoFocus
          />
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
              <Field
                label="Exchange rate"
                value={rate}
                onChangeText={setRate}
                keyboardType="decimal-pad"
              />
              <Surface style={{ backgroundColor: colors.accentSoft }}>
                <Row justify="space-between">
                  <T variant="small">Converts to</T>
                  <T variant="figure">{formatMoney(preview)}</T>
                </Row>
              </Surface>
            </>
          ) : null}
          {state.cards.length > 0 ? (
            <PillSelect
              label="Paid into"
              options={state.cards.map((card) => ({
                key: card.id,
                label: card.name,
                color: card.color,
              }))}
              selectedKey={cardId}
              onSelect={setCardId}
            />
          ) : null}
          <Button
            label="Add income"
            onPress={handleCreate}
            disabled={!name.trim() || preview <= 0}
          />
        </ScrollView>
      </Modal>
    </>
  );
}
