import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { AccountField } from '../../src/components/AccountPicker';
import { DatePickerField } from '../../src/components/DatePickerField';
import { AmountField } from '../../src/components/forms';
import { BottomSheet, GradientButton, Label, Row, Surface, T } from '../../src/components/ui';
import { useModalClose } from '../../src/hooks/useModalClose';
import { deletePersistedImage, persistPickedImage } from '../../src/core/imageStorage';
import { formatMoney, parseAmount } from '../../src/core/money';
import { resolveCardId, STATUS_ORDER, type SubcategoryStatus } from '../../src/core/planning';
import { isUnplanned } from '../../src/db/schema';
import { resolveBrand } from '../../src/data/banks';
import { selectCategoryViews, useAppStore } from '../../src/store/useAppStore';
import { statusStyle } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

const STATUS_LABEL: Record<SubcategoryStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
};

/**
 * Log a transaction against a budget line — the dock's centre "+" action.
 *
 * The screen asks three things in the order you actually know them: how much,
 * what it was for, and the details.
 *
 * "What it was for" used to be two separate chip rows — pick a category, then
 * pick a line inside it — which made the user navigate the app's data model
 * instead of just naming the thing they bought. They are now one searchable
 * destination list: every line in the plan, labelled with its category,
 * filtered by typing. Choosing "Groceries" in one tap is the whole interaction,
 * and the category comes along implicitly because a line already knows its
 * parent.
 *
 * Everything below the destination is secondary — account, status, note, photo
 * — so it sits under a collapsed "More details" until asked for, keeping the
 * common case (amount + line + save) to a single screen with no scrolling.
 */
export default function NewTransactionScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const state = useAppStore();
  const views = useMemo(() => selectCategoryViews(state), [state]);

  const [amount, setAmount] = useState('');
  // Defaults to today; the chosen date decides which month this counts toward.
  const [date, setDate] = useState(() => new Date());
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  /** Which category a newly-created line goes into. Only used by "New line". */
  const [newLineCategoryId, setNewLineCategoryId] = useState<string | null>(
    views[0]?.category.id ?? null,
  );
  const [cardId, setCardId] = useState<string | null>(null);
  const [status, setStatus] = useState<SubcategoryStatus>('paid');
  const [note, setNote] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const creatingNew = subcategoryId === '__new__';

  /**
   * Every budget line in the plan, flattened with its category, so one list can
   * stand in for the old category→line drill-down.
   */
  const destinations = useMemo(
    () =>
      views.flatMap((view) =>
        view.rawSubcategories.map((line) => ({
          line,
          category: view.category,
        })),
      ),
    [views],
  );

  const selected = destinations.find((d) => d.line.id === subcategoryId) ?? null;

  /**
   * The category a save targets: the chosen line's own, or the explicit pick
   * when creating a new line.
   *
   * The "new line" pick is validated against the current categories rather than
   * trusted, and falls back to the first one — the stored id can go stale if the
   * category is archived while this sheet is open, and a dangling id would
   * otherwise pass `canSave` and fail at the insert.
   */
  const newLineCategory =
    views.find((view) => view.category.id === newLineCategoryId)?.category ??
    views[0]?.category ??
    null;
  const categoryId = creatingNew ? (newLineCategory?.id ?? null) : (selected?.category.id ?? null);

  // The account defaults to whatever the chosen line (or its category) funds
  // from, so the common case needs no tap; the picker only overrides it.
  const effectiveCardId =
    cardId ?? resolveCardId(selected?.line.cardId, selected?.category.cardId);

  const query = search.trim().toLowerCase();
  const filteredDestinations = useMemo(() => {
    if (!query) return destinations;
    return destinations.filter(
      (d) =>
        d.line.name.toLowerCase().includes(query) ||
        d.category.name.toLowerCase().includes(query),
    );
  }, [destinations, query]);

  function selectLine(id: string) {
    setSubcategoryId(id);
    setCardId(null);
    if (id !== '__new__') {
      const line = destinations.find((d) => d.line.id === id)?.line;
      // Prefill the plan so logging an as-expected bill is one tap.
      if (line && !amount) setAmount(String(line.plannedMinor / 100));
    }
  }

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
    if (imageUri) deletePersistedImage(imageUri);
    setImageUri(null);
  }

  const canSave =
    Boolean(categoryId) &&
    (creatingNew ? newName.trim().length > 0 : Boolean(subcategoryId));

  function handleSave() {
    if (!categoryId || !canSave) return;
    const parsed = parseAmount(amount) ?? 0;

    let targetId: string;
    if (creatingNew) {
      const created = state.addSubcategory({
        name: newName.trim(),
        categoryId,
        plannedMinor: parsed,
        cardId,
      });
      targetId = created.id;
    } else if (subcategoryId) {
      targetId = subcategoryId;
      if (cardId) state.updateSubcategory(targetId, { cardId });
    } else {
      return;
    }

    // An unplanned line holds many individual dated entries rather than one
    // status per month, so it takes a transaction row; everything else records
    // the month's status. Both carry the chosen date, which decides the period.
    const target = state.subcategories.find((s) => s.id === targetId);
    if (target && isUnplanned(target.frequency)) {
      state.addTransaction({
        subcategoryId: targetId,
        name: (selected?.line.name ?? newName.trim()) || 'Transaction',
        amountMinor: parsed,
        date,
        note: note.trim() || null,
        imageUri,
      });
    } else {
      state.logTransaction(targetId, {
        status,
        actualMinor: parsed > 0 ? parsed : null,
        note: note.trim() || null,
        imageUri,
        date,
      });
    }

    closeModal();
  }

  if (views.length === 0) {
    return (
      <BottomSheet
        visible
      asRoute
        onClose={closeModal}
        title="Add transaction"
        icon="swap-horizontal-outline"
        iconColor={colors.accent}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.lg }}>
          <Ionicons name="albums-outline" size={48} color={colors.inkMuted} />
          <T variant="heading">No categories yet</T>
          <T variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 260 }}>
            Create a category first, then log transactions against its lines.
          </T>
          <GradientButton
            label="Create a category"
            icon="add"
            onPress={() => router.replace('/category/new')}
          />
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="Add transaction"
      icon="swap-horizontal-outline"
      iconColor={colors.accent}
      scroll
      footer={
        <GradientButton
          label="Save transaction"
          icon="checkmark"
          onPress={handleSave}
          disabled={!canSave}
        />
      }
    >
        {/* 1 · Amount — the number in hand, front and centre. */}
      <View style={{ paddingVertical: space.sm }}>
        <AmountField label="Amount" value={amount} onChangeText={setAmount} currency={state.currency} />
      </View>

      {/* When it happened. Sits with the amount rather than under "More
          details" because it decides which month the entry counts toward —
          it is part of the record, not an optional extra. */}
      <DatePickerField label="Date" value={date} onChange={setDate} />

      {/* 2 · What it was for — one searchable list of every budget line,
          replacing the old category-then-line drill-down. */}
      <LabeledField label="WHAT WAS IT FOR?">
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
          <Ionicons name="search" size={15} color={colors.inkMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search your plan…"
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel="Search budget lines"
            style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.ink }}
          />
        </View>

        <View style={{ gap: 6 }}>
          {filteredDestinations.map(({ line, category }) => (
            <DestinationRow
              key={line.id}
              name={line.name}
              categoryName={category.name}
              color={category.color}
              icon={(line.icon ?? 'pricetag-outline') as keyof typeof Ionicons.glyphMap}
              plannedMinor={line.plannedMinor}
              selected={line.id === subcategoryId}
              onPress={() => selectLine(line.id)}
            />
          ))}

          {filteredDestinations.length === 0 ? (
            <T variant="small" tone="muted">
              Nothing matches “{search.trim()}”. Add it as a new line below.
            </T>
          ) : null}

          {/* Always last, so creating a line is available without clearing the
              search — and its name is prefilled from whatever was typed. */}
          <DestinationRow
            name="New line"
            categoryName="Create a budget line for this"
            color={colors.accent}
            icon="add"
            selected={creatingNew}
            onPress={() => {
              setSubcategoryId('__new__');
              setCardId(null);
              if (!newName && search.trim()) setNewName(search.trim());
            }}
          />
        </View>
      </LabeledField>

      {/* Creating a line needs its name and a home category — the only case
          where the category is still asked for explicitly. */}
      {creatingNew ? (
        <>
          <LabeledField label="NEW LINE NAME">
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Groceries"
              placeholderTextColor={colors.inkMuted}
              autoFocus
              style={inputStyle(colors, space)}
            />
          </LabeledField>

          <LabeledField label="ADD IT TO">
            <Chips
              options={views.map((view) => ({
                key: view.category.id,
                label: view.category.name,
                icon: view.category.icon as keyof typeof Ionicons.glyphMap,
                color: view.category.color,
              }))}
              selectedKey={newLineCategory?.id ?? null}
              onSelect={setNewLineCategoryId}
            />
          </LabeledField>
        </>
      ) : null}

      {/* Planned-amount reminder, right under the choice it refers to. */}
      {selected ? (
        <Surface style={{ gap: space.xs }}>
          <Row justify="space-between">
            <T variant="small" tone="secondary">
              Planned for this line
            </T>
            <T variant="figure">{formatMoney(selected.line.plannedMinor)}</T>
          </Row>
        </Surface>
      ) : null}

      {/* 3 · Everything optional, folded away so the common path is short. */}
      <Pressable
        onPress={() => setShowDetails((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showDetails }}
        accessibilityLabel="More details"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: space.sm,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons
          name={showDetails ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={colors.accent}
        />
        <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
          {showDetails ? 'Hide details' : 'More details'}
        </T>
        <T variant="caption" tone="muted">
          account · status · note · photo
        </T>
      </Pressable>

      {showDetails ? (
        <>
          {/* Account it moved through — the shared picker, so "paid from" looks
              identical to "funded account" everywhere. */}
          <AccountField
            label="Paid from"
            cards={state.cards}
            selectedId={effectiveCardId}
            onSelect={setCardId}
          />

          <LabeledField label="STATUS">
            <Row gap={space.sm}>
              {STATUS_ORDER.map((key) => {
                const isSelected = status === key;
                const style = statusStyle(key, colors);
                return (
                  <Pressable
                    key={key}
                    onPress={() => setStatus(key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={({ pressed }) => ({
                      flex: 1,
                      alignItems: 'center',
                      gap: 3,
                      paddingVertical: space.md,
                      borderRadius: 14,
                      borderWidth: 1.5,
                      borderColor: isSelected ? style.fg : colors.hairline,
                      backgroundColor: isSelected ? style.bg : colors.surface,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Ionicons
                      name={style.icon as never}
                      size={20}
                      color={isSelected ? style.fg : colors.inkMuted}
                    />
                    <T
                      variant="caption"
                      color={isSelected ? style.fg : colors.inkSecondary}
                      style={{ fontWeight: isSelected ? '700' : '500' }}
                    >
                      {STATUS_LABEL[key]}
                    </T>
                  </Pressable>
                );
              })}
            </Row>
          </LabeledField>

          <LabeledField label="NOTE (OPTIONAL)">
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="What was this for?"
              placeholderTextColor={colors.inkMuted}
              multiline
              style={[inputStyle(colors, space), { minHeight: 56, textAlignVertical: 'top' }]}
            />
          </LabeledField>

          <LabeledField label="PHOTO (OPTIONAL)">
            {imageUri ? (
              <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
                <Image
                  source={{ uri: imageUri }}
                  style={{ width: 96, height: 96, borderRadius: 12 }}
                />
                <Pressable
                  onPress={removeImage}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  style={{
                    position: 'absolute',
                    top: -8,
                    right: -8,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: colors.danger,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="close" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ) : (
              <Row gap={space.sm}>
                <PhotoButton
                  label="Camera"
                  icon="camera-outline"
                  busy={imageBusy}
                  onPress={() => pickImage('camera')}
                />
                <PhotoButton
                  label="Library"
                  icon="image-outline"
                  busy={imageBusy}
                  onPress={() => pickImage('library')}
                />
              </Row>
            )}
          </LabeledField>
        </>
      ) : null}
    </BottomSheet>
  );
}

/**
 * One budget line in the destination list: what it is, which category it lives
 * in, and what it was planned at. Showing the category on the row is what lets
 * the separate category step disappear — the answer is visible rather than
 * navigated to.
 */
function DestinationRow({
  name,
  categoryName,
  color,
  icon,
  plannedMinor,
  selected,
  onPress,
}: {
  name: string;
  categoryName: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  plannedMinor?: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${name}, ${categoryName}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: 10,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: selected ? color : colors.hairline,
        backgroundColor: selected ? `${color}14` : colors.surface,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? `${color}22` : colors.surfaceSunken,
        }}
      >
        <Ionicons name={icon} size={17} color={selected ? color : colors.inkMuted} />
      </View>

      <View style={{ flex: 1 }}>
        <T variant="small" style={{ fontWeight: selected ? '700' : '600' }} numberOfLines={1}>
          {name}
        </T>
        <T variant="caption" tone="muted" numberOfLines={1}>
          {categoryName}
        </T>
      </View>

      {plannedMinor !== undefined && plannedMinor > 0 ? (
        <T variant="caption" tone="muted">
          {formatMoney(plannedMinor)}
        </T>
      ) : null}

      {selected ? <Ionicons name="checkmark-circle" size={19} color={color} /> : null}
    </Pressable>
  );
}

/** A labelled block — the shared skeleton for every field on the screen. */
function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      {children}
    </View>
  );
}

/** Horizontally scrolling chip row for category/line selection. */
function Chips({
  options,
  selectedKey,
  onSelect,
}: {
  options: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; color?: string }[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
      keyboardShouldPersistTaps="handled"
    >
      {options.map((option) => {
        const selected = selectedKey === option.key;
        const tint = option.color ?? colors.accent;
        return (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 9,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: selected ? tint : colors.hairline,
              backgroundColor: selected ? `${tint}14` : colors.surface,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Ionicons name={option.icon} size={16} color={selected ? tint : colors.inkMuted} />
            <T
              variant="small"
              color={selected ? colors.ink : colors.inkSecondary}
              style={{ fontWeight: selected ? '700' : '500' }}
            >
              {option.label}
            </T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function PhotoButton({
  label,
  icon,
  busy,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
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
        gap: 6,
        paddingVertical: 12,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        backgroundColor: colors.surface,
        opacity: pressed || busy ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={17} color={colors.inkSecondary} />
      <T variant="small" tone="secondary" style={{ fontWeight: '600' }}>
        {label}
      </T>
    </Pressable>
  );
}

function inputStyle(colors: ReturnType<typeof useTheme>['colors'], space: ReturnType<typeof useTheme>['space']) {
  return {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: 12,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  } as const;
}
