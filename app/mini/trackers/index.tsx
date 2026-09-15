import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Divider,
  Empty,
  Label,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import {
  describeDays,
  nextDue,
  refillStats,
  refillStatus,
  type Refill as RefillLike,
  type RefillStatus,
} from '~/features/refills/logic/refills';
import { refillRepo } from '~/db/repositories/trackers';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * The tracker list: everything you replace, and which one needs attention.
 *
 * Sorted by URGENCY rather than by name. The question this add-on answers is
 * "what is about to run out", and an alphabetical list buries a cylinder due
 * on Thursday under a water filter due in March.
 */
export default function TrackersHome() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const items = useAppStore((s) => s.trackedItems);
  const [showArchived, setShowArchived] = useState(false);

  /*
   * Refills are read here rather than held in the store — the same rule the
   * fuel add-on follows with fill-ups. The list needs every item's history to
   * rank them, but nothing else in the app does.
   */
  const byItem = useMemo(() => {
    const map = new Map<string, RefillLike[]>();
    for (const row of refillRepo.all()) {
      const bucket = map.get(row.itemId) ?? [];
      bucket.push({
        id: row.id,
        filledOn: row.filledOn,
        priceMinor: row.priceMinor,
        note: row.note,
      });
      map.set(row.itemId, bucket);
    }
    return map;
  }, [items]);

  const now = new Date();

  const rows = useMemo(() => {
    return items
      .filter((item) => (showArchived ? true : !item.archived))
      .map((item) => {
        const refills = byItem.get(item.id) ?? [];
        const due = nextDue(refills, item, now);
        return {
          item,
          refills,
          due,
          status: refillStatus(due),
          stats: refillStats(refills, now),
        };
      })
      .sort((a, b) => {
        // Anything with a projection outranks anything without one; soonest first.
        if (a.due && b.due) return a.due.inDays - b.due.inDays;
        if (a.due) return -1;
        if (b.due) return 1;
        return a.item.name.localeCompare(b.item.name);
      });
  }, [items, byItem, showArchived]);


  const archivedCount = items.filter((item) => item.archived).length;


  return (
    <Screen
      title="Usage tracker"
      /*
        Every other add-on's home screen passes `onBack`; this one did not, so
        the only way out was the iOS edge swipe. A screen you navigate INTO
        needs a visible way back.
      */
      onBack={() => router.back()}
      action={{ icon: 'add', label: 'Add item', onPress: () => router.push('/mini/trackers/item') }}
    >
      {/*
        No ScrollView here: `Screen` already scrolls and applies `padding:
        space.lg`. Nesting a second one double-padded the gutters and put a
        scroll view inside a scroll view.
      */}
      <View style={{ gap: space.lg }}>
        {/*
          A plain status line, no money.

          The card carried a monthly run-rate and a lifetime total — two figures
          that belong to the money side of the app, not to a screen about when
          things run out. What is worth saying at the top is the state of the
          set in one sentence, which is also the reassurance when nothing is
          due.
        */}
        {rows.length === 0 ? (
          <Empty
            icon="repeat-outline"
            title="Nothing tracked yet"
            message="Add a gas cylinder, a water bottle, a filter — anything you replace. After the second one it starts telling you how long each lasts."
            actionLabel="Add an item"
            onAction={() => router.push('/mini/trackers/item')}
          />
        ) : (
          /*
            The DASHBOARD's own treatment, copied rather than reinvented.

            This screen had grown its own row geometry, its own grey header
            bands and its own countdown styling, so it read as a different app
            bolted on. `ReminderRow` in the dashboard already solves exactly
            this problem — an urgent thing with a date — so its 36pt tinted
            status tile, accent caption and `figure` trailing value are reused
            verbatim, and the heading is the same `<Label>` + count as
            "COMING UP".
          */
          <View style={{ gap: space.lg }}>
            {SECTIONS.map((section) => {
              const group = rows.filter((row) => section.match(row.status));
              if (group.length === 0) return null;

              return (
                <View key={section.key} style={{ gap: space.sm }}>
                  {/*
                    The count sits BESIDE the title, not at the far edge.

                    `space-between` threw it to the right margin, where it read
                    as an unrelated number floating over the card below rather
                    than as the count of that heading.
                  */}
                  <Row align="center" gap={space.sm}>
                    <Label>{section.title}</Label>
                    {/*
                      A neutral square badge.

                      Grey rather than tinted: the section's state is already
                      said by its title and repeated on every row's tile, so
                      colouring the count as well was a third statement of the
                      same fact. It only needs to read as a count.
                    */}
                    <View
                      style={{
                        minWidth: 22,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: radius.sm,
                        alignItems: 'center',
                        backgroundColor: colors.surfaceSunken,
                      }}
                    >
                      <Text
                        variant="caption"
                        tone="muted"
                        style={{ fontWeight: '800' }}
                      >
                        {group.length}
                      </Text>
                    </View>
                  </Row>

                  <Surface padded={false} style={{ paddingVertical: space.xs }}>
                    {group.map((row, index) => {
                      const urgent = section.key === 'now';
                      const accent = urgent
                        ? row.status === 'overdue'
                          ? colors.danger
                          : colors.pending
                        : colors.completed;

                      return (
                        <View key={row.item.id}>
                          {index > 0 ? (
                            <Divider style={{ marginHorizontal: space.lg }} />
                          ) : null}
                          <Pressable
                            onPress={() => router.push(`/mini/trackers/detail?id=${row.item.id}`)}
                            accessibilityRole="button"
                            accessibilityLabel={`${row.item.name}, ${countdown(row.due)}`}
                            style={({ pressed }) => ({
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: space.md,
                              paddingHorizontal: space.lg,
                              paddingVertical: space.md,
                              opacity: (pressed ? 0.7 : 1) * (row.item.archived ? 0.55 : 1),
                            })}
                          >
                            {/*
                              The tile carries the STATUS, exactly as the
                              dashboard's does — the item's own icon inside it,
                              so the row says both what it is and how urgent it
                              is without a second element.
                            */}
                            <View
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 12,
                                backgroundColor: urgent
                                  ? row.status === 'overdue'
                                    ? colors.dangerSoft
                                    : colors.pendingSoft
                                  : colors.completedSoft,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Ionicons
                                name={(row.item.icon as never) ?? 'cube-outline'}
                                size={19}
                                color={accent}
                              />
                            </View>

                            <View style={{ flex: 1 }}>
                              <Text variant="bodyStrong" numberOfLines={1}>
                                {row.item.name}
                              </Text>
                              <Row gap={space.xs}>
                                <Text
                                  variant="caption"
                                  color={accent}
                                  style={{ fontWeight: '700' }}
                                >
                                  {countdown(row.due)}
                                </Text>
                                <Text variant="caption" tone="muted" numberOfLines={1}>
                                  · {detailLine(row.stats, row.item.unitLabel)}
                                </Text>
                              </Row>
                            </View>

                            {/*
                              No trailing figure.

                              It showed how long one USUALLY lasts, which beside
                              a countdown read as a second, contradictory date —
                              "2 mo" next to "1 mo 5 d over" — and rendered as a
                              bare dash on an item with no history yet. The
                              average has a label on the detail screen; here it
                              only competed with the number that matters.
                            */}
                            <Ionicons
                              name="chevron-forward"
                              size={15}
                              color={colors.inkMuted}
                            />
                          </Pressable>
                        </View>
                      );
                    })}
                  </Surface>
                </View>
              );
            })}
          </View>
        )}

        {archivedCount > 0 ? (
          <Pressable onPress={() => setShowArchived((value) => !value)}>
            <Text variant="small" style={{ color: colors.inkMuted, textAlign: 'center' }}>
              {showArchived ? 'Hide' : 'Show'} {archivedCount} archived
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

/* Rose rather than orange for "due soon" — matches the detail screen's own
   progression, and keeps the add-on free of the alarm colour. */
/**
 * The two groups the list splits into.
 *
 * Only two, deliberately. A third "due soon" band would put three headers on a
 * seven-item list and leave one item under each — the split is meant to answer
 * "what do I act on today", which is binary.
 */
const SECTIONS: {
  key: 'now' | 'later';
  title: string;
  match: (status: RefillStatus) => boolean;
}[] = [
  {
    key: 'now',
    title: 'NEEDS BUYING',
    match: (status) => status === 'overdue' || status === 'due-soon',
  },
  {
    key: 'later',
    title: 'ALL GOOD',
    match: (status) => status === 'fresh' || status === 'unknown',
  },
];

const STATUS_COLOR: Record<RefillStatus, string> = {
  overdue: '#B91C1C',
  'due-soon': '#BE123C',
  fresh: '#059669',
  unknown: '#64748B',
};

/**
 * The one line under the name.
 *
 * Says the most useful true thing available, degrading gracefully: a projection
 * when there is history, how long the current one has run when there is not,
 * and an invitation when the item is brand new. It never guesses.
 */
/**
 * The left-hand supporting line: what this item IS and how it behaves.
 *
 * Deliberately excludes the countdown, which now has its own column. Mixing
 * the two in one sentence made a line that wrapped to two rows and buried the
 * urgent half mid-phrase.
 */
function detailLine(
  stats: ReturnType<typeof refillStats>,
  unitLabel: string | null | undefined,
): string {
  const unit = unitLabel ? `${unitLabel} · ` : '';

  if (!stats.lastFilledOn) return `${unit}nothing logged yet`;

  /*
   * The detail line IDENTIFIES the item; it does not restate a statistic.
   *
   * It used to carry the average duration, which competed with the countdown
   * column for one line and left both truncated. The average is a detail-screen
   * figure — here the useful second line is the unit and how many you have
   * bought, which no other column shows.
   */
  const bought = stats.spanCount + 1;
  const timesLabel = bought === 1 ? 'first one' : `${bought} bought`;
  return `${unit}${timesLabel}`;
}

/**
 * The right-hand countdown.
 *
 * "Today" and "Tomorrow" rather than `describeDays(0)`, which renders as
 * "0 days" and reads like a stalled counter instead of one that has arrived.
 */
function countdown(due: ReturnType<typeof nextDue>): string {
  if (!due) return '—';
  if (due.inDays === 0) return 'Today';
  if (due.inDays === 1) return 'Tomorrow';
  if (due.inDays < 0) return `${compact(-due.inDays)} over`;
  return `${compact(due.inDays)} left`;
}

/**
 * A duration short enough for a list column: "18 days", "1 mo 5 d".
 *
 * The long form ("1 month 5 days") ran to sixteen characters and forced an
 * ellipsis. The detail screen keeps the full wording, where one figure has the
 * whole width.
 */
function compact(days: number): string {

  if (days < 31) return `${days} days`;
  const months = Math.floor(days / 30);
  const rest = days % 30;
  return rest === 0 ? `${months} mo` : `${months} mo ${rest} d`;
}

function summaryLine(
  stats: ReturnType<typeof refillStats>,
  due: ReturnType<typeof nextDue>,
  unitLabel: string | null | undefined,
): string {
  if (!stats.lastFilledOn) {
    return unitLabel ? `${unitLabel} — nothing logged yet` : 'Nothing logged yet';
  }

  if (due) {
    if (due.inDays < 0) return `Due ${describeDays(-due.inDays)} ago`;

    /*
     * "Due today" / "due tomorrow", never "next in 0 days".
     *
     * `describeDays(0)` is literally "0 days", which reads as a countdown that
     * has stalled rather than one that has arrived.
     */
    const when =
      due.inDays === 0
        ? 'due today'
        : due.inDays === 1
          ? 'due tomorrow'
          : `next in ${describeDays(due.inDays)}`;

    /*
     * An item with no COMPLETED span has no measured average, and printing
     * `describeDays(0)` claimed it "lasts 0 days" — a statement that is not
     * merely imprecise but false. A single refill can still project a date from
     * the user's own estimate, so the countdown stays and only the average is
     * withheld.
     */
    if (stats.averageDays === null) return when.charAt(0).toUpperCase() + when.slice(1);

    const soft = due.provisional ? 'roughly ' : '';
    return `Lasts ${soft}${describeDays(Math.round(stats.averageDays))} · ${when}`;
  }

  return `On this one ${describeDays(stats.daysOnCurrent ?? 0)}`;
}
