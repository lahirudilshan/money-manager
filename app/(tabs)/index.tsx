import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankLogo } from '../../src/components/BankLogo';
import { useTabBarClearance } from '../../src/components/TabBar';
import {
  Divider,
  Empty,
  FundingBar,
  GradientCard,
  Label,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { formatMoney } from '../../src/core/money';
import { formatPeriod, shiftPeriod } from '../../src/core/planning';
import { resolveBrand } from '../../src/data/banks';
import {
  selectAccountTransfers,
  selectBoardTotals,
  selectCategoryViews,
  selectRatios,
  selectReminders,
  selectTotalIncome,
  useAppStore,
  type ReminderView,
} from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * The dashboard: what needs doing, and where the money has to go.
 *
 * Ordered by urgency rather than structure — reminders first (the app exists
 * because the user forgets whether a payment went out), then the per-account
 * transfer list that answers "how much do I move to each bank", then the
 * month's overall shape. The full category tree lives on the List tab.
 */
export default function DashboardScreen() {
  const { colors, space } = useTheme();
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

  const overdue = reminders.filter((r) => r.urgency === 'overdue');
  const dueSoon = reminders.filter((r) => r.urgency === 'due_soon');
  const actionable = [...overdue, ...dueSoon].slice(0, 6);

  const totalToTransfer = accounts.reduce((sum, a) => sum + a.toTransferMinor, 0);
  const paidCount = totals.categoryCount > 0 ? totals.settledCategoryCount : 0;

  return (
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
      {/* Month switcher — everything below is scoped to this period. */}
      <Row justify="space-between" align="center">
        <Label>DASHBOARD</Label>
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
          <View style={{ minWidth: 132, alignItems: 'center', justifyContent: 'center' }}>
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

      {/* Headline: what's left after the whole plan. */}
      <GradientCard>
        <View style={{ gap: space.lg }}>
          <View style={{ gap: 2 }}>
            <Label color="rgba(255,255,255,0.75)">LEFT AFTER PLAN</Label>
            <T variant="hero" color="#FFFFFF">
              {formatMoney(ratios.disposableMinor)}
            </T>
          </View>

          <Row gap={space.xxl}>
            <HeroStat label="INCOME" value={formatMoney(income, { compact: true })} />
            <HeroStat label="PLANNED" value={formatMoney(totals.plannedMinor, { compact: true })} />
            <HeroStat
              label="TRANSFERRED"
              value={formatMoney(totals.fundedMinor, { compact: true })}
            />
          </Row>

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
              {ratios.loanPct > 0 ? (
                <View style={{ flex: ratios.loanPct, backgroundColor: '#FFFFFF' }} />
              ) : null}
              {ratios.livingPct > 0 ? (
                <View
                  style={{ flex: ratios.livingPct, backgroundColor: 'rgba(255,255,255,0.65)' }}
                />
              ) : null}
              {ratios.freePct > 0 ? (
                <View style={{ flex: ratios.freePct, backgroundColor: 'rgba(255,255,255,0.3)' }} />
              ) : null}
            </View>
            <Row gap={space.lg}>
              <LegendDot shade={1} label={`Loans ${ratios.loanPct.toFixed(0)}%`} />
              <LegendDot shade={0.65} label={`Living ${ratios.livingPct.toFixed(0)}%`} />
              <LegendDot shade={0.4} label={`Free ${ratios.freePct.toFixed(0)}%`} />
            </Row>
          </View>
        </View>
      </GradientCard>

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

              return (
                <Surface
                  key={account.card.id}
                  onPress={() => router.push('/(tabs)/cards')}
                  style={{ gap: space.md }}
                >
                  <Row gap={space.md}>
                    <BankLogo brand={brand} size={42} />
                    <View style={{ flex: 1 }}>
                      <T variant="bodyStrong" numberOfLines={1}>
                        {account.card.name}
                      </T>
                      <T variant="caption" tone="muted" numberOfLines={1}>
                        {account.categoryNames.slice(0, 3).join(' · ') || 'No categories'}
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

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Label color="rgba(255,255,255,0.65)">{label}</Label>
      <T variant="figureLarge" color="#FFFFFF">
        {value}
      </T>
    </View>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Row justify="space-between">
      <T variant="small" tone="secondary">
        {label}
      </T>
      <T variant="figure" color={color}>
        {value}
      </T>
    </Row>
  );
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
