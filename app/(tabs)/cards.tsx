import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ColorPicker, Field, PillSelect, SheetHeader } from '../../src/components/forms';
import {
  Button,
  Divider,
  Empty,
  FundingBar,
  Glyph,
  GradientCard,
  Label,
  Row,
  ScreenHeader,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { formatMoney, parseAmount } from '../../src/core/money';
import { selectCardViews, useAppStore, type CardView } from '../../src/store/useAppStore';
import { groupColors } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

const CARD_KINDS = [
  { key: 'bank', label: 'Bank', icon: 'business-outline' as const },
  { key: 'wallet', label: 'Wallet', icon: 'wallet-outline' as const },
  { key: 'savings', label: 'Savings', icon: 'shield-checkmark-outline' as const },
  { key: 'goal', label: 'Goal', icon: 'flag-outline' as const },
];

type CardKind = 'bank' | 'wallet' | 'savings' | 'goal';

/** Cards are destinations: each shows what it holds and which groups draw on it. */
export default function CardsScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const state = useAppStore();

  const views = useMemo(() => selectCardViews(state), [state]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CardKind>('bank');
  const [opening, setOpening] = useState('');
  const [target, setTarget] = useState('');
  const [colorIndex, setColorIndex] = useState(0);

  const totalHeld = views.reduce((sum, view) => sum + view.balanceMinor, 0);

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;

    state.addCard({
      name: trimmed,
      kind,
      color: groupColors[colorIndex],
      icon: CARD_KINDS.find((k) => k.key === kind)?.icon ?? 'card-outline',
      openingBalanceMinor: parseAmount(opening) ?? 0,
      targetMinor: kind === 'goal' ? parseAmount(target) : null,
      sortOrder: state.cards.length,
    });

    setName('');
    setOpening('');
    setTarget('');
    setKind('bank');
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
          eyebrow="DESTINATIONS"
          title="Cards"
          action={{ icon: 'add', onPress: () => setOpen(true), label: 'Add card' }}
        />

        <GradientCard>
          <View style={{ gap: 2 }}>
            <Label color="rgba(255,255,255,0.75)">TOTAL ACROSS CARDS</Label>
            <T variant="hero" color="#FFFFFF">
              {formatMoney(totalHeld)}
            </T>
            <T variant="caption" color="rgba(255,255,255,0.65)">
              Opening balances plus everything transferred this month
            </T>
          </View>
        </GradientCard>

        {views.length === 0 ? (
          <Empty
            icon="wallet-outline"
            title="No cards yet"
            message="Add the accounts your groups transfer money into."
            actionLabel="Add a card"
            onAction={() => setOpen(true)}
          />
        ) : (
          views.map((view) => <CardRow key={view.card.id} view={view} />)
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
          <SheetHeader title="New card" onClose={() => setOpen(false)} />
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. HNB Savings"
            autoFocus
          />
          <PillSelect
            label="Type"
            options={CARD_KINDS}
            selectedKey={kind}
            onSelect={(key) => setKind(key as CardKind)}
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
          <ColorPicker
            colors={groupColors}
            selectedIndex={colorIndex}
            onSelect={setColorIndex}
          />
          <Button label="Create card" onPress={handleCreate} disabled={!name.trim()} />
        </ScrollView>
      </Modal>
    </>
  );
}

function CardRow({ view }: { view: CardView }) {
  const { colors, space } = useTheme();
  const state = useAppStore();
  const { card } = view;

  const hasGoal = typeof card.targetMinor === 'number' && card.targetMinor > 0;
  const goalPct = hasGoal
    ? Math.min(100, (view.balanceMinor / card.targetMinor!) * 100)
    : 0;

  function confirmDelete() {
    Alert.alert(`Delete ${card.name}?`, 'Groups pointing at it will need a new card.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => state.deleteCard(card.id) },
    ]);
  }

  return (
    <Surface style={{ gap: space.md }}>
      <Row>
        <Glyph icon={card.icon as never} color={card.color} size={44} />
        <View style={{ flex: 1, gap: 1 }}>
          <T variant="heading">{card.name}</T>
          <T variant="caption" tone="muted" numberOfLines={1}>
            {view.groupNames.length > 0
              ? view.groupNames.join(' · ')
              : 'No groups assigned'}
          </T>
        </View>
        <Ionicons
          name="trash-outline"
          size={18}
          color={colors.inkMuted}
          onPress={confirmDelete}
          suppressHighlighting
        />
      </Row>

      <Row justify="space-between" align="flex-end">
        <View style={{ gap: 1 }}>
          <Label>BALANCE</Label>
          <T variant="display">{formatMoney(view.balanceMinor)}</T>
        </View>
        {view.committedMinor > 0 ? (
          <View style={{ alignItems: 'flex-end', gap: 1 }}>
            <Label>COMMITTED</Label>
            <T variant="figure" color={colors.pending}>
              {formatMoney(view.committedMinor, { compact: true })}
            </T>
          </View>
        ) : null}
      </Row>

      {hasGoal ? (
        <View style={{ gap: space.xs }}>
          <FundingBar pct={goalPct} color={card.color} />
          <Row justify="space-between">
            <T variant="caption" tone="muted">
              {Math.round(goalPct)}% of {formatMoney(card.targetMinor!, { compact: true })}
            </T>
            <T variant="caption" tone="muted">
              {formatMoney(Math.max(0, card.targetMinor! - view.balanceMinor), {
                compact: true,
              })}{' '}
              to go
            </T>
          </Row>
        </View>
      ) : null}

      {view.fundedInMinor > 0 ? (
        <>
          <Divider />
          <Row justify="space-between">
            <T variant="caption" tone="muted">
              Transferred in this month
            </T>
            <T variant="figure" color={colors.completed}>
              +{formatMoney(view.fundedInMinor)}
            </T>
          </Row>
        </>
      ) : null}
    </Surface>
  );
}
