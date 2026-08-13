import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountPickerSheet } from '../../src/components/AccountPicker';
import { Field, FrequencyPicker } from '../../src/components/forms';
import { BottomSheet, Button, Divider, FundingBar, GradientButton, Label, Row, Surface, Text } from '../../src/components/ui';
import { useModalClose } from '../../src/hooks/useModalClose';
import { DatePickerField } from '../../src/components/DatePickerField';
import { DueDateCalendar } from '../../src/components/DueDateCalendar';
import { ImageUploader } from '../../src/components/ImageUploader';
import { formatAmountInput, formatMoney, parseAmount } from '../../src/core/money';
import {
  dueDateFor,
  formatPeriod,
  isFlexibleDueDay,
  periodKey,
  resolveCardId,
  type SubcategoryStatus,
} from '../../src/core/planning';
import {
  supportsSavingPlan,
  isUnplanned,
  type SubcategoryFrequency,
  type Transaction,
} from '../../src/db/schema';
import { resolveBrand } from '../../src/data/banks';
import { BankLogo } from '../../src/components/BankLogo';
import {
  savingPlanDraftFrom,
  SavingPlanFields,
  SavingPlanProgressCard,
  toSavingPlanPatch,
  type SavingPlanDraft,
} from '../../src/components/SavingPlanFields';
import { selectSavingPlans, selectTransactions, useAppStore } from '../../src/store/useAppStore';
import { statusStyle } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Edit one subcategory: its plan, its actual cost, and its status this month. */
export default function SubcategoryScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
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
  const [actual, setActual] = useState(
    stateRow?.actualMinor != null ? formatAmountInput(String(stateRow.actualMinor / 100)) : '',
  );
  const [note, setNote] = useState(stateRow?.note ?? '');
  const [frequency, setFrequency] = useState<SubcategoryFrequency>(
    subcategory?.frequency ?? 'monthly',
  );
  // Which month a one-time cost belongs to. Defaults to the stored anchor, or
  // the line's creation month for rows written before that field existed.
  const [oncePeriod, setOncePeriod] = useState(
    subcategory?.onceInPeriod ?? (subcategory ? periodKey(subcategory.createdAt) : ''),
  );
  const [parentId, setParentId] = useState(subcategory?.categoryId ?? '');
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [plan, setPlan] = useState<SavingPlanDraft>(() =>
    savingPlanDraftFrom({
      planTargetMinor: subcategory?.planTargetMinor,
      planDueDate: subcategory?.planDueDate,
    }),
  );
  const [imageUri, setImageUri] = useState<string | null>(stateRow?.imageUri ?? null);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
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

  // Unplanned lines behave differently: they hold a list of individual
  // transactions, have no single planned/actual amount, and are never marked
  // paid as a whole — so several fields below are hidden for them.
  const unplanned = isUnplanned(frequency);
  /*
   * Read ABOVE the "not found" guard, not below it.
   *
   * Deleting this subcategory flips that guard on, and a `useMemo` sitting
   * after it would then not run — React counts fewer hooks than the previous
   * render and throws, which crashed the app on every subcategory delete. Every
   * hook on this screen has to be unconditional for that reason.
   */
  const transactions = useMemo(
    () => (id && unplanned ? selectTransactions(state, id) : []),
    [state, id, unplanned],
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

  const unplannedTotal = transactions.reduce((sum, t) => sum + t.amountMinor, 0);
  // The budget these entries draw against, read from the field being edited so
  // the bar responds as the user types a new figure rather than after saving.
  const plannedMinor = parseAmount(planned) ?? 0;
  const overBudget = plannedMinor > 0 && unplannedTotal > plannedMinor;

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
    });

    // Move to a different parent category if the user changed it.
    if (parentId && parentId !== subcategory!.categoryId) {
      state.changeSubcategoryParent(subcategory!.id, parentId);
    }

    // Per-month status/slip/note/actual only apply to normal (non-budget)
    // lines, whose spend is tracked as one figure per period. A spending-budget
    // line tracks each entry separately and is never "paid" as a whole, so
    // there is nothing to log here for it.
    if (!unplanned) {
      const parsedActual = actual.trim() === '' ? null : parseAmount(actual);
      state.logTransaction(subcategory!.id, {
        status,
        actualMinor: parsedActual,
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
    ? resolveBrand({
        bankId: fundingCard.bankId,
        bankName: fundingCard.bankName,
        name: fundingCard.name,
      })
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
    (parseAmount(planned) ?? 0) !== subcategory.plannedMinor ||
    (actual.trim() === '' ? null : parseAmount(actual)) !== (stateRow?.actualMinor ?? null) ||
    note.trim() !== (stateRow?.note ?? '') ||
    imageUri !== (stateRow?.imageUri ?? null) ||
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
        {/* Hero: identity, amount, and where it's paid from at a glance. */}
        <Surface style={{ gap: space.md }}>
          <Row gap={space.md}>
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 15,
                backgroundColor: `${category?.color ?? colors.accent}1F`,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={(subcategory.icon ?? 'pricetag-outline') as never}
                size={22}
                color={category?.color ?? colors.accent}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={1}>
                {subcategory.name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {category?.name ?? 'Category'}
                {subcategory.frequency !== 'monthly'
                  ? ` · ${subcategory.frequency.replace('_', '-')}`
                  : ''}
              </Text>
            </View>
          </Row>

          <Divider />

          {unplanned ? (
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
                    {formatMoney(unplannedTotal)}
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
                        ? `${formatMoney(unplannedTotal - plannedMinor)} over`
                        : `${formatMoney(plannedMinor - unplannedTotal)} left`}
                    </Text>
                  </View>
                ) : null}
              </Row>

              {plannedMinor > 0 ? (
                <FundingBar
                  pct={(unplannedTotal / plannedMinor) * 100}
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
          <Pressable
            onPress={() => setAccountPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              fundingCard ? `Paid from ${fundingCard.name}. Change account` : 'Choose an account'
            }
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Row gap={space.sm}>
              {fundingCard && brand ? (
                <BankLogo brand={brand} size={26} />
              ) : (
                <Ionicons name="card-outline" size={22} color={colors.inkMuted} />
              )}
              <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                {fundingCard ? `Paid from ${fundingCard.name}` : 'Choose an account'}
              </Text>
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                Change
              </Text>
            </Row>
          </Pressable>
        </Surface>

        {/* Status toggle — for normal bills only. Unplanned lines are never
            "paid" as a whole; their spend is the running total of entries. */}
        {unplanned ? (
          <UnplannedTransactions
            transactions={transactions}
            total={unplannedTotal}
            plannedMinor={plannedMinor}
            onAdd={() => router.push(`/transaction/unplanned?subcategoryId=${subcategory.id}`)}
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
        ) : (
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
          <Field label="Name" value={name} onChangeText={setName} />

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

          {/* Both kinds carry a planned amount, but it means different things:
              a bill's is what will be paid, a spending budget's is the monthly
              cap its entries draw down. The label says which. */}
          <Field
            label={unplanned ? 'Monthly budget' : 'Planned amount'}
            value={planned}
            onChangeText={setPlanned}
            money
            placeholder="0"
          />
          {unplanned ? (
            <Text variant="caption" tone="muted" style={{ marginTop: -space.xs }}>
              What you intend to spend here each month. Entries below count
              against it.
            </Text>
          ) : null}

          {/* Actual/note only apply to normal per-period bills. */}
          {!unplanned ? (
            <Field
              label="Actual amount (optional)"
              value={actual}
              onChangeText={setActual}
              money
              placeholder="Leave empty if it matched the plan"
            />
          ) : null}

          {/* When it is due, in month context — the reminder rows open this
              screen, and "29 days overdue" says how urgent it is but never
              which day the money actually leaves. Hidden for unplanned lines
              and for bills with no fixed day, which have no date to show. */}
          {!unplanned && !isFlexibleDueDay(subcategory.dueDay ?? category?.dueDay ?? 1) ? (
            <DueDateCalendar
              dueDate={dueDateFor(state.period, subcategory.dueDay ?? category?.dueDay ?? 1)}
              tint={category?.color}
              overdue={status !== 'paid' && dueDateFor(state.period, subcategory.dueDay ?? category?.dueDay ?? 1) < new Date()}
            />
          ) : null}

          <FrequencyPicker label="Frequency" value={frequency} onChange={setFrequency} includeUnplanned />

          {/* A one-time cost counts in exactly one month — the month it was
              logged in — and in no other. Stated plainly so the bill silently
              leaving every other month is understood rather than surprising. */}
          {frequency === 'one_time' ? (
            <Text variant="caption" tone="muted">
              Counts only in {formatPeriod(oncePeriod)} — it won&apos;t affect any other month.
            </Text>
          ) : null}

          {/* "Save up for this" — yearly lines only. */}
          {supportsSavingPlan(frequency) ? (
            <SavingPlanFields draft={plan} onChange={setPlan} />
          ) : null}

          {!unplanned ? (
            <Field
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="What was this for?"
              multiline
            />
          ) : null}
        </View>

        {/* Slip / receipt — the shared uploader, so attaching a photo looks
            and behaves the same here as on the transaction sheet. Replacing
            must not delete the saved file: the row still points at it until
            this edit is saved, and backing out would break that record. */}
        {!unplanned ? (
          <ImageUploader
            label="Slip / receipt"
            value={imageUri}
            onChange={setImageUri}
            deleteOnReplace={false}
            size={140}
            onViewFullScreen={() => setImageViewerOpen(true)}
          />
        ) : null}

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

    {imageUri ? (
      <Modal
        visible={imageViewerOpen}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setImageViewerOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000000' }}>
          <Pressable
            onPress={() => setImageViewerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{
              position: 'absolute',
              top: insets.top + space.md,
              right: space.lg,
              zIndex: 1,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.15)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </Pressable>
          <Image source={{ uri: imageUri }} style={{ flex: 1 }} resizeMode="contain" />
        </View>
      </Modal>
    ) : null}

    {/* Edit one entry of a spending budget. Writes immediately (it is its own
        confirmed action with its own Save), unlike the fields on this screen. */}
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
 * The entry list for a spending-budget subcategory: spend against budget, an
 * "add" action, and every transaction this month. Replaces the paid toggle,
 * which is meaningless when spend is tracked entry by entry.
 *
 * Each row is tappable to edit and carries an explicit delete. Both are needed:
 * an amount typed wrong (or a mis-parsed SMS draft) previously had to be deleted
 * and re-entered, losing its date and note, and the running total is only
 * trustworthy if a wrong entry can be corrected in place.
 */
function UnplannedTransactions({
  transactions,
  total,
  plannedMinor,
  onAdd,
  onEdit,
  onRemove,
}: {
  transactions: Transaction[];
  total: number;
  /** The monthly budget, when set — drives the header's remaining figure. */
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
          <Label>THIS MONTH</Label>
          <Text variant="figureLarge" color={overBudget ? colors.danger : colors.accent}>
            {formatMoney(total)}
          </Text>
          {plannedMinor > 0 ? (
            <Text variant="caption" tone="muted">
              {transactions.length} {transactions.length === 1 ? 'entry' : 'entries'} ·{' '}
              {overBudget
                ? `${formatMoney(total - plannedMinor)} over budget`
                : `${formatMoney(plannedMinor - total)} left`}
            </Text>
          ) : (
            <Text variant="caption" tone="muted">
              {transactions.length} {transactions.length === 1 ? 'entry' : 'entries'}
            </Text>
          )}
        </View>
        <Button label="Add" icon="add" size="sm" onPress={onAdd} />
      </Row>

      {transactions.length === 0 ? (
        <Text variant="caption" tone="muted" style={{ padding: space.lg, paddingTop: 0 }}>
          No entries yet this month. Tap Add, or confirm an SMS draft against this line.
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
                <Text variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>
                  {txn.name}
                </Text>
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
  onSave: (patch: { name: string; amountMinor: number; date: Date; note: string | null }) => void;
  onDelete: () => void;
}) {
  const { colors, space } = useTheme();
  const [name, setName] = useState(txn.name);
  const [amount, setAmount] = useState(String(txn.amountMinor / 100));
  const [date, setDate] = useState(() => new Date(txn.date));
  const [note, setNote] = useState(txn.note ?? '');

  const amountMinor = parseAmount(amount) ?? 0;
  const canSave = name.trim().length > 0 && amountMinor > 0;

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title="Edit entry"
      eyebrow="Spending budget"
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

