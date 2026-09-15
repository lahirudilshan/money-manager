import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import {
  Empty,
  GradientButton,
  GradientCard,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import {
  describeDays,
  nextDue,
  priceHistory,
  refillComparisons,
  refillRunway,
  refillSpans,
  refillStats,
  refillStatus,
  TRACKER_COLOR,
  TRACKER_COLOR_SOFT,
  type Refill as RefillLike,
} from '~/features/refills/logic/refills';
import { refillRepo } from '~/db/repositories/trackers';
import { formatMoney } from '~/shared/lib/money';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * One item's whole story: when it runs out, how long each one lasted, and what
 * the price has done.
 *
 * Ordered by what the user came for. The projection is the headline because
 * "when do I need to buy another" is the live question; the charts underneath
 * answer "is this getting worse", which is the one they did not know to ask.
 */
export default function TrackedItemDetail() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const items = useAppStore((s) => s.trackedItems);
  const deleteRefill = useAppStore((s) => s.deleteRefill);

  const item = items.find((candidate) => candidate.id === params.id);

  /*
   * Re-read whenever the item list changes. Every mutation goes through
   * `refreshMiniAppData`, which replaces `trackedItems`, so this is the signal
   * that a refill was added or removed.
   */
  const refills = useMemo<RefillLike[]>(() => {
    if (!item) return [];
    return refillRepo.forItem(item.id).map((row) => ({
      id: row.id,
      filledOn: row.filledOn,
      priceMinor: row.priceMinor,
      note: row.note,
    }));
  }, [item, items]);

  const now = new Date();
  const stats = useMemo(() => refillStats(refills, now), [refills]);
  const spans = useMemo(() => refillSpans(refills), [refills]);
  const prices = useMemo(() => priceHistory(refills), [refills]);
  const due = useMemo(() => (item ? nextDue(refills, item, now) : null), [refills, item]);
  const status = refillStatus(due);
  /** Each entry against the one before it — see `refillComparisons`. */
  const comparisons = useMemo(() => refillComparisons(refills), [refills]);
  /** Four-band countdown, so the hero can be green / amber / red. */
  const runway = refillRunway(due);

  /*
   * What the price chart alone could say: the direction of travel. Needs two
   * priced refills to be a trend rather than a number.
   */
  const priceTrend = useMemo(() => {
    if (prices.length < 2) return null;
    const first = prices[0].priceMinor;
    const last = prices[prices.length - 1].priceMinor;
    const diff = last - first;
    if (diff === 0) return 'The price has not changed since the first one.';
    const dir = diff > 0 ? 'up' : 'down';
    return `The price is ${dir} ${formatMoney(Math.abs(diff))} since the first one.`;
  }, [prices]);

  if (!item) {
    return (
      <Screen title="Not found">
        <Empty
          icon="alert-circle-outline"
          title="Item not found"
          message="It may have been deleted."
        />
      </Screen>
    );
  }

  /** Newest first, which is the order the history reads in. */
  const ordered = [...refills].sort((a, b) => b.filledOn.getTime() - a.filledOn.getTime());

  return (
    <Screen
      title={item.name}
      onBack={() => router.back()}
      action={{
        icon: 'create-outline',
        label: 'Edit',
        onPress: () => router.push(`/mini/trackers/item?id=${item.id}`),
      }}
      /*
        The primary action is PINNED, like every other add-on screen.

        It was a tinted card in the scroll flow, which made it one more panel to
        read past rather than the thing to press — and on a long history it
        scrolled away entirely. `Screen`'s footer is where "Log a fill-up" lives
        in the fuel add-on; the same job deserves the same place and the same
        GradientButton.
      */
      footer={
        <GradientButton
          label="I replaced it"
          icon="add"
          onPress={() => router.push(`/mini/trackers/refill?itemId=${item.id}`)}
        />
      }
    >
      {/*
        ONE answer, stated as an instruction.

        The page used to open with a status word, a duration, a date and three
        statistics — four things competing before the reader knew which
        mattered. What a person actually comes here to learn is "do I need to
        buy one, and when", so that is the whole card and nothing shares it.
      */}
      <GradientCard gradient={RUNWAY_GRADIENT[runway ?? 'unknown']}>
        {/*
          The countdown and the facts SHARE the card.

          The hero was three short lines against a wide empty field, while the
          numbers that explain it sat in grey text underneath. Putting the
          supporting figures in the card — on their own row, divided off — uses
          the width the gradient was already paying for and keeps the answer and
          its evidence in one glance.
        */}
        <Row align="flex-end" gap={space.md}>
          <View style={{ flex: 1 }}>
            <Text variant="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {leadIn(due, stats)}
            </Text>
            <Text variant="display" style={{ color: '#fff', marginTop: 2 }}>
              {headline(due, stats)}
            </Text>
            {whenLine(due) ? (
              <Text variant="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {whenLine(due)}
              </Text>
            ) : null}
          </View>

          {/*
            The unit, when the item has one — "12.5kg" tells you WHICH cylinder
            this is, which the title alone does not once you track two sizes.
          */}
          {item.unitLabel ? (
            <View
              style={{
                paddingVertical: 3,
                paddingHorizontal: space.sm,
                borderRadius: 999,
                backgroundColor: 'rgba(255,255,255,0.18)',
              }}
            >
              <Text variant="caption" style={{ color: '#fff', fontWeight: '700' }}>
                {item.unitLabel}
              </Text>
            </View>
          ) : null}
        </Row>

        {/*
          Two facts on ONE row, and "per day" is gone.

          A cost-per-day on a gas cylinder is a number nobody acts on — you
          cannot buy a third of a cylinder — so it was arithmetic for its own
          sake taking a third of the card. What remains is what a person
          actually checks: how long one lasts, and what one costs.
        */}
        {stats.lastFilledOn && stats.averageDays ? (
          <>
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: 'rgba(255,255,255,0.25)',
                marginVertical: space.sm,
              }}
            />
            <Row align="center" gap={space.md}>
              <HeroFact
                label="USUALLY LASTS"
                value={describeDays(Math.round(stats.averageDays))}
              />
              {/*
                The AVERAGE price, not the last one paid.

                The card states the item's norm on both axes — how long one
                lasts and what one costs — so every row below can be read
                against it. "Last paid" repeated a figure already sitting at the
                top of the list.
              */}
              <HeroFact
                label="USUALLY COSTS"
                value={stats.averagePriceMinor ? formatMoney(stats.averagePriceMinor) : '—'}
                align="flex-end"
              />
            </Row>
          </>
        ) : null}
      </GradientCard>

      <View style={{ gap: space.sm }}>
        <Text variant="bodyStrong">Every one you bought</Text>

        {ordered.length === 0 ? (
          <Empty
            icon="repeat-outline"
            title="Nothing logged yet"
            message="Log this one now, and the next when you replace it. The gap between them is what this add-on measures."
            actionLabel="Log the first one"
            onAction={() => router.push(`/mini/trackers/refill?itemId=${item.id}`)}
          />
        ) : (
          <Surface padded={false} style={{ paddingVertical: space.sm }}>
            {ordered.map((refill, index) => {
              const span = spans.find((candidate) => candidate.id === refill.id);
              const cmp = comparisons.get(refill.id);
              const current = index === 0;
              const last = index === ordered.length - 1;

              return (
                <Pressable
                  key={refill.id}
                  onPress={() =>
                    router.push(`/mini/trackers/refill?itemId=${item.id}&id=${refill.id}`)
                  }
                  onLongPress={() => confirmDelete(refill, deleteRefill)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    paddingHorizontal: space.md,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  {/*
                    The rail: a dot per entry, joined by a line.

                    Rows separated by dividers read as a table of unrelated
                    lines. These are one object replaced over and over, and the
                    connecting line says so — the eye follows it down and sees a
                    sequence rather than four records. The line is drawn only
                    BETWEEN dots (never below the last), so the timeline ends
                    rather than trailing off.
                  */}
                  <View style={{ width: 22, alignItems: 'center' }}>
                    <View
                      style={{
                        width: current ? 13 : 9,
                        height: current ? 13 : 9,
                        borderRadius: 7,
                        marginTop: space.md,
                        /*
                         * The DOT carries the verdict as well as the text.
                         *
                         * It was flat grey on every past entry, so scanning the
                         * rail told you nothing — the colour was only in the
                         * chip further right, which the eye reaches last. Now a
                         * short run shows a red dot and a long one green, and
                         * the timeline is readable at a glance. Unremarkable
                         * runs stay grey, so colour still means something.
                         */
                        /*
                         * The dot is graded against the item's AVERAGE, not the
                         * previous entry: "was this a good one?" is asked of the
                         * norm. Two mediocre runs in a row read `same` against
                         * each other while both sit plainly below it.
                         *
                         * The live row is GREEN rather than the add-on's violet
                         * — violet said "this is the tracker", which is not news
                         * on the tracker's own screen. Green says the thing
                         * still has life in it, which is.
                         */
                        backgroundColor: current
                          ? colors.completed
                          : AVERAGE_COLOR(colors, cmp?.vsAverage),
                      }}
                    />
                    {!last ? (
                      <View style={{ flex: 1, width: 2, backgroundColor: colors.hairline }} />
                    ) : null}
                  </View>

                  <View
                    style={{
                      flex: 1,
                      paddingLeft: space.sm,
                      paddingTop: space.sm,
                      paddingBottom: last ? space.sm : space.md,
                    }}
                  >
                    {/*
                      DURATION leads, price trails.

                      How long it lasted is what the reader came for and what
                      the whole add-on measures, so it is the bold line; the
                      date it was bought is the supporting detail underneath.
                      That ordering was reversed before — the date was bold and
                      the measurement was grey.
                    */}
                    <Row align="center" gap={space.sm}>
                      <Text
                        variant="bodyStrong"
                        style={{ flex: 1 }}
                        color={
                          current ? colors.completed : AVERAGE_COLOR(colors, cmp?.vsAverage)
                        }
                      >
                        {span
                          ? describeDays(span.days)
                          : current
                            ? `${describeDays(stats.daysOnCurrent ?? 0)} so far`
                            : 'Still counting'}
                      </Text>
                      <Text variant="bodyStrong">
                        {refill.priceMinor != null ? formatMoney(refill.priceMinor) : '—'}
                      </Text>
                    </Row>

                    <Row align="center" gap={space.xs}>
                      <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                        Bought{' '}
                        {refill.filledOn.toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </Text>
                      {/* The one row that is not finished yet says so. */}
                      {current ? (
                        <Text
                          variant="caption"
                          color={colors.completed}
                          style={{ fontWeight: '700' }}
                        >
                          IN USE
                        </Text>
                      ) : null}
                    </Row>

                    {/*
                      The comparison line: this one against the one before it.
                      
                      Only rendered when there IS a previous entry to compare
                      with, so the oldest row carries no phantom baseline. The
                      arrow and the colour say the same thing two ways — colour
                      alone would be invisible to a colour-blind reader, and on
                      a duration "longer is better" is not something an arrow
                      direction can be assumed to convey on its own.
                    */}
                    {cmp &&
                    ((cmp.daysVsAverage !== null && cmp.vsAverage !== 'about') ||
                      (cmp.priceVsAverage !== null && cmp.priceVsAverage !== 0)) ? (
                      <Row align="center" gap={space.xs} style={{ marginTop: 5 }}>
                        {/*
                          Both chips measure against the item's AVERAGE, not the
                          row above.

                          "12 days longer than the previous one" answered a
                          question nobody asked — the previous one might itself
                          have been unusual. Against the norm each row says
                          plainly whether it was a good one, and the numbers on
                          every row are then comparable with each other.
                        */}
                        {/*
                          Nothing is shown for a row that sits AT the average.

                          An "— average" chip appeared on every ordinary row and
                          told the reader nothing they could not get from the
                          card above, which already states the norm. Silence is
                          the correct rendering of "unremarkable": the chips that
                          do appear then all mean something.
                        */}
                        {cmp.daysVsAverage !== null && cmp.vsAverage !== 'about' ? (
                          <DeltaChip
                            tone={cmp.vsAverage === 'above' ? 'good' : 'bad'}
                            icon={cmp.vsAverage === 'above' ? 'arrow-up' : 'arrow-down'}
                            label={`${describeDays(Math.abs(cmp.daysVsAverage))} ${
                              cmp.daysVsAverage > 0 ? 'more' : 'less'
                            }`}
                          />
                        ) : null}

                        {/*
                          Price is judged the OPPOSITE way round: paying above
                          the norm is bad, below it good — the reverse of
                          duration, where longer is better.
                        */}
                        {cmp.priceVsAverage !== null && cmp.priceVsAverage !== 0 ? (
                          <DeltaChip
                            tone={cmp.priceVsAverage > 0 ? 'bad' : 'good'}
                            icon={cmp.priceVsAverage > 0 ? 'trending-up' : 'trending-down'}
                            label={formatMoney(Math.abs(cmp.priceVsAverage))}
                          />
                        ) : null}
                      </Row>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </Surface>
        )}

        {/* The only thing the price chart said that the list does not. */}
        {priceTrend ? (
          <Text variant="caption" tone="muted" style={{ paddingHorizontal: 2 }}>
            {priceTrend}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

function confirmDelete(refill: RefillLike, remove: (id: string) => void) {
  Alert.alert(
    'Delete this refill?',
    'It will stop counting towards how long this item lasts. Any expense it created is removed too.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(refill.id) },
    ],
  );
}

/** The one word the hero leads with, so the colour is never the only signal. */
const STATUS_LABEL: Record<string, string> = {
  overdue: 'OVERDUE',
  'due-soon': 'DUE SOON',
  fresh: 'ON TRACK',
  unknown: 'IN USE',
};

const STATUS_ICON: Record<string, 'alert-circle' | 'time' | 'checkmark-circle' | 'ellipse'> = {
  overdue: 'alert-circle',
  'due-soon': 'time',
  fresh: 'checkmark-circle',
  unknown: 'ellipse',
};

/*
 * The countdown as a traffic light, over four bands rather than two.
 *
 * Green while there is comfortable room, amber as it approaches, red inside the
 * last week, deep red once it has run out. The middle band is the point: with
 * only "soon or not" every item sat green until it abruptly turned red, which
 * is precisely when a warning is too late to act on.
 *
 * `unknown` — no projection yet — is deliberately grey rather than green. The
 * app does not know, and a colour that means "fine" would be a claim it cannot
 * support.
 */
/**
 * One supporting figure inside the gradient hero.
 *
 * Its own component because three of them share a row and must align: the
 * label sets the column, the value sits under it, and `align` is the only
 * thing that differs between left, centre and right.
 */
function HeroFact({
  label,
  value,
  align = 'flex-start',
}: {
  label: string;
  value: string;
  align?: 'flex-start' | 'center' | 'flex-end';
}) {
  return (
    <View style={{ flex: 1, alignItems: align, gap: 2 }}>
      <Text variant="caption" style={{ color: 'rgba(255,255,255,0.7)', fontWeight: '700' }}>
        {label}
      </Text>
      <Text variant="bodyStrong" style={{ color: '#fff' }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * One delta, as a tinted chip.
 *
 * `flat` is deliberately grey-on-grey: a change inside the noise band is not
 * news, and giving it a colour of its own would put three competing tints on a
 * row where at most two carry information.
 */
function DeltaChip({
  tone,
  icon,
  label,
}: {
  tone: 'good' | 'bad' | 'flat';
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  const { colors, space } = useTheme();

  const fg =
    tone === 'good' ? colors.completed : tone === 'bad' ? colors.danger : colors.inkMuted;
  const bg =
    tone === 'good'
      ? colors.completedSoft
      : tone === 'bad'
        ? colors.dangerSoft
        : colors.surfaceSunken;

  return (
    <Row
      align="center"
      gap={3}
      style={{
        paddingVertical: 2,
        paddingHorizontal: space.sm,
        borderRadius: 999,
        backgroundColor: bg,
      }}
    >
      <Ionicons name={icon} size={10} color={fg} />
      <Text variant="caption" color={fg} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Row>
  );
}

/**
 * A span's colour, graded against the item's own average.
 *
 * Green above, amber about, red below — the three-band traffic light the user
 * asked for, and the only place on this screen where colour answers "was this
 * one good?". Amber rather than grey for the middle: "average" is a real
 * finding here, not an absence of one, and a row that simply went uncoloured
 * read as data still loading.
 */
function AVERAGE_COLOR(
  colors: ReturnType<typeof useTheme>['colors'],
  vsAverage: 'above' | 'about' | 'below' | undefined,
): string | undefined {
  if (vsAverage === 'above') return colors.completed;
  if (vsAverage === 'below') return colors.danger;
  if (vsAverage === 'about') return colors.pending;
  return undefined;
}

/**
 * The verdict's colour, or undefined to leave the text at its default.
 *
 * `same` deliberately returns undefined rather than a grey: a row that matched
 * the previous one is unremarkable, and colouring it at all would make three
 * coloured states compete where only two carry news.
 */
function VERDICT_COLOR(
  colors: ReturnType<typeof useTheme>['colors'],
  verdict: 'good' | 'bad' | 'same' | null | undefined,
): string | undefined {
  if (verdict === 'good') return colors.completed;
  if (verdict === 'bad') return colors.danger;
  return undefined;
}

const RUNWAY_GRADIENT: Record<string, readonly [string, string]> = {
  /*
   * A cool-to-warm progression with NO orange in it.
   *
   * Green -> teal -> rose -> red. The middle band was amber, which on a
   * full-bleed hero reads as the same alarm as the red one: the two were
   * separated only by saturation, so "three weeks left" and "ran out" looked
   * alike at a glance. Teal is unmistakably not-a-warning, and the jump to rose
   * is then a real change of state rather than a darker shade of the same idea.
   */
  plenty: ['#047857', '#059669'],
  'getting-close': ['#0E7490', '#0891B2'],
  'nearly-out': ['#9F1239', '#BE123C'],
  out: ['#7F1D1D', '#B91C1C'],
  unknown: ['#475569', '#64748B'],
};

/** The line above the number: what the reader should DO, or the state. */
function leadIn(
  due: ReturnType<typeof nextDue>,
  stats: ReturnType<typeof refillStats>,
): string {
  if (!stats.lastFilledOn) return 'Not started';
  if (!due) return 'Using this one for';
  return due.inDays < 0 ? 'Should have been replaced' : 'Buy a new one in';
}

/** The big number. Never a projection the evidence cannot carry. */
function headline(
  due: ReturnType<typeof nextDue>,
  stats: ReturnType<typeof refillStats>,
): string {
  if (!stats.lastFilledOn) return 'No refills yet';
  if (!due) return describeDays(stats.daysOnCurrent ?? 0);
  if (due.inDays < 0) return `${describeDays(-due.inDays)} ago`;
  return describeDays(due.inDays);
}

/**
 * The date under the number, and how much to trust it.
 *
 * Null when there is no projection at all — the hero then shows only how long
 * the current one has been running, which needs no qualifier.
 */
function whenLine(due: ReturnType<typeof nextDue>): string | null {
  if (!due) return null;

  const when = due.on.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  /*
   * A date from ONE span and a date from six look identical, so the basis is
   * always stated. This is the honesty rule the whole add-on rests on.
   */
  if (due.basis === 'expected') return `around ${when} — your estimate, not measured yet`;
  if (due.provisional) return `around ${when} — rough, from one refill so far`;
  return `around ${when}`;
}
