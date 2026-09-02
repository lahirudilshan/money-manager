import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { BottomSheet, Button, DetailRow, Divider, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import { formatMoney } from '~/shared/lib/money';
import { effectiveAmount, resolveCardId } from '~/features/budget/logic/planning';
import { accountLabel } from '~/shared/data/banks';
import { useBrand } from '~/shared/hooks/useBrand';
import { selectCardViews, selectCategoryViews, useAppStore } from '../../src/store/useAppStore';
import {
  accountCurrency,
  isForeignAccount,
} from '~/features/accounts/logic/accountCurrency';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Full-screen account detail — opened from the dashboard's "money to move" list
 * and the Accounts screen. Shows the account's identity, its balance and
 * commitment, its stored details (number, branch, code), and the categories
 * that draw from it. Cards route here too but show number/CVV/expiry instead.
 */
export default function AccountDetailScreen() {
  const { colors, space } = useTheme();
  const closeModal = useModalClose();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const state = useAppStore();
  const homeCurrency = state.currency;

  const view = useMemo(
    () => selectCardViews(state).find((v) => v.card.id === id),
    [state, id],
  );
  const [revealed, setRevealed] = useState(false);

  if (!view) {
    return (
      <BottomSheet
        visible
      asRoute
        onClose={closeModal}
        title="Account"
        icon="card-outline"
        iconColor={colors.accent}
      >
        <Text variant="small" tone="muted">
          This account no longer exists.
        </Text>
      </BottomSheet>
    );
  }

  const { card } = view;
  const label = accountLabel(card);
  const brand = useBrand({ bankId: card.bankId, bankName: card.bankName });
  // Categories funded from this account, each with its bills and their
  // effective (actual-or-planned) amounts — so the detail shows *where the
  // money goes*, not just a list of names.
  const fundedCategories = useMemo(() => {
    /*
     * Resolved per LEAF, matching `selectAccountTransfers`.
     *
     * Filtering on `category.cardId` alone was wrong in both directions,
     * because a bill can override the account its category names:
     *
     *   - it MISSED an account funded only by overrides. A category sitting on
     *     one account with its grocery bills pointed at another showed that
     *     second account as funding nothing at all — the section was empty
     *     while the dashboard was asking for real money to be moved there.
     *   - it INVENTED categories for the account named at category level even
     *     when every line inside had been pointed somewhere else.
     *
     * So each category is filtered down to the lines that actually resolve here
     * and dropped when none do, and the header total is the sum of those lines
     * rather than the category's whole summary — which would otherwise report
     * money that belongs to a different account.
     */
    return selectCategoryViews(state)
      .map((cv) => {
        const lines = cv.subcategories.filter((s) => {
          const raw = cv.rawSubcategories.find((r) => r.id === s.id);
          return resolveCardId(raw?.cardId, cv.category.cardId) === card.id;
        });

        return {
          id: cv.category.id,
          name: cv.category.name,
          color: cv.category.color,
          icon: cv.category.icon,
          totalMinor: lines.reduce((sum, s) => sum + effectiveAmount(s), 0),
          lines: lines.map((s) => ({
            id: s.id,
            name: s.name,
            amountMinor: effectiveAmount(s),
            /*
             * Whether the figure shown is REAL money rather than a plan.
             *
             * `!= null` alone is true for every ongoing line: a spending budget
             * reports its entry total, which is a real `0` before the month's
             * first receipt rather than the `null` a dated bill reports. So an
             * untouched grocery budget was tinted as though it had already been
             * spent. Requiring a non-zero figure makes the tint mean what it
             * looks like it means on both cadences.
             */
            isActual: (s.actualMinor ?? 0) > 0,
          })),
        };
      })
      .filter((cat) => cat.lines.length > 0);
  }, [state, card.id]);

  /**
   * Every stored field, whether or not it holds anything.
   *
   * The blanks are shown on purpose: an account is only useful to the app once
   * these are filled — the last four digits are what let a bank SMS match this
   * account at all — so a visible "Not set" is a prompt to go and add it. Hiding
   * empty rows made a half-configured account look complete.
   *
   * Empty reads as "Not set" rather than an em-dash, which is ambiguous between
   * "nothing here" and "not applicable".
   */
  const details = React.useMemo(() => {
    const rows: {
      label: string;
      value: string;
      empty: boolean;
      action?: { icon: 'eye-outline' | 'eye-off-outline'; onPress: () => void };
    }[] = [];

    /** One row, with the blank state handled in a single place. */
    const add = (
      label: string,
      value: string | null | undefined,
      action?: { icon: 'eye-outline' | 'eye-off-outline'; onPress: () => void },
    ) => {
      const filled = Boolean(value);
      rows.push({ label, value: filled ? value! : 'Not set', empty: !filled, action });
    };

    if (card.isCard) {
      add(
        'Card number',
        card.cardNumber
          ? revealed
            ? card.cardNumber
            : `•••• •••• •••• ${card.cardNumber.slice(-4)}`
          : null,
        card.cardNumber
          ? {
              icon: revealed ? 'eye-off-outline' : 'eye-outline',
              onPress: () => setRevealed((v) => !v),
            }
          : undefined,
      );
      add('Expiry', card.expiry);
      add('CVV', card.cvv ? (revealed ? card.cvv : '•••') : null);
    } else {
      add('Account number', card.accountNumber);
      add('Bank', card.bankName ?? brand.name);
      add('Branch', card.branch);
      add('Bank code', card.bankCode);
    }

    /*
     * Shown only when it is NOT the home currency.
     *
     * Every account was in the home currency before this column existed, and
     * for almost everyone still is — a "Currency: LKR" row on all of them is
     * noise that says nothing. It appears precisely when it carries
     * information: this account holds something different.
     */
    if (isForeignAccount(card, homeCurrency)) {
      add('Currency', accountCurrency(card, homeCurrency));
    }

    // The digits bank SMS quote — the field that makes auto-detection match
    // this account, so its absence is worth surfacing rather than hiding.
    add('Last 4 digits', card.last4 ? `••${card.last4}` : null);

    return rows;
  }, [card, brand.name, revealed]);

  function confirmDelete() {
    Alert.alert(`Delete ${label.primary}?`, 'Categories pointing at it will need a new account.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteCard(card.id);
          closeModal();
        },
      },
    ]);
  }

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title={label.primary}
      eyebrow={card.isCard ? 'Card' : 'Account'}
      /*
        The BANK'S mark, not a wallet glyph.

        This sheet is one specific account at one specific bank, and its header
        showed the same outline icon every account gets, tinted with the brand
        colour. Colour alone is a poor identifier here — half this catalog is a
        near-identical navy — while the logo is what the user recognises the
        account by everywhere else in the app, the Accounts list included.

        `icon` takes a node for exactly this case, and doing so opts out of the
        white tint the glyph path applies, which a multicolour logo needs.
      */
      /*
       * The mark FILLS the header tile — 40px, matching the tile's own size.
       *
       * At 30px it floated inside a 40px tile painted `iconColor`, so five
       * points of the bank's colour showed on every side and read as a thick
       * coloured ring around the logo rather than as the tile it actually is.
       * A white 40px chip covers the tile exactly, leaving the logo framed by
       * its own hairline the way it is everywhere else in the app.
       */
      icon={
        <BankLogo
          brand={brand}
          size={40}
          /*
           * A 1px hairline around the mark, since the logo now sits on white
           * with nothing behind it: a wordmark with white corners (most are)
           * would otherwise dissolve into the header. `BankSelectTile` frames
           * its chip the same way, with the same colour.
           */
          style={{ borderWidth: 1, borderColor: 'rgba(16,24,40,0.08)' }}
        />
      }
      iconColor={brand.color}
      scroll
      footer={
        <GradientButton
          label="Edit details"
          icon="create-outline"
          onPress={() => {
            closeModal();
            router.push(`/(tabs)/cards?edit=${card.id}`);
          }}
        />
      }
    >
        {/* Stored details — every field, with the unset ones marked. */}
        <View style={{ gap: space.sm }}>
          <Label>{card.isCard ? 'CARD DETAILS' : 'ACCOUNT DETAILS'}</Label>
          <Surface padded={false}>
            {details.map((row, index) => (
              <View key={row.label}>
                {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                <DetailRow
                  label={row.label}
                  value={row.value}
                  action={row.action}
                  muted={row.empty}
                />
              </View>
            ))}
          </Surface>
        </View>

        {/* What draws from this account — each category with its bills and the
            amount each will cost (actual when logged, else planned). */}
        {!card.isCard ? (
          <View style={{ gap: space.sm }}>
            <Label>WHAT THIS FUNDS</Label>
            {fundedCategories.length > 0 ? (
              fundedCategories.map((cat) => (
                <Surface key={cat.id} padded={false} style={{ overflow: 'hidden' }}>
                  <Row
                    justify="space-between"
                    style={{
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                      backgroundColor: `${cat.color}12`,
                    }}
                  >
                    <Row gap={space.sm}>
                      <Ionicons name={(cat.icon as never) ?? 'albums-outline'} size={16} color={cat.color} />
                      <Text variant="bodyStrong">{cat.name}</Text>
                    </Row>
                    <Text variant="figure" color={cat.color}>
                      {formatMoney(cat.totalMinor, { compact: true })}
                    </Text>
                  </Row>
                  {cat.lines.map((line, i) => (
                    <View key={line.id}>
                      {i === 0 ? null : <Divider style={{ marginHorizontal: space.lg }} />}
                      <Row
                        justify="space-between"
                        style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }}
                      >
                        <Text variant="small" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                          {line.name}
                        </Text>
                        <Text variant="small" color={line.isActual ? colors.accent : colors.ink}>
                          {formatMoney(line.amountMinor, { compact: true })}
                          {line.isActual ? '' : ''}
                        </Text>
                      </Row>
                    </View>
                  ))}
                </Surface>
              ))
            ) : (
              <Surface>
                <Text variant="caption" tone="muted">
                  No categories draw from this account yet.
                </Text>
              </Surface>
            )}
          </View>
        ) : null}

        <Button label="Delete" icon="trash-outline" variant="danger" onPress={confirmDelete} />
    </BottomSheet>
  );
}

