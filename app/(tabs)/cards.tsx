import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { BankCardTile } from '~/features/accounts/components/BankCardTile';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import { Field, PillSelect } from '~/shared/components/forms';

/**
 * The currencies an account can be held in.
 *
 * The home currency always leads — it is what almost every account is — then
 * USD, which is the one the app holds a rate for and the one people actually
 * bank in here. The rest are offered because holding them is possible even
 * though the app cannot convert them; `needsRate` marks those so a total says
 * it excluded them rather than quietly guessing.
 *
 * A fixed list rather than a text field: a typo in an ISO code stops the
 * account matching anything, silently.
 */
const CURRENCY_OPTIONS = (home: string) => {
  const code = home.toUpperCase();
  const rest = ['USD', 'EUR', 'GBP', 'AUD'].filter((c) => c !== code);
  return [code, ...rest].map((c) => ({ key: c, label: c }));
};
import { AppHeader, BottomSheet, Button, DetailRow, Divider, Empty, FundingBar, GradientButton, GradientCard, Label, ListRow, Row, Segmented, Surface, Text } from '~/shared/components/ui';
import { useTabBarClearance } from '~/shared/components/TabBar';
import { formatMoney, parseAmount, toMajor } from '~/shared/lib/money';
import { accountCurrency, sumInHome } from '~/features/accounts/logic/accountCurrency';
import { accountTailSeen, validateAccountNumber } from '~/features/accounts/logic/dualCurrency';
import { effectiveAmount, resolveCardId } from '~/features/budget/logic/planning';
import { groupAccounts, isPaired } from '~/features/accounts/logic/accountGroups';
import { accountLabel, accountName, BANKS, resolveBrand } from '~/shared/data/banks';
import { useBrand } from '~/shared/hooks/useBrand';
import { selectCardViews, selectCategoryViews, useAppStore, type CardView } from '../../src/store/useAppStore';
import type { Card } from '../../src/db/schema';
import { smsLogRepo } from '../../src/db/repositories';
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
   * The two halves of one bank relationship, drawn together.
   *
   * Grouped on the VIEW rather than the raw card so each row keeps the balance
   * and funding figures it already computed — this only decides adjacency.
   */
  const accountGroups = useMemo(
    () =>
      groupAccounts(
        accountViews.map((view) => ({
          id: view.card.id,
          bankId: view.card.bankId,
          accountNumber: view.card.accountNumber,
          last4: view.card.last4,
          card: view.card,
          view,
        })),
      ).map((group) => ({ key: group.key, cards: group.cards })),
    [accountViews],
  );

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

  /*
   * CONVERTED before summing.
   *
   * Adding a USD balance straight into a rupee total is wrong by a factor of
   * the rate, and invisibly so — by the time the figures reach this reduce they
   * are both just integers. `toHomeMinor` puts every account into the home
   * currency first; an account in something the app holds no rate for passes
   * through unconverted and is counted by `unconvertible`, so the card can say
   * the total leaves it out rather than quietly misreporting.
   */
  const { totalMinor: totalHeld, excluded: unconvertible } = sumInHome(
    accountViews.map((view) => ({ account: view.card, amountMinor: view.balanceMinor })),
    state.currency,
    state.usdRate,
  );

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
            {/*
              Said out loud when the total cannot include everything.

              The app stores one exchange rate (USD), so an account in another
              currency has nothing to convert by. Leaving it out silently would
              make the headline quietly wrong; saying so makes it merely
              incomplete, which the user can act on.
            */}
            {unconvertible > 0 ? (
              <Text variant="caption" color="rgba(255,255,255,0.65)">
                Excludes {unconvertible} account{unconvertible === 1 ? '' : 's'} with no exchange
                rate
              </Text>
            ) : null}
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
                  {/*
                    Two accounts of ONE bank relationship draw under one heading.

                    Someone paid in foreign currency holds a USD account the
                    salary lands in and a local one the bills are paid from —
                    genuinely two accounts, stored as two rows, each keeping its
                    own currency and balance. But listed flat they read as the
                    same bank entered twice, with nothing saying the two belong
                    together.

                    Display only: a bill still points at one row and a balance
                    still belongs to one row. See `groupAccounts` for why the
                    pairing is not structural.
                  */}
                  {accountGroups.map((group, groupIndex) => (
                    <View key={group.key}>
                      {groupIndex > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}

                      {/* The heading appears only for a real pair — a lone
                          account is already labelled by its own row. */}
                      {isPaired(group) ? (
                        <Row
                          gap={6}
                          style={{
                            paddingHorizontal: space.lg,
                            paddingTop: space.sm,
                            paddingBottom: 2,
                          }}
                        >
                          <Ionicons name="link-outline" size={12} color={colors.inkMuted} />
                          <Text variant="caption" tone="muted">
                            {resolveBrand({
                              bankId: group.cards[0].card.bankId,
                              bankName: group.cards[0].card.bankName,
                            }).name}
                          </Text>
                        </Row>
                      ) : null}

                      {group.cards.map((entry, index) => (
                        <View key={entry.id}>
                          {/* Inset divider WITHIN a pair, so the two halves
                              read as more closely related than two groups. */}
                          {index > 0 ? (
                            <Divider style={{ marginLeft: 62, marginRight: space.lg }} />
                          ) : null}
                          <AccountRow view={entry.view} onOpen={() => setDetailId(entry.id)} />
                        </View>
                      ))}
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
  /*
   * A foreign account's balance is shown in ITS OWN currency.
   *
   * This is the whole point of the column: a USD account formatted as rupees
   * read as LKR 1,200 when the bank says USD 1,200 — wrong by the exchange
   * rate, with nothing on screen to reveal it. Every OTHER figure on this
   * screen stays in the home currency, because those are sums across accounts.
   */
  const homeCurrency = useAppStore((s) => s.currency);
  const heldIn = accountCurrency(view.card, homeCurrency);
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
            <Text variant="figureLarge">
              {formatMoney(view.balanceMinor, { compact: true, currency: heldIn })}
            </Text>
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
        /*
         * The commitment is part of what this row SAYS, so it belongs in the
         * label.
         *
         * A row's `accessibilityLabel` replaces whatever its children would have
         * announced, so naming only the balance meant "LKR 53K to pay" — the
         * figure the row exists to surface — was visible on screen and absent
         * from the accessibility tree entirely. Someone using VoiceOver heard
         * "Household, LKR 0" and had no way to learn that Rs 53,000 was owed.
         */
        accessibilityLabel={
          view.committedMinor > 0
            ? `${label.primary}, ${formatMoney(view.balanceMinor)}, ${formatMoney(view.committedMinor)} to pay. Open details.`
            : `${label.primary}, ${formatMoney(view.balanceMinor)}. Open details.`
        }
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
  /*
   * Resolved per LINE, not per category.
   *
   * Filtering on `category.cardId` was wrong in both directions, because a bill
   * can override the account its category names:
   *
   *   - it MISSED a category reached only by an override. Observed on the
   *     user's board: a LKR 50,000 grocery budget inside "Living" points at
   *     Household, so Household funded it — but this listed only "Pet" and the
   *     grocery money appeared to belong to no account at all.
   *   - it INVENTED categories for the account named at category level even
   *     when every line inside had been pointed somewhere else.
   *
   * So each category is reduced to the lines that actually resolve here, and
   * dropped when none do. The total and the count follow those lines rather
   * than the category's whole summary, which would otherwise report money
   * belonging to a different account.
   *
   * This is the same rule `selectAccountTransfers` and the account detail page
   * use — three places had to agree and only two did.
   */
  // The account's own currency labels the number rows below.
  const homeCurrency = state.currency;

  const funded = useMemo(
    () =>
      selectCategoryViews(state)
        .map((cv) => {
          const lines = cv.subcategories.filter((sub) => {
            const raw = cv.rawSubcategories.find((r) => r.id === sub.id);
            return resolveCardId(raw?.cardId, cv.category.cardId) === card.id;
          });

          return {
            id: cv.category.id,
            name: cv.category.name,
            color: cv.category.color,
            icon: cv.category.icon,
            totalMinor: lines.reduce((sum, line) => sum + effectiveAmount(line), 0),
            count: lines.length,
          };
        })
        .filter((cat) => cat.count > 0),
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
                {/*
                  A dual-currency relationship names BOTH numbers, each with its
                  currency.

                  One row labelled "Account number" is right for the ordinary
                  account and actively misleading for a relationship holding
                  two: it shows one of the numbers with nothing to say which
                  currency it is, while the other — the one a foreign salary
                  lands in — is invisible.

                  A bank that puts both currencies behind ONE number leaves the
                  second blank and correctly falls back to the single row:
                  labelling it by currency would imply a second exists.
                */}
                {card.foreignCurrency && card.foreignAccountNumber ? (
                  <>
                    <DetailRow
                      label={`${accountCurrency(card, homeCurrency)} account`}
                      value={card.accountNumber || 'Not set'}
                      muted={!card.accountNumber}
                    />
                    <Divider style={{ marginHorizontal: space.lg }} />
                    <DetailRow
                      label={`${card.foreignCurrency.toUpperCase()} account`}
                      value={card.foreignAccountNumber}
                    />
                  </>
                ) : card.foreignCurrency ? (
                  <>
                    <DetailRow
                      label="Account number"
                      value={card.accountNumber || 'Not set'}
                      muted={!card.accountNumber}
                    />
                    <Divider style={{ marginHorizontal: space.lg }} />
                    <DetailRow
                      label="Also holds"
                      value={`${card.foreignCurrency.toUpperCase()} under the same number`}
                    />
                  </>
                ) : (
                  <DetailRow
                    label="Account number"
                    value={card.accountNumber || 'Not set'}
                    muted={!card.accountNumber}
                  />
                )}
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
  const { colors, space, radius } = useTheme();
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
  /** The app's own currency — the default for a new account, and the value
   *  a stored `null` means. */
  const homeCurrency = useAppStore((s) => s.currency);
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
  /*
   * The optional second leg of a dual-currency relationship.
   *
   * Shown only once the user asks for it, because the single-currency account
   * is the overwhelming majority and a permanently visible second number would
   * read as a required field. Opens pre-expanded when the row already has one.
   */
  const [foreignAccountNumber, setForeignAccountNumber] = useState(
    existing?.foreignAccountNumber ?? '',
  );
  const [foreignCurrency, setForeignCurrency] = useState(
    (existing?.foreignCurrency ?? 'USD').toUpperCase(),
  );
  const [showForeignAccount, setShowForeignAccount] = useState(
    Boolean(existing?.foreignCurrency),
  );

  /*
   * Validation errors, computed live but REVEALED only after a save attempt.
   *
   * Flagging "too short" against a half-typed number is nagging: every account
   * number passes through invalid states on its way to being right. The border
   * and message appear once the user has said they are done — and from then on
   * they update live, so a correction clears the error as it is made.
   */
  const [showErrors, setShowErrors] = useState(false);
  const accountNumberError = validateAccountNumber(accountNumber);
  /*
   * Every account fragment the app has seen in a real bank message.
   *
   * Read once per form open. It is a small distinct-select over a table that
   * only grows when messages arrive, and re-running it per keystroke would
   * query on every digit typed.
   */
  const seenAccounts = useMemo(() => smsLogRepo.seenAccounts(), []);
  /*
   * A number that matches nothing the bank has ever sent.
   *
   * A WARNING, never an error: the number may be perfectly correct and simply
   * not have appeared in a message yet, and blocking a save on that would be
   * wrong. But it is worth saying, because the failure is otherwise silent —
   * the account just never matches, with nothing connecting that to this field.
   */
  const accountUnseen =
    !accountNumberError && accountNumber.trim().length > 0
      ? !accountTailSeen(accountNumber, seenAccounts)
      : false;
  const foreignAccountNumberError = showForeignAccount
    ? validateAccountNumber(foreignAccountNumber)
    : null;
  const [branch, setBranch] = useState(existing?.branch ?? '');
  const [bankCode, setBankCode] = useState(existing?.bankCode ?? '');
  /*
   * What this account HOLDS.
   *
   * Seeded from the home currency for a NEW account, because that is what
   * nearly every one is — and from the stored value when editing, falling back
   * the same way so a row created before this column existed opens showing the
   * currency it actually means rather than a blank.
   */
  const [currency, setCurrency] = useState(
    (existing?.currency ?? homeCurrency).toUpperCase(),
  );
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
  /*
   * How many board lines this account funds — directly, or through a category
   * whose account it is.
   *
   * `resolveCardId` is the same resolution the board uses, so this counts
   * exactly the lines that would have their funding figure restated if the
   * currency changed. Income is excluded: it lands IN an account rather than
   * being funded out to one, so a salary line is not affected by this at all.
   */
  const fundedLineCount = editId
    ? state.subcategories.filter((sub) => {
        if (sub.type === 'income') return false;
        const category = state.categories.find((c) => c.id === sub.categoryId);
        return resolveCardId(sub.cardId, category?.cardId ?? null) === editId;
      }).length
    : 0;

  // Only worth warning about when the account is actually leaving the home
  // currency AND has something to restate.
  const foreignWithBills =
    currency !== homeCurrency.toUpperCase() && fundedLineCount > 0;

  /*
   * Where the bills could go — other accounts in the home currency.
   *
   * Foreign ones are excluded because moving bills from one foreign account to
   * another solves nothing: the figure would still be restated, just into a
   * different currency. This account itself is excluded for the obvious reason.
   */
  const homeAccounts = state.cards.filter(
    (card) =>
      card.id !== editId &&
      accountCurrency(card, homeCurrency) === homeCurrency.toUpperCase(),
  );
  const [movingFunding, setMovingFunding] = useState(false);

  const canSave = Boolean(brand);

  function handleSave() {
    if (!brand) return;

    /*
     * Reveal validation and stop, rather than saving a number that can never
     * match.
     *
     * The button stays ENABLED while a number is invalid: a disabled button
     * with no stated reason reads as the app being broken, and the reason is
     * exactly what pressing it now surfaces.
     */
    if (accountNumberError || foreignAccountNumberError) {
      setShowErrors(true);
      return;
    }
    /*
     * Last-4 is what matches an incoming SMS to this entry.
     *
     * The VISIBLE number wins, and the stored value is only a fallback. It used
     * to be the other way round — the stored `last4` was preferred so that
     * switching Account <-> Card, which clears the other type's number field,
     * could not silently blank the digits and break matching.
     *
     * That protected the wrong case. Editing an account number is a deliberate
     * act and must take effect: observed on the user's own device, changing a
     * DFCC number from ...7427 to ...5584 kept the stale 7427, so the new
     * number matched nothing and every message from that account went
     * unrecognised — with nothing on screen to say why.
     *
     * The Account<->Card concern is still handled, by falling back to the
     * stored value only when the visible field is EMPTY, which is exactly the
     * state a type switch produces.
     */
    const visibleNumber = isCard ? cardNumber : accountNumber;
    const derivedLast4 =
      visibleNumber.replace(/\D/g, '').slice(-4) ||
      last4.replace(/\D/g, '').slice(-4) ||
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
      /*
       * The second leg, stored only when the user actually declared one.
       *
       * `foreignLast4` falls back to the PRIMARY number's tail: a bank that
       * holds both currencies behind one account leaves the second number
       * blank, and the foreign leg is then reachable at the same digits — which
       * is exactly what SMS matching needs to recognise it.
       */
      foreignAccountNumber:
        !isCard && showForeignAccount ? foreignAccountNumber.trim() || null : null,
      foreignCurrency: !isCard && showForeignAccount ? foreignCurrency : null,
      foreignLast4:
        !isCard && showForeignAccount
          ? (foreignAccountNumber.replace(/\D/g, '').slice(-4) ||
              accountNumber.replace(/\D/g, '').slice(-4)) || null
          : null,
      branch: !isCard ? branch.trim() || null : null,
      bankCode: !isCard ? bankCode.trim() || null : null,
      /*
       * Stored as null when it matches the home currency.
       *
       * Keeps the common case indistinguishable from every row that predates
       * the column, so "no currency named" has exactly one meaning in the data
       * rather than two that must agree.
       */
      currency: currency && currency !== homeCurrency.toUpperCase() ? currency : null,
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
    /*
      A fragment, because the move-bills picker is a SIBLING of the form sheet,
      not a child of it.

      Nested among the form's children it never appeared. It also cannot use
      `asRoute` — that renders the chrome BARE, with no positioning of its own,
      which is right only for an expo-router modal screen that is already the
      native sheet. As a sibling `<Modal>` it presents over the form correctly.
    */
    <>
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
              {/*
                Currency BESIDE its account number, and a second pair for a
                relationship that holds two.

                A foreign-currency account splits two ways at Sri Lankan banks:
                some put both currencies behind one number, some issue a number
                per currency. Pairing the two fields covers both — one pair for
                the ordinary account, and an optional second for the other
                currency, which the user adds only when their bank works that
                way.

                The second number exists for MATCHING, not funding: bills still
                point at one card and fund in the home currency. What it buys is
                recognising a bank message about the foreign leg, which is what
                lets a USD-to-LKR conversion between the user's own two numbers
                be identified as an internal move rather than counted as a spend.
              */}
              {/*
                ONE block for the account numbers, not two stacked sections.

                They were separate `View`s with their own labels, so the second
                pair read as an unrelated section rather than as the same
                account's other currency — and with no separation between them
                the labels sat as close to the row above as to their own field.
                Grouping them under a single heading, with the rows evenly
                spaced inside, makes the pairing structural rather than implied.
              */}
              <View style={{ gap: space.sm }}>
                <Label>ACCOUNT NUMBER</Label>

                {/* `align="center"` — the dropdown and the field are the same
                    height, so centring keeps them on one baseline regardless of
                    which grows first. `flex-end` tied them to the bottom edge,
                    which drifted whenever one had a helper line. */}
                <Row gap={space.sm} align="center">
                  <CurrencySelect
                    value={currency}
                    options={CURRENCY_OPTIONS(homeCurrency)}
                    onSelect={setCurrency}
                  />
                  <Field
                    label=""
                    value={accountNumber}
                    onChangeText={setAccountNumber}
                    placeholder="e.g. 100200300456"
                    keyboardType="numeric"
                    error={showErrors ? accountNumberError : null}
                    style={{ flex: 1 }}
                  />
                </Row>

                {/*
                  The number is valid but has never appeared in a message.

                  Amber, inset to the field, and never blocking: banks mask
                  account numbers to their own taste, so the tail on a statement
                  is often not the tail in the SMS. Getting this wrong fails
                  silently — the account simply never matches — which is exactly
                  why it is worth saying out loud here.
                */}
                {accountUnseen ? (
                  <Row gap={6} align="flex-start" style={{ marginLeft: 96 }}>
                    <Ionicons name="alert-circle-outline" size={14} color={colors.pending} />
                    <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                      No message from this account yet — check the digits your bank actually
                      shows in its texts.
                    </Text>
                  </Row>
                ) : null}

                {showForeignAccount ? (
                  <>
                    <Row gap={space.sm} align="center">
                      <CurrencySelect
                        value={foreignCurrency}
                        options={CURRENCY_OPTIONS(homeCurrency).filter((o) => o.key !== currency)}
                        onSelect={setForeignCurrency}
                      />
                      <Field
                        label=""
                        value={foreignAccountNumber}
                        onChangeText={setForeignAccountNumber}
                        placeholder="Same number, or a second one"
                        keyboardType="numeric"
                        error={showErrors ? foreignAccountNumberError : null}
                        style={{ flex: 1 }}
                      />
                    </Row>

                    {/*
                      Helper and Remove on one line, and INSET to where the
                      account number starts.

                      Remove used to sit against the form's right edge beside a
                      distant heading, so it read as an action on the whole
                      section rather than on the row above it. Aligned to the
                      field it removes, with the explanation on the same line,
                      the pair reads as a footnote to that row.
                    */}
                    <Row justify="space-between" align="flex-start" gap={space.sm} style={{ marginLeft: 96 }}>
                      <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                        Leave blank if both currencies share the number above.
                      </Text>
                      <Pressable
                        onPress={() => {
                          // Clearing the fields as well as hiding them: a number
                          // left behind an invisible row would keep matching SMS
                          // for an account the user believes they removed.
                          setShowForeignAccount(false);
                          setForeignAccountNumber('');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Remove second currency"
                        accessible
                        hitSlop={8}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexShrink: 0 })}
                      >
                        <Text variant="caption" color={colors.danger} style={{ fontWeight: '700' }}>
                          Remove
                        </Text>
                      </Pressable>
                    </Row>
                  </>
                ) : (
                  /* Inset to the account number's left edge, so the action
                     lines up with the column it adds a row to. */
                  <View style={{ marginLeft: 96 }}>
                    <Button
                      label="Add a second currency"
                      icon="add"
                      variant="ghost"
                      size="sm"
                      onPress={() => setShowForeignAccount(true)}
                    />
                  </View>
                )}
              </View>
              <Row gap={space.md}>
                <Field label="Branch" value={branch} onChangeText={setBranch} placeholder="e.g. Kelaniya" style={{ flex: 1 }} />
                <Field label="Bank code" value={bankCode} onChangeText={setBankCode} placeholder="e.g. 7010" style={{ flex: 1 }} />
              </Row>
            </>
          )}

          {/*
            A CARD's currency still needs its own control.

            The account branch above pairs currency with its number, which is
            the shape that matters for a bank account. A card has no account
            number to pair with, so it keeps a plain picker — and a
            foreign-currency card is as real as a foreign-currency account.
          */}
          {isCard ? (
            <View style={{ gap: space.sm }}>
              <Label>CURRENCY</Label>
              <CurrencySelect
                value={currency}
                options={CURRENCY_OPTIONS(homeCurrency)}
                onSelect={setCurrency}
              />
            </View>
          ) : null}

          {/*
            The trap this catches: switching an account that FUNDS BILLS.

            Bills are always planned in the home currency, so an account holding
            something else restates its funding total in its own money —
            LKR 158,347 of bills on a USD account correctly becomes "USD 490".
            Correct, and almost never what the person meant: the usual setup is
            a USD account that RECEIVES the salary beside a local account the
            bills are actually paid from, and they have just converted the
            wrong one of the two.

            A warning rather than a block, because the other reading is real —
            someone genuinely paying a dollar subscription from a dollar
            account wants exactly this. It states the count and the consequence
            and lets them decide, which is the only honest thing to do when
            both answers are legitimate.
          */}
          {foreignWithBills ? (
            <Row
              gap={space.sm}
              align="flex-start"
              style={{
                backgroundColor: `${colors.pending}14`,
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
              }}
            >
              <Ionicons name="alert-circle-outline" size={16} color={colors.pending} />
              <View style={{ flex: 1, gap: space.sm }}>
                <Text variant="caption" tone="secondary">
                  {fundedLineCount} {fundedLineCount === 1 ? 'bill is' : 'bills are'} funded from
                  this account. Their amounts stay in {homeCurrency} and will show here converted to{' '}
                  {currency}. If this account only receives your salary, move them to a{' '}
                  {homeCurrency} account.
                </Text>

                {/*
                  The fix, offered where the problem is stated.

                  Without this the advice is "go and repoint 25 bills by hand",
                  which is true and useless. Only shown when there is somewhere
                  to move them TO — with no other home-currency account the
                  suggestion would be a dead end, and the honest thing is to
                  say nothing rather than offer a button that cannot work.
                */}
                {homeAccounts.length > 0 && !movingFunding ? (
                  <Button
                    label={`Move ${fundedLineCount === 1 ? 'it' : 'them'} to another account`}
                    icon="swap-horizontal-outline"
                    variant="secondary"
                    size="sm"
                    onPress={() => setMovingFunding(true)}
                  />
                ) : null}

                {/*
                  The destination list expands IN PLACE, not in a second sheet.

                  This form is itself a native modal, and iOS will not present
                  another from inside one that is already up — a nested sheet
                  simply never appeared, and the button silently did nothing.
                  Expanding inline sidesteps the limitation entirely, and it is
                  the better interaction anyway: the choice stays next to the
                  warning that prompted it, and the answer is visible without
                  losing sight of the account being edited.
                */}
                {movingFunding ? (
                  <View style={{ gap: space.xs }}>
                    <Text variant="caption" tone="muted">
                      Move to — bills keep their amounts and categories; your salary stays here.
                    </Text>
                    {homeAccounts.map((card) => {
                      const label = accountLabel(card);
                      return (
                        <Pressable
                          key={card.id}
                          onPress={() => {
                            if (editId) state.moveAccountFunding(editId, card.id);
                            setMovingFunding(false);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Move to ${label.primary}`}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.6 : 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: space.sm,
                            backgroundColor: colors.surface,
                            borderRadius: radius.md,
                            borderWidth: 1,
                            borderColor: colors.hairline,
                            paddingHorizontal: space.md,
                            paddingVertical: space.sm,
                          })}
                        >
                          <BankLogo
                            brand={resolveBrand({ bankId: card.bankId, bankName: card.bankName })}
                            size={26}
                          />
                          <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
                            {label.primary}
                          </Text>
                          <Ionicons name="arrow-forward" size={14} color={colors.accent} />
                        </Pressable>
                      );
                    })}
                    <Button
                      label="Cancel"
                      variant="ghost"
                      size="sm"
                      onPress={() => setMovingFunding(false)}
                    />
                  </View>
                ) : null}
              </View>
            </Row>
          ) : null}
    </BottomSheet>
    </>
  );
}

/**
 * A compact currency picker, sized to sit beside an account number.
 *
 * A pill row cannot do this job here. Five codes need the full width of the
 * form, and squeezed into the space an account number leaves they render as
 * clipped circles with no readable label — worse than no control at all. The
 * currency also belongs WITH its number ("this number holds LKR"), which is a
 * pairing a full-width row above the field cannot express.
 *
 * Opens as a POPOVER anchored under the field, not a sheet. Five three-letter
 * codes do not justify a modal that covers the form, animates in, and has to be
 * dismissed — the choice is small enough that it should feel like the field
 * expanding rather than like leaving the screen.
 */
function CurrencySelect({
  value,
  options,
  onSelect,
}: {
  value: string;
  options: { key: string; label: string }[];
  onSelect: (key: string) => void;
}) {
  const { colors, radius, space, shadow } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    /*
      `zIndex` on the wrapper, so the open list paints over the fields BELOW it.

      Without it the popover is drawn in tree order and the branch/bank-code
      row sits on top of the options — the list appears to be cut off halfway.
    */
    <View style={{ zIndex: open ? 10 : 0 }}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={`Currency, ${value}. Tap to change.`}
        accessible
        style={({ pressed }) => ({
          opacity: pressed ? 0.7 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          // Fixed width so the account number beside it starts at the same x on
          // every row, which is what makes two stacked pairs read as a column.
          width: 88,
          paddingHorizontal: space.sm,
          paddingVertical: 13,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: open ? colors.accent : colors.hairline,
          backgroundColor: colors.surface,
        })}
      >
        <Text variant="body" style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
          {value}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.inkMuted} />
      </Pressable>

      {open ? (
        /*
          `position: absolute` so the list floats over the form rather than
          pushing every field below it down and back up again — a layout jump
          on open is exactly what makes a picker feel heavier than it is.
        */
        <View
          style={[
            {
              position: 'absolute',
              top: 52,
              left: 0,
              width: 88,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              backgroundColor: colors.surface,
              overflow: 'hidden',
            },
            shadow.lifted,
          ]}
        >
          {options.map((option, index) => {
            const active = option.key === value;
            return (
              <React.Fragment key={option.key}>
                {index > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => {
                    onSelect(option.key);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessible
                  style={({ pressed }) => ({
                    paddingHorizontal: space.sm,
                    paddingVertical: 11,
                    backgroundColor: pressed
                      ? colors.surfaceSunken
                      : active
                        ? colors.accentSoft
                        : 'transparent',
                  })}
                >
                  <Text
                    variant="body"
                    color={active ? colors.accent : colors.ink}
                    style={{ fontWeight: active ? '700' : '500' }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>
      ) : null}
    </View>
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
