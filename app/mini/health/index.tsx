import { BodyCard } from '~/features/health/components/BodyCard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import {
  Divider,
  Empty,
  Label,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import {
  AskAiBar,
  NumbersList,
  ReportStoryCard,
  WeekPlanCard,
} from '~/features/health/components/HealthHomeSections';
import { usePersonHealth } from '~/features/health/components/usePersonHealth';
import { useWeeklyPlan } from '~/features/health/components/useWeeklyPlan';
import { PersonCard } from '~/features/health/components/PersonCard';
import { isOutOfRange, readOverall } from '~/features/health/logic/labReports';
import { reportTopics, type ReportTopic } from '~/features/health/logic/documentSearch';
import {
  useDocumentViewer,
  type ViewableDocument,
} from '~/shared/components/DocumentViewer';
import { resolveImageUri } from '~/shared/lib/imageCache';
import { isPdfAttachment } from '~/shared/lib/imageRef';
import {
  describeDaysAway,
  healthStory,
  healthTimeline,
  upcoming,
  type StoryAnalysis,
  type StoryBlock,
  type TimelineEntry,
  type TimelineReading,
} from '~/features/health/logic/health';
import { formatMoney } from '~/shared/lib/money';
import {
  healthDocumentRepo,
  healthLabRepo,
  healthMedicineRepo,
  healthReadingRepo,
  healthVisitRepo,
} from '../../../src/db/repositories';
import {
  DOCUMENT_KIND_LABEL,
  relationLabel,
  type DocumentKind,
} from '../../../src/db/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { AnalyseRunBanner } from '~/features/health/components/AnalyseRunBanner';

/**
 * One person's health record — what happened, and what the numbers are doing.
 *
 * ## What this is for
 *
 * The real-world use is narrow and worth stating: you see a doctor, you come
 * away with a prescription and sometimes a lab report, and months later you
 * want to know what happened — what you were told, what you were put on, and
 * whether your sugar or pressure is better or worse than last time.
 *
 * An earlier version tried to be a medication tracker as well: log every dose,
 * score adherence, warn about refills. That is a different product with a
 * different owner (someone actively managing a daily regime), and the cost of
 * carrying it was a home screen that asked to be fed several times a day and
 * buried the actual record underneath the feeding.
 *
 * So the screen answers two questions and no others:
 *
 *   1. WHERE ARE THE NUMBERS NOW — latest sugar/pressure, with the direction of
 *      travel. Taken every month or three, so this is the "am I better?" line.
 *   2. WHAT HAPPENED, AND WHEN — visits, prescriptions and reports on one dated
 *      timeline, scrollable back through a year.
 */
export default function HealthHome() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const state = useAppStore();

  const people = state.healthPeople;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const person = people.find((p) => p.id === selectedId) ?? people[0];

  /*
   * Read straight from the repositories rather than through the store.
   *
   * Medical records are mini-app data: holding them globally would load a
   * family's history on every launch for the majority who never enable this.
   * `state.healthPeople` changes whenever anything here is written, which
   * re-runs these memos.
   */
  const medicines = useMemo(
    () => (person ? healthMedicineRepo.byPerson(person.id) : []),
    [person, state.healthPeople],
  );

  const visits = useMemo(
    () => (person ? healthVisitRepo.byPerson(person.id) : []),
    [person, state.healthPeople],
  );

  const documents = useMemo(
    () => (person ? healthDocumentRepo.byPerson(person.id) : []),
    [person, state.healthPeople],
  );

  const readings = useMemo<TimelineReading[]>(
    () =>
      person
        ? healthReadingRepo.byPerson(person.id).map((row) => ({
            id: row.id,
            personId: row.personId,
            visitId: row.visitId,
            metric: row.metric,
            value: row.value,
            valueSecondary: row.valueSecondary,
            unit: row.unit,
            context: row.context,
            measuredAt: row.measuredAt,
          }))
        : [],
    [person, state.healthPeople],
  );

  const timeline = useMemo(
    () =>
      healthTimeline({
        visits: visits.map((visit) => ({
          id: visit.id,
          personId: visit.personId,
          visitedAt: visit.visitedAt,
          kind: visit.kind,
          doctor: visit.doctor,
          facility: visit.facility,
          reason: visit.reason,
          diagnosis: visit.diagnosis,
          costMinor: visit.costMinor,
        })),
        medicines: medicines
          .filter((medicine) => medicine.startedOn)
          .map((medicine) => ({
            id: medicine.id,
            personId: medicine.personId,
            name: medicine.name,
            dosage: medicine.dosage,
            instructions: medicine.instructions,
            startedOn: medicine.startedOn!,
            visitId: medicine.visitId,
          })),
        documents: documents.map((document) => ({
          id: document.id,
          personId: document.personId,
          title: document.title,
          kind: document.kind,
          documentDate: document.documentDate,
          summary: document.summary,
          imageUri: document.imageUri,
          visitId: document.visitId,
        })),
        readings,
      }),
    [visits, medicines, documents, readings],
  );

  /** The timeline folded into episodes and runs — see `healthStory`. */
  /** AI read-throughs, so reports scanned together show as one session. */
  const storyAnalyses = useMemo<StoryAnalysis[]>(() => {
    if (!person) return [];
    const results = healthLabRepo.resultsByPerson(person.id);
    return healthLabRepo.analysesByPerson(person.id).map((analysis) => {
      let documentIds: string[] = [];
      try {
        documentIds = JSON.parse(analysis.documentIds) as string[];
      } catch {
        documentIds = [];
      }
      return {
        id: analysis.id,
        at: analysis.reportDate,
        headline: analysis.headline,
        condition: readOverall(analysis.overallJson).condition,
        flagged: results.filter((r) => r.analysisId === analysis.id && isOutOfRange(r.status)).length,
        documentIds,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, state.healthPeople]);

  const story = useMemo(() => healthStory(timeline, storyAnalyses), [timeline, storyAnalyses]);
  /** Only what happened — visits and report sets. Readings live in My numbers. */
  const history = useMemo(() => story.filter(isHistoryEvent), [story]);
  const visitCount = history.filter((b) => b.kind === 'episode').length;
  const reportCount = history.length - visitCount;

  /** The original paper behind a timeline entry, for the full-screen viewer. */
  const documentFor = (documentId: string): ViewableDocument | undefined => {
    const document = documents.find((d) => d.id === documentId);
    return document
      ? { ...document, kindLabel: DOCUMENT_KIND_LABEL[document.kind as DocumentKind] }
      : undefined;
  };
  const { open: openDocument, viewer: documentViewer } = useDocumentViewer();

  /**
   * What each report is about — "Blood sugar", "Cholesterol" — from the AI's
   * results, else its tags. Shown on every report in the timeline, so a row
   * says what it is without being opened.
   */
  const topicsByDocument = useMemo(() => {
    const map = new Map<string, ReportTopic[]>();
    if (!person) return map;
    const results = healthLabRepo.resultsByPerson(person.id);
    for (const document of documents) {
      map.set(
        document.id,
        reportTopics(
          results.filter((r) => r.documentId === document.id),
          document.tags,
        ),
      );
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, documents, state.healthPeople]);
  const topicsFor = (documentId: string) => topicsByDocument.get(documentId) ?? [];

  /** Appointments still ahead — the only forward-looking thing here. */
  const followUps = useMemo(
    () => upcoming(visits.map((visit) => ({ ...visit, followUpOn: visit.followUpOn })), new Date()),
    [visits],
  );


  const activeMedicines = medicines.filter((medicine) => medicine.isActive);

  /** Readings and lab results merged into one history per measure. */
  const health = usePersonHealth(person?.id, state.healthPeople);
  const plan = useWeeklyPlan(person, health);

  const [showAllHistory, setShowAllHistory] = useState(false);

  if (people.length === 0) {
    return (
      <Screen title="Health records" onBack={() => router.back()}>
        <Empty
          icon="heart-outline"
          title="Nobody added yet"
          message="Add yourself or a family member, then keep their visits, prescriptions, reports and readings in one place."
          actionLabel="Add a person"
          onAction={() => router.push('/mini/health/person')}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Health records"
      onBack={() => router.back()}
      /*
       * The header's add-person button is kept ONLY for the single-person case.
       *
       * With two or more people the strip below carries its own "Add" tile at
       * the end of the row, which is where someone looks when they notice a
       * family member is missing — two buttons for one action, a thumb-reach
       * apart, is just noise.
       */
      action={
        people.length > 1
          ? undefined
          : {
              icon: 'person-add-outline',
              label: 'Add a person',
              onPress: () => router.push('/mini/health/person'),
            }
      }
    >
      {/*
        The people strip: circular avatars, not name-and-relation pills.

        The pills carried the person's name AND relation side by side, so each
        was ~150pt wide and barely three fitted on a phone — a fourth family
        member was clipped mid-word ("Sanuli" showing as "San…") with nothing
        saying the strip scrolled. Both facts were also repeated verbatim in the
        hero card immediately below, so the width bought nothing.

        An avatar row is the standard shape for this control precisely because
        it scales: six people fit where three did, the coloured ring identifies
        the selection without needing a filled background, and the first name
        alone is enough to tell a family apart — the hero says who is selected
        in full.

        "Add" lives at the END of the strip rather than only in the header, so
        adding a family member is where you are already looking when you notice
        someone is missing.
      */}
      {people.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.md, paddingRight: space.lg, paddingVertical: 2 }}
        >
          {people.map((p) => {
            const active = p.id === person?.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => setSelectedId(p.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${p.name}${relationLabel(p) ? `, ${relationLabel(p)}` : ''}`}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                  alignItems: 'center',
                  gap: 5,
                  width: 62,
                })}
              >
                {/*
                  The ring is the selection mark.

                  Drawn as a padded outer circle rather than a border on the
                  avatar itself, so the avatar keeps its full size whether or
                  not it is selected — a border would make the selected one
                  visibly smaller inside the same footprint and the row would
                  jitter as you switch.
                */}
                <View
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 27,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: active ? p.color : 'transparent',
                  }}
                >
                  <View
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 23,
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      backgroundColor: active ? p.color : `${p.color}1A`,
                    }}
                  >
                    {p.imageUri ? (
                      <Image source={{ uri: p.imageUri }} style={{ width: 46, height: 46 }} />
                    ) : (
                      /*
                        A monogram, not a generic person glyph.

                        Every person carried the same silhouette, so the avatars
                        were told apart only by their tint — which fails for
                        anyone who cannot separate two similar hues, and reads
                        as four copies of one icon at a glance. An initial is
                        the thing that actually differs.
                      */
                      <Text
                        variant="bodyStrong"
                        color={active ? '#FFFFFF' : p.color}
                        style={{ fontSize: 19 }}
                      >
                        {p.name.trim().charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>
                </View>
                <Text
                  variant="caption"
                  numberOfLines={1}
                  tone={active ? undefined : 'muted'}
                  style={{ fontWeight: active ? '700' : '500' }}
                >
                  {/* First name only — "Thaaththa" fits, "Thaaththa Perera"
                      would not, and the hero carries the full identity. */}
                  {p.name.trim().split(' ')[0]}
                </Text>
              </Pressable>
            );
          })}

          {/* Adding someone, at the end of the row it belongs to. */}
          <Pressable
            onPress={() => router.push('/mini/health/person')}
            accessibilityRole="button"
            accessibilityLabel="Add a person"
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              alignItems: 'center',
              gap: 5,
              width: 62,
            })}
          >
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 27,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderStyle: 'dashed',
                  borderColor: colors.hairlineStrong,
                }}
              >
                <Ionicons name="add" size={22} color={colors.inkMuted} />
              </View>
            </View>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              Add
            </Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {/* Who this is, and the facts needed in a hurry. */}
      {person ? (
        <PersonCard
          person={person}
          weight={health.series.find((series) => series.testKey === 'weight')?.latest}
          onPress={() => router.push(`/mini/health/person?id=${person.id}`)}
        />
      ) : null}

      {/*
        Three questions, in the order people ask them:
          ASK AI                 — "I have a question" (answers anything)
          WHAT YOUR REPORTS SAY  — simple English: what needs work, the good news
          YOUR PLAN THIS WEEK    — today's exercise and meals, the week one tap away
        Then MY NUMBERS for looking things up, and the record itself below.
      */}
      {person ? (
        <>
          <AskAiBar personId={person.id} health={health} />
          <ReportStoryCard personId={person.id} health={health} />
          {health.series.length > 0 ? <WeekPlanCard personId={person.id} plan={plan} /> : null}
          <NumbersList personId={person.id} health={health} />
        </>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Label>ADD</Label>
        <Row gap={space.sm}>
          <QuickAction
            icon="scan-outline"
            label="Scan report"
            color={colors.accent}
            onPress={() => router.push(`/mini/health/analyze?person=${person?.id}`)}
          />
          <QuickAction
            icon="pulse-outline"
            label="Reading"
            color="#D6336C"
            onPress={() => router.push(`/mini/health/reading?person=${person?.id}`)}
          />
          <QuickAction
            icon="medkit-outline"
            label="Visit"
            color={colors.completed}
            onPress={() => router.push(`/mini/health/visit?person=${person?.id}`)}
          />
          <QuickAction
            icon="camera-outline"
            label="Photo"
            color="#8B5CF6"
            onPress={() => router.push(`/mini/health/document?person=${person?.id}`)}
          />
        </Row>
      </View>

      {person ? (
        <BodyCard
          person={person}
          weightSeries={health.series.find((series) => series.testKey === 'weight')}
          onEdit={() => router.push(`/mini/health/person?id=${person.id}`)}
        />
      ) : null}

      {/* Appointments ahead — the only forward-looking item in the record. */}
      {followUps.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>COMING UP</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {followUps.map((item, index) => (
              <View key={item.refId}>
                {index > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => router.push(`/mini/health/case?id=${item.refId}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Follow-up, ${describeDaysAway(item.daysAway)}`}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                  })}
                >
                  <Row
                    gap={space.md}
                    style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: radius.sm,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor:
                          item.daysAway < 0 ? colors.dangerSoft : colors.accentSoft,
                      }}
                    >
                      <Ionicons
                        name="calendar"
                        size={17}
                        color={item.daysAway < 0 ? colors.danger : colors.accent}
                      />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{item.title}</Text>
                      {item.detail ? (
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {item.detail}
                        </Text>
                      ) : null}
                    </View>
                    {/* Overdue is red — a missed appointment matters more than
                        a future one, not less. */}
                    <Text
                      variant="caption"
                      color={item.daysAway < 0 ? colors.danger : colors.accent}
                      style={{ fontWeight: '700' }}
                    >
                      {describeDaysAway(item.daysAway)}
                    </Text>
                  </Row>
                </Pressable>
              </View>
            ))}
          </Surface>
        </View>
      ) : null}

      {/*
        The two collections, as a segmented card rather than two text links.

        They were bare blue words floating between sections — easy to miss, and
        nothing about them said "these are places you can go" except the colour.
        As a single divided card they read as one control with two destinations,
        match the row treatment used everywhere else on this screen, and give
        the count somewhere to sit that is not glued to the noun.
      */}
      {/* An AI reading still going after the Analyse screen was left. */}
      <AnalyseRunBanner personId={person?.id} />

      <Surface padded={false} style={{ overflow: 'hidden' }}>
        <BrowseRow
          icon="medical-outline"
          tint={colors.completed}
          label="Medicines"
          detail={
            activeMedicines.length > 0
              ? `${activeMedicines.length} being taken`
              : 'Nothing recorded'
          }
          onPress={() => router.push(`/mini/health/prescriptions?person=${person?.id}`)}
        />
        <Divider />
        <BrowseRow
          icon="document-text-outline"
          tint="#8B5CF6"
          label="Papers and photos"
          detail={
            documents.length > 0
              ? `${documents.length} saved`
              : 'Nothing photographed yet'
          }
          onPress={() => router.push(`/mini/health/documents?person=${person?.id}`)}
        />
        <Divider />
        <BrowseRow
          icon="flask-outline"
          tint={colors.accent}
          label="All test results"
          detail={
            health.series.length > 0
              ? `${health.series.length} tests, each with its chart`
              : 'Scan a report to start'
          }
          onPress={() => router.push(`/mini/health/labs?person=${person?.id}`)}
        />
      </Surface>

      {/*
        THE STORY — the main thing on this screen.

        Drawn against a vertical rail with a dated node per block, because a
        health record is read as a sequence and a stack of separate cards does
        not show sequence at all. Each block is one THING THAT HAPPENED:

          - an episode carries its own contents, so a consultation and the
            prescription and report it produced read as one event rather than
            three coincidences on nearby dates;
          - a run of routine readings collapses to a single line with its
            direction of travel, so seven home checks stop burying the one
            consultation that mattered.
      */}
      {history.length === 0 ? (
        <Empty
          icon="time-outline"
          title="No visits or reports yet"
          message="Doctor visits and reports read by AI appear here, newest first, with what each one found."
        />
      ) : (
        <View style={{ gap: space.sm }}>
          <Row style={{ alignItems: 'center', paddingHorizontal: space.xs }}>
            <Label>VISITS AND REPORTS</Label>
            <View style={{ flex: 1 }} />
            <Text variant="caption" tone="secondary">
              {[
                visitCount > 0 ? `${visitCount} ${visitCount === 1 ? 'visit' : 'visits'}` : null,
                reportCount > 0
                  ? `${reportCount} ${reportCount === 1 ? 'report' : 'reports'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Row>

          <View>
            {/* The most recent few; the rest one tap away, so a long record
                does not push everything after it off the end of the screen. */}
            {(showAllHistory ? history : history.slice(0, HISTORY_PREVIEW)).map(
              (block, index, shown) => {
                const previous = shown[index - 1];
                const newYear = !previous || previous.at.getFullYear() !== block.at.getFullYear();
                return (
                  <View key={block.id}>
                    {newYear ? <YearHeading at={block.at} /> : null}
                    <HistoryEvent
                      block={block}
                      topicsFor={topicsFor}
                      documentFor={documentFor}
                      onOpenDocument={openDocument}
                      currency={state.currency}
                      first={index === 0}
                      last={index === shown.length - 1}
                    />
                  </View>
                );
              },
            )}
          </View>
          {history.length > HISTORY_PREVIEW ? (
            <Pressable
              onPress={() => setShowAllHistory((v) => !v)}
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'center' })}
            >
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                {showAllHistory ? 'Show less' : `Show all ${history.length}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {documentViewer}

      {/*
        Where this data lives, said once at the bottom.

        Health records are the most sensitive thing the app holds, and the app
        can upload backups to Google Drive — so the fact that this particular
        data does NOT go automatically is worth stating.
      */}
      <Row gap={space.sm} style={{ paddingHorizontal: space.xs, alignItems: 'flex-start' }}>
        <Ionicons
          name="lock-closed-outline"
          size={15}
          color={colors.inkMuted}
          style={{ marginTop: 1 }}
        />
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          Health records stay on this phone, and report photos are copied to your
          Google Drive when it is connected. Reports are sent to Google Gemini
          only when you choose to read them with AI.
        </Text>
      </Row>
    </Screen>
  );
}

/** How many history blocks show before "Show all". */
const HISTORY_PREVIEW = 3;


function QuickAction({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Add a ${label.toLowerCase()}`}
      style={({ pressed }) => ({
        flex: 1,
        opacity: pressed ? 0.75 : 1,
        alignItems: 'center',
        gap: 6,
        paddingVertical: space.md,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${color}1A`,
        }}
      >
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A row leading to one of the browsable collections.
 *
 * Carries a count as a SENTENCE ("3 saved") rather than a bare number in
 * brackets: "Reports (3)" reads as a label with a footnote, while "3 saved"
 * tells you the state of the collection — and it has somewhere sensible to say
 * "nothing yet", which the bracket form did not.
 */
function BrowseRow({
  icon,
  tint,
  label,
  detail,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label: string;
  detail: string;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${tint}1A`,
        }}
      >
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
    </Pressable>
  );
}

/**
 * The blocks the history is made of: things that HAPPENED, each one a doctor
 * visit or a set of reports. Home readings are numbers, not events — they live
 * in My numbers with their trend — and a weight check between two consultations
 * buried the consultations.
 */
type HistoryBlock = Extract<StoryBlock, { kind: 'episode' | 'session' }> | {
  kind: 'single';
  id: string;
  at: Date;
  entry: TimelineEntry;
};

function isHistoryEvent(block: StoryBlock): block is HistoryBlock {
  // A loose, unread photo is paper, not an answer: it stays in Documents
  // until it is read, and then arrives here as a session with its verdict.
  return block.kind === 'episode' || block.kind === 'session';
}

/**
 * One event on the history rail.
 *
 * Every event has the same anatomy, so a year of them can be scanned:
 *
 *   WHAT + WHEN    — "Doctor visit" / "Lab reports", the date
 *   TITLE          — the diagnosis or reason, or what was tested
 *   VERDICT        — the AI's read of the reports and how many results were
 *                    off; "Not read by AI" with the action when it was not
 *   OUTCOME        — what was prescribed
 *   ORIGINALS      — the papers themselves, one tap from full screen
 *
 * The rail node takes the verdict's colour, so scanning down the rail shows
 * WHEN things were off without reading a card.
 */
function HistoryEvent({
  block,
  topicsFor,
  documentFor,
  onOpenDocument,
  currency,
  first,
  last,
}: {
  block: HistoryBlock;
  topicsFor: (documentId: string) => ReportTopic[];
  documentFor: (documentId: string) => ViewableDocument | undefined;
  onOpenDocument: (document: ViewableDocument) => void;
  currency: string;
  first: boolean;
  last: boolean;
}) {
  const { colors, radius, space } = useTheme();
  const router = useRouter();

  const documents =
    block.kind === 'episode'
      ? block.records.filter((r) => r.kind === 'document')
      : block.kind === 'session'
        ? block.documents
        : [block.entry];
  const medicines = block.kind === 'episode' ? block.records.filter((r) => r.kind === 'medicine') : [];
  const analyses: StoryAnalysis[] =
    block.kind === 'episode'
      ? (block.analyses ?? [])
      : block.kind === 'session'
        ? [block.analysis]
        : [];
  const analysis = analyses[0];
  const topics = mergeTopics(documents.map((d) => topicsFor(d.refId)));

  const isVisit = block.kind === 'episode';
  const kindLabel = isVisit
    ? 'Doctor visit'
    : documents.length > 1
      ? 'Lab reports'
      : block.kind === 'single' && block.entry.documentKind
        ? (DOCUMENT_KIND_LABEL[block.entry.documentKind as DocumentKind] ?? 'Report')
        : 'Report';
  const kindIcon: keyof typeof Ionicons.glyphMap = isVisit ? 'medkit' : 'flask';
  const kindColor = isVisit ? colors.accent : REPORT_COLOR;

  const [allPapers, setAllPapers] = useState(false);
  const title = isVisit
    ? block.visit.title
    : documents.length === 1
      ? documents[0].title
      : `${documents.length} reports`;
  const cost = isVisit ? block.visit.costMinor : undefined;
  const date = block.at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const subtitle = [
    date,
    isVisit ? block.visit.detail : null,
    cost ? formatMoney(cost, { currency }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /*
   * The verdict in plain words: how many results need a look, never the AI's
   * "Unclear" condition label, and its headline only when it says something
   * ("Your reports have been read" does not).
   */
  const ok = analysis ? analysis.flagged === 0 : null;
  const verdictColor = ok === null ? kindColor : ok ? colors.completed : colors.pending;
  const headline =
    analysis?.headline && !/^(your )?(reports?|results?) (have|has) been (read|analy[sz]ed)\.?$/i.test(analysis.headline.trim())
      ? analysis.headline
      : null;

  /** The detail page: the visit with everything in it, else the AI's read, else the paper. */
  const open = () => {
    if (block.kind === 'episode') return router.push(`/mini/health/case?id=${block.visit.refId}`);
    if (analysis) return router.push(`/mini/health/analysis?id=${analysis.id}`);
    const doc = documents[0] && documentFor(documents[0].refId);
    if (doc) onOpenDocument(doc);
  };

  const PAPERS_PREVIEW = 3;
  const papers = allPapers ? documents : documents.slice(0, PAPERS_PREVIEW);

  return (
    <Row gap={space.sm} style={{ alignItems: 'stretch' }}>
      {/* The rail: a node in the verdict's colour, the line on to the next event. */}
      <View style={{ width: 16, alignItems: 'center' }}>
        <View style={{ width: 2, height: space.lg + 10, backgroundColor: first ? 'transparent' : colors.hairlineStrong }} />
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: verdictColor,
            borderWidth: 3,
            borderColor: colors.canvas,
          }}
        />
        <View style={{ flex: 1, width: 2, backgroundColor: last ? 'transparent' : colors.hairlineStrong }} />
      </View>

      <View style={{ flex: 1, paddingBottom: space.md }}>
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          <Pressable
            onPress={open}
            accessibilityRole="button"
            accessibilityLabel={`${kindLabel}, ${title}, ${date}`}
            style={({ pressed }) => ({
              padding: space.lg,
              gap: space.md,
              backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
            })}
          >
            {/* What, which and when. */}
            <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: `${kindColor}22`,
                }}
              >
                <Ionicons name={kindIcon} size={20} color={kindColor} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
                  {kindLabel}
                </Text>
                <Text variant="heading" numberOfLines={2}>
                  {title}
                </Text>
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} style={{ marginTop: 2 }} />
            </Row>

            {/* What it found, in words. */}
            {analysis ? (
              <View
                style={{
                  gap: 4,
                  padding: space.md,
                  borderRadius: radius.md,
                  backgroundColor: ok ? colors.completedSoft : colors.pendingSoft,
                }}
              >
                <Row gap={6}>
                  <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={verdictColor} />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {ok
                      ? 'All results are normal'
                      : `${analysis.flagged} ${analysis.flagged === 1 ? 'result needs' : 'results need'} a look`}
                  </Text>
                </Row>
                {headline ? (
                  <Text variant="small" tone="secondary" numberOfLines={3} style={{ paddingLeft: 24 }}>
                    {headline}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* What was tested, with anything off marked. */}
            {topics.length > 0 ? <TopicChips topics={topics} /> : null}

            {/* What came out of it. */}
            {medicines.length > 0 ? (
              <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
                <Ionicons name="medical" size={15} color={colors.completed} style={{ marginTop: 1 }} />
                <Text variant="small" tone="secondary" style={{ flex: 1 }} numberOfLines={2}>
                  <Text variant="small" style={{ fontWeight: '700' }}>
                    Prescribed{' '}
                  </Text>
                  {medicines.map((m) => m.title).join(', ')}
                </Text>
              </Row>
            ) : null}
          </Pressable>

          {/* The reports by name, each one tap from full screen. */}
          {documents.length > 1 || (documents.length === 1 && isVisit) ? (
            <>
              <Divider />
              {papers.map((d, index) => {
                const doc = documentFor(d.refId);
                const pdf = isPdfAttachment(resolveImageUri(d.imageUri) ?? d.imageUri);
                return (
                  <View key={d.id}>
                    {index > 0 ? <Divider style={{ marginLeft: space.lg + 30 + space.md }} /> : null}
                    <Pressable
                      onPress={() => (doc ? onOpenDocument(doc) : undefined)}
                      disabled={!doc}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${d.title}`}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        paddingHorizontal: space.lg,
                        paddingVertical: space.sm,
                        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                      })}
                    >
                      <PaperThumb imageUri={d.imageUri} small />
                      <View style={{ flex: 1 }}>
                        <Text variant="body" numberOfLines={2}>
                          {d.title}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {pdf ? 'PDF' : 'Photo'}
                        </Text>
                      </View>
                      <Ionicons name="open-outline" size={16} color={colors.inkMuted} />
                    </Pressable>
                  </View>
                );
              })}
              {documents.length > PAPERS_PREVIEW ? (
                <>
                  <Divider />
                  <Pressable
                    onPress={() => setAllPapers((v) => !v)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      paddingVertical: space.md,
                      backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                    })}
                  >
                    <Text variant="small" tone="accent" style={{ fontWeight: '700' }}>
                      {allPapers ? 'Show fewer' : `Show all ${documents.length} reports`}
                    </Text>
                    <Ionicons name={allPapers ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accent} />
                  </Pressable>
                </>
              ) : null}
            </>
          ) : null}

          {/* A visit whose reports were read: the read is one tap away too. */}
          {isVisit && analysis ? (
            <>
              <Divider />
              <Pressable
                onPress={() => router.push(`/mini/health/analysis?id=${analysis.id}`)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                  backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                })}
              >
                <Ionicons name="document-text-outline" size={16} color={colors.accent} />
                <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
                  Read the full analysis
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </Pressable>
            </>
          ) : null}
        </Surface>
      </View>
    </Row>
  );
}

/** A month heading inside the timeline, so a long record has landmarks. */
function YearHeading({ at }: { at: Date }) {
  const { space } = useTheme();
  return (
    <Row gap={space.sm} style={{ paddingTop: space.sm }}>
      <View style={{ width: 34 }} />
      <Label>{String(at.getFullYear())}</Label>
    </Row>
  );
}

/** A page-shaped thumbnail of an original: its photo, or a PDF mark. */
function PaperThumb({ imageUri, small = false }: { imageUri?: string | null; small?: boolean }) {
  const { colors, radius } = useTheme();
  const w = small ? 30 : 52;
  const h = small ? 38 : 66;
  const path = resolveImageUri(imageUri);
  const pdf = isPdfAttachment(path ?? imageUri);
  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: radius.sm,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: pdf ? colors.dangerSoft : colors.surfaceSunken,
      }}
    >
      {path && !pdf ? (
        <Image source={{ uri: path }} style={{ width: w, height: h }} resizeMode="cover" />
      ) : (
        <>
          <Ionicons
            name={pdf ? 'document-text' : imageUri ? 'cloud-download-outline' : 'document-text-outline'}
            size={small ? 16 : 22}
            color={pdf ? colors.danger : colors.inkMuted}
          />
          {pdf && !small ? (
            <Text variant="label" color={colors.danger}>
              PDF
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * What a report is about, as small chips — "Blood sugar", "Kidney". A topic
 * with anything out of range is amber with an icon, so "your sugar report
 * had something to check" is visible on the timeline itself.
 */
function TopicChips({ topics }: { topics: ReportTopic[] }) {
  const { colors, radius } = useTheme();
  if (topics.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {topics.map((topic) => (
        <View
          key={topic.label}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: radius.pill,
            backgroundColor: topic.flagged ? colors.pendingSoft : colors.surfaceSunken,
          }}
        >
          {topic.flagged ? <Ionicons name="alert-circle" size={12} color={colors.pending} /> : null}
          <Text
            variant="caption"
            tone={topic.flagged ? 'ink' : 'secondary'}
            style={{ fontWeight: topic.flagged ? '700' : '500' }}
          >
            {topic.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Topics across several reports, deduplicated, flagged first. */
function mergeTopics(lists: ReportTopic[][], limit = 4): ReportTopic[] {
  const merged = new Map<string, boolean>();
  for (const list of lists) {
    for (const t of list) merged.set(t.label, (merged.get(t.label) ?? false) || t.flagged);
  }
  return [...merged.entries()]
    .map(([label, flagged]) => ({ label, flagged }))
    .sort((a, b) => Number(b.flagged) - Number(a.flagged))
    .slice(0, limit);
}

/** The report colour used across the health screens (the "Photo" quick action). */
const REPORT_COLOR = '#8B5CF6';

