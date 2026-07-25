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
import { Field, FrequencyPicker } from '../../src/components/forms';
import { BottomSheet, Button, Divider, GradientButton, Label, Row, Surface, T } from '../../src/components/ui';
import { useModalClose } from '../../src/hooks/useModalClose';
import { deletePersistedImage, persistPickedImage } from '../../src/core/imageStorage';
import { formatMoney, parseAmount } from '../../src/core/money';
import { resolveCardId, type SubcategoryStatus } from '../../src/core/planning';
import {
  supportsSavingPlan,
  isUnplanned,
  type SubcategoryFrequency,
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
  const fundingCard = useMemo(() => {
    const cardId = resolveCardId(subcategory?.cardId, category?.cardId);
    return state.cards.find((c) => c.id === cardId);
  }, [state.cards, subcategory?.cardId, category?.cardId]);

  // Progress comes from the shared selector so the figure matches everywhere.
  const savedMinor = useMemo(() => {
    if (!id) return 0;
    return (
      selectSavingPlans(state).find((p) => p.subcategory.id === id)?.progress.savedMinor ?? 0
    );
  }, [state, id]);

  const [name, setName] = useState(subcategory?.name ?? '');
  const [planned, setPlanned] = useState(
    subcategory ? String(subcategory.plannedMinor / 100) : '',
  );
  const [actual, setActual] = useState(
    stateRow?.actualMinor != null ? String(stateRow.actualMinor / 100) : '',
  );
  const [note, setNote] = useState(stateRow?.note ?? '');
  const [frequency, setFrequency] = useState<SubcategoryFrequency>(
    subcategory?.frequency ?? 'monthly',
  );
  const [parentId, setParentId] = useState(subcategory?.categoryId ?? '');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [plan, setPlan] = useState<SavingPlanDraft>(() =>
    savingPlanDraftFrom({
      planTargetMinor: subcategory?.planTargetMinor,
      planDueDate: subcategory?.planDueDate,
    }),
  );
  const [imageUri, setImageUri] = useState<string | null>(stateRow?.imageUri ?? null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);

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
        <T variant="heading">Not found</T>
        <Button label="Go back" onPress={() => closeModal()} variant="ghost" />
      </View>
    );
  }

  // The repo already collapses legacy values, so this is pending/paid.
  const status: SubcategoryStatus = (stateRow?.status as SubcategoryStatus) ?? 'pending';

  // Unplanned lines behave differently: they hold a list of individual
  // transactions, have no single planned/actual amount, and are never marked
  // paid as a whole — so several fields below are hidden for them.
  const unplanned = isUnplanned(frequency);
  const transactions = useMemo(
    () => (id && unplanned ? selectTransactions(state, id) : []),
    [state, id, unplanned],
  );
  const unplannedTotal = transactions.reduce((sum, t) => sum + t.amountMinor, 0);

  async function pickImage(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (result.canceled || !result.assets[0]) return;

    setImageBusy(true);
    try {
      setImageUri(await persistPickedImage(result.assets[0].uri));
    } finally {
      setImageBusy(false);
    }
  }

  function removeImage() {
    // Only delete the file if it's a newly-picked one; the saved slip is
    // cleared from the row on save, and deleting it here would break the
    // stored record if the user then backs out without saving.
    if (imageUri && imageUri !== stateRow?.imageUri) deletePersistedImage(imageUri);
    setImageUri(null);
  }

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
      // Unplanned lines have no single planned amount (it's the sum of entries).
      plannedMinor: unplanned ? 0 : planPatch ? planPatch.monthlyMinor : (parseAmount(planned) ?? 0),
      frequency,
      planTargetMinor: planPatch?.planTargetMinor ?? null,
      planDueDate: planPatch?.planDueDate ?? null,
      planStartDate: planPatch?.planStartDate ?? subcategory!.planStartDate ?? null,
    });

    // Move to a different parent category if the user changed it.
    if (parentId && parentId !== subcategory!.categoryId) {
      state.changeSubcategoryParent(subcategory!.id, parentId);
    }

    // Per-month slip/note/actual only apply to normal (non-unplanned) lines,
    // whose spend is tracked as one figure per period. Unplanned lines track
    // each entry separately, so there is nothing to log here for them.
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
    frequency !== subcategory.frequency ||
    planChanged;

  return (
    <BottomSheet
      visible
      onClose={closeModal}
      title={subcategory.name}
      eyebrow={category?.name}
      icon={(subcategory.icon ?? 'pricetag-outline') as keyof typeof Ionicons.glyphMap}
      iconColor={category?.color ?? colors.accent}
      heightPct={0.92}
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
              <T variant="heading" numberOfLines={1}>
                {subcategory.name}
              </T>
              <T variant="caption" tone="muted" numberOfLines={1}>
                {category?.name ?? 'Category'}
                {subcategory.frequency !== 'monthly'
                  ? ` · ${subcategory.frequency.replace('_', '-')}`
                  : ''}
              </T>
            </View>
          </Row>

          <Divider />

          {unplanned ? (
            <Row justify="space-between">
              <T variant="small" tone="secondary">
                Spent this month
              </T>
              <T variant="figureLarge" color={colors.accent}>
                {formatMoney(unplannedTotal)}
              </T>
            </Row>
          ) : (
            <>
              <Row justify="space-between">
                <T variant="small" tone="secondary">
                  Planned
                </T>
                <T variant="figureLarge">{formatMoney(subcategory.plannedMinor)}</T>
              </Row>
              {stateRow?.actualMinor != null ? (
                <Row justify="space-between">
                  <T variant="small" tone="secondary">
                    Actual
                  </T>
                  <T variant="figure" color={colors.accent}>
                    {formatMoney(stateRow.actualMinor)}
                  </T>
                </Row>
              ) : null}
            </>
          )}

          {fundingCard && brand ? (
            <>
              <Divider />
              <Row gap={space.sm}>
                <BankLogo brand={brand} size={26} />
                <T variant="small" tone="secondary" style={{ flex: 1 }}>
                  Paid from {fundingCard.name}
                </T>
              </Row>
            </>
          ) : null}
        </Surface>

        {/* Status toggle — for normal bills only. Unplanned lines are never
            "paid" as a whole; their spend is the running total of entries. */}
        {unplanned ? (
          <UnplannedTransactions
            transactions={transactions}
            total={unplannedTotal}
            onAdd={() => router.push(`/transaction/unplanned?subcategoryId=${subcategory.id}`)}
            onRemove={(txnId) => state.deleteTransaction(txnId)}
          />
        ) : (
          <Pressable
            onPress={() => state.cycleStatus(subcategory.id)}
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
              <T variant="bodyStrong" color={style.fg}>
                {paid ? 'Paid this month' : 'Not paid yet'}
              </T>
              <T variant="caption" color={style.fg} style={{ opacity: 0.85 }}>
                Tap to mark as {paid ? 'pending' : 'paid'}
              </T>
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
                    <T variant="body" style={{ flex: 1 }}>
                      {parent?.name ?? 'Choose a category'}
                    </T>
                    <Ionicons name="chevron-down" size={16} color={colors.inkMuted} />
                  </>
                );
              })()}
            </Pressable>
          </View>

          {/* An unplanned line has no single planned amount — hide it. */}
          {!unplanned ? (
            <Field
              label="Planned amount"
              value={planned}
              onChangeText={setPlanned}
              keyboardType="numeric"
              placeholder="0"
            />
          ) : null}

          {/* Actual/note only apply to normal per-period bills. */}
          {!unplanned ? (
            <Field
              label="Actual amount (optional)"
              value={actual}
              onChangeText={setActual}
              keyboardType="numeric"
              placeholder="Leave empty if it matched the plan"
            />
          ) : null}

          <FrequencyPicker label="Frequency" value={frequency} onChange={setFrequency} includeUnplanned />

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

        {/* Slip / receipt — at the bottom, for normal bills only. */}
        {!unplanned ? (
          <View style={{ gap: space.sm }}>
            <Label>SLIP / RECEIPT</Label>
            {imageUri ? (
              <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
                <Pressable
                  onPress={() => setImageViewerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="View slip"
                >
                  <Image
                    source={{ uri: imageUri }}
                    style={{ width: 140, height: 140, borderRadius: 14 }}
                  />
                </Pressable>
                <Pressable
                  onPress={removeImage}
                  accessibilityRole="button"
                  accessibilityLabel="Remove slip"
                  style={{
                    position: 'absolute',
                    top: -8,
                    right: -8,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: colors.danger,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="close" size={16} color="#FFFFFF" />
                </Pressable>
              </View>
            ) : (
              <Row gap={space.sm}>
                <UploadButton
                  icon="camera-outline"
                  label="Camera"
                  busy={imageBusy}
                  onPress={() => pickImage('camera')}
                />
                <UploadButton
                  icon="image-outline"
                  label="Upload"
                  busy={imageBusy}
                  onPress={() => pickImage('library')}
                />
              </Row>
            )}
          </View>
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
          <T variant="small" color={colors.danger} style={{ fontWeight: '600' }}>
            Delete subcategory
          </T>
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
            placeholderTextColor={colors.inkFaint}
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
                <T variant="body" color={selected ? colors.accent : colors.ink} style={{ flex: 1, fontWeight: selected ? '700' : '500' }}>
                  {c.name}
                </T>
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
 * The entry list for an unplanned subcategory: a running total, an "add" action,
 * and each transaction (name, date, amount) with swipe-free delete. Replaces the
 * paid toggle, which is meaningless when spend is tracked entry by entry.
 */
function UnplannedTransactions({
  transactions,
  total,
  onAdd,
  onRemove,
}: {
  transactions: import('../../src/db/schema').Transaction[];
  total: number;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      <Row justify="space-between" align="center" style={{ padding: space.lg, paddingBottom: space.sm }}>
        <View>
          <Label>THIS MONTH</Label>
          <T variant="figureLarge" color={colors.accent}>
            {formatMoney(total)}
          </T>
        </View>
        <Button label="Add" icon="add" size="sm" onPress={onAdd} />
      </Row>

      {transactions.length === 0 ? (
        <T variant="caption" tone="muted" style={{ padding: space.lg, paddingTop: 0 }}>
          No entries yet this month. Tap Add, or confirm an SMS draft against this line.
        </T>
      ) : (
        transactions.map((txn, index) => (
          <View key={txn.id}>
            {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
            <Row gap={space.md} style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
              <View style={{ flex: 1 }}>
                <T variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>
                  {txn.name}
                </T>
                <T variant="caption" tone="muted">
                  {new Date(txn.date).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </T>
              </View>
              <T variant="figure">{formatMoney(txn.amountMinor)}</T>
              <Pressable
                onPress={() => onRemove(txn.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${txn.name}`}
              >
                <Ionicons name="close-circle" size={20} color={colors.inkMuted} />
              </Pressable>
            </Row>
          </View>
        ))
      )}
    </Surface>
  );
}

/** A dashed upload affordance for attaching a slip photo. */
function UploadButton({
  icon,
  label,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingVertical: 18,
        borderRadius: radius.lg,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: colors.hairlineStrong,
        backgroundColor: colors.surface,
        opacity: pressed || busy ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={19} color={colors.accent} />
      <T variant="small" tone="secondary" style={{ fontWeight: '600' }}>
        {label}
      </T>
    </Pressable>
  );
}
