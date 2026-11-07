import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Empty, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import { healthDocumentRepo, healthLabRepo } from '../../../src/db/repositories';
import {
  describeQuery,
  EXAMPLE_QUESTIONS,
  mergeTags,
  parseDocumentQuery,
  reportTopics,
  searchDocuments,
  tagsFromResults,
  type ReportTopic,
} from '~/features/health/logic/documentSearch';
import { isOutOfRange } from '~/features/health/logic/labReports';
import {
  DOCUMENT_KIND_LABEL,
  type DocumentKind,
  type HealthDocument,
} from '../../../src/db/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { resolveImageUri } from '~/shared/lib/imageCache';
import { isPdfAttachment } from '~/shared/lib/imageRef';
import { useDocumentViewer } from '~/shared/components/DocumentViewer';
import { AnalyseRunBanner } from '~/features/health/components/AnalyseRunBanner';

/**
 * Every report, prescription and scan — searchable, filterable, in date order.
 *
 * ## Why a searchable list, not a gallery
 *
 * The grid worked for five photos. With reports arriving every few months —
 * many of them PDFs with no thumbnail at all — it became a wall of identical
 * tiles. People look for paper by three things: WHEN ("last 3 months"), WHAT
 * KIND ("reports"), and WHAT IT WAS ABOUT ("sugar"). So:
 *
 *   - a search box that reads exactly those three out of a plain sentence
 *     (`parseDocumentQuery`), offline, no AI;
 *   - filter chips for kind and period, for people who would rather tap;
 *   - a list grouped by month, each row carrying its tags, so what a report is
 *     about is visible without opening it.
 *
 * A report read by AI is tagged with what was on it (test names, "sugar",
 * "kidney"), which is what lets the topic match a report whose paper only
 * ever said "Fasting Plasma Glucose".
 */
type Period = 'any' | '3m' | 'year' | 'lastYear';
const PERIOD_LABEL: Record<Period, string> = {
  any: 'Any time',
  '3m': 'Last 3 months',
  year: 'This year',
  lastYear: 'Last year',
};

function periodRange(period: Period, now: Date): { from: Date | null; to: Date | null } {
  if (period === '3m') return { from: new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()), to: null };
  if (period === 'year') return { from: new Date(now.getFullYear(), 0, 1), to: null };
  if (period === 'lastYear') {
    return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(now.getFullYear(), 0, 1) };
  }
  return { from: null, to: null };
}

export default function HealthDocuments() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string; q?: string }>();
  const store = useAppStore();

  const person =
    store.healthPeople.find((p) => p.id === params.person) ?? store.healthPeople[0];

  const documents = useMemo(
    () => (person ? healthDocumentRepo.byPerson(person.id) : []),
    [person, store.healthPeople],
  );

  /**
   * Which documents the AI has read, how many results were off, and the tags
   * those results imply. The tags are derived here as well as stored, so a
   * report read before tagging existed is still found by "sugar".
   */
  const aiByDocument = useMemo(() => {
    const map = new Map<
      string,
      { analysisId: string; flagged: number; tags: string; topics: ReportTopic[] }
    >();
    if (!person) return map;
    const byDoc = new Map<string, ReturnType<typeof healthLabRepo.resultsByPerson>>();
    for (const r of healthLabRepo.resultsByPerson(person.id)) {
      if (!r.documentId) continue;
      byDoc.set(r.documentId, [...(byDoc.get(r.documentId) ?? []), r]);
    }
    for (const [documentId, results] of byDoc) {
      map.set(documentId, {
        analysisId: results[0].analysisId,
        flagged: results.filter((r) => isOutOfRange(r.status)).length,
        tags: tagsFromResults(results),
        topics: reportTopics(results, null, 4),
      });
    }
    return map;
  }, [person, store.healthPeople]);

  /** Documents with their full tag set: their own plus what the AI read. */
  const tagged = useMemo(
    () =>
      documents.map((d) => ({ ...d, tags: mergeTags(d.tags, aiByDocument.get(d.id)?.tags) })),
    [documents, aiByDocument],
  );

  const [query, setQuery] = useState(params.q ?? '');
  const [kind, setKind] = useState<DocumentKind | null>(null);
  const [period, setPeriod] = useState<Period>('any');
  const { open: openDocument, close: closeViewer, viewer } = useDocumentViewer((d) => {
    const document = documents.find((x) => x.id === d.id);
    if (document) remove(document);
  });

  const kinds = useMemo(() => {
    const seen = new Set(documents.map((document) => document.kind));
    return [...seen] as DocumentKind[];
  }, [documents]);

  const parsed = useMemo(() => parseDocumentQuery(query, new Date()), [query]);

  const shown = useMemo(() => {
    const range = periodRange(period, new Date());
    const fromQuery = searchDocuments(tagged, parsed);
    return fromQuery.filter((d) => {
      if (kind && d.kind !== kind) return false;
      const at = d.documentDate.getTime();
      if (range.from && at < range.from.getTime()) return false;
      if (range.to && at >= range.to.getTime()) return false;
      return true;
    });
  }, [tagged, parsed, kind, period]);

  /** Grouped by month, newest first — the way paper is remembered. */
  const byMonth = useMemo(() => {
    const groups: { key: string; label: string; items: typeof shown }[] = [];
    for (const d of shown) {
      const key = `${d.documentDate.getFullYear()}-${d.documentDate.getMonth()}`;
      const last = groups[groups.length - 1];
      if (last?.key === key) last.items.push(d);
      else {
        groups.push({
          key,
          label: d.documentDate
            .toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
            .toUpperCase(),
          items: [d],
        });
      }
    }
    return groups;
  }, [shown]);

  const filtering = query.trim().length > 0 || kind !== null || period !== 'any';
  const understood = query.trim()
    ? describeQuery(parsed, (k) => DOCUMENT_KIND_LABEL[k as DocumentKind] + 's')
    : '';

  function remove(document: HealthDocument) {
    Alert.alert(
      `Delete "${document.title}"?`,
      'The file is removed from this phone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            healthDocumentRepo.remove(document.id);
            store.refresh();
            closeViewer();
          },
        },
      ],
    );
  }

  /** Open: the image viewer for photos, the system viewer for PDFs. */
  function open(document: HealthDocument) {
    openDocument({ ...document, kindLabel: DOCUMENT_KIND_LABEL[document.kind] });
  }

  /** Everything you can do with a document, from one tap. */
  function actions(document: HealthDocument) {
    const ai = aiByDocument.get(document.id);
    Alert.alert(document.title, undefined, [
      { text: 'Open', onPress: () => open(document) },
      ...(ai
        ? [{ text: 'See AI summary', onPress: () => router.push(`/mini/health/analysis?id=${ai.analysisId}`) }]
        : []),
      {
        text: 'Edit details & tags',
        onPress: () => router.push(`/mini/health/document?person=${document.personId}&id=${document.id}`),
      },
      { text: 'Delete', style: 'destructive', onPress: () => remove(document) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (!person) {
    return (
      <Screen title="Documents" onBack={() => router.back()}>
        <Text variant="small" tone="secondary">
          Add a person first.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      title={`${person.name}'s documents`}
      onBack={() => router.back()}
      footer={
        <GradientButton
          label="Scan a report with AI"
          icon="sparkles"
          onPress={() => router.push(`/mini/health/analyze?person=${person.id}`)}
        />
      }
      action={{
        icon: 'camera-outline',
        label: 'Add a document',
        onPress: () => router.push(`/mini/health/document?person=${person.id}`),
      }}
    >
      <AnalyseRunBanner personId={person.id} />
      {documents.length === 0 ? (
        <Empty
          icon="document-text-outline"
          title="No documents yet"
          message="Scan a lab report and AI reads and tags it, or photograph a prescription. Everything is kept here and in your Google Drive, easy to find later."
          actionLabel="Add a document"
          onAction={() => router.push(`/mini/health/document?person=${person.id}`)}
        />
      ) : (
        <>
          {/* Ask for it in plain words. */}
          <View style={{ gap: space.sm }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingHorizontal: space.lg,
                borderRadius: radius.pill,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: query ? colors.accent : colors.hairlineStrong,
              }}
            >
              <Ionicons name="search" size={18} color={colors.inkSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Last 3 months sugar reports"
                placeholderTextColor={colors.inkFaint}
                returnKeyType="search"
                autoCorrect={false}
                style={{ flex: 1, paddingVertical: space.md, fontSize: 15, color: colors.ink }}
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
                </Pressable>
              ) : null}
            </View>
            {!query ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
              >
                {EXAMPLE_QUESTIONS.map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => setQuery(q)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      paddingHorizontal: space.md,
                      paddingVertical: space.sm,
                      borderRadius: radius.pill,
                      backgroundColor: pressed ? colors.accentSoft : colors.surface,
                      borderWidth: 1,
                      borderColor: colors.hairline,
                    })}
                  >
                    <Text variant="small" color={colors.accentInk} style={{ fontWeight: '600' }}>
                      {q}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>

          {/* Or tap filters. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
          >
            {(Object.keys(PERIOD_LABEL) as Period[]).map((key) => (
              <FilterChip
                key={key}
                label={PERIOD_LABEL[key]}
                selected={period === key}
                onPress={() => setPeriod(key)}
              />
            ))}
          </ScrollView>
          {kinds.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
            >
              <FilterChip label="All kinds" selected={kind === null} onPress={() => setKind(null)} />
              {kinds.map((key) => (
                <FilterChip
                  key={key}
                  label={DOCUMENT_KIND_LABEL[key]}
                  selected={kind === key}
                  onPress={() => setKind(key)}
                />
              ))}
            </ScrollView>
          ) : null}

          {filtering ? (
            <Text variant="caption" tone="secondary" style={{ paddingHorizontal: space.xs }}>
              {`${shown.length} ${shown.length === 1 ? 'document' : 'documents'}`}
              {understood ? ` · ${understood}` : ''}
            </Text>
          ) : null}

          {shown.length === 0 ? (
            <Surface>
              <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
                <Ionicons name="search-outline" size={28} color={colors.inkMuted} />
                <Text variant="heading">Nothing matches</Text>
                <Text variant="small" tone="secondary" style={{ textAlign: 'center' }}>
                  Try fewer words, a longer period, or a simple topic like “sugar”, “cholesterol”
                  or “kidney”.
                </Text>
              </View>
            </Surface>
          ) : (
            byMonth.map((group) => (
              <View key={group.key} style={{ gap: space.sm }}>
                <Label>{group.label}</Label>
                <Surface padded={false} style={{ overflow: 'hidden' }}>
                  {group.items.map((document, index) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      first={index === 0}
                      ai={aiByDocument.get(document.id)}
                      onPress={() => actions(document)}
                    />
                  ))}
                </Surface>
              </View>
            ))
          )}
        </>
      )}

      {viewer}
    </Screen>
  );
}

/** One document: thumbnail, title, date and kind, tags, and whether AI read it. */
function DocumentRow({
  document,
  first,
  ai,
  onPress,
}: {
  document: HealthDocument;
  first: boolean;
  ai?: { analysisId: string; flagged: number; tags: string; topics: ReportTopic[] };
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const path = resolveImageUri(document.imageUri);
  const pdf = isPdfAttachment(path ?? document.imageUri);
  /*
   * What it is about: the AI's topics ("Blood sugar", flagged in amber when
   * something was off) when it was read, else the document's own tags.
   */
  const topics = ai?.topics ?? [];
  const tags = topics.length > 0 ? [] : (document.tags ?? '').split(' ').filter(Boolean);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${document.title}, ${DOCUMENT_KIND_LABEL[document.kind]}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: space.md,
        padding: space.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.hairline,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <View
        style={{
          width: 52,
          height: 64,
          borderRadius: radius.sm,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pdf ? colors.dangerSoft : colors.surfaceSunken,
        }}
      >
        {pdf ? (
          <>
            <Ionicons name="document-text" size={22} color={colors.danger} />
            <Text variant="label" color={colors.danger}>
              PDF
            </Text>
          </>
        ) : path ? (
          <Image source={{ uri: path }} style={{ width: 52, height: 64 }} resizeMode="cover" />
        ) : (
          <Ionicons
            name={document.imageUri ? 'cloud-download-outline' : 'document-text-outline'}
            size={22}
            color={colors.inkMuted}
          />
        )}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {document.title}
        </Text>
        <Text variant="caption" tone="secondary">
          {`${document.documentDate.toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })} · ${DOCUMENT_KIND_LABEL[document.kind]}`}
        </Text>
        {topics.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {topics.map((topic) => (
              <View
                key={topic.label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 3,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: radius.pill,
                  backgroundColor: topic.flagged ? colors.pendingSoft : colors.accentSoft,
                }}
              >
                {topic.flagged ? (
                  <Ionicons name="alert-circle" size={11} color={colors.pending} />
                ) : null}
                <Text variant="caption" style={{ fontSize: 11, fontWeight: '700' }}>
                  {topic.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {ai || tags.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {ai ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 3,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: radius.pill,
                  backgroundColor: ai.flagged > 0 ? colors.pendingSoft : colors.accentSoft,
                }}
              >
                <Ionicons
                  name="sparkles"
                  size={11}
                  color={ai.flagged > 0 ? colors.pending : colors.accent}
                />
                <Text variant="caption" style={{ fontSize: 11, fontWeight: '700' }}>
                  {ai.flagged > 0 ? `AI read · ${ai.flagged} to check` : 'AI read'}
                </Text>
              </View>
            ) : null}
            {tags.slice(0, 4).map((tag) => (
              <View
                key={tag}
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surfaceSunken,
                }}
              >
                <Text variant="caption" tone="secondary" style={{ fontSize: 11 }}>
                  {tag}
                </Text>
              </View>
            ))}
            {tags.length > 4 ? (
              <Text variant="caption" tone="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
                {`+${tags.length - 4}`}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <Ionicons name="ellipsis-horizontal" size={18} color={colors.inkMuted} style={{ alignSelf: 'center' }} />
    </Pressable>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        opacity: pressed ? 0.75 : 1,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.accent : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.hairline,
      })}
    >
      <Text
        variant="small"
        color={selected ? colors.inkInverse : colors.inkSecondary}
        style={{ fontWeight: selected ? '700' : '500' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
