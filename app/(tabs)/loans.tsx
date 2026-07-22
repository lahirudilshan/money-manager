import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import { BankLogo } from '../../src/components/BankLogo';
import {
  Button,
  Divider,
  Empty,
  FundingBar,
  Label,
  Row,
  ScreenHeader,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { buildSchedule } from '../../src/core/amortization';
import { formatMoney, parseAmount } from '../../src/core/money';
import { BANKS, resolveBrand } from '../../src/data/banks';
import { selectLoanViews, useAppStore, type LoanView } from '../../src/store/useAppStore';
import { shadeHex } from '../../src/theme';
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
  const [bankId, setBankId] = useState<string | null>(null);
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
      bankId,
      principalMinor: principal,
      annualRatePct: annualRate,
      termMonths: Math.round(termYears * 12),
      startDate: new Date(),
      // Card faces use the lender's brand; this stays as the neutral fallback
      // for loans with no bank set.
      color: colors.pending,
      isActive: true,
    });

    setName('');
    setBankId(null);
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
          <BankPicker selectedId={bankId} onSelect={setBankId} />
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

const LOAN_KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  personal: 'person-outline',
  lease: 'car-outline',
  mortgage: 'home-outline',
  other: 'ellipsis-horizontal',
};

function LoanCard({ view }: { view: LoanView }) {
  const { colors, radius, space } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { loan } = view;

  // The lender's brand identifies the loan — you recognise "the HNB lease"
  // by its bank, not by a generic debt colour. Interest figures below still
  // use the theme's debt hue so the *numbers* keep one consistent meaning.
  const brand = resolveBrand({ bankId: loan.bankId, name: loan.name });
  const accent = colors.pending;

  const schedule = expanded
    ? buildSchedule({
        principalMinor: loan.principalMinor,
        annualRatePct: loan.annualRatePct,
        termMonths: loan.termMonths,
      }).schedule.slice(0, 12)
    : [];

  return (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      {/* Branded header: the lender's colours carry the loan's identity. */}
      <LinearGradient
        colors={[brand.color, shadeHex(brand.color, -0.3)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: space.lg, gap: space.md }}
      >
        <Row>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: radius.md,
              backgroundColor:
                brand.onColor === '#FFFFFF' ? 'rgba(255,255,255,0.2)' : 'rgba(16,24,40,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={LOAN_KIND_ICON[loan.kind] ?? 'card-outline'}
              size={21}
              color={brand.onColor}
            />
          </View>

          <View style={{ flex: 1, gap: 1 }}>
            <T variant="heading" color={brand.onColor} numberOfLines={1}>
              {loan.name}
            </T>
            <T
              variant="caption"
              color={brand.onColor}
              numberOfLines={1}
              style={{ opacity: 0.85 }}
            >
              {loan.bankId ? brand.name : loan.kind}
            </T>
          </View>

          <View style={{ alignItems: 'flex-end', gap: 1 }}>
            <T variant="figureLarge" color={brand.onColor}>
              {formatMoney(view.installmentMinor)}
            </T>
            <T variant="caption" color={brand.onColor} style={{ opacity: 0.8 }}>
              / month
            </T>
          </View>
        </Row>

        {/* Payoff progress, drawn on the brand rather than the surface. */}
        <View style={{ gap: space.xs }}>
          <View
            style={{
              height: 7,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor:
                brand.onColor === '#FFFFFF' ? 'rgba(255,255,255,0.25)' : 'rgba(16,24,40,0.15)',
            }}
          >
            <View
              style={{
                width: `${Math.max(0, Math.min(100, view.progressPct))}%`,
                height: '100%',
                borderRadius: 999,
                backgroundColor: brand.onColor,
              }}
            />
          </View>
          <Row justify="space-between">
            <T variant="caption" color={brand.onColor} style={{ opacity: 0.85 }}>
              {view.paidCount} of {loan.termMonths} payments made
            </T>
            <T variant="caption" color={brand.onColor} style={{ fontWeight: '700' }}>
              {formatMoney(view.remainingMinor, { compact: true })} left
            </T>
          </Row>
        </View>
      </LinearGradient>

      <View style={{ padding: space.lg, gap: space.md }}>
        {/* Key figures as a clean 2x2 grid, so the loan's shape reads at a
            glance rather than as a run-on caption. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <KeyFigure
            label="Borrowed"
            value={formatMoney(loan.principalMinor, { compact: true })}
          />
          <KeyFigure label="Rate" value={`${loan.annualRatePct}%`} />
          <KeyFigure label="Term" value={`${loan.termMonths / 12} yr`} />
          <KeyFigure
            label="Total interest"
            value={formatMoney(view.totalInterestMinor, { compact: true })}
            color={accent}
          />
        </View>

        <Divider />

        <Row justify="space-between">
          <T variant="small" tone="secondary">
            Total repayable
          </T>
          <T variant="figure">
            {formatMoney(loan.principalMinor + view.totalInterestMinor)}
          </T>
        </Row>

        {/* One tap reveals the amortization schedule — hidden by default. */}
        <Pressable
          onPress={() => setExpanded(!expanded)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Row gap={4} justify="center">
            <T variant="caption" tone="accent" style={{ fontWeight: '700' }}>
              {expanded ? 'Hide schedule' : 'Payment schedule'}
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
            <Divider />
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
                  color={accent}
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
      </View>
    </Surface>
  );
}

/** A labelled figure occupying half the row — the loan key-figures grid cell. */
function KeyFigure({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const { space } = useTheme();
  return (
    <View style={{ width: '50%', paddingVertical: space.xs, gap: 1 }}>
      <Label>{label}</Label>
      <T variant="figure" color={color}>
        {value}
      </T>
    </View>
  );
}

/** Horizontal strip of lender brands for the loan sheet. */
function BankPicker({
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
