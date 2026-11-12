import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Row, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import type { HealthLabResult } from '~/db/schema';
import { rangeBands } from '~/features/health/logic/labReports';
import { canonicalKey } from '~/features/health/logic/healthMetrics';
import { adviceFor } from '~/features/health/logic/measureGuide';
import { firstSentence, lowHighMeaning, plainName } from '~/features/health/logic/plainTests';
import { formatLabValue, GlossaryText, LabStatusPill, labStatusStyle } from './LabUi';

/**
 * One result on a report, readable by anyone:
 *
 *   ▌ Liver enzyme (AST)                        39 U/L
 *   ▌ On the report: SGOT ( AST )               ↑ HIGH
 *   ┌───────────────────────────────────────────────┐
 *   │ ↓ Low · under 5       Usually not a concern.  │
 *   │ ✓ Normal · 5–37       Healthy.                │
 *   │ ↑ High · over 37  YOU  Liver may be stressed. │
 *   └───────────────────────────────────────────────┘
 *   What to do: Nothing urgent. Mention it at your next check-up.
 *
 * The everyday name leads and the printed one sits under it, so the row can
 * be matched to the paper. The low / normal / high guide is always open on a
 * result that is off, and one tap away on a normal one.
 */
export function ResultRow({
  result,
  initiallyOpen,
  onHistory,
}: {
  result: HealthLabResult;
  initiallyOpen: boolean;
  onHistory?: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  const key = canonicalKey(result.testKey);
  const name = plainName(key, result.testName, result.unit);
  const printed = result.testName.trim();
  const showPrinted = printed.toLowerCase() !== name.toLowerCase();
  const status = labStatusStyle(result.status, colors);
  const meanings = lowHighMeaning(key, result.testName, result);
  const bands = rangeBands(result.refLow, result.refHigh, result.unit);
  const zone =
    result.status === 'low'
      ? 'low'
      : result.status === 'high' || result.status === 'borderline'
        ? 'high'
        : result.status === 'normal'
          ? 'normal'
          : null;
  const off = zone === 'low' || zone === 'high';
  const advice = adviceFor(key, result.status, result);
  const mine = firstSentence(result.explanation);

  const lines = bands
    ? ([
        { key: 'low', title: 'Low', range: bands.low, text: meanings.low ?? 'Below the healthy range.', icon: 'arrow-down-circle', fg: colors.transferred, bg: colors.transferredSoft },
        { key: 'normal', title: 'Normal', range: bands.normal, text: 'Healthy. Nothing to do.', icon: 'checkmark-circle', fg: colors.completed, bg: colors.completedSoft },
        { key: 'high', title: 'High', range: bands.high, text: meanings.high ?? 'Above the healthy range.', icon: 'arrow-up-circle', fg: colors.pending, bg: colors.pendingSoft },
      ] as const).filter((l) => l.range !== null)
    : [];

  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${formatLabValue(result)}, ${status.label}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        })}
      >
        <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: status.fg }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {name}
          </Text>
          {showPrinted ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {`On the report: ${printed}`}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text variant="figure" style={{ fontVariant: ['tabular-nums'] }}>
            {formatLabValue(result)}
          </Text>
          <LabStatusPill status={result.status} />
        </View>
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm }}>
          {mine ? (
            <GlossaryText variant="small" tone="secondary">
              {mine}
            </GlossaryText>
          ) : null}

          {lines.length > 0 ? (
            <View
              style={{
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.hairline,
                overflow: 'hidden',
              }}
            >
              {lines.map((l, index) => {
                const you = zone === l.key;
                return (
                  <Row
                    key={l.key}
                    gap={space.sm}
                    style={{
                      alignItems: 'flex-start',
                      padding: space.sm,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.hairline,
                      backgroundColor: you ? l.bg : 'transparent',
                    }}
                  >
                    <Ionicons name={l.icon} size={16} color={l.fg} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Row gap={6}>
                        <Text variant="small" style={{ fontWeight: '700' }}>
                          {l.title}
                        </Text>
                        <Text variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
                          {l.range}
                        </Text>
                        {you ? (
                          <Text variant="label" color={l.fg}>
                            YOU
                          </Text>
                        ) : null}
                      </Row>
                      <Text variant="caption" tone={you ? undefined : 'secondary'}>
                        {l.text}
                      </Text>
                    </View>
                  </Row>
                );
              })}
            </View>
          ) : result.refText ? (
            <Text variant="caption" tone="secondary">{`Normal: ${result.refText}`}</Text>
          ) : null}

          {off ? (
            <Text variant="small">
              <Text variant="small" style={{ fontWeight: '700' }}>
                {'What to do: '}
              </Text>
              {advice.todo}
            </Text>
          ) : null}

          {onHistory ? (
            <Pressable
              onPress={onHistory}
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="trending-up" size={15} color={colors.accent} />
              <Text variant="caption" tone="accent" style={{ fontWeight: '700' }}>
                See all results and chart
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
