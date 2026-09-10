import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Label, Segmented, Text } from '~/shared/components/ui';
import { AmountField, Field, NameWithIconField } from '~/shared/components/forms';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { ImageUploader } from '~/shared/components/ImageUploader';
import {
  outstandingForPerson,
  personColor,
  recentPeople,
  validateLoanAmount,
  type BuddyLoanLike,
  type BuddyRepayment as RepaymentLike,
} from '~/features/buddyloans/logic/buddyLoans';
import { miniAppById } from '~/shared/lib/miniApps';
import {
  formatAmountInput,
  formatMoney,
  parseAmount,
  toMajor,
  validateAmount,
  type Minor,
} from '~/shared/lib/money';
import type { BuddyLoan } from '~/db/schema';
import { useAppStore } from '~/store/useAppStore';
import { groupColors } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';

const BUDDY_LOANS = miniAppById('buddyloans')!;

/** Midnight on a date, so a same-day comparison is not defeated by the clock. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** A month out — the most common informal promise, and merely a starting point. */
export function defaultDueDate(): Date {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return date;
}

const DIRECTIONS = [
  {
    key: 'lent' as const,
    label: 'I gave it',
    icon: 'arrow-up-circle' as const,
    /*
     * Two shades, not one.
     *
     * `tint` washes the card; `ink` writes on it. A single gold did both badly
     * — light enough to sit behind text is too light to BE text, so the label
     * came out pale and the option was hard to read at a glance.
     */
    tint: '#fe7f73',
    ink: '#ce2a1c',
  },
  {
    key: 'borrowed' as const,
    label: 'I took it',
    icon: 'arrow-down-circle' as const,
    tint: '#10B981',
    ink: '#047857',
  },
];

export type LoanDirection = 'lent' | 'borrowed';
export type LoanMethod = 'cash' | 'transfer' | 'other';

/**
 * Everything that describes a buddy loan, as one reusable block.
 *
 * TWO screens record a loan: the add-on's own "New loan" sheet, and the SMS
 * review screen when a detected transfer turns out to be money lent rather than
 * money spent. Each owned its own form, and they had already drifted — the SMS
 * one asked three questions with a different direction control, different
 * labels, and no method, note, photo or recent-people chips. One concept
 * described two ways is how a form quietly stops matching the record it writes.
 *
 * So the fields live here and the two callers supply only their own chrome:
 * title, footer and what to do on save. Exactly the arrangement `BillFields`
 * uses for the two sheets that create a bill.
 */
export interface LoanDraft {
  personName: string;
  setPersonName: (next: string) => void;
  amount: string;
  setAmount: (next: string) => void;
  direction: LoanDirection;
  setDirection: (next: LoanDirection) => void;
  method: LoanMethod;
  setMethod: (next: LoanMethod) => void;
  lentOn: Date;
  setLentOn: (next: Date) => void;
  hasDueDate: boolean;
  setHasDueDate: (next: boolean) => void;
  dueOn: Date;
  setDueOn: (next: Date) => void;
  imageUri: string | null;
  setImageUri: (next: string | null) => void;
  note: string;
  setNote: (next: string) => void;
  /** Flipped on a failed save, so errors appear only once something was tried. */
  showErrors: boolean;
  setShowErrors: (next: boolean) => void;

  amountError: string | null;
  nameError: string | null;
  dueError: string | null;
  /** True when the fields describe a saveable loan. */
  canSave: boolean;
  /** The values to hand to `addBuddyLoan` / `updateBuddyLoan`. */
  toPatch: () => {
    personName: string;
    amountMinor: Minor;
    direction: LoanDirection;
    method: LoanMethod;
    lentOn: Date;
    dueOn: Date | null;
    imageUri: string | null;
    note: string | null;
  };
}

export function useLoanDraft({
  existing,
  /** Seeds for a loan being created from something else — see the SMS review screen. */
  seedAmountMinor,
  seedDirection,
  seedMethod,
  seedLentOn,
  seedNote,
}: {
  existing?: BuddyLoan;
  seedAmountMinor?: Minor;
  seedDirection?: LoanDirection;
  seedMethod?: LoanMethod;
  seedLentOn?: Date;
  seedNote?: string | null;
} = {}): LoanDraft {
  const [personName, setPersonName] = React.useState(existing?.personName ?? '');
  /*
   * Seeded through the SAME formatter the field applies to typing, so an
   * existing figure opens grouped rather than gaining its separators only once
   * the field is touched.
   */
  const [amount, setAmount] = React.useState(() => {
    const minor = existing?.amountMinor ?? seedAmountMinor;
    return minor != null ? formatAmountInput(String(toMajor(minor))) : '';
  });
  const [direction, setDirection] = React.useState<LoanDirection>(
    existing?.direction ?? seedDirection ?? 'lent',
  );
  const [method, setMethod] = React.useState<LoanMethod>(
    existing?.method ?? seedMethod ?? 'cash',
  );
  const [lentOn, setLentOn] = React.useState<Date>(
    existing?.lentOn ?? seedLentOn ?? new Date(),
  );
  /*
   * A due date is OPT-IN, and the toggle is part of the record rather than
   * inferred from an empty field. "No date agreed" is a real answer here, and a
   * picker that always shows today quietly turns it into a wrong promise the
   * dashboard would then nag about.
   */
  const [hasDueDate, setHasDueDate] = React.useState(existing?.dueOn != null);
  const [dueOn, setDueOn] = React.useState<Date>(existing?.dueOn ?? defaultDueDate());
  const [imageUri, setImageUri] = React.useState<string | null>(existing?.imageUri ?? null);
  const [note, setNote] = React.useState(existing?.note ?? seedNote ?? '');
  const [showErrors, setShowErrors] = React.useState(false);

  /*
   * How much has already come back on this loan, so the amount cannot be edited
   * below it. Empty for a new loan, which has no repayments.
   */
  const alreadyRepaid = useAppStore((s) =>
    existing
      ? s.buddyRepayments
          .filter((r) => r.loanId === existing.id)
          .reduce((sum, r) => sum + r.amountMinor, 0)
      : 0,
  );

  const amountError =
    validateAmount(amount) ?? validateLoanAmount(parseAmount(amount) ?? 0, alreadyRepaid);
  const nameError = personName.trim().length === 0 ? 'Who is this for?' : null;
  const dueError =
    hasDueDate && dueOn.getTime() < startOfDay(lentOn).getTime()
      ? 'The return date must be after the day you gave the money'
      : null;

  return {
    personName,
    setPersonName,
    amount,
    setAmount,
    direction,
    setDirection,
    method,
    setMethod,
    lentOn,
    setLentOn,
    hasDueDate,
    setHasDueDate,
    dueOn,
    setDueOn,
    imageUri,
    setImageUri,
    note,
    setNote,
    showErrors,
    setShowErrors,
    amountError,
    nameError,
    dueError,
    canSave: !amountError && !nameError && !dueError,
    toPatch: () => ({
      personName: personName.trim(),
      amountMinor: parseAmount(amount)!,
      direction,
      method,
      lentOn,
      dueOn: hasDueDate ? dueOn : null,
      imageUri,
      note: note.trim() || null,
    }),
  };
}

export function LoanFields({
  draft,
  /** Editing an existing loan: suppresses the people chips and the autofocus. */
  existing,
  /**
   * Hide the amount field.
   *
   * For a loan created from a bank message: the bank already stated the figure,
   * and an editable one invites a record that disagrees with the statement line
   * it came from.
   */
  hideAmount,
  /** Shown above the fields — the SMS path explains why this is not spending. */
  intro,
}: {
  draft: LoanDraft;
  existing?: BuddyLoan;
  hideAmount?: boolean;
  intro?: string;
}) {
  const { colors, radius, space } = useTheme();
  const loans = useAppStore((s) => s.buddyLoans);
  const allRepayments = useAppStore((s) => s.buddyRepayments);

  /*
   * Recent people, each with what they still owe.
   *
   * Computed from the store's own loans and repayments — no extra query, and it
   * stays correct the moment anything is settled.
   */
  const suggestions = React.useMemo(() => {
    const byLoan = new Map<string, RepaymentLike[]>();
    for (const r of allRepayments) {
      const bucket = byLoan.get(r.loanId) ?? [];
      bucket.push(r);
      byLoan.set(r.loanId, bucket);
    }
    const source = loans as unknown as BuddyLoanLike[];
    return recentPeople(source).map((name) => ({
      name,
      outstandingMinor: outstandingForPerson(source, byLoan, name),
    }));
  }, [loans, allRepayments]);

  const [showMore, setShowMore] = React.useState(Boolean(existing));
  const hasOptionalValues = Boolean(existing?.imageUri || existing?.note);
  const [forceCollapsed, setForceCollapsed] = React.useState(false);
  const detailsOpen = !forceCollapsed && (showMore || hasOptionalValues);

  const currency = useAppStore((s) => s.currency);

  return (
    <>
      {intro ? (
        <Text variant="small" tone="muted">
          {intro}
        </Text>
      ) : null}

      {/*
        The AMOUNT and the DIRECTION together, as one statement.

        These are the two halves of a single fact — "5,000 out" or "5,000 in" —
        and splitting them into a figure and a separate pill row made the form
        open on two questions instead of one.
      */}
      {hideAmount ? null : (
        <AmountField
          value={draft.amount}
          onChangeText={draft.setAmount}
          currency={currency}
          autoFocus={!existing}
          error={draft.showErrors ? draft.amountError : null}
        />
      )}

      <View
        style={{
          flexDirection: 'row',
          gap: 4,
          padding: 4,
          borderRadius: radius.md,
          backgroundColor: colors.canvas,
        }}
      >
        {DIRECTIONS.map((option) => {
          const selected = draft.direction === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => draft.setDirection(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 16,
                borderRadius: radius.md,
                /*
                 * A TINTED card, not a saturated fill: solid colour made the
                 * selected half the loudest thing on the sheet, and in red it
                 * read as a warning rather than a direction.
                 */
                backgroundColor: selected ? `${option.tint}18` : 'transparent',
                borderWidth: 1,
                borderColor: selected ? `${option.tint}4D` : 'transparent',
                ...(selected
                  ? {
                      shadowColor: '#000',
                      shadowOpacity: 0.06,
                      shadowRadius: 4,
                      shadowOffset: { width: 0, height: 1 },
                    }
                  : null),
              }}
            >
              <Ionicons
                name={option.icon}
                size={19}
                color={selected ? option.ink : colors.inkMuted}
              />
              <Text
                variant="small"
                color={selected ? option.ink : colors.inkSecondary}
                style={{ fontWeight: '700', fontSize: 16 }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* The same name-with-icon field a category, vehicle or person uses. */}
      <NameWithIconField
        label="Who"
        value={draft.personName}
        onChangeText={draft.setPersonName}
        icon="person-outline"
        iconColor={BUDDY_LOANS.color}
        placeholder="Their name"
        autoFocus={hideAmount && !existing}
      />
      {draft.showErrors && draft.nameError ? (
        <Text variant="caption" color={colors.danger}>
          {draft.nameError}
        </Text>
      ) : null}

      {/*
        The people you have lent to before, as one-tap chips.

        Lending is repetitive — the same handful of friends and relatives — and
        each chip carries what that person still owes, so choosing one is an
        informed decision rather than a blind autocomplete.
      */}
      {!existing && draft.personName.trim().length === 0 && suggestions.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {suggestions.map((person) => (
            <Pressable
              key={person.name}
              onPress={() => draft.setPersonName(person.name)}
              accessibilityRole="button"
              accessibilityLabel={
                person.outstandingMinor > 0
                  ? `${person.name}, owes ${formatMoney(person.outstandingMinor)}`
                  : person.name
              }
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingLeft: 6,
                paddingRight: space.md,
                paddingVertical: 6,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.hairline,
                backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
              })}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: `${personColor(person.name, groupColors)}18`,
                }}
              >
                <Text
                  variant="caption"
                  color={personColor(person.name, groupColors)}
                  style={{ fontWeight: '800' }}
                >
                  {person.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View>
                <Text variant="caption" style={{ fontWeight: '700' }}>
                  {person.name}
                </Text>
                {person.outstandingMinor > 0 ? (
                  <Text variant="caption" tone="muted">
                    owes {formatMoney(person.outstandingMinor, { compact: true })}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/*
        The due date as ONE row, not a toggle plus a field. "No date" and a
        picker were two controls answering one question.
      */}
      <View style={{ gap: space.sm }}>
        <Label>{draft.direction === 'lent' ? 'THEY PAY BACK' : 'I PAY BACK'}</Label>

        {draft.hasDueDate ? (
          <>
            <DatePickerField label="" value={draft.dueOn} onChange={draft.setDueOn} allowFuture />
            <Pressable
              onPress={() => draft.setHasDueDate(false)}
              accessibilityRole="button"
              accessibilityLabel="Clear the date"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}
            >
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                Clear the date
              </Text>
            </Pressable>
            {draft.showErrors && draft.dueError ? (
              <Text variant="caption" color={colors.danger}>
                {draft.dueError}
              </Text>
            ) : null}
          </>
        ) : (
          <Pressable
            onPress={() => draft.setHasDueDate(true)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingHorizontal: space.md,
              paddingVertical: 13,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
            })}
          >
            <Ionicons name="infinite-outline" size={18} color={colors.inkMuted} />
            <Text variant="body" tone="muted" style={{ flex: 1 }}>
              No date agreed
            </Text>
            <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
              Set a date
            </Text>
          </Pressable>
        )}

        {/* A dateless loan never reaches the dashboard — `dueBuddyLoans` drops
            every record without one, deliberately. Said here rather than
            discovered weeks later. */}
        {!draft.hasDueDate ? (
          <Text variant="caption" tone="muted">
            Without a date this stays in Buddy loans and will not remind you.
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={() => {
          const next = !detailsOpen;
          setShowMore(next);
          setForceCollapsed(!next);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: 10,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
          {detailsOpen ? 'Fewer details' : 'More details'}
        </Text>
        <Ionicons
          name={detailsOpen ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.accent}
        />
      </Pressable>

      {detailsOpen ? (
        <>
          <View style={{ gap: space.sm }}>
            <Label>HOW</Label>
            <Segmented
              options={[
                { key: 'cash', label: 'Cash', icon: 'cash-outline' },
                { key: 'transfer', label: 'Transfer', icon: 'swap-horizontal-outline' },
                { key: 'other', label: 'Other', icon: 'ellipsis-horizontal' },
              ]}
              selectedKey={draft.method}
              onSelect={(key) => draft.setMethod(key as LoanMethod)}
            />
          </View>

          <DatePickerField
            label={draft.direction === 'lent' ? 'I gave it on' : 'I took it on'}
            value={draft.lentOn}
            onChange={draft.setLentOn}
          />

          {/* A photo of the slip, the transfer confirmation, or the note they
              wrote — the evidence people actually keep for these. */}
          <ImageUploader label="Photo" value={draft.imageUri} onChange={draft.setImageUri} />

          <Field
            label="Note"
            value={draft.note}
            onChangeText={draft.setNote}
            placeholder="What it was for"
            multiline
          />
        </>
      ) : null}
    </>
  );
}
