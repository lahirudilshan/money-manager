import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import { Button, Divider, Row, StatusPill, Surface, T } from '../../src/components/ui';
import { formatMoney, parseAmount } from '../../src/core/money';
import { STATUS_ORDER } from '../../src/core/planning';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Edit one category: its plan, its actual cost, and its status this month. */
export default function CategoryScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAppStore();

  const category = useMemo(
    () => state.categories.find((c) => c.id === id),
    [state.categories, id],
  );
  const stateRow = id ? state.states.get(id) : undefined;

  const [name, setName] = useState(category?.name ?? '');
  const [planned, setPlanned] = useState(
    category ? String(category.plannedMinor / 100) : '',
  );
  const [actual, setActual] = useState(
    stateRow?.actualMinor != null ? String(stateRow.actualMinor / 100) : '',
  );

  if (!category) {
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
        <T variant="heading">Category not found</T>
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  const status = stateRow?.status ?? 'pending';

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    state.updateCategory(category!.id, {
      name: trimmed,
      plannedMinor: parseAmount(planned) ?? 0,
    });

    // Empty actual means "as planned" rather than zero.
    const parsedActual = actual.trim() === '' ? null : parseAmount(actual);
    state.setActual(category!.id, parsedActual);

    router.back();
  }

  function confirmDelete() {
    Alert.alert(`Delete ${category!.name}?`, 'This removes it from the group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteCategory(category!.id);
          router.back();
        },
      },
    ]);
  }

  return (
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
      <SheetHeader title="Category" onClose={() => router.back()} />

      <Surface style={{ gap: space.md }}>
        <Row justify="space-between">
          <T variant="heading">{category.name}</T>
          <StatusPill status={status} />
        </Row>
        <Divider />
        <Row justify="space-between">
          <T variant="small" tone="secondary">
            Planned
          </T>
          <T variant="figure">{formatMoney(category.plannedMinor)}</T>
        </Row>
        {stateRow?.actualMinor != null ? (
          <Row justify="space-between">
            <T variant="small" tone="secondary">
              Actual
            </T>
            <T variant="figure">{formatMoney(stateRow.actualMinor)}</T>
          </Row>
        ) : null}
      </Surface>

      <PillSelect
        label="Status this month"
        options={STATUS_ORDER.map((key) => ({
          key,
          label: key === 'transferred' ? 'Transferred' : key === 'completed' ? 'Done' : 'Pending',
        }))}
        selectedKey={status}
        onSelect={(key) => state.setStatus(category.id, key as never)}
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
      <Button label="Delete category" variant="danger" icon="trash-outline" onPress={confirmDelete} />
    </ScrollView>
  );
}
