import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { buildSchedule } from '../core/amortization';
import { formatMoney, parseAmount } from '../core/money';
import { BANKS, bankById } from '../data/banks';
import type { NewLoan } from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';
import { BankLogo } from './BankLogo';
import { Field, PillSelect } from './forms';
import { Divider, Label, Row, Surface, Text } from './ui';

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
  /** How many installments have already been paid (0 = brand new loan). */
  paidInstallments: string;
}

export const emptyLoanDraft: LoanDraft = {
  name: '',
  kind: 'personal',
  bankId: null,
  amount: '',
  rate: '',
  years: '5',
  paidInstallments: '0',
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
  const termMonths = Math.round(Number.parseFloat(draft.years) * 12);
  // Clamp paid count to [0, term]; a blank field means a brand-new loan.
  const paid = Math.max(0, Math.min(termMonths, Math.round(Number.parseFloat(draft.paidInstallments) || 0)));
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    bankId: draft.bankId,
    principalMinor: parseAmount(draft.amount) ?? 0,
    annualRatePct: Number.parseFloat(draft.rate),
    termMonths,
    // Back-date the start so "paid installments" months have already elapsed —
    // this keeps the schedule's paid/remaining split correct without a separate
    // per-installment ledger.
    startDate: (() => {
      const start = new Date();
      start.setMonth(start.getMonth() - paid);
      return start;
    })(),
    paidInstallments: paid,
    color: fallbackColor,
    isActive: true,
  };
}

/** Common loan terms in Sri Lanka, so the usual case is one tap, not typing. */
const TERM_PRESETS = [1, 3, 5, 7, 10];

/**
 * The shared new-loan form — used by both the Loans tab and onboarding so the
 * two can never drift apart.
 *
 * Organised as three numbered questions rather than a flat stack of inputs,
 * because a loan is genuinely three separate decisions and a wall of eight
 * fields reads as homework:
 *
 *   1. Who lent it to you?   lender + type, which together name the loan
 *   2. How much, and on what terms?   amount, rate, term
 *   3. How far along are you?   installments already paid
 *
 * Each section explains *why* it is asked and what the field means (a rate is
 * "annual, as the bank quotes it"), and the live installment preview sits at
 * the end so the numbers can be sanity-checked before saving.
 */
export function LoanForm({
  draft,
  onChange,
}: {
  draft: LoanDraft;
  onChange: (next: LoanDraft) => void;
}) {
  const { colors, space } = useTheme();
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

  const years = Number.parseFloat(draft.years);
  const termMonths = Number.isFinite(years) && years > 0 ? Math.round(years * 12) : 0;
  const paid = Math.round(Number.parseFloat(draft.paidInstallments) || 0);

  return (
    <>
      {/* 1 — who it's with. Lender and type together name the loan, so the
          name field sits here rather than floating at the top. */}
      <FormSection
        n={1}
        title="Who is the loan with?"
        hint="Pick your lender and what kind of loan it is — we’ll name it for you."
      >
        <BankPicker selectedId={draft.bankId} onSelect={(bankId) => update({ bankId })} />

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
      </FormSection>

      {/* 2 — the money. Amount, rate and term are what actually drive the
          installment, so they are grouped and the term offers presets. */}
      <FormSection
        n={2}
        title="How much, and for how long?"
        hint="Enter the amount you borrowed — not what’s left to pay. We work out the rest."
      >
        <Field
          label="Loan amount"
          value={draft.amount}
          onChangeText={(amount) => update({ amount })}
          placeholder="e.g. 7,200,000"
          keyboardType="numeric"
        />

        <Field
          label="Annual interest rate %"
          value={draft.rate}
          onChangeText={(rate) => update({ rate })}
          placeholder="11.5"
          keyboardType="decimal-pad"
        />
        <Text variant="caption" tone="muted" style={{ marginTop: -space.xs }}>
          The yearly rate as the bank quotes it — not the monthly one.
        </Text>

        <View style={{ gap: space.sm }}>
          <Row justify="space-between" align="center">
            <Label>Term</Label>
            {termMonths > 0 ? (
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                {termMonths} months
              </Text>
            ) : null}
          </Row>
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            {TERM_PRESETS.map((preset) => {
              const selected = Number.parseFloat(draft.years) === preset;
              return (
                <Pressable
                  key={preset}
                  onPress={() => update({ years: String(preset) })}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${preset} years`}
                  style={({ pressed }) => ({
                    paddingHorizontal: space.md,
                    paddingVertical: 9,
                    borderRadius: 999,
                    borderWidth: 1.5,
                    borderColor: selected ? colors.accent : colors.hairline,
                    backgroundColor: selected ? colors.accentSoft : colors.surface,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Text
                    variant="small"
                    color={selected ? colors.accent : colors.inkSecondary}
                    style={{ fontWeight: selected ? '700' : '500' }}
                  >
                    {preset} yr
                  </Text>
                </Pressable>
              );
            })}
          </Row>
          <Field
            label="Or enter years"
            value={draft.years}
            onChangeText={(next) => update({ years: next })}
            placeholder="5"
            keyboardType="decimal-pad"
          />
        </View>
      </FormSection>

      {/* 3 — progress so far, so the schedule reflects reality instead of
          assuming every loan starts today. */}
      <FormSection
        n={3}
        title="How far along are you?"
        hint="Leave this at 0 if the loan is brand new."
      >
        <Field
          label="Installments already paid"
          value={draft.paidInstallments}
          onChangeText={(paidInstallments) => update({ paidInstallments })}
          placeholder="0"
          keyboardType="numeric"
        />
        {termMonths > 0 && paid > 0 ? (
          <Text variant="caption" tone="muted">
            {paid >= termMonths
              ? 'That’s the whole term — this loan would be fully paid.'
              : `${termMonths - paid} of ${termMonths} installments left to pay.`}
          </Text>
        ) : null}
      </FormSection>

      <LoanPreview amount={draft.amount} rate={draft.rate} years={draft.years} />
    </>
  );
}

/** A numbered question block — the skeleton every section of the form uses. */
function FormSection({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const { colors, space } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 3 }}>
        <Row gap={space.sm}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="caption" color={colors.accent} style={{ fontWeight: '800' }}>
              {n}
            </Text>
          </View>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {title}
          </Text>
        </Row>
        <Text variant="caption" tone="muted" style={{ paddingLeft: 22 + space.sm }}>
          {hint}
        </Text>
      </View>
      {children}
    </View>
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
  const selectedBank = banks.find((b) => b.id === selectedId);

  return (
    <View style={{ gap: space.sm }}>
      <Row justify="space-between" align="center">
        <Label>Lender</Label>
        {selectedBank ? (
          <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
            {selectedBank.name}
          </Text>
        ) : (
          <Text variant="caption" tone="muted">
            Choose a bank
          </Text>
        )}
      </Row>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm, paddingRight: space.lg, paddingVertical: 2 }}
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
                width: 72,
                alignItems: 'center',
                gap: 6,
                paddingVertical: space.sm,
                paddingHorizontal: 4,
                borderRadius: radius.lg,
                borderWidth: 1.5,
                borderColor: selected ? brand.color : colors.hairline,
                backgroundColor: selected ? `${brand.color}12` : colors.surface,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View>
                <BankLogo brand={brand} size={40} />
                {selected ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      backgroundColor: brand.color,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 2,
                      borderColor: colors.surface,
                    }}
                  >
                    <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              <Text
                variant="caption"
                color={selected ? colors.ink : colors.inkMuted}
                numberOfLines={1}
                style={{ fontWeight: selected ? '700' : '500' }}
              >
                {brand.shortName}
              </Text>
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

  const totalPayable = principal + summary.totalInterestMinor;

  return (
    <Surface style={{ gap: space.md, backgroundColor: colors.accentSoft }}>
      {/* The installment is what the user actually feels each month, so it
          leads as the headline figure rather than sitting in a list. */}
      <View style={{ gap: 2 }}>
        <Label>YOU’LL PAY EACH MONTH</Label>
        <Text variant="hero" color={colors.ink}>
          {formatMoney(summary.installmentMinor)}
        </Text>
      </View>

      <Divider />

      <Row justify="space-between">
        <Text variant="small" tone="secondary">
          Total interest
        </Text>
        <Text variant="figure" color={colors.pending}>
          {formatMoney(summary.totalInterestMinor)}
        </Text>
      </Row>
      <Row justify="space-between">
        <Text variant="small" tone="secondary">
          Total you repay
        </Text>
        <Text variant="figure">{formatMoney(totalPayable)}</Text>
      </Row>
    </Surface>
  );
}
