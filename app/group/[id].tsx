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
import { Field, SheetHeader } from '../../src/components/forms';
import { formatMoney, parseAmount } from '../../src/core/money';
import { formatPeriod } from '../../src/core/planning';
import { selectGroupView, useAppStore } from '../../src/store/useAppStore';
import { statusStyle } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * A group: fund it in one action, then tick each category through
 * pending -> transferred -> completed.
 */
export default function GroupDetailScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = useAppStore();
  const view = useMemo(() => selectGroupView(state, id!), [state, id]);

  const [fundOpen, setFundOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState('');
  const [catAmount, setCatAmount] = useState('');

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
        <T variant="heading">Group not found</T>
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  const { group, card, categories, summary } = view;

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
    state.fundGroup(group.id, amount);
    setFundOpen(false);
    setFundAmount('');
  }

  function handleAddCategory() {
    const name = catName.trim();
    const planned = parseAmount(catAmount) ?? 0;
    if (!name) return;
    state.addCategory({ name, groupId: group.id, plannedMinor: planned });
    setCatName('');
    setCatAmount('');
    setCatOpen(false);
  }

  function confirmDelete() {
    Alert.alert(`Delete ${group.name}?`, 'Its categories will be removed too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteGroup(group.id);
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
              onPress={() => router.push(`/group/edit/${group.id}`)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Edit group"
            >
              <Ionicons name="create-outline" size={22} color={colors.inkSecondary} />
            </Pressable>
            <Pressable
              onPress={confirmDelete}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Delete group"
            >
              <Ionicons name="trash-outline" size={21} color={colors.danger} />
            </Pressable>
          </Row>
        </Row>

        {/* Group header: identity, destination card, and the money. */}
        <View style={{ gap: space.md }}>
          <Row>
            <Glyph icon={group.icon as never} color={group.color} size={46} />
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="title">{group.name}</T>
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
                color={group.color}
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

            {/* Where this group's money is transferred to. */}
            <Pressable
              onPress={() => router.push(`/group/edit/${group.id}`)}
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
                onPress={() => state.unfundGroup(group.id)}
              />
            ) : null}
          </Row>
        </View>

        {/* The checklist. */}
        <View style={{ gap: space.md }}>
          <Row justify="space-between">
            <Label>CATEGORIES</Label>
            <Row gap={space.md}>
              <Pressable
                onPress={() => state.markGroup(group.id, 'completed')}
                hitSlop={8}
                accessibilityRole="button"
              >
                <T variant="caption" tone="accent">
                  Mark all done
                </T>
              </Pressable>
              <Pressable
                onPress={() => state.markGroup(group.id, 'pending')}
                hitSlop={8}
                accessibilityRole="button"
              >
                <T variant="caption" tone="muted">
                  Reset
                </T>
              </Pressable>
            </Row>
          </Row>

          {categories.length === 0 ? (
            <Empty
              icon="pricetag-outline"
              title="No categories"
              message="Add the individual bills that make up this group."
              actionLabel="Add category"
              onAction={() => setCatOpen(true)}
            />
          ) : (
            <Surface padded={false} style={{ paddingVertical: space.xs }}>
              {categories.map((category, index) => {
                const style = statusStyle(category.status, colors);
                const amount = category.actualMinor ?? category.plannedMinor;

                return (
                  <View key={category.id}>
                    <Pressable
                      onPress={() => state.cycleStatus(category.id)}
                      onLongPress={() =>
                        router.push(`/category/${category.id}`)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`${category.name}, ${style.label}. Tap to advance status.`}
                      style={({ pressed }) => ({
                        paddingVertical: space.md,
                        paddingHorizontal: space.lg,
                        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                      })}
                    >
                      <Row>
                        {/* Tapping the dot advances the status. */}
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor:
                              category.status === 'pending' ? 'transparent' : style.fg,
                            borderWidth: category.status === 'pending' ? 2 : 0,
                            borderColor: colors.hairlineStrong,
                          }}
                        >
                          {category.status === 'completed' ? (
                            <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                          ) : category.status === 'transferred' ? (
                            <Ionicons name="arrow-down" size={14} color="#FFFFFF" />
                          ) : null}
                        </View>

                        <View style={{ flex: 1, gap: 2 }}>
                          <T
                            variant="body"
                            numberOfLines={1}
                            style={
                              category.status === 'completed'
                                ? { textDecorationLine: 'line-through' }
                                : undefined
                            }
                            tone={category.status === 'completed' ? 'muted' : 'ink'}
                          >
                            {category.name}
                          </T>
                          <StatusPill status={category.status} compact />
                        </View>

                        <T variant="figure" tone={category.status === 'completed' ? 'muted' : 'ink'}>
                          {formatMoney(amount)}
                        </T>
                      </Row>
                    </Pressable>
                    {index < categories.length - 1 ? (
                      <Divider style={{ marginLeft: 56 }} />
                    ) : null}
                  </View>
                );
              })}
            </Surface>
          )}

          <Button
            label="Add category"
            icon="add"
            variant="secondary"
            onPress={() => setCatOpen(true)}
          />

          <T variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            Tap a row to advance its status · hold to edit
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
              <Glyph icon={group.icon as never} color={group.color} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{group.name}</T>
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
            Transferring marks every pending category in this group as
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

      {/* Add category sheet */}
      <Modal
        visible={catOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCatOpen(false)}
      >
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.canvas }}
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <SheetHeader title="New category" onClose={() => setCatOpen(false)} />
          <Field
            label="Name"
            value={catName}
            onChangeText={setCatName}
            placeholder="e.g. Electricity"
            autoFocus
          />
          <Field
            label="Planned amount"
            value={catAmount}
            onChangeText={setCatAmount}
            placeholder="0"
            keyboardType="numeric"
          />
          <Button
            label="Add to group"
            onPress={handleAddCategory}
            disabled={!catName.trim()}
          />
        </ScrollView>
      </Modal>
    </>
  );
}
