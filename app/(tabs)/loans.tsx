import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
} from '~/features/loans/components/LoanForm';
import { BottomSheet, Divider, FundingBar, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTabBarClearance } from '~/shared/components/TabBar';
import { buildSchedule } from '~/features/loans/logic/amortization';
import { isFlexibleDueDay } from '~/features/budget/logic/planning';
import { formatMoney } from '~/shared/lib/money';
import { useBrand } from '~/shared/hooks/useBrand';
import { resolveBrand } from '~/shared/data/banks';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import { selectLoanViews, useAppStore, type LoanView } from '../../src/store/useAppStore';
import { readableOn, shadeHex } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';

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

  /**
   * The hero's gradient, taken from the LENDER the figure is mostly about.
   *
   * Every loan card below already wears its own bank's colours, and the summary
   * above them was painted in one fixed magenta that belonged to no bank at
   * all — so the one panel stating the headline number was the only thing on
   * the screen not connected to whose money it is.
   *
   * The largest outstanding balance wins, because that is the debt the total is
   * mostly made of: with one loan the hero and its card now match exactly, and
   * with several it takes the colour of the one dominating the figure. A tie or
   * an empty list cannot reach here — the hero only renders with loans present
   * — and a loan with no bank recorded resolves to the neutral brand, which is
   * the same fallback its own card uses.
   */
  const heroBrand = useMemo(() => {
    /*
     * Guarded for the EMPTY board, even though the hero only renders with loans
     * present. This hook runs on every render, including the first-run one that
     * shows the empty state instead — and `reduce` with no initial value throws
     * on an empty array, so leaving it unguarded crashed the tab for exactly the
     * users who had not added a loan yet.
     */
    const biggest = views.length
      ? views.reduce((top, view) => (view.remainingMinor > top.remainingMinor ? view : top))
      : undefined;
    return resolveBrand({
      bankId: biggest?.loan.bankId,
      name: biggest?.loan.name,
    });
  }, [views]);

  /*
   * The hero's secondary inks, keyed to whether its face is dark or light.
   *
   * The old fixed-white panel faded its labels with `rgba(255,255,255,0.75)`,
   * which is invisible on a pale brand. These fade the ACTUAL ink colour
   * instead, so the labels sit the same distance behind the figures on either
   * kind of face.
   */
  const heroDark = heroBrand.onColor === '#FFFFFF';
  const heroMuted = heroDark ? 'rgba(255,255,255,0.75)' : 'rgba(16,24,40,0.6)';
  const heroFaint = heroDark ? 'rgba(255,255,255,0.65)' : 'rgba(16,24,40,0.5)';
  const heroRule = heroDark ? 'rgba(255,255,255,0.2)' : 'rgba(16,24,40,0.15)';

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
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/*
        Fixed header — stays pinned while the loans scroll beneath it.

        Matches the plan and settings tabs: a hairline under a canvas-coloured
        bar, so a card passing behind it has a defined edge rather than fading
        into the same colour. The Add button rides along, which is the point —
        it was scrolling out of reach on a long list of loans.
      */}
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.lg,
          backgroundColor: colors.canvas,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.hairline,
        }}
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
                // The same brand as the hero directly beneath it — these two
                // were the screen's last two hardcoded magentas, and a pill in
                // a colour no loan uses reads as belonging to something else.
                backgroundColor: heroBrand.color,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="add" size={16} color={heroBrand.onColor} />
              <Text variant="caption" color={heroBrand.onColor} style={{ fontWeight: '700' }}>
                Loan
              </Text>
            </Pressable>
          ) : null}
        </Row>
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{
          paddingTop: space.md,
          paddingBottom: tabClearance,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
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
                colors={[heroBrand.color, shadeHex(heroBrand.color, -0.35)]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: space.xl, gap: space.lg }}
              >
                {/*
                  Ink follows the BRAND, not a fixed white.

                  These figures were hardcoded `#FFFFFF` back when the panel was
                  always the same deep magenta. Now that it wears the lender's
                  colour, a bank with a pale brand — and the catalog has
                  several — would put white text on a light ground and lose the
                  headline number entirely. `onColor` is the same choice each
                  loan card already makes for its own face.
                */}
                <View style={{ gap: 2 }}>
                  <Label color={heroMuted}>TOTAL OUTSTANDING</Label>
                  <Text variant="hero" color={heroBrand.onColor}>
                    {formatMoney(totals.outstanding)}
                  </Text>
                </View>
                <Divider style={{ backgroundColor: heroRule }} />
                <Row justify="space-between">
                  <View style={{ gap: 2 }}>
                    <Label color={heroFaint}>PER MONTH</Label>
                    <Text variant="figureLarge" color={heroBrand.onColor}>
                      {formatMoney(totals.monthly, { compact: true })}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Label color={heroFaint}>LIFETIME INTEREST</Label>
                    <Text variant="figureLarge" color={heroBrand.onColor}>
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
    </View>
  );
}


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
  /**
   * The card's accent is the LENDER'S colour, not one shared amber.
   *
   * The card face already paints the bank's gradient, but everything inside it
   * — the interest figure, the schedule's interest column, the "repayment plan"
   * button, the year pager — was drawn in one global `colors.pending`. So three
   * loans from three banks had three distinct headers and then three identical
   * bodies, and the body is where the user actually reads the numbers.
   *
   * Darkened until it is legible on the app's own surface: a brand hue chosen
   * to work behind white text on a card face is not necessarily readable as
   * text on a pale background, and several of the catalog's are not.
   */
  const accent = useMemo(() => readableOn(brand.color, colors.surface), [brand.color, colors.surface]);
  /** The same hue as a background wash, for tinted chips and soft fills. */
  const accentSoft = `${brand.color}1F`;
  const router = useRouter();

  /**
   * WHICH DAY the installment leaves the account.
   *
   * Lives on the board line rather than on the loan: the line is what actually
   * gets paid and ticked off each month, and its day is what the subcategory
   * screen edits. A line with no day of its own follows its category, which is
   * why this falls back through the Debt category before giving up.
   *
   * Shown here so the card answers "when?" alongside "how much?" — the two
   * facts a borrower checks together — instead of sending them to the board to
   * find out. `null` when nothing anywhere names a day, or when the day is
   * deliberately flexible; the stat is then omitted rather than printed as a
   * meaningless "0th".
   */
  const payDay = useAppStore((appState) => {
    const line = appState.subcategories.find((sub) => sub.loanId === loan.id);
    if (!line) return null;

    const category = appState.categories.find((cat) => cat.id === line.categoryId);
    const day = line.dueDay ?? category?.dueDay ?? null;
    return day !== null && !isFlexibleDueDay(day) ? day : null;
  });

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
          {/*
            THE LENDER'S MARK, not a generic loan glyph.

            This tile held one of four kind icons — a car, a house, a card —
            which said what KIND of loan it is while the header's colour, its
            name and its subtitle were all already about WHO lent the money.
            Every other place the app names an account shows that bank's logo,
            and the loan card was the one that did not.

            `onBrand` because this tile sits on the lender's own gradient: a
            monogram in `brand.color` there is invisible, so it takes the white
            chip a real logo already uses. The loan's kind has not been lost —
            it reads in the subtitle below for a loan with no bank set, and the
            schedule beneath states the terms in full.
          */}
          <BankLogo brand={brand} size={42} onBrand />

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
          <CardStat
            label="Term"
            value={`${loan.termMonths / 12} yr`}
            align={payDay === null ? 'flex-end' : 'center'}
          />
          {/*
            WHEN it is paid, beside how much and for how long.

            The card stated every figure about the debt except the one date the
            borrower acts on each month. It was reachable only by opening the
            board line, which is exactly the trip this card exists to save.
            Omitted entirely when no day is set — an absent date is better said
            by silence than by a placeholder.
          */}
          {payDay === null ? null : (
            <CardStat label="Pay day" value={ordinalDay(payDay)} align="flex-end" />
          )}
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
              backgroundColor: expanded ? brand.color : accentSoft,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {/*
              The receipt glyph stays; the CHEVRON is what says it opens.

              Collapsed, this button led with a receipt icon — a picture of what
              the button is about, not of what pressing it does — so the one
              control that reveals the whole schedule read as a label. Only the
              expanded state carried a chevron, which meant the affordance
              appeared *after* the user had already guessed correctly.

              Now the receipt names the content and a trailing chevron states
              the action, rotating down/up with the state. Both sit on the same
              row as the label, so the button reads left to right as "receipt →
              repayment plan → opens downward".
            */}
            <Ionicons
              name="receipt-outline"
              size={16}
              color={expanded ? brand.onColor : accent}
            />
            <Text
              variant="small"
              color={expanded ? brand.onColor : accent}
              style={{ fontWeight: '700' }}
            >
              {expanded ? 'Hide plan' : 'Repayment plan'}
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={15}
              color={expanded ? brand.onColor : accent}
            />
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
              /*
                Amber, matching the delete button's red-on-soft-red beside it.

                These two sit side by side and did not read as a pair: delete
                was tinted and edit was grey-on-grey, so the destructive action
                was the only one that looked like a button at all. `pending` is
                the theme's own amber — the same one the board uses for "needs
                attention" — so the pair now reads as two actions of differing
                weight rather than one action and one label.
              */
              backgroundColor: colors.pendingSoft,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {/* A pencil, not a pencil-in-a-box: `create-outline` draws a square
                that echoed the button's own rounded rect, so the glyph fought
                its container. */}
            <Ionicons name="pencil" size={17} color={colors.pending} />
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
                      ? accentSoft
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
/** Ordinal day for the pay-day stat: 1st, 2nd, 3rd, 21st… */
function ordinalDay(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][Math.min(day % 10, 4)] ?? 'th';
  return `${day}${suffix}`;
}

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
