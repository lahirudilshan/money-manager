import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import { SmartDetectBadge } from '~/features/sms/components/SmartDetectBadge';
import { SmsDraftCard } from '~/features/sms/components/SmsDraftCard';
import { UpgradeSheet } from '~/features/onboarding/components/UpgradeSheet';
import { useTabBarClearance } from '~/shared/components/TabBar';
import { BottomSheet, Divider, Empty, GradientCard, Glyph, Label, Row, Stat, Surface, Text } from '~/shared/components/ui';
import { formatMoney } from '~/shared/lib/money';
import { formatPeriod, planHealth, shiftPeriod } from '~/features/budget/logic/planning';
import { canUse } from '~/features/budget/logic/plans';
import { enabledMiniApps, MINI_APPS, parseEnabled } from '~/shared/lib/miniApps';
import { HEALTH_VISUALS, shadeHex } from '~/shared/theme';
import { accountLabel, resolveBrand } from '~/shared/data/banks';
import {
  selectAccountTransfers,
  selectBoardTotals,
  selectCategoryViews,
  selectLoanViews,
  selectRatios,
  selectReminders,
  selectTotalIncome,
  useAppStore,
  type ReminderView,
} from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** Thickness of the gradient edge grouping the Smart Detect section. */
const DETECT_BORDER = 1.5;

/**
 * How far the section's background wash is shaded toward white (or black in
 * dark mode). High enough that the fill barely separates from the canvas —
 * anything stronger turns the group into a coloured panel and the white cards
 * inside it stop reading as raised.
 */
const DETECT_WASH_LIGHT = 0.94;
const DETECT_WASH_DARK = -0.86;

/**
 * The dashboard: what needs doing, and where the money has to go.
 *
 * Ordered by urgency rather than structure — reminders first (the app exists
 * because the user forgets whether a payment went out), then the per-account
 * transfer list that answers "how much do I move to each bank", then the
 * month's overall shape. The full category tree lives on the List tab.
 */
export default function DashboardScreen() {
  const { colors, mode, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const state = useAppStore();
  const views = useMemo(() => selectCategoryViews(state), [state]);
  const totals = useMemo(() => selectBoardTotals(state), [state]);
  const ratios = useMemo(() => selectRatios(state), [state]);
  const income = useMemo(() => selectTotalIncome(state), [state]);
  const accounts = useMemo(() => selectAccountTransfers(state), [state]);
  const reminders = useMemo(() => selectReminders(state), [state]);
  const loanViews = useMemo(() => selectLoanViews(state), [state]);
  const miniApps = useMemo(() => enabledMiniApps(state.miniApps), [state.miniApps]);
  /** Which add-ons are on, for the picker's switches. */
  const enabledAddOns = useMemo(() => parseEnabled(state.miniApps), [state.miniApps]);
  const [addOnsOpen, setAddOnsOpen] = useState(false);

  /** Whether the current plan includes Smart Detect. */
  const smartDetect = canUse(state.plan, 'smartDetect');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const detectWash = mode === 'dark' ? DETECT_WASH_DARK : DETECT_WASH_LIGHT;

  // How this month grades, and the gradient/word/icon that says so.
  const health = planHealth({
    incomeMinor: income,
    freePct: ratios.freePct,
    disposableMinor: ratios.disposableMinor,
  });
  const healthVisual = HEALTH_VISUALS[health];
  const smsDrafts = state.smsDrafts;

  /*
   * Check for new messages every time this screen comes into view.
   *
   * Smart Detect is the reason the app exists, and until now nothing ran when
   * the dashboard was merely NAVIGATED to: the drain fired at launch, on a
   * folder-watch event, and on return to the foreground. Coming back from the
   * List tab — or from confirming a draft — is none of those, so a message that
   * landed in between sat unimported while the user looked straight at the
   * section that should have shown it.
   *
   * `useFocusEffect` rather than `useEffect`, because a tab screen stays mounted
   * when you leave it; a mount effect runs once per app run and never again.
   *
   * Safe to run on every focus: the sync is a stat and a short read of a file
   * that is usually empty, `drainSmsInbox` guards against re-entry, and the
   * store only re-renders when something actually changed.
   */
  const syncSmsNow = state.syncSmsNow;
  useFocusEffect(
    useCallback(() => {
      syncSmsNow();
    }, [syncSmsNow]),
  );

  const overdue = reminders.filter((r) => r.urgency === 'overdue');
  const dueSoon = reminders.filter((r) => r.urgency === 'due_soon');
  /*
   * "Upcoming" bills belong in a section called COMING UP.
   *
   * The list used to hold only overdue + due-within-7-days, which meant that on
   * any day more than a week before the month's bills fall due, a board full of
   * unpaid rent and utilities rendered as a green "Nothing due right now". That
   * is the most reassuring possible way to be wrong — the user is told they are
   * clear at exactly the moment they should be planning.
   *
   * It becomes more wrong, not less, now that reminders resolve to the NEXT
   * occurrence rather than the browsed month: a bill paid up for this month
   * correctly points at next month, which is always more than 7 days out.
   *
   * Ordering carries the urgency instead: late first, then due soon, then
   * simply next. `selectReminders` already sorts by days-until, so within each
   * band the soonest leads.
   */
  const upcoming = reminders.filter((r) => r.urgency === 'upcoming');
  const actionable = [...overdue, ...dueSoon, ...upcoming].slice(0, 5);

  const totalToTransfer = accounts.reduce((sum, a) => sum + a.toTransferMinor, 0);
  const paidCount = totals.categoryCount > 0 ? totals.settledCategoryCount : 0;

  const loanMonthly = loanViews.reduce((sum, l) => sum + l.installmentMinor, 0);
  const loanOutstanding = loanViews.reduce((sum, l) => sum + l.remainingMinor, 0);

  /**
   * Segment widths for the "where the income goes" bar, as percentages of the
   * bar itself.
   *
   * The raw ratios can exceed 100% together (an overspent month) or be negative
   * (`freePct` when the plan costs more than the income). Both are meaningful
   * numbers to *show*, but neither can be a segment width, so they are clamped
   * here and the overspend is communicated by colour and the legend instead.
   */
  const barLoanPct = Math.max(0, Math.min(100, ratios.loanPct));
  // Living takes whatever room is left, so the two never overflow the bar.
  const barLivingPct = Math.max(0, Math.min(100 - barLoanPct, ratios.livingPct));
  const barFreePct = Math.max(0, Math.min(100 - barLoanPct - barLivingPct, ratios.freePct));

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Fixed header — greeting + month switcher stay put while content scrolls. */}
      <View
        style={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: space.sm,
          backgroundColor: colors.canvas,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <Row justify="space-between" align="center">
          <View style={{ gap: 1 }}>
            <Text variant="caption" tone="muted">
              {greeting}
            </Text>
            <Text variant="title">Dashboard</Text>
          </View>
          <Row
            gap={2}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.hairline,
              padding: 3,
            }}
          >
            <PeriodStep
              icon="chevron-back"
              label="Previous month"
              onPress={() => state.setPeriod(shiftPeriod(state.period, -1))}
            />
            <View style={{ minWidth: 108, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {formatPeriod(state.period)}
              </Text>
            </View>
            <PeriodStep
              icon="chevron-forward"
              label="Next month"
              onPress={() => state.setPeriod(shiftPeriod(state.period, 1))}
            />
          </Row>
        </Row>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: space.md,
          paddingBottom: tabClearance,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
      {/* Headline: the month's whole shape — income in, money out, what's left.
          The gradient itself grades the month, so the card reads as a verdict at
          a glance rather than always looking celebratory. */}
      <GradientCard gradient={healthVisual.gradient}>
        <View style={{ gap: space.lg }}>
          <View style={{ gap: 2 }}>
            {/* One label in both directions — this is simply income minus
                expenses, and the sign on the figure says which way it went. */}
            <Row justify="space-between" align="center">
              <Label color="rgba(255,255,255,0.75)">BALANCE</Label>
              {/* Health is never colour alone: the word and icon carry it too,
                  so it survives greyscale and colour-vision differences. */}
              <Row gap={4}>
                <Ionicons name={healthVisual.icon as never} size={13} color="rgba(255,255,255,0.9)" />
                <Text variant="caption" color="rgba(255,255,255,0.9)" style={{ fontWeight: '800' }}>
                  {healthVisual.label}
                </Text>
              </Row>
            </Row>
            <Text variant="hero" color="#FFFFFF">
              {formatMoney(ratios.disposableMinor)}
            </Text>
          </View>

          {/* Four headline figures: money in, planned out, actually spent, debt.
              Currency prefix is dropped here (it's LKR throughout) so all four
              compact values fit without truncating. */}
          <Row gap={6} justify="space-between">
            <HeroStat label="INCOME" value={formatMoney(income, { compact: true, showCurrency: false })} />
            <HeroStat label="PLANNED" value={formatMoney(totals.plannedMinor, { compact: true, showCurrency: false })} />
            <HeroStat label="SPENT" value={formatMoney(totals.paidMinor, { compact: true, showCurrency: false })} />
            {/* This month's loan cost, not the lifetime balance: all four
                figures are monthly, so they are actually comparable. Total
                outstanding still leads the Debt card further down. */}
            <HeroStat label="LOANS" value={formatMoney(loanMonthly, { compact: true, showCurrency: false })} />
          </Row>

          {/* Where the income goes. Widths are an explicit share of the *bar*,
              not `flex` of the raw percentages: flex is proportional, so an
              overspent month (loans + living > 100%) would silently renormalise
              and look exactly like a balanced one. Clamping instead fills the
              bar completely and lets the "over budget" note carry the news. */}
          <View style={{ gap: space.sm }}>
            <View
              style={{
                flexDirection: 'row',
                height: 8,
                borderRadius: 999,
                overflow: 'hidden',
                gap: 2,
                backgroundColor: 'rgba(255,255,255,0.22)',
              }}
            >
              {barLoanPct > 0 ? (
                <View style={{ width: `${barLoanPct}%`, backgroundColor: '#FFFFFF' }} />
              ) : null}
              {barLivingPct > 0 ? (
                <View
                  style={{ width: `${barLivingPct}%`, backgroundColor: 'rgba(255,255,255,0.65)' }}
                />
              ) : null}
              {barFreePct > 0 ? (
                <View
                  style={{ width: `${barFreePct}%`, backgroundColor: 'rgba(255,255,255,0.3)' }}
                />
              ) : null}
            </View>
            <Row gap={space.lg}>
              <LegendDot shade={1} label={`Loans ${ratios.loanPct.toFixed(0)}%`} />
              <LegendDot shade={0.65} label={`Living ${ratios.livingPct.toFixed(0)}%`} />
              {/* The remainder after loans and living. Labelled "Balance" in
                  both directions — a negative one is still the balance, just
                  an overspent one, and the signed figure carries that. */}
              <LegendDot
                shade={0.4}
                label={`Balance ${ratios.freePct > 0 ? '+' : ''}${ratios.freePct.toFixed(0)}%`}
              />
            </Row>
          </View>
        </View>
      </GradientCard>

      {/* Quick actions — unique shortcuts NOT reachable from the bottom tabs. */}
      <Row gap={space.sm}>
        {/*
          Add-ons, where "Transaction" used to be.

          Adding a transaction by hand already has a permanent home — the + in
          the tab bar — so this tile was a second door to the same room. The
          add-on catalogue had no door at all: it lived several screens deep in
          Settings, which is where features go to be undiscovered.
        */}
        <QuickAction
          icon="grid-outline"
          label="Add-ons"
          onPress={() => setAddOnsOpen(true)}
        />
        <QuickAction
          icon="chatbox-ellipses-outline"
          label="Paste SMS"
          onPress={() => router.push('/sms/new')}
        />
        <QuickAction
          icon="flash-outline"
          label="Auto-detect"
          onPress={() => router.push('/settings/sms-automation')}
        />
        <QuickAction
          icon="albums-outline"
          label="Category"
          onPress={() => router.push('/category/new')}
        />
      </Row>

      {/*
        Add-on features the user has switched on — see core/miniApps.ts.

        Renders nothing at all when none are enabled, so the dashboard is
        byte-for-byte what it was for anyone who never opens that section.
      */}
      {miniApps.length > 0 ? (
        <View style={{ gap: space.sm }}>
          {/* "YOUR TOOLS", not "ADD-ONS" — the tile above is now called
              Add-ons and opens the catalogue, so repeating the word here made
              one heading look like a label for the other. These are the ones
              already switched on. */}
          <Label>YOUR TOOLS</Label>
          <Surface padded={false}>
            {miniApps.map((app, index) => (
              <View key={app.id}>
                {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                <Pressable
                  onPress={() => router.push(app.route as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${app.name}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: `${app.color}1A`,
                    }}
                  >
                    <Ionicons name={app.icon} size={19} color={app.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{app.name}</Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {app.description}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
                </Pressable>
              </View>
            ))}
          </Surface>
        </View>
      ) : null}

      {/* Drafts parsed from incoming SMS, awaiting Yes/Edit/No. Surfaced high
          because they are the one thing the user must act on before the board
          reflects reality. */}
      {smsDrafts.length > 0 ? (
        /*
         * A gradient edge around the whole section — label and rows together —
         * so everything Smart Detect produced reads as one group rather than
         * loose cards that happen to sit under a badge.
         *
         * React Native has no gradient border, so the gradient is the outer
         * layer and the inner view covers all but that edge. The inner radius
         * drops by the border width to keep the two rounded rectangles
         * concentric at the corners.
         */
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 20, padding: DETECT_BORDER }}
        >
        {/* A wash of the same two brand stops, shaded almost to the background
            so the group reads as tinted rather than as a coloured panel — the
            white cards inside still have to be the thing that stands out.

            Shaded here rather than with the shared `washFor`, which is tuned
            for tinted tiles that carry an icon and needs more colour than a
            backdrop sitting behind white cards. */}
        <LinearGradient
          colors={[
            shadeHex(colors.gradientStart, detectWash),
            shadeHex(colors.gradientEnd, detectWash),
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            gap: space.sm,
            padding: space.md,
            borderRadius: 20 - DETECT_BORDER,
          }}
        >
          <Row justify="space-between" align="center">
            <View style={{ gap: 4 }}>
              <SmartDetectBadge size="sm" showLock={!smartDetect} />
              <Text variant="caption" tone="muted">
                Read from your SMS — confirm to add
              </Text>
            </View>
            {/* Bare text, no pill: the section's own tinted background already
                sets this apart, and a second tint inside it read as a control. */}
            <Row gap={4}>
              <Ionicons name="chatbox-ellipses" size={12} color={colors.accent} />
              <Text variant="caption" color={colors.accent}>
                {smsDrafts.length} to review
              </Text>
            </Row>
          </Row>

          {smsDrafts.map((draft) => (
            <SmsDraftCard
              key={draft.id}
              draft={draft}
              cards={state.cards}
              matchedBillName={
                draft.subcategoryId
                  ? state.subcategories.find((s) => s.id === draft.subcategoryId)?.name
                  : undefined
              }
              // Both actions are gated: "Log it" and "Wrong category" are the
              // two ways a draft becomes a real entry, so a free plan can see
              // what was detected but not act on it.
              onOpen={() =>
                smartDetect ? router.push(`/sms/${draft.id}`) : setUpgradeOpen(true)
              }
              /*
               * With a bill chosen, log against it. With only a HINT — "Looks
               * like Groceries", no line behind it yet — create or reuse the
               * line that hint points at, then log. `createLineForDraft`
               * prefers an existing line and only builds one when the board
               * genuinely has nowhere to put it.
               *
               * Without this branch the button was live but did nothing, since
               * `confirmDraft` bails with no subcategoryId.
               */
              onConfirm={() => {
                if (!smartDetect) {
                  setUpgradeOpen(true);
                  return;
                }
                if (draft.subcategoryId) {
                  state.confirmDraft(draft.id);
                  return;
                }
                // Null means the hint has no catalog home, so nothing was
                // created or logged. Send the user to the picker rather than
                // letting the tap appear to do nothing.
                if (state.createLineForDraft(draft.id) === null) {
                  router.push(`/sms/${draft.id}`);
                }
              }}
              /*
               * Dismissing is NOT gated on the plan, unlike the two actions
               * above. Those write to the board, which is the paid capability;
               * clearing a detection the user does not want writes nothing, and
               * making someone upgrade to dismiss a card would be hostile.
               */
              onDismiss={() =>
                Alert.alert(
                  'Delete this detection?',
                  'It will be removed without being logged.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => state.dismissDraft(draft.id),
                    },
                  ],
                )
              }
            />
          ))}
        </LinearGradient>
        </LinearGradient>
      ) : null}

      {views.length === 0 ? (
        <Empty
          icon="albums-outline"
          title="No plan yet"
          message="Create a category, add its lines, and assign the account each is funded from."
          actionLabel="Create a category"
          onAction={() => router.push('/category/new')}
        />
      ) : null}

      {/* Coming up — the reason the app exists.

          Titled "COMING UP" rather than "NEEDS ATTENTION": the section is
          mostly bills that are simply next, and framing every one of them as a
          problem makes a normal month read as a pile of trouble. Anything
          genuinely late still says so, in the overdue chip and on its own row. */}
      {actionable.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Row justify="space-between" align="center">
            <Label>COMING UP</Label>
            {overdue.length > 0 ? (
              <View
                style={{
                  paddingHorizontal: space.sm,
                  paddingVertical: 3,
                  borderRadius: 999,
                  backgroundColor: colors.dangerSoft,
                }}
              >
                {/* "late", not "overdue" — the same word the rows now use, so
                    the chip and the list are plainly about one thing. */}
                <Text variant="caption" color={colors.danger} style={{ fontWeight: '800' }}>
                  {overdue.length} late
                </Text>
              </View>
            ) : null}
          </Row>

          <Surface padded={false} style={{ paddingVertical: space.xs }}>
            {actionable.map((reminder, index) => (
              <View key={reminder.subcategory.id}>
                {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                <ReminderRow
                  reminder={reminder}
                  onPress={() => router.push(`/subcategory/${reminder.subcategory.id}`)}
                />
              </View>
            ))}
          </Surface>
        </View>
      ) : views.length > 0 ? (
        <Surface style={{ backgroundColor: colors.completedSoft, borderColor: colors.completed }}>
          <Row>
            <Ionicons name="checkmark-done-circle" size={30} color={colors.completed} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" color={colors.completed}>
                Nothing due right now
              </Text>
              <Text variant="caption" tone="muted">
                {paidCount}/{totals.categoryCount} categories fully settled this month
              </Text>
            </View>
          </Row>
        </Surface>
      ) : null}

      {/*
        Per-account transfers — "how much do I move where".

        A once-a-month sweep after the salary lands: read the amount, open the
        banking app, move it, mark it. One row per account with an explicit
        button, because the action deserves a label — a bare checkbox does not
        say what ticking it MEANS, and this one writes through to every category
        the account funds.
      */}
      {accounts.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Row justify="space-between" align="center">
            <Label>MONEY TO MOVE</Label>
            <Text variant="figure" color={totalToTransfer > 0 ? colors.pending : colors.completed}>
              {totalToTransfer > 0 ? formatMoney(totalToTransfer) : 'All moved'}
            </Text>
          </Row>

          {/* One surface, hairline-divided: with three or four accounts this
              is a list to work down, and a card each turned it into a scroll. */}
          <Surface padded={false}>
            {accounts.map((account, index) => {
              const brand = resolveBrand({
                bankId: account.card.bankId,
                bankName: account.card.bankName,
              });
              const done = account.toTransferMinor === 0;
              const label = accountLabel(account.card);

              return (
                <View key={account.card.id}>
                  {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                  <Row
                    gap={space.md}
                    style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
                  >
                    {/* Identity and amount — tapping opens the account detail. */}
                    <Pressable
                      onPress={() => router.push(`/account/${account.card.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`${label.primary} details`}
                      style={({ pressed }) => ({
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <BankLogo brand={brand} size={34} />
                      {/* `minWidth: 0` so the NAME truncates when the figure is
                          long, rather than the row overflowing. The amount is
                          the thing being acted on, so it keeps its space. */}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text variant="bodyStrong" numberOfLines={1} tone={done ? 'muted' : 'ink'}>
                          {label.primary}
                        </Text>
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {/* What the account is FOR — the categories it funds
                              are the reason a given sum goes there. */}
                          {account.categoryNames.slice(0, 3).join(' · ') || 'No categories'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        {/* Full figure, not compact: this is the number the user
                            types into their banking app, and "4.1K" is not a
                            number you can transfer. */}
                        <Text
                          variant="figure"
                          color={done ? colors.completed : colors.ink}
                          numberOfLines={1}
                        >
                          {done
                            ? formatMoney(account.plannedMinor)
                            : formatMoney(account.toTransferMinor)}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {done ? 'moved' : 'click to move'}
                        </Text>
                      </View>
                    </Pressable>

                    {/*
                      The check sits LAST, right after the figure it settles —
                      the eye reads the account, then the amount, then ticks it
                      off, which is the order the task actually happens in.

                      Its own hit target so ticking never opens the detail by
                      accident, with `hitSlop` giving a thumb-sized area without
                      making the circle itself heavy.
                    */}
                    <Pressable
                      onPress={() => state.toggleAccountTransfer(account.card.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: done }}
                      accessibilityLabel={
                        done
                          ? `${label.primary}, money moved. Tap to undo.`
                          : `Mark money moved to ${label.primary}`
                      }
                      hitSlop={12}
                      style={({ pressed }) => ({
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: done ? colors.completed : 'transparent',
                        borderWidth: done ? 0 : 1.5,
                        borderColor: colors.hairline,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      {done ? (
                        <Ionicons name="checkmark" size={17} color={colors.inkInverse} />
                      ) : null}
                    </Pressable>
                  </Row>
                </View>
              );
            })}
          </Surface>
        </View>
      ) : null}

      {/* Debt snapshot — a quick read on loans without leaving home. */}
      {loanViews.length > 0 ? (
        <Surface
          onPress={() => router.push('/(tabs)/loans')}
          style={{ gap: space.md, backgroundColor: colors.pendingSoft, borderColor: colors.pending }}
        >
          <Row justify="space-between" align="center">
            <Row gap={space.sm}>
              <Ionicons name="trending-down" size={18} color={colors.pending} />
              <Label color={colors.pending}>DEBT</Label>
            </Row>
            <Ionicons name="chevron-forward" size={16} color={colors.pending} />
          </Row>
          <Row justify="space-between">
            <View style={{ gap: 2 }}>
              <Text variant="caption" tone="muted">
                Outstanding
              </Text>
              <Text variant="figureLarge">{formatMoney(loanOutstanding, { compact: true })}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text variant="caption" tone="muted">
                Per month
              </Text>
              <Text variant="figureLarge" color={colors.pending}>
                {formatMoney(loanMonthly, { compact: true })}
              </Text>
            </View>
          </Row>
        </Surface>
      ) : null}

      {/* This month at a glance. */}
      {views.length > 0 ? (
        <Surface style={{ gap: space.md }}>
          <Label>THIS MONTH</Label>
          <Divider />
          <StatRow label="Planned" value={formatMoney(totals.plannedMinor)} />
          <StatRow
            label="Paid so far"
            value={formatMoney(totals.paidMinor)}
            color={colors.completed}
          />
          <StatRow
            label="Still to pay"
            value={formatMoney(totals.outstandingMinor)}
            color={totals.outstandingMinor > 0 ? colors.pending : colors.completed}
          />
          <Divider />
          <StatRow
            label="Categories settled"
            value={`${totals.settledCategoryCount} of ${totals.categoryCount}`}
          />
        </Surface>
      ) : null}
      </ScrollView>

      <UpgradeSheet
        visible={upgradeOpen}
        feature="smartDetect"
        onClose={() => setUpgradeOpen(false)}
      />

      {/*
        The add-on catalogue, one tap from the dashboard.

        It only ever existed inside Settings, several screens deep — so the one
        thing that makes the app fit a particular person was the hardest thing
        to find. Same registry, same store action; the sheet just puts it where
        someone would look for it.
      */}
      {addOnsOpen ? (
        <BottomSheet
          visible
          scroll
          onClose={() => setAddOnsOpen(false)}
          title="Add-ons"
          icon="grid-outline"
        >
          <Text variant="small" tone="secondary">
            Extras for the things you track beyond bills. Switch one on and it
            appears on your dashboard; switch it off and the app forgets it was
            ever there.
          </Text>

          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {MINI_APPS.map((app, index) => {
              const on = enabledAddOns.has(app.id);

              return (
                <View key={app.id}>
                  {index > 0 ? <Divider /> : null}
                  {/*
                    The row is a switch, not a link.

                    Tapping anywhere on it flips the add-on, because that is the
                    only decision this sheet asks for. Opening the feature is
                    what the dashboard card below is for, once it exists.
                  */}
                  <Pressable
                    onPress={() => state.setMiniAppEnabled(app.id, !on)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={app.name}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.7 : 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                    })}
                  >
                    <Glyph icon={app.icon} color={app.color} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{app.name}</Text>
                      <Text variant="caption" tone="muted">
                        {app.description}
                      </Text>
                    </View>
                    <Switch
                      value={on}
                      onValueChange={(next) => state.setMiniAppEnabled(app.id, next)}
                      accessibilityLabel={`${app.name}, ${on ? 'on' : 'off'}`}
                    />
                  </Pressable>
                </View>
              );
            })}
          </Surface>

          {/*
            Says what is coming without promising a date.

            An add-on list of one reads like a broken screen; saying the list
            grows explains that it is deliberate.
          */}
          <Row gap={space.sm} style={{ alignItems: 'flex-start', paddingHorizontal: space.xs }}>
            <Ionicons
              name="sparkles-outline"
              size={15}
              color={colors.inkMuted}
              style={{ marginTop: 1 }}
            />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              More add-ons arrive with app updates. Anything you switch on keeps
              its data even if you turn it off later.
            </Text>
          </Row>
        </BottomSheet>
      ) : null}
    </View>
  );
}

function PeriodStep({
  icon,
  label,
  onPress,
}: {
  icon: 'chevron-back' | 'chevron-forward';
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Ionicons name={icon} size={18} color={colors.inkSecondary} />
    </Pressable>
  );
}

/**
 * One of the four headline figures on the hero card, as its own tile.
 *
 * Sat bare on the gradient before, which left four numbers floating in a row
 * with nothing separating them. Each now gets a translucent gradient wash —
 * lighter at the top-left, fading out — so the tile reads as a distinct
 * statistic while still letting the card's health colour show through. Drawn
 * from white alpha rather than fixed hues, so it works over every health
 * gradient without needing a variant per state.
 */
function HeroStat({ label, value }: { label: string; value: string }) {
  const { radius, space } = useTheme();
  return (
    <View style={{ flex: 1, borderRadius: radius.md, overflow: 'hidden' }}>
      <LinearGradient
        colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.06)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        // Tighter horizontally than vertically: four tiles share the screen's
        // width, so side padding is the most expensive space here.
        style={{ paddingVertical: space.sm, paddingHorizontal: 6, gap: 2 }}
      >
        <Text
          variant="label"
          color="rgba(255,255,255,0.65)"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {label}
        </Text>
        {/*
         * Shrinks to fit rather than truncating.
         *
         * These four tiles are a fixed quarter of the screen each, but their
         * values are not a fixed width — a figure like "1,234.5K" on a 375pt
         * phone overflowed the tile and ellipsised, hiding the digits the tile
         * exists to show. `adjustsFontSizeToFit` scales the text down instead,
         * so the whole number is always readable; the floor keeps it from
         * shrinking to something illegible on the narrowest device.
         */}
        <Text
          variant="figure"
          color="#FFFFFF"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {value}
        </Text>
      </LinearGradient>
    </View>
  );
}

/** One tappable quick-action tile in the dashboard's action row. */
function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 6,
        paddingVertical: space.md,
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.accentSoft,
        }}
      >
        <Ionicons name={icon} size={19} color={colors.accent} />
      </View>
      <Text variant="caption" tone="secondary" numberOfLines={1} style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return <Stat label={label} value={value} color={color} inline />;
}

/** One overdue/soon line, with how late or close it is stated in words. */
function ReminderRow({
  reminder,
  onPress,
}: {
  reminder: ReminderView;
  onPress: () => void;
}) {
  const { colors, space } = useTheme();

  const overdue = reminder.urgency === 'overdue';
  const accent = overdue ? colors.danger : colors.pending;
  /*
   * Plain words, the way a person would say it out loud.
   *
   * "Due in 3 days" and "3 days overdue" are the language of an invoice, not of
   * someone glancing at their phone. The day count is the useful part — how
   * soon, or how late — so it leads, and the rest gets out of its way.
   */
  const days = Math.abs(reminder.daysUntil);
  const when = overdue
    ? days === 1
      ? 'Late by a day'
      : `Late by ${days} days`
    : reminder.daysUntil === 0
      ? 'Today'
      : reminder.daysUntil === 1
        ? 'Tomorrow'
        : `In ${days} days`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${reminder.subcategory.name}, ${when}, ${formatMoney(reminder.amountMinor)}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          backgroundColor: overdue ? colors.dangerSoft : colors.pendingSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name={overdue ? 'alert-circle' : 'time-outline'}
          size={19}
          color={accent}
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {reminder.subcategory.name}
        </Text>
        <Row gap={space.xs}>
          <Text variant="caption" color={accent} style={{ fontWeight: '700' }}>
            {when}
          </Text>
          {/* Category only. "money ready" used to be appended when the account
              had been funded, but whether the cash is sitting there is a
              different question from whether this bill is due — and on an
              overdue row it read as reassurance next to an alarm. */}
          <Text variant="caption" tone="muted" numberOfLines={1}>
            · {reminder.categoryName}
          </Text>
        </Row>
      </View>

      <Text variant="figure">{formatMoney(reminder.amountMinor, { compact: true })}</Text>
      <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
    </Pressable>
  );
}

function LegendDot({ shade, label }: { shade: number; label: string }) {
  return (
    <Row gap={5}>
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: `rgba(255,255,255,${shade})`,
        }}
      />
      <Text variant="caption" color="rgba(255,255,255,0.85)">
        {label}
      </Text>
    </Row>
  );
}
