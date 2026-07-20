import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Divider,
  Empty,
  GradientCard,
  Label,
  Row,
  ScreenHeader,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { formatMoney } from '../../src/core/money';
import { formatPeriod } from '../../src/core/planning';
import {
  selectBoardTotals,
  selectGroupViews,
  selectTotalIncome,
  useAppStore,
} from '../../src/store/useAppStore';
import { statusStyle } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * The spreadsheet view: every group and every line in one dense, scannable
 * table. This is the "clear view of the whole structure" — the board shows
 * state, this shows the numbers.
 */
export default function SummaryScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const state = useAppStore();
  const views = useMemo(() => selectGroupViews(state), [state]);
  const totals = useMemo(() => selectBoardTotals(state), [state]);
  const income = useMemo(() => selectTotalIncome(state), [state]);

  const left = income - totals.plannedMinor;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingBottom: tabClearance,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader eyebrow={formatPeriod(state.period)} title="Full picture" />

      {/* Income block */}
      <Surface style={{ gap: space.md }}>
        <Row justify="space-between">
          <Label>INCOME</Label>
          <T variant="figure" color={colors.completed}>
            {formatMoney(income)}
          </T>
        </Row>
        <Divider />
        {state.incomes.map((item) => (
          <Row key={item.id} justify="space-between">
            <View style={{ flex: 1 }}>
              <T variant="body">{item.name}</T>
              {item.foreignAmount ? (
                <T variant="caption" tone="muted">
                  ${item.foreignAmount.toLocaleString()} @ {item.foreignRate}
                </T>
              ) : null}
            </View>
            <T variant="figure">{formatMoney(item.amountMinor)}</T>
          </Row>
        ))}
        {state.incomes.length === 0 ? (
          <T variant="small" tone="muted">
            No income added yet.
          </T>
        ) : null}
      </Surface>

      {/* Every group, every line. */}
      {views.length === 0 ? (
        <Empty
          icon="grid-outline"
          title="Nothing planned"
          message="Create groups on the board and they will appear here as a full breakdown."
        />
      ) : (
        views.map((view) => (
          <Surface key={view.group.id} style={{ gap: space.sm }} padded={false}>
            <Pressable
              onPress={() => router.push(`/group/${view.group.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                padding: space.lg,
                paddingBottom: space.sm,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Row justify="space-between">
                <Row gap={space.sm} style={{ flex: 1 }}>
                  <View
                    style={{
                      width: 3,
                      height: 22,
                      borderRadius: 2,
                      backgroundColor: view.group.color,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong" numberOfLines={1}>
                      {view.group.name}
                    </T>
                    <T variant="caption" tone="muted">
                      {view.card?.name ?? 'No card'}
                    </T>
                  </View>
                </Row>
                <View style={{ alignItems: 'flex-end' }}>
                  <T variant="figure">{formatMoney(view.summary.totalMinor)}</T>
                  <T
                    variant="caption"
                    color={
                      view.summary.isFullyFunded ? colors.completed : colors.pending
                    }
                  >
                    {view.summary.isFullyFunded
                      ? 'funded'
                      : `${formatMoney(view.summary.shortfallMinor, { compact: true })} short`}
                  </T>
                </View>
              </Row>
            </Pressable>

            <Divider />

            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: 2 }}>
              {view.categories.map((category) => {
                const style = statusStyle(category.status, colors);
                const amount = category.actualMinor ?? category.plannedMinor;

                return (
                  <Row key={category.id} justify="space-between" style={{ paddingVertical: 5 }}>
                    <Row gap={space.sm} style={{ flex: 1 }}>
                      {/* Status dot + the row's own text — never colour alone. */}
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: style.fg,
                        }}
                      />
                      <T
                        variant="small"
                        tone={category.status === 'completed' ? 'muted' : 'secondary'}
                        numberOfLines={1}
                        style={{ flex: 1 }}
                      >
                        {category.name}
                      </T>
                    </Row>
                    <Row gap={space.sm}>
                      <T variant="caption" color={style.fg}>
                        {style.label}
                      </T>
                      <T
                        variant="figure"
                        tone={category.status === 'completed' ? 'muted' : 'ink'}
                        style={{ minWidth: 92, textAlign: 'right' }}
                      >
                        {formatMoney(amount)}
                      </T>
                    </Row>
                  </Row>
                );
              })}
            </View>
          </Surface>
        ))
      )}

      {/* Bottom line, carried on the gradient to match the board's hero. */}
      <GradientCard>
        <View style={{ gap: space.md }}>
          <Row justify="space-between">
            <T variant="small" color="rgba(255,255,255,0.75)">
              Total income
            </T>
            <T variant="figure" color="#FFFFFF">
              {formatMoney(income)}
            </T>
          </Row>
          <Row justify="space-between">
            <T variant="small" color="rgba(255,255,255,0.75)">
              Total planned
            </T>
            <T variant="figure" color="#FFFFFF">
              −{formatMoney(totals.plannedMinor, { showCurrency: false })}
            </T>
          </Row>
          <Divider style={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />
          <Row justify="space-between">
            <T variant="bodyStrong" color="#FFFFFF">
              Left over
            </T>
            <T
              variant="figureLarge"
              color={left >= 0 ? '#FFFFFF' : '#FFE1E6'}
            >
              {formatMoney(left)}
            </T>
          </Row>
          {left < 0 ? (
            <Row gap={4}>
              <Ionicons name="alert-circle" size={13} color="#FFE1E6" />
              <T variant="caption" color="#FFE1E6">
                Plan exceeds income
              </T>
            </Row>
          ) : null}
          <Row justify="space-between">
            <T variant="caption" color="rgba(255,255,255,0.6)">
              Still to pay this month
            </T>
            <T variant="caption" color="rgba(255,255,255,0.85)">
              {formatMoney(totals.outstandingMinor)}
            </T>
          </Row>
        </View>
      </GradientCard>
    </ScrollView>
  );
}
