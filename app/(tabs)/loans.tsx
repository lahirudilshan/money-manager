import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import {
  Button,
  Divider,
  Empty,
  FundingBar,
  Glyph,
  Label,
  Row,
  ScreenHeader,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { buildSchedule } from '../../src/core/amortization';
import { formatMoney, parseAmount } from '../../src/core/money';
import { selectLoanViews, useAppStore, type LoanView } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

const LOAN_KINDS = [
  { key: 'personal', label: 'Personal', icon: 'person-outline' as const },
  { key: 'lease', label: 'Lease', icon: 'car-outline' as const },
  { key: 'mortgage', label: 'Mortgage', icon: 'home-outline' as const },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal' as const },
];

type LoanKind = 'personal' | 'lease' | 'mortgage' | 'other';

export default function LoansScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const state = useAppStore();

  const views = useMemo(() => selectLoanViews(state), [state]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LoanKind>('personal');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [years, setYears] = useState('5');

  const totals = views.reduce(
    (acc, view) => ({
      monthly: acc.monthly + view.installmentMinor,
      outstanding: acc.outstanding + view.remainingMinor,
      interest: acc.interest + view.totalInterestMinor,
    }),
    { monthly: 0, outstanding: 0, interest: 0 },
  );

  function handleCreate() {
    const principal = parseAmount(amount);
    const annualRate = Number.parseFloat(rate);
    const termYears = Number.parseFloat(years);
    if (!name.trim() || !principal || !Number.isFinite(annualRate) || !Number.isFinite(termYears)) {
      return;
    }

    state.addLoan({
      name: name.trim(),
      kind,
      principalMinor: principal,
      annualRatePct: annualRate,
      termMonths: Math.round(termYears * 12),
      startDate: new Date(),
      color: '#EB6834',
      isActive: true,
    });

    setName('');
    setAmount('');
    setRate('');
    setYears('5');
    setOpen(false);
  }

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingBottom: tabClearance,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="DEBT"
          title="Loans"
          action={{ icon: 'add', onPress: () => setOpen(true), label: 'Add loan' }}
        />

        {views.length === 0 ? (
          <Empty
            icon="trending-down-outline"
            title="No loans"
            message="Add a loan to see its installment, interest and payoff progress."
            actionLabel="Add a loan"
            onAction={() => setOpen(true)}
          />
        ) : (
          <>
            {/*
              Debt gets its own warm tint rather than the app's blue/teal
              gradient — that gradient reads as "your money, your plan";
              borrowing is a different kind of number and should not borrow
              that identity.
            */}
            <Surface style={{ gap: space.lg, backgroundColor: colors.pendingSoft, borderColor: colors.pending }}>
              <Row justify="space-between" align="flex-start">
                <View style={{ gap: 2 }}>
                  <Label color={colors.pending}>MONTHLY</Label>
                  <T variant="display">{formatMoney(totals.monthly)}</T>
                </View>
              </Row>
              <Divider style={{ backgroundColor: colors.hairlineStrong }} />
              <Row justify="space-between">
                <View style={{ gap: 2 }}>
                  <Label color={colors.pending}>OUTSTANDING</Label>
                  <T variant="figureLarge">
                    {formatMoney(totals.outstanding, { compact: true })}
                  </T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Label color={colors.pending}>LIFETIME INTEREST</Label>
                  <T variant="figureLarge" color={colors.pending}>
                    {formatMoney(totals.interest, { compact: true })}
                  </T>
                </View>
              </Row>
            </Surface>

            {views.map((view) => (
              <LoanCard key={view.loan.id} view={view} />
            ))}
          </>
        )}
      </ScrollView>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.canvas }}
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <SheetHeader title="New loan" onClose={() => setOpen(false)} />
          <Field label="Name" value={name} onChangeText={setName} autoFocus />
          <PillSelect
            label="Type"
            options={LOAN_KINDS}
            selectedKey={kind}
            onSelect={(key) => setKind(key as LoanKind)}
          />
          <Field
            label="Loan amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="e.g. 7200000"
            keyboardType="numeric"
          />
          <Row gap={space.md}>
            <Field
              label="Annual rate %"
              value={rate}
              onChangeText={setRate}
              placeholder="11.5"
              keyboardType="decimal-pad"
              style={{ flex: 1 }}
            />
            <Field
              label="Years"
              value={years}
              onChangeText={setYears}
              placeholder="5"
              keyboardType="decimal-pad"
              style={{ flex: 1 }}
            />
          </Row>
          <LoanPreview amount={amount} rate={rate} years={years} />
          <Button label="Add loan" onPress={handleCreate} disabled={!name.trim()} />
        </ScrollView>
      </Modal>
    </>
  );
}

function LoanCard({ view }: { view: LoanView }) {
  const { colors, space } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { loan } = view;

  const schedule = expanded
    ? buildSchedule({
        principalMinor: loan.principalMinor,
        annualRatePct: loan.annualRatePct,
        termMonths: loan.termMonths,
      }).schedule.slice(0, 12)
    : [];

  return (
    <Surface style={{ gap: space.md }}>
      <Row>
        <Glyph icon="card-outline" color={loan.color} />
        <View style={{ flex: 1, gap: 1 }}>
          <T variant="heading">{loan.name}</T>
          <T variant="caption" tone="muted">
            {formatMoney(loan.principalMinor, { compact: true })} · {loan.annualRatePct}% ·{' '}
            {loan.termMonths / 12}y
          </T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 1 }}>
          <T variant="figureLarge">{formatMoney(view.installmentMinor)}</T>
          <T variant="caption" tone="muted">
            monthly
          </T>
        </View>
      </Row>

      <View style={{ gap: space.xs }}>
        <FundingBar pct={view.progressPct} color={loan.color} />
        <Row justify="space-between">
          <T variant="caption" tone="muted">
            {view.paidCount} of {loan.termMonths} paid
          </T>
          <T variant="caption" tone="muted">
            {formatMoney(view.remainingMinor, { compact: true })} left
          </T>
        </Row>
      </View>

      <Divider />

      <Row justify="space-between">
        <View>
          <Label>TOTAL INTEREST</Label>
          <T variant="figure" color={colors.pending}>
            {formatMoney(view.totalInterestMinor)}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Label>TOTAL REPAYABLE</Label>
          <T variant="figure">
            {formatMoney(loan.principalMinor + view.totalInterestMinor)}
          </T>
        </View>
      </Row>

      <Pressable
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={{ paddingTop: space.xs }}
      >
        <Row gap={4} justify="center">
          <T variant="caption" tone="accent">
            {expanded ? 'Hide schedule' : 'View first year'}
          </T>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={13}
            color={colors.accent}
          />
        </Row>
      </Pressable>

      {expanded ? (
        <View style={{ gap: 2 }}>
          <Row justify="space-between">
            <T variant="caption" tone="muted" style={{ width: 28 }}>
              #
            </T>
            <T variant="caption" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
              PRINCIPAL
            </T>
            <T variant="caption" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
              INTEREST
            </T>
            <T variant="caption" tone="muted" style={{ flex: 1.2, textAlign: 'right' }}>
              BALANCE
            </T>
          </Row>
          <Divider />
          {schedule.map((row) => (
            <Row key={row.period} justify="space-between" style={{ paddingVertical: 2 }}>
              <T variant="caption" tone="muted" style={{ width: 28 }}>
                {row.period}
              </T>
              <T
                variant="caption"
                color={colors.completed}
                style={{ flex: 1, textAlign: 'right' }}
              >
                {formatMoney(row.principalMinor, { showCurrency: false, compact: true })}
              </T>
              <T
                variant="caption"
                color={colors.pending}
                style={{ flex: 1, textAlign: 'right' }}
              >
                {formatMoney(row.interestMinor, { showCurrency: false, compact: true })}
              </T>
              <T
                variant="caption"
                tone="secondary"
                style={{ flex: 1.2, textAlign: 'right' }}
              >
                {formatMoney(row.balanceMinor, { showCurrency: false, compact: true })}
              </T>
            </Row>
          ))}
        </View>
      ) : null}
    </Surface>
  );
}

function LoanPreview({
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

  if (!principal || !Number.isFinite(annualRate) || !Number.isFinite(termYears)) return null;

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
      <Row justify="space-between">
        <T variant="small">Total interest</T>
        <T variant="figure" color={colors.pending}>
          {formatMoney(summary.totalInterestMinor)}
        </T>
      </Row>
    </Surface>
  );
}
