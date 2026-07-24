import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { buildSchedule } from '../core/amortization';
import { formatMoney, parseAmount } from '../core/money';
import { BANKS, bankById } from '../data/banks';
import type { NewLoan } from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';
import { BankLogo } from './BankLogo';
import { Field, PillSelect } from './forms';
import { Divider, Label, Row, Surface, T } from './ui';

export const LOAN_KINDS = [
  { key: 'personal', label: 'Personal', icon: 'person-outline' as const },
  { key: 'lease', label: 'Lease', icon: 'car-outline' as const },
  { key: 'mortgage', label: 'Mortgage', icon: 'home-outline' as const },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal' as const },
];

export type LoanKind = 'personal' | 'lease' | 'mortgage' | 'other';

/** Everything the form collects, ready to hand to `addLoan`. */
export interface LoanDraft {
  name: string;
  kind: LoanKind;
  bankId: string | null;
  amount: string;
  rate: string;
  years: string;
}

export const emptyLoanDraft: LoanDraft = {
  name: '',
  kind: 'personal',
  bankId: null,
  amount: '',
  rate: '',
  years: '5',
};

/**
 * A loan's suggested name from its lender and kind — "HNB Lease", "BOC
 * Personal loan". Saves typing the obvious thing, while staying editable.
 */
export function suggestLoanName(bankId: string | null, kind: LoanKind): string {
  const brand = bankById(bankId);
  if (!brand) return '';
  const kindLabel =
    kind === 'personal'
      ? 'Personal loan'
      : kind === 'lease'
        ? 'Lease'
        : kind === 'mortgage'
          ? 'Mortgage'
          : 'Loan';
  return `${brand.shortName} ${kindLabel}`;
}

/** True once the draft has everything `addLoan` needs. */
export function isLoanDraftValid(draft: LoanDraft): boolean {
  const principal = parseAmount(draft.amount);
  const rate = Number.parseFloat(draft.rate);
  const years = Number.parseFloat(draft.years);
  return Boolean(
    draft.name.trim() &&
      principal &&
      principal > 0 &&
      Number.isFinite(rate) &&
      Number.isFinite(years) &&
      years > 0,
  );
}

/** Convert a validated draft into the shape `addLoan` expects. */
export function loanDraftToInput(draft: LoanDraft, fallbackColor: string): Omit<NewLoan, 'id'> {
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    bankId: draft.bankId,
    principalMinor: parseAmount(draft.amount) ?? 0,
    annualRatePct: Number.parseFloat(draft.rate),
    termMonths: Math.round(Number.parseFloat(draft.years) * 12),
    startDate: new Date(),
    color: fallbackColor,
    isActive: true,
  };
}

/**
 * The shared new-loan form — lender, type, amount, rate, term, plus a live
 * installment preview. Used by both the Loans tab and onboarding so the two
 * can never drift apart.
 *
 * Picking a lender or type autofills the name (until the user types their
 * own), which is the common case: you think "my HNB lease", not a label you
 * have to invent.
 */
export function LoanForm({
  draft,
  onChange,
}: {
  draft: LoanDraft;
  onChange: (next: LoanDraft) => void;
}) {
  const { space } = useTheme();
  // Once the user edits the name themselves, stop overwriting it.
  const [nameTouched, setNameTouched] = useState(false);

  function update(patch: Partial<LoanDraft>) {
    const next = { ...draft, ...patch };

    // Re-suggest the name whenever lender/type changes and the user hasn't
    // taken control of the field.
    if ((patch.bankId !== undefined || patch.kind !== undefined) && !nameTouched) {
      const suggested = suggestLoanName(next.bankId, next.kind);
      if (suggested) next.name = suggested;
    }

    onChange(next);
  }

  return (
    <>
      <BankPicker
        selectedId={draft.bankId}
        onSelect={(bankId) => update({ bankId })}
      />

      <PillSelect
        label="Type"
        options={LOAN_KINDS}
        selectedKey={draft.kind}
        onSelect={(key) => update({ kind: key as LoanKind })}
      />

      <Field
        label="Name"
        value={draft.name}
        onChangeText={(name) => {
          setNameTouched(true);
          onChange({ ...draft, name });
        }}
        placeholder="e.g. HNB Lease"
      />

      <Field
        label="Loan amount"
        value={draft.amount}
        onChangeText={(amount) => update({ amount })}
        placeholder="e.g. 7200000"
        keyboardType="numeric"
      />

      <Row gap={space.md}>
        <Field
          label="Annual rate %"
          value={draft.rate}
          onChangeText={(rate) => update({ rate })}
          placeholder="11.5"
          keyboardType="decimal-pad"
          style={{ flex: 1 }}
        />
        <Field
          label="Years"
          value={draft.years}
          onChangeText={(years) => update({ years })}
          placeholder="5"
          keyboardType="decimal-pad"
          style={{ flex: 1 }}
        />
      </Row>

      <LoanPreview amount={draft.amount} rate={draft.rate} years={draft.years} />
    </>
  );
}

/** Horizontal strip of lender brands. */
export function BankPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { colors, radius, space } = useTheme();
  const banks = BANKS.filter((bank) => bank.kind === 'bank');

  return (
    <View style={{ gap: space.sm }}>
      <Label>LENDER</Label>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
      >
        {banks.map((brand) => {
          const selected = selectedId === brand.id;
          return (
            <Pressable
              key={brand.id}
              onPress={() => onSelect(selected ? null : brand.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={brand.name}
              style={({ pressed }) => ({
                alignItems: 'center',
                gap: 4,
                padding: 4,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: selected ? colors.ink : 'transparent',
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <BankLogo brand={brand} size={44} />
              <T variant="caption" tone={selected ? 'ink' : 'muted'} numberOfLines={1}>
                {brand.shortName}
              </T>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Live installment/interest preview for the entered terms. */
export function LoanPreview({
  amount,
  rate,
  years,
}: {
  amount: string;
  rate: string;
  years: string;
}) {
  const { colors, space } = useTheme();
  const principal = parseAmount(amount);
  const annualRate = Number.parseFloat(rate);
  const termYears = Number.parseFloat(years);

  if (!principal || !Number.isFinite(annualRate) || !Number.isFinite(termYears) || termYears <= 0) {
    return null;
  }

  const summary = buildSchedule({
    principalMinor: principal,
    annualRatePct: annualRate,
    termMonths: Math.round(termYears * 12),
  });

  return (
    <Surface style={{ gap: space.sm, backgroundColor: colors.accentSoft }}>
      <Label>PREVIEW</Label>
      <Row justify="space-between">
        <T variant="small">Monthly installment</T>
        <T variant="figure">{formatMoney(summary.installmentMinor)}</T>
      </Row>
      <Divider />
      <Row justify="space-between">
        <T variant="small">Total interest</T>
        <T variant="figure" color={colors.pending}>
          {formatMoney(summary.totalInterestMinor)}
        </T>
      </Row>
    </Surface>
  );
}
