import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { AccountPickerSheet } from '~/features/accounts/components/AccountPicker';
import { Field, FrequencyPicker } from '~/shared/components/forms';
import { BottomSheet, Button, Divider, FundingBar, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { DayPicker } from '~/features/budget/components/DayPicker';
import { DueDateCalendar } from '~/features/budget/components/DueDateCalendar';
import { ImageUploader } from '~/shared/components/ImageUploader';
import { formatAmountInput, formatMoney, parseAmount } from '~/shared/lib/money';
import {
  dueDateFor,
  formatPeriod,
  isFlexibleDueDay,
  periodKey,
  resolveCardId,
  type SubcategoryStatus,
} from '~/features/budget/logic/planning';
import {
  supportsSavingPlan,
  isOngoing,
  type SubcategoryFrequency,
  type Transaction,
} from '../../src/db/schema';
import { accountLabel, accountName, resolveBrand } from '~/shared/data/banks';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import {
  savingPlanDraftFrom,
  SavingPlanFields,
  SavingPlanProgressCard,
  toSavingPlanPatch,
  type SavingPlanDraft,
} from '~/features/budget/components/SavingPlanFields';
import { selectSavingPlans, selectTransactions, useAppStore } from '../../src/store/useAppStore';
import { statusStyle } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** Edit one subcategory: its plan, its actual cost, and its status this month. */
export default function SubcategoryScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAppStore();

  const subcategory = useMemo(
    () => state.subcategories.find((s) => s.id === id),
    [state.subcategories, id],
  );
  const stateRow = id ? state.states.get(id) : undefined;
  const category = useMemo(
    () => state.categories.find((c) => c.id === subcategory?.categoryId),
    [state.categories, subcategory?.categoryId],
  );
  /**
   * The funding account, as an UNSAVED edit like every other field here.
   *
   * `undefined` means "not touched" — which is distinct from `null`, the
   * explicit choice to inherit the category's default. Collapsing the two would
   * make opening the screen and pressing Save silently detach a line from the
   * account it was already using.
   */
  const [cardId, setCardId] = useState<string | null | undefined>(undefined);

  /*
   * Reads the PENDING choice when there is one, so the row updates as soon as
   * the picker closes rather than only after Save — the same live-preview
   * behaviour every other field on this screen has.
   */
  const fundingCard = useMemo(() => {
    const chosen = cardId === undefined ? subcategory?.cardId : cardId;
    return state.cards.find((c) => c.id === resolveCardId(chosen, category?.cardId));
  }, [state.cards, cardId, subcategory?.cardId, category?.cardId]);

  // Progress comes from the shared selector so the figure matches everywhere.
  const savedMinor = useMemo(() => {
    if (!id) return 0;
    return (
      selectSavingPlans(state).find((p) => p.subcategory.id === id)?.progress.savedMinor ?? 0
    );
  }, [state, id]);

  const [name, setName] = useState(subcategory?.name ?? '');
  // Seeded through `formatAmountInput` so an existing amount opens grouped —
  // the field formats as you type, and a stored value that only gained its
  // separators after the first keystroke would look like a different control.
  const [planned, setPlanned] = useState(
    subcategory ? formatAmountInput(String(subcategory.plannedMinor / 100)) : '',
  );
  const [note, setNote] = useState(stateRow?.note ?? '');
  /*
   * What a DATED bill actually cost, as one figure.
   *
   * Right shape for a line paid once a month: there is a single amount, so a
   * list of entries would be a list of one. Ongoing lines use the entry list
   * instead, which is where several charges a month belong.
   */
  const [actual, setActual] = useState(
    stateRow?.actualMinor != null ? formatAmountInput(String(stateRow.actualMinor / 100)) : '',
  );
  /*
   * The slip for a DATED bill's payment, stored on the month.
   *
   * Ongoing lines attach theirs per ENTRY, beside the amount it is evidence
   * for. A dated bill has no entries, so its receipt belongs to the month — the
   * same place its actual and note already live.
   */
  const [imageUri, setImageUri] = useState<string | null>(stateRow?.imageUri ?? null);
  const [frequency, setFrequency] = useState<SubcategoryFrequency>(
    subcategory?.frequency ?? 'monthly',
  );
  // Which month a one-time cost belongs to. Defaults to the stored anchor, or
  // the line's creation month for rows written before that field existed.
  const [oncePeriod, setOncePeriod] = useState(
    subcategory?.onceInPeriod ?? (subcategory ? periodKey(subcategory.createdAt) : ''),
  );
  const [parentId, setParentId] = useState(subcategory?.categoryId ?? '');
  /**
   * WHICH DAY this bill falls due.
   *
   * `null` means "follow the category", which is the state most lines are in
   * and the one that must stay reachable — a bill pinned to a day of its own
   * silently stops tracking a category-wide change. The screen showed this day
   * on a calendar but gave no way to alter it, so a bill that moved from the
   * 5th to the 25th could only be fixed by deleting and re-adding it.
   */
  const [dueDay, setDueDay] = useState<number | null>(subcategory?.dueDay ?? null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [plan, setPlan] = useState<SavingPlanDraft>(() =>
    savingPlanDraftFrom({
      planTargetMinor: subcategory?.planTargetMinor,
      planDueDate: subcategory?.planDueDate,
    }),
  );
  /**
   * Paid/pending as an UNSAVED edit, like every other field on this screen.
   *
   * It used to write straight through to the database on tap, which meant the
   * one control that mattered most ignored both the Save button and the act of
   * backing out — the change was already committed. Holding it here makes the
   * whole sheet behave consistently: nothing is written until Save.
   */
  const [status, setStatus] = useState<SubcategoryStatus>(
    (stateRow?.status as SubcategoryStatus) ?? 'pending',
  );
  /** The entry being edited in the inline sheet, or null when none is open. */
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);

  // Ongoing lines behave differently: they hold a list of individual
  // transactions, have no single planned/actual amount, and are never marked
  // paid as a whole — so several fields below are hidden for them.
  const ongoing = isOngoing(frequency);
  /**
   * Whether a saving plan is currently driving this line's monthly amount.
   *
   * When it is, `plannedMinor` is derived from the plan (see the save handler)
   * and the "Plan amount" field is hidden — a box whose value is discarded on
   * save is worse than no box.
   */
  const savingPlanActive = supportsSavingPlan(frequency) && plan.enabled;
  /**
   * The day this line actually falls due: its own when pinned, otherwise its
   * category's, otherwise the 1st. Derived once so the calendar, the picker and
   * the overdue test can never disagree about which day they are describing.
   */
  const effectiveDueDay = dueDay ?? category?.dueDay ?? 1;

  /**
   * The loan this line is the installment for, when it is one.
   *
   * A loan-linked line is not freely editable: its name and its amount are
   * DERIVED from the loan's principal, rate and term (see `updateLoan`), so
   * typing a different figure here would be overwritten the next time the loan
   * was touched — and in the meantime the plan would fund an installment the
   * lender is not charging. The screen says so and points at the loan instead
   * of silently accepting an edit it cannot keep.
   */
  const linkedLoan = subcategory?.loanId
    ? state.loans.find((entry) => entry.id === subcategory.loanId)
    : undefined;
  /*
   * Read ABOVE the "not found" guard, not below it.
   *
   * Deleting this subcategory flips that guard on, and a `useMemo` sitting
   * after it would then not run — React counts fewer hooks than the previous
   * render and throws, which crashed the app on every subcategory delete. Every
   * hook on this screen has to be unconditional for that reason.
   */
  // Loaded for EVERY line, not just ongoing ones. An ongoing line accumulates
  // many entries; a dated bill holds exactly one — the payment itself — and
  // recording it is what marks the bill paid.
  const transactions = useMemo(
    () => (id ? selectTransactions(state, id) : []),
    [state, id],
  );

  if (!subcategory) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.md,
        }}
      >
        <Text variant="heading">Not found</Text>
        <Button label="Go back" onPress={() => closeModal()} variant="ghost" />
      </View>
    );
  }

  // The repo already collapses legacy values, so this is pending/paid.
  const savedStatus: SubcategoryStatus = (stateRow?.status as SubcategoryStatus) ?? 'pending';

  const ongoingTotal = transactions.reduce((sum, t) => sum + t.amountMinor, 0);
  // The budget these entries draw against, read from the field being edited so
  // the bar responds as the user types a new figure rather than after saving.
  const plannedMinor = parseAmount(planned) ?? 0;
  const overBudget = plannedMinor > 0 && ongoingTotal > plannedMinor;

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    // A saving plan only applies to yearly lines; its monthly set-aside is
    // derived from the plan and overrides the planned-amount field. On any
    // other frequency the plan is dropped (the store also clears stored plan
    // fields when frequency leaves yearly).
    const planPatch = frequency === 'yearly' ? toSavingPlanPatch(plan) : null;
    state.updateSubcategory(subcategory!.id, {
      name: trimmed,
      // A spending-budget line keeps its planned amount too — that is the
      // monthly budget its entries are drawn against, not a bill to pay once.
      plannedMinor: planPatch ? planPatch.monthlyMinor : (parseAmount(planned) ?? 0),
      frequency,
      // Only a one-time line carries a month anchor; any other frequency
      // recurs, so a stale anchor is cleared rather than left behind.
      onceInPeriod: frequency === 'one_time' ? oncePeriod : null,
      planTargetMinor: planPatch?.planTargetMinor ?? null,
      planDueDate: planPatch?.planDueDate ?? null,
      planStartDate: planPatch?.planStartDate ?? subcategory!.planStartDate ?? null,
      // Only when the user actually chose one — `undefined` means untouched, so
      // spreading nothing leaves the stored account exactly as it was.
      ...(cardId === undefined ? null : { cardId }),
      // Null is a real value here, not "unset": it puts the line back onto its
      // category's day rather than pinning it to one of its own.
      dueDay,
    });

    // Move to a different parent category if the user changed it.
    if (parentId && parentId !== subcategory!.categoryId) {
      state.changeSubcategoryParent(subcategory!.id, parentId);
    }

    /*
     * Per-month status, note and slip — dated bills only; an ongoing line is
     * never "paid" as a whole, so there is nothing to log here for it.
     *
     * The typed actual is the amount: one payment, one figure. An ongoing line
     * has no per-month actual at all — its spend is the sum of its entries.
     */
    if (!ongoing) {
      state.logTransaction(subcategory!.id, {
        status,
        actualMinor: actual.trim() === '' ? null : parseAmount(actual),
        note: note.trim() || null,
        imageUri,
      });
    }

    closeModal();
  }

  function confirmDelete() {
    Alert.alert(`Delete ${subcategory!.name}?`, 'This removes it from the category.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteSubcategory(subcategory!.id);
          closeModal();
        },
      },
    ]);
  }

  const brand = fundingCard
    ? resolveBrand({ bankId: fundingCard.bankId, bankName: fundingCard.bankName })
    : undefined;
  const style = statusStyle(status, colors);
  const paid = status === 'paid';

  // Save stays disabled until something actually changed. The plan compares
  // its *resolved* target/date, so editing an active plan counts as a change.
  const resolvedPlan = toSavingPlanPatch(plan);
  const planChanged =
    (resolvedPlan?.planTargetMinor ?? null) !== (subcategory.planTargetMinor ?? null) ||
    (resolvedPlan?.planDueDate?.getTime() ?? null) !==
      (subcategory.planDueDate?.getTime() ?? null);

  const isDirty =
    name.trim() !== subcategory.name ||
    parentId !== subcategory.categoryId ||
    /*
      Only when the field is actually on screen.

      With a saving plan running the line the box is hidden and its value is
      discarded on save, so a `planned` string left over from before the plan
      was switched on would hold Save enabled forever — the comparison could
      never come true, because saving writes the plan's figure instead.
    */
    (savingPlanActive ? false : (parseAmount(planned) ?? 0) !== subcategory.plannedMinor) ||
    (actual.trim() === '' ? null : parseAmount(actual)) !== (stateRow?.actualMinor ?? null) ||
    imageUri !== (stateRow?.imageUri ?? null) ||
    note.trim() !== (stateRow?.note ?? '') ||
    // Ticking "paid" is an edit like any other — it enables Save and is only
    // written when Save is pressed.
    status !== savedStatus ||
    frequency !== subcategory.frequency ||
    // Changing only which month a one-time cost lands in is a real edit.
    (frequency === 'one_time' && oncePeriod !== subcategory.onceInPeriod) ||
    // Untouched (`undefined`) is not a change; picking the same account back is
    // not either, which is why this compares values rather than just testing
    // that the picker was opened.
    (cardId !== undefined && cardId !== (subcategory.cardId ?? null)) ||
    dueDay !== (subcategory.dueDay ?? null) ||
    planChanged;

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title={subcategory.name}
      eyebrow={category?.name}
      icon={(subcategory.icon ?? 'pricetag-outline') as keyof typeof Ionicons.glyphMap}
      iconColor={category?.color ?? colors.accent}
      scroll
      footer={
        <GradientButton
          label="Save changes"
          icon="checkmark"
          onPress={handleSave}
          disabled={!name.trim() || !isDirty}
        />
      }
    >
        {/*
          Money and account — NOT the name.

          The sheet header directly above already carries this line's icon, its
          name and its category as the eyebrow. Repeating all three here meant
          the top of the screen said "Groceries / Home Expenses" twice in a row,
          pushing the figure the user opened the screen to see below the fold.
          The header is the identity; this card is the money.
        */}
        <Surface style={{ gap: space.md }}>
          {/* The cadence, which the header does not say. Monthly is the
              default and goes without saying. */}
          {subcategory.frequency !== 'monthly' ? (
            <Row gap={6}>
              <Ionicons name="repeat-outline" size={13} color={colors.inkMuted} />
              <Text variant="caption" tone="muted">
                {subcategory.frequency.replace('_', '-')}
              </Text>
            </Row>
          ) : null}

          {ongoing ? (
            /* A spending budget answers "how much of my budget is left", so it
               shows spend against the planned amount rather than a bare total.
               The bar is the fastest read; the figures underneath give the
               exact numbers. A line with no budget set yet just shows spend. */
            <View style={{ gap: space.sm }}>
              <Row justify="space-between" align="flex-end">
                <View>
                  <Text variant="small" tone="secondary">
                    Spent this month
                  </Text>
                  <Text
                    variant="figureLarge"
                    color={overBudget ? colors.danger : colors.accent}
                  >
                    {formatMoney(ongoingTotal)}
                  </Text>
                </View>
                {plannedMinor > 0 ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="caption" tone="muted">
                      of {formatMoney(plannedMinor)}
                    </Text>
                    <Text
                      variant="small"
                      color={overBudget ? colors.danger : colors.completed}
                      style={{ fontWeight: '700' }}
                    >
                      {overBudget
                        ? `${formatMoney(ongoingTotal - plannedMinor)} over`
                        : `${formatMoney(plannedMinor - ongoingTotal)} left`}
                    </Text>
                  </View>
                ) : null}
              </Row>

              {plannedMinor > 0 ? (
                <FundingBar
                  pct={(ongoingTotal / plannedMinor) * 100}
                  color={overBudget ? colors.danger : category?.color ?? colors.accent}
                  height={8}
                />
              ) : null}
            </View>
          ) : (
            <>
              <Row justify="space-between">
                <Text variant="small" tone="secondary">
                  Planned
                </Text>
                <Text variant="figureLarge">{formatMoney(subcategory.plannedMinor)}</Text>
              </Row>
              {stateRow?.actualMinor != null ? (
                <Row justify="space-between">
                  <Text variant="small" tone="secondary">
                    Actual
                  </Text>
                  <Text variant="figure" color={colors.accent}>
                    {formatMoney(stateRow.actualMinor)}
                  </Text>
                </Row>
              ) : null}
            </>
          )}

          {/*
            The funding account, now CHANGEABLE from here.

            It used to be a read-only line, which meant the one screen that
            edits everything else about a bill could not answer "this comes off
            the other card now" — the user had to delete the line and rebuild
            it, or go hunting in the category's settings for a default that this
            line may not even be using. Since the row already names the account,
            making it tappable is the whole fix.

            Shown even when nothing is set yet, so a line inheriting its
            category's default can be pointed somewhere explicitly rather than
            offering no control at all.
          */}
          <Divider />
          {/*
            The account, drawn at the size a bank is actually RECOGNISED at.

            This was a 26px mark beside a line of secondary grey text — legible,
            but not something the eye lands on, which is a poor fit for the one
            fact on this screen the user most often opens it to check ("which
            card does this come off?"). At 34px with the account name in full
            strength it reads as a first-class row, and the brand tint behind it
            ties the row to the bank without a second label saying so.
          */}
          <Pressable
            onPress={() => setAccountPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              fundingCard
                ? `Paid from ${accountName(fundingCard)}. Change account`
                : 'Choose an account'
            }
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Row gap={space.md}>
              {fundingCard && brand ? (
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    // A tint of the bank's own hue, not a neutral chip: it is
                    // what makes two accounts distinguishable at a glance in a
                    // list of otherwise identical rows.
                    backgroundColor: `${brand.color}1A`,
                  }}
                >
                  <BankLogo brand={brand} size={34} />
                </View>
              ) : (
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.surfaceSunken,
                  }}
                >
                  <Ionicons name="card-outline" size={20} color={colors.inkMuted} />
                </View>
              )}

              <View style={{ flex: 1, gap: 1 }}>
                <Text variant="caption" tone="muted">
                  PAID FROM
                </Text>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {fundingCard ? accountLabel(fundingCard).primary : 'Choose an account'}
                </Text>
                {/* The bank underneath, when the headline is a nickname — a row
                    of nicknames alone cannot be checked against a banking app. */}
                {fundingCard && accountLabel(fundingCard).secondary ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {accountLabel(fundingCard).secondary}
                    {fundingCard.last4 ? ` ·  ••${fundingCard.last4}` : ''}
                  </Text>
                ) : null}
              </View>

              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                Change
              </Text>
            </Row>
          </Pressable>
        </Surface>

        {/*
         * Status toggle — dated bills only. An ongoing line is never "paid" as
         * a whole; its spend is the running total of its entries.
         *
         * It sits ABOVE the entry list on a bill, because settling is the
         * primary act there and the entries are the supporting detail. On an
         * ongoing line there is no toggle and the list is the whole screen.
         */}
        {ongoing ? null : (
          <Pressable
            onPress={() => setStatus(paid ? 'pending' : 'paid')}
            accessibilityRole="button"
            accessibilityLabel={`Mark as ${paid ? 'pending' : 'paid'}. Currently ${style.label}.`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              padding: space.lg,
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: style.fg,
              backgroundColor: style.bg,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name={style.icon as never} size={26} color={style.fg} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" color={style.fg}>
                {paid ? 'Paid this month' : 'Not paid yet'}
              </Text>
              <Text variant="caption" color={style.fg} style={{ opacity: 0.85 }}>
                Tap to mark as {paid ? 'pending' : 'paid'}
              </Text>
            </View>
          </Pressable>
        )}

        {/*
         * Entries — ONGOING lines only.
         *
         * A dated bill is one payment a month, so a list of entries is the
         * wrong shape for it: there is only ever one, and what it cost is a
         * single figure typed into the field above. Smart Detect already agrees
         * — confirming an SMS writes a transaction for an ongoing line and the
         * month's actual for a dated one (see `confirmDraft`).
         */}
        {ongoing ? (
        <OngoingTransactions
          transactions={transactions}
          total={ongoingTotal}
          plannedMinor={plannedMinor}
          onAdd={() => router.push(`/transaction/ongoing?subcategoryId=${subcategory.id}`)}
          onEdit={(txn) => setEditingTxn(txn)}
          onRemove={(txnId, txnName) =>
            Alert.alert(`Delete “${txnName}”?`, 'This entry is removed from the month.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => state.deleteTransaction(txnId),
              },
            ])
          }
        />
        ) : null}

        {/* Saving-plan progress, when this bill has one. */}
        {subcategory.planTargetMinor != null && subcategory.planDueDate ? (
          <SavingPlanProgressCard
            targetMinor={subcategory.planTargetMinor}
            dueDate={subcategory.planDueDate}
            startDate={subcategory.planStartDate ?? subcategory.createdAt}
            savedMinor={savedMinor}
          />
        ) : null}

        {/* Editable plan. */}
        <View style={{ gap: space.md }}>
          <Label>DETAILS</Label>

          {/*
            Read-only on a loan line: the name is DERIVED from the loan, and
            `updateLoan` rewrites it whenever the terms change, so an edit made
            here would be silently reverted.
          */}
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            editable={!linkedLoan}
          />

          {/* Parent category — tap to open a searchable picker, so moving a line
              between categories stays simple even with a long list. */}
          <View style={{ gap: space.sm }}>
            <Label>Category</Label>
            <Pressable
              onPress={() => setCategoryPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Category: ${state.categories.find((c) => c.id === parentId)?.name ?? 'choose'}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: 13,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.hairline,
                backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
              })}
            >
              {(() => {
                const parent = state.categories.find((c) => c.id === parentId);
                return (
                  <>
                    <Ionicons
                      name={(parent?.icon as never) ?? 'albums-outline'}
                      size={18}
                      color={parent?.color ?? colors.inkMuted}
                    />
                    <Text variant="body" style={{ flex: 1 }}>
                      {parent?.name ?? 'Choose a category'}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.inkMuted} />
                  </>
                );
              })()}
            </Pressable>
          </View>

          {/*
            Hidden while a saving plan is running the line.

            With "Collect this monthly?" on, `plannedMinor` is DERIVED — the
            save path writes `planPatch.monthlyMinor` and discards whatever is
            typed here (see the save handler). So the screen was showing an
            amount box that looked authoritative, sat above a second amount box
            inside the plan, and was silently thrown away: three amounts on one
            screen, one of which did nothing.

            The plan's own card already states the monthly figure it computed,
            so nothing is lost by removing the field — the number is still on
            screen, it is simply the real one. `BillFields` reached the same
            conclusion for the same reason and swaps its hero for a read-only
            figure; here the plan card IS that figure.
          */}
          {savingPlanActive ? null : (
            <Field
              // "Plan amount", matching the onboarding step and BillFields — the
              // same figure should not be called three different things across
              // the screens that edit it.
              label={
                linkedLoan
                  ? 'Installment'
                  : ongoing
                    ? 'Monthly amount (optional)'
                    : 'Plan amount'
              }
              value={planned}
              onChangeText={setPlanned}
              money
              placeholder="0"
              // Derived from the loan's terms — see the banner above.
              editable={!linkedLoan}
            />
          )}
          {ongoing ? (
            <Text variant="caption" tone="muted" style={{ marginTop: -space.xs }}>
              What you intend to spend here each month — entries below count
              against it. Leave it at 0 to just track what goes out, with no
              limit to go over.
            </Text>
          ) : (
            /*
             * What it actually came to, for a bill paid once a month. Sits
             * directly under the plan so the two figures read as a pair —
             * planned versus actual — which is the comparison the board makes.
             *
             * Ongoing lines have no such field: their spend is the sum of the
             * entries below, and a second place to type an amount would be a
             * rival answer to the same question.
             */
            <Field
              label="Actual amount (optional)"
              value={actual}
              onChangeText={setActual}
              money
              // "the plan" is the Plan amount field above — which is hidden
              // while a saving plan owns the figure, so the hint names the
              // expected amount instead of pointing at a box that is not there.
              placeholder={
                savingPlanActive
                  ? 'What it actually cost'
                  : 'Leave empty if it matched the plan'
              }
            />
          )}

          {/*
            WHEN IT IS DUE — one calendar, and it is editable.

            A DATED bill shows the month with its due day marked, and tapping
            another day moves it. This grid used to be read-only with a second,
            near-identical picker stacked beneath it; the picker went, and now
            the reporting grid does the setting too. One question, asked once,
            by the thing already answering it.

            An ONGOING line gets the full picker instead. Its spend is spread
            across the month so there is no single dated cell to point at, and
            it needs the "Flexible — no fixed day" option the calendar has no
            room for.
          */}
          {!ongoing ? (
            !isFlexibleDueDay(effectiveDueDay) ? (
              <DueDateCalendar
                dueDate={dueDateFor(state.period, effectiveDueDay)}
                onDayPress={setDueDay}
              />
            ) : null
          ) : (
            <View style={{ gap: space.sm }}>
              <DayPicker
                label="WHEN IT IS DUE"
                value={effectiveDueDay}
                onChange={setDueDay}
              />

              {/*
                An ongoing budget genuinely may have no day — it is money spent
                across the whole month — so the picker's "Flexible" option is
                the expected answer here rather than an edge case, and the
                caption says as much instead of leaving a blank day looking
                like something unfinished.
              */}
              <Text variant="caption" tone="muted">
                When this budget&apos;s money is normally due to go out. Leave it
                flexible if it is spent across the month.
              </Text>

            </View>
          )}

          <FrequencyPicker label="Frequency" value={frequency} onChange={setFrequency} includeOngoing />

          {/* A one-time cost counts in exactly one month — the month it was
              logged in — and in no other. Stated plainly so the bill silently
              leaving every other month is understood rather than surprising. */}
          {frequency === 'one_time' ? (
            <Text variant="caption" tone="muted">
              Counts only in {formatPeriod(oncePeriod)} — it won&apos;t affect any other month.
            </Text>
          ) : null}

          {/* "Collect this monthly?" — yearly lines only. */}
          {supportsSavingPlan(frequency) ? (
            <SavingPlanFields draft={plan} onChange={setPlan} />
          ) : null}

          {!ongoing ? (
            <Field
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="What was this for?"
              multiline
            />
          ) : null}

          {/* `deleteOnReplace={false}` — the saved row still points at the old
              file until Save, so removing it here would break that record if
              the user backed out. */}
          {!ongoing ? (
            <ImageUploader
              label="Slip / receipt"
              value={imageUri}
              onChange={setImageUri}
              deleteOnReplace={false}
              size={140}
            />
          ) : null}
        </View>

        <Pressable
          onPress={confirmDelete}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: space.md,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
          <Text variant="small" color={colors.danger} style={{ fontWeight: '600' }}>
            Delete subcategory
          </Text>
        </Pressable>

    {/* Edit one entry. Writes immediately (it is its own confirmed action with
        its own Save), unlike the fields on this screen. */}
    {editingTxn ? (
      <EditTransactionSheet
        txn={editingTxn}
        onClose={() => setEditingTxn(null)}
        onSave={(patch) => {
          state.updateTransaction(editingTxn.id, patch);
          setEditingTxn(null);
        }}
        onDelete={() => {
          const { id: txnId, name: txnName } = editingTxn;
          Alert.alert(`Delete “${txnName}”?`, 'This entry is removed from the month.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                state.deleteTransaction(txnId);
                setEditingTxn(null);
              },
            },
          ]);
        }}
      />
    ) : null}

    {/*
      Funding-account picker, the same sheet the rest of the app uses.

      `allowNone` because a line is allowed to fall back to its category's
      default — that is a real answer here, unlike in onboarding where every
      line must name its own account.
    */}
    <AccountPickerSheet
      visible={accountPickerOpen}
      cards={state.cards}
      selectedId={cardId === undefined ? (subcategory.cardId ?? null) : cardId}
      allowNone
      onSelect={(id) => {
        setCardId(id);
        setAccountPickerOpen(false);
      }}
      onClose={() => setAccountPickerOpen(false)}
    />

    {/* Searchable category picker. */}
    <BottomSheet
      visible={categoryPickerOpen}
      onClose={() => {
        setCategoryPickerOpen(false);
        setCategoryQuery('');
      }}
      title="Move to category"
    >
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: colors.surfaceSunken,
            borderRadius: 12,
            paddingHorizontal: space.md,
          }}
        >
          <Ionicons name="search" size={16} color={colors.inkMuted} />
          <TextInput
            value={categoryQuery}
            onChangeText={setCategoryQuery}
            placeholder="Search categories…"
            placeholderTextColor={colors.inkMuted}
            style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.ink }}
          />
        </View>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.md }}
        keyboardShouldPersistTaps="handled"
      >
        {state.categories
          .filter((c) => c.name.toLowerCase().includes(categoryQuery.trim().toLowerCase()))
          .map((c) => {
            const selected = c.id === parentId;
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  setParentId(c.id);
                  setCategoryPickerOpen(false);
                  setCategoryQuery('');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingVertical: space.md,
                  paddingHorizontal: space.md,
                  borderRadius: 12,
                  backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfaceSunken : 'transparent',
                })}
              >
                <Ionicons name={(c.icon as never) ?? 'albums-outline'} size={20} color={c.color} />
                <Text variant="body" color={selected ? colors.accent : colors.ink} style={{ flex: 1, fontWeight: selected ? '700' : '500' }}>
                  {c.name}
                </Text>
                {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
      </ScrollView>
    </BottomSheet>
    </BottomSheet>
  );
}

/**
 * The entry list for an ONGOING line: what has gone out this month, an "add"
 * action, and every transaction.
 *
 * Ongoing only. A dated bill is paid once a month, so a list is the wrong shape
 * for it — there is only ever one payment, and what it cost is a single figure
 * typed into "Actual amount" on the screen above.
 *
 * Each row is tappable to edit and carries an explicit delete. Both are needed:
 * an amount typed wrong (or a mis-parsed SMS draft) previously had to be deleted
 * and re-entered, losing its date and note, and the running total is only
 * trustworthy if a wrong entry can be corrected in place.
 */
function OngoingTransactions({
  transactions,
  total,
  plannedMinor,
  onAdd,
  onEdit,
  onRemove,
}: {
  transactions: Transaction[];
  total: number;
  /** The monthly amount, when set — drives the header's remaining figure. */
  plannedMinor: number;
  onAdd: () => void;
  onEdit: (txn: Transaction) => void;
  onRemove: (id: string, name: string) => void;
}) {
  const { colors, space } = useTheme();
  const overBudget = plannedMinor > 0 && total > plannedMinor;

  return (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      <Row
        justify="space-between"
        align="center"
        style={{ padding: space.lg, paddingBottom: space.sm }}
      >
        <View>
          <Label>SPENT THIS MONTH</Label>
          <Text variant="figureLarge" color={overBudget ? colors.danger : colors.accent}>
            {formatMoney(total)}
          </Text>
          {/* Progress against the monthly amount, when one is set. Without a
              cap there is nothing to be over, so it just counts entries. */}
          {plannedMinor > 0 ? (
            <Text variant="caption" tone="muted">
              {transactions.length} {transactions.length === 1 ? 'entry' : 'entries'} ·{' '}
              {overBudget
                ? `${formatMoney(total - plannedMinor)} over budget`
                : `${formatMoney(plannedMinor - total)} left`}
            </Text>
          ) : (
            <Text variant="caption" tone="muted">
              {transactions.length} {transactions.length === 1 ? 'entry' : 'entries'} · no monthly amount set
            </Text>
          )}
        </View>
        <Button label="Add" icon="add" size="sm" onPress={onAdd} />
      </Row>

      {transactions.length === 0 ? (
        <Text variant="caption" tone="muted" style={{ padding: space.lg, paddingTop: 0 }}>
          No entries yet this month. Tap Add, or confirm an SMS draft against
          this line.
        </Text>
      ) : (
        transactions.map((txn, index) => (
          <View key={txn.id}>
            {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
            {/* The whole row opens the editor — a bigger, more obvious target
                than a pencil icon, and the delete stays separate so a mis-tap
                cannot destroy an entry. */}
            <Pressable
              onPress={() => onEdit(txn)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${txn.name}, ${formatMoney(txn.amountMinor)}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
              })}
            >
              <View style={{ flex: 1 }}>
                <Row gap={4} align="center">
                  <Text variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>
                    {txn.name}
                  </Text>
                  {/* A slip is worth knowing about from the list — otherwise a
                      receipt is invisible until the entry is opened. */}
                  {txn.imageUri ? (
                    <Ionicons name="receipt-outline" size={12} color={colors.inkMuted} />
                  ) : null}
                </Row>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {new Date(txn.date).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}
                  {txn.note ? ` · ${txn.note}` : ''}
                </Text>
              </View>
              <Text variant="figure">{formatMoney(txn.amountMinor)}</Text>
              <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
              <Pressable
                onPress={() => onRemove(txn.id, txn.name)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${txn.name}`}
              >
                <Ionicons name="close-circle" size={20} color={colors.inkMuted} />
              </Pressable>
            </Pressable>
          </View>
        ))
      )}
    </Surface>
  );
}

/**
 * Edit one existing entry: what it was, how much, and when.
 *
 * Deliberately the same three fields as the add sheet, so correcting an entry
 * and creating one are the same task. Seeded per open from the row being edited,
 * and it writes through `updateTransaction` — which re-derives the period from
 * the date, so moving an entry into another month files it there.
 */
function EditTransactionSheet({
  txn,
  onClose,
  onSave,
  onDelete,
}: {
  txn: Transaction;
  onClose: () => void;
  onSave: (patch: {
    name: string;
    amountMinor: number;
    date: Date;
    note: string | null;
    imageUri: string | null;
  }) => void;
  onDelete: () => void;
}) {
  const { colors, space } = useTheme();
  const [name, setName] = useState(txn.name);
  const [amount, setAmount] = useState(String(txn.amountMinor / 100));
  const [date, setDate] = useState(() => new Date(txn.date));
  const [note, setNote] = useState(txn.note ?? '');
  const [imageUri, setImageUri] = useState<string | null>(txn.imageUri ?? null);

  const amountMinor = parseAmount(amount) ?? 0;
  const canSave = name.trim().length > 0 && amountMinor > 0;

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title="Edit entry"
      eyebrow={txn.name}
      icon="create-outline"
      iconColor={colors.accent}
      scroll
      footer={
        <GradientButton
          label="Save entry"
          icon="checkmark"
          disabled={!canSave}
          onPress={() =>
            onSave({
              name: name.trim(),
              amountMinor,
              date,
              note: note.trim() || null,
              imageUri,
            })
          }
        />
      }
    >
      <Field label="What was it?" value={name} onChangeText={setName} />
      <Field
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        money
        placeholder="0"
      />
      <DatePickerField label="Date" value={date} onChange={setDate} />
      <Field
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="Anything worth remembering?"
        multiline
      />

      {/* `deleteOnReplace={false}` — the stored row still points at the old
          file until Save, so removing it here would break that record if the
          user backed out. */}
      <ImageUploader
        label="Slip / receipt"
        value={imageUri}
        onChange={setImageUri}
        deleteOnReplace={false}
        size={140}
      />

      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: space.md,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="trash-outline" size={16} color={colors.danger} />
        <Text variant="small" color={colors.danger} style={{ fontWeight: '600' }}>
          Delete this entry
        </Text>
      </Pressable>
    </BottomSheet>
  );
}

/** A dashed upload affordance for attaching a slip photo. */

