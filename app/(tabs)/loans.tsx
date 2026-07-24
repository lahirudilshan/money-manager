import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SheetHeader } from '../../src/components/forms';
import {
  emptyLoanDraft,
  isLoanDraftValid,
  LoanForm,
  loanDraftToInput,
  type LoanDraft,
} from '../../src/components/LoanForm';
import {
  Divider,
  Empty,
  FundingBar,
  GradientButton,
  Label,
  PinnedFooter,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { buildSchedule } from '../../src/core/amortization';
import { formatMoney } from '../../src/core/money';
import { resolveBrand } from '../../src/data/banks';
import { selectLoanViews, useAppStore, type LoanView } from '../../src/store/useAppStore';
import { shadeHex } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function LoansScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const state = useAppStore();

  const views = useMemo(() => selectLoanViews(state), [state]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LoanDraft>(emptyLoanDraft);

  const totals = views.reduce(
    (acc, view) => ({
      monthly: acc.monthly + view.installmentMinor,
      outstanding: acc.outstanding + view.remainingMinor,
      interest: acc.interest + view.totalInterestMinor,
    }),
    { monthly: 0, outstanding: 0, interest: 0 },
  );

  function handleCreate() {
    if (!isLoanDraftValid(draft)) return;
    // Card faces use the lender's brand; `colors.pending` is the neutral
    // fallback for loans with no bank set.
    state.addLoan(loanDraftToInput(draft, colors.pending));
    setDraft(emptyLoanDraft);
    setOpen(false);
  }

  function confirmDeleteLoan(loanName: string, loanId: string) {
    Alert.alert(`Delete ${loanName}?`, 'This removes the loan and its schedule.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => state.deleteLoan(loanId) },
    ]);
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
        <Row justify="space-between" align="center">
          <View style={{ gap: 1 }}>
            <Label>DEBT</Label>
            <T variant="title">Loans</T>
          </View>
          {views.length > 0 ? (
            <Pressable
              onPress={() => setOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add loan"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingVertical: 8,
                paddingHorizontal: space.md,
                borderRadius: 999,
                backgroundColor: colors.pending,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="add" size={16} color="#FFFFFF" />
              <T variant="caption" color="#FFFFFF" style={{ fontWeight: '700' }}>
                Loan
              </T>
            </Pressable>
          ) : null}
        </Row>

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
              Summary hero focused on the two numbers that matter — what you
              still owe (the headline) and what leaves your account each month.
              Debt keeps its own warm hue rather than the app's brand gradient,
              which reads as "your money"; borrowing is a different kind of
              number and shouldn't wear that identity.
            */}
            <Surface
              style={{
                gap: space.lg,
                backgroundColor: colors.pendingSoft,
                borderColor: colors.pending,
              }}
            >
              <View style={{ gap: 2 }}>
                <Label color={colors.pending}>TOTAL OUTSTANDING</Label>
                <T variant="hero">{formatMoney(totals.outstanding)}</T>
              </View>
              <Divider style={{ backgroundColor: colors.hairlineStrong }} />
              <Row justify="space-between">
                <SummaryStat label="Per month" value={formatMoney(totals.monthly)} />
                <SummaryStat
                  label="Lifetime interest"
                  value={formatMoney(totals.interest, { compact: true })}
                  color={colors.pending}
                  align="flex-end"
                />
              </Row>
            </Surface>

            <Label>{views.length} ACTIVE LOAN{views.length === 1 ? '' : 'S'}</Label>

            {views.map((view) => (
              <LoanCard
                key={view.loan.id}
                view={view}
                onDelete={() => confirmDeleteLoan(view.loan.name, view.loan.id)}
              />
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: colors.canvas }}
        >
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <SheetHeader title="New loan" onClose={() => setOpen(false)} />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.lg, paddingTop: space.md, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <LoanForm draft={draft} onChange={setDraft} />
        </ScrollView>

        <PinnedFooter>
          <GradientButton
            label="Add loan"
            icon="add"
            onPress={handleCreate}
            disabled={!isLoanDraftValid(draft)}
          />
        </PinnedFooter>
        </KeyboardAvoidingView>
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

function LoanCard({ view, onDelete }: { view: LoanView; onDelete: () => void }) {
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
        {/* The three facts that define the loan, on one clean line. */}
        <Row justify="space-between">
          <CardStat label="Borrowed" value={formatMoney(loan.principalMinor, { compact: true })} />
          <CardStat label="Rate" value={`${loan.annualRatePct}%`} align="center" />
          <CardStat label="Term" value={`${loan.termMonths / 12} yr`} align="flex-end" />
        </Row>

        {/* Repayable breakdown — principal + interest, so the cost of
            borrowing is explicit rather than buried. */}
        <View
          style={{
            backgroundColor: colors.surfaceSunken,
            borderRadius: radius.md,
            padding: space.md,
            gap: space.xs,
          }}
        >
          <Row justify="space-between">
            <T variant="caption" tone="muted">
              Principal
            </T>
            <T variant="caption" tone="secondary">
              {formatMoney(loan.principalMinor)}
            </T>
          </Row>
          <Row justify="space-between">
            <T variant="caption" tone="muted">
              Interest
            </T>
            <T variant="caption" color={accent}>
              +{formatMoney(view.totalInterestMinor)}
            </T>
          </Row>
          <Divider />
          <Row justify="space-between">
            <T variant="small" style={{ fontWeight: '700' }}>
              Total repayable
            </T>
            <T variant="figure">
              {formatMoney(loan.principalMinor + view.totalInterestMinor)}
            </T>
          </Row>
        </View>

        {/* Schedule toggle + delete share one footer row. */}
        <Row>
          <Pressable
            onPress={() => setExpanded(!expanded)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingVertical: space.xs,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons
              name={expanded ? 'chevron-up' : 'calendar-outline'}
              size={14}
              color={colors.accent}
            />
            <T variant="caption" tone="accent" style={{ fontWeight: '700' }}>
              {expanded ? 'Hide schedule' : 'Payment schedule'}
            </T>
          </Pressable>

          <View style={{ width: 1, backgroundColor: colors.hairline, marginHorizontal: space.sm }} />

          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${loan.name}`}
            hitSlop={8}
            style={({ pressed }) => ({
              paddingHorizontal: space.sm,
              paddingVertical: space.xs,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Ionicons name="trash-outline" size={16} color={colors.inkMuted} />
          </Pressable>
        </Row>

        {expanded ? (
          <View style={{ gap: 4 }}>
            <Divider />
            <Row justify="space-between" style={{ paddingHorizontal: space.xs }}>
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
            {schedule.map((row, index) => (
              <Row
                key={row.period}
                justify="space-between"
                style={{
                  paddingVertical: 5,
                  paddingHorizontal: space.xs,
                  borderRadius: radius.sm,
                  backgroundColor: index % 2 === 0 ? colors.surfaceSunken : 'transparent',
                }}
              >
                <T variant="caption" tone="secondary" style={{ width: 28, fontWeight: '700' }}>
                  {row.period}
                </T>
                <T variant="caption" color={colors.completed} style={{ flex: 1, textAlign: 'right' }}>
                  {formatMoney(row.principalMinor, { showCurrency: false, compact: true })}
                </T>
                <T variant="caption" color={accent} style={{ flex: 1, textAlign: 'right' }}>
                  {formatMoney(row.interestMinor, { showCurrency: false, compact: true })}
                </T>
                <T variant="caption" tone="secondary" style={{ flex: 1.2, textAlign: 'right' }}>
                  {formatMoney(row.balanceMinor, { showCurrency: false, compact: true })}
                </T>
              </Row>
            ))}
            <T variant="caption" tone="muted" style={{ textAlign: 'center', paddingTop: space.xs }}>
              First 12 months
            </T>
          </View>
        ) : null}
      </View>
    </Surface>
  );
}

/** A labelled figure in a loan card's stat row. */
function CardStat({
  label,
  value,
  align = 'flex-start',
}: {
  label: string;
  value: string;
  align?: 'flex-start' | 'center' | 'flex-end';
}) {
  return (
    <View style={{ gap: 2, alignItems: align }}>
      <Label>{label}</Label>
      <T variant="figure">{value}</T>
    </View>
  );
}

/** A labelled figure in the loans summary hero. */
function SummaryStat({
  label,
  value,
  color,
  align = 'flex-start',
}: {
  label: string;
  value: string;
  color?: string;
  align?: 'flex-start' | 'flex-end';
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2, alignItems: align }}>
      <Label color={colors.pending}>{label}</Label>
      <T variant="figureLarge" color={color}>
        {value}
      </T>
    </View>
  );
}
