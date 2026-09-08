import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Divider, Label, Row, Surface, Text } from '~/shared/components/ui';
import { formatMoney } from '~/shared/lib/money';
import {
  averageFraction,
  budgetFraction,
  historyBars,
  historySummary,
  type MonthlySpend,
} from '~/features/budget/logic/spendHistory';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** How tall the plot area is. Enough to compare, small enough to sit under a form. */
const PLOT_HEIGHT = 96;

/**
 * The chart's own three-colour scale, softer than the theme's semantic colours.
 *
 * `colors.danger` (#DC2626) is an alert red — right for a destructive button,
 * far too loud across a dozen bars, where it reads as an emergency rather than
 * "a bit above average". These are muted, similar in weight to each other so no
 * one state shouts over the others, and distinguishable for the common forms of
 * colour blindness by lightness as well as hue.
 *
 * Deliberately local rather than added to the theme: they exist to be compared
 * with each other inside this chart, not to signal status anywhere else.
 */
const SCALE = {
  above: { light: '#C0453F', dark: '#A83A35' },
  about: { light: '#B4801C', dark: '#9A6C15' },
  below: { light: '#2F7D57', dark: '#28684A' },
} as const;

/**
 * Width of one month's column.
 *
 * Fixed rather than shared out across the available space, because dividing a
 * phone's width by a year gives ~25pt columns — too narrow for the figures the
 * chart exists to show, which then truncate to "10....". At a fixed width the
 * chart scrolls instead, and every bar stays readable however long the history
 * grows.
 */
const BAR_WIDTH = 58;

/** Roughly how many columns fit on a phone, used to clamp the arrow stepping. */
const VISIBLE_BARS = 5;

/** One column plus its gap — the distance a single arrow tap scrolls. */
const STEP = BAR_WIDTH + 4;

/**
 * A bill's month-by-month spend, as a small bar chart.
 *
 * ## Why bars, and why relative to the peak
 *
 * The question a recurring bill actually raises is "is this month normal?", and
 * that is a comparison between months — which is what bars are for. Heights are
 * scaled to the TALLEST month rather than to the budget, so an unusual month
 * stands out as the outlier it is; scaling to the budget would push every bar
 * to the ceiling the moment one month overran.
 *
 * The budget is a separate dashed line across the plot. That keeps two
 * different facts visually separate — what you spent, and what you meant to —
 * instead of collapsing both into one bar height.
 *
 * ## Why it can render nothing
 *
 * With one month of history there is no comparison to draw, and a lone bar
 * invites the eye to read a trend that does not exist. `historyBars` returns an
 * empty list below two months and this renders null, so a bill in its first
 * month simply looks finished rather than broken.
 */
export function SpendHistoryChart({
  months,
  budgetMinor,
  currentPeriod,
}: {
  months: readonly MonthlySpend[];
  budgetMinor?: number | null;
  /** The month being viewed, highlighted among the rest. */
  currentPeriod?: string;
}) {
  const { colors, space } = useTheme();

  const bars = historyBars(months, { budgetMinor, currentPeriod });
  if (bars.length === 0) return null;

  const budgetAt = budgetFraction(months, budgetMinor);
  const summary = historySummary(months);
  const averageAt = averageFraction(months);
  /** More months than fit on a phone at a readable bar width. */
  const scrollable = bars.length > VISIBLE_BARS;

  /*
   * Stepping the chart one month per tap.
   *
   * `offset` counts bars from the left rather than pixels, so the arrows move
   * by exactly one column whatever the history's length, and the disabled
   * states know when there is genuinely nothing further to show.
   */
  const scroller = useRef<ScrollView>(null);
  const [offset, setOffset] = useState(Math.max(bars.length - VISIBLE_BARS, 0));
  const maxOffset = Math.max(bars.length - VISIBLE_BARS, 0);

  const step = (direction: 1 | -1) => {
    const next = Math.min(Math.max(offset + direction, 0), maxOffset);
    setOffset(next);
    scroller.current?.scrollTo({ x: next * STEP, animated: true });
  };

  return (
    <View style={{ gap: space.sm }}>
      {/* Just the heading. The month-on-month figure that sat here is already
          printed inside the current bar, and the AVERAGE row below gives the
          baseline — a third restatement in red read as an alert. */}
      <Label>LAST {bars.length} MONTHS</Label>

      <Surface>
        <Row gap={space.xs} align="center">
        {/* Step one month at a time. A chart that only free-scrolls hides how
            far back it goes; a tap that always advances exactly one bar makes
            the history walkable rather than something to swipe at. */}
        {scrollable ? (
          <Pressable
            onPress={() => step(-1)}
            disabled={offset <= 0}
            accessibilityRole="button"
            accessibilityLabel="Earlier months"
            hitSlop={8}
            style={{ opacity: offset <= 0 ? 0.25 : 1 }}
          >
            <Ionicons name="chevron-back" size={18} color={colors.inkMuted} />
          </Pressable>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          /* Opens showing the LATEST month, which is the one being asked about;
             older months are a scroll back through time. */
          contentContainerStyle={{ flexDirection: 'column' }}
          ref={scroller}
          onLayout={() => scroller.current?.scrollToEnd({ animated: false })}
          onScroll={(event) =>
            setOffset(Math.round(event.nativeEvent.contentOffset.x / STEP))
          }
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
        <View
          style={{
            height: PLOT_HEIGHT,
            position: 'relative',
            justifyContent: 'flex-end',
            /* Sized to the bars, so the reference lines below (left:0/right:0)
               span the whole scrolled history rather than only the viewport. */
            width: bars.length * BAR_WIDTH + (bars.length - 1) * space.xs,
          }}
        >
          {/* The AVERAGE, drawn across the plot so "is this month normal?" is
              answered by looking at the bars rather than by reading a figure
              elsewhere and holding it in mind. */}
          {averageAt !== null ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: averageAt * PLOT_HEIGHT,
                /* Above the bars. They are opaque, so a line drawn behind them
                   is invisible exactly where it matters — crossing a bar is how
                   you see which side of the average that month fell. */
                zIndex: 2,
                borderTopWidth: 1,
                borderTopColor: colors.inkMuted,
                borderStyle: 'dashed',
                opacity: 0.55,
              }}
            >
              {/* Labelled in place, so the line does not depend on the legend
                  below to be identifiable. */}
              <Text
                variant="caption"
                tone="muted"
                style={{ fontSize: 9, marginTop: -12, marginLeft: 2 }}
              >
                avg
              </Text>
            </View>
          ) : null}

          {/* The budget line, drawn behind the bars so it never hides one. */}
          {budgetAt !== null ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: budgetAt * PLOT_HEIGHT,
                borderTopWidth: 1,
                borderTopColor: colors.inkMuted,
                borderStyle: 'dashed',
                opacity: 0.6,
              }}
            />
          ) : null}

          {/* `align="stretch"` so each column fills the plot height; the bar
              inside then sits on the floor at its own height. With flex-end the
              column shrank to fit the bar and every bar drew the same size. */}
          <Row gap={space.xs} align="stretch" style={{ height: '100%' }}>
            {bars.map((bar) => (
              <View key={bar.period} style={{ width: BAR_WIDTH, justifyContent: 'flex-end' }}>
                {/* The figure sits ON the chart, so a bar's height never has to
                    be converted to money by eye — which is the whole reason to
                    look at a bill's history in the first place. */}
                {/* The month's own figure, above its bar. Compact so a year of
                    them fits: "9.1K" rather than "LKR 9,100". */}
                <Text
                  variant="caption"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={{
                    textAlign: 'center',
                    marginBottom: 3,
                    fontSize: 12,
                    fontWeight: '700',
                    // Full ink: these are the chart's primary figures, and at
                    // muted grey they receded behind the labels beneath them.
                    color: colors.ink,
                  }}
                >
                  {formatMoney(bar.totalMinor, { compact: true, showCurrency: false })}
                </Text>
                <View
                  accessibilityLabel={`${bar.label}, ${formatMoney(bar.totalMinor)}`}
                  style={{
                    /* The delta sits toward the BOTTOM of the bar, clear of
                       the month's own total printed just above the bar's top
                       edge — at the top the two figures crowded each other. */
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    paddingBottom: 6,
                    /* A floor of 2px so a month that cost almost nothing is
                       still visibly a month, not a gap in the chart. */
                    height: Math.max(bar.fraction * PLOT_HEIGHT, 2),
                    borderRadius: 4,
                    /* Coloured against the AVERAGE, which is the comparison
                       the chart is actually making: red above what this bill
                       usually costs, amber around it, green below. Colouring by
                       budget instead put a whole year in red on a line that was
                       simply budgeted low, saying nothing about any one month.

                       Full opacity throughout — the earlier pale treatment used
                       `surfaceSunken` (#EEF2F6), near enough to white that a
                       tall bar read as shorter than a solid one beside it. */
                    backgroundColor: SCALE[bar.vsAverage].light,
                    /* No dimming: fading a past month faded the figure printed
                       on it too. The current month is marked by its outline
                       instead, which costs the text nothing. */
                    /* The current month is ringed in a DARKER SHADE OF ITS OWN
                       colour, not black. Black read as an error state against
                       these fills; this marks "you are here" while staying part
                       of the same scale.

                       An outline rather than the dimming used before, because
                       fading a bar fades the figure printed inside it too. */
                    borderWidth: bar.current ? 2 : 0,
                    borderColor: SCALE[bar.vsAverage].dark,
                  }}
                >
                  {/* The month-on-month CHANGE, printed inside the bar it
                      belongs to — the axis below stays a clean row of month
                      names instead of carrying a second row of figures. Hidden
                      on a bar too short to hold text without overflowing it. */}
                  {bar.changeMinor !== null && bar.fraction > 0.25 ? (
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        // White on the solid fills, so it reads on danger and
                        // accent alike; the pale past-month bars take ink.
                        // The fills are deep enough that white clears WCAG AA
                        // against all three; the earlier pastels did not, which
                        // is why the figures inside the bars were hard to read.
                        color: '#FFFFFF',
                      }}
                    >
                      {bar.changeMinor > 0 ? '+' : bar.changeMinor < 0 ? '−' : ''}
                      {formatMoney(Math.abs(bar.changeMinor), {
                        compact: true,
                        showCurrency: false,
                      })}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </Row>
        </View>

        <Row gap={space.xs} style={{ marginTop: space.xs }} align="flex-start">
          {bars.map((bar) => (
            <View key={bar.period} style={{ width: BAR_WIDTH, alignItems: 'center' }}>
              <Text
                variant="caption"
                numberOfLines={1}
                style={{
                  fontSize: 12,
                  fontWeight: bar.current ? '700' : '600',
                  color: bar.current ? colors.ink : colors.inkSecondary,
                }}
              >
                {bar.label}
              </Text>
              {/* Movement since the month before, so the direction of travel is
                  legible bar by bar rather than only in the total. */}

            </View>
          ))}
        </Row>
        </ScrollView>

        {scrollable ? (
          <Pressable
            onPress={() => step(1)}
            disabled={offset >= maxOffset}
            accessibilityRole="button"
            accessibilityLabel="Later months"
            hitSlop={8}
            style={{ opacity: offset >= maxOffset ? 0.25 : 1 }}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
          </Pressable>
        ) : null}
        </Row>

        {/* Three words against three swatches, centred. The colours are
            relative to the average, and the "avg" line in the plot says what
            they are relative TO — so the legend need not repeat it. */}
        <Row gap={space.md} justify="center" style={{ marginTop: space.sm }}>
          {(
            [
              ['above', 'Higher'],
              ['about', 'Typical'],
              ['below', 'Lower'],
            ] as const
          ).map(([key, label]) => (
            <Row key={key} gap={4} align="center">
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  backgroundColor: SCALE[key].light,
                }}
              />
              <Text variant="caption" tone="muted">
                {label}
              </Text>
            </Row>
          ))}
        </Row>

        {/* Breathing room on BOTH sides, so the rule separates the legend from
            the figures rather than sitting tight against one of them. */}
        <Divider style={{ marginTop: space.lg, marginBottom: space.md }} />

        {/* The three figures worth knowing about a recurring bill: what it
            usually costs, and the range it moves between. Plain words — the
            earlier "DEAREST"/"CHEAPEST" pair read as shop language rather than
            as the two ends of this bill's own range. */}
        {summary ? (
          <Row justify="space-between" style={{ marginTop: space.sm }}>
            <View>
              <Label>AVERAGE</Label>
              <Text variant="small" style={{ fontWeight: '700' }}>
                {formatMoney(summary.averageMinor)}
              </Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Label>LOWEST</Label>
              <Text variant="small" color={SCALE.below.light} style={{ fontWeight: '700' }}>
                {formatMoney(summary.lowMinor)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Label>HIGHEST</Label>
              <Text variant="small" color={SCALE.above.light} style={{ fontWeight: '700' }}>
                {formatMoney(summary.highMinor)}
              </Text>
            </View>
          </Row>
        ) : null}
      </Surface>

    </View>
  );
}
