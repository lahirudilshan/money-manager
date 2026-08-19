import React from 'react';
import { View } from 'react-native';
import Svg, { Line, Path, Polyline } from 'react-native-svg';
import { Row, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import type { TrendPoint } from '~/features/health/logic/health';

/**
 * A reading's history as a line, with the healthy band behind it.
 *
 * Recording a blood pressure every week only pays off if the shape of it is
 * visible — a column of numbers is a filing cabinet, a line is an answer. The
 * app already computed these trends (`core/health.ts`) and then showed them
 * nowhere, which made logging readings feel like data entry for its own sake.
 *
 * Drawn with `react-native-svg`, already a dependency for the bank logos, so
 * this costs no new package.
 *
 * ## Why a banded chart rather than a bare sparkline
 *
 * A line on its own says "this went up" but not "this is a problem". For blood
 * pressure or sugar the reference range IS the information — 140 means nothing
 * until you know normal ends at 130. So the healthy band is painted behind the
 * line and the axis is scaled to include it, which is what turns the chart from
 * decoration into something a person can act on.
 *
 * Deliberately NOT a diagnosis: the band is labelled as a typical range, and
 * nothing here colours a reading "bad". This is a record-keeping app, and
 * telling someone their reading is dangerous is a job for their doctor.
 */

/** A typical reference range, for the band drawn behind the line. */
export interface HealthyBand {
  low: number;
  high: number;
}

/**
 * Typical adult reference ranges, per metric.
 *
 * Only for the metrics where a single band is genuinely meaningful. Weight has
 * none (it depends on height), and neither does "other" — those charts render
 * without a band rather than inventing one.
 */
export const METRIC_BAND: Record<string, HealthyBand | undefined> = {
  // Systolic; the diastolic line is drawn against the same axis.
  blood_pressure: { low: 90, high: 120 },
  blood_sugar: { low: 70, high: 140 },
  heart_rate: { low: 60, high: 100 },
  temperature: { low: 36.1, high: 37.2 },
  oxygen: { low: 95, high: 100 },
  hba1c: { low: 4, high: 5.7 },
  cholesterol: { low: 0, high: 200 },
};

export function HealthChart({
  points,
  band,
  height = 128,
  color,
  /** Draw the second value too — blood pressure's diastolic line. */
  showSecondary = false,
}: {
  points: readonly TrendPoint[];
  band?: HealthyBand;
  height?: number;
  color?: string;
  showSecondary?: boolean;
}) {
  const { colors, space, radius } = useTheme();
  const tint = color ?? colors.accent;

  /*
   * One reading is not a chart.
   *
   * Two points make a line; one makes a dot that implies a trend it cannot
   * support. The caller shows the bare figure instead.
   */
  if (points.length < 2) {
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
          {points.length === 0 ? 'No readings yet' : 'One reading so far'}
        </Text>
        <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
          Add another to see the trend
        </Text>
      </View>
    );
  }

  // A 0–100 viewBox with `preserveAspectRatio="none"`, so the chart stretches
  // to whatever width the card gives it without measuring the layout first.
  const W = 100;
  const H = 100;
  const PAD = 8;

  const primary = points.map((point) => point.value);
  const secondary = showSecondary
    ? points.map((point) => point.valueSecondary).filter((v): v is number => v != null)
    : [];

  /*
   * The axis spans the readings AND the band.
   *
   * Scaling to the readings alone would push a band that sits entirely above or
   * below them off-canvas, losing exactly the context it was drawn for.
   */
  const candidates = [...primary, ...secondary, ...(band ? [band.low, band.high] : [])];
  let min = Math.min(...candidates);
  let max = Math.max(...candidates);

  // A flat series would divide by zero; give it room to sit mid-height.
  if (max - min < 0.001) {
    min -= 1;
    max += 1;
  }

  // A tenth of headroom top and bottom so the line never touches the edge.
  const range = max - min;
  min -= range * 0.1;
  max += range * 0.1;

  const x = (index: number) => PAD + (index / (points.length - 1)) * (W - PAD * 2);
  const y = (value: number) => H - PAD - ((value - min) / (max - min)) * (H - PAD * 2);

  const line = (values: readonly number[]) =>
    values.map((value, index) => `${x(index)},${y(value)}`).join(' ');

  const bandTop = band ? y(band.high) : 0;
  const bandBottom = band ? y(band.low) : 0;

  return (
    <View style={{ gap: space.xs }}>
      <View
        style={{
          height,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceSunken,
          overflow: 'hidden',
        }}
      >
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* The healthy band, behind everything. */}
          {band ? (
            <Path
              d={`M0,${bandTop} H${W} V${bandBottom} H0 Z`}
              fill={colors.completed}
              opacity={0.12}
            />
          ) : null}

          {/* Its edges, so the band reads as a range rather than a smudge. */}
          {band ? (
            <>
              <Line
                x1={0}
                y1={bandTop}
                x2={W}
                y2={bandTop}
                stroke={colors.completed}
                strokeWidth={0.4}
                opacity={0.5}
              />
              <Line
                x1={0}
                y1={bandBottom}
                x2={W}
                y2={bandBottom}
                stroke={colors.completed}
                strokeWidth={0.4}
                opacity={0.5}
              />
            </>
          ) : null}

          {/* Diastolic first, so systolic draws on top of it. */}
          {secondary.length === points.length ? (
            <Polyline
              points={line(secondary)}
              fill="none"
              stroke={tint}
              strokeWidth={1.2}
              strokeOpacity={0.45}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          <Polyline
            points={line(primary)}
            fill="none"
            stroke={tint}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            // Keeps the stroke an even weight despite the non-uniform scaling
            // that `preserveAspectRatio="none"` introduces.
            vectorEffect="non-scaling-stroke"
          />

          {/*
            The latest reading, marked — it is the one being asked about.

            Drawn as a short round-capped line rather than a <Circle>: with
            `preserveAspectRatio="none"` the viewBox scales unevenly, which
            stretched a circle into a visible oval. A zero-length stroke with a
            round linecap renders as a true dot because the cap is applied
            AFTER scaling, in device space.
          */}
          <Line
            x1={x(points.length - 1)}
            y1={y(primary[primary.length - 1]!)}
            x2={x(points.length - 1)}
            y2={y(primary[primary.length - 1]!)}
            stroke={tint}
            strokeWidth={7}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </Svg>
      </View>

      {/*
        Which line is which, when there are two.

        The chart drew a bold systolic and a faint diastolic with nothing saying
        so — two anonymous lines that the reader had to infer from position.
        Only shown for a paired metric, since one line needs no key.
      */}
      {showSecondary && secondary.length === points.length ? (
        <Row gap={space.md} style={{ paddingHorizontal: 2 }}>
          <Row gap={5}>
            <View style={{ width: 12, height: 2.5, borderRadius: 2, backgroundColor: tint }} />
            <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
              Systolic
            </Text>
          </Row>
          <Row gap={5}>
            <View
              style={{
                width: 12,
                height: 2.5,
                borderRadius: 2,
                backgroundColor: tint,
                opacity: 0.45,
              }}
            />
            <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
              Diastolic
            </Text>
          </Row>
        </Row>
      ) : null}

      {/* The axis, stated rather than implied — the scale is not zero-based. */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
          {points[0]!.at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </Text>
        {band ? (
          <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
            Typical {band.low}–{band.high}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
          {points[points.length - 1]!.at.toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
          })}
        </Text>
      </View>
    </View>
  );
}
