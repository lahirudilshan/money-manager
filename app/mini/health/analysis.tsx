import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text as RNText, View } from 'react-native';
import { Screen } from '~/shared/components/Screen';
import { Button, Divider, Label, Row, Surface, Text } from '~/shared/components/ui';
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
import { AiDisclaimer, BulletList, GlossaryText } from '~/features/health/components/LabUi';
import { ResultRow } from '~/features/health/components/ResultRow';
import { categoryLook } from '~/features/health/components/healthCategory';

/**
 * One batch of reports, explained.
 *
 * Ordered by what a worried person wants to know, in that order:
 *
 *   1. Overall, am I okay?          — verdict, headline, a count bar, body areas
 *   2. What is off?                 — out-of-range results as one list
 *   3. What does it mean for me?    — good news and things to watch, together
 *   4. What should I do / ask?      — doctor questions and tips, expandable
 *   5. Everything else              — normal results, one collapsible card per category
 *
 * Every result keeps its range bar and its one-line reason in the list; the
 * longer explanations are a tap away on each row, so nothing the report says
 * is dropped — it is just not all shouting at once.
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
  const flagged = results.filter((r) => isOutOfRange(r.status));
  const normal = results.filter((r) => !isOutOfRange(r.status));
  const byCategory = groupBy(normal, (r) => r.category);
  // A short, all-clear report has nothing to hide behind a tap.
  const openNormalByDefault = flagged.length === 0 && normal.length <= 6;

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

  const nextSteps = overall.questionsForDoctor.length + overall.tips.length;

  /*
   * The report's everyday name: one kind of test → "Full blood count"; two →
   * "Liver test and Kidney test"; more → "Health check-up". The names printed
   * on the paper sit underneath so it can be matched to the file.
   */
  const categories = [...new Set(results.map((r) => r.category))];
  const mainCategory =
    [...categories].sort(
      (a, b) => results.filter((r) => r.category === b).length - results.filter((r) => r.category === a).length,
    )[0] ?? '';
  const mainLook = categoryLook(mainCategory);
  const friendlyName =
    categories.length === 0
      ? 'Lab report'
      : categories.length === 1
        ? mainLook.reportName
        : categories.length === 2
          ? `${categoryLook(categories[0]).reportName} and ${categoryLook(categories[1]).reportName.toLowerCase()}`
          : 'Health check-up';
  const printedNames =
    documents.length === 0
      ? null
      : documents.length <= 2
        ? documents.map((d) => d.title).join(', ')
        : `${documents.slice(0, 2).map((d) => d.title).join(', ')} and ${documents.length - 2} more`;
  const headline =
    analysis.headline && !/^(your )?(reports?|results?) (have|has) been (read|analy[sz]ed)\.?$/i.test(analysis.headline.trim())
      ? analysis.headline
      : null;
  /** The main kind of test in one document, from its results. */
  const docLook = (documentId: string) => {
    const own = results.filter((r) => r.documentId === documentId);
    if (own.length === 0) return null;
    const counts = new Map<string, number>();
    for (const r of own) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return categoryLook([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  };

  return (
    <Screen
      title="Report results"
      onBack={() => router.back()}
      action={{ icon: 'trash-outline', onPress: remove, label: 'Delete analysis' }}
      footer={
        <Button
          label="Ask AI about this report"
          icon="sparkles-outline"
          variant="secondary"
          onPress={() =>
            router.push(
              `/ask?scope=health&person=${analysis.personId}&q=${encodeURIComponent(`Explain my ${friendlyName.toLowerCase()} from ${formatDate(analysis.reportDate)} in simple words. What should I do?`)}`,
            )
          }
        />
      }
    >
      {/* 1. Which report, in everyday words, with its printed name beside. */}
      <Surface>
        <View style={{ gap: space.md }}>
          <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: mainLook.color,
              }}
            >
              <Ionicons name={mainLook.icon} size={24} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title">{friendlyName}</Text>
              {printedNames ? (
                <Text variant="small" tone="secondary" numberOfLines={2}>
                  {`On the report: ${printedNames}`}
                </Text>
              ) : null}
              <Text variant="caption" tone="secondary">
                {`${formatDate(analysis.reportDate)} · ${results.length} ${results.length === 1 ? 'test' : 'tests'}`}
              </Text>
            </View>
          </Row>

          {/* What it found, said once, plainly. */}
          <Row
            gap={space.sm}
            style={{
              alignItems: 'flex-start',
              padding: space.md,
              borderRadius: radius.md,
              backgroundColor: flagged.length === 0 ? colors.completedSoft : colors.pendingSoft,
            }}
          >
            <Ionicons
              name={flagged.length === 0 ? 'checkmark-circle' : 'alert-circle'}
              size={20}
              color={flagged.length === 0 ? colors.completed : colors.pending}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">
                {flagged.length === 0
                  ? 'All results are normal'
                  : `${flagged.length} ${flagged.length === 1 ? 'result needs' : 'results need'} a look · ${normal.length} normal`}
              </Text>
              {explaining ? (
                <Row style={{ gap: space.sm, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                    Writing what they mean in simple words…
                  </Text>
                </Row>
              ) : headline ? (
                <Text variant="small" tone="secondary">
                  {headline}
                </Text>
              ) : null}
            </View>
          </Row>
          {analysis.summary && !explaining ? <ExpandableText text={analysis.summary} lines={3} /> : null}
          <AiDisclaimer compact />
        </View>
      </Surface>

      {/* 2. What is off */}
      {flagged.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>{`NEEDS A LOOK · ${flagged.length}`}</Label>
          <Text variant="small" tone="secondary" style={{ paddingHorizontal: space.xs }}>
            Each one shows what low, normal and high mean. Yours is marked.
          </Text>
          <ResultList>
            {flagged.map((r) => (
              <ResultRow key={r.id} result={r} initiallyOpen onHistory={() => openHistory(r)} />
            ))}
          </ResultList>
        </View>
      ) : null}

      {/* 3. What it means for daily life */}
      {overall.goodNews.length > 0 || overall.watchOut.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>IN SHORT</Label>
          <Surface>
            <View style={{ gap: space.md }}>
              {overall.goodNews.length > 0 ? (
                <BulletList
                  items={overall.goodNews}
                  icon="checkmark-circle"
                  color={colors.completed}
                />
              ) : null}
              {overall.goodNews.length > 0 && overall.watchOut.length > 0 ? <Divider /> : null}
              {overall.watchOut.length > 0 ? (
                <BulletList items={overall.watchOut} icon="eye" color={colors.pending} />
              ) : null}
            </View>
          </Surface>
        </View>
      ) : null}

      {/* 4. What to do */}
      {nextSteps > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>NEXT STEPS</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {overall.questionsForDoctor.length > 0 ? (
              <Disclosure
                icon="chatbubble-ellipses-outline"
                tint={colors.accent}
                title="Ask your doctor"
                count={overall.questionsForDoctor.length}
                initiallyOpen
              >
                <BulletList
                  items={overall.questionsForDoctor}
                  icon="help-circle-outline"
                  color={colors.accent}
                />
              </Disclosure>
            ) : null}
            {overall.tips.length > 0 ? (
              <Disclosure
                icon="leaf-outline"
                tint={colors.completed}
                title="Simple things that often help"
                count={overall.tips.length}
                divider={overall.questionsForDoctor.length > 0}
              >
                <BulletList items={overall.tips} icon="leaf-outline" color={colors.completed} />
              </Disclosure>
            ) : null}
          </Surface>
        </View>
      ) : null}

      {/* 5. Everything else */}
      {byCategory.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>
            {flagged.length > 0
              ? `IN THE NORMAL RANGE · ${normal.length}`
              : `ALL RESULTS · ${normal.length}`}
          </Label>
          {byCategory.map(([category, rows]) => {
            const look = categoryLook(category);
            return (
              <Surface key={category} padded={false} style={{ overflow: 'hidden' }}>
                <Disclosure
                  icon={look.icon}
                  tint={look.color}
                  title={look.title}
                  subtitle={`All ${rows.length} normal · tap a test to see what low and high mean`}
                  count={rows.length}
                  initiallyOpen={openNormalByDefault}
                  flush
                >
                  {rows.map((r) => (
                    <View key={r.id} style={{ borderTopWidth: 1, borderTopColor: colors.hairline }}>
                      <ResultRow result={r} initiallyOpen={false} onHistory={() => openHistory(r)} />
                    </View>
                  ))}
                </Disclosure>
              </Surface>
            );
          })}
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
                    <Text variant="bodyStrong" numberOfLines={2}>
                      {doc.title}
                    </Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                      {[
                        docLook(doc.id)?.reportName,
                        path ? formatDate(doc.documentDate) : 'In Google Drive · not on this phone yet',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
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

/** Several results in one card, hairlines between them. */
function ResultList({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const items = React.Children.toArray(children);
  return (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      {items.map((child, index) => (
        <View
          key={index}
          style={{ borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.hairline }}
        >
          {child}
        </View>
      ))}
    </Surface>
  );
}


/** A paragraph clipped to a few lines, with "Read more" when it runs longer. */
function ExpandableText({ text, lines }: { text: string; lines: number }) {
  const { space } = useTheme();
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      disabled={!clipped && !open}
      accessibilityRole="button"
      style={{ gap: space.xs }}
    >
      <GlossaryText variant="body" tone="secondary" numberOfLines={open ? undefined : lines}>
        {text}
      </GlossaryText>
      {/* Measure the full height off-screen to know whether there is more. */}
      <View style={{ position: 'absolute', opacity: 0, left: 0, right: 0 }} pointerEvents="none">
        <RNText
          style={{ fontSize: 15 }}
          onTextLayout={(e) => setClipped(e.nativeEvent.lines.length > lines)}
        >
          {text}
        </RNText>
      </View>
      {clipped ? (
        <Text variant="caption" tone="accent" style={{ fontWeight: '700' }}>
          {open ? 'Show less' : 'Read more'}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A tappable header that opens to show its children. */
function Disclosure({
  icon,
  tint,
  title,
  subtitle,
  count,
  initiallyOpen = false,
  divider = false,
  flush = false,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  subtitle?: string;
  count: number;
  initiallyOpen?: boolean;
  divider?: boolean;
  /** Children draw their own padding and hairlines (a result list). */
  flush?: boolean;
  children: React.ReactNode;
}) {
  const { colors, space } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={{ borderTopWidth: divider ? 1 : 0, borderTopColor: colors.hairline }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${count}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        })}
      >
        <Ionicons name={icon} size={20} color={tint} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{title}</Text>
          {subtitle ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
          {String(count)}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.inkMuted} />
      </Pressable>
      {open ? (
        flush ? (
          children
        ) : (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>{children}</View>
        )
      ) : null}
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
