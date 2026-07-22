import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankCardTile } from '../../src/components/BankCardTile';
import { BankLogo } from '../../src/components/BankLogo';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import {
  Divider,
  Empty,
  FundingBar,
  GradientButton,
  GradientCard,
  Label,
  PinnedFooter,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { formatMoney, parseAmount } from '../../src/core/money';
import { BANKS, resolveBrand } from '../../src/data/banks';
import { selectCardViews, useAppStore, type CardView } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

const CARD_KINDS = [
  { key: 'bank', label: 'Bank', icon: 'business-outline' as const },
  { key: 'wallet', label: 'Wallet', icon: 'wallet-outline' as const },
  { key: 'savings', label: 'Savings', icon: 'shield-checkmark-outline' as const },
  { key: 'goal', label: 'Goal', icon: 'flag-outline' as const },
];

type CardKind = 'bank' | 'wallet' | 'savings' | 'goal';

/**
 * Accounts & Cards.
 *
 * Two clear sections over one dataset: **Accounts** is the scannable list —
 * where money sits, how much each holds, and what draws on it — and **Cards**
 * shows the same accounts as their bank-branded card faces. The old screen
 * stacked a card face and a stats block per account, which read as one long
 * confusing column; splitting the two views makes each answer a single
 * question.
 */
export default function CardsScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();

  const views = useMemo(() => selectCardViews(state), [state]);

  const [open, setOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [bankId, setBankId] = useState<string | null>(null);
  const [last4, setLast4] = useState('');
  const [kind, setKind] = useState<CardKind>('bank');
  const [opening, setOpening] = useState('');
  const [target, setTarget] = useState('');

  const totalHeld = views.reduce((sum, view) => sum + view.balanceMinor, 0);

  function resetForm() {
    setName('');
    setBankId(null);
    setLast4('');
    setOpening('');
    setTarget('');
    setKind('bank');
    setEditingCardId(null);
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(cardId: string) {
    const card = state.cards.find((c) => c.id === cardId);
    if (!card) return;
    setEditingCardId(card.id);
    setName(card.name);
    setBankId(card.bankId ?? null);
    setLast4(card.last4 ?? '');
    setKind(card.kind as CardKind);
    setOpening(String(card.openingBalanceMinor / 100));
    setTarget(card.targetMinor ? String(card.targetMinor / 100) : '');
    setOpen(true);
  }

  function handleSave() {
    const brand = bankId ? BANKS.find((b) => b.id === bankId) : undefined;
    const trimmed = name.trim() || brand?.shortName || '';
    if (!trimmed) return;

    const patch = {
      name: trimmed,
      kind,
      bankId,
      bankName: brand?.name ?? null,
      last4: last4.trim() || null,
      icon: CARD_KINDS.find((k) => k.key === kind)?.icon ?? 'card-outline',
      openingBalanceMinor: parseAmount(opening) ?? 0,
      targetMinor: kind === 'goal' ? parseAmount(target) : null,
    };

    if (editingCardId) state.updateCard(editingCardId, patch);
    else state.addCard({ ...patch, sortOrder: state.cards.length });

    resetForm();
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
          <T variant="title">Accounts & Cards</T>
          <Pressable
            onPress={openCreate}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Add account"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name="add-circle" size={28} color={colors.accent} />
          </Pressable>
        </Row>

        <GradientCard>
          <View style={{ gap: 2 }}>
            <Label color="rgba(255,255,255,0.75)">TOTAL ACROSS ACCOUNTS</Label>
            <T variant="hero" color="#FFFFFF">
              {formatMoney(totalHeld)}
            </T>
            <T variant="caption" color="rgba(255,255,255,0.65)">
              {views.length} account{views.length === 1 ? '' : 's'} · opening balances plus
              transfers in
            </T>
          </View>
        </GradientCard>

        {views.length === 0 ? (
          <Empty
            icon="wallet-outline"
            title="No accounts yet"
            message="Add the bank accounts and wallets your categories transfer money into."
            actionLabel="Add an account"
            onAction={openCreate}
          />
        ) : (
          <>
            {/* Cards section — the branded faces, horizontal to keep them large. */}
            <View style={{ gap: space.sm }}>
              <Label>CARDS</Label>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space.md, paddingRight: space.lg }}
              >
                {state.cards.map((card) => (
                  <View key={card.id} style={{ width: 260 }}>
                    <BankCardTile card={card} onPress={() => openEdit(card.id)} compact />
                  </View>
                ))}
              </ScrollView>
            </View>

            {/* Accounts section — the scannable ledger of what each holds. */}
            <View style={{ gap: space.sm }}>
              <Label>ACCOUNTS</Label>
              <Surface padded={false} style={{ paddingVertical: space.xs }}>
                {views.map((view, index) => (
                  <View key={view.card.id}>
                    {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                    <AccountRow view={view} onEdit={() => openEdit(view.card.id)} />
                  </View>
                ))}
              </Surface>
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: colors.canvas }}
        >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <SheetHeader
            title={editingCardId ? 'Edit account' : 'New account'}
            onClose={() => setOpen(false)}
          />

          <BankPicker selectedId={bankId} onSelect={setBankId} />

          <Field
            label="Account name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Salary account"
          />
          <PillSelect
            label="Type"
            options={CARD_KINDS}
            selectedKey={kind}
            onSelect={(key) => setKind(key as CardKind)}
          />
          <Field
            label="Last 4 digits (optional)"
            value={last4}
            onChangeText={(text) => setLast4(text.replace(/\D/g, '').slice(0, 4))}
            placeholder="1234"
            keyboardType="numeric"
          />
          <Field
            label="Opening balance"
            value={opening}
            onChangeText={setOpening}
            placeholder="0"
            keyboardType="numeric"
          />
          {kind === 'goal' ? (
            <Field
              label="Target amount"
              value={target}
              onChangeText={setTarget}
              placeholder="e.g. 3000000"
              keyboardType="numeric"
            />
          ) : null}
        </ScrollView>

        <PinnedFooter>
          <GradientButton
            label={editingCardId ? 'Save changes' : 'Create account'}
            icon="checkmark"
            onPress={handleSave}
            disabled={!name.trim() && !bankId}
          />
        </PinnedFooter>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

/** One compact account row: brand logo, name, what it holds, what draws on it. */
function AccountRow({ view, onEdit }: { view: CardView; onEdit: () => void }) {
  const { colors, space } = useTheme();
  const state = useAppStore();
  const { card } = view;

  const brand = resolveBrand({ bankId: card.bankId, bankName: card.bankName, name: card.name });
  const hasGoal = typeof card.targetMinor === 'number' && card.targetMinor > 0;
  const goalPct = hasGoal ? Math.min(100, (view.balanceMinor / card.targetMinor!) * 100) : 0;

  function confirmDelete() {
    Alert.alert(`Delete ${card.name}?`, 'Categories pointing at it will need a new account.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => state.deleteCard(card.id) },
    ]);
  }

  return (
    <Pressable
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={`${card.name}, ${formatMoney(view.balanceMinor)}`}
      style={({ pressed }) => ({
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        gap: hasGoal ? space.sm : 0,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Row gap={space.md}>
        <BankLogo brand={brand} size={44} />

        <View style={{ flex: 1 }}>
          <Row gap={space.xs}>
            <T variant="bodyStrong" numberOfLines={1}>
              {card.name}
            </T>
            {card.last4 ? (
              <T variant="caption" tone="muted">
                ·{card.last4}
              </T>
            ) : null}
          </Row>
          <T variant="caption" tone="muted" numberOfLines={1}>
            {view.categoryNames.length > 0
              ? view.categoryNames.join(' · ')
              : 'No categories assigned'}
          </T>
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <T variant="figureLarge">{formatMoney(view.balanceMinor, { compact: true })}</T>
          {view.committedMinor > 0 ? (
            <T variant="caption" color={colors.pending}>
              {formatMoney(view.committedMinor, { compact: true })} to pay
            </T>
          ) : (
            <T variant="caption" tone="muted">
              balance
            </T>
          )}
        </View>

        <Pressable
          onPress={confirmDelete}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${card.name}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingLeft: space.xs })}
        >
          <Ionicons name="ellipsis-vertical" size={16} color={colors.inkMuted} />
        </Pressable>
      </Row>

      {hasGoal ? (
        <View style={{ gap: 3, paddingLeft: 44 + space.md }}>
          <FundingBar pct={goalPct} color={colors.accent} height={5} />
          <Row justify="space-between">
            <T variant="caption" tone="muted">
              {Math.round(goalPct)}% of {formatMoney(card.targetMinor!, { compact: true })}
            </T>
            <T variant="caption" tone="muted">
              {formatMoney(Math.max(0, card.targetMinor! - view.balanceMinor), { compact: true })}{' '}
              to go
            </T>
          </Row>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Horizontal strip of bank brands for choosing an account's bank. */
function BankPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      <Label>BANK</Label>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
      >
        {BANKS.map((brand) => {
          const selected = selectedId === brand.id;
          return (
            <Pressable
              key={brand.id}
              onPress={() => onSelect(selected ? null : brand.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={brand.name}
              style={({ pressed }) => ({
                alignItems: 'center',
                gap: 4,
                padding: 4,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: selected ? colors.ink : 'transparent',
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <BankLogo brand={brand} size={44} />
              <T
                variant="caption"
                tone={selected ? 'ink' : 'muted'}
                numberOfLines={1}
                style={{ maxWidth: 56 }}
              >
                {brand.shortName}
              </T>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
