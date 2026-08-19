import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { AddAccountSheet } from '~/features/accounts/components/AddAccountSheet';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import { DayPicker } from '~/features/budget/components/DayPicker';
import { DragList } from '~/shared/components/DragList';
import { FrequencyPicker } from '~/shared/components/forms';
import {
  emptySavingPlanDraft,
  savingPlanDraftFrom,
  SavingPlanFields,
  toSavingPlanPatch,
  type SavingPlanDraft,
} from '~/features/budget/components/SavingPlanFields';
import { BottomSheet, Divider, FOOTER_CLEARANCE, GradientButton, Label, PinnedFooter, Row, StepHeader, Surface, Text } from '~/shared/components/ui';
import { isHouseCatalogId, isHouseScopedCatalogId } from '~/features/budget/logic/houses';
import { convertToLocalMinor, formatAmountInput, formatMoney, parseAmount } from '~/shared/lib/money';
import { resolveBrand } from '~/shared/data/banks';
import {
  CATALOG_SUBCATEGORY_BY_ID,
  CATEGORY_CATALOG,
  DEFAULT_CATALOG_IDS,
} from '~/shared/data/categoryCatalog';
import { useAppStore } from '../../src/store/useAppStore';
import { hydrateOnboardingDraft, useOnboardingDraft, type DraftLine } from '~/features/onboarding/logic/useOnboardingDraft';
import { useTheme } from '~/shared/theme/ThemeProvider';

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
  const router = useRouter();

  const state = useAppStore();
  // Reloads an interrupted setup on whichever step the user re-enters on.
  useState(hydrateOnboardingDraft);
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

  /*
   * Lines with no amount yet — reported, but NOT a barrier.
   *
   * Requiring every line to carry a figure was wrong in two ways. Some lines
   * have no plannable amount by their nature: a spending budget accumulates
   * whatever its entries come to, and a bank-charges line is whatever the bank
   * decides. And for the rest, a person setting up an app at 11pm often does not
   * know their exact water bill — forcing a number means they invent one, which
   * is worse than leaving it blank, because a made-up figure looks like a real
   * budget on the board forever after.
   *
   * A line with no amount is perfectly usable: it appears on the board, its
   * actuals still log against it, and the user fills the plan in when they know
   * it. So this drives a gentle count in the footer rather than a locked button.
   */
  const unsetCount = lines.filter(
    (line) => line.plannedMinor <= 0 && line.frequency !== 'unplanned',
  ).length;
  /*
   * An account IS required on a line you fund.
   *
   * Unlike the amount, this one has no sensible blank for an ordinary bill: the
   * board's whole job is "how much do I move where", and the per-account
   * transfer rows are built by grouping lines by their funding account. A line
   * with none is silently left out of that sum, so the transfer figures are
   * quietly short with nothing on screen explaining which line is missing.
   *
   * Spending budgets are the exception. A budget accumulates whatever its
   * entries came to, and those entries carry their own account — bank charges
   * are the clearest case, since fees are levied by whichever bank charged them
   * rather than paid out of one nominated card. Demanding a single account for
   * the bucket would force the user to invent an answer and would pile every
   * such entry into that one account's transfer total.
   */
  const unfundedCount = lines.filter(
    (line) => !line.cardId && line.frequency !== 'unplanned',
  ).length;
  const canBuild = lines.length > 0 && unfundedCount === 0;

  /**
   * Commit the draft: create one category per catalog group that has picked
   * lines, then its subcategories in the user's chosen order. Income lines
   * additionally become `incomes` rows, which is what the ratio dashboard
   * reads.
   */
  function handleFinish() {
    /*
     * Create a HOUSE for every picked line under the Houses category, before
     * any bill line is written.
     *
     * A line under Houses is not an ordinary budget line — it names a property,
     * and the `houses` row it creates is what makes the house picker appear on
     * electricity, water, rent and transfers. Ordering matters: the bill lines
     * below default to the primary house, which cannot resolve until the houses
     * themselves exist.
     *
     * Existing houses (placeholders seeded on launch, or a previous pass
     * through this step) are matched by name so stepping back and forth never
     * duplicates a property.
     */
    for (const line of lines.filter((candidate) => isHouseCatalogId(candidate.id))) {
      const name = line.name.trim();
      if (!name) continue;

      const already = state.houses.find(
        (house) => house.name.toLowerCase() === name.toLowerCase(),
      );
      if (already) continue;

      // The user's own home is the natural primary; otherwise the first house
      // created takes it, which `addHouse` handles.
      state.addHouse({ name, isPrimary: line.id === 'house-own' });
    }

    // Resolved AFTER the houses above exist — see the comment there.
    const primaryHouseId = state.houses.find((house) => house.isPrimary)?.id ?? null;

    /*
     * The lines the user picked, plus the ones every board gets regardless.
     *
     * Bank charges are the case: nobody opts in to them, the SMS parser already
     * routes fees to that line by id, and without it those messages arrive with
     * nowhere to land. Appended rather than pre-ticked in step 2, so it is not a
     * question the user has to answer — see `DEFAULT_CATALOG_IDS`.
     *
     * Guarded against the user having picked it anyway, which would otherwise
     * create the line twice.
     */
    const committed = [...lines];
    for (const id of DEFAULT_CATALOG_IDS) {
      if (committed.some((line) => line.id === id)) continue;

      const entry = CATALOG_SUBCATEGORY_BY_ID.get(id);
      if (!entry) continue;

      committed.push({
        id: entry.subcategory.id,
        name: entry.subcategory.name,
        categoryId: entry.category.id,
        icon: entry.subcategory.icon,
        type: entry.subcategory.type ?? 'expense',
        // No budget: fees are whatever they turn out to be, which is what
        // `unplanned` means — the line sums its actuals.
        plannedMinor: 0,
        dueDay: entry.subcategory.dueDay ?? 1,
        frequency: entry.subcategory.frequency ?? 'unplanned',
        /*
         * NO account, deliberately.
         *
         * Bank charges are not paid FROM one account — they are deducted BY
         * whichever bank levied them, so a household with three banks gets fees
         * on all three and they all belong on this one line. Pinning it to a
         * single card would put every fee in that account's transfer total,
         * overstating what has to be moved there and hiding the rest.
         *
         * Each entry records where it actually came from; the line is only the
         * bucket that adds them up.
         */
        cardId: null,
        currency: 'local',
        foreignAmount: null,
        planTargetMinor: null,
        planDueDate: null,
      });
    }

    const byCategory = new Map<string, DraftLine[]>();
    for (const line of committed) {
      const bucket = byCategory.get(line.categoryId) ?? [];
      bucket.push(line);
      byCategory.set(line.categoryId, bucket);
    }

    let categoryIndex = 0;
    for (const catalog of CATEGORY_CATALOG) {
      const group = byCategory.get(catalog.id);
      if (!group || group.length === 0) continue;

      /*
       * A category's default card is whichever account its lines mostly use —
       * EXCEPT the bank-fees category, which deliberately has none.
       *
       * `resolveCardId` falls back from a line to its category, so leaving the
       * charges line account-less is not enough on its own: it would simply
       * inherit the category's card and land in that account's transfer total
       * anyway. Fees are levied by whichever bank charged them, across every
       * account the user holds, so neither level names one.
       */
      const isFeeCategory = catalog.id === 'bank-fees';
      const created = state.addCategory({
        name: catalog.name,
        icon: catalog.icon,
        cardId: isFeeCategory ? null : (dominantCardId(group) ?? state.cards[0]?.id ?? null),
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
          /*
           * Per-property bills are marked at creation, from the catalog id the
           * draft line still carries. Doing it here rather than asking the user
           * keeps the houses step to naming places — nobody wants to answer
           * "is electricity per-house?" for every line they picked.
           */
          houseScoped: isHouseScopedCatalogId(line.id),
          // Whichever house is the user's own, so the common case needs no tap.
          houseId: primaryHouseId,
          /*
           * The save-up plan, carried through to the real subcategory.
           *
           * Without these the plan the user built on a yearly line — the whole
           * point of offering it here — was discarded on commit, and the line
           * arrived on the board as a plain yearly bill with the monthly figure
           * as its amount, which reads as an error.
           */
          planTargetMinor: line.planTargetMinor,
          planDueDate: line.planDueDate ? new Date(line.planDueDate) : null,
          planStartDate: line.planTargetMinor != null ? new Date() : null,
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
    <StepHeader step={4} title="Set up your plan" onBack={() => router.back()}>
      Tap a line to set its plan amount, day and account. Hold and drag to
      reorder.
    </StepHeader>

    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        // Clears the pinned footer, which overlays this list. See FOOTER_CLEARANCE.
        paddingBottom: space.lg + FOOTER_CLEARANCE,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
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
        {/*
          The account requirement leads, because it is the only one that
          actually blocks. A missing amount is reported underneath as
          information — "you can do this later" — rather than as an error,
          since it does not stop anything.
        */}
        {unfundedCount > 0 ? (
          <Row justify="center">
            <Text variant="caption" tone="muted">
              {unfundedCount} line{unfundedCount === 1 ? '' : 's'} still need an account
            </Text>
          </Row>
        ) : unsetCount > 0 ? (
          <Row justify="center">
            <Text variant="caption" tone="muted">
              {unsetCount} line{unsetCount === 1 ? '' : 's'} without a plan amount — you can
              add these later
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
        /*
         * "Set" is muted; a real figure is not.
         *
         * The word invites the tap that opens the editor — a bare dash would
         * read as missing data rather than as something to do. But setting an
         * amount is OPTIONAL (see `unsetCount`), so it must not look like an
         * error either: muted grey says "you could fill this in", where the
         * ink-coloured figures beside it say "this is set".
         */
        color={
          line.plannedMinor > 0
            ? line.type === 'income'
              ? colors.completed
              : colors.ink
            : colors.inkFaint
        }
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

  const [addingAccount, setAddingAccount] = useState(false);

  /*
   * The saving-plan form's own state, reseeded whenever a different line opens.
   *
   * `SavingPlanFields` is a string-shaped form (see `SavingPlanDraft`) while the
   * draft line stores the resolved target and date, so the two cannot be the
   * same object — the form has to hold what was typed, including the half-typed
   * states that resolve to no plan at all.
   */
  const [planDraft, setPlanDraft] = useState<SavingPlanDraft>(emptySavingPlanDraft);

  React.useEffect(() => {
    setPlanDraft(
      line
        ? savingPlanDraftFrom({
            planTargetMinor: line.planTargetMinor,
            planDueDate: line.planDueDate ? new Date(line.planDueDate) : null,
          })
        : emptySavingPlanDraft,
    );
  }, [line?.id]);

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
                    {/*
                      "PLAN AMOUNT", not "AMOUNT".

                      This figure is what the user INTENDS to spend on the line,
                      not what was actually spent — the actual is logged later,
                      per month, against this. On a screen titled "Set up your
                      plan" the bare word invited the reading "what did this
                      cost?", which is a different number and a month too early
                      to know.

                      A spending budget says so in its own words, since what it
                      holds is a monthly ceiling its entries draw against rather
                      than one payment.
                    */}
                    <Label>
                      {line.frequency === 'unplanned' ? 'MONTHLY BUDGET' : 'PLAN AMOUNT'}
                    </Label>
                  </View>
                  {/*
                    On EVERY line, not just income.

                    Software subscriptions, cloud storage and streaming are all
                    billed in USD here, and offering the toggle only on income
                    meant the user converted at today's rate by hand and typed a
                    figure that was wrong by the next month. Holding the original
                    amount and the rate keeps the line honest and lets the row
                    show "$12 @ rate" rather than a stale local number.
                  */}
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
                </Row>

                <TextInput
                  /*
                   * Grouped for display, so a seven-digit salary is readable as
                   * it is typed rather than a wall of digits.
                   *
                   * This field is unusual: it holds no text state of its own —
                   * the value is derived from the parsed number in the draft on
                   * every render. So the formatting is applied to what is shown
                   * rather than in `onChangeText`, and `parseAmount` below
                   * strips the separators straight back out.
                   */
                  value={
                    line.currency === 'usd'
                      ? line.foreignAmount
                        ? formatAmountInput(String(line.foreignAmount))
                        : ''
                      : line.plannedMinor > 0
                        ? formatAmountInput(String(line.plannedMinor / 100))
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
                  // `decimal-pad`, matching every other money field: the
                  // numeric pad offers punctuation this input only strips.
                  keyboardType="decimal-pad"
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

              {/*
                `includeUnplanned` — an ongoing spending budget is a cadence a
                plan needs from the start.

                Groceries, fuel and cash are not one payment on a day; they are a
                monthly budget that many entries draw against. Leaving that
                option out of onboarding meant those lines were set up as fixed
                monthly bills, went "overdue" on their due day, and had to be
                converted one at a time afterwards.
              */}
              <FrequencyPicker
                label="Frequency"
                value={line.frequency}
                includeUnplanned
                onChange={(frequency) =>
                  draft.updateLine(line.id, {
                    frequency: frequency as DraftLine['frequency'],
                    // A plan only means anything on a yearly line; leaving a
                    // stale one behind would set aside money for a due date the
                    // line no longer has.
                    ...(frequency === 'yearly'
                      ? null
                      : { planTargetMinor: null, planDueDate: null }),
                  })
                }
              />

              {/*
                Save-up plan, offered on yearly lines exactly as the subcategory
                editor does. Vehicle insurance is the case that drove this: a
                once-a-year figure that the user would rather fund monthly.
              */}
              {line.frequency === 'yearly' ? (
                <SavingPlanFields
                  draft={planDraft}
                  onChange={(next) => {
                    setPlanDraft(next);
                    const patch = toSavingPlanPatch(next);
                    draft.updateLine(line.id, {
                      planTargetMinor: patch?.planTargetMinor ?? null,
                      planDueDate: patch?.planDueDate
                        ? patch.planDueDate.toISOString()
                        : null,
                      // The monthly set-aside REPLACES the planned amount, so
                      // the plan's totals show what is actually put aside each
                      // month rather than the whole yearly figure.
                      ...(patch ? { plannedMinor: patch.monthlyMinor } : null),
                    });
                  }}
                />
              ) : null}

              {/* An ongoing budget has no single day it falls due. */}
              {line.frequency === 'unplanned' ? null : (
                <DayPicker
                  value={line.dueDay}
                  onChange={(dueDay) => draft.updateLine(line.id, { dueDay })}
                />
              )}

              <View style={{ gap: space.sm }}>
                {/*
                  Income arrives *into* an account; expenses go *out of* one.

                  A spending budget names no account at all: its entries each
                  carry their own, and bank charges in particular are levied by
                  whichever bank charged them. So it is labelled as optional
                  rather than marked Required — see `unfundedCount`.
                */}
                <Row justify="space-between" align="center" gap={space.sm}>
                  <Label>
                    {line.type === 'income'
                      ? 'PAID IN TO'
                      : line.frequency === 'unplanned'
                        ? 'USUALLY PAID FROM'
                        : 'PAID FROM'}
                  </Label>
                  {!line.cardId && line.frequency !== 'unplanned' ? (
                    <Text variant="caption" color={colors.danger} style={{ fontWeight: '700' }}>
                      Required
                    </Text>
                  ) : line.frequency === 'unplanned' ? (
                    <Text variant="caption" tone="muted">
                      Optional
                    </Text>
                  ) : null}
                </Row>
                {line.frequency === 'unplanned' ? (
                  <Text variant="caption" tone="muted">
                    Each entry records its own account, so this can be left
                    unset — useful for bank fees, which any of your accounts can
                    be charged.
                  </Text>
                ) : null}
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
                          /*
                           * Tapping the chosen account again does NOT clear it.
                           *
                           * The field is required, so "none" is not a state the
                           * user can be in — and a toggle that silently empties
                           * a mandatory field turns a mis-tap into a line that
                           * fails validation somewhere the user is no longer
                           * looking. Switching accounts is still one tap.
                           */
                          onPress={() => draft.updateLine(line.id, { cardId: card.id })}
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

                    {/*
                      Adding an account from the place you discover you need
                      one. Sitting at the END of the list rather than above it,
                      so the accounts you already have stay the first thing read
                      and this is what you reach when none of them fit.
                    */}
                    <Pressable
                      onPress={() => setAddingAccount(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Add another account"
                      /*
                       * Deliberately the same metrics as an account row above:
                       * identical padding, radius and border width, and a
                       * leading tile the same 40px as the rows' BankLogo.
                       *
                       * Matching the padding alone would not be enough — a row's
                       * height is driven by that 40px mark, so a button holding
                       * only a 20px icon lands noticeably shorter and the list
                       * ends on a ragged edge.
                       */
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        paddingVertical: space.md,
                        paddingHorizontal: space.md,
                        borderRadius: radius.lg,
                        borderWidth: 2,
                        borderStyle: 'dashed',
                        borderColor: colors.hairlineStrong,
                        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                      })}
                    >
                      {/* Stands in for the rows' bank mark, so the text baseline
                          and the row height both line up with the list. */}
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: radius.md,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: colors.accentSoft,
                        }}
                      >
                        <Ionicons name="add" size={22} color={colors.accent} />
                      </View>
                      <Text
                        variant="bodyStrong"
                        color={colors.accent}
                        style={{ flex: 1 }}
                        numberOfLines={1}
                      >
                        {state.cards.length > 0 ? 'Add another account' : 'Add an account'}
                      </Text>
                    </Pressable>
                  </View>
              </View>

            </>
          ) : null}

      {/*
        The add-account sheet, stacked INSIDE this one.

        It cannot be its own `<Modal>`: iOS will not present a second modal from
        inside one that is already up, which is why an earlier pass had to swap
        the two — unmounting the line editor and losing the user's place. Nor
        can it replace this sheet's content, because the answer being edited
        (the line, its amount, its day) should stay visible behind the thing
        being added.

        `asRoute` renders the shared chrome WITHOUT a Modal wrapper, so an
        absolutely-positioned overlay inside this sheet gives a real stacked
        sheet: the line editor stays mounted and on screen underneath, and
        dismissing this returns to it with nothing lost.
      */}
      {addingAccount ? (
        <View style={StyleSheet.absoluteFill}>
          {/* Dims the editor behind, so the two layers read as stacked rather
              than as one confusing merged form. */}
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
            accessibilityLabel="Dismiss"
            onPress={() => setAddingAccount(false)}
          />
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              // Inset from the top so the editor is visibly still there behind
              // it — the point of stacking rather than replacing.
              top: space.xxl,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              overflow: 'hidden',
              backgroundColor: colors.surface,
            }}
          >
            <AddAccountSheet
              visible
              asRoute
              onClose={() => setAddingAccount(false)}
              onAdded={(cardId) => {
                // Assign the new account to the line straight away — needing
                // one is why the user added it.
                if (line) draft.updateLine(line.id, { cardId });
                setAddingAccount(false);
              }}
            />
          </View>
        </View>
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

