import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankLogo } from '../../src/components/BankLogo';
import { DayPicker } from '../../src/components/DayPicker';
import { DragList } from '../../src/components/DragList';
import { FrequencyPicker } from '../../src/components/forms';
import { BottomSheet, Divider, GradientButton, Label, PinnedFooter, Row, Surface, Text } from '../../src/components/ui';
import { convertToLocalMinor, formatMoney, parseAmount } from '../../src/core/money';
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

  // A plan is only meaningful once its lines carry amounts, so the finish
  // action stays disabled until every picked line has a budget set.
  const unsetCount = lines.filter((line) => line.plannedMinor <= 0).length;
  const canBuild = lines.length > 0 && unsetCount === 0;

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
          const isForeign = line.currency === 'usd' && line.foreignAmount != null;
          state.addIncome({
            name: line.name,
            amountMinor: line.plannedMinor,
            cardId: line.cardId ?? created.cardId ?? null,
            // Keep the original figure and rate so the row can show "$X @ rate"
            // rather than only the converted local amount.
            foreignAmount: isForeign ? line.foreignAmount : null,
            foreignRate: isForeign ? state.usdRate : null,
            icon: isForeign ? 'logo-usd' : line.icon,
            sortOrder: index,
          });
        }
      });
    }

    draft.reset();
    router.push('/onboarding/loans');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: insets.top + space.lg,
        paddingBottom: space.lg,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 2 }}>
        <Label>STEP 3 OF 4</Label>
        <Text variant="title">Set up your plan</Text>
        <Text variant="small" tone="muted">
          Tap a line to set its amount, day and account. Hold and drag to
          reorder.
        </Text>
      </View>

      {/* Running total, so amounts are entered against live feedback. */}
      {/*
        Label/figure pairs. The label shrinks and the figure holds its width —
        a seven-digit salary would otherwise push "Planned spend" off the row or
        wrap it. `adjustsFontSizeToFit` on the figures is the second line of
        defence for the widest cases.
      */}
      <Surface style={{ gap: space.sm }}>
        <Row justify="space-between" gap={space.sm}>
          <Text variant="small" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            Income
          </Text>
          <Text
            variant="figure"
            color={colors.completed}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {formatMoney(totals.income)}
          </Text>
        </Row>
        <Row justify="space-between" gap={space.sm}>
          <Text variant="small" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            Planned spend
          </Text>
          <Text variant="figure" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            −{formatMoney(totals.expense, { showCurrency: false })}
          </Text>
        </Row>
        <Divider />
        <Row justify="space-between" gap={space.sm}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            Left over
          </Text>
          <Text
            variant="figureLarge"
            color={totals.left >= 0 ? colors.ink : colors.danger}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {formatMoney(totals.left)}
          </Text>
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

      {/* Editing opens a bottom sheet, so the fields are always in reach rather
          than pushed below a long scroll. */}
      <LineEditorSheet
        line={editingId ? lines.find((line) => line.id === editingId) : undefined}
        onClose={() => setEditingId(null)}
      />
    </ScrollView>

    <PinnedFooter>
      <View style={{ gap: space.sm }}>
        {unsetCount > 0 ? (
          <Row justify="center">
            <Text variant="caption" tone="muted">
              {unsetCount} line{unsetCount === 1 ? '' : 's'} still need an amount
            </Text>
          </Row>
        ) : null}
        <GradientButton
          label="Build my plan"
          icon="checkmark"
          onPress={handleFinish}
          disabled={!canBuild}
        />
      </View>
    </PinnedFooter>
    </View>
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
        <Text variant="bodyStrong" numberOfLines={1}>
          {line.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          Day {line.dueDay}
          {card ? ` · ${card.name}` : ''}
          {line.frequency !== 'monthly' ? ` · ${line.frequency.replace('_', '-')}` : ''}
        </Text>
      </View>

      {/* Compact-formatted, so usually short — but a long currency code plus a
          large figure can still crowd the name beside it. Held to one line and
          allowed to shrink rather than pushing the row's layout around. */}
      <Text
        variant="figure"
        color={line.type === 'income' ? colors.completed : colors.ink}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {line.plannedMinor > 0 ? formatMoney(line.plannedMinor, { compact: true }) : 'Set'}
      </Text>

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


/**
 * Bottom-sheet editor for the selected line: amount, cadence, payment day and
 * funding account. There is no income/expense toggle — the type is decided by
 * which catalog category the line came from (Income vs everything else), so
 * asking again here would only invite contradictions.
 */
function LineEditorSheet({ line, onClose }: { line: DraftLine | undefined; onClose: () => void }) {
  const { colors, radius, space } = useTheme();
  const state = useAppStore();
  const draft = useOnboardingDraft();

  return (
    <BottomSheet
      visible={Boolean(line)}
      onClose={onClose}
      title={line?.name ?? ''}
      eyebrow={line ? (line.type === 'income' ? 'Income' : 'Expense') : undefined}
      icon={line?.type === 'income' ? 'trending-up-outline' : 'pricetag-outline'}
      iconColor={colors.accent}
      scroll
      footer={line ? <GradientButton label="Done" icon="checkmark" onPress={onClose} /> : undefined}
    >
          {line ? (
            <>
              <View style={{ gap: space.sm }}>
                {/*
                  Label and currency toggle on one line, but the toggle is
                  allowed to keep its natural width and the label to shrink:
                  `Chip` used to be `flex: 1` inside an unbounded row, so a long
                  currency code squeezed the pair unpredictably.
                */}
                <Row justify="space-between" align="center" gap={space.sm}>
                  <View style={{ flexShrink: 1 }}>
                    <Label>AMOUNT</Label>
                  </View>
                  {/* Income is often paid in USD; expenses are local. */}
                  {line.type === 'income' ? (
                    <Row gap={space.xs} style={{ flexShrink: 0 }}>
                      <Chip
                        label={state.currency}
                        selected={line.currency === 'local'}
                        onPress={() =>
                          draft.updateLine(line.id, { currency: 'local', foreignAmount: null })
                        }
                      />
                      <Chip
                        label="USD"
                        selected={line.currency === 'usd'}
                        onPress={() => draft.updateLine(line.id, { currency: 'usd' })}
                      />
                    </Row>
                  ) : null}
                </Row>

                <TextInput
                  value={
                    line.currency === 'usd'
                      ? line.foreignAmount
                        ? String(line.foreignAmount)
                        : ''
                      : line.plannedMinor > 0
                        ? String(line.plannedMinor / 100)
                        : ''
                  }
                  onChangeText={(text) => {
                    if (line.currency === 'usd') {
                      const foreign = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
                      const valid = Number.isFinite(foreign) ? foreign : null;
                      draft.updateLine(line.id, {
                        foreignAmount: valid,
                        // Store the converted local value so every total the
                        // plan shows stays in one currency.
                        plannedMinor: valid ? convertToLocalMinor(valid, state.usdRate) : 0,
                      });
                    } else {
                      draft.updateLine(line.id, { plannedMinor: parseAmount(text) ?? 0 });
                    }
                  }}
                  placeholder="0"
                  placeholderTextColor={colors.inkMuted}
                  keyboardType="numeric"
                  autoFocus
                  /*
                   * A salary in rupees runs to seven or eight digits. The field
                   * is full-width and the text scrolls horizontally within it,
                   * so nothing is clipped — but the size is dropped from 22 to
                   * 20 so a realistic figure fits without scrolling at all on a
                   * narrow phone. (`adjustsFontSizeToFit` is Text-only; it is
                   * not available on TextInput.)
                   */
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.hairlineStrong,
                    borderRadius: radius.md,
                    paddingHorizontal: space.md,
                    paddingVertical: 14,
                    fontSize: 20,
                    fontWeight: '800',
                    color: colors.ink,
                  }}
                />

                {line.currency === 'usd' ? (
                  <Text variant="caption" tone="muted">
                    ≈ {formatMoney(line.plannedMinor)} at {state.currency} {state.usdRate} / USD
                  </Text>
                ) : null}
              </View>

              <FrequencyPicker
                label="Frequency"
                value={line.frequency}
                onChange={(frequency) =>
                  // Onboarding offers only the category-default cadences, so the
                  // narrow to DraftLine's frequency type is safe.
                  draft.updateLine(line.id, {
                    frequency: frequency as 'monthly' | 'one_time' | 'yearly',
                  })
                }
              />

              <DayPicker
                value={line.dueDay}
                onChange={(dueDay) => draft.updateLine(line.id, { dueDay })}
              />

              {state.cards.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  {/* Income arrives *into* an account; expenses go *out of* one. */}
                  <Label>{line.type === 'income' ? 'PAID IN TO' : 'PAID FROM'}</Label>
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
                            <Text variant="bodyStrong" numberOfLines={1}>
                              {card.name}
                            </Text>
                            {card.bankName ? (
                              <Text variant="caption" tone="muted" numberOfLines={1}>
                                {card.bankName}
                              </Text>
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

            </>
          ) : null}
    </BottomSheet>
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
        /*
         * Sized by its own label, not `flex: 1`.
         *
         * These sit in a right-aligned pair beside the AMOUNT label, where
         * stretching made a two-character code ("LKR") and a three-character
         * one ("USD") render at different widths depending on what else was on
         * the row. A minimum width keeps the pair even without forcing it.
         */
        minWidth: 62,
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: space.sm,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: selected ? colors.accent : colors.hairline,
        backgroundColor: selected ? colors.accentSoft : colors.surface,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text
        variant="small"
        color={selected ? colors.accentInk : colors.inkSecondary}
        style={{ fontWeight: selected ? '700' : '500' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

