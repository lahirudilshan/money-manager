import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankLogo } from '../../src/components/BankLogo';
import { DragList } from '../../src/components/DragList';
import { Divider, GradientButton, Label, Row, Surface, T } from '../../src/components/ui';
import { formatMoney, parseAmount } from '../../src/core/money';
import { resolveBrand } from '../../src/data/banks';
import { CATEGORY_CATALOG } from '../../src/data/categoryCatalog';
import { useAppStore } from '../../src/store/useAppStore';
import { useOnboardingDraft, type DraftLine } from '../../src/store/useOnboardingDraft';
import { useTheme } from '../../src/theme/ThemeProvider';

const ROW_HEIGHT = 68;

/**
 * Onboarding step 3: turn the picked lines into a real plan.
 *
 * Every line gets its budget, cadence, due day and funding account here, and
 * the whole list is drag-reorderable so the order matches how the user thinks
 * about their month. Editing opens in an expanded row rather than a separate
 * screen, so the running total stays visible while amounts are entered.
 *
 * This is the step that finally writes to the database — one category per
 * catalog group that has lines in it, then the lines beneath.
 */
export default function OnboardingPlanScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const state = useAppStore();
  const draft = useOnboardingDraft();
  const lines = draft.orderedLines();

  const [editingId, setEditingId] = useState<string | null>(null);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const line of lines) {
      if (line.type === 'income') income += line.plannedMinor;
      else expense += line.plannedMinor;
    }
    return { income, expense, left: income - expense };
  }, [lines]);

  /**
   * Commit the draft: create one category per catalog group that has picked
   * lines, then its subcategories in the user's chosen order. Income lines
   * additionally become `incomes` rows, which is what the ratio dashboard
   * reads.
   */
  function handleFinish() {
    const byCategory = new Map<string, DraftLine[]>();
    for (const line of lines) {
      const bucket = byCategory.get(line.categoryId) ?? [];
      bucket.push(line);
      byCategory.set(line.categoryId, bucket);
    }

    let categoryIndex = 0;
    for (const catalog of CATEGORY_CATALOG) {
      const group = byCategory.get(catalog.id);
      if (!group || group.length === 0) continue;

      // A category's default card is whichever account its lines mostly use.
      const created = state.addCategory({
        name: catalog.name,
        icon: catalog.icon,
        cardId: dominantCardId(group) ?? state.cards[0]?.id ?? null,
        dueDay: group[0]?.dueDay ?? 1,
        sortOrder: categoryIndex,
      });
      categoryIndex += 1;

      // Inserted in draft order; `addSubcategory` derives sortOrder from the
      // sibling count, so sequential inserts preserve the arrangement.
      group.forEach((line, index) => {
        state.addSubcategory({
          name: line.name,
          categoryId: created.id,
          plannedMinor: line.plannedMinor,
          type: line.type,
          frequency: line.frequency,
          icon: line.icon,
          dueDay: line.dueDay,
          cardId: line.cardId,
        });

        if (line.type === 'income' && line.plannedMinor > 0) {
          state.addIncome({
            name: line.name,
            amountMinor: line.plannedMinor,
            cardId: line.cardId ?? created.cardId ?? null,
            icon: line.icon,
            sortOrder: index,
          });
        }
      });
    }

    draft.reset();
    router.push('/onboarding/done');
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 2 }}>
        <Label>STEP 3 OF 3</Label>
        <T variant="title">Set up your plan</T>
        <T variant="small" tone="muted">
          Tap a line to set its amount, day and account. Hold and drag to
          reorder.
        </T>
      </View>

      {/* Running total, so amounts are entered against live feedback. */}
      <Surface style={{ gap: space.sm }}>
        <Row justify="space-between">
          <T variant="small" tone="secondary">
            Income
          </T>
          <T variant="figure" color={colors.completed}>
            {formatMoney(totals.income)}
          </T>
        </Row>
        <Row justify="space-between">
          <T variant="small" tone="secondary">
            Planned spend
          </T>
          <T variant="figure">−{formatMoney(totals.expense, { showCurrency: false })}</T>
        </Row>
        <Divider />
        <Row justify="space-between">
          <T variant="bodyStrong">Left over</T>
          <T variant="figureLarge" color={totals.left >= 0 ? colors.ink : colors.danger}>
            {formatMoney(totals.left)}
          </T>
        </Row>
      </Surface>

      <DragList
        items={lines}
        rowHeight={ROW_HEIGHT}
        onReorder={draft.setOrder}
        renderItem={(line, _index, dragging) => (
          <PlanRow
            line={line}
            dragging={dragging}
            expanded={editingId === line.id}
            onToggle={() => setEditingId((id) => (id === line.id ? null : line.id))}
            onRemove={() => draft.removeLine(line.id)}
          />
        )}
      />

      <GradientButton
        label="Build my plan"
        icon="checkmark"
        onPress={handleFinish}
        disabled={lines.length === 0}
      />

      {/* Editing opens a bottom sheet, so the fields are always in reach rather
          than pushed below a long scroll. */}
      <LineEditorSheet
        line={editingId ? lines.find((line) => line.id === editingId) : undefined}
        onClose={() => setEditingId(null)}
      />
    </ScrollView>
  );
}

/** The account most of a category's lines point at, if any do. */
function dominantCardId(lines: DraftLine[]): string | null {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (!line.cardId) continue;
    counts.set(line.cardId, (counts.get(line.cardId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [cardId, count] of counts) {
    if (count > bestCount) {
      best = cardId;
      bestCount = count;
    }
  }
  return best;
}

/** A single fixed-height line in the drag list. */
function PlanRow({
  line,
  dragging,
  expanded,
  onToggle,
  onRemove,
}: {
  line: DraftLine;
  dragging: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { colors, radius, space, shadow } = useTheme();
  const state = useAppStore();
  const card = state.cards.find((c) => c.id === line.cardId);

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${line.name}, ${formatMoney(line.plannedMinor)}`}
      style={({ pressed }) => [
        {
          height: ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.md,
          borderRadius: radius.lg,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: expanded ? colors.accent : colors.hairline,
          opacity: pressed ? 0.85 : 1,
        },
        dragging ? shadow.lifted : shadow.card,
      ]}
    >
      <Ionicons name="reorder-three-outline" size={20} color={colors.inkMuted} />
      <Ionicons name={line.icon as never} size={18} color={colors.inkSecondary} />

      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" numberOfLines={1}>
          {line.name}
        </T>
        <T variant="caption" tone="muted" numberOfLines={1}>
          Day {line.dueDay}
          {card ? ` · ${card.name}` : ''}
          {line.frequency !== 'monthly' ? ` · ${line.frequency.replace('_', '-')}` : ''}
        </T>
      </View>

      <T
        variant="figure"
        color={line.type === 'income' ? colors.completed : colors.ink}
      >
        {line.plannedMinor > 0 ? formatMoney(line.plannedMinor, { compact: true }) : 'Set'}
      </T>

      <Pressable
        onPress={onRemove}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${line.name}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        <Ionicons name="close-circle" size={19} color={colors.inkMuted} />
      </Pressable>
    </Pressable>
  );
}

const FREQUENCIES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'one_time', label: 'One-time' },
  { key: 'yearly', label: 'Yearly' },
] as const;

/**
 * Bottom-sheet editor for the selected line: amount, cadence, payment day and
 * funding account. There is no income/expense toggle — the type is decided by
 * which catalog category the line came from (Income vs everything else), so
 * asking again here would only invite contradictions.
 */
function LineEditorSheet({ line, onClose }: { line: DraftLine | undefined; onClose: () => void }) {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const state = useAppStore();
  const draft = useOnboardingDraft();

  return (
    <Modal
      visible={Boolean(line)}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
      >
        {/* Inner press is swallowed so tapping the sheet doesn't dismiss it. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.canvas,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingTop: space.sm,
            paddingBottom: insets.bottom + space.lg,
            maxHeight: '88%',
          }}
        >
          {/* Grab handle. */}
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

          {line ? (
            <ScrollView
              contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, gap: space.lg }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Row justify="space-between" align="center">
                <View style={{ flexShrink: 1 }}>
                  <T variant="heading" numberOfLines={1}>
                    {line.name}
                  </T>
                  <T variant="caption" tone="muted">
                    {line.type === 'income' ? 'Income' : 'Expense'}
                  </T>
                </View>
                <Pressable
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                >
                  <Ionicons name="checkmark-circle" size={28} color={colors.accent} />
                </Pressable>
              </Row>

              <View style={{ gap: space.sm }}>
                <Label>AMOUNT</Label>
                <TextInput
                  value={line.plannedMinor > 0 ? String(line.plannedMinor / 100) : ''}
                  onChangeText={(text) =>
                    draft.updateLine(line.id, { plannedMinor: parseAmount(text) ?? 0 })
                  }
                  placeholder="0"
                  placeholderTextColor={colors.inkMuted}
                  keyboardType="numeric"
                  autoFocus
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.hairlineStrong,
                    borderRadius: radius.md,
                    paddingHorizontal: space.md,
                    paddingVertical: 14,
                    fontSize: 22,
                    fontWeight: '800',
                    color: colors.ink,
                  }}
                />
              </View>

              <View style={{ gap: space.sm }}>
                <Label>FREQUENCY</Label>
                <Row gap={space.sm}>
                  {FREQUENCIES.map((frequency) => (
                    <Chip
                      key={frequency.key}
                      label={frequency.label}
                      selected={line.frequency === frequency.key}
                      onPress={() => draft.updateLine(line.id, { frequency: frequency.key })}
                    />
                  ))}
                </Row>
              </View>

              <View style={{ gap: space.sm }}>
                <Label>PAYMENT DAY</Label>
                <DayGrid
                  value={line.dueDay}
                  onChange={(dueDay) => draft.updateLine(line.id, { dueDay })}
                />
              </View>

              {state.cards.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  <Label>PAID FROM</Label>
                  <View style={{ gap: space.sm }}>
                    {state.cards.map((card) => {
                      const brand = resolveBrand({
                        bankId: card.bankId,
                        bankName: card.bankName,
                        name: card.name,
                      });
                      const selected = line.cardId === card.id;
                      return (
                        <Pressable
                          key={card.id}
                          onPress={() =>
                            draft.updateLine(line.id, { cardId: selected ? null : card.id })
                          }
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: space.md,
                            paddingVertical: space.md,
                            paddingHorizontal: space.md,
                            borderRadius: radius.lg,
                            borderWidth: 2,
                            borderColor: selected ? brand.color : colors.hairline,
                            backgroundColor: selected ? `${brand.color}12` : colors.surface,
                            opacity: pressed ? 0.8 : 1,
                          })}
                        >
                          <BankLogo brand={brand} size={40} />
                          <View style={{ flex: 1 }}>
                            <T variant="bodyStrong" numberOfLines={1}>
                              {card.name}
                            </T>
                            {card.bankName ? (
                              <T variant="caption" tone="muted" numberOfLines={1}>
                                {card.bankName}
                              </T>
                            ) : null}
                          </View>
                          <Ionicons
                            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                            size={22}
                            color={selected ? brand.color : colors.inkMuted}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <GradientButton label="Done" icon="checkmark" onPress={onClose} />
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
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
        {label}
      </T>
    </Pressable>
  );
}

/**
 * A 1–31 calendar-style grid, 7 to a row like a month view — no horizontal
 * scrolling to hunt through. The last row is short, which reads naturally as
 * the tail of a month.
 */
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
              // 7 columns: each cell is (100% - 6 gaps) / 7 ≈ 13.2%.
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
