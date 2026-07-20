import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Empty,
  GradientButton,
  GradientCard,
  Glyph,
  GroupTile,
  Label,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { formatMoney } from '../../src/core/money';
import { formatPeriod, shiftPeriod } from '../../src/core/planning';
import {
  selectBoardTotals,
  selectGroupViews,
  selectRatios,
  selectTotalIncome,
  useAppStore,
} from '../../src/store/useAppStore';
import { tintFor } from '../../src/theme';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * The board: every group as a bold, tinted tile in a 2-column grid, with a
 * gradient hero carrying the headline number. This is the "full picture" the
 * spreadsheet gave the user, given a fintech-app treatment.
 */
export default function BoardScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const state = useAppStore();
  const views = useMemo(() => selectGroupViews(state), [state]);
  const totals = useMemo(() => selectBoardTotals(state), [state]);
  const ratios = useMemo(() => selectRatios(state), [state]);
  const income = useMemo(() => selectTotalIncome(state), [state]);

  const unfunded = views.filter((view) => !view.summary.isFullyFunded);
  const leftToFund = unfunded.reduce((sum, v) => sum + v.summary.shortfallMinor, 0);

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
      {/* Month switcher — the board is always scoped to one month. */}
      <Row justify="space-between">
        <Pressable
          onPress={() => state.setPeriod(shiftPeriod(state.period, -1))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Ionicons name="chevron-back" size={22} color={colors.inkMuted} />
        </Pressable>

        <View style={{ alignItems: 'center', gap: 1 }}>
          <Label>THE PLAN</Label>
          <T variant="title">{formatPeriod(state.period)}</T>
        </View>

        <Pressable
          onPress={() => state.setPeriod(shiftPeriod(state.period, 1))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Ionicons name="chevron-forward" size={22} color={colors.inkMuted} />
        </Pressable>
      </Row>

      {/* Gradient hero: the headline number the whole app answers to. */}
      <GradientCard>
        <View style={{ gap: space.lg }}>
          <View style={{ gap: 2 }}>
            <Label color="rgba(255,255,255,0.75)">LEFT AFTER PLAN</Label>
            <T variant="hero" color="#FFFFFF">
              {formatMoney(ratios.disposableMinor)}
            </T>
          </View>

          <Row gap={space.xxl}>
            <View style={{ gap: 2 }}>
              <Label color="rgba(255,255,255,0.65)">INCOME</Label>
              <T variant="figureLarge" color="#FFFFFF">
                {formatMoney(income, { compact: true })}
              </T>
            </View>
            <View style={{ gap: 2 }}>
              <Label color="rgba(255,255,255,0.65)">PLANNED</Label>
              <T variant="figureLarge" color="#FFFFFF">
                {formatMoney(totals.plannedMinor, { compact: true })}
              </T>
            </View>
            <View style={{ gap: 2 }}>
              <Label color="rgba(255,255,255,0.65)">TRANSFERRED</Label>
              <T variant="figureLarge" color="#FFFFFF">
                {formatMoney(totals.fundedMinor, { compact: true })}
              </T>
            </View>
          </Row>

          {/* Three ratios, as a bar directly on the gradient. */}
          <View style={{ gap: space.sm }}>
            <View
              style={{
                flexDirection: 'row',
                height: 8,
                borderRadius: 999,
                overflow: 'hidden',
                gap: 2,
                backgroundColor: 'rgba(255,255,255,0.22)',
              }}
            >
              {ratios.loanPct > 0 ? (
                <View style={{ flex: ratios.loanPct, backgroundColor: '#FFFFFF' }} />
              ) : null}
              {ratios.livingPct > 0 ? (
                <View style={{ flex: ratios.livingPct, backgroundColor: 'rgba(255,255,255,0.65)' }} />
              ) : null}
              {ratios.freePct > 0 ? (
                <View style={{ flex: ratios.freePct, backgroundColor: 'rgba(255,255,255,0.3)' }} />
              ) : null}
            </View>
            <Row gap={space.lg}>
              <LegendDot shade={1} label={`Loans ${ratios.loanPct.toFixed(0)}%`} />
              <LegendDot shade={0.65} label={`Living ${ratios.livingPct.toFixed(0)}%`} />
              <LegendDot shade={0.4} label={`Free ${ratios.freePct.toFixed(0)}%`} />
            </Row>
          </View>
        </View>
      </GradientCard>

      {/* One-tap status when money still needs moving. */}
      {leftToFund > 0 ? (
        <Surface style={{ backgroundColor: colors.pendingSoft, borderColor: colors.pending }}>
          <Row>
            <Glyph icon="swap-horizontal" color={colors.pending} />
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong" color={colors.pending}>
                {formatMoney(leftToFund)} still to transfer
              </T>
              <T variant="caption" tone="muted">
                {unfunded.length} group{unfunded.length === 1 ? '' : 's'} not yet funded
              </T>
            </View>
          </Row>
        </Surface>
      ) : views.length > 0 ? (
        <Surface style={{ backgroundColor: colors.completedSoft, borderColor: colors.completed }}>
          <Row>
            <Glyph icon="checkmark-done" color={colors.completed} />
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong" color={colors.completed}>
                Everything is funded
              </T>
              <T variant="caption" tone="muted">
                All groups have their money transferred
              </T>
            </View>
          </Row>
        </Surface>
      ) : null}

      <View style={{ gap: space.md }}>
        <Row justify="space-between">
          <Label>GROUPS</Label>
          <T variant="caption" tone="muted">
            {totals.settledGroupCount}/{totals.groupCount} settled
          </T>
        </Row>

        {views.length === 0 ? (
          <Empty
            icon="albums-outline"
            title="No groups yet"
            message="Create a group like 'Home Expenses', add its categories, then assign a card to fund it from."
            actionLabel="Create a group"
            onAction={() => router.push('/group/new')}
          />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {views.map((view) => {
              const { group, card, summary } = view;
              const progressLabel = summary.isFullyFunded
                ? 'Funded'
                : `${Math.round(summary.fundedPct)}% funded`;

              return (
                <GroupTile
                  key={group.id}
                  icon={group.icon as never}
                  color={group.color}
                  tint={tintFor(group.color, colors)}
                  name={group.name}
                  amount={formatMoney(summary.totalMinor, { compact: true })}
                  subtitle={`${summary.counts.completed}/${summary.categoryCount} done · ${card?.name ?? 'no card'}`}
                  progressLabel={progressLabel}
                  onPress={() => router.push(`/group/${group.id}`)}
                />
              );
            })}
          </View>
        )}
      </View>

      <GradientButton label="New group" icon="add" onPress={() => router.push('/group/new')} />
    </ScrollView>
  );
}

function LegendDot({ shade, label }: { shade: number; label: string }) {
  return (
    <Row gap={5}>
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: `rgba(255,255,255,${shade})`,
        }}
      />
      <T variant="caption" color="rgba(255,255,255,0.85)">
        {label}
      </T>
    </Row>
  );
}
