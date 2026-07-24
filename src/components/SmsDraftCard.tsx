import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { formatMoney } from '../core/money';
import { HINT_META } from '../core/smsCategoryHints';
import { cardForAccount, type SmsDraft } from '../core/smsReconcile';
import type { Card } from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './ui';

/**
 * One parsed-from-SMS draft, as a clean, price-forward list row.
 *
 * The row does the reading: a category icon, the merchant, and — front and
 * centre — the amount. A status chip says whether a bill is already matched.
 * The row is not editable inline; tapping it (or "Not this") opens the detail
 * modal (app/sms/[id].tsx) where the user remaps, logs, or marks it already
 * logged. Keeping all editing in the modal is what lets a stack of rows stay
 * quiet and scannable.
 */
export function SmsDraftCard({
  draft,
  cards,
  matchedBillName,
  onOpen,
  onConfirm,
}: {
  draft: SmsDraft;
  /** All accounts, used to name which one the SMS's digits point at. */
  cards: readonly Card[];
  /** Name of the currently-matched bill, or undefined when none is chosen. */
  matchedBillName?: string;
  /** Open the detail modal — fired by tapping the row or "Not this". */
  onOpen: () => void;
  /** One-tap log of a confidently-matched draft, without opening the modal. */
  onConfirm: () => void;
}) {
  const { colors, radius, space } = useTheme();

  const { parsed, hint } = draft;
  const hintMeta = hint ? HINT_META[hint] : null;
  const isCredit = parsed.direction === 'credit';
  const isMatched = draft.subcategoryId !== '' || Boolean(matchedBillName);

  const kindLabel = {
    purchase: 'Purchase',
    atm: 'ATM cash',
    transfer_out: 'Transfer out',
    transfer_in: 'Transfer in',
    loan_payment: 'Loan payment',
    utility: 'Bill due',
    other: isCredit ? 'Money in' : 'Paid out',
  }[parsed.kind];

  const matchedCard = cardForAccount(parsed.account, cards);
  const accountLabel = matchedCard ? matchedCard.name : parsed.account ? `••${parsed.account}` : '';

  const subtitle = [hintMeta ? hintMeta.label : kindLabel, accountLabel, parsed.date]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}
    >
      {/* Tap anywhere on the row to open the detail modal. */}
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${kindLabel}, ${parsed.merchant || 'transaction'}, ${formatMoney(draft.amountMinor, { showDecimals: true })}. Tap for details.`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.md,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accentSoft,
          }}
        >
          <Ionicons
            name={(hintMeta?.icon ?? 'chatbox-ellipses-outline') as never}
            size={21}
            color={colors.accent}
          />
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <T variant="bodyStrong" numberOfLines={1}>
            {parsed.merchant || kindLabel}
          </T>
          <T variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </T>
          {/* Matched bill on its own line so the price column stays uncluttered. */}
          {matchedBillName ? (
            <Row inline gap={4}>
              <Ionicons name="arrow-forward" size={11} color={colors.completed} />
              <T variant="caption" color={colors.completed} numberOfLines={1} style={{ fontWeight: '600' }}>
                {matchedBillName}
              </T>
            </Row>
          ) : null}
        </View>

        {/* The price — the biggest, boldest thing in the row. */}
        <T variant="figureLarge" color={isCredit ? colors.completed : colors.ink}>
          {isCredit ? '+' : ''}
          {formatMoney(draft.amountMinor, { showDecimals: true })}
        </T>
      </Pressable>

      {/* Action bar under the row. */}
      <View
        style={{
          flexDirection: 'row',
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
        }}
      >
        <RowAction
          label="Not this"
          icon="swap-horizontal-outline"
          tone="muted"
          onPress={onOpen}
        />
        <View style={{ width: 1, backgroundColor: colors.hairline }} />
        {isMatched ? (
          <RowAction label="Log it" icon="checkmark" tone="success" onPress={onConfirm} />
        ) : (
          <RowAction label="Choose bill" icon="pricetags-outline" tone="accent" onPress={onOpen} />
        )}
      </View>
    </View>
  );
}

/** A flat, full-height action filling half the row's footer. */
function RowAction({
  label,
  icon,
  tone,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'muted' | 'success' | 'accent';
  onPress: () => void;
}) {
  const { colors, space } = useTheme();
  const color = {
    muted: colors.inkSecondary,
    success: colors.completed,
    accent: colors.accent,
  }[tone];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 11,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Ionicons name={icon} size={15} color={color} />
      <T variant="small" color={color} style={{ fontWeight: '700' }}>
        {label}
      </T>
    </Pressable>
  );
}

/** Tiny inline row helper (avoids importing the padded ui Row for one line). */
function Row({ children, gap, inline }: { children: React.ReactNode; gap: number; inline?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap, alignSelf: inline ? 'flex-start' : 'auto' }}>
      {children}
    </View>
  );
}
