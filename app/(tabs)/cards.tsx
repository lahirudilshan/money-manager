import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { BankCardTile } from '../../src/components/BankCardTile';
import { BankLogo } from '../../src/components/BankLogo';
import { Field } from '../../src/components/forms';
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
import { formatMoney } from '../../src/core/money';
import { accountLabel, BANKS } from '../../src/data/banks';
import { useBrand } from '../../src/hooks/useBrand';
import { selectCardViews, useAppStore, type CardView } from '../../src/store/useAppStore';
import type { Card } from '../../src/db/schema';
import { useTheme } from '../../src/theme/ThemeProvider';

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
  // Clamped at both ends: a balance can now go negative (spending can exceed
  // what was funded in), and a negative percentage would render a bar with a
  // negative width.
  const goalPct = hasGoal
    ? Math.max(0, Math.min(100, (view.balanceMinor / card.targetMinor!) * 100))
    : 0;

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
  const [last4, setLast4] = useState(existing?.last4 ?? '');
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
    // Last-4 is what matches an incoming SMS to this entry, so it is preserved
    // rather than re-derived from whichever number field the current type shows:
    // switching Account <-> Card clears the other type's number, which would
    // otherwise silently blank the digits and break SMS matching. An explicit
    // value wins, then the visible number, then whatever was already stored.
    const derivedLast4 =
      last4.replace(/\D/g, '').slice(-4) ||
      (isCard ? cardNumber.replace(/\D/g, '').slice(-4) : accountNumber.replace(/\D/g, '').slice(-4)) ||
      existing?.last4 ||
      null;

    const patch = {
      name: trimmed,
      // 'kind' (bank/wallet/savings/goal) was removed from the UI — every entry
      // added here is a plain bank account or card. Existing rows keep their kind.
      kind: existing?.kind ?? 'bank',
      isCard,
      bankId,
      bankName: brand?.name ?? existing?.bankName ?? null,
      last4: derivedLast4,
      icon: isCard ? 'card-outline' : 'wallet-outline',
      targetMinor: existing?.targetMinor ?? null,
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
          {/* Step 1: account or card — a clear segmented choice. */}
          <Segmented
            options={[
              { key: 'account', label: 'Account', icon: 'wallet-outline' },
              { key: 'card', label: 'Card', icon: 'card-outline' },
            ]}
            selectedKey={isCard ? 'card' : 'account'}
            onSelect={(key) => setIsCard(key === 'card')}
          />

          {/* Step 2: bank — a full grid so every option is visible at a glance. */}
          <BankPicker selectedId={bankId} onSelect={setBankId} />

          {/* Step 3: name. */}
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder={isCard ? 'e.g. HNB Visa' : 'e.g. Salary account'}
          />

          {/* Step 4: the identifying details for each type. */}
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
            </>
          )}

          {/* The digits bank SMS quote ("account:1380***4150"). Filled in from the
              number above when one is entered, but editable on its own — the
              alerts only ever show the last four, so this is all that is needed
              to recognise them, and it saves typing a full number just to get
              SMS matching working. */}
          <View style={{ gap: 4 }}>
            <Field
              label="Last 4 digits"
              value={last4}
              onChangeText={(text) => setLast4(text.replace(/\D/g, '').slice(-4))}
              placeholder={
                (isCard ? cardNumber : accountNumber).replace(/\D/g, '').slice(-4) || 'e.g. 4150'
              }
              keyboardType="numeric"
            />
            <T variant="caption" tone="muted">
              Used to match bank SMS to this {isCard ? 'card' : 'account'}.
            </T>
          </View>
    </BottomSheet>
  );
}

/**
 * A two-option segmented control (Account / Card). Bigger tap targets and a
 * clearer selected state than a pill row, since this is the first choice made.
 */
function Segmented({
  options,
  selectedKey,
  onSelect,
}: {
  options: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceSunken,
        borderRadius: radius.md,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((option) => {
        const selected = selectedKey === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 11,
              borderRadius: radius.sm,
              backgroundColor: selected ? colors.surface : 'transparent',
              ...(selected
                ? {
                    borderWidth: 1,
                    borderColor: colors.hairline,
                    shadowColor: '#000',
                    shadowOpacity: 0.06,
                    shadowRadius: 4,
                    shadowOffset: { width: 0, height: 1 },
                  }
                : {}),
            }}
          >
            <Ionicons
              name={option.icon}
              size={17}
              color={selected ? colors.accent : colors.inkSecondary}
            />
            <T
              variant="small"
              color={selected ? colors.ink : colors.inkSecondary}
              style={{ fontWeight: selected ? '800' : '600' }}
            >
              {option.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Bank chooser as a wrapped grid — every brand visible at once (no hidden
 * horizontal scroll), each a logo + short name tile with a clear selected ring.
 */
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
      <Label>Bank</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
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
                width: '23%',
                alignItems: 'center',
                gap: 5,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: selected ? brand.color : colors.hairline,
                backgroundColor: selected ? `${brand.color}12` : colors.surface,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <BankLogo brand={brand} size={38} />
              <T
                variant="caption"
                color={selected ? colors.ink : colors.inkMuted}
                numberOfLines={1}
                style={{ maxWidth: 60, fontWeight: selected ? '700' : '500' }}
              >
                {brand.shortName}
              </T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
