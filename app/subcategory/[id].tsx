import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import { Button, Divider, Row, StatusPill, Surface, T } from '../../src/components/ui';
import { formatMoney, parseAmount } from '../../src/core/money';
import { STATUS_ORDER } from '../../src/core/planning';
import { useAppStore } from '../../src/store/useAppStore';
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

  const [name, setName] = useState(subcategory?.name ?? '');
  const [planned, setPlanned] = useState(
    subcategory ? String(subcategory.plannedMinor / 100) : '',
  );
  const [actual, setActual] = useState(
    stateRow?.actualMinor != null ? String(stateRow.actualMinor / 100) : '',
  );
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

  const status = stateRow?.status ?? 'pending';

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    state.updateSubcategory(subcategory!.id, {
      name: trimmed,
      plannedMinor: parseAmount(planned) ?? 0,
    });

    // Empty actual means "as planned" rather than zero.
    const parsedActual = actual.trim() === '' ? null : parseAmount(actual);
    state.setActual(subcategory!.id, parsedActual);

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

  return (
    <>
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingBottom: space.xxxl,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <SheetHeader title="Subcategory" onClose={() => router.back()} />

      <Surface style={{ gap: space.md }}>
        <Row justify="space-between">
          <T variant="heading">{subcategory.name}</T>
          <StatusPill status={status} />
        </Row>
        <Divider />
        <Row justify="space-between">
          <T variant="small" tone="secondary">
            Planned
          </T>
          <T variant="figure">{formatMoney(subcategory.plannedMinor)}</T>
        </Row>
        {stateRow?.actualMinor != null ? (
          <Row justify="space-between">
            <T variant="small" tone="secondary">
              Actual
            </T>
            <T variant="figure">{formatMoney(stateRow.actualMinor)}</T>
          </Row>
        ) : null}
        {stateRow?.note ? (
          <>
            <Divider />
            <View style={{ gap: 2 }}>
              <T variant="small" tone="secondary">
                Note
              </T>
              <T variant="body">{stateRow.note}</T>
            </View>
          </>
        ) : null}
        {stateRow?.imageUri ? (
          <Pressable
            onPress={() => setImageViewerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="View photo"
          >
            <Image
              source={{ uri: stateRow.imageUri }}
              style={{ width: 64, height: 64, borderRadius: 10 }}
            />
          </Pressable>
        ) : null}
      </Surface>

      <PillSelect
        label="Status this month"
        options={STATUS_ORDER.map((key) => ({
          key,
          label: key === 'transferred' ? 'Transferred' : key === 'completed' ? 'Done' : 'Pending',
        }))}
        selectedKey={status}
        onSelect={(key) => state.setStatus(subcategory.id, key as never)}
      />

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

      <Button label="Save" onPress={handleSave} disabled={!name.trim()} />
      <Button label="Delete subcategory" variant="danger" icon="trash-outline" onPress={confirmDelete} />
    </ScrollView>

    {stateRow?.imageUri ? (
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
          <Image
            source={{ uri: stateRow.imageUri }}
            style={{ flex: 1 }}
            resizeMode="contain"
          />
        </View>
      </Modal>
    ) : null}
    </>
  );
}
