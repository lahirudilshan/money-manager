import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Divider, Empty, GradientCard, Label, Row, Stat, Surface, Text } from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import {
  buddyTotals,
  daysSince,
  personColor,
  daysUntil,
  remainingMinor,
  urgencyOf,
  type BuddyLoanLike,
  type BuddyRepayment as RepaymentLike,
} from '~/features/buddyloans/logic/buddyLoans';
import { describeAge, describeDue, directionOwes, STATUS_LABEL } from '~/features/buddyloans/logic/format';
import { formatMoney } from '~/shared/lib/money';
import { useAppStore } from '~/store/useAppStore';
import { groupColors } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';
import type { BuddyLoan } from '~/db/schema';

type Filter = 'open' | 'settled' | 'all';

/**
 * The three views, without counts.
 *
 * Declared once outside the component so the array is not rebuilt on every
 * render — and so the labels sit together where they can be read as a set.
 */
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'settled', label: 'Closed' },
  { key: 'all', label: 'All' },
];

/**
 * The buddy-loan book: who owes what, and what has come back.
 *
 * Opens on OUTSTANDING rather than on everything. The question this add-on
 * answers is "who still owes me", and a list led by debts settled months ago
 * buries it — settled records are history, reachable in one tap but never the
 * first thing shown.
 */
export default function BuddyLoansHome() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const loans = useAppStore((s) => s.buddyLoans);
  const repayments = useAppStore((s) => s.buddyRepayments);

  const [filter, setFilter] = useState<Filter>('open');

  /** Repayments grouped once, so each row's balance is a map lookup. */
  const byLoan = useMemo(() => {
    const map = new Map<string, RepaymentLike[]>();
    for (const r of repayments) {
      const bucket = map.get(r.loanId) ?? [];
      bucket.push(r);
      map.set(r.loanId, bucket);
    }
    return map;
  }, [repayments]);

  const totals = useMemo(
    () => buddyTotals(loans as unknown as BuddyLoanLike[], byLoan),
    [loans, byLoan],
  );

  const today = new Date();

  const visible = useMemo(() => {
    const rows = loans.filter((loan) => {
      if (filter === 'all') return true;
      if (filter === 'open') return loan.status === 'outstanding';
      return loan.status !== 'outstanding';
    });

    /*
     * Outstanding debts sort by URGENCY, not by when they were lent.
     *
     * The list is a queue of who to chase, so the most overdue has to lead.
     * Records with no promised date sort last within that group — there is
     * nothing to chase them against, so they must never push a real deadline
     * down the screen.
     */
    return rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'outstanding' ? -1 : 1;

      if (a.status === 'outstanding') {
        if (a.dueOn && b.dueOn) return daysUntil(a.dueOn, today) - daysUntil(b.dueOn, today);
        if (a.dueOn) return -1;
        if (b.dueOn) return 1;
      }

      return b.lentOn.getTime() - a.lentOn.getTime();
    });
  }, [loans, filter, today]);

  return (
    <Screen
      title="Buddy loans"
      onBack={() => router.back()}
      action={{ icon: 'add', label: 'Add a loan', onPress: () => router.push('/mini/buddyloans/edit') }}
    >
      {/*
        What the book adds up to.

        Written-off money gets its own line so it never flatters the "came
        back" figure — see `buddyTotals`. The secondary stats appear only when
        they are non-zero: a row of "LKR 0" figures says nothing and makes the
        card harder to read than the one number that matters.
      */}
      {/*
        The summary card shows even with an empty book.

        It was hidden on the theory that "LKR 0" says nothing — but the card is
        what gives the screen its identity, and without it an empty Buddy loans
        looks like any other empty screen in the app. Zero is also a real
        answer to "what am I owed", and seeing it there makes the number's
        meaning obvious before the first loan is ever added.
      */}
      <GradientCard>
        <Label color="rgba(255,255,255,0.65)">PEOPLE OWE ME</Label>
        <Text variant="display" color="#FFFFFF">
          {formatMoney(totals.outstandingMinor)}
        </Text>

        {/*
          Money the user OWES gets its own line, with a rule above it.

          It is the one figure here that runs the other way, and sitting it in
          the row of secondary stats let it read as more money coming in.
        */}
        {totals.owedByMeMinor > 0 ? (
          <View
            style={{
              marginTop: space.md,
              paddingTop: space.md,
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.22)',
            }}
          >
            <Row style={{ justifyContent: 'space-between' }} align="center">
              <Label color="rgba(255,255,255,0.65)">I OWE OTHERS</Label>
              <Text variant="bodyStrong" color="#FFFFFF">
                {formatMoney(totals.owedByMeMinor)}
              </Text>
            </Row>
          </View>
        ) : null}

        {totals.repaidMinor > 0 || totals.writtenOffMinor > 0 ? (
          <Row gap={space.xl} style={{ marginTop: space.lg }}>
            {totals.repaidMinor > 0 ? (
              <Stat onDark label="PAID BACK" value={formatMoney(totals.repaidMinor, { compact: true })} />
            ) : null}
            {totals.writtenOffMinor > 0 ? (
              <Stat
                onDark
                label="WRITTEN OFF"
                value={formatMoney(totals.writtenOffMinor, { compact: true })}
              />
            ) : null}
          </Row>
        ) : null}
      </GradientCard>

      {/*
        The filter row.

        Plain words with no counts. A "(4)" beside "Open" duplicates a number
        the list underneath already states in full, and it dates the moment
        anything is settled — the label names the view, the list carries the
        detail.
      */}
      {loans.length > 0 ? (
        <Row gap={space.sm}>
          {FILTERS.map((option) => {
            const selected = filter === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => setFilter(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  paddingHorizontal: space.lg,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  backgroundColor: selected ? colors.accent : colors.surface,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.hairline,
                }}
              >
                <Text
                  variant="caption"
                  color={selected ? colors.inkInverse : colors.inkSecondary}
                  style={{ fontWeight: '700' }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      ) : null}

      {visible.length === 0 ? (
        <Empty
          icon="people-outline"
          /*
           * Short, and it does not repeat the card above it.
           *
           * The summary card already says what this screen counts, so the
           * empty state's job is only to say there is nothing here yet and
           * what to do about it. An earlier version explained the whole
           * feature in one long sentence — that belongs on the add-ons list,
           * where someone is deciding whether to turn it on, not here where
           * they already have.
           */
          title={loans.length === 0 ? 'Nobody owes you' : 'Nothing to show'}
          message={
            loans.length === 0
              ? 'Add a loan when you give money to a friend.'
              : filter === 'open'
                ? 'Every loan is paid back or written off.'
                : 'Nothing closed yet.'
          }
          actionLabel={loans.length === 0 ? 'Add a loan' : undefined}
          onAction={loans.length === 0 ? () => router.push('/mini/buddyloans/edit') : undefined}
        />
      ) : (
        <Surface padded={false}>
          {visible.map((loan, index) => (
            <React.Fragment key={loan.id}>
              {/*
                A full point of the ORDINARY hairline, edge to edge.

                Two independent things were making the old rule invisible: it
                was sub-pixel (`StyleSheet.hairlineWidth`) AND inset to the
                name, so it read as a stray mark rather than a line between two
                loans. Fixing the width and the inset is enough — going up to
                `hairlineStrong` as well then over-corrected, drawing a rule
                heavier than the card's own border for a boundary between two
                rows of the same list.

                Full width rather than inset because the avatar-aligned inset
                suits a list of uniform one-line rows. These vary in height and
                now carry a full-width progress bar of their own, which a short
                rule sat awkwardly against.
              */}
              {index > 0 ? (
                <Divider style={{ height: 1, backgroundColor: colors.hairline }} />
              ) : null}
              <LoanRow
                loan={loan}
                repayments={byLoan.get(loan.id) ?? []}
                today={today}
                onPress={() => router.push(`/mini/buddyloans/detail?id=${loan.id}`)}
              />
            </React.Fragment>
          ))}
        </Surface>
      )}
    </Screen>
  );
}

/**
 * One debt.
 *
 * Leads with the PERSON, because that is what the user is looking for — the
 * amount answers "how much" only once you have found the right row.
 */
function LoanRow({
  loan,
  repayments,
  today,
  onPress,
}: {
  loan: BuddyLoan;
  repayments: RepaymentLike[];
  today: Date;
  onPress: () => void;
}) {
  const { colors, space, radius } = useTheme();

  const left = remainingMinor(loan as unknown as BuddyLoanLike, repayments);
  const repaid = repayments.reduce((sum, r) => sum + r.amountMinor, 0);
  const open = loan.status === 'outstanding';
  const gave = loan.direction === 'lent';
  const personTint = personColor(loan.personName, groupColors);

  const days = loan.dueOn ? daysUntil(loan.dueOn, today) : null;
  const urgency = days === null ? null : urgencyOf(days);

  const dueColor =
    urgency === 'overdue' ? colors.danger : urgency === 'due_soon' ? colors.pending : colors.inkMuted;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${loan.personName}, ${formatMoney(left)}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Row style={{ justifyContent: 'space-between' }} align="flex-start" gap={space.md}>
          <Row gap={space.md} align="flex-start" style={{ flex: 1 }}>
            {/* Initial rather than an avatar: no photo of the person exists,
                and a generic silhouette on every row is visual noise. */}
            <View>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: 'center',
                  justifyContent: 'center',
                  /*
                    Each PERSON gets their own tint, derived from their name.

                    Every avatar in the app's accent made the list a column of
                    identical circles, so finding a name meant reading every
                    row. A per-person colour makes the list scannable by shape
                    before any text is read — and it is the same colour on the
                    suggestion chips in the form, so a person looks the same
                    wherever they appear.

                    A CLOSED loan stays grey: the row is history, and colouring
                    it would give a settled debt the same visual weight as one
                    still owed.
                  */
                  /*
                    A ring at full strength over a deeper wash of the same tint.

                    The fill alone was the tint at `18` — barely a tenth of the
                    colour, which is all a large soft area can carry before it
                    competes with the name beside it. At that strength the
                    circles read as grey smudges and the per-person colour they
                    exist to show was invisible.

                    The border does the identifying, since it spends the colour
                    on far less area and can therefore run undiluted. That in
                    turn frees the fill to go deeper — `2E` rather than `18` —
                    without the two fighting: the ring holds the shape's edge,
                    so the wash behind it only has to separate the circle from
                    the card, not define it.
                  */
                  borderWidth: 1,
                  borderColor: open ? personTint : colors.hairlineStrong,
                  backgroundColor: open ? `${personTint}2E` : colors.surfaceSunken,
                }}
              >
                <Text
                  variant="caption"
                  color={open ? personTint : colors.inkMuted}
                  style={{ fontWeight: '800' }}
                >
                  {loan.personName.trim().charAt(0).toUpperCase() || '?'}
                </Text>
              </View>
              {/*
                A badge on the avatar saying which way the money went.

                The book holds both kinds, and the wording alone was easy to
                skim past — an arrow pointing out of the circle for money given,
                into it for money taken, reads before any of the text does.
              */}
              <View
                style={{
                  position: 'absolute',
                  right: -3,
                  bottom: -3,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  /*
                    Amber OUT, green IN — the same pairing the form's direction
                    toggle uses, so a row and the sheet that edits it agree.
                    These were the app's accent and pending, which read as two
                    arbitrary tints rather than as a direction.
                  */
                  backgroundColor: gave ? '#F59E0B' : colors.completed,
                  borderWidth: 2,
                  borderColor: colors.surface,
                }}
              >
                <Ionicons
                  name={gave ? 'arrow-up' : 'arrow-down'}
                  size={8}
                  color={colors.inkInverse}
                />
              </View>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {loan.personName}
              </Text>
              {/*
                Direction and age only.

                The original amount used to sit here too and it made the line
                too long to fit — it truncated on every row with a longer name.
                It is not lost: the remainder is on the right, and the full
                figure appears under the progress bar whenever part has come
                back.
              */}
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {directionOwes(loan.direction)} · {describeAge(daysSince(loan.lentOn, today))}
              </Text>
            </View>
          </Row>

          {/*
            `flexShrink: 0` so the remainder keeps its width and the text
            column yields instead — without it the two columns competed and a
            long amount was squeezed into its own ellipsis, which is the one
            figure on the row that must stay whole.
          */}
          <View style={{ alignItems: 'flex-end', gap: 2, minWidth: 96, flexShrink: 0 }}>
            <Text variant="bodyStrong" color={open ? colors.ink : colors.inkMuted}>
              {open ? formatMoney(left) : STATUS_LABEL[loan.status]}
            </Text>
            {open && days !== null ? (
              <Text variant="caption" color={dueColor} style={{ fontWeight: '700' }}>
                {describeDue(days)}
              </Text>
            ) : open ? (
              <Text variant="caption" tone="muted">
                no date
              </Text>
            ) : null}
          </View>
        </Row>

        {/*
          Progress spans the FULL row, below everything else.

          It used to sit inside the text column so it would start at the name
          rather than under the avatar — but that column is narrowed by the
          remainder beside it, and nothing sits beside the bar at this height.
          The caption paid for that borrowed width: "LKR 10,000 back of LKR
          15,000" wrapped to a second line to leave one orphaned figure, in the
          empty space to its own right.

          Given the whole width it fits on one line, so `numberOfLines={1}` is
          honest again — and the bar reading edge to edge says "of the whole
          loan" more directly than one indented to match the text above it.
        */}
        {open && repaid > 0 ? (
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <View
              style={{
                height: 4,
                borderRadius: radius.pill,
                backgroundColor: colors.surfaceSunken,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.min(100, (repaid / loan.amountMinor) * 100)}%`,
                  height: '100%',
                  backgroundColor: colors.positive,
                }}
              />
            </View>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {formatMoney(repaid)} back of {formatMoney(loan.amountMinor)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
