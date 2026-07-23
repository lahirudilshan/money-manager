import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankLogo } from '../../src/components/BankLogo';
import { SheetHeader } from '../../src/components/forms';
import { GradientButton, Label, PinnedFooter, Row, Surface, T } from '../../src/components/ui';
import { deletePersistedImage, persistPickedImage } from '../../src/core/imageStorage';
import { formatMoney, parseAmount } from '../../src/core/money';
import { resolveCardId, STATUS_ORDER, type SubcategoryStatus } from '../../src/core/planning';
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
 * Everything is on one screen in the order you actually fill it: amount first
 * (the number in your hand), then where it belongs (category → line), then
 * which account it moved through, its state, and finally the optional note and
 * photo. No progressive reveal — seeing every field at once is faster than
 * discovering them one tap at a time, which is what the user asked for.
 */
export default function NewTransactionScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();
  const views = useMemo(() => selectCategoryViews(state), [state]);

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(views[0]?.category.id ?? null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [cardId, setCardId] = useState<string | null>(null);
  const [status, setStatus] = useState<SubcategoryStatus>('paid');
  const [note, setNote] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);

  const selectedCategory = views.find((view) => view.category.id === categoryId);
  const lines = selectedCategory?.rawSubcategories ?? [];
  const creatingNew = subcategoryId === '__new__';

  // The account defaults to whatever the chosen line (or its category) funds
  // from, so the common case needs no tap; the picker only overrides it.
  const effectiveCardId =
    cardId ??
    (() => {
      const line = lines.find((l) => l.id === subcategoryId);
      return resolveCardId(line?.cardId, selectedCategory?.category.cardId);
    })();

  function selectCategory(id: string) {
    setCategoryId(id);
    setSubcategoryId(null);
    setCardId(null);
  }

  function selectLine(id: string) {
    setSubcategoryId(id);
    setCardId(null);
    if (id !== '__new__') {
      const line = lines.find((l) => l.id === id);
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

    state.logTransaction(targetId, {
      status,
      actualMinor: parsed > 0 ? parsed : null,
      note: note.trim() || null,
      imageUri,
    });

    router.back();
  }

  if (views.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          paddingTop: insets.top + space.sm,
          paddingHorizontal: space.lg,
        }}
      >
        <SheetHeader title="Add transaction" onClose={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
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
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg }}>
        <SheetHeader title="Add transaction" onClose={() => router.back()} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: space.md,
          paddingBottom: space.xl,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 1 · Amount — the number in hand, front and centre. */}
      <View style={{ alignItems: 'center', gap: 2, paddingVertical: space.sm }}>
        <Label>AMOUNT</Label>
        <Row gap={space.xs} align="center">
          <T variant="title" tone="muted">
            {state.currency}
          </T>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.inkMuted}
            style={{
              fontSize: 44,
              fontWeight: '800',
              letterSpacing: -1.4,
              color: colors.ink,
              minWidth: 120,
              textAlign: 'center',
              padding: 0,
            }}
          />
        </Row>
      </View>

      {/* 2 · Category. */}
      <Field label="CATEGORY">
        <Chips
          options={views.map((view) => ({
            key: view.category.id,
            label: view.category.name,
            icon: view.category.icon as keyof typeof Ionicons.glyphMap,
            color: view.category.color,
          }))}
          selectedKey={categoryId}
          onSelect={selectCategory}
        />
      </Field>

      {/* 3 · Line within the category (or a new one). */}
      {categoryId ? (
        <Field label="LINE">
          <Chips
            options={[
              ...lines.map((line) => ({
                key: line.id,
                label: line.name,
                icon: (line.icon ?? 'pricetag-outline') as keyof typeof Ionicons.glyphMap,
              })),
              { key: '__new__', label: 'New line', icon: 'add' as const },
            ]}
            selectedKey={subcategoryId}
            onSelect={selectLine}
          />
        </Field>
      ) : null}

      {creatingNew ? (
        <Field label="NEW LINE NAME">
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="e.g. Groceries"
            placeholderTextColor={colors.inkMuted}
            autoFocus
            style={inputStyle(colors, space)}
          />
        </Field>
      ) : null}

      {/* 4 · Account it moved through. */}
      <Field label="PAID FROM">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {state.cards.map((card) => {
            const brand = resolveBrand({
              bankId: card.bankId,
              bankName: card.bankName,
              name: card.name,
            });
            const selected = effectiveCardId === card.id;
            return (
              <Pressable
                key={card.id}
                onPress={() => setCardId(card.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  paddingVertical: 7,
                  paddingHorizontal: space.md,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: selected ? brand.color : colors.hairline,
                  backgroundColor: selected ? `${brand.color}14` : colors.surface,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <BankLogo brand={brand} size={20} />
                <T variant="small" style={{ fontWeight: selected ? '700' : '500' }}>
                  {card.name}
                </T>
              </Pressable>
            );
          })}
        </View>
      </Field>

      {/* 5 · Status. */}
      <Field label="STATUS">
        <Row gap={space.sm}>
          {STATUS_ORDER.map((key) => {
            const selected = status === key;
            const style = statusStyle(key, colors);
            return (
              <Pressable
                key={key}
                onPress={() => setStatus(key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: 'center',
                  gap: 3,
                  paddingVertical: space.md,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: selected ? style.fg : colors.hairline,
                  backgroundColor: selected ? style.bg : colors.surface,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Ionicons
                  name={style.icon as never}
                  size={20}
                  color={selected ? style.fg : colors.inkMuted}
                />
                <T
                  variant="caption"
                  color={selected ? style.fg : colors.inkSecondary}
                  style={{ fontWeight: selected ? '700' : '500' }}
                >
                  {STATUS_LABEL[key]}
                </T>
              </Pressable>
            );
          })}
        </Row>
      </Field>

      {/* 6 · Note. */}
      <Field label="NOTE (OPTIONAL)">
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What was this for?"
          placeholderTextColor={colors.inkMuted}
          multiline
          style={[inputStyle(colors, space), { minHeight: 56, textAlignVertical: 'top' }]}
        />
      </Field>

      {/* 7 · Photo. */}
      <Field label="PHOTO (OPTIONAL)">
        {imageUri ? (
          <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
            <Image source={{ uri: imageUri }} style={{ width: 96, height: 96, borderRadius: 12 }} />
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
            <PhotoButton label="Camera" icon="camera-outline" busy={imageBusy} onPress={() => pickImage('camera')} />
            <PhotoButton label="Library" icon="image-outline" busy={imageBusy} onPress={() => pickImage('library')} />
          </Row>
        )}
      </Field>

        {/* Planned-amount reminder for the chosen line. */}
        {subcategoryId && subcategoryId !== '__new__' ? (
          <Surface style={{ gap: space.xs }}>
            {(() => {
              const line = lines.find((l) => l.id === subcategoryId);
              if (!line) return null;
              return (
                <Row justify="space-between">
                  <T variant="small" tone="secondary">
                    Planned for this line
                  </T>
                  <T variant="figure">{formatMoney(line.plannedMinor)}</T>
                </Row>
              );
            })()}
          </Surface>
        ) : null}
      </ScrollView>

      <PinnedFooter>
        <GradientButton
          label="Save transaction"
          icon="checkmark"
          onPress={handleSave}
          disabled={!canSave}
        />
      </PinnedFooter>
    </KeyboardAvoidingView>
  );
}

/** A labelled block — the shared skeleton for every field on the screen. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
