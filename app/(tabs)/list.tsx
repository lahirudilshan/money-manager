import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountField } from '../../src/components/AccountPicker';
import { BankLogo } from '../../src/components/BankLogo';
import { DayPicker } from '../../src/components/DayPicker';
import {
  emptySavingPlanDraft,
  SavingPlanFields,
  toSavingPlanPatch,
  type SavingPlanDraft,
} from '../../src/components/SavingPlanFields';
import { AmountField, Field, FrequencyPicker } from '../../src/components/forms';
import type { SubcategoryFrequency } from '../../src/db/schema';
import { useTabBarClearance } from '../../src/components/TabBar';
import {
  BottomSheet,
  Divider,
  Empty,
  GradientButton,
  Label,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { formatDateLabel, startOfDay } from '../../src/core/dates';
import { formatMoney, parseAmount } from '../../src/core/money';
import {
  dueDateFor,
  effectiveAmount,
  formatPeriod,
  isFlexibleDueDay,
  monthlyAmount,
  planHealth,
  resolveCardId,
  type BoardTotals,
  type PlanHealth,
} from '../../src/core/planning';
import { resolveBrand } from '../../src/data/banks';
import {
  selectBoardTotals,
  selectCategoryViews,
  selectRatios,
  selectTotalIncome,
  useAppStore,
  type CategoryView,
} from '../../src/store/useAppStore';
import { HEALTH_VISUALS, statusStyle, washFor } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Filter = 'all' | 'unpaid' | 'paid';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unpaid', label: 'To pay' },
  { key: 'paid', label: 'Paid' },
];

const animate = () =>
  LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'));

/**
 * The plan, as a feed of category cards you can act on in place.
 *
 * Each card carries the category's identity, its bulk-transfer state (one tap
 * to mark the salary money moved to its account), a paid-progress bar, and —
 * when expanded — its bills as a checklist with a big tap target per line and
 * an "Add bill" action. Reading the plan and working through it happen on the
 * same screen; the detail pages are only for settings and per-bill edits.
 */
export default function ListScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const state = useAppStore();
  const views = useMemo(() => selectCategoryViews(state), [state]);
  const totals = useMemo(() => selectBoardTotals(state), [state]);

  // Plan insights for the top card — the "what stands out" the dashboard
  // doesn't already show. Derived here from the same views the list renders.
  const insights = useMemo(
    () => computePlanInsights(views, state.period),
    [views, state.period],
  );

  // Graded from the same numbers the dashboard uses, so both headline cards
  // reach the same verdict about the month.
  const ratios = useMemo(() => selectRatios(state), [state]);
  const income = useMemo(() => selectTotalIncome(state), [state]);
  const health = planHealth({
    incomeMinor: income,
    freePct: ratios.freePct,
    disposableMinor: ratios.disposableMinor,
  });

  // Everything starts expanded — the plan is meant to be worked through, not
  // hunted for. Collapsing is opt-in per card, or all at once.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [addingToCategoryId, setAddingToCategoryId] = useState<string | null>(null);
  const [showingPlanDetail, setShowingPlanDetail] = useState(false);

  const addingToCategory = views.find((v) => v.category.id === addingToCategoryId)?.category;
  const allCollapsed = views.length > 0 && collapsed.size === views.length;

  function toggle(categoryId: string) {
    animate();
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function toggleAll() {
    animate();
    setCollapsed(allCollapsed ? new Set() : new Set(views.map((v) => v.category.id)));
  }

  // Search + status filter both hide bills; a category left with none drops
  // out entirely. A category whose *own* name matches keeps all its bills, so
  // searching "Housing" shows the whole group rather than nothing.
  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (filter === 'all' && !query) return views;

    return views
      .map((view) => {
        const categoryMatches = view.category.name.toLowerCase().includes(query);
        return {
          ...view,
          subcategories: view.subcategories.filter((sub) => {
            const passesStatus =
              filter === 'all'
                ? true
                : filter === 'paid'
                  ? sub.status === 'paid'
                  : sub.status !== 'paid';
            const passesSearch =
              !query || categoryMatches || sub.name.toLowerCase().includes(query);
            return passesStatus && passesSearch;
          }),
        };
      })
      .filter((view) => view.subcategories.length > 0);
  }, [views, filter, query]);

  const paidPct =
    totals.plannedMinor > 0 ? Math.round((totals.paidMinor / totals.plannedMinor) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Fixed header — stays pinned while the plan scrolls beneath it. */}
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
            <Label>{formatPeriod(state.period)}</Label>
            <T variant="title">Your plan</T>
          </View>
          <Pressable
            onPress={() => router.push('/category/new')}
            accessibilityRole="button"
            accessibilityLabel="New category"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingVertical: 8,
              paddingHorizontal: space.md,
              borderRadius: 999,
              backgroundColor: colors.accent,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="add" size={16} color={colors.inkInverse} />
            <T variant="caption" color={colors.inkInverse} style={{ fontWeight: '700' }}>
              Category
            </T>
          </Pressable>
        </Row>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: space.md,
          paddingBottom: tabClearance,
          paddingHorizontal: space.lg,
          gap: space.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {views.length > 0 ? (
          <PlanInsightsCard
            insights={insights}
            paidPct={paidPct}
            health={health}
            onPress={() => setShowingPlanDetail(true)}
          />
        ) : null}

      {/* Search — find a bill without scrolling the whole plan. */}
      {views.length > 0 ? (
        <Row
          gap={space.sm}
          style={{
            backgroundColor: colors.surface,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.hairline,
            paddingHorizontal: space.md,
            paddingVertical: 2,
          }}
        >
          <Ionicons name="search" size={16} color={colors.inkMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search bills or categories"
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel="Search bills"
            returnKeyType="search"
            style={{
              flex: 1,
              paddingVertical: 10,
              fontSize: 15,
              color: colors.ink,
            }}
          />
          {search.length > 0 ? (
            <Pressable
              onPress={() => setSearch('')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Ionicons name="close-circle" size={17} color={colors.inkMuted} />
            </Pressable>
          ) : null}
        </Row>
      ) : null}

      {/* Filters + collapse control. */}
      {views.length > 0 ? (
        <Row justify="space-between" align="center">
          <Row
            gap={0}
            style={{
              backgroundColor: colors.surfaceSunken,
              borderRadius: 999,
              padding: 3,
            }}
          >
            {FILTERS.map((option) => {
              const selected = filter === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setFilter(option.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => ({
                    paddingVertical: 6,
                    paddingHorizontal: space.md,
                    borderRadius: 999,
                    backgroundColor: selected ? colors.surface : 'transparent',
                    opacity: pressed ? 0.8 : 1,
                    ...(selected
                      ? { borderWidth: 1, borderColor: colors.hairline }
                      : {}),
                  })}
                >
                  <T
                    variant="caption"
                    color={selected ? colors.ink : colors.inkSecondary}
                    style={{ fontWeight: selected ? '700' : '500' }}
                  >
                    {option.label}
                  </T>
                </Pressable>
              );
            })}
          </Row>

          <Pressable
            onPress={toggleAll}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons
              name={allCollapsed ? 'chevron-down' : 'chevron-up'}
              size={14}
              color={colors.accent}
            />
            <T variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
              {allCollapsed ? 'Expand' : 'Collapse'}
            </T>
          </Pressable>
        </Row>
      ) : null}

      {filtered.length === 0 ? (
        <Empty
          icon={query ? 'search-outline' : 'albums-outline'}
          title={
            views.length === 0 ? 'Nothing planned' : query ? 'No matches' : 'Nothing here'
          }
          message={
            views.length === 0
              ? 'Create a category, then add the bills you pay each month.'
              : query
                ? `Nothing matches "${search.trim()}".`
                : filter === 'paid'
                  ? 'No bills paid yet this month.'
                  : 'Everything is paid. Nice.'
          }
          actionLabel={views.length === 0 ? 'Create a category' : undefined}
          onAction={views.length === 0 ? () => router.push('/category/new') : undefined}
        />
      ) : (
        <View style={{ gap: space.md }}>
          {filtered.map((view) => (
            <CategoryCard
              key={view.category.id}
              view={view}
              collapsed={collapsed.has(view.category.id)}
              onToggleCollapsed={() => toggle(view.category.id)}
              onOpenSettings={() => router.push(`/category/${view.category.id}`)}
              onOpenBill={(id) => router.push(`/subcategory/${id}`)}
              onAddBill={() => setAddingToCategoryId(view.category.id)}
            />
          ))}
        </View>
      )}

        <AddSubcategorySheet
          category={addingToCategory}
          onClose={() => setAddingToCategoryId(null)}
        />

        <PlanDetailSheet
          visible={showingPlanDetail}
          onClose={() => setShowingPlanDetail(false)}
          insights={insights}
          paidPct={paidPct}
          totals={totals}
          health={health}
        />
      </ScrollView>
    </View>
  );
}

/** One unpaid bill, with the due date the insights card sorts and groups by. */
interface DueLine {
  id: string;
  name: string;
  categoryName: string;
  categoryColor: string;
  amountMinor: number;
  /** Null for lines with no fixed day — they can never be "overdue". */
  dueDate: Date | null;
  overdue: boolean;
}

interface PlanInsights {
  /** The single largest category by planned/effective spend. */
  biggest: { name: string; color: string; icon: string; totalMinor: number } | null;
  /** Categories whose logged actuals exceed their plan, and by how much. */
  overBudget: { count: number; overspendMinor: number; topName: string | null };
  /** Bills still to pay this month. */
  unpaid: { count: number; amountMinor: number };
  /** Unpaid bills already past their due date — the one urgent thing here. */
  overdue: { count: number; amountMinor: number };
  /** The next bill falling due, for the "what's next" line. */
  nextDue: DueLine | null;
  /** Every unpaid line, soonest first, for the detail sheet. */
  dueLines: DueLine[];
}

/** Derive the "what stands out" insights the dashboard doesn't already show. */
function computePlanInsights(views: CategoryView[], period: string): PlanInsights {
  let biggest: PlanInsights['biggest'] = null;
  let overCount = 0;
  let overspend = 0;
  let overTopName: string | null = null;
  let overTopAmount = 0;
  let unpaidCount = 0;
  let unpaidAmount = 0;
  const dueLines: DueLine[] = [];

  // Compared against due dates, which are whole days — so "due today" is not
  // overdue partway through the day.
  const today = startOfDay(new Date());

  for (const view of views) {
    const total = view.summary.totalMinor;
    if (!biggest || total > biggest.totalMinor) {
      biggest = {
        name: view.category.name,
        color: view.category.color,
        icon: view.category.icon,
        totalMinor: total,
      };
    }

    // Category-level over-budget: sum of actuals beyond their planned amounts.
    let catOver = 0;
    for (const line of view.subcategories) {
      if (line.actualMinor != null && line.actualMinor > line.plannedMinor) {
        catOver += line.actualMinor - line.plannedMinor;
      }
      if (line.status !== 'paid') {
        unpaidCount += 1;
        // Monthly basis, matching the PLANNED total this sits beside — a yearly
        // bill contributes its monthly share, not its full face value.
        const amount = monthlyAmount(line);
        unpaidAmount += amount;

        // The due day lives on the raw row, not the planned view. Fall back to
        // the category's day, matching what the bill detail screen shows.
        const raw = view.rawSubcategories.find((s) => s.id === line.id);
        const dueDay = raw?.dueDay ?? view.category.dueDay ?? null;
        const hasFixedDay = dueDay != null && !isFlexibleDueDay(dueDay);
        const dueDate = hasFixedDay ? dueDateFor(period, dueDay) : null;

        dueLines.push({
          id: line.id,
          name: line.name,
          categoryName: view.category.name,
          categoryColor: view.category.color,
          amountMinor: amount,
          dueDate,
          overdue: dueDate != null && dueDate < today,
        });
      }
    }
    if (catOver > 0) {
      overCount += 1;
      overspend += catOver;
      if (catOver > overTopAmount) {
        overTopAmount = catOver;
        overTopName = view.category.name;
      }
    }
  }

  // Soonest first; undated lines sort last, since they carry no urgency and
  // would otherwise jump the queue ahead of real deadlines.
  dueLines.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return b.amountMinor - a.amountMinor;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.getTime() - b.dueDate.getTime();
  });

  const overdueLines = dueLines.filter((line) => line.overdue);

  return {
    biggest,
    overBudget: { count: overCount, overspendMinor: overspend, topName: overTopName },
    unpaid: { count: unpaidCount, amountMinor: unpaidAmount },
    overdue: {
      count: overdueLines.length,
      amountMinor: overdueLines.reduce((sum, line) => sum + line.amountMinor, 0),
    },
    // The next thing actually coming up — skip anything already overdue, which
    // has its own louder row above it.
    nextDue: dueLines.find((line) => line.dueDate != null && !line.overdue) ?? null,
    dueLines,
  };
}

/**
 * The plan's headline card — plan *insights*, not the income/planned totals the
 * dashboard already shows. Leads with how much of the plan is paid off, then
 * surfaces what stands out: the biggest category, anything over budget, and
 * what's still to pay. Each is a scannable row so you know where to look.
 */
function PlanInsightsCard({
  insights,
  paidPct,
  health,
  onPress,
}: {
  insights: PlanInsights;
  paidPct: number;
  health: PlanHealth;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const { biggest, overBudget, unpaid, overdue, nextDue } = insights;
  const visual = HEALTH_VISUALS[health];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Plan ${paidPct}% paid off, ${visual.label}. ${unpaid.count} bills still to pay. Tap for details.`}
      style={({ pressed }) => ({
        borderRadius: radius.xl,
        overflow: 'hidden',
        opacity: pressed ? 0.92 : 1,
      })}
    >
      {/* Same health gradient as the dashboard hero, so the two headline cards
          agree about the month rather than one always reading celebratory. */}
      <LinearGradient
        colors={visual.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: space.lg, gap: space.md }}
      >
        {/* Paid-off progress headline. */}
        <View style={{ gap: 6 }}>
          <Row justify="space-between" align="center">
            <Row gap={4}>
              <Ionicons name={visual.icon as never} size={13} color="rgba(255,255,255,0.9)" />
              <T variant="caption" color="rgba(255,255,255,0.9)" style={{ fontWeight: '800' }}>
                {visual.label}
              </T>
            </Row>
            <Row gap={4}>
              <Label color="rgba(255,255,255,0.75)">PAID OFF</Label>
              <T variant="figureLarge" color="#FFFFFF">
                {paidPct}%
              </T>
              {/* Marks the whole card as openable — the rows below are a summary
                  of a longer list, and nothing else here suggests that. */}
              <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.75)" />
            </Row>
          </Row>
          <View
            style={{
              height: 8,
              borderRadius: radius.pill,
              backgroundColor: 'rgba(255,255,255,0.25)',
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.max(0, Math.min(100, paidPct))}%`,
                height: '100%',
                borderRadius: radius.pill,
                backgroundColor: '#FFFFFF',
              }}
            />
          </View>
        </View>

        {/* Insight rows on a translucent gradient panel — washed lighter at the
            top-left and fading out, matching the dashboard's stat tiles. Built
            from white alpha rather than fixed hues so it sits correctly over
            every health gradient without a variant per state. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.08)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: radius.lg,
            paddingHorizontal: space.md,
          }}
        >
          {/* Overdue leads when it exists — it is the only thing here that is
              already costing the user something. */}
          {overdue.count > 0 ? (
            <InsightRow
              icon="alert-circle"
              label={overdue.count === 1 ? '1 overdue' : `${overdue.count} overdue`}
              detail="Past its due date"
              value={formatMoney(overdue.amountMinor, { compact: true })}
              valueColor="#FFD9DE"
              first
            />
          ) : null}

          {biggest && biggest.totalMinor > 0 ? (
            <InsightRow
              icon={(biggest.icon as keyof typeof Ionicons.glyphMap) ?? 'albums-outline'}
              label="Biggest category"
              detail={biggest.name}
              value={formatMoney(biggest.totalMinor, { compact: true })}
              first={overdue.count === 0}
            />
          ) : null}

          {overBudget.count > 0 ? (
            <InsightRow
              icon="trending-up"
              label={overBudget.count === 1 ? 'Over budget' : `${overBudget.count} over budget`}
              detail={overBudget.topName ? `${overBudget.topName} the most` : undefined}
              value={`+${formatMoney(overBudget.overspendMinor, { compact: true })}`}
              valueColor="#FFD9DE"
            />
          ) : null}

          {/* What is coming next — the plan's most actionable line, and the one
              thing the card could not answer before. */}
          {nextDue?.dueDate ? (
            <InsightRow
              icon="calendar-outline"
              label={`Next: ${nextDue.name}`}
              detail={`${nextDue.categoryName} · ${formatDateLabel(nextDue.dueDate)}`}
              value={formatMoney(nextDue.amountMinor, { compact: true })}
            />
          ) : null}

          <InsightRow
            icon={unpaid.count === 0 ? 'checkmark-circle' : 'time-outline'}
            label={unpaid.count === 0 ? 'All paid' : `${unpaid.count} still to pay`}
            detail={unpaid.count === 0 ? 'Nothing left this month' : undefined}
            value={unpaid.count === 0 ? undefined : formatMoney(unpaid.amountMinor, { compact: true })}
            last
          />
        </LinearGradient>
      </LinearGradient>
    </Pressable>
  );
}

/**
 * The full picture behind the insights card — every unpaid bill, soonest first.
 *
 * The card can only show three or four lines, so it summarises: "14 still to
 * pay" answers *how much* but never *which*. This sheet answers that, grouped
 * into overdue / dated / undated so the ordering is legible rather than an
 * unexplained sequence. Tapping a bill opens it, making this a route into the
 * plan rather than a dead-end readout.
 */
function PlanDetailSheet({
  visible,
  onClose,
  insights,
  paidPct,
  totals,
  health,
}: {
  visible: boolean;
  onClose: () => void;
  insights: PlanInsights;
  paidPct: number;
  totals: BoardTotals;
  health: PlanHealth;
}) {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const { dueLines, overdue, unpaid } = insights;
  const visual = HEALTH_VISUALS[health];

  const overdueLines = dueLines.filter((line) => line.overdue);
  const upcoming = dueLines.filter((line) => !line.overdue && line.dueDate != null);
  const undated = dueLines.filter((line) => line.dueDate == null);

  const openLine = (id: string) => {
    onClose();
    router.push(`/subcategory/${id}`);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Plan details"
      eyebrow="This month"
      icon="stats-chart-outline"
      iconColor={colors.accent}
      scroll
    >
      {/* Hero — the same gradient the card wears, so opening it feels like the
          card expanded rather than a different screen. Leads with what is
          actually left to pay, since that is the question the sheet answers. */}
      <View style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
        <LinearGradient
          colors={visual.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: space.lg, gap: space.md }}
        >
          <Row justify="space-between" align="center">
            <Label color="rgba(255,255,255,0.75)">STILL TO PAY</Label>
            <Row gap={4}>
              <Ionicons name={visual.icon as never} size={13} color="rgba(255,255,255,0.9)" />
              <T variant="caption" color="rgba(255,255,255,0.9)" style={{ fontWeight: '800' }}>
                {visual.label}
              </T>
            </Row>
          </Row>

          <View style={{ gap: 2 }}>
            <T variant="display" color="#FFFFFF">
              {formatMoney(unpaid.amountMinor)}
            </T>
            <T variant="caption" color="rgba(255,255,255,0.8)">
              {unpaid.count === 0
                ? 'Every bill is settled'
                : `across ${unpaid.count} ${unpaid.count === 1 ? 'bill' : 'bills'}`}
              {overdue.count > 0 ? ` · ${overdue.count} overdue` : ''}
            </T>
          </View>

          {/* Progress, on the hero rather than a section of its own — it is a
              property of these figures, not a separate topic. */}
          <View style={{ gap: 6 }}>
            <View
              style={{
                height: 8,
                borderRadius: radius.pill,
                backgroundColor: 'rgba(255,255,255,0.25)',
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.max(0, Math.min(100, paidPct))}%`,
                  height: '100%',
                  borderRadius: radius.pill,
                  backgroundColor: '#FFFFFF',
                }}
              />
            </View>
            <Row justify="space-between">
              <T variant="caption" color="rgba(255,255,255,0.8)">
                {formatMoney(totals.paidMinor, { compact: true })} paid
              </T>
              <T variant="caption" color="rgba(255,255,255,0.8)">
                {paidPct}% of {formatMoney(totals.plannedMinor, { compact: true })}
              </T>
            </Row>
          </View>
        </LinearGradient>
      </View>

      {overdueLines.length > 0 ? (
        <DueGroup
          label="Overdue"
          caption="Past their due date"
          icon="alert-circle"
          tint={colors.danger}
          lines={overdueLines}
          onPress={openLine}
        />
      ) : null}

      {upcoming.length > 0 ? (
        <DueGroup
          label="Coming up"
          caption="Soonest first"
          icon="calendar-outline"
          tint={colors.accent}
          lines={upcoming}
          onPress={openLine}
        />
      ) : null}

      {undated.length > 0 ? (
        <DueGroup
          label="No fixed date"
          caption="Pay any time this month"
          icon="infinite-outline"
          tint={colors.inkSecondary}
          lines={undated}
          onPress={openLine}
        />
      ) : null}

      {dueLines.length === 0 ? (
        <Empty
          icon="checkmark-circle-outline"
          title="All paid"
          message="Every bill in this month's plan is settled."
        />
      ) : null}
    </BottomSheet>
  );
}

/**
 * A titled block of unpaid bills in the detail sheet.
 *
 * The group's total sits in its header, so each section answers "how much is
 * this bucket" without the user adding rows up. Rows are one connected card
 * with hairline dividers rather than separately-bordered tiles — three stacked
 * groups of bordered rows read as noise.
 */
function DueGroup({
  label,
  caption,
  icon,
  lines,
  tint,
  onPress,
}: {
  label: string;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  lines: DueLine[];
  tint: string;
  onPress: (id: string) => void;
}) {
  const { colors, mode, radius, space } = useTheme();
  const total = lines.reduce((sum, line) => sum + line.amountMinor, 0);

  return (
    <View style={{ gap: space.sm }}>
      <Row justify="space-between" align="center">
        <Row gap={6}>
          <Ionicons name={icon} size={14} color={tint} />
          <T variant="small" color={tint} style={{ fontWeight: '800' }}>
            {label}
          </T>
          {/* The count as a pill, so the header states size and value at once. */}
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 1,
              borderRadius: radius.pill,
              backgroundColor: colors.surfaceSunken,
            }}
          >
            <T variant="caption" tone="muted" style={{ fontWeight: '700' }}>
              {lines.length}
            </T>
          </View>
        </Row>
        <T variant="figure" color={tint}>
          {formatMoney(total, { compact: true })}
        </T>
      </Row>

      <T variant="caption" tone="muted">
        {caption}
      </T>

      <View
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.hairline,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        }}
      >
        {lines.map((line, index) => (
          <Pressable
            key={line.id}
            onPress={() => onPress(line.id)}
            accessibilityRole="button"
            accessibilityLabel={`${line.name}, ${line.categoryName}, ${formatMoney(line.amountMinor)}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingVertical: 11,
              paddingHorizontal: space.md,
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: colors.hairline,
              backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
            })}
          >
            {/* A tinted chip in the category's own colour — enough to place the
                bill at a glance without a legend. */}
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: radius.sm,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: washFor(line.categoryColor, mode),
              }}
            >
              <Ionicons name="pricetag" size={13} color={line.categoryColor} />
            </View>

            <View style={{ flex: 1, gap: 1 }}>
              <T variant="small" numberOfLines={1} style={{ fontWeight: '600' }}>
                {line.name}
              </T>
              <T variant="caption" tone="muted" numberOfLines={1}>
                {line.categoryName}
                {line.dueDate ? ` · ${formatDateLabel(line.dueDate)}` : ''}
              </T>
            </View>

            <T variant="figure">{formatMoney(line.amountMinor)}</T>
            <Ionicons name="chevron-forward" size={14} color={colors.inkFaint} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** One insight line inside the top card: icon + label/detail + trailing value. */
function InsightRow({
  icon,
  label,
  detail,
  value,
  valueColor,
  first,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string;
  value?: string;
  valueColor?: string;
  first?: boolean;
  last?: boolean;
}) {
  const { space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: 11,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(255,255,255,0.18)',
      }}
    >
      <LinearGradient
        colors={['rgba(255,255,255,0.34)', 'rgba(255,255,255,0.12)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={16} color="#FFFFFF" />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <T variant="small" color="#FFFFFF" style={{ fontWeight: '700' }} numberOfLines={1}>
          {label}
        </T>
        {detail ? (
          <T variant="caption" color="rgba(255,255,255,0.75)" numberOfLines={1}>
            {detail}
          </T>
        ) : null}
      </View>
      {value ? (
        <T variant="figure" color={valueColor ?? '#FFFFFF'}>
          {value}
        </T>
      ) : null}
    </View>
  );
}

function ProgressBar({ pct, color, height = 8 }: { pct: number; color: string; height?: number }) {
  const { colors, radius } = useTheme();
  return (
    <View
      style={{
        height,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceSunken,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/**
 * A category as a card: tinted header (identity + transfer chip + amount),
 * a paid-progress bar, then its bills as a tap-to-pay checklist ending in an
 * "Add bill" row. The header's chevron collapses just the bills.
 */
function CategoryCard({
  view,
  collapsed,
  onToggleCollapsed,
  onOpenSettings,
  onOpenBill,
  onAddBill,
}: {
  view: CategoryView;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenSettings: () => void;
  onOpenBill: (subcategoryId: string) => void;
  onAddBill: () => void;
}) {
  const { colors, radius, space, mode } = useTheme();
  const state = useAppStore();
  const { category, card, summary, subcategories } = view;

  const transferred = view.transferStatus === 'transferred';
  const transferStyle = statusStyle('transferred', colors);
  const paidPct =
    summary.subcategoryCount > 0
      ? Math.round((summary.counts.paid / summary.subcategoryCount) * 100)
      : 0;

  // A faint wash of the category colour ties the card to its identity without
  // shouting; the header icon carries the full-strength colour.
  const headerBg = mode === 'dark' ? colors.surfaceRaised : `${category.color}0D`;

  return (
    // A full-strength border (not the default hairline) plus the category's
    // own tint on the edge makes each group read as a distinct card rather
    // than one continuous list.
    <Surface
      padded={false}
      style={{
        overflow: 'hidden',
        borderWidth: 1.5,
        borderColor: collapsed ? colors.hairlineStrong : `${category.color}55`,
      }}
    >
      {/* Header. */}
      <View style={{ backgroundColor: headerBg, padding: space.lg, gap: space.md }}>
        <Row gap={space.md}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.md,
              backgroundColor: category.color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={category.icon as never} size={22} color="#FFFFFF" />
          </View>

          <Pressable
            onPress={onToggleCollapsed}
            accessibilityRole="button"
            accessibilityState={{ expanded: !collapsed }}
            style={{ flex: 1 }}
          >
            <T variant="bodyStrong" numberOfLines={1}>
              {category.name}
            </T>
            <T variant="caption" tone="muted" numberOfLines={1}>
              {summary.counts.paid}/{summary.subcategoryCount} paid
              {card ? ` · ${card.name}` : ''}
            </T>
          </Pressable>

          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <T variant="figureLarge">{formatMoney(summary.totalMinor, { compact: true })}</T>
            <Pressable
              onPress={onToggleCollapsed}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={collapsed ? 'Expand' : 'Collapse'}
            >
              <Ionicons
                name={collapsed ? 'chevron-down' : 'chevron-up'}
                size={18}
                color={colors.inkMuted}
              />
            </Pressable>
          </View>
        </Row>

        {/* Transfer toggle — the bulk salary→account move, one tap. Income
            categories skip it: that money arrives in the account by itself. */}
        {view.isIncomeOnly ? null : (
        <Pressable
          onPress={() => state.toggleCategoryTransfer(category.id)}
          accessibilityRole="button"
          accessibilityState={{ checked: transferred }}
          accessibilityLabel={`Bulk transfer ${transferred ? 'done' : 'not done'}. Tap to toggle.`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingVertical: 9,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            backgroundColor: transferred ? transferStyle.bg : colors.surface,
            borderWidth: 1,
            borderColor: transferred ? transferStyle.fg : colors.hairline,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons
            name={transferred ? 'checkmark-circle' : 'swap-horizontal'}
            size={18}
            color={transferred ? transferStyle.fg : colors.inkSecondary}
          />
          <T
            variant="small"
            color={transferred ? transferStyle.fg : colors.inkSecondary}
            style={{ flex: 1, fontWeight: '600' }}
          >
            {transferred ? 'Money transferred to account' : 'Mark money transferred'}
          </T>
          {!transferred && summary.totalMinor > 0 ? (
            <T variant="caption" tone="muted">
              {formatMoney(summary.totalMinor, { compact: true })}
            </T>
          ) : null}
        </Pressable>
        )}

        <ProgressBar pct={paidPct} color={category.color} height={6} />
      </View>

      {/* Bills. */}
      {!collapsed ? (
        <View>
          {subcategories.map((line, index) => {
            const raw = view.rawSubcategories.find((s) => s.id === line.id);
            const paid = line.status === 'paid';
            const amount = effectiveAmount(line);
            // Show planned vs. actual side by side when a real amount was logged
            // that differs from the plan, so the row tells you at a glance whether
            // it came in over/under. `amount` (actual-or-planned) stays the figure.
            const hasActual = line.actualMinor != null && line.actualMinor !== line.plannedMinor;
            // Unplanned lines are never "paid" as a whole — their spend is a
            // running total of entries — so they get an indicator, not a
            // tap-to-pay checkbox.
            const unplanned = raw?.frequency === 'unplanned';

            return (
              <View key={line.id}>
                {index === 0 ? null : <Divider style={{ marginLeft: space.lg }} />}
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {unplanned ? (
                    // Non-interactive marker: this line tracks many entries.
                    <View
                      style={{
                        paddingLeft: space.lg,
                        paddingRight: space.sm,
                        paddingVertical: space.md,
                      }}
                      accessible
                      accessibilityLabel={`${line.name}, unplanned`}
                    >
                      <View
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: colors.accentSoft,
                        }}
                      >
                        <Ionicons name="list" size={15} color={colors.accent} />
                      </View>
                    </View>
                  ) : (
                    /* Big checkbox tap target: pay / unpay. */
                    <Pressable
                      onPress={() => state.cycleStatus(line.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: paid }}
                      accessibilityLabel={`${line.name}, ${paid ? 'paid' : 'not paid'}`}
                      hitSlop={6}
                      style={({ pressed }) => ({
                        paddingLeft: space.lg,
                        paddingRight: space.sm,
                        paddingVertical: space.md,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <View
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: paid ? colors.completed : 'transparent',
                          borderWidth: paid ? 0 : 2,
                          borderColor: colors.hairlineStrong,
                        }}
                      >
                        {paid ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                      </View>
                    </Pressable>
                  )}

                  {/* Row body: open the bill's detail. */}
                  <Pressable
                    onPress={() => onOpenBill(line.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${line.name}, ${formatMoney(amount)}. Open detail.`}
                    style={({ pressed }) => ({
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingRight: space.lg,
                      paddingVertical: space.md,
                      gap: space.sm,
                      backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                    })}
                  >
                    <View style={{ flex: 1 }}>
                      <T
                        variant="body"
                        numberOfLines={1}
                        // Unplanned lines are never "settled", so they keep full
                        // ink and no strike-through even when their sum > 0.
                        tone={paid && !unplanned ? 'muted' : 'ink'}
                        style={paid && !unplanned ? { textDecorationLine: 'line-through' } : undefined}
                      >
                        {line.name}
                      </T>
                      <T variant="caption" tone="muted">
                        {unplanned
                          ? 'Unplanned · tap to see entries'
                          : `${
                              isFlexibleDueDay(raw?.dueDay ?? category.dueDay)
                                ? 'Flexible'
                                : `Day ${raw?.dueDay ?? category.dueDay}`
                            }${
                              raw?.frequency && raw.frequency !== 'monthly'
                                ? ` · ${raw.frequency.replace('_', '-')}`
                                : ''
                            }`}
                      </T>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <T
                        variant="figure"
                        // When a real amount was logged, colour it by over/under
                        // the plan; otherwise dim it only once the bill is paid.
                        color={
                          hasActual && !unplanned
                            ? line.actualMinor! > line.plannedMinor
                              ? colors.danger
                              : colors.completed
                            : undefined
                        }
                        tone={paid && !unplanned && !hasActual ? 'muted' : 'ink'}
                      >
                        {formatMoney(amount, { compact: true })}
                      </T>
                      {hasActual && !unplanned ? (
                        <T
                          variant="caption"
                          tone="muted"
                          style={{ textDecorationLine: 'line-through' }}
                        >
                          {formatMoney(line.plannedMinor, { compact: true })}
                        </T>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} />
                  </Pressable>
                </View>
              </View>
            );
          })}

          {subcategories.length > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}

          {/* Action bar: a prominent "Add bill" button next to a distinct
              "edit category" icon, on a subtle footer so it reads as actions. */}
          <Row
            gap={space.sm}
            style={{
              padding: space.md,
              backgroundColor: colors.surfaceSunken,
            }}
          >
            <Pressable
              onPress={onAddBill}
              accessibilityRole="button"
              accessibilityLabel={`Add a bill to ${category.name}`}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 11,
                borderRadius: radius.md,
                backgroundColor: pressed ? `${category.color}22` : `${category.color}14`,
              })}
            >
              <Ionicons name="add" size={18} color={category.color} />
              <T variant="small" color={category.color} style={{ fontWeight: '800' }}>
                Add bill
              </T>
            </Pressable>

            <Pressable
              onPress={onOpenSettings}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${category.name}`}
              style={({ pressed }) => ({
                width: 44,
                paddingVertical: 11,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
              })}
            >
              <Ionicons name="create-outline" size={18} color={colors.inkSecondary} />
            </Pressable>
          </Row>
        </View>
      ) : null}
    </Surface>
  );
}


/**
 * Bottom-sheet for adding a bill to a known parent category.
 *
 * Organised the way you'd fill it: the amount is the hero at the top, then
 * what the bill is, which account pays it, and when. The parent category is
 * fixed in the header so it's never re-picked, and the Add button is pinned to
 * the bottom so it stays reachable above the keyboard on a long form.
 */
function AddSubcategorySheet({
  category,
  onClose,
}: {
  category: CategoryView['category'] | undefined;
  onClose: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const state = useAppStore();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState(1);
  const [frequency, setFrequency] = useState<SubcategoryFrequency>('monthly');
  /**
   * Which account this bill is paid from. Seeded with the category's own
   * account so the field shows the right answer on open — a bill in "Food" is
   * paid from Food's account unless the user says otherwise — rather than an
   * empty "choose" the user has to fill in every single time.
   */
  const [cardId, setCardId] = useState<string | null>(category?.cardId ?? null);
  const [plan, setPlan] = useState<SavingPlanDraft>(emptySavingPlanDraft);

  const openFor = category?.id ?? null;
  React.useEffect(() => {
    if (openFor) {
      setName('');
      setAmount('');
      setDueDay(category?.dueDay ?? 1);
      setFrequency('monthly');
      // Default to the category's linked account for each newly-opened sheet.
      setCardId(category?.cardId ?? null);
      setPlan(emptySavingPlanDraft);
    }
  }, [openFor, category?.dueDay, category?.cardId]);

  const unplanned = frequency === 'unplanned';
  // Saving plans belong only to yearly bills (same rule as everywhere else).
  const planPatch = frequency === 'yearly' ? toSavingPlanPatch(plan) : null;
  // With a saving plan the monthly set-aside *is* the planned amount. Otherwise
  // (including unplanned bills) the entered amount seeds the planned figure —
  // for unplanned it's an optional starting amount; entries add on top of it.
  const plannedMinor = planPatch ? planPatch.monthlyMinor : (parseAmount(amount) ?? 0);
  const canAdd =
    Boolean(name.trim()) && (frequency !== 'yearly' || !plan.enabled || planPatch !== null);

  function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || !category || !canAdd) return;
    state.addSubcategory({
      name: trimmed,
      categoryId: category.id,
      plannedMinor,
      dueDay,
      frequency,
      // The picker shows the category's account as a pre-filled default, but
      // accepting it is not an override: store null so the bill keeps
      // *inheriting*, and later changing the category's account still moves it.
      cardId: cardId === category.cardId ? null : cardId,
      planTargetMinor: planPatch?.planTargetMinor ?? null,
      planDueDate: planPatch?.planDueDate ?? null,
      planStartDate: planPatch?.planStartDate ?? null,
    });
    onClose();
  }

  // The account this bill will actually draw from, for the "uses category
  // default" hint when nothing is overridden.
  const effectiveCardId = resolveCardId(cardId, category?.cardId);

  return (
    <BottomSheet
      visible={Boolean(category)}
      onClose={onClose}
      title={category?.name ?? ''}
      eyebrow="New bill in"
      icon={(category?.icon ?? 'albums-outline') as keyof typeof Ionicons.glyphMap}
      iconColor={category?.color ?? colors.accent}
      scroll
      footer={
        <GradientButton
          label="Add bill"
          icon="add"
          onPress={handleAdd}
          disabled={!canAdd}
        />
      }
    >
              {/* Amount hero. With a saving plan (yearly) the monthly figure is
                  derived and shown read-only. Otherwise the amount is entered —
                  for an unplanned bill it's an optional starting amount (entries
                  add on top), so it's labelled as such. */}
              {plan.enabled && frequency === 'yearly' ? (
                // Saving plan: the monthly figure is derived, shown read-only.
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <Label>MONTHLY SET-ASIDE</Label>
                  <Row gap={space.xs} align="center">
                    <T variant="title" tone="muted">
                      {state.currency}
                    </T>
                    <T style={{ fontSize: 42, fontWeight: '800', letterSpacing: -1.2, color: planPatch ? colors.ink : colors.inkMuted }}>
                      {planPatch ? String(planPatch.monthlyMinor / 100) : '—'}
                    </T>
                  </Row>
                </View>
              ) : (
                <AmountField
                  label={unplanned ? 'Starting amount (optional)' : 'Amount'}
                  value={amount}
                  onChangeText={setAmount}
                  currency={state.currency}
                  autoFocus
                />
              )}

              <Field
                label="What is it?"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Rent, Electricity, Netflix"
              />

              {/* Paid from — override the category's account for this bill,
                  using the shared account picker. Null = the category default. */}
              {state.cards.length > 0 ? (
                <View style={{ gap: 4 }}>
                  <AccountField
                    label="Paid from"
                    cards={state.cards}
                    selectedId={cardId}
                    onSelect={setCardId}
                    allowNone
                  />
                  <T variant="caption" tone="muted">
                    {cardId && cardId === category?.cardId
                      ? `${category?.name}’s account, filled in for you — change it if this bill is paid from another.`
                      : 'Change it if this bill is paid from a different account.'}
                  </T>
                </View>
              ) : null}

              {/* Frequency — shared picker (includes unplanned for bills). */}
              <FrequencyPicker
                label="How often?"
                value={frequency}
                onChange={setFrequency}
                includeUnplanned
              />

              {/* Payment day — not applicable to unplanned bills. */}
              {!unplanned ? <DayPicker value={dueDay} onChange={setDueDay} /> : null}

              {/* Saving plan — yearly bills only (a big amount due later,
                  collected monthly), matching the rest of the app. */}
              {frequency === 'yearly' ? (
                <SavingPlanFields draft={plan} onChange={setPlan} />
              ) : null}
    </BottomSheet>
  );
}

