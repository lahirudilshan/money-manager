import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, PillSelect } from '../../src/components/forms';
import { Button, Divider, Empty, GradientButton, Row, Surface, T } from '../../src/components/ui';
import { deletePersistedImage, persistPickedImage } from '../../src/core/imageStorage';
import { formatMoney, parseAmount } from '../../src/core/money';
import { STATUS_ORDER } from '../../src/core/planning';
import { selectCategoryViews, useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * The dock's centre "+" action: log a transaction against a subcategory.
 *
 * "Transaction" here means picking (or creating) a subcategory inside a
 * category and setting its amount/status/note/photo for the current month —
 * the model has no free-form ledger, so this screen is the on-ramp into that
 * same funding-board data rather than a separate parallel record.
 */
export default function NewTransactionScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();
  const categoryViews = useMemo(() => selectCategoryViews(state), [state]);

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [creatingNewSubcategory, setCreatingNewSubcategory] = useState(false);
  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [status, setStatus] = useState<'pending' | 'transferred' | 'completed'>('completed');

  const selectedCategory = categoryViews.find((c) => c.category.id === categoryId);
  const existingSubcategories = selectedCategory?.rawSubcategories ?? [];
  const selectedSubcategory = existingSubcategories.find((s) => s.id === subcategoryId);

  function handleSelectCategory(id: string) {
    setCategoryId(id);
    setSubcategoryId(null);
    setCreatingNewSubcategory(false);
    setNewSubcategoryName('');
    setAmount('');
  }

  function handleSelectSubcategory(id: string) {
    setSubcategoryId(id);
    setCreatingNewSubcategory(false);
    const subcategory = existingSubcategories.find((s) => s.id === id);
    // Prefill with the plan so logging an as-expected bill is one tap.
    setAmount(subcategory ? String(subcategory.plannedMinor / 100) : '');
  }

  function handleStartNewSubcategory() {
    setCreatingNewSubcategory(true);
    setSubcategoryId(null);
    setNewSubcategoryName('');
    setAmount('');
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
      const persisted = await persistPickedImage(result.assets[0].uri);
      setImageUri(persisted);
    } finally {
      setImageBusy(false);
    }
  }

  function removeImage() {
    if (imageUri) deletePersistedImage(imageUri);
    setImageUri(null);
  }

  function handleSave() {
    if (!categoryId) return;
    const parsedAmount = parseAmount(amount) ?? 0;

    let targetSubcategoryId: string | null = null;

    if (creatingNewSubcategory) {
      const trimmed = newSubcategoryName.trim();
      if (!trimmed) return;
      const created = state.addSubcategory({
        name: trimmed,
        categoryId,
        plannedMinor: parsedAmount,
      });
      targetSubcategoryId = created.id;
    } else if (subcategoryId) {
      targetSubcategoryId = subcategoryId;
    } else {
      return;
    }

    state.logTransaction(targetSubcategoryId, {
      status,
      actualMinor: parsedAmount > 0 ? parsedAmount : null,
      note: note.trim() || null,
      imageUri,
    });

    router.back();
  }

  const canSave =
    Boolean(categoryId) &&
    (creatingNewSubcategory ? newSubcategoryName.trim().length > 0 : Boolean(subcategoryId));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Row justify="space-between" align="center">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={26} color={colors.ink} />
        </Pressable>
        <T variant="title">Add transaction</T>
        <View style={{ width: 26 }} />
      </Row>

      {categoryViews.length === 0 ? (
        <Empty
          icon="albums-outline"
          title="No categories yet"
          message="Create a category on the board first, then log transactions against its subcategories."
          actionLabel="Create a category"
          onAction={() => router.push('/category/new')}
        />
      ) : (
        <>
          <PillSelect
            label="Category"
            options={categoryViews.map((c) => ({
              key: c.category.id,
              label: c.category.name,
              icon: c.category.icon as never,
            }))}
            selectedKey={categoryId}
            onSelect={handleSelectCategory}
          />

          {categoryId ? (
            <View style={{ gap: space.sm }}>
              <T variant="label" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                SUBCATEGORY
              </T>
              <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                {existingSubcategories.map((subcategory) => {
                  const selected = !creatingNewSubcategory && subcategoryId === subcategory.id;
                  return (
                    <Button
                      key={subcategory.id}
                      label={subcategory.name}
                      variant={selected ? 'primary' : 'secondary'}
                      size="sm"
                      onPress={() => handleSelectSubcategory(subcategory.id)}
                    />
                  );
                })}
                <Button
                  label="New subcategory"
                  icon="add"
                  variant={creatingNewSubcategory ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={handleStartNewSubcategory}
                />
              </View>
            </View>
          ) : null}

          {creatingNewSubcategory ? (
            <Field
              label="New subcategory name"
              value={newSubcategoryName}
              onChangeText={setNewSubcategoryName}
              placeholder="e.g. Groceries"
              autoFocus
            />
          ) : null}

          {categoryId && (selectedSubcategory || creatingNewSubcategory) ? (
            <>
              <Field
                label={creatingNewSubcategory ? 'Planned amount' : 'Amount'}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                keyboardType="numeric"
              />

              {selectedSubcategory ? (
                <Surface style={{ gap: space.xs }}>
                  <Row justify="space-between">
                    <T variant="small" tone="secondary">
                      Planned
                    </T>
                    <T variant="figure">{formatMoney(selectedSubcategory.plannedMinor)}</T>
                  </Row>
                </Surface>
              ) : null}

              <Field
                label="Note (optional)"
                value={note}
                onChangeText={setNote}
                placeholder="What was this for?"
                multiline
              />

              <View style={{ gap: space.sm }}>
                <T variant="label" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  PHOTO
                </T>
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
                    <Button
                      label="Take photo"
                      icon="camera-outline"
                      variant="secondary"
                      size="sm"
                      onPress={() => pickImage('camera')}
                      loading={imageBusy}
                    />
                    <Button
                      label="Choose from library"
                      icon="image-outline"
                      variant="secondary"
                      size="sm"
                      onPress={() => pickImage('library')}
                      loading={imageBusy}
                    />
                  </Row>
                )}
              </View>

              <PillSelect
                label="Status"
                options={STATUS_ORDER.map((key) => ({
                  key,
                  label: key === 'transferred' ? 'Transferred' : key === 'completed' ? 'Done' : 'Pending',
                }))}
                selectedKey={status}
                onSelect={(key) => setStatus(key as typeof status)}
              />
              <Divider />
            </>
          ) : null}

          <GradientButton label="Save transaction" onPress={handleSave} disabled={!canSave} />
        </>
      )}
    </ScrollView>
  );
}
