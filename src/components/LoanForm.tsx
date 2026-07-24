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

      {/* How far along the loan already is, so the schedule shows real progress
          rather than assuming it starts today. */}
      <Field
        label="Installments already paid"
        value={draft.paidInstallments}
        onChangeText={(paidInstallments) => update({ paidInstallments })}
        placeholder="0 for a new loan"
        keyboardType="numeric"
      />

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
  const selectedBank = banks.find((b) => b.id === selectedId);

  return (
    <View style={{ gap: space.sm }}>
      <Row justify="space-between" align="center">
        <Label>Lender</Label>
        {selectedBank ? (
          <T variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
            {selectedBank.name}
          </T>
        ) : (
          <T variant="caption" tone="muted">
            Choose a bank
          </T>
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
              <T
                variant="caption"
                color={selected ? colors.ink : colors.inkMuted}
                numberOfLines={1}
                style={{ fontWeight: selected ? '700' : '500' }}
              >
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
