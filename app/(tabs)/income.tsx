import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
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
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { convertToLocalMinor, formatMoney, parseAmount } from '../../src/core/money';
import { resolveBrand } from '../../src/data/banks';
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
  const router = useRouter();
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
        <Row justify="space-between" align="center">
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <T variant="title">Income</T>
          <View style={{ width: 24 }} />
        </Row>

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

        {state.incomes.length > 0 ? (
          <GradientButton
            label="Add income source"
            icon="add"
            onPress={() => setOpen(true)}
          />
        ) : null}
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
            <View style={{ gap: space.sm }}>
              <Label>PAID INTO</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {state.cards.map((card) => {
                  const brand = resolveBrand({
                    bankId: card.bankId,
                    bankName: card.bankName,
                    name: card.name,
                  });
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
