import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { BankCardTile } from '../../src/components/BankCardTile';
import { BankLogo } from '../../src/components/BankLogo';
import { Field, PillSelect } from '../../src/components/forms';
import {
  AppHeader,
  BottomSheet,
  Button,
  DetailRow,
  Divider,
  Empty,
  FundingBar,
  GradientButton,
  GradientCard,
  Label,
  ListRow,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { formatMoney, parseAmount } from '../../src/core/money';
import { accountLabel, BANKS } from '../../src/data/banks';
import { useBrand } from '../../src/hooks/useBrand';
import { selectCardViews, useAppStore, type CardView } from '../../src/store/useAppStore';
import type { Card } from '../../src/db/schema';
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
 * A fixed header sits above a scrolling body. **Cards** (payment cards) show as
 * branded faces — tap for number/CVV/expiry. **Accounts** show where money sits
 * — tap for account number, branch, code, and the categories that draw on it.
 * Adding starts by choosing card vs. account, then a bank, then only the fields
 * that entry type needs (no opening balance).
 */
export default function CardsScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const router = useRouter();
  const state = useAppStore();

  const views = useMemo(() => selectCardViews(state), [state]);
  const cardEntries = state.cards.filter((c) => c.isCard);
  const accountViews = views.filter((v) => !v.card.isCard);

  // `formId` null = closed; '' = creating new; an id = editing that entry.
  const [formId, setFormId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailCard = detailId ? state.cards.find((c) => c.id === detailId) : undefined;

  const totalHeld = accountViews.reduce((sum, view) => sum + view.balanceMinor, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <AppHeader
        title="Accounts & Cards"
        onBack={() => router.back()}
        action={{ icon: 'add-circle', label: 'Add account or card', onPress: () => setFormId('') }}
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
          <View style={{ gap: 2 }}>
            <Label color="rgba(255,255,255,0.75)">TOTAL ACROSS ACCOUNTS</Label>
            <T variant="hero" color="#FFFFFF">
              {formatMoney(totalHeld)}
            </T>
            <T variant="caption" color="rgba(255,255,255,0.65)">
              {accountViews.length} account{accountViews.length === 1 ? '' : 's'} · opening balances
              plus transfers in
            </T>
          </View>
        </GradientCard>

        {views.length === 0 ? (
          <Empty
            icon="wallet-outline"
            title="Nothing here yet"
            message="Add the bank accounts, wallets and cards your categories transfer money into."
            actionLabel="Add one"
            onAction={() => setFormId('')}
          />
        ) : (
          <>
            {cardEntries.length > 0 ? (
              <View style={{ gap: space.sm }}>
                <Label>CARDS</Label>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: space.md, paddingRight: space.lg }}
                >
                  {cardEntries.map((card) => (
                    <View key={card.id} style={{ width: 260 }}>
                      <BankCardTile card={card} onPress={() => setDetailId(card.id)} compact />
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {accountViews.length > 0 ? (
              <View style={{ gap: space.sm }}>
                <Label>ACCOUNTS</Label>
                <Surface padded={false} style={{ paddingVertical: space.xs }}>
                  {accountViews.map((view, index) => (
                    <View key={view.card.id}>
                      {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                      <AccountRow view={view} onOpen={() => setDetailId(view.card.id)} />
                    </View>
                  ))}
                </Surface>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {formId !== null ? (
        <CardFormModal editId={formId || null} onClose={() => setFormId(null)} />
      ) : null}

      {detailCard ? (
        <DetailModal
          card={detailCard}
          view={views.find((v) => v.card.id === detailCard.id)}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setFormId(detailCard.id);
          }}
        />
      ) : null}
    </View>
  );
}

/** One compact account row: brand logo, name, what it holds, what draws on it. */
function AccountRow({ view, onOpen }: { view: CardView; onOpen: () => void }) {
  const { colors, space } = useTheme();
  const { card } = view;

  const brand = useBrand({ bankId: card.bankId, bankName: card.bankName, name: card.name });
  const hasGoal = typeof card.targetMinor === 'number' && card.targetMinor > 0;
  const goalPct = hasGoal ? Math.min(100, (view.balanceMinor / card.targetMinor!) * 100) : 0;

  const label = accountLabel(card);
  return (
    <View style={{ gap: hasGoal ? space.sm : 0 }}>
      <ListRow
        leading={<BankLogo brand={brand} size={44} />}
        title={label.primary}
        subtitle={
          label.secondary ??
          (view.categoryNames.length > 0
            ? view.categoryNames.join(' · ')
            : 'No categories assigned')
        }
        trailing={
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
        }
        chevron
        onPress={onOpen}
        accessibilityLabel={`${label.primary}, ${formatMoney(view.balanceMinor)}. Open details.`}
      />

      {hasGoal ? (
        <View
          style={{
            gap: 3,
            paddingLeft: space.lg + 44 + space.md,
            paddingRight: space.lg,
            paddingBottom: space.sm,
          }}
        >
          <FundingBar pct={goalPct} color={colors.accent} height={5} />
          <Row justify="space-between">
            <T variant="caption" tone="muted">
              {Math.round(goalPct)}% of {formatMoney(card.targetMinor!, { compact: true })}
            </T>
            <T variant="caption" tone="muted">
              {formatMoney(Math.max(0, card.targetMinor! - view.balanceMinor), { compact: true })} to
              go
            </T>
          </Row>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Detail modal for one entry. A *card* shows its number, CVV and expiry (with
 * the number tap-to-reveal, since it's sensitive); an *account* shows its
 * number, branch, code, and — at the bottom — the categories funded from it.
 */
function DetailModal({
  card,
  view,
  onClose,
  onEdit,
}: {
  card: Card;
  view: CardView | undefined;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { colors, space } = useTheme();
  const state = useAppStore();
  const [revealed, setRevealed] = useState(false);
  const brand = useBrand({ bankId: card.bankId, bankName: card.bankName, name: card.name });

  function confirmDelete() {
    Alert.alert(`Delete ${card.name}?`, 'Categories pointing at it will need a new account.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteCard(card.id);
          onClose();
        },
      },
    ]);
  }

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={card.isCard ? 'Card details' : 'Account details'}
      icon={card.isCard ? 'card-outline' : 'wallet-outline'}
      iconColor={brand.color}
      heightPct={0.9}
      scroll
    >
          <Row gap={space.md}>
            <BankLogo brand={brand} size={48} />
            <View style={{ flex: 1 }}>
              <T variant="heading" numberOfLines={1}>
                {accountLabel(card).primary}
              </T>
              <T variant="caption" tone="muted">
                {accountLabel(card).secondary ?? (card.isCard ? 'Card' : 'Account')}
              </T>
            </View>
          </Row>

          <Surface padded={false}>
            {card.isCard ? (
              <>
                <DetailRow
                  label="Card number"
                  value={
                    card.cardNumber
                      ? revealed
                        ? card.cardNumber
                        : `•••• •••• •••• ${card.cardNumber.slice(-4)}`
                      : '—'
                  }
                  action={
                    card.cardNumber
                      ? { icon: revealed ? 'eye-off-outline' : 'eye-outline', onPress: () => setRevealed((v) => !v) }
                      : undefined
                  }
                />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow label="Expiry" value={card.expiry || '—'} />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow label="CVV" value={card.cvv ? (revealed ? card.cvv : '•••') : '—'} />
              </>
            ) : (
              <>
                <DetailRow label="Account number" value={card.accountNumber || '—'} />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow label="Bank" value={card.bankName ?? brand.name} />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow label="Branch" value={card.branch || '—'} />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow label="Bank code" value={card.bankCode || '—'} />
              </>
            )}
          </Surface>

          {/* Categories funded from this account — accounts only. */}
          {!card.isCard ? (
            <View style={{ gap: space.sm }}>
              <Label>CATEGORIES USING THIS ACCOUNT</Label>
              <Surface padded={false} style={{ paddingVertical: space.xs }}>
                {view && view.categoryNames.length > 0 ? (
                  view.categoryNames.map((n, i) => (
                    <View key={n}>
                      {i > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                      <Row gap={space.sm} style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
                        <Ionicons name="albums-outline" size={16} color={colors.inkMuted} />
                        <T variant="small">{n}</T>
                      </Row>
                    </View>
                  ))
                ) : (
                  <T variant="caption" tone="muted" style={{ padding: space.lg }}>
                    No categories draw from this account yet.
                  </T>
                )}
              </Surface>
            </View>
          ) : null}

          <Row gap={space.sm}>
            <Button label="Edit" icon="create-outline" variant="secondary" onPress={onEdit} style={{ flex: 1 }} />
            <Button label="Delete" icon="trash-outline" variant="danger" onPress={confirmDelete} style={{ flex: 1 }} />
          </Row>
    </BottomSheet>
  );
}


/**
 * Add / edit an account or card. The flow: choose card vs. account, pick the
 * bank, name it, then fill only that type's fields — card gets number/CVV/expiry,
 * account gets number/branch/code. No opening balance is collected.
 */
function CardFormModal({ editId, onClose }: { editId: string | null; onClose: () => void }) {
  const { colors, space } = useTheme();
  const state = useAppStore();
  const existing = editId ? state.cards.find((c) => c.id === editId) : undefined;

  const [isCard, setIsCard] = useState(existing?.isCard ?? false);
  const [bankId, setBankId] = useState<string | null>(existing?.bankId ?? null);
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<CardKind>((existing?.kind as CardKind) ?? 'bank');
  const [last4, setLast4] = useState(existing?.last4 ?? '');
  const [target, setTarget] = useState(existing?.targetMinor ? String(existing.targetMinor / 100) : '');
  // Card fields
  const [cardNumber, setCardNumber] = useState(existing?.cardNumber ?? '');
  const [cvv, setCvv] = useState(existing?.cvv ?? '');
  const [expiry, setExpiry] = useState(existing?.expiry ?? '');
  // Account fields
  const [accountNumber, setAccountNumber] = useState(existing?.accountNumber ?? '');
  const [branch, setBranch] = useState(existing?.branch ?? '');
  const [bankCode, setBankCode] = useState(existing?.bankCode ?? '');

  const brand = bankId ? BANKS.find((b) => b.id === bankId) : undefined;
  const canSave = Boolean(name.trim() || brand);

  function handleSave() {
    const trimmed = name.trim() || brand?.shortName || '';
    if (!trimmed) return;
    const derivedLast4 =
      last4.trim() ||
      (isCard ? cardNumber.replace(/\D/g, '').slice(-4) : accountNumber.replace(/\D/g, '').slice(-4)) ||
      null;

    const patch = {
      name: trimmed,
      kind,
      isCard,
      bankId,
      bankName: brand?.name ?? existing?.bankName ?? null,
      last4: derivedLast4,
      icon: isCard ? 'card-outline' : (CARD_KINDS.find((k) => k.key === kind)?.icon ?? 'wallet-outline'),
      targetMinor: kind === 'goal' ? parseAmount(target) : null,
      cardNumber: isCard ? cardNumber.trim() || null : null,
      cvv: isCard ? cvv.trim() || null : null,
      expiry: isCard ? expiry.trim() || null : null,
      accountNumber: !isCard ? accountNumber.trim() || null : null,
      branch: !isCard ? branch.trim() || null : null,
      bankCode: !isCard ? bankCode.trim() || null : null,
    };

    if (editId) state.updateCard(editId, patch);
    else state.addCard({ ...patch, sortOrder: state.cards.length });
    onClose();
  }

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={editId ? 'Edit' : 'Add account or card'}
      icon={isCard ? 'card-outline' : 'wallet-outline'}
      iconColor={colors.accent}
      heightPct={0.9}
      scroll
      footer={
        <GradientButton
          label={editId ? 'Save changes' : isCard ? 'Add card' : 'Add account'}
          icon="checkmark"
          onPress={handleSave}
          disabled={!canSave}
        />
      }
    >
          {/* Step 1: what is it? */}
          <PillSelect
            label="What are you adding?"
            options={[
              { key: 'account', label: 'Account', icon: 'wallet-outline' },
              { key: 'card', label: 'Card', icon: 'card-outline' },
            ]}
            selectedKey={isCard ? 'card' : 'account'}
            onSelect={(key) => setIsCard(key === 'card')}
          />

          {/* Step 2: bank. */}
          <BankPicker selectedId={bankId} onSelect={setBankId} />

          {/* Step 3: name. */}
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder={isCard ? 'e.g. HNB Visa' : 'e.g. Salary account'}
          />

          {/* Step 4: type-specific fields. */}
          {isCard ? (
            <>
              <Field
                label="Card number"
                value={cardNumber}
                onChangeText={setCardNumber}
                placeholder="4242 4242 4242 4242"
                keyboardType="numeric"
              />
              <Row gap={space.md}>
                <Field label="Expiry" value={expiry} onChangeText={setExpiry} placeholder="MM/YY" style={{ flex: 1 }} />
                <Field
                  label="CVV"
                  value={cvv}
                  onChangeText={setCvv}
                  placeholder="123"
                  keyboardType="numeric"
                  style={{ flex: 1 }}
                />
              </Row>
            </>
          ) : (
            <>
              <PillSelect
                label="Type"
                options={CARD_KINDS}
                selectedKey={kind}
                onSelect={(key) => setKind(key as CardKind)}
              />
              <Field
                label="Account number"
                value={accountNumber}
                onChangeText={setAccountNumber}
                placeholder="e.g. 100200300456"
                keyboardType="numeric"
              />
              <Row gap={space.md}>
                <Field label="Branch" value={branch} onChangeText={setBranch} placeholder="e.g. Kelaniya" style={{ flex: 1 }} />
                <Field label="Bank code" value={bankCode} onChangeText={setBankCode} placeholder="e.g. 7010" style={{ flex: 1 }} />
              </Row>
              {kind === 'goal' ? (
                <Field
                  label="Target amount"
                  value={target}
                  onChangeText={setTarget}
                  placeholder="e.g. 3000000"
                  keyboardType="numeric"
                />
              ) : null}
            </>
          )}
    </BottomSheet>
  );
}

/** Horizontal strip of bank brands for choosing an entry's bank. */
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
              <T variant="caption" tone={selected ? 'ink' : 'muted'} numberOfLines={1} style={{ maxWidth: 56 }}>
                {brand.shortName}
              </T>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
