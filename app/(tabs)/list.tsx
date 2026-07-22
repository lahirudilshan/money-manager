import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field } from '../../src/components/forms';
import { useTabBarClearance } from '../../src/components/TabBar';
import {
  Divider,
  Empty,
  FundingBar,
  GradientButton,
  Label,
  Row,
  ScreenHeader,
  StatusPill,
  Surface,
  T,
} from '../../src/components/ui';
import { formatMoney, parseAmount } from '../../src/core/money';
import { formatPeriod } from '../../src/core/planning';
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
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'paid', label: 'Paid' },
];

/**
 * The structure view: every category, expandable to its lines.
 *
 * Where the dashboard answers "what needs doing", this answers "what does my
 * plan actually look like". Categories collapse by default so the whole shape
 * is visible at once, and each row states its status in words as well as
 * colour. Tapping any level opens its detail screen for edits and actions.
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

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  // The category a new subcategory is being added to, or null when the sheet
  // is closed. Held here (not per-row) so one modal serves every category.
  const [addingToCategoryId, setAddingToCategoryId] = useState<string | null>(null);

  const addingToCategory = views.find((v) => v.category.id === addingToCategoryId)?.category;

  function toggle(categoryId: string) {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function expandAll() {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
    setExpanded((current) =>
      current.size === views.length ? new Set() : new Set(views.map((v) => v.category.id)),
    );
  }

  // Filtering hides lines, and any category left with none drops out entirely.
  const filtered = useMemo(() => {
    if (filter === 'all') return views;
    return views
      .map((view) => ({
        ...view,
        subcategories: view.subcategories.filter((sub) =>
          filter === 'paid' ? sub.status === 'paid' : sub.status !== 'paid',
        ),
      }))
      .filter((view) => view.subcategories.length > 0);
  }, [views, filter]);

  const left = income - totals.plannedMinor;

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
      <ScreenHeader
        eyebrow={formatPeriod(state.period)}
        title="Your plan"
        action={{
          icon: 'add',
          label: 'New category',
          onPress: () => router.push('/category/new'),
        }}
      />

      {/* Totals strip. */}
      <Surface style={{ gap: space.sm }}>
        <Row justify="space-between">
          <T variant="small" tone="secondary">
            Income
          </T>
          <T variant="figure" color={colors.completed}>
            {formatMoney(income)}
          </T>
        </Row>
        <Row justify="space-between">
          <T variant="small" tone="secondary">
            Planned
          </T>
          <T variant="figure">−{formatMoney(totals.plannedMinor, { showCurrency: false })}</T>
        </Row>
        <Divider />
        <Row justify="space-between">
          <T variant="bodyStrong">Left over</T>
          <T variant="figureLarge" color={left >= 0 ? colors.ink : colors.danger}>
            {formatMoney(left)}
          </T>
        </Row>
      </Surface>

      {/* Filter + expand controls. */}
      {views.length > 0 ? (
        <Row justify="space-between" align="center">
          <Row gap={space.xs}>
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
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.hairline,
                    backgroundColor: selected ? colors.accent : colors.surface,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <T
                    variant="caption"
                    color={selected ? colors.inkInverse : colors.inkSecondary}
                    style={{ fontWeight: selected ? '700' : '500' }}
                  >
                    {option.label}
                  </T>
                </Pressable>
              );
            })}
          </Row>

          <Pressable
            onPress={expandAll}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <T variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
              {expanded.size === views.length ? 'Collapse all' : 'Expand all'}
            </T>
          </Pressable>
        </Row>
      ) : null}

      {filtered.length === 0 ? (
        <Empty
          icon="list-outline"
          title={views.length === 0 ? 'Nothing planned' : 'Nothing matches'}
          message={
            views.length === 0
              ? 'Create a category and add the lines you pay each month.'
              : 'No lines match this filter. Try "All".'
          }
          actionLabel={views.length === 0 ? 'Create a category' : undefined}
          onAction={views.length === 0 ? () => router.push('/category/new') : undefined}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          {filtered.map((view) => (
            <CategoryBlock
              key={view.category.id}
              view={view}
              expanded={expanded.has(view.category.id)}
              onToggle={() => toggle(view.category.id)}
              onOpenCategory={() => router.push(`/category/${view.category.id}`)}
              onOpenLine={(id) => router.push(`/subcategory/${id}`)}
              onAddSubcategory={() => setAddingToCategoryId(view.category.id)}
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

const FREQUENCIES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'one_time', label: 'One-time' },
  { key: 'yearly', label: 'Yearly' },
] as const;

/**
 * Bottom-sheet for adding a subcategory to a known parent category. The parent
 * is fixed and shown in the header, so this only asks for what varies —
 * name, amount, day, cadence — and never makes the user re-pick the category.
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

  // Reset the form whenever the sheet opens for a (possibly different) category.
  const openFor = category?.id ?? null;
  React.useEffect(() => {
    if (openFor) {
      setName('');
      setAmount('');
      setDueDay(category?.dueDay ?? 1);
      setFrequency('monthly');
    }
  }, [openFor, category?.dueDay]);

  function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed || !category) return;
    state.addSubcategory({
      name: trimmed,
      categoryId: category.id,
      plannedMinor: parseAmount(amount) ?? 0,
      dueDay,
      frequency,
    });
    onClose();
  }

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
            paddingTop: space.sm,
            paddingBottom: insets.bottom + space.lg,
            maxHeight: '90%',
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.hairlineStrong,
              marginBottom: space.sm,
            }}
          />

          <ScrollView
            contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, gap: space.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Parent category, fixed — makes the relationship unmistakable. */}
            <Row gap={space.md}>
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
                <Ionicons name={(category?.icon ?? 'albums-outline') as never} size={20} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <T variant="caption" tone="muted">
                  ADD TO
                </T>
                <T variant="bodyStrong" numberOfLines={1}>
                  {category?.name ?? ''}
                </T>
              </View>
            </Row>

            <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Rent" autoFocus />
            <Field
              label="Planned amount"
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              keyboardType="numeric"
            />

            <View style={{ gap: space.sm }}>
              <Label>FREQUENCY</Label>
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
                        paddingVertical: 10,
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

            <View style={{ gap: space.sm }}>
              <Label>PAYMENT DAY</Label>
              <DayGrid value={dueDay} onChange={setDueDay} />
            </View>

            <GradientButton
              label="Add subcategory"
              icon="add"
              onPress={handleAdd}
              disabled={!name.trim()}
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 1–31 calendar-style grid, 7 to a row — no horizontal scrolling. */
function DayGrid({ value, onChange }: { value: number; onChange: (day: number) => void }) {
  const { colors, radius, space } = useTheme();
  const days = Array.from({ length: 31 }, (_, index) => index + 1);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
      {days.map((day) => {
        const selected = day === value;
        return (
          <Pressable
            key={day}
            onPress={() => onChange(day)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Day ${day}`}
            style={({ pressed }) => ({
              width: '13.1%',
              aspectRatio: 1,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: selected ? colors.accent : colors.hairline,
              backgroundColor: selected ? colors.accent : colors.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <T
              variant="small"
              color={selected ? colors.inkInverse : colors.inkSecondary}
              style={{ fontWeight: selected ? '800' : '500' }}
            >
              {day}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One category: a summary header that expands to its lines. */
function CategoryBlock({
  view,
  expanded,
  onToggle,
  onOpenCategory,
  onOpenLine,
  onAddSubcategory,
}: {
  view: CategoryView;
  expanded: boolean;
  onToggle: () => void;
  onOpenCategory: () => void;
  onOpenLine: (subcategoryId: string) => void;
  onAddSubcategory: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const { category, card, summary } = view;

  return (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${category.name}, ${formatMoney(summary.totalMinor)}, ${summary.counts.paid} of ${summary.subcategoryCount} paid`}
        style={({ pressed }) => ({ padding: space.lg, gap: space.md, opacity: pressed ? 0.8 : 1 })}
      >
        <Row gap={space.md}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.md,
              backgroundColor: category.color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={category.icon as never} size={20} color="#FFFFFF" />
          </View>

          <View style={{ flex: 1, gap: 3 }}>
            <T variant="bodyStrong" numberOfLines={1}>
              {category.name}
            </T>
            <Row gap={space.xs}>
              <TransferBadge transferred={view.transferStatus === 'transferred'} />
              <T variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {card ? card.name : 'no account'}
              </T>
            </Row>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <T variant="figureLarge">{formatMoney(summary.totalMinor, { compact: true })}</T>
            <T variant="caption" color={summary.isSettled ? colors.completed : colors.inkMuted}>
              {summary.counts.paid}/{summary.subcategoryCount} paid
            </T>
          </View>

          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={17}
            color={colors.inkMuted}
          />
        </Row>

        <FundingBar
          pct={
            summary.subcategoryCount > 0
              ? (summary.counts.paid / summary.subcategoryCount) * 100
              : 0
          }
          color={category.color}
          surplus={summary.isSettled}
          height={5}
        />
      </Pressable>

      {expanded ? (
        <View>
          <Divider />
          <View style={{ paddingVertical: space.xs }}>
            {view.subcategories.map((line) => {
              const raw = view.rawSubcategories.find((s) => s.id === line.id);
              const dueDay = raw?.dueDay ?? category.dueDay;
              const style = statusStyle(line.status, colors);

              return (
                <Pressable
                  key={line.id}
                  onPress={() => onOpenLine(line.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${line.name}, ${style.label}, ${formatMoney(line.actualMinor ?? line.plannedMinor)}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: 11,
                    opacity: pressed ? 0.65 : 1,
                  })}
                >
                  <Ionicons
                    name={(raw?.icon ?? 'pricetag-outline') as never}
                    size={17}
                    color={colors.inkMuted}
                  />

                  <View style={{ flex: 1 }}>
                    <T
                      variant="small"
                      tone={line.status === 'paid' ? 'muted' : 'ink'}
                      numberOfLines={1}
                      style={{ fontWeight: '600' }}
                    >
                      {line.name}
                    </T>
                    <T variant="caption" tone="muted">
                      Day {dueDay}
                      {raw?.frequency && raw.frequency !== 'monthly'
                        ? ` · ${raw.frequency.replace('_', '-')}`
                        : ''}
                    </T>
                  </View>

                  <StatusPill status={line.status} compact />

                  <T
                    variant="figure"
                    tone={line.status === 'paid' ? 'muted' : 'ink'}
                    style={{ minWidth: 76, textAlign: 'right' }}
                  >
                    {formatMoney(line.actualMinor ?? line.plannedMinor)}
                  </T>
                </Pressable>
              );
            })}
          </View>

          <Divider />
          <Row>
            {/* Add a bill straight into this category — the parent is already
                known, so this opens a focused sheet rather than a picker. */}
            <Pressable
              onPress={onAddSubcategory}
              accessibilityRole="button"
              accessibilityLabel={`Add subcategory to ${category.name}`}
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
              <Ionicons name="add-circle" size={16} color={colors.accent} />
              <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
                Add subcategory
              </T>
            </Pressable>

            <View style={{ width: 1, backgroundColor: colors.hairline }} />

            <Pressable
              onPress={onOpenCategory}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${category.name}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: space.md,
                paddingHorizontal: space.lg,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="settings-outline" size={15} color={colors.inkSecondary} />
              <T variant="small" tone="secondary" style={{ fontWeight: '600' }}>
                Edit
              </T>
            </Pressable>
          </Row>
        </View>
      ) : null}
    </Surface>
  );
}

/** Tiny pill for the category's bulk-transfer state — its own status, distinct
 *  from the per-bill paid counts beside it. */
function TransferBadge({ transferred }: { transferred: boolean }) {
  const { colors } = useTheme();
  const style = statusStyle(transferred ? 'transferred' : 'pending', colors);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: style.bg,
      }}
    >
      <Ionicons name={style.icon as never} size={11} color={style.fg} />
      <T variant="caption" color={style.fg} style={{ fontWeight: '700', fontSize: 10 }}>
        {transferred ? 'Transferred' : 'Not moved'}
      </T>
    </View>
  );
}
