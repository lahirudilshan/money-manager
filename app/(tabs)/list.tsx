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
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountField } from '~/features/accounts/components/AccountPicker';
import { BillFields, useBillDraft } from '~/features/budget/components/BillFields';
import { useTabBarClearance } from '~/shared/components/TabBar';
import { BottomSheet, Divider, Empty, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { formatDateLabel, startOfDay } from '~/shared/lib/dates';
import { formatMoney, parseAmount } from '~/shared/lib/money';
import {
  dueDateFor,
  effectiveAmount,
  formatPeriod,
  isFlexibleDueDay,
  isSpend,
  monthlyAmount,
  planHealth,
  resolveCardId,
  type BoardTotals,
  type PlanHealth,
} from '~/features/budget/logic/planning';
import { DragReorderList } from '~/shared/components/DragReorderList';
import {
  selectBoardTotals,
  selectCategoryViews,
  selectRatios,
  selectTotalIncome,
  useAppStore,
  type CategoryView,
} from '../../src/store/useAppStore';
import { HEALTH_VISUALS, shadeHex, statusStyle, washFor } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';

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
 * when expanded — its bills and an "Add bill" action.
 *
 * The bills READ here and are acted on one level down: a row opens its detail
 * page, where a dated bill is settled and an ongoing line's entries are logged. The
 * row used to carry a tap-to-pay checkbox; paying is now a deliberate act
 * rather than a stray tap on a screen whose every other gesture navigates.
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
  /**
   * True for the duration of a card drag.
   *
   * While it is set, EVERY card renders collapsed regardless of the user's own
   * choices — an expanded category is several hundred points tall, so dragging
   * one meant scrolling blind past a wall of bills with no sense of where the
   * card would land. Collapsed, the whole board is short uniform rows and the
   * destination is visible.
   *
   * The user's own `collapsed` set is untouched, so releasing restores exactly
   * what they had open. Kept separate from that set rather than folded into it
   * for precisely that reason.
   */
  const [dragging, setDragging] = useState(false);

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

  /**
   * Whether the list on screen is the WHOLE board, in its real order.
   *
   * Only then can a drag be trusted: with a filter or a search active the
   * visible rows are a subset, and an order derived from them would be written
   * over lines the user never saw. The store also reconciles hidden siblings
   * defensively (see `reorderSubcategories`), but not offering the gesture at
   * all is the clearer contract.
   */
  const reorderLocked = filter !== 'all' || query.length > 0;

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
            <Text variant="title">Your plan</Text>
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
            <Text variant="caption" color={colors.inkInverse} style={{ fontWeight: '700' }}>
              Category
            </Text>
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
                  <Text
                    variant="caption"
                    color={selected ? colors.ink : colors.inkSecondary}
                    style={{ fontWeight: selected ? '700' : '500' }}
                  >
                    {option.label}
                  </Text>
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
            <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
              {allCollapsed ? 'Expand' : 'Collapse'}
            </Text>
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
        /*
         * Hold a card to drag it into a new position.
         *
         * Reordering is DISABLED while a filter or a search is narrowing the
         * list: what is on screen is then a subset, and an arrangement made
         * against it would be written as though it were the whole board — the
         * user would drag two visible cards and silently renumber the eight
         * they cannot see. `reorderCategories` persists the order, so the
         * arrangement survives the month change and the next launch.
         */
        <DragReorderList
          /*
           * Animate the collapse, so the board folding down at the start of a
           * drag reads as one motion rather than a jump cut.
           *
           * `animate()` is the same 160ms configureNext the manual collapse
           * toggle uses, so a card closing because a drag began and a card
           * closing because it was tapped look identical.
           */
          onDragActiveChange={(active) => {
            animate();
            setDragging(active);
          }}
          /*
           * `id` is lifted from the nested category so the list has the stable
           * key it sorts by — a `CategoryView` is a composite with no id of its
           * own, and keying on the array index would reshuffle every row's
           * identity on the very reorder being performed.
           */
          items={filtered.map((view) => ({ ...view, id: view.category.id }))}
          enabled={!reorderLocked}
          estimatedHeight={220}
          gap={space.md}
          onReorder={(orderedIds) => state.reorderCategories(orderedIds)}
          renderItem={(view, _index, isDraggedCard) => (
            <CategoryCard
              view={view}
              dragging={isDraggedCard}
              reorderLocked={reorderLocked}
              /*
               * `dragging` is the LIST's state — true while ANY card is being
               * dragged — not this row's flag.
               *
               * This read `dragging`, the third `renderItem` argument, which is
               * true only for the card under the finger. So the one card being
               * dragged collapsed and every other card stayed expanded: the
               * exact opposite of the intent, and the reason the board still
               * scrolled past walls of bills mid-drag. The row flag is now
               * named `isDraggedCard` so the two cannot be confused again.
               */
              collapsed={dragging || collapsed.has(view.category.id)}
              onToggleCollapsed={() => toggle(view.category.id)}
              onOpenSettings={() => router.push(`/category/${view.category.id}`)}
              onOpenBill={(id) => router.push(`/subcategory/${id}`)}
              onAddBill={() => setAddingToCategoryId(view.category.id)}
              onReorderBills={(orderedIds) =>
                state.reorderSubcategories(view.category.id, orderedIds)
              }
            />
          )}
        />
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
      // Income lines are money arriving, not a bill to settle. Counting them
      // here reported a salary as "1 overdue" and inflated "still to pay" by
      // its amount — the same exclusion `summariseCategory` already applies,
      // which is why the category itself correctly read LKR 0.
      if (!isSpend(line)) continue;

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
              <Text variant="caption" color="rgba(255,255,255,0.9)" style={{ fontWeight: '800' }}>
                {visual.label}
              </Text>
            </Row>
            <Row gap={4}>
              <Label color="rgba(255,255,255,0.75)">PAID OFF</Label>
              <Text variant="figureLarge" color="#FFFFFF">
                {paidPct}%
              </Text>
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

  /**
   * Close this sheet, then open the bill.
   *
   * The push is deferred to the next frame rather than fired in the same tick as
   * `onClose()`. Both this sheet and the subcategory route present a native
   * modal, and iOS refuses to present a second one while the first is still
   * animating away — the push was swallowed and the sheet stayed put. Letting
   * the dismissal commit first makes the transition reliable.
   */
  const openLine = (id: string) => {
    onClose();
    requestAnimationFrame(() => router.push(`/subcategory/${id}`));
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
              <Text variant="caption" color="rgba(255,255,255,0.9)" style={{ fontWeight: '800' }}>
                {visual.label}
              </Text>
            </Row>
          </Row>

          <View style={{ gap: 2 }}>
            <Text variant="display" color="#FFFFFF">
              {formatMoney(unpaid.amountMinor)}
            </Text>
            <Text variant="caption" color="rgba(255,255,255,0.8)">
              {unpaid.count === 0
                ? 'Every bill is settled'
                : `across ${unpaid.count} ${unpaid.count === 1 ? 'bill' : 'bills'}`}
              {overdue.count > 0 ? ` · ${overdue.count} overdue` : ''}
            </Text>
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
              <Text variant="caption" color="rgba(255,255,255,0.8)">
                {formatMoney(totals.paidMinor, { compact: true })} paid
              </Text>
              <Text variant="caption" color="rgba(255,255,255,0.8)">
                {paidPct}% of {formatMoney(totals.plannedMinor, { compact: true })}
              </Text>
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
          <Text variant="small" color={tint} style={{ fontWeight: '800' }}>
            {label}
          </Text>
          {/* The count as a pill, so the header states size and value at once. */}
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 1,
              borderRadius: radius.pill,
              backgroundColor: colors.surfaceSunken,
            }}
          >
            <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
              {lines.length}
            </Text>
          </View>
        </Row>
        <Text variant="figure" color={tint}>
          {formatMoney(total, { compact: true })}
        </Text>
      </Row>

      <Text variant="caption" tone="muted">
        {caption}
      </Text>

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
              <Text variant="small" numberOfLines={1} style={{ fontWeight: '600' }}>
                {line.name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {line.categoryName}
                {line.dueDate ? ` · ${formatDateLabel(line.dueDate)}` : ''}
              </Text>
            </View>

            <Text variant="figure">{formatMoney(line.amountMinor)}</Text>
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
        <Text variant="small" color="#FFFFFF" style={{ fontWeight: '700' }} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" color="rgba(255,255,255,0.75)" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="figure" color={valueColor ?? '#FFFFFF'}>
          {value}
        </Text>
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
  dragging = false,
  reorderLocked = false,
  onToggleCollapsed,
  onOpenSettings,
  onOpenBill,
  onAddBill,
  onReorderBills,
}: {
  view: CategoryView;
  collapsed: boolean;
  /** True while this card is the one being dragged, so it can lift. */
  dragging?: boolean;
  /** True when a filter/search means the visible order is not the real one. */
  reorderLocked?: boolean;
  onToggleCollapsed: () => void;
  onOpenSettings: () => void;
  onOpenBill: (subcategoryId: string) => void;
  onAddBill: () => void;
  onReorderBills: (orderedIds: string[]) => void;
}) {
  const { colors, radius, shadow, space, mode } = useTheme();
  const state = useAppStore();
  const { category, summary, subcategories } = view;

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
        /*
         * ALWAYS clipped.
         *
         * This briefly switched to `visible` while dragging, on the theory that
         * hidden would clip the lifted card's shadow. It does not — the shadow
         * is drawn outside the view's bounds and `overflow` governs its
         * CHILDREN — and dropping it let the header's tinted background and the
         * bill rows square off the rounded corners, so the card visibly changed
         * shape the moment it was picked up.
         *
         * The lift is carried by the shadow and the border below, which need no
         * help from overflow.
         */
        overflow: 'hidden',
        borderWidth: 1.5,
        // The dragged card borrows the category's full-strength colour, so the
        // row under the finger is unmistakable even mid-flight.
        borderColor: dragging
          ? category.color
          : collapsed
            ? colors.hairlineStrong
            : `${category.color}55`,
        ...(dragging ? shadow.lifted : null),
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

          {/*
            Gesture-handler's Pressable, NOT React Native's.

            RN's uses the legacy JS responder system, which claims a touch
            outright — once it has one, the drag gesture wrapping this card
            never sees the movement, so a long press landed anywhere on the
            header simply did nothing. Gesture-handler's version negotiates with
            the pan instead: a tap still toggles, and a hold-then-move becomes a
            drag. Same everywhere a touch target sits inside a draggable row.
          */}
          <GHPressable
            onPress={onToggleCollapsed}
            accessibilityRole="button"
            accessibilityState={{ expanded: !collapsed }}
            style={{ flex: 1 }}
          >
            <Text variant="bodyStrong" numberOfLines={1}>
              {category.name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {summary.counts.paid}/{summary.subcategoryCount} paid
            </Text>
          </GHPressable>

          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text variant="figureLarge">{formatMoney(summary.totalMinor, { compact: true })}</Text>
            <GHPressable
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
            </GHPressable>
          </View>
        </Row>

        <ProgressBar pct={paidPct} color={category.color} height={6} />
      </View>

      {/* Bills. */}
      {!collapsed ? (
        <View>
          {/*
            Hold a bill to drag it within its category.

            Bills reorder only among their SIBLINGS — `sortOrder` on a
            subcategory is compared against the other lines in its category and
            nowhere else — so each card owns its own list rather than the board
            running one big one across category boundaries.

            `gap={0}` because these rows are separated by dividers rather than
            by space, and a gap would break the continuous card face; the
            divider moves into each row (below the first) so it travels with
            the row it belongs to instead of being keyed to a fixed position.
          */}
          <DragReorderList
            items={subcategories}
            enabled={!reorderLocked}
            gap={0}
            estimatedHeight={64}
            onReorder={onReorderBills}
            renderItem={(line, index, draggingLine) => {
            const raw = view.rawSubcategories.find((s) => s.id === line.id);
            const paid = line.status === 'paid';
            // A spending budget is never "paid" as a whole — its spend is a
            // running total of entries — so it gets an indicator rather than a
            // tap-to-pay checkbox, and reads differently in several places below.
            const ongoing = raw?.frequency === 'ongoing';
            /*
             * The headline figure. For a bill that is actual-or-planned; for a
             * spending budget it is what has actually been SPENT, with the
             * budget stated in the subtitle beside it.
             *
             * `effectiveAmount` deliberately reports the budget for such a line
             * (so the month's plan does not shrink as money is spent), which is
             * the right answer for totals and the wrong one for this row — here
             * the question is "how much have I spent", not "how much is planned".
             */
            const amount = ongoing ? (line.actualMinor ?? 0) : effectiveAmount(line);
            // Show planned vs. actual side by side when a real amount was logged
            // that differs from the plan, so the row tells you at a glance whether
            // it came in over/under. `amount` (actual-or-planned) stays the figure.
            const hasActual = line.actualMinor != null && line.actualMinor !== line.plannedMinor;
            // An ongoing line past its monthly amount — the one state worth
            // flagging here, since everything under it is going to plan.
            const overspent =
              ongoing && line.plannedMinor > 0 && (line.actualMinor ?? 0) > line.plannedMinor;
            /*
             * The category colour, pushed away from the wash behind it so an
             * outline drawn in it actually separates. Darker in light mode,
             * lighter in dark mode — in both, further from the background.
             */
            const markColor = shadeHex(category.color, mode === 'dark' ? 0.25 : -0.28);

            return (
              /*
               * No `key` — `DragReorderList` keys the wrapper it renders this
               * into, and a second key here would be inert.
               *
               * A dragged row takes the card's surface colour and a full-width
               * divider-free edge, so it visibly detaches from the rows it is
               * moving between.
               */
              <View
                style={
                  draggingLine
                    ? { backgroundColor: colors.surfaceRaised, borderRadius: radius.md }
                    : undefined
                }
              >
                {index === 0 || draggingLine ? null : (
                  <Divider style={{ marginLeft: space.lg }} />
                )}
                {/*
                 * The whole row opens the line's detail page — where a planned
                 * bill is settled and an ongoing line's entries are logged. Nothing
                 * here mutates state: this row carried a tap-to-pay checkbox
                 * and it was removed, because a control that changes data on a
                 * single tap sat awkwardly beside a row whose only other
                 * gesture navigates.
                 */}
                {/* Gesture-handler's, so the bill drag is not swallowed —
                    see the card header above. */}
                <GHPressable
                  onPress={() => onOpenBill(line.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${line.name}, ${formatMoney(amount)}, ${
                    ongoing ? 'ongoing' : paid ? 'paid' : 'not paid'
                  }. Open detail.`}
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingLeft: space.lg,
                    paddingRight: space.lg,
                    paddingVertical: space.md,
                    gap: space.sm,
                    // A paid bill sits on a very light ground of its own
                    // category colour, so a worked-through card reads as done
                    // from across the room while the row still belongs to its
                    // group. Kept faint (~5% alpha) so a run of paid rows stays
                    // calm next to the red an overrun ongoing line needs to own.
                    backgroundColor: pressed
                      ? colors.surfaceSunken
                      : paid && !ongoing
                        ? `${category.color}0D`
                        : 'transparent',
                  })}
                >
                  {/*
                   * One marker carrying both facts about the line.
                   *
                   * Both kinds are rounded squares; the CURVE separates them:
                   *   softly rounded  a dated bill — one payment, one date.
                   *   barely rounded  an ongoing line — a squarer, more
                   *                   container-like shape for the one that fills up.
                   *
                   * A status badge at the top-right marks the bill paid or
                   * pending, and a paid bill also outlines in its category
                   * colour. Ongoing lines get neither: they accumulate rather
                   * than settle, so paid/pending is not a state they can be in.
                   */}
                  <View style={{ width: 34, height: 34 }}>
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: ongoing ? 8 : 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: washFor(category.color, mode),
                        /*
                         * Outlined once paid, in a DARKENED version of the
                         * line's own category colour — so a settled row still
                         * belongs to its group rather than joining a sea of
                         * identical green. Red overrides for an overrun budget,
                         * the one state worth interrupting a scan for (the two
                         * cannot actually overlap: only bills are paid, only
                         * ongoing lines overrun).
                         *
                         * Darkened rather than the raw colour because the fill
                         * behind it is a wash of that same hue — at full
                         * strength the outline would barely separate from it.
                         */
                        borderWidth: overspent || (paid && !ongoing) ? 1 : 0,
                        borderColor: overspent
                          ? colors.danger
                          : markColor,
                      }}
                    >
                      <Ionicons
                        name={(raw?.icon ?? 'pricetag-outline') as never}
                        size={17}
                        color={overspent ? colors.danger : category.color}
                      />
                    </View>

                    {/*
                     * Status badge, top-right, overhanging the corner and
                     * ringed in the surface colour so it reads as sitting ON
                     * the icon rather than crowding it.
                     *
                     * Both states are shown, not just paid: a badge that only
                     * appears when settled makes "not paid" an ABSENCE, and an
                     * absence is indistinguishable from a line that has no
                     * status at all. Two badges of the same size and place mean
                     * the eye reads one position down the card and always finds
                     * an answer there.
                     *
                     * Ongoing lines get neither — they accumulate rather than
                     * settle, so paid/pending is not a state they can be in.
                     */}
                    {!ongoing ? (
                      <View
                        style={{
                          position: 'absolute',
                          right: -5,
                          top: -5,
                          width: 16,
                          height: 16,
                          borderRadius: 8,
                          alignItems: 'center',
                          justifyContent: 'center',
                          // Pending is grey, not amber: "not yet paid" on the
                          // 1st of the month is the ordinary state of nearly
                          // every bill, and a warning colour on all of them
                          // made a normal card look like a list of problems.
                          // Same darkened category colour as the border, so
                          // the badge and the outline read as one mark rather
                          // than two unrelated ones.
                          backgroundColor: paid
                            ? markColor
                            : colors.inkMuted,
                          borderWidth: 2,
                          // The row's paid tint is only ~5% alpha over this
                          // same surface, so one ring colour reads correctly on
                          // both grounds without a blend helper.
                          borderColor: colors.surface,
                        }}
                      >
                        <Ionicons
                          // Three dots read as "still to come" without implying
                          // anything is wrong — the same idiom as a pending
                          // message. The tick stays for settled.
                          name={paid ? 'checkmark' : 'ellipsis-horizontal'}
                          size={9}
                          color="#FFFFFF"
                        />
                      </View>
                    ) : null}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      variant="body"
                      numberOfLines={1}
                      /*
                       * Full ink whether paid or not. The marker's fill already
                       * carries that state, and dimming the name as well pulled
                       * the opposite way — a solid icon beside faded words. A
                       * paid bill is not less important to read.
                       */
                      tone="ink"
                    >
                      {line.name}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {ongoing
                        ? /* An ongoing line's subtitle carries its progress:
                             the figure on the right is what has been spent, so
                             without the budget beside it there is nothing to
                             judge that number against. */
                          line.plannedMinor > 0
                          ? `${formatMoney(line.actualMinor ?? 0, { compact: true })} of ${formatMoney(line.plannedMinor, { compact: true })} spent`
                          : 'Ongoing · no monthly amount set'
                        : /* The due-day stays visible even once paid — "was it
                             the 1st or the 5th" is still worth answering, and
                             the tick on the marker already says it is paid. */
                          `${
                            isFlexibleDueDay(raw?.dueDay ?? category.dueDay)
                              ? 'Flexible'
                              : `Day ${raw?.dueDay ?? category.dueDay}`
                          }${
                            raw?.frequency && raw.frequency !== 'monthly'
                              ? ` · ${raw.frequency.replace('_', '-')}`
                              : ''
                          }`}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text
                      variant="figure"
                      // When a real amount was logged, colour it by over/under
                      // the plan; otherwise dim it only once the bill is paid.
                      color={
                        // An overrun is the one thing worth flagging on an
                        // ongoing line — everything below its amount is fine.
                        ongoing
                          ? line.plannedMinor > 0 && (line.actualMinor ?? 0) > line.plannedMinor
                            ? colors.danger
                            : undefined
                          : hasActual
                            ? line.actualMinor! > line.plannedMinor
                              ? colors.danger
                              : colors.completed
                            : undefined
                      }
                      // Full ink, for the same reason as the name above: the
                      // marker carries paid state, so the figure need not.
                      tone="ink"
                    >
                      {formatMoney(amount, { compact: true })}
                    </Text>
                    {hasActual && !ongoing ? (
                      <Text
                        variant="caption"
                        tone="muted"
                        style={{ textDecorationLine: 'line-through' }}
                      >
                        {formatMoney(line.plannedMinor, { compact: true })}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} />
                </GHPressable>
              </View>
            );
            }}
          />

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
              <Text variant="small" color={category.color} style={{ fontWeight: '800' }}>
                Add bill
              </Text>
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
              {/* A plain pen, not a pencil-in-a-box: `create-outline` draws a
                  square that echoed this button's own rounded rect, so the
                  glyph fought its container. Matches the Loans tab's edit
                  action, which made the same switch for the same reason. */}
              <Ionicons name="pencil-outline" size={18} color={colors.inkSecondary} />
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

  // Re-seeded each time the sheet opens for a different category, so a draft
  // abandoned in one never appears in the next.
  const draft = useBillDraft({
    categoryDueDay: category?.dueDay,
    categoryCardId: category?.cardId,
    resetKey: category?.id ?? null,
  });

  function handleAdd() {
    if (!category || !draft.canSave) return;
    state.addSubcategory({ ...draft.toPatch(), categoryId: category.id });
    onClose();
  }

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
          disabled={!draft.canSave}
        />
      }
    >
      {/* Shared with the grid picker's manage sheet, so a bill describes the
          same things wherever it is created. */}
      <BillFields draft={draft} cards={state.cards} category={category} amountAutoFocus />
    </BottomSheet>
  );
}

