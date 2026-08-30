import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DragReorderList } from '~/shared/components/DragReorderList';
import { Button, Divider, FundingBar, Glyph, Label, ListRow, Row, Surface, Text } from '~/shared/components/ui';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import { formatMoney } from '~/shared/lib/money';
import { effectiveAmount, formatPeriod } from '~/features/budget/logic/planning';
import { accountLabel, resolveBrand } from '~/shared/data/banks';
import { selectCategoryView, useAppStore } from '../../src/store/useAppStore';
import { statusStyle } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * A category's overview and settings.
 *
 * Working through the bills happens on the List card — this page is where you
 * see the whole category's money at a glance, record the bulk transfer (with
 * an exact amount when it wasn't the full plan), and change its settings.
 */
export default function CategoryDetailScreen() {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = useAppStore();
  const view = useMemo(() => selectCategoryView(state, id!), [state, id]);

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
        <Text variant="heading">Category not found</Text>
        <Button label="Go back" onPress={() => router.back()} variant="ghost" />
      </View>
    );
  }

  const { category, card, cards, summary } = view;
  const transferred = view.transferStatus === 'transferred';
  const transferStyle = statusStyle('transferred', colors);

  // A short summary of how this category's bills recur — e.g. "3 monthly · 1
  // yearly". Shown on the summary card so the cadence reads at a glance.
  const frequencyLabel = (() => {
    const labels: Record<string, string> = {
      monthly: 'monthly',
      yearly: 'yearly',
      one_time: 'one-time',
      ongoing: 'ongoing',
    };
    const counts = new Map<string, number>();
    for (const sub of view.rawSubcategories) {
      counts.set(sub.frequency, (counts.get(sub.frequency) ?? 0) + 1);
    }
    const parts = [...counts.entries()].map(([freq, n]) => `${n} ${labels[freq] ?? freq}`);
    return parts.join(' · ');
  })();

  function confirmDelete() {
    const billCount = view!.rawSubcategories.length;

    Alert.alert(
      `Delete ${category.name}?`,
      billCount > 0
        ? `This also removes its ${billCount} ${billCount === 1 ? 'bill' : 'bills'} and their logged history.`
        : 'This category has no bills yet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // The store refuses when the category holds a loan installment.
            // Say so and stay put — popping the screen on a refused delete is
            // what made this look like "delete doesn't work".
            const result = state.deleteCategory(category.id);
            if (!result.ok) {
              Alert.alert('Remove the loan first', result.reason);
              return;
            }
            router.back();
          },
        },
      ],
    );
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
        showsVerticalScrollIndicator={false}
      >
        {/* Nav row. */}
        <Row justify="space-between">
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
          <Pressable
            onPress={() => router.push(`/category/edit/${category.id}`)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Edit category"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name="create-outline" size={22} color={colors.inkSecondary} />
          </Pressable>
        </Row>

        {/* Identity. */}
        <Row>
          <Glyph icon={category.icon as never} color={category.color} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title">{category.name}</Text>
            <Text variant="caption" tone="muted">
              {formatPeriod(state.period)} · {summary.subcategoryCount} bill
              {summary.subcategoryCount === 1 ? '' : 's'}
            </Text>
          </View>
        </Row>

        {/* Money overview. */}
        <Surface style={{ gap: space.lg }}>
          <Row justify="space-between" align="flex-start">
            <View style={{ gap: 2 }}>
              <Label>TOTAL PLAN</Label>
              <Text variant="display">{formatMoney(summary.totalMinor)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Label>PAID</Label>
              <Text
                variant="figureLarge"
                color={summary.isSettled ? colors.completed : colors.ink}
              >
                {formatMoney(summary.paidMinor)}
              </Text>
            </View>
          </Row>

          <View style={{ gap: space.sm }}>
            <FundingBar
              pct={
                summary.subcategoryCount > 0
                  ? (summary.counts.paid / summary.subcategoryCount) * 100
                  : 0
              }
              color={category.color}
              height={10}
              surplus={summary.isSettled}
            />
            <Row justify="space-between">
              <Text variant="caption" tone="muted">
                {summary.counts.paid}/{summary.subcategoryCount} bills paid
              </Text>
              <Text
                variant="caption"
                color={summary.outstandingMinor > 0 ? colors.pending : colors.completed}
              >
                {summary.outstandingMinor > 0
                  ? `${formatMoney(summary.outstandingMinor, { compact: true })} left`
                  : 'All paid'}
              </Text>
            </Row>
          </View>

          {/* Frequency mix — how this category's bills recur, at a glance. */}
          {frequencyLabel ? (
            <>
              <Divider />
              <Row gap={6}>
                <Ionicons name="repeat-outline" size={14} color={colors.inkMuted} />
                <Text variant="caption" tone="secondary">
                  {frequencyLabel}
                </Text>
              </Row>
            </>
          ) : null}
        </Surface>

        {/*
          Transfer status, READ-ONLY.

          The action moved to the dashboard's "money to move" section, because
          the real-world step is per ACCOUNT: one lump sum lands there for
          everything the account funds. Marking it per category asked the user
          to answer the same question several times for a single transfer.

          The status stays visible here, though — "has this category's money
          arrived?" is exactly what someone opening the category wants to know.
        */}
        {view.isIncomeOnly ? null : (
          <View style={{ gap: space.sm }}>
            <Label>BULK TRANSFER</Label>
            <Surface>
              <Row gap={space.md} align="center">
                <Ionicons
                  name={transferred ? 'checkmark-circle' : 'swap-horizontal'}
                  size={26}
                  color={transferred ? transferStyle.fg : colors.inkSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" color={transferred ? transferStyle.fg : colors.ink}>
                    {transferred ? 'Money transferred' : 'Not transferred yet'}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {transferred
                      ? 'The account holds this category’s money'
                      : card
                        ? `Mark it on ${accountLabel(card).primary} from the dashboard`
                        : 'Mark it from the dashboard once an account is set'}
                  </Text>
                </View>
              </Row>
            </Surface>
          </View>
        )}

        {/*
          THE BILLS, in the order the user arranged them.

          The board already lets a line be dragged within its category, but the
          board is where you go to work through the month — filtered, searched,
          and with every other category in the way. This page is the one place
          that shows this category and nothing else, which makes it the natural
          place to settle the order, and the two write the same `sortOrder`
          through the same action so an arrangement made here is the one the
          board shows.

          No filter or search exists on this screen, so the visible rows are
          always the whole category in its real order — the condition the board
          has to check for before it dares enable the gesture.
        */}
        {view.subcategories.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Row justify="space-between" align="center">
              <Label>BILLS</Label>
              <Text variant="caption" tone="muted">
                Hold to reorder
              </Text>
            </Row>
            <Surface padded={false} style={{ overflow: 'hidden' }}>
              {/*
                `gap={0}` — these rows are separated by dividers rather than by
                space, and a gap would break the continuous card face. The
                divider sits inside each row below the first, so it travels
                with the row it belongs to rather than being pinned to a
                position the drag then moves out from under it.
              */}
              <DragReorderList
                items={view.subcategories}
                gap={0}
                estimatedHeight={62}
                onReorder={(orderedIds) =>
                  state.reorderSubcategories(category.id, orderedIds)
                }
                renderItem={(line, index, dragging) => {
                  const raw = view!.rawSubcategories.find((sub) => sub.id === line.id);
                  // A spending budget is never "paid" as a whole — its spend is
                  // a running total of entries — so it reports what has gone
                  // out rather than a plan-or-actual figure.
                  const ongoing = raw?.frequency === 'ongoing';
                  const amount = ongoing
                    ? (line.actualMinor ?? 0)
                    : effectiveAmount(line);
                  const lineStyle = statusStyle(line.status, colors);

                  return (
                    <View
                      style={
                        dragging
                          ? {
                              backgroundColor: colors.surfaceRaised,
                              borderRadius: radius.md,
                            }
                          : undefined
                      }
                    >
                      {index === 0 || dragging ? null : (
                        <Divider style={{ marginLeft: space.lg }} />
                      )}
                      {/* Gesture-handler's Pressable, so the drag is not
                          swallowed by the ScrollView above it. */}
                      <GHPressable
                        onPress={() => router.push(`/subcategory/${line.id}`)}
                        accessibilityRole="button"
                        accessibilityLabel={`${line.name}, ${formatMoney(amount)}. Open detail.`}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: space.md,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Ionicons
                          name="reorder-three-outline"
                          size={18}
                          color={colors.inkMuted}
                        />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="body" numberOfLines={1}>
                            {line.name}
                          </Text>
                          <Text variant="caption" tone="muted">
                            {ongoing
                              ? 'Ongoing'
                              : line.status === 'paid'
                                ? 'Paid'
                                : 'Not paid'}
                          </Text>
                        </View>
                        <Text
                          variant="bodyStrong"
                          color={line.status === 'paid' ? lineStyle.fg : colors.ink}
                        >
                          {formatMoney(amount)}
                        </Text>
                      </GHPressable>
                    </View>
                  );
                }}
              />
            </Surface>
          </View>
        ) : null}

        {/*
          The accounts this category's BILLS are paid from.

          Read-only, and derived rather than set here. A category is a container
          — the account is a per-bill fact, and each bill's own screen is where
          it is chosen. Offering a category-level account as well created a
          fourth answer to a question the bills had already answered, and one
          that could silently disagree with all of them.

          Each row is a route INTO the bills paying from that account, so the
          list still leads somewhere actionable rather than being a dead label.
        */}
        <View style={{ gap: space.sm }}>
          <Label>PAID FROM</Label>
          <Surface padded={false}>
            {cards.length === 0 ? (
              <ListRow
                title={<Text variant="body" tone="secondary">No account yet</Text>}
                trailing={
                  <Text variant="caption" tone="muted">
                    Set one on a bill
                  </Text>
                }
              />
            ) : (
              cards.map((account) => {
                // How many of this category's bills pay from this account —
                // the number is what explains why two banks are listed at all.
                const billCount = view.rawSubcategories.filter(
                  (sub) => (sub.cardId ?? category.cardId) === account.id,
                ).length;
                const label = accountLabel(account);

                return (
                  <ListRow
                    key={account.id}
                    leading={
                      <BankLogo
                        brand={resolveBrand({
                          bankId: account.bankId,
                          bankName: account.bankName,
                        })}
                        size={28}
                      />
                    }
                    title={<Text variant="body">{label.primary}</Text>}
                    subtitle={label.secondary ?? undefined}
                    trailing={
                      <Text variant="caption" tone="muted">
                        {billCount} {billCount === 1 ? 'bill' : 'bills'}
                      </Text>
                    }
                  />
                );
              })
            )}
          </Surface>
        </View>

        <Button
          label="Delete category"
          variant="danger"
          icon="trash-outline"
          onPress={confirmDelete}
        />
      </ScrollView>

    </>
  );
}

