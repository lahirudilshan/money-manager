import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import {
  Divider,
  Empty,
  GradientCard,
  Label,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import {
  describeDaysAway,
  formatReading,
  healthStory,
  healthTimeline,
  trend,
  upcoming,
  type StoryBlock,
  type TimelineEntry,
  type TimelineReading,
} from '~/features/health/logic/health';
import { formatMoney } from '~/shared/lib/money';
import {
  healthDocumentRepo,
  healthMedicineRepo,
  healthReadingRepo,
  healthVisitRepo,
} from '../../../src/db/repositories';
import {
  DOCUMENT_KIND_LABEL,
  HEALTH_METRIC_LABEL,
  HEALTH_METRIC_UNIT,
  relationLabel,
  type DocumentKind,
  type HealthMetric,
} from '../../../src/db/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

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
  const story = useMemo(() => healthStory(timeline), [timeline]);

  /** Appointments still ahead — the only forward-looking thing here. */
  const followUps = useMemo(
    () => upcoming(visits.map((visit) => ({ ...visit, followUpOn: visit.followUpOn })), new Date()),
    [visits],
  );

  /**
   * The latest figure per metric, with its direction of travel.
   *
   * This is the headline the whole feature exists for: someone taking a sugar
   * reading every month or two wants "132, down from 141" without opening
   * anything. Computed per metric because a mixed list of measurements cannot
   * be compared.
   */
  const latestByMetric = useMemo(() => {
    const metrics = [...new Set(readings.map((reading) => reading.metric))] as HealthMetric[];

    return metrics
      .map((metric) => ({ metric, series: trend(readings, { metric }) }))
      .filter((entry) => entry.series.latest !== null)
      // Most recently measured first, so the metric being actively tracked
      // leads rather than whichever happens to sort first alphabetically.
      .sort(
        (a, b) =>
          (b.series.latest?.at.getTime() ?? 0) - (a.series.latest?.at.getTime() ?? 0),
      );
  }, [readings]);

  const activeMedicines = medicines.filter((medicine) => medicine.isActive);

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

      {/*
        The hero — who this is, and the facts that matter in a hurry.

        Modelled on the Dashboard's balance card so the add-on looks like part
        of the app rather than a bolt-on. Tinted by the person's own colour, so
        switching family members recolours the screen and you can tell at a
        glance whose record you are in.
      */}
      {person ? (
        <Pressable
          onPress={() => router.push(`/mini/health/person?id=${person.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`${person.name}'s profile`}
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <GradientCard gradient={[person.color, shade(person.color)]}>
            <View style={{ gap: space.lg }}>
              <Row gap={space.md}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.22)',
                    overflow: 'hidden',
                  }}
                >
                  {person.imageUri ? (
                    <Image source={{ uri: person.imageUri }} style={{ width: 44, height: 44 }} />
                  ) : (
                    // The same monogram the strip above uses, so the selected
                    // avatar and the hero read as the same object.
                    <Text variant="bodyStrong" color="#FFFFFF" style={{ fontSize: 19 }}>
                      {person.name.trim().charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="title" color="#FFFFFF" numberOfLines={1}>
                    {person.name}
                  </Text>
                  <Text variant="caption" color="rgba(255,255,255,0.75)">
                    {[relationLabel(person), person.bornOn ? `${age(person.bornOn)} years` : null]
                      .filter(Boolean)
                      .join(' · ') || 'Tap to add details'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
              </Row>

              {/* Blood group and allergies — what someone opens this for when
                  they cannot scroll. Never below the fold. */}
              {person.bloodGroup || person.allergies ? (
                <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                  {person.bloodGroup ? (
                    <Row
                      gap={5}
                      style={{
                        paddingHorizontal: space.sm,
                        paddingVertical: 5,
                        borderRadius: radius.sm,
                        backgroundColor: 'rgba(255,255,255,0.22)',
                      }}
                    >
                      <Ionicons name="water-outline" size={13} color="#FFFFFF" />
                      <Text variant="caption" color="#FFFFFF" style={{ fontWeight: '800' }}>
                        {person.bloodGroup}
                      </Text>
                    </Row>
                  ) : null}
                  {person.allergies ? (
                    <Row
                      gap={5}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        paddingHorizontal: space.sm,
                        paddingVertical: 5,
                        borderRadius: radius.sm,
                        backgroundColor: 'rgba(255,255,255,0.22)',
                      }}
                    >
                      <Ionicons name="alert-circle-outline" size={13} color="#FFFFFF" />
                      <Text
                        variant="caption"
                        color="#FFFFFF"
                        numberOfLines={1}
                        style={{ fontWeight: '700', flex: 1 }}
                      >
                        {person.allergies}
                      </Text>
                    </Row>
                  ) : null}
                </Row>
              ) : null}
            </View>
          </GradientCard>
        </Pressable>
      ) : null}

      {/*
        THE NUMBERS — the answer to "am I better than last time?".

        Sits directly under the hero because for the person this feature is
        actually for — sugar or pressure checked every month or three — it is
        the whole point. Each card carries the latest figure and how it moved,
        and opens the full chart.
      */}
      {latestByMetric.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Row style={{ alignItems: 'center', paddingHorizontal: space.xs }}>
            <Label>LATEST READINGS</Label>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => router.push(`/mini/health/vitals?person=${person?.id}`)}
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                See trends
              </Text>
            </Pressable>
          </Row>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
          >
            {latestByMetric.map(({ metric, series }) => (
              <ReadingCard
                key={metric}
                metric={metric}
                series={series}
                onPress={() =>
                  router.push(`/mini/health/vitals?person=${person?.id}&metric=${metric}`)
                }
              />
            ))}
          </ScrollView>
        </View>
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
      {story.length === 0 ? (
        <Empty
          icon="time-outline"
          title="Nothing recorded yet"
          message="Add a visit, a reading or a photo of a report and it appears here, newest first."
        />
      ) : (
        <View style={{ gap: space.sm }}>
          <Row style={{ alignItems: 'center', paddingHorizontal: space.xs }}>
            <Label>HISTORY</Label>
            <View style={{ flex: 1 }} />
            <Text variant="caption" tone="muted">
              {story.length} {story.length === 1 ? 'entry' : 'entries'}
            </Text>
          </Row>

          <View>
            {story.map((block, index) => (
              <StoryRow
                key={block.id}
                block={block}
                currency={state.currency}
                personId={person?.id ?? ''}
                last={index === story.length - 1}
              />
            ))}
          </View>
        </View>
      )}

      {/*
        ADD — the three things that actually get recorded.

        A visit, a reading, or a photograph of paper. Medicines are added from
        inside a visit (that is where a prescription comes from) or from the
        prescriptions list, so they do not need a fourth button competing here.
      */}
      <View style={{ gap: space.sm }}>
        <Label>ADD</Label>
        <Row gap={space.sm}>
          <QuickAction
            icon="medkit-outline"
            label="Visit"
            color={colors.accent}
            onPress={() => router.push(`/mini/health/visit?person=${person?.id}`)}
          />
          <QuickAction
            icon="pulse-outline"
            label="Reading"
            color="#D6336C"
            onPress={() => router.push(`/mini/health/reading?person=${person?.id}`)}
          />
          <QuickAction
            icon="camera-outline"
            label="Report"
            color="#8B5CF6"
            onPress={() => router.push(`/mini/health/document?person=${person?.id}`)}
          />
        </Row>
      </View>

      {/*
        The two collections, as a segmented card rather than two text links.

        They were bare blue words floating between sections — easy to miss, and
        nothing about them said "these are places you can go" except the colour.
        As a single divided card they read as one control with two destinations,
        match the row treatment used everywhere else on this screen, and give
        the count somewhere to sit that is not glued to the noun.
      */}
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
          label="Prescriptions & reports"
          detail={
            documents.length > 0
              ? `${documents.length} saved`
              : 'Nothing photographed yet'
          }
          onPress={() => router.push(`/mini/health/documents?person=${person?.id}`)}
        />
      </Surface>

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
          Health records stay on this phone. They are only included in a backup
          if you tick "Health records" when backing up.
        </Text>
      </Row>
    </Screen>
  );
}

/** Whole years since a date — the age shown beside a person's name. */
function age(bornOn: Date): number {
  return Math.floor((Date.now() - bornOn.getTime()) / (365.25 * 86_400_000));
}

/**
 * A darker partner for a person's colour, so the hero has a real gradient.
 *
 * A gradient between one colour and itself is a flat fill. Multiplying each
 * channel keeps the hue and just deepens it, which holds for every colour in
 * the person palette without a second value needing to be stored.
 */
function shade(hex: string, factor = 0.72): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return hex;

  const channel = (start: number) =>
    Math.round(Number.parseInt(value.slice(start, start + 2), 16) * factor)
      .toString(16)
      .padStart(2, '0');

  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/**
 * One metric's latest figure and which way it moved.
 *
 * The direction is deliberately NOT coloured good or bad. Down is better for
 * blood pressure and worse for oxygen, and this app has no business making that
 * call — it records, a doctor interprets.
 */
function ReadingCard({
  metric,
  series,
  onPress,
}: {
  metric: HealthMetric;
  series: ReturnType<typeof trend>;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const unit = HEALTH_METRIC_UNIT[metric];
  const latest = series.latest;
  if (!latest) return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${HEALTH_METRIC_LABEL[metric]} trend`}
      style={({ pressed }) => ({
        opacity: pressed ? 0.8 : 1,
        minWidth: 132,
        gap: 6,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
      })}
    >
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {HEALTH_METRIC_LABEL[metric]}
      </Text>
      <Row gap={4} style={{ alignItems: 'baseline' }}>
        <Text variant="figure">
          {formatReading({
            metric,
            value: latest.value,
            valueSecondary: latest.valueSecondary,
            unit: null,
          })}
        </Text>
        {unit ? (
          <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
            {unit}
          </Text>
        ) : null}
      </Row>
      <Row gap={4}>
        {series.direction && series.change !== null ? (
          <>
            <Ionicons
              name={
                series.direction === 'up'
                  ? 'arrow-up'
                  : series.direction === 'down'
                    ? 'arrow-down'
                    : 'remove'
              }
              size={12}
              color={colors.inkMuted}
            />
            <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
              {series.direction === 'flat'
                ? 'No change'
                : `${Math.abs(series.change) % 1 === 0 ? Math.abs(series.change) : Math.abs(series.change).toFixed(1)} since first`}
            </Text>
          </>
        ) : (
          <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
            {latest.at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </Text>
        )}
      </Row>
    </Pressable>
  );
}

/** One of the three "add" buttons. */
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
 * One block on the timeline, drawn against the rail.
 *
 * The rail is a hairline running down the left with a node per block, which is
 * what turns a stack of cards into a SEQUENCE — the thing a health record is
 * read as. The node carries the block's colour so the kind is legible before
 * any text is, and the line is omitted on the last block so the timeline ends
 * rather than trailing off.
 */
function StoryRow({
  block,
  currency,
  personId,
  last,
}: {
  block: StoryBlock;
  currency: string;
  personId: string;
  last: boolean;
}) {
  const { colors, space, radius } = useTheme();
  const router = useRouter();

  const style =
    block.kind === 'episode'
      ? TIMELINE_STYLE.visit
      : block.kind === 'readings'
        ? TIMELINE_STYLE.reading
        : TIMELINE_STYLE[block.entry.kind];
  const tint = style.color(colors);

  const open = () => {
    if (block.kind === 'episode') {
      router.push(`/mini/health/case?id=${block.visit.refId}`);
      return;
    }
    if (block.kind === 'readings') {
      router.push(`/mini/health/vitals?person=${personId}&metric=${block.metric}`);
      return;
    }
    const entry = block.entry;
    if (entry.kind === 'medicine') router.push(`/mini/health/medicine?id=${entry.refId}`);
    else if (entry.kind === 'document') router.push(`/mini/health/documents?person=${personId}`);
    else router.push(`/mini/health/vitals?person=${personId}`);
  };

  return (
    <Row gap={space.md} style={{ alignItems: 'stretch' }}>
      {/* The rail: node, then the line down to the next block. */}
      <View style={{ width: 22, alignItems: 'center' }}>
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            marginTop: 16,
            backgroundColor: tint,
            // A ring in the canvas colour so the node reads as sitting ON the
            // line rather than being a bead threaded onto it.
            borderWidth: 3,
            borderColor: colors.canvas,
          }}
        />
        {!last ? (
          <View style={{ flex: 1, width: 2, backgroundColor: colors.hairline, marginTop: -2 }} />
        ) : null}
      </View>

      <View style={{ flex: 1, paddingBottom: space.md }}>
        {/* The date leads each block — the axis the whole screen is read on. */}
        <Text variant="caption" tone="muted" style={{ marginBottom: 5, marginTop: 11 }}>
          {block.at.toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: block.at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
          })}
        </Text>

        <Pressable
          onPress={open}
          accessibilityRole="button"
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <Surface style={{ gap: space.sm }}>
            {block.kind === 'readings' ? (
              <ReadingRun block={block} />
            ) : block.kind === 'episode' ? (
              <EpisodeBody block={block} currency={currency} />
            ) : (
              <SingleBody entry={block.entry} currency={currency} />
            )}
          </Surface>
        </Pressable>
      </View>
    </Row>
  );
}

/** A consultation, with everything it produced listed underneath. */
function EpisodeBody({
  block,
  currency,
}: {
  block: Extract<StoryBlock, { kind: 'episode' }>;
  currency: string;
}) {
  const { colors, space, radius } = useTheme();
  const { visit, records } = block;

  return (
    <>
      <Row gap={space.md}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accentSoft,
          }}
        >
          <Ionicons name="medkit" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {visit.title}
          </Text>
          {visit.detail ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {visit.detail}
            </Text>
          ) : null}
        </View>
        {visit.costMinor ? (
          <Text variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
            {formatMoney(visit.costMinor, { currency })}
          </Text>
        ) : null}
      </Row>

      {/*
        What came out of it, indented under the consultation.

        This is the whole point of an episode block: the prescription and the
        report are consequences of the visit, and showing them inside it says
        so in a way three sibling rows on nearby dates never could.
      */}
      {records.length > 0 ? (
        <View
          style={{
            gap: 7,
            paddingTop: space.sm,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
          }}
        >
          {records.map((record) => {
            const recordStyle = TIMELINE_STYLE[record.kind];
            const recordTint = recordStyle.color(colors);
            return (
              <Row key={record.id} gap={space.sm}>
                <Ionicons name={recordStyle.icon} size={14} color={recordTint} />
                <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                  {record.title}
                </Text>
                {record.imageUri ? (
                  <Image
                    source={{ uri: record.imageUri }}
                    style={{ width: 20, height: 20, borderRadius: 4 }}
                  />
                ) : null}
              </Row>
            );
          })}
        </View>
      ) : null}
    </>
  );
}

/**
 * A run of routine readings, as one line with its direction of travel.
 *
 * "7 readings · 148/95 → 129/82" is what a reader wants from six weeks of home
 * checks; the individual rows are on the trends screen for anyone who wants
 * them. Showing them here instead buried the one consultation that mattered
 * under noise nobody reads line by line.
 */
function ReadingRun({ block }: { block: Extract<StoryBlock, { kind: 'readings' }> }) {
  const { colors, space, radius } = useTheme();
  const first = block.entries[0]!;
  const latest = block.entries[block.entries.length - 1]!;
  const label = HEALTH_METRIC_LABEL[block.metric as HealthMetric] ?? 'Readings';

  return (
    <Row gap={space.md}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#D6336C1A',
        }}
      >
        <Ionicons name="pulse-outline" size={18} color="#D6336C" />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {label}
        </Text>
        <Row gap={6}>
          <Text variant="caption" tone="muted">
            {block.entries.length} readings
          </Text>
          {/* First → latest, so the stretch reads in the direction of time. */}
          <Text variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
            {first.title} → {latest.title}
          </Text>
        </Row>
      </View>
      <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
    </Row>
  );
}

/** A record standing on its own — no visit, no run. */
function SingleBody({ entry, currency }: { entry: TimelineEntry; currency: string }) {
  const { colors, space, radius } = useTheme();
  const style = TIMELINE_STYLE[entry.kind];
  const tint = style.color(colors);

  return (
    <Row gap={space.md}>
      {entry.kind === 'document' && entry.imageUri ? (
        <Image
          source={{ uri: entry.imageUri }}
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            backgroundColor: colors.surfaceSunken,
          }}
        />
      ) : (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: `${tint}1A`,
          }}
        >
          <Ionicons name={style.icon} size={18} color={tint} />
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {entry.title}
        </Text>
        <Row gap={6}>
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 1,
              borderRadius: 4,
              backgroundColor: `${tint}1A`,
            }}
          >
            <Text variant="caption" color={tint} style={{ fontWeight: '800', fontSize: 10 }}>
              {entry.kind === 'document' && entry.documentKind
                ? (DOCUMENT_KIND_LABEL[entry.documentKind as DocumentKind] ?? style.label)
                : style.label}
            </Text>
          </View>
          {entry.detail ? (
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {entry.detail}
            </Text>
          ) : null}
        </Row>
      </View>
      {entry.costMinor ? (
        <Text variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
          {formatMoney(entry.costMinor, { currency })}
        </Text>
      ) : null}
    </Row>
  );
}

/**
 * Per-kind styling for a timeline row — the only place the types differ.
 *
 * `color` is a function of the theme so the types that map onto existing
 * semantic colours follow the palette in both light and dark, while documents
 * and readings carry their own hues — neither has a semantic equivalent, and
 * borrowing one would make a lab report look like a payment.
 */
const TIMELINE_STYLE: Record<
  TimelineEntry['kind'],
  {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    color: (colors: ReturnType<typeof useTheme>['colors']) => string;
  }
> = {
  visit: { icon: 'medkit-outline', label: 'Visit', color: (c) => c.accent },
  medicine: { icon: 'medical-outline', label: 'Prescribed', color: (c) => c.completed },
  document: { icon: 'document-text-outline', label: 'Report', color: () => '#8B5CF6' },
  reading: { icon: 'pulse-outline', label: 'Reading', color: () => '#D6336C' },
};
