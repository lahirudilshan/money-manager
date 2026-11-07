import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Empty,
  Label,
  Row,
  Text,
} from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import {
  describeDays,
  nextDue,
  refillStats,
  refillStatus,
  suggestTrackerIcon,
  trackerColor,
  TRACKER_COLOR,
  type Refill as RefillLike,
  type RefillStatus,
} from '~/features/refills/logic/refills';
import { refillRepo } from '~/db/repositories/trackers';
import { useAppStore } from '~/store/useAppStore';
import { formatMoney } from '~/shared/lib/money';
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

                  <View style={{ gap: space.sm }}>
                    {group.map((row) => (
                      <TrackerCard
                        key={row.item.id}
                        row={row}
                        now={now}
                        onOpen={() => router.push(`/mini/trackers/detail?id=${row.item.id}`)}
                        onLog={() => router.push(`/mini/trackers/refill?itemId=${row.item.id}`)}
                      />
                    ))}
                  </View>
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

/** A small fact line: a coloured icon and the text. */
function Fact({
  icon,
  color,
  text,
  strong = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  text: string;
  strong?: boolean;
}) {
  const { space } = useTheme();
  return (
    <Row gap={space.sm} align="center">
      <Ionicons name={icon} size={14} color={color} />
      <Text
        variant="caption"
        tone={strong ? 'ink' : 'secondary'}
        style={{ flex: 1, fontWeight: strong ? '700' : '500' }}
        numberOfLines={1}
      >
        {text}
      </Text>
    </Row>
  );
}

/**
 * One tracked item, as a card: what it is, where the current one stands, and
 * what its history says.
 *
 * The old one-line row squeezed a countdown and a detail into a caption, so an
 * item said almost nothing at a glance — and an unstarted one said only
 * "nothing logged yet". The card gives each fact its place:
 *
 *   - name and size, with a status pill (word + icon, never colour alone);
 *   - a PROGRESS BAR for the current one: days in use against how long one
 *     usually lasts (measured), or the user's estimate until there is a
 *     measurement — the picture of "how far through this cylinder am I";
 *   - when the current one started, and when the next is due;
 *   - how long one lasts and what it costs, once known;
 *   - for an unstarted item, when it was added and a button to log the first
 *     one right here, since that one entry is what makes everything else work.
 */
function TrackerCard({
  row,
  now,
  onOpen,
  onLog,
}: {
  row: {
    item: { id: string; name: string; unitLabel: string | null; icon: string | null; expectedDays: number | null; archived: boolean; createdAt: Date };
    due: ReturnType<typeof nextDue>;
    status: RefillStatus;
    stats: ReturnType<typeof refillStats>;
  };
  now: Date;
  onOpen: () => void;
  onLog: () => void;
}) {
  const { colors, space, radius } = useTheme();
  const { item, due, status, stats } = row;
  const started = Boolean(stats.lastFilledOn);
  const itemIcon =
    item.icon && item.icon !== 'cube-outline'
      ? item.icon
      : (suggestTrackerIcon(item.name) ?? 'cube-outline');
  const itemColor = trackerColor(itemIcon, item.name);
  /** The countdown is a guess until it rests on several measured lifespans. */
  const estimated = Boolean(due && (due.basis === 'expected' || due.provisional));

  const tone =
    status === 'overdue'
      ? { fg: colors.danger, bg: colors.dangerSoft, icon: 'alert-circle' as const, label: 'OVERDUE' }
      : status === 'due-soon'
        ? { fg: colors.pending, bg: colors.pendingSoft, icon: 'time' as const, label: 'DUE SOON' }
        : status === 'fresh'
          ? { fg: colors.completed, bg: colors.completedSoft, icon: 'checkmark-circle' as const, label: 'GOOD' }
          : { fg: colors.inkSecondary, bg: colors.surfaceSunken, icon: 'ellipse-outline' as const, label: 'NOT STARTED' };

  /** How long one lasts: measured if known, else the user's estimate. */
  const lifetime = stats.averageDays ? Math.round(stats.averageDays) : item.expectedDays;
  const used = stats.daysOnCurrent ?? 0;
  const progress = started && lifetime ? Math.min(1, used / lifetime) : null;
  const daysSinceAdded = Math.max(0, Math.floor((now.getTime() - item.createdAt.getTime()) / 86_400_000));
  const shortDate = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${tone.label.toLowerCase()}`}
      style={({ pressed }) => ({
        padding: space.lg,
        gap: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
        opacity: item.archived ? 0.55 : 1,
      })}
    >
      <Row gap={space.md} align="center">
        {/* The item's own colour and icon; its status is the pill on the right. */}
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: `${itemColor}1F`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={itemIcon as never} size={20} color={itemColor} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.name}
          </Text>
          {item.unitLabel ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {item.unitLabel}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: space.sm,
            paddingVertical: 3,
            borderRadius: radius.pill,
            backgroundColor: tone.bg,
          }}
        >
          <Ionicons name={tone.icon} size={12} color={tone.fg} />
          <Text variant="label" color={tone.fg}>
            {tone.label}
          </Text>
        </View>
      </Row>

      {started ? (
        <>
          {/* How far through the current one. */}
          {progress !== null ? (
            <View style={{ gap: 6 }}>
              <View
                style={{
                  height: 8,
                  borderRadius: radius.pill,
                  backgroundColor: tone.bg,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${Math.max(4, progress * 100)}%`,
                    height: 8,
                    borderRadius: radius.pill,
                    backgroundColor: tone.fg,
                  }}
                />
              </View>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="caption" tone="secondary">
                  <Text variant="caption" style={{ fontWeight: '800' }}>{`Day ${used}`}</Text>
                  {` of ${stats.averageDays ? '' : 'about '}${lifetime}`}
                </Text>
                {/* The countdown as a tinted chip: the one number to act on. */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: space.sm,
                    paddingVertical: 2,
                    borderRadius: radius.pill,
                    backgroundColor: tone.bg,
                  }}
                >
                  <Ionicons
                    name={estimated ? 'help-circle-outline' : 'time-outline'}
                    size={12}
                    color={tone.fg}
                  />
                  <Text variant="caption" color={tone.fg} style={{ fontWeight: '800' }}>
                    {estimated ? `~${countdown(due)}` : countdown(due)}
                  </Text>
                  {/*
                    Says when the date is a guess. Until one has actually run
                    out, the countdown rests on the user's own estimate (or a
                    single lifespan) — it must not look as certain as one
                    measured over several.
                  */}
                  {estimated ? (
                    <Text variant="caption" color={tone.fg} style={{ fontSize: 10, opacity: 0.85 }}>
                      {due?.basis === 'expected' ? 'estimate' : 'rough'}
                    </Text>
                  ) : null}
                </View>
              </Row>
            </View>
          ) : (
            <Text variant="caption" tone="secondary">
              {`In use for ${describeDays(used)}`}
            </Text>
          )}

          {/* Each fact on its own line, with an icon — readable at a glance. */}
          <View style={{ gap: 6 }}>
            <Fact
              icon="play-circle-outline"
              color={TRACKER_COLOR}
              text={`Current one since ${shortDate(stats.lastFilledOn as Date)}`}
            />
            {due ? (
              <Fact
                icon="calendar-outline"
                color={tone.fg}
                text={`Next around ${shortDate(due.on)}`}
                strong
              />
            ) : null}
            {stats.averageDays ? (
              <Fact
                icon="hourglass-outline"
                color={colors.accent}
                text={`Usually lasts ${describeDays(Math.round(stats.averageDays))}`}
              />
            ) : null}
            {stats.averagePriceMinor ? (
              <Fact
                icon="pricetag-outline"
                color={colors.completed}
                text={`About ${formatMoney(stats.averagePriceMinor)} each · ${stats.spanCount + 1} bought`}
              />
            ) : null}
          </View>
        </>
      ) : (
        <Row gap={space.md} align="center">
          <View style={{ flex: 1, gap: 6 }}>
            <Fact
              icon="calendar-outline"
              color={TRACKER_COLOR}
              text={`Added ${daysSinceAdded === 0 ? 'today' : `${describeDays(daysSinceAdded)} ago`}`}
            />
            {item.expectedDays ? (
              <Fact
                icon="hourglass-outline"
                color={colors.accent}
                text={`Expected to last ${describeDays(item.expectedDays)}`}
              />
            ) : null}
          </View>
          <Pressable
            onPress={onLog}
            accessibilityRole="button"
            accessibilityLabel={`Log the first ${item.name}`}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: space.md,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: pressed ? colors.accentSoft : colors.surfaceSunken,
            })}
          >
            <Ionicons name="add" size={14} color={colors.accent} />
            <Text variant="caption" color={colors.accentInk} style={{ fontWeight: '700' }}>
              Log first refill
            </Text>
          </Pressable>
        </Row>
      )}
    </Pressable>
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
  key: 'now' | 'later' | 'unstarted';
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
    match: (status) => status === 'fresh',
  },
  /*
   * An item with no history is NOT "all good".
   *
   * `unknown` used to sit under ALL GOOD, so a tracker created months ago and
   * never logged reported itself as fine — the one state where the app knows
   * nothing read as the state where everything is well. On a real board a gas
   * cylinder added in September with zero refills sat there reassuringly, its
   * countdown column an unexplained "—".
   *
   * Its own section instead, last, phrased as the invitation it is: these
   * items need a first entry before any of this feature works for them.
   */
  {
    key: 'unstarted',
    title: 'NOT STARTED',
    match: (status) => status === 'unknown',
  },
];

const STATUS_COLOR: Record<RefillStatus, string> = {
  overdue: '#B91C1C',
  'due-soon': '#BE123C',
  fresh: '#059669',
  unknown: '#64748B',
};


/**
 * The right-hand countdown.
 *
 * "Today" and "Tomorrow" rather than `describeDays(0)`, which renders as
 * "0 days" and reads like a stalled counter instead of one that has arrived.
 */
function countdown(due: ReturnType<typeof nextDue>): string {
  // An em dash says "no value" where the honest answer is "nothing logged
  // yet" — and the second one tells the user what to do about it.
  if (!due) return 'Add first';
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
