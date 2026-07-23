import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import { Button, Divider, GradientButton, Label, PinnedFooter, Row, Surface, T } from '../../src/components/ui';
import { deletePersistedImage, persistPickedImage } from '../../src/core/imageStorage';
import { formatMoney, parseAmount } from '../../src/core/money';
import { resolveCardId, type SubcategoryStatus } from '../../src/core/planning';
import { resolveBrand } from '../../src/data/banks';
import { BankLogo } from '../../src/components/BankLogo';
import { useAppStore } from '../../src/store/useAppStore';
import { statusStyle } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Edit one subcategory: its plan, its actual cost, and its status this month. */
export default function SubcategoryScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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

  const [name, setName] = useState(subcategory?.name ?? '');
  const [planned, setPlanned] = useState(
    subcategory ? String(subcategory.plannedMinor / 100) : '',
  );
  const [actual, setActual] = useState(
    stateRow?.actualMinor != null ? String(stateRow.actualMinor / 100) : '',
  );
  const [note, setNote] = useState(stateRow?.note ?? '');
  const [frequency, setFrequency] = useState<'monthly' | 'one_time' | 'yearly'>(
    subcategory?.frequency ?? 'monthly',
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
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  // The repo already collapses legacy values, so this is pending/paid.
  const status: SubcategoryStatus = (stateRow?.status as SubcategoryStatus) ?? 'pending';

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

    state.updateSubcategory(subcategory!.id, {
      name: trimmed,
      plannedMinor: parseAmount(planned) ?? 0,
      frequency,
    });

    // Persist this month's slip, note and actual in one write, keeping the
    // current paid/pending status. Empty actual means "as planned".
    const parsedActual = actual.trim() === '' ? null : parseAmount(actual);
    state.logTransaction(subcategory!.id, {
      status,
      actualMinor: parsedActual,
      note: note.trim() || null,
      imageUri,
    });

    router.back();
  }

  function confirmDelete() {
    Alert.alert(`Delete ${subcategory!.name}?`, 'This removes it from the category.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteSubcategory(subcategory!.id);
          router.back();
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg }}>
        <SheetHeader title="Subcategory" onClose={() => router.back()} />
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

        {/* Status toggle — one big tap for the whole point of the screen:
            has this bill been paid. */}
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

        {/* Slip / receipt — attach or replace the photo for this month. */}
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

        {/* Editable plan. */}
        <View style={{ gap: space.md }}>
          <Label>DETAILS</Label>
          <Field label="Name" value={name} onChangeText={setName} />
          <Field
            label="Planned amount"
            value={planned}
            onChangeText={setPlanned}
            keyboardType="numeric"
            placeholder="0"
          />
          <Field
            label="Actual amount (optional)"
            value={actual}
            onChangeText={setActual}
            keyboardType="numeric"
            placeholder="Leave empty if it matched the plan"
          />
          <PillSelect
            label="Frequency"
            options={[
              { key: 'monthly', label: 'Monthly' },
              { key: 'yearly', label: 'Yearly' },
              { key: 'one_time', label: 'One-time' },
            ]}
            selectedKey={frequency}
            onSelect={(key) => setFrequency(key as typeof frequency)}
          />
          <Field
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="What was this for?"
            multiline
          />

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
        </View>
      </ScrollView>

      <PinnedFooter>
        <GradientButton
          label="Save changes"
          icon="checkmark"
          onPress={handleSave}
          disabled={!name.trim()}
        />
      </PinnedFooter>

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
    </KeyboardAvoidingView>
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
