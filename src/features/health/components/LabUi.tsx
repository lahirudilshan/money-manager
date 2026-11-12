import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { Row, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { tidyValue } from '~/features/health/logic/plainTests';
import type { Theme } from '~/shared/theme';
import {
  rangeBands,
  rangePosition,
  type AreaStatus,
  type ConditionKey,
  type LabStatusKey,
} from '~/features/health/logic/labReports';
import type { HealthLabResult } from '~/db/schema';

/**
 * The building blocks every lab-report screen shares.
 *
 * Status is ALWAYS a word plus an icon, never colour alone (design rule 3):
 * someone colour-blind reading "HIGH ↑" gets the same answer as everyone else.
 * Low and high get different colours as well as different arrows, because the
 * first thing a person scans for is which direction something went.
 */

type Colors = Theme['colors'];
type IconName = keyof typeof Ionicons.glyphMap;

export function labStatusStyle(
  status: LabStatusKey,
  colors: Colors,
): { fg: string; bg: string; label: string; icon: IconName } {
  switch (status) {
    case 'normal':
      return {
        fg: colors.completed,
        bg: colors.completedSoft,
        label: 'Normal',
        icon: 'checkmark-circle',
      };
    case 'high':
      return { fg: colors.pending, bg: colors.pendingSoft, label: 'High', icon: 'arrow-up-circle' };
    case 'low':
      return {
        fg: colors.transferred,
        bg: colors.transferredSoft,
        label: 'Low',
        icon: 'arrow-down-circle',
      };
    case 'borderline':
      return {
        fg: colors.pending,
        bg: colors.pendingSoft,
        label: 'Borderline',
        icon: 'alert-circle',
      };
    case 'abnormal':
      return { fg: colors.danger, bg: colors.dangerSoft, label: 'Abnormal', icon: 'alert-circle' };
    default:
      return {
        fg: colors.inkSecondary,
        bg: colors.surfaceSunken,
        label: 'No range',
        icon: 'help-circle',
      };
  }
}

export function conditionStyle(
  condition: ConditionKey,
  colors: Colors,
): { fg: string; bg: string; label: string; icon: IconName } {
  switch (condition) {
    case 'good':
      return {
        fg: colors.completed,
        bg: colors.completedSoft,
        label: 'Looking good',
        icon: 'happy',
      };
    case 'fair':
      return {
        fg: colors.pending,
        bg: colors.pendingSoft,
        label: 'Mostly fine',
        icon: 'partly-sunny',
      };
    case 'needs_attention':
      return { fg: colors.danger, bg: colors.dangerSoft, label: 'Needs attention', icon: 'medkit' };
    default:
      return {
        fg: colors.inkSecondary,
        bg: colors.surfaceSunken,
        label: 'Unclear',
        icon: 'help-circle',
      };
  }
}

export function areaStyle(status: AreaStatus, colors: Colors) {
  if (status === 'good')
    return {
      fg: colors.completed,
      bg: colors.completedSoft,
      icon: 'checkmark-circle' as IconName,
      label: 'Good',
    };
  if (status === 'watch')
    return { fg: colors.pending, bg: colors.pendingSoft, icon: 'eye' as IconName, label: 'Watch' };
  return {
    fg: colors.danger,
    bg: colors.dangerSoft,
    icon: 'alert-circle' as IconName,
    label: 'Concern',
  };
}

export function LabStatusPill({ status }: { status: LabStatusKey }) {
  const { colors, radius, space } = useTheme();
  const style = labStatusStyle(status, colors);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: style.bg,
        alignSelf: 'flex-start',
      }}
    >
      <Ionicons name={style.icon} size={13} color={style.fg} />
      <Text variant="label" color={style.fg}>
        {style.label.toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * How the results split, as one bar plus words: "14 normal · 5 high · 3 low".
 *
 * The bar answers "how much of me is fine" at a glance; the words carry the
 * same numbers so it never relies on colour alone.
 */
export function StatusBreakdown({ statuses }: { statuses: readonly LabStatusKey[] }) {
  const { colors, radius, space } = useTheme();
  const order: LabStatusKey[] = ['normal', 'borderline', 'high', 'low', 'abnormal', 'unknown'];
  const counts = order
    .map((status) => ({ status, n: statuses.filter((s) => s === status).length }))
    .filter((c) => c.n > 0);

  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{
          flexDirection: 'row',
          height: 8,
          gap: 2,
          borderRadius: radius.pill,
          overflow: 'hidden',
          backgroundColor: colors.surfaceSunken,
        }}
      >
        {counts.map((c) => (
          <View
            key={c.status}
            style={{ flex: c.n, backgroundColor: labStatusStyle(c.status, colors).fg }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 4 }}>
        {counts.map((c) => {
          const style = labStatusStyle(c.status, colors);
          return (
            <Row key={c.status} style={{ gap: 4, alignItems: 'center' }}>
              <Ionicons name={style.icon} size={14} color={style.fg} />
              <Text variant="caption" style={{ fontWeight: '700' }}>
                {`${c.n} ${style.label.toLowerCase()}`}
              </Text>
            </Row>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The AI caveat — on every screen that shows AI words, not tucked in settings.
 *
 * Said once, plainly, in the place the words are read. Amber rather than red:
 * it is a caution about the source, not an alarm about the person.
 */
export function AiDisclaimer({ compact = false }: { compact?: boolean }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.sm,
        padding: compact ? space.sm : space.md,
        borderRadius: radius.md,
        backgroundColor: colors.pendingSoft,
        alignItems: 'flex-start',
      }}
    >
      <Ionicons name="sparkles" size={16} color={colors.pending} style={{ marginTop: 2 }} />
      <Text variant={compact ? 'caption' : 'small'} style={{ flex: 1 }}>
        {compact
          ? 'Explained by AI. It can be wrong — check with your doctor.'
          : 'This was read and explained by AI (Google Gemini). It can make mistakes and is not medical advice. Always check your results with a doctor before making any decision.'}
      </Text>
    </View>
  );
}

/**
 * Where the value sits: below, inside, or above the normal range.
 *
 * Three equal zones, normal in the middle — see `rangePosition` for why the
 * bar is not to scale. The printed limits sit under the zone edges, so the bar
 * carries the range and the reader never has to find it on the paper.
 */
export function RangeBar({
  value,
  refLow,
  refHigh,
  status,
}: {
  value: number | null;
  refLow: number | null;
  refHigh: number | null;
  status: LabStatusKey;
}) {
  const { colors, radius, space } = useTheme();
  const position = rangePosition(value, refLow, refHigh);
  if (position === null) return null;
  const marker = labStatusStyle(status, colors).fg;

  return (
    <View style={{ gap: 4 }}>
      <View style={{ height: 22, justifyContent: 'center' }}>
        <View
          style={{
            flexDirection: 'row',
            height: 8,
            borderRadius: radius.pill,
            overflow: 'hidden',
            gap: 2,
          }}
        >
          <View style={{ flex: 1, backgroundColor: colors.transferredSoft }} />
          <View style={{ flex: 1, backgroundColor: colors.completedSoft }} />
          <View style={{ flex: 1, backgroundColor: colors.pendingSoft }} />
        </View>
        <View
          style={{
            position: 'absolute',
            left: `${position * 100}%`,
            marginLeft: -9,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: marker,
            borderWidth: 3,
            borderColor: colors.surface,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          Low
        </Text>
        <Text variant="caption" tone="muted" style={{ flex: 1, textAlign: 'center' }}>
          {refLow !== null && refHigh !== null
            ? `Normal ${fmt(refLow)}–${fmt(refHigh)}`
            : refHigh !== null
              ? `Normal under ${fmt(refHigh)}`
              : `Normal over ${fmt(refLow as number)}`}
        </Text>
        <Text variant="caption" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
          High
        </Text>
      </View>
      <View style={{ height: space.xs }} />
    </View>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** The normal range as a chart band; one-sided ranges get a synthetic side. */
export function labBand(r: Pick<HealthLabResult, 'refLow' | 'refHigh'>) {
  if (r.refLow === null && r.refHigh === null) return undefined;
  return { low: r.refLow ?? 0, high: r.refHigh ?? (r.refLow as number) * 2 };
}

/** "126 mg/dL" — the figure as the report printed it, with its unit. */
export function formatLabValue(result: Pick<HealthLabResult, 'valueText' | 'unit'>): string {
  const value = tidyValue(result.valueText);
  return result.unit ? `${value} ${result.unit}` : value;
}

/**
 * AI text with its inline glossary softened.
 *
 * The model writes "eosinophil [a type of white blood cell]" so a reader never
 * has to look a word up. Square brackets read like code, so they become
 * parentheses in the secondary ink: the definition is all still there, it just
 * steps back behind the sentence instead of competing with it.
 */
export function GlossaryText({
  children,
  variant = 'body',
  tone = 'ink',
  numberOfLines,
  style,
}: {
  children: string;
  variant?: React.ComponentProps<typeof Text>['variant'];
  tone?: 'ink' | 'secondary';
  numberOfLines?: number;
  style?: React.ComponentProps<typeof Text>['style'];
}) {
  const { colors } = useTheme();
  const parts = children.split(/\[([^\]]+)\]/);
  return (
    <Text variant={variant} tone={tone} numberOfLines={numberOfLines} style={style}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <RNText key={index} style={{ color: colors.inkSecondary, fontWeight: '400' }}>
            {`(${part})`}
          </RNText>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/**
 * One test, explained. Collapsed shows the answer (name, value, verdict, where
 * it sits in the range, one line of why); expanded shows the rest (what it is,
 * what high/low means, where in the body, history).
 *
 * `variant="row"` drops the card chrome so several results can share one
 * Surface with hairlines between them — a long report reads as a list, not a
 * stack of twenty cards.
 *
 * The explanation for the direction the value actually went is shown first and
 * highlighted — someone with a high sugar wants "what high means", and making
 * them read "what low means" first buries it.
 */
export function LabResultCard({
  result,
  initiallyOpen = false,
  onHistory,
  variant = 'card',
}: {
  result: HealthLabResult;
  initiallyOpen?: boolean;
  onHistory?: () => void;
  variant?: 'card' | 'row';
}) {
  const { colors, radius, space } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  const status = labStatusStyle(result.status, colors);
  const row = variant === 'row';
  const pad = row ? space.md : space.lg;

  const highFirst = result.status !== 'low';
  const explanations: { key: string; title: string; body: string | null; active: boolean }[] = [
    { key: 'high', title: 'If it is high', body: result.ifHigh, active: result.status === 'high' },
    { key: 'low', title: 'If it is low', body: result.ifLow, active: result.status === 'low' },
  ];
  if (!highFirst) explanations.reverse();
  const bands = rangeBands(result.refLow, result.refHigh, result.unit);
  const hasMore = Boolean(result.meaning || result.ifHigh || result.ifLow || bands || onHistory);

  return (
    <View
      style={
        row
          ? undefined
          : {
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.hairline,
              overflow: 'hidden',
            }
      }
    >
      <Pressable
        onPress={() => setOpen((v) => !v)}
        disabled={!hasMore && !result.explanation}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${result.testName}, ${formatLabValue(result)}, ${status.label}`}
        style={({ pressed }) => ({
          paddingHorizontal: row ? space.lg : pad,
          paddingVertical: pad,
          gap: space.sm,
          backgroundColor: pressed && row ? colors.surfaceSunken : 'transparent',
          opacity: pressed && !row ? 0.85 : 1,
        })}
      >
        <Row style={{ alignItems: 'flex-start', gap: space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{result.testName}</Text>
            {result.bodyArea && !row ? (
              <Text variant="caption" tone="secondary">
                {result.bodyArea}
              </Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text
              variant={row ? 'figure' : 'figureLarge'}
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatLabValue(result)}
            </Text>
            <LabStatusPill status={result.status} />
          </View>
        </Row>

        <RangeBar
          value={result.value}
          refLow={result.refLow}
          refHigh={result.refHigh}
          status={result.status}
        />
        {result.refText && result.refLow === null && result.refHigh === null ? (
          <Text variant="caption" tone="secondary">
            Normal: {result.refText}
          </Text>
        ) : null}

        {result.explanation ? (
          <GlossaryText
            variant={row ? 'small' : 'body'}
            tone={row ? 'secondary' : 'ink'}
            numberOfLines={row && !open ? 2 : undefined}
          >
            {result.explanation}
          </GlossaryText>
        ) : null}

        {hasMore ? (
          <Row style={{ gap: 4, alignItems: 'center' }}>
            <Text variant="caption" tone="accent" style={{ fontWeight: '700' }}>
              {open ? 'Show less' : 'What does this mean?'}
            </Text>
            <Ionicons
              name={open ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.accent}
            />
            <View style={{ flex: 1 }} />
            {onHistory ? (
              <Pressable
                onPress={onHistory}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`${result.testName} chart over time`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: space.sm,
                  paddingVertical: 4,
                  borderRadius: radius.pill,
                  backgroundColor: colors.accentSoft,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons name="trending-up" size={14} color={colors.accentInk} />
                <Text variant="caption" color={colors.accentInk} style={{ fontWeight: '700' }}>
                  Chart
                </Text>
              </Pressable>
            ) : null}
          </Row>
        ) : null}
      </Pressable>

      {open && hasMore ? (
        <View
          style={{
            paddingHorizontal: row ? space.lg : pad,
            paddingBottom: pad,
            gap: space.md,
            borderTopWidth: row ? 0 : 1,
            borderTopColor: colors.hairline,
            paddingTop: row ? 0 : space.md,
          }}
        >
          {result.meaning ? (
            <Explain
              icon="information-circle-outline"
              title="What this test checks"
              body={result.meaning}
            />
          ) : null}
          {bands ? (
            <RangeGuide result={result} bands={bands} />
          ) : (
            explanations.map((e) =>
              e.body ? (
                <Explain
                  key={e.key}
                  icon={e.key === 'high' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                  title={e.active ? `${e.title} — like yours` : e.title}
                  body={e.body}
                  highlight={e.active}
                  tint={e.key === 'high' ? colors.pending : colors.transferred}
                  tintBg={e.key === 'high' ? colors.pendingSoft : colors.transferredSoft}
                />
              ) : null,
            )
          )}
          {result.bodyArea ? (
            <Explain icon="body-outline" title="Part of the body" body={result.bodyArea} />
          ) : null}
          {onHistory ? (
            <Pressable
              onPress={onHistory}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingVertical: space.sm,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="trending-up" size={18} color={colors.accent} />
              <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
                See history and chart
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Low, normal and high for this test — what each one means, with the zone
 * this result is in marked "You". Answers "what happens if it goes up or
 * down?" in one look, with the printed limits beside each word.
 */
function RangeGuide({
  result,
  bands,
}: {
  result: HealthLabResult;
  bands: NonNullable<ReturnType<typeof rangeBands>>;
}) {
  const { colors, radius, space } = useTheme();
  const zone =
    result.status === 'low' ? 'low' : result.status === 'high' ? 'high' : result.status === 'normal' ? 'normal' : null;
  const rows: {
    key: 'low' | 'normal' | 'high';
    title: string;
    range: string | null;
    body: string | null;
    fg: string;
    bg: string;
    icon: IconName;
  }[] = [
    {
      key: 'low',
      title: 'Low',
      range: bands.low,
      body: result.ifLow,
      fg: colors.transferred,
      bg: colors.transferredSoft,
      icon: 'arrow-down-circle',
    },
    {
      key: 'normal',
      title: 'Normal',
      range: bands.normal,
      body: 'The healthy range. Nothing to worry about for this test.',
      fg: colors.completed,
      bg: colors.completedSoft,
      icon: 'checkmark-circle',
    },
    {
      key: 'high',
      title: 'High',
      range: bands.high,
      body: result.ifHigh,
      fg: colors.pending,
      bg: colors.pendingSoft,
      icon: 'arrow-up-circle',
    },
  ];

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="small" style={{ fontWeight: '700' }}>
        What low, normal and high mean
      </Text>
      {rows
        .filter((r) => r.range !== null)
        .map((r) => {
          const you = zone === r.key;
          return (
            <View
              key={r.key}
              style={{
                flexDirection: 'row',
                gap: space.sm,
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: you ? r.bg : 'transparent',
                borderWidth: 1,
                borderColor: you ? r.bg : colors.hairline,
              }}
            >
              <Ionicons name={r.icon} size={18} color={r.fg} style={{ marginTop: 1 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Row style={{ gap: space.sm, alignItems: 'center' }}>
                  <Text variant="small" style={{ fontWeight: '700' }}>
                    {r.title}
                  </Text>
                  <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                    {r.range}
                  </Text>
                  {you ? (
                    <Text variant="label" color={r.fg}>
                      YOU
                    </Text>
                  ) : null}
                </Row>
                {r.body ? (
                  <GlossaryText variant="small" tone="secondary">
                    {r.body}
                  </GlossaryText>
                ) : null}
              </View>
            </View>
          );
        })}
    </View>
  );
}

function Explain({
  icon,
  title,
  body,
  highlight = false,
  tint,
  tintBg,
}: {
  icon: IconName;
  title: string;
  body: string;
  highlight?: boolean;
  tint?: string;
  tintBg?: string;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.sm,
        padding: highlight ? space.md : 0,
        borderRadius: radius.md,
        backgroundColor: highlight ? tintBg : 'transparent',
      }}
    >
      <Ionicons
        name={icon}
        size={18}
        color={tint ?? colors.inkSecondary}
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small" style={{ fontWeight: '700' }}>
          {title}
        </Text>
        <GlossaryText variant="body" tone="secondary">
          {body}
        </GlossaryText>
      </View>
    </View>
  );
}

/** A bulleted list with one icon per line — good news, things to watch. */
export function BulletList({
  items,
  icon,
  color,
}: {
  items: readonly string[];
  icon: IconName;
  color: string;
}) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {items.map((item, index) => (
        <View key={index} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
          <Ionicons name={icon} size={18} color={color} style={{ marginTop: 1 }} />
          <GlossaryText variant="body" style={{ flex: 1 }}>
            {item}
          </GlossaryText>
        </View>
      ))}
    </View>
  );
}
