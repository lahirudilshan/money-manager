import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Divider,
  Empty,
  FundingBar,
  Glyph,
  Label,
  Row,
  StatusPill,
  Surface,
  T,
} from '../../src/components/ui';
import { Field, PillSelect, SheetHeader } from '../../src/components/forms';
import { formatMoney, parseAmount } from '../../src/core/money';
import { formatPeriod } from '../../src/core/planning';
import { selectCategoryView, useAppStore } from '../../src/store/useAppStore';
import { statusStyle } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

const FREQUENCIES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'one_time', label: 'One-time' },
  { key: 'yearly', label: 'Yearly' },
];

/**
 * A category: fund it in one action, then tick each subcategory through
 * pending -> transferred -> completed.
 */
export default function CategoryDetailScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = useAppStore();
  const view = useMemo(() => selectCategoryView(state, id!), [state, id]);

  const [fundOpen, setFundOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState('');
  const [subOpen, setSubOpen] = useState(false);
  const [subName, setSubName] = useState('');
  const [subAmount, setSubAmount] = useState('');
  const [subFrequency, setSubFrequency] = useState<'monthly' | 'one_time' | 'yearly'>('monthly');

  if (!view) {
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

  const { category, card, subcategories, summary } = view;

  function openFundSheet() {
    // Prefill with what is still outstanding — the common case is one tap.
    setFundAmount(
      summary.shortfallMinor > 0 ? String(summary.shortfallMinor / 100) : '',
    );
    setFundOpen(true);
  }

  function handleFund() {
    const amount = parseAmount(fundAmount);
    if (!amount || amount <= 0) return;
    state.fundCategory(category.id, amount);
    setFundOpen(false);
    setFundAmount('');
  }

  function handleAddSubcategory() {
    const name = subName.trim();
    if (!name) return;
    state.addSubcategory({
      name,
      categoryId: category.id,
      plannedMinor: parseAmount(subAmount) ?? 0,
      frequency: subFrequency,
    });
    setSubName('');
    setSubAmount('');
    setSubFrequency('monthly');
    setSubOpen(false);
  }

  function confirmDelete() {
    Alert.alert(`Delete ${category.name}?`, 'Its subcategories will be removed too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteCategory(category.id);
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
          paddingBottom: space.xxxl * 2,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Row justify="space-between">
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
          <Row gap={space.sm}>
            <Pressable
              onPress={() => router.push(`/category/edit/${category.id}`)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Edit category"
            >
              <Ionicons name="create-outline" size={22} color={colors.inkSecondary} />
            </Pressable>
            <Pressable
              onPress={confirmDelete}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Delete category"
            >
              <Ionicons name="trash-outline" size={21} color={colors.danger} />
            </Pressable>
          </Row>
        </Row>

        {/* Category header: identity, destination card, and the money. */}
        <View style={{ gap: space.md }}>
          <Row>
            <Glyph icon={category.icon as never} color={category.color} size={46} />
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="title">{category.name}</T>
              <T variant="caption" tone="muted">
                {formatPeriod(state.period)}
              </T>
            </View>
          </Row>

          <Surface style={{ gap: space.lg }}>
            <Row justify="space-between" align="flex-start">
              <View style={{ gap: 2 }}>
                <Label>TOTAL PLAN</Label>
                <T variant="display">{formatMoney(summary.totalMinor)}</T>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Label>TRANSFERRED</Label>
                <T
                  variant="figureLarge"
                  color={summary.isFullyFunded ? colors.completed : colors.pending}
                >
                  {formatMoney(summary.fundedMinor)}
                </T>
              </View>
            </Row>

            <View style={{ gap: space.sm }}>
              <FundingBar
                pct={summary.fundedPct}
                color={category.color}
                height={10}
                surplus={summary.surplusMinor > 0}
              />
              <Row justify="space-between">
                <T variant="caption" tone="muted">
                  {Math.round(summary.fundedPct)}% funded
                </T>
                {summary.shortfallMinor > 0 ? (
                  <T variant="caption" color={colors.pending}>
                    {formatMoney(summary.shortfallMinor)} short
                  </T>
                ) : summary.surplusMinor > 0 ? (
                  <T variant="caption" color={colors.completed}>
                    {formatMoney(summary.surplusMinor)} extra
                  </T>
                ) : (
                  <T variant="caption" color={colors.completed}>
                    Fully funded
                  </T>
                )}
              </Row>
            </View>

            <Divider />

            {/* Where this category's money is transferred to. */}
            <Pressable
              onPress={() => router.push(`/category/edit/${category.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Row>
                <Ionicons name="card-outline" size={17} color={colors.inkMuted} />
                <View style={{ flex: 1 }}>
                  <T variant="caption" tone="muted">
                    Funded to
                  </T>
                  <T variant="bodyStrong">{card?.name ?? 'No card assigned'}</T>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
              </Row>
            </Pressable>
          </Surface>

          <Row gap={space.sm}>
            <Button
              label={summary.shortfallMinor > 0 ? 'Transfer money' : 'Add transfer'}
              icon="swap-horizontal"
              onPress={openFundSheet}
              style={{ flex: 1 }}
            />
            {summary.fundedMinor > 0 ? (
              <Button
                label="Undo"
                icon="arrow-undo-outline"
                variant="secondary"
                onPress={() => state.unfundCategory(category.id)}
              />
            ) : null}
          </Row>
        </View>

        {/* The checklist. */}
        <View style={{ gap: space.md }}>
          <Row justify="space-between">
            <Label>SUBCATEGORIES</Label>
            <Row gap={space.md}>
              <Pressable
                onPress={() => state.markCategory(category.id, 'completed')}
                hitSlop={8}
                accessibilityRole="button"
              >
                <T variant="caption" tone="accent">
                  Mark all done
                </T>
              </Pressable>
              <Pressable
                onPress={() => state.markCategory(category.id, 'pending')}
                hitSlop={8}
                accessibilityRole="button"
              >
                <T variant="caption" tone="muted">
                  Reset
                </T>
              </Pressable>
            </Row>
          </Row>

          {subcategories.length === 0 ? (
            <Empty
              icon="pricetag-outline"
              title="No subcategories"
              message="Add the individual bills that make up this category."
              actionLabel="Add subcategory"
              onAction={() => setSubOpen(true)}
            />
          ) : (
            <Surface padded={false} style={{ paddingVertical: space.xs }}>
              {subcategories.map((subcategory, index) => {
                const style = statusStyle(subcategory.status, colors);
                const amount = subcategory.actualMinor ?? subcategory.plannedMinor;

                return (
                  <View key={subcategory.id}>
                    <Row style={{ paddingHorizontal: space.lg }}>
                      {/* Its own tap target: advances the status. Separate
                          from the row below so "change status" and "view
                          detail" are two distinct, unambiguous taps. */}
                      <Pressable
                        onPress={() => state.cycleStatus(subcategory.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Mark ${subcategory.name} as next status. Currently ${style.label}.`}
                        hitSlop={10}
                        style={({ pressed }) => ({
                          width: 40,
                          height: 40,
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor:
                              subcategory.status === 'pending' ? 'transparent' : style.fg,
                            borderWidth: subcategory.status === 'pending' ? 2 : 0,
                            borderColor: colors.hairlineStrong,
                          }}
                        >
                          {subcategory.status === 'completed' ? (
                            <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                          ) : subcategory.status === 'transferred' ? (
                            <Ionicons name="arrow-down" size={14} color="#FFFFFF" />
                          ) : null}
                        </View>
                      </Pressable>

                      {/* The rest of the row: tap to view/edit detail. */}
                      <Pressable
                        onPress={() => router.push(`/subcategory/${subcategory.id}`)}
                        accessibilityRole="button"
                        accessibilityLabel={`${subcategory.name}, ${style.label}. View detail.`}
                        style={({ pressed }) => ({
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: space.md,
                          backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                        })}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <T
                            variant="body"
                            numberOfLines={1}
                            style={
                              subcategory.status === 'completed'
                                ? { textDecorationLine: 'line-through' }
                                : undefined
                            }
                            tone={subcategory.status === 'completed' ? 'muted' : 'ink'}
                          >
                            {subcategory.name}
                          </T>
                          <StatusPill status={subcategory.status} compact />
                        </View>

                        <T
                          variant="figure"
                          tone={subcategory.status === 'completed' ? 'muted' : 'ink'}
                        >
                          {formatMoney(amount)}
                        </T>
                        <Ionicons
                          name="chevron-forward"
                          size={14}
                          color={colors.inkMuted}
                          style={{ marginLeft: space.xs }}
                        />
                      </Pressable>
                    </Row>
                    {index < subcategories.length - 1 ? (
                      <Divider style={{ marginLeft: 56 }} />
                    ) : null}
                  </View>
                );
              })}
            </Surface>
          )}

          <Button
            label="Add subcategory"
            icon="add"
            variant="secondary"
            onPress={() => setSubOpen(true)}
          />

          <T variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            Tap the circle to advance status · tap the row for details
          </T>
        </View>
      </ScrollView>

      {/* Fund sheet */}
      <Modal
        visible={fundOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFundOpen(false)}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.canvas }}
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <SheetHeader title="Transfer money" onClose={() => setFundOpen(false)} />

          <Surface style={{ gap: space.sm }}>
            <Row>
              <Glyph icon={category.icon as never} color={category.color} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{category.name}</T>
                <T variant="caption" tone="muted">
                  to {card?.name ?? 'no card assigned'}
                </T>
              </View>
            </Row>
            <Divider />
            <Row justify="space-between">
              <T variant="small" tone="secondary">
                Needed
              </T>
              <T variant="figure">{formatMoney(summary.totalMinor)}</T>
            </Row>
            <Row justify="space-between">
              <T variant="small" tone="secondary">
                Already transferred
              </T>
              <T variant="figure">{formatMoney(summary.fundedMinor)}</T>
            </Row>
          </Surface>

          <Field
            label="Amount to transfer"
            value={fundAmount}
            onChangeText={setFundAmount}
            placeholder="0"
            keyboardType="numeric"
            autoFocus
          />

          <T variant="caption" tone="muted">
            Transferring marks every pending subcategory in this category as
            transferred. Tick them off as you actually pay them.
          </T>

          <Button
            label={`Transfer ${formatMoney(parseAmount(fundAmount) ?? 0)}`}
            icon="swap-horizontal"
            onPress={handleFund}
            disabled={!parseAmount(fundAmount)}
          />
        </ScrollView>
      </Modal>

      {/* Add subcategory sheet — the category already exists, so this is
          just the leaf-adding form, not the combined CategorySheet. */}
      <Modal
        visible={subOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSubOpen(false)}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.canvas }}
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <SheetHeader title="New subcategory" onClose={() => setSubOpen(false)} />
          <Field
            label="Name"
            value={subName}
            onChangeText={setSubName}
            placeholder="e.g. Electricity"
            autoFocus
          />
          <Field
            label="Planned amount"
            value={subAmount}
            onChangeText={setSubAmount}
            placeholder="0"
            keyboardType="numeric"
          />
          <PillSelect
            label="Frequency"
            options={FREQUENCIES}
            selectedKey={subFrequency}
            onSelect={(key) => setSubFrequency(key as typeof subFrequency)}
          />
          <Button
            label="Add to category"
            onPress={handleAddSubcategory}
            disabled={!subName.trim()}
          />
        </ScrollView>
      </Modal>
    </>
  );
}
