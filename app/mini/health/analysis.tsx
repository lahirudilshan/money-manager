import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { Screen } from '~/shared/components/Screen';
import { Button, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { useDocumentViewer } from '~/shared/components/DocumentViewer';
import { resolveImageUri } from '~/shared/lib/imageCache';
import { isPdfAttachment } from '~/shared/lib/imageRef';
import { healthDocumentRepo, healthLabRepo } from '~/db/repositories';
import type { HealthLabResult } from '~/db/schema';
import { useAppStore } from '~/store/useAppStore';
import { useIsExplaining } from '~/features/health/services/analyseRun';
import { isOutOfRange, readOverall } from '~/features/health/logic/labReports';
import { canonicalKey } from '~/features/health/logic/healthMetrics';
import {
  AiDisclaimer,
  areaStyle,
  BulletList,
  conditionStyle,
  LabResultCard,
} from '~/features/health/components/LabUi';

/**
 * One batch of reports, explained.
 *
 * Ordered by what a worried person wants to know, in that order:
 *
 *   1. Overall, am I okay?            — the condition card
 *   2. Which parts of me?             — body areas
 *   3. What is off, and what does it mean? — out-of-range results, OPEN
 *   4. What should I do / ask?        — tips, questions for the doctor
 *   5. Everything else                — normal results, collapsed by category
 *
 * Normal results are collapsed because twenty green cards bury the two that
 * matter; they are one tap away for the person who wants to read them all.
 */
export default function AnalysisScreen() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const refreshKey = useAppStore((s) => s.healthPeople);

  const analysis = useMemo(
    () => (params.id ? healthLabRepo.analysisById(params.id) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.id, refreshKey],
  );
  const results = useMemo(
    () => (analysis ? healthLabRepo.resultsByAnalysis(analysis.id) : []),
    [analysis],
  );
  // Opened as soon as the numbers were saved: the plain words are still coming.
  const explaining = useIsExplaining(analysis?.id);
  const documents = useMemo(() => {
    if (!analysis) return [];
    let ids: string[] = [];
    try {
      ids = JSON.parse(analysis.documentIds) as string[];
    } catch {
      ids = [];
    }
    return healthDocumentRepo.byPerson(analysis.personId).filter((d) => ids.includes(d.id));
  }, [analysis]);
  const { open: openDoc, viewer: documentViewer } = useDocumentViewer();
  const openDocument = (doc: (typeof documents)[number]) =>
    openDoc({ ...doc, kindLabel: 'Report' });

  if (!analysis) {
    return (
      <Screen title="Report results" onBack={() => router.back()}>
        <Text variant="body" tone="secondary">
          This analysis no longer exists.
        </Text>
      </Screen>
    );
  }

  const overall = readOverall(analysis.overallJson);
  const condition = conditionStyle(overall.condition, colors);
  const flagged = results.filter((r) => isOutOfRange(r.status));
  const normal = results.filter((r) => !isOutOfRange(r.status));
  const byCategory = groupBy(normal, (r) => r.category);

  const openHistory = (r: HealthLabResult) =>
    router.push(
      `/mini/health/lab-test?person=${r.personId}&key=${encodeURIComponent(canonicalKey(r.testKey))}`,
    );

  function remove() {
    Alert.alert(
      'Delete this analysis?',
      'The explanations and saved results are removed. The report files themselves are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            healthLabRepo.removeAnalysis(analysis!.id);
            useAppStore.getState().refreshMiniAppData();
            router.back();
          },
        },
      ],
    );
  }

  return (
    <Screen
      title="Report results"
      onBack={() => router.back()}
      action={{ icon: 'trash-outline', onPress: remove, label: 'Delete analysis' }}
      footer={
        <Button
          label="Ask about my results"
          icon="search"
          variant="secondary"
          onPress={() => router.push(`/mini/health/labs?person=${analysis.personId}&focus=1`)}
        />
      }
    >
      <AiDisclaimer />

      {/* 1. Overall */}
      <View style={{ gap: space.sm }}>
        <Label>CURRENT HEALTH</Label>
        <Surface>
          <View style={{ gap: space.md }}>
            <Row style={{ gap: space.md, alignItems: 'center' }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.md,
                  backgroundColor: condition.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={condition.icon} size={26} color={condition.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" color={condition.fg}>
                  {condition.label.toUpperCase()}
                </Text>
                <Text variant="caption" tone="secondary">
                  {`Reports from ${formatDate(analysis.reportDate)}`}
                </Text>
              </View>
            </Row>
            {explaining ? (
              <Row style={{ gap: space.sm, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text variant="body" tone="secondary" style={{ flex: 1 }}>
                  Your numbers are below. Writing what they mean in simple words…
                </Text>
              </Row>
            ) : (
              <Text variant="title">{analysis.headline}</Text>
            )}
            {analysis.summary ? (
              <Text variant="body" tone="secondary">
                {analysis.summary}
              </Text>
            ) : null}
            <Row style={{ gap: space.sm }}>
              <CountChip
                icon="checkmark-circle"
                color={colors.completed}
                bg={colors.completedSoft}
                text={`${normal.length} normal`}
              />
              {flagged.length > 0 ? (
                <CountChip
                  icon="alert-circle"
                  color={colors.pending}
                  bg={colors.pendingSoft}
                  text={`${flagged.length} need a look`}
                />
              ) : null}
            </Row>
          </View>
        </Surface>
      </View>

      {/* 2. Body areas */}
      {overall.areas.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>BODY AREAS</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {overall.areas.map((area, index) => {
              const style = areaStyle(area.status, colors);
              return (
                <View
                  key={index}
                  style={{
                    width: '48.5%',
                    padding: space.md,
                    gap: space.xs,
                    borderRadius: radius.lg,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.hairline,
                  }}
                >
                  <Row style={{ gap: 6, alignItems: 'center' }}>
                    <Ionicons name={style.icon} size={16} color={style.fg} />
                    <Text variant="label" color={style.fg}>
                      {style.label.toUpperCase()}
                    </Text>
                  </Row>
                  <Text variant="bodyStrong">{area.area}</Text>
                  {area.note ? (
                    <Text variant="caption" tone="secondary">
                      {area.note}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* 3. What is off */}
      {flagged.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>NEEDS A LOOK</Label>
          {flagged.map((r) => (
            <LabResultCard key={r.id} result={r} initiallyOpen onHistory={() => openHistory(r)} />
          ))}
        </View>
      ) : null}

      {/* 4. What it means for daily life */}
      {overall.goodNews.length > 0 ? (
        <Section label="GOOD NEWS">
          <BulletList items={overall.goodNews} icon="checkmark-circle" color={colors.completed} />
        </Section>
      ) : null}
      {overall.watchOut.length > 0 ? (
        <Section label="KEEP AN EYE ON">
          <BulletList items={overall.watchOut} icon="eye" color={colors.pending} />
        </Section>
      ) : null}
      {overall.tips.length > 0 ? (
        <Section label="SIMPLE THINGS THAT OFTEN HELP">
          <BulletList items={overall.tips} icon="leaf-outline" color={colors.completed} />
        </Section>
      ) : null}
      {overall.questionsForDoctor.length > 0 ? (
        <Section label="ASK YOUR DOCTOR">
          <BulletList
            items={overall.questionsForDoctor}
            icon="chatbubble-ellipses-outline"
            color={colors.accent}
          />
        </Section>
      ) : null}

      {/* 5. Everything else */}
      {byCategory.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>{flagged.length > 0 ? 'IN THE NORMAL RANGE' : 'ALL RESULTS'}</Label>
          {byCategory.map(([category, rows]) => (
            <View key={category} style={{ gap: space.sm }}>
              <Text
                variant="small"
                tone="secondary"
                style={{ fontWeight: '700', marginTop: space.xs }}
              >
                {category}
              </Text>
              {rows.map((r) => (
                <LabResultCard key={r.id} result={r} onHistory={() => openHistory(r)} />
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {documents.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>ORIGINAL REPORTS</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {documents.map((doc, index) => {
              const path = resolveImageUri(doc.imageUri);
              const pdf = isPdfAttachment(path ?? doc.imageUri);
              return (
                <Pressable
                  key={doc.id}
                  onPress={() => (path ? openDocument(doc) : undefined)}
                  disabled={!path}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    padding: space.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colors.hairline,
                    backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                  })}
                >
                  <Ionicons
                    name={pdf ? 'document-text-outline' : 'image-outline'}
                    size={20}
                    color={colors.inkSecondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {doc.title}
                    </Text>
                    <Text variant="caption" tone="secondary">
                      {path
                        ? formatDate(doc.documentDate)
                        : 'In Google Drive · not on this phone yet'}
                    </Text>
                  </View>
                  {path ? <Ionicons name="open-outline" size={16} color={colors.inkMuted} /> : null}
                </Pressable>
              );
            })}
          </Surface>
        </View>
      ) : null}

      <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {`Read by AI on ${formatDate(analysis.analysedAt)}`}
      </Text>
      {documentViewer}
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      <Surface>{children}</Surface>
    </View>
  );
}

function CountChip({
  icon,
  color,
  bg,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  text: string;
}) {
  const { radius, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: space.sm,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: bg,
      }}
    >
      <Ionicons name={icon} size={14} color={color} />
      <Text variant="caption" style={{ fontWeight: '700' }}>
        {text}
      </Text>
    </View>
  );
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return [...map.entries()];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
