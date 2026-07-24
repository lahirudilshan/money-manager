import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankLogo } from '../../src/components/BankLogo';
import { DayPicker } from '../../src/components/DayPicker';
import {
  emptySavingPlanDraft,
  SavingPlanFields,
  toSavingPlanPatch,
  type SavingPlanDraft,
} from '../../src/components/SavingPlanFields';
import { Field } from '../../src/components/forms';
import { useTabBarClearance } from '../../src/components/TabBar';
import {
  Divider,
  Empty,
  GradientButton,
  Label,
  PinnedFooter,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { formatMoney, parseAmount } from '../../src/core/money';
import { formatPeriod, isFlexibleDueDay, resolveCardId } from '../../src/core/planning';
import { resolveBrand } from '../../src/data/banks';
import {
  selectBoardTotals,
  selectCategoryViews,
  selectTotalIncome,
  useAppStore,
  type CategoryView,
} from '../../src/store/useAppStore';
import { statusStyle } from '../../src/theme';
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
  const income = useMemo(() => selectTotalIncome(state), [state]);

  // Everything starts expanded — the plan is meant to be worked through, not
  // hunted for. Collapsing is opt-in per card, or all at once.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [addingToCategoryId, setAddingToCategoryId] = useState<string | null>(null);

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

  const left = income - totals.plannedMinor;
  const paidPct =
    totals.plannedMinor > 0 ? Math.round((totals.paidMinor / totals.plannedMinor) * 100) : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingBottom: tabClearance,
        paddingHorizontal: space.lg,
        gap: space.md,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header + compact plan summary in one block. */}
      <Row justify="space-between" align="flex-start">
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

      {views.length > 0 ? (
        <Surface style={{ gap: space.md }}>
          <Row justify="space-between">
            <SummaryStat label="Income" value={formatMoney(income, { compact: true })} />
            <SummaryStat
              label="Planned"
              value={formatMoney(totals.plannedMinor, { compact: true })}
            />
            <SummaryStat
              label="Left"
              value={formatMoney(left, { compact: true })}
              color={left >= 0 ? colors.ink : colors.danger}
            />
          </Row>
          <View style={{ gap: 4 }}>
            <ProgressBar pct={paidPct} color={colors.completed} />
            <Row justify="space-between">
              <T variant="caption" tone="muted">
                {formatMoney(totals.paidMinor, { compact: true })} paid
              </T>
              <T variant="caption" tone="muted">
                {paidPct}% of plan
              </T>
            </Row>
          </View>
        </Surface>
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
    </ScrollView>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ gap: 1 }}>
      <Label>{label}</Label>
      <T variant="figureLarge" color={color}>
        {value}
      </T>
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
            const amount = line.actualMinor ?? line.plannedMinor;

            return (
              <View key={line.id}>
                {index === 0 ? null : <Divider style={{ marginLeft: space.lg }} />}
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {/* Big checkbox tap target: pay / unpay. */}
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
                        tone={paid ? 'muted' : 'ink'}
                        style={paid ? { textDecorationLine: 'line-through' } : undefined}
                      >
                        {line.name}
                      </T>
                      <T variant="caption" tone="muted">
                        {isFlexibleDueDay(raw?.dueDay ?? category.dueDay)
                          ? 'Flexible'
                          : `Day ${raw?.dueDay ?? category.dueDay}`}
                        {raw?.frequency && raw.frequency !== 'monthly'
                          ? ` · ${raw.frequency.replace('_', '-')}`
                          : ''}
                      </T>
                    </View>
                    <T variant="figure" tone={paid ? 'muted' : 'ink'}>
                      {formatMoney(amount, { compact: true })}
                    </T>
                    <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} />
                  </Pressable>
                </View>
              </View>
            );
          })}

          {subcategories.length > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}

          {/* Add bill + settings, sharing one footer row. */}
          <Row>
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
                paddingVertical: space.md,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="add-circle" size={17} color={colors.accent} />
              <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
                Add bill
              </T>
            </Pressable>

            <View style={{ width: 1, backgroundColor: colors.hairline }} />

            <Pressable
              onPress={onOpenSettings}
              accessibilityRole="button"
              accessibilityLabel={`${category.name} settings`}
              style={({ pressed }) => ({
                paddingVertical: space.md,
                paddingHorizontal: space.lg,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="settings-outline" size={17} color={colors.inkSecondary} />
            </Pressable>
          </Row>
        </View>
      ) : null}
    </Surface>
  );
}

const FREQUENCIES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'one_time', label: 'One-time' },
  { key: 'yearly', label: 'Yearly' },
] as const;

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
  const [frequency, setFrequency] = useState<'monthly' | 'one_time' | 'yearly'>('monthly');
  // null means "use the category's account"; a value overrides it for this bill.
  const [cardId, setCardId] = useState<string | null>(null);
  const [plan, setPlan] = useState<SavingPlanDraft>(emptySavingPlanDraft);

  const openFor = category?.id ?? null;
  React.useEffect(() => {
    if (openFor) {
      setName('');
      setAmount('');
      setDueDay(category?.dueDay ?? 1);
      setFrequency('monthly');
      setCardId(null);
      setPlan(emptySavingPlanDraft);
    }
  }, [openFor, category?.dueDay]);

  const planPatch = toSavingPlanPatch(plan);
  // With a saving plan the monthly set-aside *is* the planned amount, so the
  // amount field is derived rather than typed.
  const plannedMinor = planPatch ? planPatch.monthlyMinor : (parseAmount(amount) ?? 0);
  const canAdd = Boolean(name.trim()) && (!plan.enabled || planPatch !== null);

  function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || !category || !canAdd) return;
    state.addSubcategory({
      name: trimmed,
      categoryId: category.id,
      plannedMinor,
      dueDay,
      frequency,
      cardId,
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
    <Modal visible={Boolean(category)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.canvas,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            // A tall fixed height (not max-height) gives the inner column real
            // vertical space, so the ScrollView can flex and the footer pins to
            // the bottom rather than floating up under short content.
            height: '90%',
            overflow: 'hidden',
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            {/* Fixed header: grab handle + parent category. */}
            <View style={{ paddingTop: space.sm, paddingHorizontal: space.lg }}>
              <View
                style={{
                  alignSelf: 'center',
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: colors.hairlineStrong,
                  marginBottom: space.md,
                }}
              />
              <Row gap={space.md} style={{ paddingBottom: space.md }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radius.md,
                    backgroundColor: category?.color ?? colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={(category?.icon ?? 'albums-outline') as never}
                    size={20}
                    color="#FFFFFF"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <T variant="caption" tone="muted">
                    NEW BILL IN
                  </T>
                  <T variant="bodyStrong" numberOfLines={1}>
                    {category?.name ?? ''}
                  </T>
                </View>
                <Pressable
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={24} color={colors.inkSecondary} />
                </Pressable>
              </Row>
              <Divider />
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: space.lg, gap: space.xl }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Amount hero. With a saving plan the monthly figure is derived
                  from the plan, so this shows that instead of a typed field. */}
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Label>{plan.enabled ? 'MONTHLY SET-ASIDE' : 'AMOUNT'}</Label>
                <Row gap={space.xs} align="center">
                  <T variant="title" tone="muted">
                    {state.currency}
                  </T>
                  {plan.enabled ? (
                    <T
                      style={{
                        fontSize: 42,
                        fontWeight: '800',
                        letterSpacing: -1.2,
                        color: planPatch ? colors.ink : colors.inkMuted,
                      }}
                    >
                      {planPatch ? String(planPatch.monthlyMinor / 100) : '—'}
                    </T>
                  ) : (
                    <TextInput
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={colors.inkMuted}
                      autoFocus
                      accessibilityLabel="Amount"
                      style={{
                        fontSize: 42,
                        fontWeight: '800',
                        letterSpacing: -1.2,
                        color: colors.ink,
                        minWidth: 110,
                        textAlign: 'center',
                        padding: 0,
                      }}
                    />
                  )}
                </Row>
              </View>

              <Field
                label="What is it?"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Rent, Electricity, Netflix"
              />

              {/* Paid from — override the category's account for this bill.
                  Compact wrapping chips keep this to one or two rows. */}
              {state.cards.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  <Label>PAID FROM</Label>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {state.cards.map((c) => {
                      const brand = resolveBrand({
                        bankId: c.bankId,
                        bankName: c.bankName,
                        name: c.name,
                      });
                      const selected = effectiveCardId === c.id;
                      const isDefault = category?.cardId === c.id;
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => setCardId(selected ? null : c.id)}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`${c.name}${isDefault ? ', category default' : ''}`}
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 7,
                            paddingVertical: 6,
                            paddingLeft: 6,
                            paddingRight: space.md,
                            borderRadius: radius.pill,
                            borderWidth: 1.5,
                            borderColor: selected ? brand.color : colors.hairline,
                            backgroundColor: selected ? `${brand.color}12` : colors.surface,
                            opacity: pressed ? 0.8 : 1,
                          })}
                        >
                          <BankLogo brand={brand} size={24} />
                          <T
                            variant="small"
                            numberOfLines={1}
                            style={{ fontWeight: selected ? '700' : '500' }}
                          >
                            {c.name}
                          </T>
                          {isDefault ? (
                            <View
                              style={{
                                width: 5,
                                height: 5,
                                borderRadius: 3,
                                backgroundColor: selected ? brand.color : colors.inkMuted,
                              }}
                            />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                  <T variant="caption" tone="muted">
                    Uses the category’s account unless you pick another.
                  </T>
                </View>
              ) : null}

              {/* Frequency. */}
              <View style={{ gap: space.sm }}>
                <Label>HOW OFTEN?</Label>
                <Row gap={space.sm}>
                  {FREQUENCIES.map((f) => {
                    const selected = frequency === f.key;
                    return (
                      <Pressable
                        key={f.key}
                        onPress={() => setFrequency(f.key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={({ pressed }) => ({
                          flex: 1,
                          alignItems: 'center',
                          paddingVertical: 11,
                          borderRadius: radius.md,
                          borderWidth: 1.5,
                          borderColor: selected ? colors.accent : colors.hairline,
                          backgroundColor: selected ? colors.accentSoft : colors.surface,
                          opacity: pressed ? 0.75 : 1,
                        })}
                      >
                        <T
                          variant="small"
                          color={selected ? colors.accentInk : colors.inkSecondary}
                          style={{ fontWeight: selected ? '700' : '500' }}
                        >
                          {f.label}
                        </T>
                      </Pressable>
                    );
                  })}
                </Row>
              </View>

              {/* Payment day. */}
              <DayPicker value={dueDay} onChange={setDueDay} />

              {/* Saving plan — for a big amount due later, collected monthly. */}
              <SavingPlanFields draft={plan} onChange={setPlan} />
            </ScrollView>

            <PinnedFooter>
              <GradientButton
                label="Add bill"
                icon="add"
                onPress={handleAdd}
                disabled={!canAdd}
              />
            </PinnedFooter>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

