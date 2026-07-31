import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankLogo } from '../../src/components/BankLogo';
import { SmartDetectBadge } from '../../src/components/SmartDetectBadge';
import { SmsDraftCard } from '../../src/components/SmsDraftCard';
import { UpgradeSheet } from '../../src/components/UpgradeSheet';
import { useTabBarClearance } from '../../src/components/TabBar';
import {
  Divider,
  Empty,
  FundingBar,
  GradientCard,
  Label,
  Row,
  Stat,
  Surface,
  T,
} from '../../src/components/ui';
import { formatMoney } from '../../src/core/money';
import { formatPeriod, planHealth, shiftPeriod } from '../../src/core/planning';
import { canUse } from '../../src/core/plans';
import { HEALTH_VISUALS, shadeHex } from '../../src/theme';
import { accountLabel, resolveBrand } from '../../src/data/banks';
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
import { useTheme } from '../../src/theme/ThemeProvider';

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

  const overdue = reminders.filter((r) => r.urgency === 'overdue');
  const dueSoon = reminders.filter((r) => r.urgency === 'due_soon');
  const actionable = [...overdue, ...dueSoon].slice(0, 5);

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
            <T variant="caption" tone="muted">
              {greeting}
            </T>
            <T variant="title">Dashboard</T>
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
              <T variant="bodyStrong" numberOfLines={1}>
                {formatPeriod(state.period)}
              </T>
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
                <T variant="caption" color="rgba(255,255,255,0.9)" style={{ fontWeight: '800' }}>
                  {healthVisual.label}
                </T>
              </Row>
            </Row>
            <T variant="hero" color="#FFFFFF">
              {formatMoney(ratios.disposableMinor)}
            </T>
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
        <QuickAction
          icon="add-circle-outline"
          label="Transaction"
          onPress={() => router.push('/transaction/new')}
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
              <T variant="caption" tone="muted">
                Read from your SMS — confirm to add
              </T>
            </View>
            {/* Bare text, no pill: the section's own tinted background already
                sets this apart, and a second tint inside it read as a control. */}
            <Row gap={4}>
              <Ionicons name="chatbox-ellipses" size={12} color={colors.accent} />
              <T variant="caption" color={colors.accent}>
                {smsDrafts.length} to review
              </T>
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
              onConfirm={() =>
                smartDetect ? state.confirmDraft(draft.id) : setUpgradeOpen(true)
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

      {/* Needs attention — the reason the app exists. */}
      {actionable.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Row justify="space-between" align="center">
            <Label>NEEDS ATTENTION</Label>
            {overdue.length > 0 ? (
              <View
                style={{
                  paddingHorizontal: space.sm,
                  paddingVertical: 3,
                  borderRadius: 999,
                  backgroundColor: colors.dangerSoft,
                }}
              >
                <T variant="caption" color={colors.danger} style={{ fontWeight: '800' }}>
                  {overdue.length} overdue
                </T>
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
              <T variant="bodyStrong" color={colors.completed}>
                Nothing due right now
              </T>
              <T variant="caption" tone="muted">
                {paidCount}/{totals.categoryCount} categories fully settled this month
              </T>
            </View>
          </Row>
        </Surface>
      ) : null}

      {/* Per-account transfers — "how much do I move where". */}
      {accounts.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Row justify="space-between" align="center">
            <Label>MONEY TO MOVE</Label>
            <T variant="figure" color={totalToTransfer > 0 ? colors.pending : colors.completed}>
              {formatMoney(totalToTransfer)}
            </T>
          </Row>

          <View style={{ gap: space.sm }}>
            {accounts.map((account) => {
              const brand = resolveBrand({
                bankId: account.card.bankId,
                bankName: account.card.bankName,
                name: account.card.name,
              });
              const done = account.toTransferMinor === 0;
              const pct =
                account.plannedMinor > 0
                  ? (account.movedMinor / account.plannedMinor) * 100
                  : 100;

              const label = accountLabel(account.card);
              return (
                <Surface
                  key={account.card.id}
                  onPress={() => router.push(`/account/${account.card.id}`)}
                  style={{ gap: space.md }}
                >
                  <Row gap={space.md}>
                    <BankLogo brand={brand} size={42} />
                    <View style={{ flex: 1 }}>
                      <T variant="bodyStrong" numberOfLines={1}>
                        {label.primary}
                      </T>
                      <T variant="caption" tone="muted" numberOfLines={1}>
                        {label.secondary ??
                          account.categoryNames.slice(0, 3).join(' · ') ??
                          'No categories'}
                      </T>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <T variant="figureLarge" color={done ? colors.completed : colors.ink}>
                        {done ? 'Done' : formatMoney(account.toTransferMinor, { compact: true })}
                      </T>
                      <T variant="caption" tone="muted">
                        {done
                          ? 'all transferred'
                          : `${account.pendingCount} line${account.pendingCount === 1 ? '' : 's'} to fund`}
                      </T>
                    </View>
                  </Row>

                  <FundingBar pct={pct} color={brand.color} surplus={done} />

                  <Row justify="space-between">
                    <T variant="caption" tone="muted">
                      {formatMoney(account.movedMinor)} moved
                    </T>
                    <T variant="caption" tone="muted">
                      of {formatMoney(account.plannedMinor)}
                    </T>
                  </Row>
                </Surface>
              );
            })}
          </View>
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
              <T variant="caption" tone="muted">
                Outstanding
              </T>
              <T variant="figureLarge">{formatMoney(loanOutstanding, { compact: true })}</T>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <T variant="caption" tone="muted">
                Per month
              </T>
              <T variant="figureLarge" color={colors.pending}>
                {formatMoney(loanMonthly, { compact: true })}
              </T>
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
        <T
          variant="label"
          color="rgba(255,255,255,0.65)"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {label}
        </T>
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
        <T
          variant="figure"
          color="#FFFFFF"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {value}
        </T>
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
      <T variant="caption" tone="secondary" numberOfLines={1} style={{ fontWeight: '600' }}>
        {label}
      </T>
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
  const when = overdue
    ? `${Math.abs(reminder.daysUntil)} day${Math.abs(reminder.daysUntil) === 1 ? '' : 's'} overdue`
    : reminder.daysUntil === 0
      ? 'Due today'
      : `Due in ${reminder.daysUntil} day${reminder.daysUntil === 1 ? '' : 's'}`;

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
        <T variant="bodyStrong" numberOfLines={1}>
          {reminder.subcategory.name}
        </T>
        <Row gap={space.xs}>
          <T variant="caption" color={accent} style={{ fontWeight: '700' }}>
            {when}
          </T>
          <T variant="caption" tone="muted" numberOfLines={1}>
            · {reminder.categoryName}
            {reminder.categoryTransferred ? ' · money ready' : ''}
          </T>
        </Row>
      </View>

      <T variant="figure">{formatMoney(reminder.amountMinor, { compact: true })}</T>
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
      <T variant="caption" color="rgba(255,255,255,0.85)">
        {label}
      </T>
    </Row>
  );
}
