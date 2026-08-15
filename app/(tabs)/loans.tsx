import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  emptyLoanDraft,
  isLoanDraftValid,
  LoanForm,
  loanDraftFrom,
  loanDraftToInput,
  type LoanDraft,
} from '../../src/components/LoanForm';
import { BottomSheet, Divider, FundingBar, GradientButton, Label, Row, Surface, Text } from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { buildSchedule } from '../../src/core/amortization';
import { formatMoney } from '../../src/core/money';
import { useBrand } from '../../src/hooks/useBrand';
import { selectLoanViews, useAppStore, type LoanView } from '../../src/store/useAppStore';
import { shadeHex } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function LoansScreen() {
  const { colors, radius, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const state = useAppStore();

  const views = useMemo(() => selectLoanViews(state), [state]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LoanDraft>(emptyLoanDraft);
  /**
   * Which loan the sheet is editing, or null when it is adding a new one.
   *
   * Onboarding step 5 gained this first; the Loans tab kept only add and
   * delete, so a rate typed wrong on a loan added last month could be corrected
   * only by deleting it — which also destroys its board line and the payment
   * history attached to it. The sheet is the same either way; only what the
   * footer button does differs.
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  const totals = views.reduce(
    (acc, view) => ({
      monthly: acc.monthly + view.installmentMinor,
      outstanding: acc.outstanding + view.remainingMinor,
      interest: acc.interest + view.totalInterestMinor,
    }),
    { monthly: 0, outstanding: 0, interest: 0 },
  );

  function handleSave() {
    if (!isLoanDraftValid(draft)) return;
    // Card faces use the lender's brand; `colors.pending` is the neutral
    // fallback for loans with no bank set.
    const input = loanDraftToInput(draft, colors.pending);

    if (editingId) {
      // `updateLoan` re-derives the board line's installment from the new
      // terms — the figure is never stored, so editing a rate has to rewrite
      // the bill or the plan quietly funds the old amount.
      state.updateLoan(editingId, input);
    } else {
      state.addLoan(input);
    }

    setDraft(emptyLoanDraft);
    setEditingId(null);
    setOpen(false);
  }

  function openNewLoan() {
    setEditingId(null);
    setDraft(emptyLoanDraft);
    setOpen(true);
  }

  function openEditLoan(view: LoanView) {
    setEditingId(view.loan.id);
    setDraft(loanDraftFrom(view.loan));
    setOpen(true);
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
            <Text variant="title">Loans</Text>
          </View>
          {views.length > 0 ? (
            <Pressable
              onPress={openNewLoan}
              accessibilityRole="button"
              accessibilityLabel="Add loan"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingVertical: 8,
                paddingHorizontal: space.md,
                borderRadius: 999,
                backgroundColor: '#A21D6B',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="add" size={16} color="#FFFFFF" />
              <Text variant="caption" color="#FFFFFF" style={{ fontWeight: '700' }}>
                Loan
              </Text>
            </Pressable>
          ) : null}
        </Row>

        {views.length === 0 ? (
          <LoansEmptyState onAdd={openNewLoan} />
        ) : (
          <>
            {/*
              Summary hero focused on what you still owe (the headline) and what
              leaves your account each month. A deep warm gradient reads as debt
              — a different kind of number from the app's own money — while still
              feeling premium rather than a flat warning panel.
            */}
            <View
              style={{ borderRadius: radius.xl, overflow: 'hidden' }}
            >
              <LinearGradient
                colors={['#A21D6B', '#6D1349']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: space.xl, gap: space.lg }}
              >
                <View style={{ gap: 2 }}>
                  <Label color="rgba(255,255,255,0.75)">TOTAL OUTSTANDING</Label>
                  <Text variant="hero" color="#FFFFFF">
                    {formatMoney(totals.outstanding)}
                  </Text>
                </View>
                <Divider style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />
                <Row justify="space-between">
                  <View style={{ gap: 2 }}>
                    <Label color="rgba(255,255,255,0.65)">PER MONTH</Label>
                    <Text variant="figureLarge" color="#FFFFFF">
                      {formatMoney(totals.monthly, { compact: true })}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Label color="rgba(255,255,255,0.65)">LIFETIME INTEREST</Label>
                    <Text variant="figureLarge" color="#FFFFFF">
                      {formatMoney(totals.interest, { compact: true })}
                    </Text>
                  </View>
                </Row>
              </LinearGradient>
            </View>

            <Label>{views.length} ACTIVE LOAN{views.length === 1 ? '' : 'S'}</Label>

            {views.map((view) => (
              <LoanCard
                key={view.loan.id}
                view={view}
                onEdit={() => openEditLoan(view)}
                onDelete={() => confirmDeleteLoan(view.loan.name, view.loan.id)}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* One sheet for both adding and editing — the fields are identical, so
          a second sheet could only drift out of step with this one. */}
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Edit loan' : 'New loan'}
        icon="cash-outline"
        iconColor={colors.pending}
        scroll
        footer={
          <GradientButton
            label={editingId ? 'Save changes' : 'Add loan'}
            icon="checkmark"
            onPress={handleSave}
            disabled={!isLoanDraftValid(draft)}
          />
        }
      >
          <LoanForm draft={draft} onChange={setDraft} />
      </BottomSheet>
    </>
  );
}

const LOAN_KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  personal: 'person-outline',
  lease: 'car-outline',
  mortgage: 'home-outline',
  other: 'ellipsis-horizontal',
};

/**
 * First run on the Loans tab.
 *
 * The generic `Empty` — a grey glyph and a ghost button — says a loan can be
 * added but nothing about why it is worth doing, and this screen is the one
 * place in the app a user has to enter data they already know by heart from a
 * bank statement. So it names what they get back for the typing: the three
 * figures the loan card will show once there is one.
 */
function LoansEmptyState({ onAdd }: { onAdd: () => void }) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.lg, paddingTop: space.xl }}>
      <View style={{ alignItems: 'center', gap: space.md }}>
        <View
          style={{
            width: 76,
            height: 76,
            borderRadius: 38,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.dangerSoft,
          }}
        >
          <Ionicons name="trending-down" size={34} color={colors.danger} />
        </View>

        <View style={{ gap: 4, alignItems: 'center' }}>
          <Text variant="title">No loans yet</Text>
          <Text variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
            Add one and its monthly installment joins the plan automatically, so what you owe is
            budgeted rather than remembered.
          </Text>
        </View>
      </View>

      {/* What the card will show — concrete enough to be worth the typing. */}
      <Surface style={{ gap: space.md }}>
        <Benefit
          icon="calendar-outline"
          title="Every installment, scheduled"
          body="The monthly amount appears as a bill in your plan, on its due day."
        />
        <Divider />
        <Benefit
          icon="pie-chart-outline"
          title="Interest split out"
          body="See how much of each payment clears the balance and how much is interest."
        />
        <Divider />
        <Benefit
          icon="flag-outline"
          title="Payoff date"
          body="Track how many installments are left and when the debt actually ends."
        />
      </Surface>

      <GradientButton label="Add your first loan" icon="add" onPress={onAdd} />

      <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        You will need the amount borrowed, the rate, and the term — all on your loan statement.
      </Text>
    </View>
  );
}

/** One "here is what you get" row in the empty state. */
function Benefit({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <Row gap={space.md} align="flex-start">
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <Ionicons name={icon} size={17} color={colors.inkSecondary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small" style={{ fontWeight: '700' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted">
          {body}
        </Text>
      </View>
    </Row>
  );
}

function LoanCard({
  view,
  onEdit,
  onDelete,
}: {
  view: LoanView;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const [expanded, setExpanded] = useState(false);
  // Which year of the schedule is on screen — the plan paginates by year so a
  // long loan is a few taps rather than a giant scroll. Defaults to the year
  // the next payment falls in, so you land on "where you are".
  const [year, setYear] = useState(Math.floor(view.paidCount / 12) + 1);
  const { loan } = view;

  const brand = useBrand({ bankId: loan.bankId, name: loan.name });
  const accent = colors.pending;

  const totalYears = Math.ceil(loan.termMonths / 12);
  // Full schedule (built when expanded); we then slice to the selected year's
  // 12-month window so only ~12 rows render at a time.
  const fullSchedule = expanded
    ? buildSchedule({
        principalMinor: loan.principalMinor,
        annualRatePct: loan.annualRatePct,
        termMonths: loan.termMonths,
        // A flat loan's rows carry the same interest every month; a reducing
        // one's fall as the balance does. Passing the method is what makes the
        // schedule show the borrower's actual split.
        interestMethod: loan.interestMethod,
      }).schedule
    : [];
  const schedule = fullSchedule.filter(
    (row) => row.period > (year - 1) * 12 && row.period <= year * 12,
  );

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
            <Text variant="heading" color={brand.onColor} numberOfLines={1}>
              {loan.name}
            </Text>
            <Text
              variant="caption"
              color={brand.onColor}
              numberOfLines={1}
              style={{ opacity: 0.85 }}
            >
              {loan.bankId ? brand.name : loan.kind}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end', gap: 1 }}>
            <Text variant="figureLarge" color={brand.onColor}>
              {formatMoney(view.installmentMinor)}
            </Text>
            <Text variant="caption" color={brand.onColor} style={{ opacity: 0.8 }}>
              / month
            </Text>
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
            <Text variant="caption" color={brand.onColor} style={{ opacity: 0.85 }}>
              {view.paidCount} of {loan.termMonths} payments made
            </Text>
            <Text variant="caption" color={brand.onColor} style={{ fontWeight: '700' }}>
              {formatMoney(view.remainingMinor, { compact: true })} left
            </Text>
          </Row>
        </View>
      </LinearGradient>

      <View style={{ padding: space.lg, gap: space.md }}>
        {/* The three facts that define the loan, on one clean line. */}
        <Row justify="space-between">
          <CardStat label="Borrowed" value={formatMoney(loan.principalMinor, { compact: true })} />
          {/*
            The rate is meaningless without saying HOW it is charged: 11.5%
            flat and 11.5% reducing are different loans. Only flat is marked,
            since reducing is the ordinary case and labelling both would add
            noise to every card.
          */}
          <CardStat
            label={loan.interestMethod === 'flat' ? 'Rate · flat' : 'Rate'}
            value={`${loan.annualRatePct}%`}
            align="center"
          />
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
            <Text variant="caption" tone="muted">
              Principal
            </Text>
            <Text variant="caption" tone="secondary">
              {formatMoney(loan.principalMinor)}
            </Text>
          </Row>
          <Row justify="space-between">
            <Text variant="caption" tone="muted">
              Interest
            </Text>
            <Text variant="caption" color={accent}>
              +{formatMoney(view.totalInterestMinor)}
            </Text>
          </Row>
          <Divider />
          <Row justify="space-between">
            <Text variant="small" style={{ fontWeight: '700' }}>
              Total repayable
            </Text>
            <Text variant="figure">
              {formatMoney(loan.principalMinor + view.totalInterestMinor)}
            </Text>
          </Row>
        </View>

        {/* Two clear footer buttons: reveal the repayment plan, or delete. */}
        <Row gap={space.sm}>
          <Pressable
            onPress={() => setExpanded(!expanded)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 11,
              borderRadius: radius.md,
              backgroundColor: expanded ? colors.accent : colors.accentSoft,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons
              name={expanded ? 'chevron-up' : 'receipt-outline'}
              size={16}
              color={expanded ? '#FFFFFF' : colors.accent}
            />
            <Text
              variant="small"
              color={expanded ? '#FFFFFF' : colors.accent}
              style={{ fontWeight: '700' }}
            >
              {expanded ? 'Hide plan' : 'Repayment plan'}
            </Text>
          </Pressable>

          {/*
            Edit, between the plan and the delete.

            A loan is eight fields copied off a bank statement, and until now
            the only way to correct one was to delete it and retype — which also
            destroys the board line and the payments recorded against it. Its
            own control rather than making the card tappable: the card already
            expands to show the repayment schedule, so a tap there means
            something else.
          */}
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${loan.name}`}
            style={({ pressed }) => ({
              width: 46,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 11,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceSunken,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="create-outline" size={17} color={colors.inkSecondary} />
          </Pressable>

          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${loan.name}`}
            style={({ pressed }) => ({
              width: 46,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 11,
              borderRadius: radius.md,
              backgroundColor: colors.dangerSoft,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="trash-outline" size={17} color={colors.danger} />
          </Pressable>
        </Row>

        {expanded ? (
          <View style={{ gap: 4 }}>
            <Divider />

            {/* Year pagination — 1Y, 2Y… so a long loan is a few taps, not a
                giant scroll. */}
            {totalYears > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingVertical: 4 }}
              >
                {Array.from({ length: totalYears }, (_, i) => i + 1).map((y) => {
                  const active = y === year;
                  return (
                    <Pressable
                      key={y}
                      onPress={() => setYear(y)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Year ${y}`}
                      style={{
                        paddingHorizontal: space.md,
                        paddingVertical: 6,
                        borderRadius: 999,
                        backgroundColor: active ? brand.color : colors.surfaceSunken,
                      }}
                    >
                      <Text
                        variant="caption"
                        color={active ? brand.onColor : colors.inkSecondary}
                        style={{ fontWeight: '700' }}
                      >
                        {y}Y
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            <Row justify="space-between" style={{ paddingHorizontal: space.xs }}>
              <Text variant="caption" tone="muted" style={{ width: 28 }}>
                #
              </Text>
              <Text variant="caption" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
                PRINCIPAL
              </Text>
              <Text variant="caption" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
                INTEREST
              </Text>
              <Text variant="caption" tone="muted" style={{ flex: 1.2, textAlign: 'right' }}>
                BALANCE
              </Text>
            </Row>
            {schedule.map((row) => {
              const isPaid = row.period <= view.paidCount;
              const isNext = row.period === view.paidCount + 1;
              return (
                <Row
                  key={row.period}
                  justify="space-between"
                  style={{
                    paddingVertical: 5,
                    paddingHorizontal: space.xs,
                    borderRadius: radius.sm,
                    backgroundColor: isNext
                      ? colors.accentSoft
                      : isPaid
                        ? 'transparent'
                        : colors.surfaceSunken,
                    opacity: isPaid ? 0.5 : 1,
                  }}
                >
                  <View style={{ width: 34, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    {isPaid ? (
                      <Ionicons name="checkmark-circle" size={12} color={colors.completed} />
                    ) : null}
                    <Text variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
                      {row.period}
                    </Text>
                  </View>
                  <Text variant="caption" color={colors.completed} style={{ flex: 1, textAlign: 'right' }}>
                    {formatMoney(row.principalMinor, { showCurrency: false, compact: true })}
                  </Text>
                  <Text variant="caption" color={accent} style={{ flex: 1, textAlign: 'right' }}>
                    {formatMoney(row.interestMinor, { showCurrency: false, compact: true })}
                  </Text>
                  <Text variant="caption" tone="secondary" style={{ flex: 1.2, textAlign: 'right' }}>
                    {formatMoney(row.balanceMinor, { showCurrency: false, compact: true })}
                  </Text>
                </Row>
              );
            })}
            <Text variant="caption" tone="muted" style={{ textAlign: 'center', paddingTop: space.xs }}>
              {view.paidCount} of {loan.termMonths} paid · {loan.termMonths - view.paidCount} left
            </Text>
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
      <Text variant="figure">{value}</Text>
    </View>
  );
}

/** A labelled figure in the loans summary hero. */
