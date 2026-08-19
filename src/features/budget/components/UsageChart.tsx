import React from 'react';
import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { Row, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Metered usage per period, as bars.
 *
 * A utility statement states one month's consumption — "189 Units" — and that
 * figure answers nothing alone. The only question the user actually has when a
 * bill arrives is whether it is *normal*, and that is a comparison: 189 units
 * is reassuring after 210 and alarming after 120. So the reading is kept from
 * every statement (see `meterReadings`) and the series is drawn here.
 *
 * ## Why bars rather than the line HealthChart uses
 *
 * Consumption is a QUANTITY CONSUMED per discrete period, not a continuous
 * quantity sampled at moments. A line between two months implies the readings
 * in between, and there are none — the meter was read twice, and what happened
 * between the readings is precisely what the bill does not say. Bars also give
 * each month its own footprint to compare against its neighbours, which is the
 * comparison being made.
 *
 * Zero-based on purpose. A usage chart cropped to its own range exaggerates
 * every wobble into a cliff — the classic misleading-axis mistake — and on a
 * bill that is the difference between "slightly more than usual" and panic.
 */
export interface UsagePoint {
  /** "YYYY-MM" the usage belongs to. */
  period: string;
  /** Units consumed, as stated by the biller. */
  units: number;
}

/** "2026-08" → "Aug". The axis is a series of months, so the year is noise. */
function monthLabel(period: string): string {
  const month = Number(period.slice(5, 7));
  return (
    ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
      month
    ] ?? ''
  );
}

export function UsageChart({
  points,
  height = 120,
  /** How many periods to show. Older ones are dropped from the left. */
  limit = 12,
  unitLabel = 'units',
}: {
  points: readonly UsagePoint[];
  height?: number;
  limit?: number;
  unitLabel?: string;
}) {
  const { colors, space, radius } = useTheme();

  const shown = points.slice(-limit);

  /*
   * One reading is not a chart.
   *
   * A single bar has nothing to be compared against, which is the entire
   * purpose here — it would show the user a graph that tells them strictly less
   * than the number already on the bill. Matches `HealthChart`'s handling of
   * the same situation, so the two read as one idea.
   */
  if (shown.length < 2) {
    return (
      <View
        style={{
          height,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceSunken,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <Text variant="caption" tone="muted">
          {shown.length === 0 ? 'No readings yet' : 'First reading recorded'}
        </Text>
        <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
          Next month's bill will start the comparison
        </Text>
      </View>
    );
  }

  // A 0–100 viewBox with `preserveAspectRatio="none"`, so the chart stretches to
  // whatever width the card gives it without measuring layout first — the same
  // approach HealthChart takes.
  const W = 100;
  const H = 100;

  const max = Math.max(...shown.map((p) => p.units));
  // A meter that recorded nothing all year would divide by zero.
  const ceiling = max > 0 ? max : 1;

  const slot = W / shown.length;
  // A gap either side of each bar, so neighbours read as separate months.
  const barWidth = slot * 0.62;
  const inset = (slot - barWidth) / 2;

  const latest = shown[shown.length - 1];
  const previous = shown[shown.length - 2];
  const delta = latest.units - previous.units;

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ height }}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {shown.map((point, index) => {
            const barHeight = (point.units / ceiling) * H;
            // The newest month is the one being reviewed, so it carries the
            // accent and the rest recede — the chart is read newest-first.
            const isLatest = index === shown.length - 1;
            return (
              <Rect
                key={point.period}
                x={index * slot + inset}
                // SVG y grows downward, so a bar starts where it stops.
                y={H - barHeight}
                width={barWidth}
                height={barHeight}
                fill={isLatest ? colors.accent : colors.accentSoft}
                // Scaled with the viewBox rather than in pixels; small enough
                // that the horizontal stretch cannot visibly distort it.
                rx={1}
              />
            );
          })}
        </Svg>
      </View>

      {/* The month axis, laid out with the same flex weighting as the bars so
          each label sits under its own column. `gap={0}` is required, not
          cosmetic: Row defaults to a `space.md` gap, which would push every
          label off the bar it names. */}
      <Row gap={0}>
        {shown.map((point, index) => (
          <Text
            key={point.period}
            variant="caption"
            tone={index === shown.length - 1 ? 'secondary' : 'muted'}
            numberOfLines={1}
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 9,
              fontWeight: index === shown.length - 1 ? '700' : '500',
            }}
          >
            {monthLabel(point.period)}
          </Text>
        ))}
      </Row>

      {/* The comparison stated in words.
          The chart shows the shape; this says what it means, which is the
          question the user actually arrived with. Colour is never the only
          carrier — the sign and the word "more"/"less" say it too. */}
      <Row justify="space-between" align="center">
        <Text variant="caption" tone="muted">
          {latest.units} {unitLabel} this month
        </Text>
        {delta === 0 ? (
          <Text variant="caption" tone="muted">
            Same as last month
          </Text>
        ) : (
          <Text
            variant="caption"
            color={delta > 0 ? colors.danger : colors.completed}
            style={{ fontWeight: '700' }}
          >
            {delta > 0 ? '+' : ''}
            {delta} vs last month
          </Text>
        )}
      </Row>
    </View>
  );
}
