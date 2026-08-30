import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import {
  assignRemainder,
  emptyPart,
  parsePartAmount,
  ordinal,
  splitEvenly,
  validateSplit,
  withAmount,
  type SplitPart,
} from '~/features/budget/logic/splits';
import { AmountField } from '~/shared/components/forms';
import { Divider, Label, Row, Text } from '~/shared/components/ui';
import { formatMoney } from '~/shared/lib/money';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** A budget line a part can be assigned to, flattened with its category. */
export interface SplitDestination {
  id: string;
  name: string;
  categoryName: string;
  categoryColor: string;
  icon?: string | null;
}

/**
 * Divide one payment across several budget lines.
 *
 * ## The problem
 *
 * A 5,000 shop at Keells arrives as one debit and one SMS, and the app
 * confidently files all 5,000 under Groceries. That is right about the shop and
 * wrong about the money: 2,000 of it was pet food, and every month the pet
 * budget silently reads as unspent while groceries reads as overspent. The
 * transaction is not wrong — the *allocation* is.
 *
 * ## The design
 *
 * The editor is a running subtraction, not a form. The payment total sits at
 * the top and a REMAINDER counts down beside it as parts are filled in, so at
 * every moment the user can see what is still unaccounted for without doing
 * arithmetic. That remainder is also the save condition: it must reach exactly
 * zero, because money left unallocated is money that leaves the account and
 * appears in no line's total.
 *
 * Two shortcuts do the arithmetic for the two shapes a split actually takes:
 *
 *   "Split evenly"  — a shared bill, a dinner, a joint purchase.
 *   "Use remainder" — the far more common one: the user knows the odd part
 *                     ("2,000 of this was pet food") and wants the rest to fall
 *                     out. Typing one number and tapping once beats subtracting
 *                     in your head and typing the answer.
 *
 * ## Why not just make two transactions
 *
 * Because then nothing in the app corresponds to the payment the bank actually
 * took, and a receipt, a refund or a correction has nothing to attach to. The
 * parent transaction stays whole and authoritative; only its allocation is
 * divided. See `transactionSplits` in the schema.
 */
export function SplitEditor({
  totalMinor,
  parts,
  onChange,
  destinations,
  onPickLine,
  currency,
}: {
  /** The whole payment. The parts must add up to exactly this. */
  totalMinor: number;
  parts: SplitPart[];
  onChange: (next: SplitPart[]) => void;
  destinations: readonly SplitDestination[];
  /**
   * Open the host's line picker for one part.
   *
   * The picker is not owned here: the SMS screen and the entry form each
   * already have one — with their own search, their own "create a line" path
   * and their own idea of which lines are eligible — and a second one inside
   * this component would be a different control for the same job.
   */
  onPickLine: (partKey: string) => void;
  /** The user's currency — the amount fields format against it. */
  currency: string;
}) {
  const { colors, radius, space } = useTheme();

  const validation = useMemo(() => validateSplit(parts, totalMinor), [parts, totalMinor]);
  const { remainderMinor, allocatedMinor } = validation;

  const update = useCallback(
    (key: string, patch: Partial<SplitPart>) => {
      onChange(parts.map((part) => (part.key === key ? { ...part, ...patch } : part)));
    },
    [parts, onChange],
  );

  const addPart = useCallback(() => {
    onChange([...parts, emptyPart()]);
  }, [parts, onChange]);

  const removePart = useCallback(
    (key: string) => onChange(parts.filter((part) => part.key !== key)),
    [parts, onChange],
  );

  const destinationFor = useCallback(
    (id: string | null) => (id ? destinations.find((d) => d.id === id) : undefined),
    [destinations],
  );

  /** The remainder's colour and wording — over, short, or exactly settled. */
  const remainderTone =
    remainderMinor === 0
      ? { color: colors.completed, label: 'Fully allocated' }
      : remainderMinor > 0
        ? { color: colors.pending, label: 'Left to allocate' }
        : { color: colors.danger, label: 'Over the payment' };

  return (
    <View style={{ gap: space.md }}>
      {/*
        The running total. Two figures side by side — what the payment was, and
        what is still unaccounted for — so the user never has to hold a
        subtraction in their head while filling the rows in.
      */}
      <View
        style={{
          padding: space.md,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceSunken,
          gap: space.sm,
        }}
      >
        <Row justify="space-between">
          <Text variant="caption" tone="muted">
            PAYMENT
          </Text>
          <Text variant="bodyStrong">{formatMoney(totalMinor, { showDecimals: true })}</Text>
        </Row>
        <Divider />
        <Row justify="space-between">
          <Text variant="caption" style={{ color: remainderTone.color, fontWeight: '700' }}>
            {remainderTone.label.toUpperCase()}
          </Text>
          <Text variant="bodyStrong" color={remainderTone.color}>
            {formatMoney(Math.abs(remainderMinor), { showDecimals: true })}
          </Text>
        </Row>

        {/* A proportional bar of what has been allocated — the fastest read of
            "am I nearly done", and it turns red the moment the parts overshoot. */}
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.hairline,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.min(100, totalMinor > 0 ? (allocatedMinor / totalMinor) * 100 : 0)}%`,
              height: '100%',
              backgroundColor: remainderMinor < 0 ? colors.danger : colors.completed,
            }}
          />
        </View>
      </View>

      <Label>WHAT IT WAS FOR</Label>

      {parts.map((part, index) => {
        const destination = destinationFor(part.subcategoryId);

        return (
          <View
            key={part.key}
            style={{
              gap: space.sm,
              padding: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              backgroundColor: colors.surface,
            }}
          >
            <Row justify="space-between">
              {/* Counts the rows in plain words. "PART 1" is the code's name
                  for it; "1st category" is what the user is filling in. */}
              <Text variant="caption" tone="muted">
                {ordinal(index + 1)} CATEGORY
              </Text>
              {/* Two categories is the minimum for a split to mean anything, so
                  below that the remove control disappears rather than being
                  offered and refused. */}
              {parts.length > 2 ? (
                <Pressable
                  onPress={() => removePart(part.key)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove the ${ordinal(index + 1).toLowerCase()} category`}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
                </Pressable>
              ) : null}
            </Row>

            {/* Which line this part counts against. */}
            <Pressable
              onPress={() => onPickLine(part.key)}
              accessibilityRole="button"
              accessibilityLabel={
                destination
                  ? `${destination.name} in ${destination.categoryName}. Change line.`
                  : 'Choose a line for this part'
              }
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: destination ? `${destination.categoryColor}66` : colors.hairline,
                backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
              })}
            >
              <Ionicons
                name={(destination?.icon as never) ?? 'pricetag-outline'}
                size={18}
                color={destination?.categoryColor ?? colors.inkMuted}
              />
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1}>
                  {destination?.name ?? 'Choose a line'}
                </Text>
                {destination ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {destination.categoryName}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-down" size={16} color={colors.inkMuted} />
            </Pressable>

            {/*
              The TEXT is what is stored and shown; the number is derived.

              This used to render `(amountMinor / 100).toFixed(2)`, which made
              the field impossible to type in: entering "2" stored 2 minor units
              and re-rendered as "0.02", moving the caret and turning every
              following keystroke into nonsense — so "2000" could not be
              entered at all. Holding the raw text means the input is never
              fought, and `parsePartAmount` reads the value off it.
            */}
            {/*
              `hero={false}` — a plain bordered box with the currency inside it.

              The hero variant is a centred 42px display figure, right for the
              ONE amount on the entry screen and wrong for three stacked rows:
              the parts of a split are read against each other and against the
              remainder above them, so they want to look like ordinary fields,
              not three competing headlines.
            */}
            <AmountField
              label="Amount"
              hero={false}
              value={part.amountText}
              onChangeText={(text) =>
                update(part.key, { amountText: text, amountMinor: parsePartAmount(text) })
              }
              currency={currency}
              placeholder="0.00"
            />
          </View>
        );
      })}

      {/* The three ways to finish, in the order they are reached for. */}
      <Row gap={space.sm}>
        <SplitAction icon="add" label="Add part" onPress={addPart} />
        <SplitAction
          icon="git-branch-outline"
          label="Split evenly"
          onPress={() => {
            const amounts = splitEvenly(totalMinor, parts.length);
            onChange(parts.map((part, index) => ({ ...part, ...withAmount(amounts[index]) })));
          }}
        />
        <SplitAction
          icon="arrow-forward"
          label="Use remainder"
          // Inert when there is nothing left over, or no empty row to put it in.
          disabled={remainderMinor <= 0 || parts.every((part) => (part.amountMinor ?? 0) > 0)}
          onPress={() => onChange(assignRemainder(parts, totalMinor))}
        />
      </Row>

      {/* Says what is still missing, specifically. "Can't save" with no reason
          is the failure mode this replaces. */}
      {!validation.valid ? (
        <Text variant="caption" tone="muted">
          {remainderMinor > 0
            ? `${formatMoney(remainderMinor, { showDecimals: true })} still to allocate.`
            : remainderMinor < 0
              ? `The parts add up to ${formatMoney(Math.abs(remainderMinor), { showDecimals: true })} more than the payment.`
              : 'Give every part a line and an amount.'}
        </Text>
      ) : null}
    </View>
  );
}

function SplitAction({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingVertical: 10,
        paddingHorizontal: space.sm,
        borderRadius: radius.sm,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Ionicons name={icon} size={14} color={colors.accent} />
      <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
