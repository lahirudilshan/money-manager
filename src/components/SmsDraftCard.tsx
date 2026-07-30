import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { shortWhen } from '../core/dates';
import { formatMoney } from '../core/money';
import { HINT_META } from '../core/smsCategoryHints';
import { accountLabelFor, cardForAccount, type SmsDraft } from '../core/smsReconcile';
import type { Card } from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './ui';

/**
 * One parsed-from-SMS draft, as a compact card built around three tiers.
 *
 * These arrive in a stack, so the card is organised by what a reviewer needs
 * rather than by what the message contains:
 *
 *   1. What and how much — merchant and amount, one line, the heaviest weight.
 *   2. What it maps to — the suggestion band, full width, immediately above the
 *      buttons that accept or replace it. This is the card's question.
 *   3. Where it came from — account and date/time, the quietest line, there to
 *      be confirmed at a glance rather than decided on. When the SMS's digits
 *      match one of the user's accounts it is named, which is the strongest
 *      available evidence that the draft is really theirs.
 *
 * Both the body tap and the left button open the detail modal
 * (app/sms/[id].tsx); keeping all editing there is what lets the card stay this
 * small.
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
  /** Open the detail modal — fired by tapping the body or the left action. */
  onOpen: () => void;
  /** Log the draft against its current mapping. */
  onConfirm: () => void;
}) {
  const { colors, radius, space } = useTheme();

  const { parsed, hint } = draft;
  const hintMeta = hint ? HINT_META[hint] : null;
  const isCredit = parsed.direction === 'credit';
  const isMatched = draft.subcategoryId !== '' || Boolean(matchedBillName);
  // A learned rule fired on this exact merchant — the user has confirmed this
  // mapping before, so committing is genuinely a one-tap confirmation.
  const isExact = draft.confidence === 'exact';

  const kindLabel = {
    purchase: 'Purchase',
    atm: 'ATM cash',
    transfer_out: 'Transfer out',
    transfer_in: 'Transfer in',
    loan_payment: 'Loan payment',
    utility: 'Bill due',
    other: isCredit ? 'Money in' : 'Paid out',
  }[parsed.kind];

  // A recognised account is named in full ("HNB Salary ••4150"); an unrecognised
  // one keeps the bare digits. `matchedCard` is kept alongside the label so the
  // row can style the two cases differently.
  const matchedCard = cardForAccount(parsed.account, cards);
  const accountLabel = accountLabelFor(parsed.account, cards);

  // Date and time read as one fact, space-joined so they are not split by a dot
  // as though unrelated. The year is dropped for anything in the current year —
  // "22 Jul 8:54 PM" rather than "22 Jul 2026 8:54 PM" — since these are reviewed
  // within days of arriving and the year is what pushed the time off the line.
  const whenLabel = shortWhen(parsed.date, parsed.time);

  const figure = `${isCredit ? '+' : ''}${formatMoney(draft.amountMinor, { showDecimals: true })}`;

  // Two things are deliberately off the provenance line: the detected category,
  // which is the suggestion being proposed and so belongs in the highlighted
  // band; and the kind ("Purchase"), which for a recognised merchant only repeats
  // what the icon and the merchant name already say. Kind survives as the
  // merchant fallback below, where it is the only name we have.

  return (
    /* A plain hairline: the gradient edge belongs to the section that groups
       these rows, not to each row inside it. */
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}
    >
      {/* Tap the body to open the detail modal — the same destination as the
          left action, so the whole card is a safe, non-committing target. */}
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${kindLabel}, ${parsed.merchant || 'transaction'}, ${figure}${accountLabel ? `, ${accountLabel}` : ''}. Tap for details.`}
        style={({ pressed }) => ({
          paddingHorizontal: space.md,
          paddingTop: space.md,
          paddingBottom: space.sm,
          gap: space.sm,
          backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        })}
      >
        {/* Icon column, then a two-line text block. The icon spans both lines so
            the text left-aligns as one unit rather than stepping in and out. */}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isCredit ? colors.completedSoft : colors.accentSoft,
            }}
          >
            <Ionicons
              name={(hintMeta?.icon ?? 'chatbox-ellipses-outline') as never}
              size={17}
              color={isCredit ? colors.completed : colors.accent}
            />
          </View>

          <View style={{ flex: 1, gap: 3 }}>
            {/* The merchant gets the whole line — the amount lives in the
                suggestion band below, paired with the category. */}
            <T variant="bodyStrong" numberOfLines={1}>
              {parsed.merchant || kindLabel}
            </T>

            {/* Provenance. Deliberately the quietest line on the card: facts to
                confirm at a glance, not decisions. The account shrinks first
                because a matched one carries bank, name and digits; the date and
                time hold their width and stay complete. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {accountLabel ? (
                <>
                  <Ionicons
                    name={matchedCard ? 'card' : 'card-outline'}
                    size={11}
                    color={matchedCard ? colors.inkSecondary : colors.inkMuted}
                  />
                  {/* A recognised account reads a step stronger than an unknown
                      one: it is evidence the draft belongs to the user. */}
                  <T
                    variant="caption"
                    tone={matchedCard ? 'secondary' : 'muted'}
                    numberOfLines={1}
                    style={{ flexShrink: 1, fontWeight: matchedCard ? '600' : '500' }}
                  >
                    {accountLabel}
                  </T>
                </>
              ) : null}
              {accountLabel && whenLabel ? (
                <T variant="caption" color={colors.inkFaint}>
                  ·
                </T>
              ) : null}
              {whenLabel ? (
                <T variant="caption" tone="muted" numberOfLines={1}>
                  {whenLabel}
                </T>
              ) : null}
            </View>
          </View>
        </View>

        {/* The card's actual question — category on the left, amount on the
            right — full width and directly above the buttons that answer it, so
            proposal and response read as one block. */}
        <MatchChip
          billName={matchedBillName}
          hintLabel={hintMeta?.label}
          isExact={isExact}
          needsBill={!isMatched}
          figure={figure}
          figureColor={isCredit ? colors.completed : colors.ink}
        />
      </Pressable>

      {/* Two actions, fixed positions: remap on the left, commit on the right. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingBottom: space.md,
        }}
      >
        {/* Opens the same picker in both states — the label just names what the
            user is likely correcting: a wrong guess, or nothing chosen yet. */}
        <CardAction
          label="Wrong category"
          icon="swap-horizontal-outline"
          variant="secondary"
          onPress={onOpen}
        />
        {/* `confirmDraft` needs a subcategory, so an uncategorised draft opens
            the picker instead of committing — the arrow marks that this one
            leads somewhere rather than finishing the job. */}
        <CardAction
          label="Yes, log this"
          accessibilityLabel={isMatched ? 'Yes, log this' : 'Choose a bill, then log this'}
          icon={isMatched ? 'checkmark' : 'arrow-forward'}
          variant="primary"
          onPress={isMatched ? onConfirm : onOpen}
        />
      </View>
    </View>
  );
}

/**
 * The card's question, as one highlighted band: what this maps to, and for how
 * much.
 *
 * Whatever we worked out goes on the left in full strength — a confirmed bill, a
 * suggested bill, or (when no bill matched) the category the message text points
 * at, which is still a useful head start on the picker. The amount sits opposite
 * it, so the two facts the user weighs against each other share a line.
 */
function MatchChip({
  billName,
  hintLabel,
  isExact,
  needsBill,
  figure,
  figureColor,
}: {
  billName?: string;
  /** Category detected from the SMS text, shown when no bill matched. */
  hintLabel?: string;
  isExact: boolean;
  needsBill: boolean;
  /** Pre-formatted amount, shown at the band's right edge. */
  figure: string;
  /**
   * Ink (or the credit green) rather than the band's own state colour — the
   * amount is a fact about the transaction, so it must not appear to change with
   * how confident the match is.
   */
  figureColor: string;
}) {
  const { colors, radius, space } = useTheme();

  // `prefix` frames what the name is (a guess vs. a settled mapping) so the
  // highlighted word is never ambiguous on its own.
  //
  // Colour tracks how settled the mapping is: amber for a draft still needing a
  // category, blue for a guess worth checking, green once it is confirmed. The
  // amber shares the `pending` role with overdue bills — both are "not finished
  // yet", and the three-step progression reads at a glance down a stack.
  const { icon, fg, bg, prefix, label } = needsBill
    ? {
        icon: 'help-circle' as const,
        fg: colors.pending,
        bg: colors.pendingSoft,
        // The detected category is a real suggestion even without a bill, so it
        // leads; only a wholly unrecognised message falls back to the prompt.
        prefix: hintLabel ? 'Looks like' : 'Needs',
        label: hintLabel ?? 'a category',
      }
    : isExact
      ? {
          icon: 'checkmark-circle' as const,
          fg: colors.completed,
          bg: colors.completedSoft,
          prefix: 'Goes to',
          label: billName ?? 'a matched bill',
        }
      : {
          icon: 'sparkles' as const,
          fg: colors.accent,
          bg: colors.accentSoft,
          prefix: 'Maybe',
          label: billName ?? 'a suggestion',
        };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: space.sm,
        paddingVertical: 7,
        borderRadius: radius.sm,
        backgroundColor: bg,
      }}
    >
      <Ionicons name={icon} size={15} color={fg} />
      {/* The prefix is the quiet half; the name it points at carries the weight,
          since that is the word the user is being asked to accept or replace.
          Both sit in a flex group so a long bill name truncates rather than
          pushing the amount off the band's right edge.

          Sized one step above the provenance line and one below the amount: this
          is the decision the card is asking for, so it should not read as small
          print, but it must not out-shout the figure either. */}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <T variant="small" color={fg} style={{ opacity: 0.8 }}>
          {prefix}
        </T>
        <T variant="small" color={fg} numberOfLines={1} style={{ flexShrink: 1, fontWeight: '800' }}>
          {label}
        </T>
      </View>

      {/* The amount is the one thing in the band that is not a suggestion, so it
          carries the heaviest weight here — against a tinted ground the default
          figure weight read as washed out next to the bold category name. */}
      <T variant="figureLarge" color={figureColor} style={{ fontSize: 16 }}>
        {figure}
      </T>
    </View>
  );
}

/**
 * One of the card's two footer actions. Both are outlined — a stack of drafts
 * would otherwise carry a column of filled blue blocks, which shouts far louder
 * than a review queue should. The primary is marked by accent border and text
 * against the secondary's neutral grey, which keeps the hierarchy without the
 * fill.
 */
function CardAction({
  label,
  accessibilityLabel,
  icon,
  variant,
  onPress,
}: {
  label: string;
  /**
   * Spoken label, when the visible one would mislead. An uncategorised draft's
   * primary button reads "Yes, log this" but actually opens the picker, so the
   * screen reader is told what the tap really does.
   */
  accessibilityLabel?: string;
  icon: keyof typeof Ionicons.glyphMap;
  variant: 'primary' | 'secondary';
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const isPrimary = variant === 'primary';

  const body = (fg: string) => (
    <>
      <Ionicons name={icon} size={14} color={fg} />
      <T variant="caption" color={fg} numberOfLines={1} style={{ fontWeight: '700' }}>
        {label}
      </T>
    </>
  );

  const layout = {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 5,
    // 36 stays inside the 44pt touch target because the card's own padding and
    // the body Pressable above it absorb the slop.
    height: 36,
    paddingHorizontal: space.sm,
  };

  /*
   * The confirming action is filled with the Smart Detect gradient — the same
   * pair as the badge and the card's own edge — so the button that completes a
   * detection is visibly part of that feature rather than generic chrome.
   *
   * Filled rather than outlined: it is the only action here that writes
   * anything, and beside an outlined "Wrong category" the fill is what says
   * which one finishes the job.
   */
  if (isPrimary) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        style={({ pressed }) => ({
          flex: 1,
          borderRadius: radius.sm,
          overflow: 'hidden',
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={layout}
        >
          {body('#FFFFFF')}
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        ...layout,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        // Only the pressed state fills, so the tap still lands visibly.
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      {body(colors.inkSecondary)}
    </Pressable>
  );
}
