import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { BankCardTile } from '~/features/accounts/components/BankCardTile';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import { Field } from '~/shared/components/forms';
import { AppHeader, BottomSheet, Button, DetailRow, Divider, Empty, FundingBar, GradientButton, GradientCard, Label, ListRow, Row, Segmented, Surface, Text } from '~/shared/components/ui';
import { useTabBarClearance } from '~/shared/components/TabBar';
import { formatMoney, parseAmount, toMajor } from '~/shared/lib/money';
import { accountLabel, accountName, BANKS } from '~/shared/data/banks';
import { useBrand } from '~/shared/hooks/useBrand';
import { selectCardViews, selectCategoryViews, useAppStore, type CardView } from '../../src/store/useAppStore';
import type { Card } from '../../src/db/schema';
import { useTheme } from '~/shared/theme/ThemeProvider';

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

  /*
   * `edit=<id>` opens this screen straight into that entry's form.
   *
   * The account detail route lives elsewhere (app/account/[id].tsx) but the
   * form lives here, so "Edit details" from there navigates in with this param
   * rather than the form being duplicated in two places.
   */
  const { edit, add } = useLocalSearchParams<{ edit?: string; add?: string }>();

  // `formId` null = closed; '' = creating new; an id = editing that entry.
  const [formId, setFormId] = useState<string | null>(add ? '' : (edit ?? null));

  /*
   * Re-open when the param arrives on an ALREADY-MOUNTED screen.
   *
   * The `useState` initializer above only runs on first mount, so navigating
   * here from the account detail — a tab the user has usually already visited —
   * set the param but left the form closed, and "Edit" appeared to do nothing.
   */
  React.useEffect(() => {
    if (edit) setFormId(edit);
  }, [edit]);

  /*
   * `?add=1` opens the form ready to create.
   *
   * Separate from `edit` because the "new" state is the empty string, which is
   * falsy — so it cannot be signalled through `edit` without every truthiness
   * check here treating it as "closed". Account pickers elsewhere in the app
   * link here when the user has nowhere to put the money yet.
   */
  React.useEffect(() => {
    if (add) setFormId('');
  }, [add]);
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
            <Text variant="hero" color="#FFFFFF">
              {formatMoney(totalHeld)}
            </Text>
            <Text variant="caption" color="rgba(255,255,255,0.65)">
              {accountViews.length} account{accountViews.length === 1 ? '' : 's'} · opening balances
              plus transfers in
            </Text>
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

  const brand = useBrand({ bankId: card.bankId, bankName: card.bankName });
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
        /* With a nickname set, the bank and last-4 move here — the row must
           still say *which real account* it is, or a list of nicknames is
           unusable for checking a balance against a banking app. */
        subtitle={
          [label.secondary, card.last4 ? `••${card.last4}` : null]
            .filter(Boolean)
            .join(' · ') ||
          (view.categoryNames.length > 0
            ? view.categoryNames.join(' · ')
            : 'No categories assigned')
        }
        trailing={
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="figureLarge">{formatMoney(view.balanceMinor, { compact: true })}</Text>
            {view.committedMinor > 0 ? (
              <Text variant="caption" color={colors.pending}>
                {formatMoney(view.committedMinor, { compact: true })} to pay
              </Text>
            ) : (
              <Text variant="caption" tone="muted">
                balance
              </Text>
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
            <Text variant="caption" tone="muted">
              {Math.round(goalPct)}% of {formatMoney(card.targetMinor!, { compact: true })}
            </Text>
            <Text variant="caption" tone="muted">
              {formatMoney(Math.max(0, card.targetMinor! - view.balanceMinor), { compact: true })} to
              go
            </Text>
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
  const brand = useBrand({ bankId: card.bankId, bankName: card.bankName });

  /**
   * The categories drawing on this account, each with what it costs a month.
   *
   * `view.categoryNames` carries only names, which was all the old list showed.
   * Resolving the categories properly gives the icon, colour and total that make
   * the section answer "how much of this account is already spoken for".
   */
  const funded = useMemo(
    () =>
      selectCategoryViews(state)
        .filter((cv) => cv.category.cardId === card.id)
        .map((cv) => ({
          id: cv.category.id,
          name: cv.category.name,
          color: cv.category.color,
          icon: cv.category.icon,
          totalMinor: cv.summary.totalMinor,
          count: cv.subcategories.length,
        })),
    [state, card.id],
  );

  function confirmDelete() {
    Alert.alert(
      `Delete ${accountName(card)}?`,
      'Categories pointing at it will need a new account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            state.deleteCard(card.id);
            onClose();
          },
        },
      ],
    );
  }

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={card.isCard ? 'Card details' : 'Account details'}
      icon={card.isCard ? 'card-outline' : 'wallet-outline'}
      iconColor={brand.color}
      scroll
      footer={<GradientButton label="Edit details" icon="create-outline" onPress={onEdit} />}
    >
          <Row gap={space.md}>
            <BankLogo brand={brand} size={48} />
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={1}>
                {accountLabel(card).primary}
              </Text>
              <Text variant="caption" tone="muted">
                {accountLabel(card).secondary ?? (card.isCard ? 'Card' : 'Account')}
              </Text>
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
                      : 'Not set'
                  }
                  muted={!card.cardNumber}
                  action={
                    card.cardNumber
                      ? { icon: revealed ? 'eye-off-outline' : 'eye-outline', onPress: () => setRevealed((v) => !v) }
                      : undefined
                  }
                />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow label="Expiry" value={card.expiry || 'Not set'} muted={!card.expiry} />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow
                  label="CVV"
                  value={card.cvv ? (revealed ? card.cvv : '•••') : 'Not set'}
                  muted={!card.cvv}
                />
              </>
            ) : (
              <>
                <DetailRow
                  label="Account number"
                  value={card.accountNumber || 'Not set'}
                  muted={!card.accountNumber}
                />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow label="Bank" value={card.bankName ?? brand.name} />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow label="Branch" value={card.branch || 'Not set'} muted={!card.branch} />
                <Divider style={{ marginHorizontal: space.lg }} />
                <DetailRow
                  label="Bank code"
                  value={card.bankCode || 'Not set'}
                  muted={!card.bankCode}
                />
              </>
            )}
          </Surface>

          {/* Categories funded from this account — accounts only. */}
          {!card.isCard ? (
            <View style={{ gap: space.sm }}>
              <Label>WHAT THIS FUNDS</Label>
              {/*
                Each category with its own icon, colour and monthly total.

                It used to be a list of bare names against one grey glyph, which
                answered "which categories" but not the question actually being
                asked here — how much of this account is spoken for, and by what.
                The figure is what makes the list worth reading.
              */}
              {funded.length > 0 ? (
                <Surface padded={false}>
                  {funded.map((cat, i) => (
                    <View key={cat.id}>
                      {i > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                      <Row
                        gap={space.md}
                        style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
                      >
                        <View
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 10,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: `${cat.color}1A`,
                          }}
                        >
                          <Ionicons
                            name={(cat.icon as never) ?? 'albums-outline'}
                            size={16}
                            color={cat.color}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text variant="body" numberOfLines={1}>
                            {cat.name}
                          </Text>
                          <Text variant="caption" tone="muted">
                            {cat.count} bill{cat.count === 1 ? '' : 's'}
                          </Text>
                        </View>
                        <Text variant="figure" color={cat.color}>
                          {formatMoney(cat.totalMinor)}
                        </Text>
                      </Row>
                    </View>
                  ))}
                </Surface>
              ) : (
                <Surface>
                  <Text variant="caption" tone="muted">
                    No categories draw from this account yet.
                  </Text>
                </Surface>
              )}
            </View>
          ) : null}

          {/* Delete stays in the scroll body, deliberately. A destructive action
              pinned under the thumb beside the primary one is how accidents
              happen — reaching it should take a scroll. */}
          <Button label="Delete" icon="trash-outline" variant="danger" onPress={confirmDelete} />
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
  /**
   * The ONE name the user gives an account.
   *
   * This form used to ask twice — a "Full name" and a "Short name" — for what
   * is a single question, and every list then had to rank the two against each
   * other to pick a headline. The bank already supplies the account's formal
   * identity, so all that is left to ask is what the USER calls it, and that is
   * this. Optional: with one account per bank the bank name is already
   * unambiguous, which is when a nickname is pure friction.
   */
  const [nickname, setNickname] = useState(existing?.nickname ?? '');
  /*
   * Derived only — there is no field for it any more.
   *
   * The last four digits are what bank SMS quote ("account:1380***4150"), so
   * they still drive matching; they are taken from the account/card number
   * below rather than asked for twice. Kept in state so an existing value
   * survives an edit that does not touch the number.
   */
  const [last4] = useState(existing?.last4 ?? '');
  // Card fields
  const [cardNumber, setCardNumber] = useState(existing?.cardNumber ?? '');
  const [cvv, setCvv] = useState(existing?.cvv ?? '');
  const [expiry, setExpiry] = useState(existing?.expiry ?? '');
  // Account fields
  const [accountNumber, setAccountNumber] = useState(existing?.accountNumber ?? '');
  const [branch, setBranch] = useState(existing?.branch ?? '');
  const [bankCode, setBankCode] = useState(existing?.bankCode ?? '');
  // What was already in the account before the app started tracking it. The
  // schema has always had this and the balance calculation reads it, but nothing
  // ever set it, so every account opened at zero.

  const brand = bankId ? BANKS.find((b) => b.id === bankId) : undefined;
  /*
   * How many OTHER accounts this bank already has — the edited one excluded, or
   * every edit of a lone HNB account would claim it has a duplicate.
   *
   * A second account at one bank is exactly when a nickname stops being
   * optional, so the hint under the field changes to say so.
   */
  const sameBankCount = brand
    ? state.cards.filter((c) => c.bankId === brand.id && c.id !== editId).length
    : 0;
  /*
   * A BANK is what makes the entry identifiable; the nickname only refines it.
   *
   * This used to also accept a typed name with no bank, which produced entries
   * with no brand, no logo and no way to match an incoming SMS to them.
   */
  const canSave = Boolean(brand);

  function handleSave() {
    if (!brand) return;
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
      // 'kind' (bank/wallet/savings/goal) was removed from the UI — every entry
      // added here is a plain bank account or card. Existing rows keep their kind.
      kind: existing?.kind ?? 'bank',
      isCard,
      bankId,
      bankName: brand?.name ?? existing?.bankName ?? null,
      nickname: nickname.trim() || null,
      last4: derivedLast4,
      icon: isCard ? 'card-outline' : 'wallet-outline',
      targetMinor: existing?.targetMinor ?? null,
      cardNumber: isCard ? cardNumber.trim() || null : null,
      cvv: isCard ? cvv.trim() || null : null,
      expiry: isCard ? expiry.trim() || null : null,
      accountNumber: !isCard ? accountNumber.trim() || null : null,
      branch: !isCard ? branch.trim() || null : null,
      bankCode: !isCard ? bankCode.trim() || null : null,
      // Preserved, not edited here: the field was removed from this form, and
      // writing a parsed-from-nothing 0 would silently wipe a real balance on
      // every save.
      openingBalanceMinor: existing?.openingBalanceMinor ?? 0,
    };

    if (editId) state.updateCard(editId, patch);
    else state.addCard({ ...patch, sortOrder: state.cards.length });
    onClose();
  }

  /*
   * The bank list is a STEP inside this sheet, not a sheet of its own.
   *
   * Twenty brands need the full height to be scannable, but stacking a second
   * modal on top of a form loses the sense of where you are — and dismissing it
   * risks dismissing the form underneath. Swapping the sheet's own body, with a
   * back button in place of the icon, keeps one presentation and one obvious way
   * out of each step.
   */
  const [pickingBank, setPickingBank] = React.useState(false);
  /*
   * The bank search text lives HERE, not inside `BankList`.
   *
   * Choosing a bank swaps this component's whole returned tree for a different
   * `BottomSheet`, so a `useState` inside the list is torn down and re-created
   * on the very first keystroke — the field cleared itself after one letter and
   * the filter never ran. Owning it at the level that survives the swap is what
   * makes typing work at all.
   */
  const [bankQuery, setBankQuery] = React.useState('');

  if (pickingBank) {
    return (
      <BottomSheet
        visible
        onClose={onClose}
        onBack={() => setPickingBank(false)}
        title="Choose bank"
        scroll
      >
        <BankList
          selectedId={bankId}
          query={bankQuery}
          onQueryChange={setBankQuery}
          onSelect={(id) => {
            setBankId(id);
            setPickingBank(false);
            setBankQuery('');
          }}
        />
      </BottomSheet>
    );
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

          {/* Step 2: bank — one row that opens the list as its own step. */}
          <BankField selectedId={bankId} onPress={() => setPickingBank(true)} />

          {/*
            ONE name field, not two.

            The bank above already says what this account formally is, so the
            only thing left to ask is what the user calls it — and asking that
            once, in the words they would actually use, is what tells three
            accounts at the same bank apart.
          */}
          <Field
            label="Nickname (optional)"
            value={nickname}
            onChangeText={setNickname}
            placeholder={isCard ? 'e.g. Visa, Everyday card' : 'e.g. Salary, Joint, Rent'}
          />
          <Text variant="caption" tone="muted" style={{ marginTop: -space.xs }}>
            {sameBankCount > 0
              ? `You already have ${sameBankCount} ${brand?.shortName ?? 'other'} account${sameBankCount === 1 ? '' : 's'} — a nickname keeps them apart.`
              : `Your own name for it. Leave it empty and it shows as ${brand?.shortName ?? 'the bank'}.`}
          </Text>

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

    </BottomSheet>
  );
}

/**
 * A two-option segmented control (Account / Card). Bigger tap targets and a
 * clearer selected state than a pill row, since this is the first choice made.
 */
/**
 * The bank, as one row on the form — logo, name, and a chevron into the list.
 *
 * Replaces a permanently-expanded grid: twenty brands at four across is five
 * rows of tiles, which pushed every other field below the fold. Picking a bank
 * is a once-per-account decision, so the form only needs to show WHICH bank,
 * with the alternatives one tap away.
 */
function BankField({
  selectedId,
  onPress,
}: {
  selectedId: string | null;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const brand = selectedId ? BANKS.find((b) => b.id === selectedId) : undefined;

  return (
    <View style={{ gap: space.sm }}>
      <Label>Bank</Label>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={brand ? `Bank: ${brand.name}. Tap to change.` : 'Choose a bank'}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.hairline,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        {brand ? (
          <BankLogo brand={brand} size={32} />
        ) : (
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceSunken,
            }}
          >
            <Ionicons name="business-outline" size={16} color={colors.inkMuted} />
          </View>
        )}
        <Text
          variant="body"
          style={{ flex: 1 }}
          tone={brand ? 'ink' : 'muted'}
          numberOfLines={1}
        >
          {brand?.name ?? 'Choose a bank'}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
      </Pressable>
    </View>
  );
}

/**
 * Every bank as a full-width row: logo, name, and a tick on the current one.
 *
 * A list rather than a grid of tiles. Twenty brands at four across meant a
 * 60pt-wide label under each logo, so anything longer than "Sampath" was
 * truncated and the user was really picking by logo alone. Full-width rows show
 * the whole name, sort scannably, and give a proper touch target.
 *
 * Search matches the SHORT name as well as the full one, because that is what
 * people actually type — "BOC", "HNB", "NTB" — and a filter that only knew
 * "Bank of Ceylon" would come back empty for the most natural query.
 */
function BankList({
  selectedId,
  query,
  onQueryChange,
  onSelect,
}: {
  selectedId: string | null;
  /** Controlled by the form — see `bankQuery` there for why it lives outside. */
  query: string;
  onQueryChange: (next: string) => void;
  onSelect: (id: string | null) => void;
}) {
  const { colors, radius, space } = useTheme();

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BANKS;
    return BANKS.filter(
      (brand) =>
        brand.name.toLowerCase().includes(q) || brand.shortName.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.hairline,
          backgroundColor: colors.surface,
        }}
      >
        <Ionicons name="search" size={16} color={colors.inkMuted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search bank…"
          placeholderTextColor={colors.inkMuted}
          autoCorrect={false}
          accessibilityLabel="Search bank"
          style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.ink }}
        />
        {query ? (
          <Pressable
            onPress={() => onQueryChange('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={16} color={colors.inkMuted} />
          </Pressable>
        ) : null}
      </View>

      {matches.length === 0 ? (
        <Surface>
          <Text variant="caption" tone="muted">
            No bank matches “{query.trim()}”. Leave it unset and just name the account.
          </Text>
        </Surface>
      ) : (
        <Surface padded={false}>
          {matches.map((brand, index) => {
            const selected = selectedId === brand.id;
            return (
              <View key={brand.id}>
                {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                <Pressable
                  // Tapping the current one clears it, so "no particular bank"
                  // stays reachable without a separate "None" row.
                  onPress={() => onSelect(selected ? null : brand.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={brand.name}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.sm + 2,
                    backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                  })}
                >
                  <BankLogo brand={brand} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text
                      variant="body"
                      style={{ fontWeight: selected ? '700' : '400' }}
                      numberOfLines={1}
                    >
                      {brand.name}
                    </Text>
                    {/* The short name, shown only when it adds something. It is
                        what the user is most likely to have typed to get here,
                        and repeating it under an identical full name would be
                        noise rather than confirmation. */}
                    {brand.shortName.toLowerCase() !== brand.name.toLowerCase() ? (
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {brand.shortName}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              </View>
            );
          })}
        </Surface>
      )}
    </View>
  );
}
