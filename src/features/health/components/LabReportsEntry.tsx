import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Divider, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { healthLabRepo } from '~/db/repositories';
import { isOutOfRange, readOverall } from '~/features/health/logic/labReports';
import { conditionStyle } from './LabUi';

/**
 * The lab-report block on the health home: ask, or add.
 *
 * The question bar comes FIRST once there are results, because that is the
 * everyday use — "what was my sugar?" is asked far more often than a new
 * report arrives. Before there are any, the block is an invitation instead,
 * since a search box over nothing teaches nothing.
 */
export function LabReportsEntry({
  personId,
  refreshKey,
}: {
  personId: string;
  refreshKey: unknown;
}) {
  const { colors, radius, space } = useTheme();
  const router = useRouter();

  const { latest, resultCount, outOfRange } = useMemo(() => {
    const analyses = healthLabRepo.analysesByPerson(personId);
    const results = healthLabRepo.resultsByPerson(personId);
    const last = analyses[0];
    const lastResults = last ? results.filter((r) => r.analysisId === last.id) : [];
    return {
      latest: last,
      resultCount: results.length,
      outOfRange: lastResults.filter((r) => isOutOfRange(r.status)).length,
    };
    // `refreshKey` re-reads after any health write, like the screen's own memos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, refreshKey]);

  const analyse = () => router.push(`/mini/health/analyze?person=${personId}`);

  if (!latest) {
    return (
      <View style={{ gap: space.sm }}>
        <Label>LAB REPORTS</Label>
        <Surface onPress={analyse}>
          <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.md,
                backgroundColor: colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="sparkles" size={22} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text variant="heading">Understand your lab reports</Text>
              <Text variant="small" tone="secondary">
                Photograph or upload your reports. AI explains every result in simple words — what
                is normal, what is high or low, and what it affects.
              </Text>
              <Row style={{ gap: 4, marginTop: space.xs }}>
                <Text variant="bodyStrong" tone="accent">
                  Upload reports
                </Text>
                <Ionicons name="arrow-forward" size={16} color={colors.accent} />
              </Row>
            </View>
          </Row>
        </Surface>
      </View>
    );
  }

  const overall = readOverall(latest.overallJson);
  const condition = conditionStyle(overall.condition, colors);

  return (
    <View style={{ gap: space.sm }}>
      <Label>LAB REPORTS</Label>

      {/* Looks like a search field, opens the search screen focused. */}
      <Pressable
        onPress={() => router.push(`/mini/health/labs?person=${personId}&focus=1`)}
        accessibilityRole="search"
        accessibilityLabel="Ask about your results"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderRadius: radius.pill,
          backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
          borderWidth: 1,
          borderColor: colors.hairlineStrong,
        })}
      >
        <Ionicons name="search" size={18} color={colors.inkSecondary} />
        <Text variant="body" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
          Ask: what is my sugar level?
        </Text>
        <Ionicons name="cloud-offline-outline" size={16} color={colors.inkMuted} />
      </Pressable>

      <Surface padded={false} style={{ overflow: 'hidden' }}>
        <Pressable
          onPress={() => router.push(`/mini/health/analysis?id=${latest.id}`)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            padding: space.lg,
            gap: space.sm,
            backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
          })}
        >
          <Row style={{ gap: space.sm, alignItems: 'center' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: space.sm,
                paddingVertical: 3,
                borderRadius: radius.pill,
                backgroundColor: condition.bg,
              }}
            >
              <Ionicons name={condition.icon} size={13} color={condition.fg} />
              <Text variant="label" color={condition.fg}>
                {condition.label.toUpperCase()}
              </Text>
            </View>
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {latest.reportDate.toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
          </Row>
          <Text variant="bodyStrong">{latest.headline}</Text>
          <Text variant="caption" tone="secondary">
            {outOfRange > 0
              ? `${outOfRange} result${outOfRange === 1 ? '' : 's'} outside the normal range`
              : 'Every result in the normal range'}
            {` · ${resultCount} saved in total`}
          </Text>
        </Pressable>
        <Divider />
        <Pressable
          onPress={analyse}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
          })}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
          <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
            Read new reports with AI
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
        </Pressable>
      </Surface>
    </View>
  );
}
