import { Ionicons } from '@expo/vector-icons';
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
import { Field, SheetHeader } from '../../src/components/forms';
import { Button, Divider, GradientButton, PinnedFooter, Row, Surface, T } from '../../src/components/ui';
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

        {/* Note & photo, when a transaction was logged. */}
        {stateRow?.note || stateRow?.imageUri ? (
          <Surface style={{ gap: space.md }}>
            {stateRow?.note ? (
              <View style={{ gap: 2 }}>
                <T variant="label" tone="muted">
                  NOTE
                </T>
                <T variant="body">{stateRow.note}</T>
              </View>
            ) : null}
            {stateRow?.imageUri ? (
              <Pressable
                onPress={() => setImageViewerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="View photo"
              >
                <Image
                  source={{ uri: stateRow.imageUri }}
                  style={{ width: 80, height: 80, borderRadius: 12 }}
                />
              </Pressable>
            ) : null}
          </Surface>
        ) : null}

        {/* Editable plan. */}
        <View style={{ gap: space.md }}>
          <T variant="label" tone="muted">
            EDIT
          </T>
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
    </KeyboardAvoidingView>
  );
}
