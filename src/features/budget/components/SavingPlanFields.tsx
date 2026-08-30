import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { formatAmountInput, formatMoney, parseAmount } from '~/shared/lib/money';
import { monthsBetween, savingPlanProgress } from '~/features/budget/logic/planning';
import { MONTH_NAMES } from '~/shared/lib/dates';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { Field } from '~/shared/components/forms';
import { Divider, GradientCard, Label, Row, Surface, Text } from '~/shared/components/ui';

/** How the user prefers to describe the plan. */
export type PlanMode = 'total' | 'monthly';

/**
 * The saving-plan form state. Kept as strings because it mirrors text inputs;
 * `toSavingPlanPatch` converts it to the stored shape.
 */
export interface SavingPlanDraft {
  enabled: boolean;
  mode: PlanMode;
  /** Full amount to reach, when mode is 'total'. */
  totalAmount: string;
  /** Monthly set-aside, when mode is 'monthly'. */
  monthlyAmount: string;
  /** Due / expiry date, when mode is 'total'. */
  dueDate: Date | null;
}

export const emptySavingPlanDraft: SavingPlanDraft = {
  enabled: false,
  mode: 'total',
  totalAmount: '',
  monthlyAmount: '',
  /*
   * A real date, not null.
   *
   * The month picker SHOWS a default of a year out whether or not one is
   * stored, so leaving this null meant the form displayed a complete-looking
   * deadline while the summary silently refused to resolve — the user saw
   * "Mar 2027" selected and an "enter a due date" hint at the same time.
   * Seeding it makes what is shown and what is stored the same thing.
   */
  dueDate: dateInMonths(12),
};

/** Rebuild the form state from a stored subcategory. */
export function savingPlanDraftFrom(sub: {
  planTargetMinor?: number | null;
  planDueDate?: Date | null;
}): SavingPlanDraft {
  if (sub.planTargetMinor == null || !sub.planDueDate) return emptySavingPlanDraft;
  return {
    ...emptySavingPlanDraft,
    enabled: true,
    mode: 'total',
    // Grouped on the way in, so an existing target opens formatted rather than
    // gaining its separators only once the field is touched.
    totalAmount: formatAmountInput(String(sub.planTargetMinor / 100)),
    dueDate: sub.planDueDate,
  };
}

/** Months from now, as a date — used by the 'monthly' mode. */
function dateInMonths(months: number): Date {
  const date = new Date();
  date.setMonth(date.getMonth() + Math.max(1, Math.round(months)));
  return date;
}

/**
 * Resolve the draft into the fields stored on a subcategory: the full target,
 * the due date, and the monthly set-aside that becomes `plannedMinor`.
 * Returns null when the plan is off or incomplete.
 */
export function toSavingPlanPatch(draft: SavingPlanDraft): {
  planTargetMinor: number;
  planDueDate: Date;
  planStartDate: Date;
  monthlyMinor: number;
  /**
   * How many contributions the plan is divided into.
   *
   * Returned rather than left for the caller to recompute: the summary states
   * it ("6 monthly payments to reach 144,000"), and a second `monthsBetween`
   * call at the call site could round differently from the one that produced
   * `monthlyMinor` — leaving the card describing a division it did not make.
   */
  months: number;
} | null {
  if (!draft.enabled) return null;

  if (draft.mode === 'total') {
    const target = parseAmount(draft.totalAmount);
    if (!target || target <= 0 || !draft.dueDate) return null;
    const months = Math.max(1, monthsBetween(new Date(), draft.dueDate));
    return {
      planTargetMinor: target,
      planDueDate: draft.dueDate,
      planStartDate: new Date(),
      monthlyMinor: Math.ceil(target / months),
      months,
    };
  }

  /*
   * The term now comes from the TARGET MONTH, like the other mode.
   *
   * It used to be typed as a count of months and the due date derived from it.
   * Both modes ask for the deadline the same way now, so this reads the months
   * back off that date — which also means the two modes can no longer disagree
   * about when the plan ends.
   */
  const monthly = parseAmount(draft.monthlyAmount);
  if (!monthly || monthly <= 0 || !draft.dueDate) return null;

  const months = Math.max(1, monthsBetween(new Date(), draft.dueDate));

  return {
    planTargetMinor: monthly * months,
    planDueDate: draft.dueDate,
    planStartDate: new Date(),
    monthlyMinor: monthly,
    months,
  };
}

/**
 * Fields for turning an ordinary bill into a saving plan — a large amount due
 * later that you collect monthly (vehicle insurance, a 6-month subscription, a
 * card installment plan).
 *
 * Two entry modes, because people know different halves of the problem: "it's
 * 144k due in March" or "it's 12k a month for 12 months". Whichever is used,
 * a live summary shows the other side so the commitment is never a surprise.
 */
export function SavingPlanFields({
  draft,
  onChange,
}: {
  draft: SavingPlanDraft;
  onChange: (next: SavingPlanDraft) => void;
}) {
  const { colors, radius, space } = useTheme();
  const resolved = toSavingPlanPatch(draft);

  function update(patch: Partial<SavingPlanDraft>) {
    onChange({ ...draft, ...patch });
  }

  return (
    <View style={{ gap: space.sm }}>
      {/* Toggle — off by default, since most bills are simply paid monthly. */}
      <Pressable
        onPress={() => update({ enabled: !draft.enabled })}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: draft.enabled }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.md,
          borderRadius: radius.lg,
          borderWidth: 1.5,
          borderColor: draft.enabled ? colors.accent : colors.hairline,
          backgroundColor: draft.enabled ? colors.accentSoft : colors.surface,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Ionicons
          name={draft.enabled ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={draft.enabled ? colors.accent : colors.inkMuted}
        />
        <View style={{ flex: 1 }}>
          {/* A question, because that is what the checkbox is asking. */}
          <Text variant="bodyStrong" color={draft.enabled ? colors.accentInk : colors.ink}>
            Collect this monthly?
          </Text>
          <Text variant="caption" tone="muted">
            Save a bit each month for a big bill later
          </Text>
        </View>
      </Pressable>

      {draft.enabled ? (
        <View style={{ gap: space.lg, paddingTop: space.xs }}>
          {/* Entry mode. */}
          <View style={{ gap: space.sm }}>
            <Label>I KNOW THE</Label>
            <Row gap={space.sm}>
              {/*
                Switching mode CARRIES THE PLAN OVER.

                The two modes hold their amounts in different fields, so
                flipping between them used to blank the form: a plan entered as
                "144,000 by March" became an empty Monthly box, the summary card
                vanished, and the user had to retype a figure the app had just
                worked out and was showing them a second earlier.

                The switch now seeds the other side from what is already
                resolved — the same number the card was displaying — so the two
                modes are two views of one plan rather than two separate forms.
                Nothing is seeded when the plan is incomplete; there is simply
                nothing to carry.
              */}
              <ModeChip
                label="Total & date"
                selected={draft.mode === 'total'}
                onPress={() =>
                  update({
                    mode: 'total',
                    /*
                      Seeded from the target, which in 'monthly' mode is
                      monthly x months — deliberately NOT re-derived from the
                      rounded monthly figure. `Math.ceil` rounds the monthly
                      set-aside up so the goal is never short, and multiplying
                      that back would show a total a cent or two above the one
                      the user typed.
                    */
                    ...(resolved && !draft.totalAmount.trim()
                      ? { totalAmount: formatAmountInput(String(resolved.planTargetMinor / 100)) }
                      : null),
                  })
                }
              />
              <ModeChip
                label="Monthly & term"
                selected={draft.mode === 'monthly'}
                onPress={() =>
                  update({
                    mode: 'monthly',
                    ...(resolved && !draft.monthlyAmount.trim()
                      ? { monthlyAmount: formatAmountInput(String(resolved.monthlyMinor / 100)) }
                      : null),
                  })
                }
              />
            </Row>
          </View>

          {draft.mode === 'total' ? (
            <>
              <Field
                label="Total amount"
                value={draft.totalAmount}
                onChangeText={(totalAmount) => update({ totalAmount })}
                placeholder="e.g. 144000"
                money
              />
              <DueDateField
                value={draft.dueDate}
                onChange={(dueDate) => update({ dueDate })}
              />
            </>
          ) : (
            <>
              <Field
                label="Monthly amount"
                value={draft.monthlyAmount}
                onChangeText={(monthlyAmount) => update({ monthlyAmount })}
                placeholder="e.g. 12000"
                money
              />
              {/*
                The SAME month/year picker the other mode uses.

                This branch asked "for how many months?" with four preset chips
                and a number box — a third and fourth way to express a deadline
                the user holds as a month. Both modes now ask the one question
                the same way; they still differ in which AMOUNT is typed, which
                is the only thing that genuinely separates them.
              */}
              <DueDateField
                value={draft.dueDate}
                onChange={(dueDate) => update({ dueDate })}
              />
            </>
          )}

          {/*
            THE ANSWER, given the weight of an answer.

            Everything above is input; this is the one figure the form exists to
            produce — "put aside X a month and you will have it in time". It
            used to be a row inside a tinted box, sitting between "Total to
            collect" and "Due" as though the three were equals, so the number
            the user came for looked like a footnote on its own summary.

            Now it is the brand gradient card the app gives its headline figures
            everywhere else, with the two supporting facts demoted to a footer
            beneath a rule. The term is stated in words as well — "6 monthly
            payments" — because that is what makes the figure checkable: a
            monthly amount with no count beside it cannot be sanity-tested
            against the total.
          */}
          {resolved ? (
            <GradientCard style={{ marginTop: space.xs }}>
              {/*
                The MONTHLY figure leads in both modes.

                It used to swap — showing the total in 'monthly' mode on the
                grounds that echoing the user's own input told them nothing.
                But the monthly amount is the number this feature exists to
                answer ("can I afford this?"), and moving it between the
                headline and the footer depending on how it was entered meant
                the eye had to hunt for it. It stays put; the supporting line
                below carries whatever else is worth saying.
              */}
              <View style={{ gap: space.xs }}>
                <Label color="rgba(255,255,255,0.75)">YOU SAVE EACH MONTH</Label>
                <Text variant="hero" color="#FFFFFF">
                  {formatMoney(resolved.monthlyMinor)}
                </Text>
                {/* Just the term — the total it reaches is stated in the
                    footer below, and saying it twice on one small card reads
                    as two different facts until you compare them. */}
                <Text variant="caption" color="rgba(255,255,255,0.85)">
                  for {resolved.months} {resolved.months === 1 ? 'month' : 'months'}
                </Text>
              </View>

              <Divider
                style={{ backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: space.md }}
              />

              <Row justify="space-between" align="center">
                <View style={{ gap: 1 }}>
                  <Label color="rgba(255,255,255,0.65)">TOTAL</Label>
                  <Text variant="bodyStrong" color="#FFFFFF">
                    {formatMoney(resolved.planTargetMinor)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 1 }}>
                  <Label color="rgba(255,255,255,0.65)">READY BY</Label>
                  <Text variant="bodyStrong" color="#FFFFFF">
                    {MONTH_NAMES[resolved.planDueDate.getMonth()].slice(0, 3)}{' '}
                    {resolved.planDueDate.getFullYear()}
                  </Text>
                </View>
              </Row>
            </GradientCard>
          ) : (
            <Text variant="caption" tone="muted">
              {draft.mode === 'total'
                ? 'Enter the total and pick a due date.'
                : 'Enter the monthly amount and pick when it ends.'}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function ModeChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: space.sm,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: selected ? colors.accent : colors.hairline,
        backgroundColor: selected ? colors.surface : colors.surface,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text
        variant="small"
        color={selected ? colors.accentInk : colors.inkSecondary}
        style={{ fontWeight: selected ? '700' : '500' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Target-month entry: one grid of months, one row of years.
 *
 * A savings deadline is a MONTH — "the insurance is due next March" — not a
 * date. This field used to ask for one three different ways at once: preset
 * chips (3 / 6 / 12 months), a free "in N months" box, and a pair of chevrons
 * nudging a full date one month at a time. Three controls for one answer, none
 * of which let the user simply say "March 2027" — they all expressed the
 * deadline as a DURATION, which is arithmetic the user had to do in their head
 * and then re-check against the date printed underneath.
 *
 * So the question is asked the way it is actually held: pick the month, pick
 * the year. The months between here and there are then derived, and the caller
 * turns that into the monthly figure — the number the user actually wanted all
 * along.
 */
function DueDateField({
  value,
  onChange,
}: {
  value: Date | null;
  onChange: (date: Date) => void;
}) {
  const { colors, radius, space } = useTheme();
  const current = value ?? dateInMonths(12);

  const now = new Date();
  const selectedMonth = current.getMonth();
  const selectedYear = current.getFullYear();

  /**
   * Five years starting from this one — enough for the plans this field is
   * for (insurance, a subscription term, a card installment plan) without a
   * scrolling year list nobody needs.
   */
  const years = Array.from({ length: 5 }, (_, index) => now.getFullYear() + index);

  /**
   * Set the target to a month/year, keeping the day.
   *
   * Clamped to the month's length so picking February off a 31st does not roll
   * into March — `setMonth` on a too-long day silently overflows, which is
   * exactly the bug that made the old duration box disagree with itself.
   */
  function pick(month: number, year: number) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    onChange(new Date(year, month, Math.min(current.getDate(), lastDay)));
  }

  /** A month already gone in the current year cannot be a savings deadline. */
  function isPast(month: number, year: number): boolean {
    return year === now.getFullYear() && month < now.getMonth();
  }

  return (
    <View style={{ gap: space.sm }}>
      <Row justify="space-between" align="center">
        <Label>WHICH MONTH DO YOU NEED IT?</Label>
        <Text variant="caption" color={colors.accentInk} style={{ fontWeight: '700' }}>
          {MONTH_NAMES[selectedMonth].slice(0, 3)} {selectedYear}
        </Text>
      </Row>

      {/* Years first: it scopes which months are still choosable. */}
      <Row gap={space.sm}>
        {years.map((year) => {
          const selected = year === selectedYear;
          return (
            <Pressable
              key={year}
              onPress={() => {
                // Choosing a year whose earlier months have passed would leave
                // a deadline in the past, so the selection moves forward with
                // it rather than being silently invalid.
                const month = isPast(selectedMonth, year) ? now.getMonth() : selectedMonth;
                pick(month, year);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: 'center',
                paddingVertical: 8,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: selected ? colors.accent : colors.hairline,
                backgroundColor: selected ? colors.accentSoft : colors.surface,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text
                variant="small"
                color={selected ? colors.accentInk : colors.inkSecondary}
                style={{ fontWeight: selected ? '700' : '500' }}
              >
                {year}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      {/*
        Months as a 6x2 grid rather than 4x3.

        Square cells at four across are wide, and three rows of them made the
        picker the tallest thing on the sheet — pushing the plan summary, the
        figure the user is actually after, below the fold. Six across keeps the
        cells square while halving the height, and splits the year into its two
        natural halves.
      */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.hairline,
          padding: space.sm,
          gap: 6,
        }}
      >
        {[0, 1].map((row) => (
          <Row key={row} gap={6}>
            {MONTH_NAMES.slice(row * 6, row * 6 + 6).map((name, column) => {
              const month = row * 6 + column;
              const selected = month === selectedMonth;
              const past = isPast(month, selectedYear);

              return (
                /*
                  Square cells, like the day grids elsewhere in the app.

                  The sizing lives on a wrapper rather than on the Pressable:
                  `flex: 1` and `aspectRatio` on one node fight each other in
                  React Native — the flex basis wins and the ratio is ignored —
                  which is why `DayPicker` wraps its cells the same way. The
                  wrapper owns the square, the Pressable fills it.
                */
                <View key={name} style={{ flex: 1, aspectRatio: 1 }}>
                  <Pressable
                    onPress={() => pick(month, selectedYear)}
                    disabled={past}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: past }}
                    accessibilityLabel={`${name} ${selectedYear}`}
                    style={({ pressed }) => ({
                      flex: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius.md,
                      backgroundColor: selected ? colors.accent : colors.surfaceSunken,
                      // Past months stay VISIBLE but inert, so the grid keeps
                      // its shape and the reason a month cannot be picked is
                      // legible.
                      opacity: past ? 0.35 : pressed ? 0.75 : 1,
                    })}
                  >
                    {/* `caption` rather than `small`: six square cells across
                        leaves each one narrow, and the larger size clipped the
                        3-letter month on a small phone. */}
                    <Text
                      variant="caption"
                      color={selected ? colors.inkInverse : colors.inkSecondary}
                      style={{ fontWeight: selected ? '800' : '600' }}
                    >
                      {name.slice(0, 3)}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </Row>
        ))}
      </View>
    </View>
  );
}

/**
 * Read-only progress card for a bill that already has a plan — shown on the
 * bill's detail screen so "how far along am I" is answered at a glance.
 */
export function SavingPlanProgressCard({
  targetMinor,
  dueDate,
  startDate,
  savedMinor,
}: {
  targetMinor: number;
  dueDate: Date;
  startDate: Date;
  savedMinor: number;
}) {
  const { colors, radius, space } = useTheme();
  const progress = savingPlanProgress({ targetMinor, dueDate, startDate }, savedMinor);

  const tone = progress.isOverdue
    ? colors.danger
    : progress.isComplete
      ? colors.completed
      : colors.accent;

  return (
    <Surface style={{ gap: space.md }}>
      <Row justify="space-between" align="center">
        <Label>SAVING PLAN</Label>
        <Text variant="caption" color={tone} style={{ fontWeight: '700' }}>
          {progress.isComplete
            ? 'Fully saved'
            : progress.isOverdue
              ? `${Math.abs(progress.daysUntilDue)} days overdue`
              : `${progress.daysUntilDue} days left`}
        </Text>
      </Row>

      <Row justify="space-between" align="flex-end">
        <Text variant="figureLarge">{formatMoney(progress.savedMinor)}</Text>
        <Text variant="small" tone="muted">
          of {formatMoney(progress.targetMinor)}
        </Text>
      </Row>

      <View
        style={{
          height: 8,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceSunken,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${progress.progressPct}%`,
            height: '100%',
            borderRadius: radius.pill,
            backgroundColor: tone,
          }}
        />
      </View>

      <Divider />

      <Row justify="space-between">
        <Text variant="caption" tone="muted">
          {progress.isComplete
            ? 'Nothing more to set aside'
            : `${formatMoney(progress.monthlyMinor)} / month for ${progress.monthsRemaining} more`}
        </Text>
        <Text variant="caption" tone="secondary">
          due{' '}
          {dueDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </Text>
      </Row>
    </Surface>
  );
}
