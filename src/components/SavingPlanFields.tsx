import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { formatMoney, parseAmount } from '../core/money';
import { monthsBetween, savingPlanProgress } from '../core/planning';
import { useTheme } from '../theme/ThemeProvider';
import { Field } from './forms';
import { Divider, Label, Row, Surface, T } from './ui';

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
  /** Months to save for — drives the due date in 'monthly' mode. */
  months: string;
  /** Monthly set-aside, when mode is 'monthly'. */
  monthlyAmount: string;
  /** Due / expiry date, when mode is 'total'. */
  dueDate: Date | null;
}

export const emptySavingPlanDraft: SavingPlanDraft = {
  enabled: false,
  mode: 'total',
  totalAmount: '',
  months: '12',
  monthlyAmount: '',
  dueDate: null,
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
    totalAmount: String(sub.planTargetMinor / 100),
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
    };
  }

  const monthly = parseAmount(draft.monthlyAmount);
  const months = Number.parseInt(draft.months, 10);
  if (!monthly || monthly <= 0 || !Number.isFinite(months) || months < 1) return null;

  return {
    planTargetMinor: monthly * months,
    planDueDate: dateInMonths(months),
    planStartDate: new Date(),
    monthlyMinor: monthly,
  };
}

const MONTH_PRESETS = [3, 6, 12, 24];

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
          <T variant="bodyStrong" color={draft.enabled ? colors.accentInk : colors.ink}>
            Save up for this
          </T>
          <T variant="caption" tone="muted">
            A big amount due later — collect it monthly
          </T>
        </View>
      </Pressable>

      {draft.enabled ? (
        <View style={{ gap: space.lg, paddingTop: space.xs }}>
          {/* Entry mode. */}
          <View style={{ gap: space.sm }}>
            <Label>I KNOW THE</Label>
            <Row gap={space.sm}>
              <ModeChip
                label="Total & date"
                selected={draft.mode === 'total'}
                onPress={() => update({ mode: 'total' })}
              />
              <ModeChip
                label="Monthly & term"
                selected={draft.mode === 'monthly'}
                onPress={() => update({ mode: 'monthly' })}
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
                keyboardType="numeric"
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
                keyboardType="numeric"
              />
              <View style={{ gap: space.sm }}>
                <Label>FOR HOW MANY MONTHS?</Label>
                <Row gap={space.sm}>
                  {MONTH_PRESETS.map((preset) => (
                    <ModeChip
                      key={preset}
                      label={`${preset}`}
                      selected={draft.months === String(preset)}
                      onPress={() => update({ months: String(preset) })}
                    />
                  ))}
                </Row>
                <Field
                  label="Or enter months"
                  value={draft.months}
                  onChangeText={(months) => update({ months })}
                  placeholder="12"
                  keyboardType="numeric"
                />
              </View>
            </>
          )}

          {/* Live summary — always shows the half the user didn't enter. */}
          {resolved ? (
            <Surface style={{ gap: space.sm, backgroundColor: colors.accentSoft }}>
              <Label>PLAN</Label>
              <Row justify="space-between">
                <T variant="small">Set aside monthly</T>
                <T variant="figureLarge" color={colors.accentInk}>
                  {formatMoney(resolved.monthlyMinor)}
                </T>
              </Row>
              <Divider />
              <Row justify="space-between">
                <T variant="caption" tone="muted">
                  Total to collect
                </T>
                <T variant="caption" tone="secondary">
                  {formatMoney(resolved.planTargetMinor)}
                </T>
              </Row>
              <Row justify="space-between">
                <T variant="caption" tone="muted">
                  Due
                </T>
                <T variant="caption" tone="secondary">
                  {resolved.planDueDate.toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </T>
              </Row>
            </Surface>
          ) : (
            <T variant="caption" tone="muted">
              {draft.mode === 'total'
                ? 'Enter the total and pick a due date.'
                : 'Enter the monthly amount and number of months.'}
            </T>
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
      <T
        variant="small"
        color={selected ? colors.accentInk : colors.inkSecondary}
        style={{ fontWeight: selected ? '700' : '500' }}
      >
        {label}
      </T>
    </Pressable>
  );
}

const QUICK_DATES: { label: string; months: number }[] = [
  { label: '3 months', months: 3 },
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
];

/**
 * Due-date entry without a heavy date-picker dependency: quick relative
 * presets cover the common cases, and month/year steppers handle the rest.
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

  function shiftMonths(delta: number) {
    const next = new Date(current);
    next.setMonth(next.getMonth() + delta);
    onChange(next);
  }

  return (
    <View style={{ gap: space.sm }}>
      <Label>DUE / EXPIRY DATE</Label>

      <Row gap={space.sm}>
        {QUICK_DATES.map((preset) => (
          <ModeChip
            key={preset.label}
            label={preset.label}
            selected={false}
            onPress={() => onChange(dateInMonths(preset.months))}
          />
        ))}
      </Row>

      <Row
        justify="space-between"
        align="center"
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.hairlineStrong,
          paddingHorizontal: space.sm,
          paddingVertical: 4,
        }}
      >
        <Pressable
          onPress={() => shiftMonths(-1)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Earlier month"
          style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.5 : 1 })}
        >
          <Ionicons name="chevron-back" size={18} color={colors.inkSecondary} />
        </Pressable>

        <T variant="bodyStrong">
          {current.toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </T>

        <Pressable
          onPress={() => shiftMonths(1)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Later month"
          style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.5 : 1 })}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.inkSecondary} />
        </Pressable>
      </Row>
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
        <T variant="caption" color={tone} style={{ fontWeight: '700' }}>
          {progress.isComplete
            ? 'Fully saved'
            : progress.isOverdue
              ? `${Math.abs(progress.daysUntilDue)} days overdue`
              : `${progress.daysUntilDue} days left`}
        </T>
      </Row>

      <Row justify="space-between" align="flex-end">
        <T variant="figureLarge">{formatMoney(progress.savedMinor)}</T>
        <T variant="small" tone="muted">
          of {formatMoney(progress.targetMinor)}
        </T>
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
        <T variant="caption" tone="muted">
          {progress.isComplete
            ? 'Nothing more to set aside'
            : `${formatMoney(progress.monthlyMinor)} / month for ${progress.monthsRemaining} more`}
        </T>
        <T variant="caption" tone="secondary">
          due{' '}
          {dueDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </T>
      </Row>
    </Surface>
  );
}
