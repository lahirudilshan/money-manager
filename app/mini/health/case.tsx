import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Divider, Label, Row, Surface, Text } from '../../../src/components/ui';
import { Screen } from '../../../src/components/Screen';
import { describeDaysAway, formatReading } from '../../../src/core/health';
import { formatMoney } from '../../../src/core/money';
import {
  healthDocumentRepo,
  healthMedicineRepo,
  healthReadingRepo,
  healthVisitRepo,
} from '../../../src/db/repositories';
import {
  DOCUMENT_KIND_LABEL,
  READING_CONTEXT_LABEL,
  VISIT_KIND_LABEL,
  type DocumentKind,
  type ReadingContext,
} from '../../../src/db/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * One visit, and everything that came out of it — the "case" page.
 *
 * ## Why this screen exists
 *
 * A consultation is not one record, it is an EPISODE: you see a doctor, they
 * take your pressure, write a diagnosis, prescribe two tablets and hand you a
 * lab form whose report you collect a week later. Those five things happened
 * once, together, and the question asked months afterwards is "what happened
 * that day?" — which a flat timeline of five unrelated rows cannot answer.
 *
 * The schema always allowed the link (`visitId` on medicines, readings and
 * documents) but nothing ever SET it: every record a user created was an
 * orphan, so the data model described episodes while the app produced loose
 * rows. This screen is the read half of fixing that, and the "add to this
 * visit" actions below are the write half.
 *
 * ## What is deliberately NOT here
 *
 * Linking stays OPTIONAL everywhere. Plenty of real records belong to no
 * visit at all — a blood pressure taken at home on a Sunday, a repeat
 * prescription collected from the pharmacy, the medicines someone was already
 * on when they first set the app up. Forcing every record into a visit would
 * make the app state something untrue, so a standalone record remains a
 * first-class thing and this page simply shows nothing for a visit that
 * produced none.
 */
export default function HealthCase() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const state = useAppStore();

  const visit = params.id ? healthVisitRepo.byId(params.id) : undefined;

  const medicines = useMemo(
    () => (visit ? healthMedicineRepo.byVisit(visit.id) : []),
    [visit, state.healthPeople],
  );
  const readings = useMemo(
    () => (visit ? healthReadingRepo.byVisit(visit.id) : []),
    [visit, state.healthPeople],
  );
  const documents = useMemo(
    () => (visit ? healthDocumentRepo.byVisit(visit.id) : []),
    [visit, state.healthPeople],
  );

  if (!visit) {
    return (
      <Screen title="Visit" onBack={() => router.back()}>
        <Text variant="small" tone="secondary">
          This visit no longer exists.
        </Text>
      </Screen>
    );
  }

  const person = state.healthPeople.find((p) => p.id === visit.personId);

  /** Days until the follow-up, when there is one still worth showing. */
  const followUpDays = visit.followUpOn
    ? Math.round(
        (new Date(visit.followUpOn).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
          86_400_000,
      )
    : null;

  const empty = medicines.length === 0 && readings.length === 0 && documents.length === 0;

  return (
    <Screen
      title={VISIT_KIND_LABEL[visit.kind]}
      onBack={() => router.back()}
      action={{
        icon: 'create-outline',
        label: 'Edit this visit',
        onPress: () => router.push(`/mini/health/visit?id=${visit.id}`),
      }}
    >
      {/*
        The consultation itself — who, where, and what they concluded.

        Diagnosis leads because it is the answer someone came away with; the
        doctor and place are how you find them again.
      */}
      <Surface style={{ gap: space.md }}>
        <Row gap={space.md}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accentSoft,
            }}
          >
            <Ionicons name="medkit" size={21} color={colors.accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" numberOfLines={2}>
              {visit.diagnosis || visit.reason || VISIT_KIND_LABEL[visit.kind]}
            </Text>
            <Text variant="caption" tone="muted">
              {visit.visitedAt.toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              {person ? ` · ${person.name}` : ''}
            </Text>
          </View>
        </Row>

        {visit.doctor || visit.facility ? (
          <Row gap={space.sm}>
            <Ionicons name="person-outline" size={15} color={colors.inkMuted} />
            <Text variant="small" tone="secondary" style={{ flex: 1 }}>
              {[visit.doctor, visit.facility].filter(Boolean).join(' · ')}
            </Text>
          </Row>
        ) : null}

        {/* The reason is kept even when the diagnosis took the headline —
            "why did I go?" and "what was it?" are different facts. */}
        {visit.reason && visit.diagnosis ? (
          <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
            <Ionicons
              name="help-circle-outline"
              size={15}
              color={colors.inkMuted}
              style={{ marginTop: 1 }}
            />
            <Text variant="small" tone="secondary" style={{ flex: 1 }}>
              Went for: {visit.reason}
            </Text>
          </Row>
        ) : null}

        {visit.note ? (
          <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
            <Ionicons
              name="document-text-outline"
              size={15}
              color={colors.inkMuted}
              style={{ marginTop: 1 }}
            />
            <Text variant="small" tone="secondary" style={{ flex: 1 }}>
              {visit.note}
            </Text>
          </Row>
        ) : null}

        {visit.costMinor || followUpDays !== null ? (
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            {visit.costMinor ? (
              <Chip
                icon="cash-outline"
                label={formatMoney(visit.costMinor, { currency: state.currency })}
                tint={colors.inkSecondary}
              />
            ) : null}
            {followUpDays !== null ? (
              <Chip
                icon="calendar-outline"
                label={`Follow-up ${describeDaysAway(followUpDays).toLowerCase()}`}
                tint={followUpDays < 0 ? colors.danger : colors.accent}
              />
            ) : null}
          </Row>
        ) : null}
      </Surface>

      {/*
        What came OUT of the visit.

        Grouped by kind rather than merged into one dated list: within a single
        episode "what was I put on?" and "what did they measure?" are separate
        questions, and there are rarely enough rows for the grouping to feel
        heavy.
      */}
      {readings.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>MEASURED AT THIS VISIT</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {readings.map((reading, index) => (
              <View key={reading.id}>
                {index > 0 ? <Divider /> : null}
                <LinkedRow
                  icon="pulse-outline"
                  tint="#D6336C"
                  title={formatReading({
                    metric: reading.metric,
                    value: reading.value,
                    valueSecondary: reading.valueSecondary,
                    unit: reading.unit,
                  })}
                  detail={
                    reading.context
                      ? READING_CONTEXT_LABEL[reading.context as ReadingContext]
                      : reading.measuredAt.toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                        })
                  }
                  onPress={() =>
                    router.push(`/mini/health/vitals?person=${visit.personId}&metric=${reading.metric}`)
                  }
                />
              </View>
            ))}
          </Surface>
        </View>
      ) : null}

      {medicines.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>PRESCRIBED HERE</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {medicines.map((medicine, index) => (
              <View key={medicine.id}>
                {index > 0 ? <Divider /> : null}
                <LinkedRow
                  icon="medical-outline"
                  tint={colors.completed}
                  title={`${medicine.name}${medicine.dosage ? ` · ${medicine.dosage}` : ''}`}
                  detail={medicine.instructions ?? 'No instructions noted'}
                  // A finished course still belongs to the visit that started
                  // it — it is struck through rather than hidden.
                  muted={!medicine.isActive}
                  onPress={() => router.push(`/mini/health/medicine?id=${medicine.id}`)}
                />
              </View>
            ))}
          </Surface>
        </View>
      ) : null}

      {documents.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>REPORTS FROM THIS VISIT</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {documents.map((document, index) => (
              <View key={document.id}>
                {index > 0 ? <Divider /> : null}
                <LinkedRow
                  icon="document-text-outline"
                  tint="#8B5CF6"
                  imageUri={document.imageUri}
                  title={document.title}
                  /*
                   * A report is often DATED after its visit — the blood was
                   * drawn on the 3rd and the result collected on the 7th. So
                   * the row shows its own date when it differs, which is what
                   * makes that gap legible rather than looking like an error.
                   */
                  detail={
                    isSameDay(document.documentDate, visit.visitedAt)
                      ? (DOCUMENT_KIND_LABEL[document.kind as DocumentKind] ?? 'Report')
                      : `${DOCUMENT_KIND_LABEL[document.kind as DocumentKind] ?? 'Report'} · ${document.documentDate.toLocaleDateString(
                          undefined,
                          { day: 'numeric', month: 'short' },
                        )}`
                  }
                  onPress={() => router.push(`/mini/health/documents?person=${visit.personId}`)}
                />
              </View>
            ))}
          </Surface>
        </View>
      ) : null}

      {/*
        Adding to THIS visit.

        The write half of the linking fix: these pre-fill the visit, so
        recording a full consultation is three taps from the case page rather
        than three standalone records that happen to share a date.
      */}
      <View style={{ gap: space.sm }}>
        <Label>{empty ? 'WHAT CAME OUT OF THIS VISIT?' : 'ADD TO THIS VISIT'}</Label>
        {empty ? (
          <Text variant="caption" tone="muted" style={{ paddingHorizontal: space.xs }}>
            Anything measured, prescribed or handed to you here — added now, it
            stays attached to this visit.
          </Text>
        ) : null}
        <Row gap={space.sm}>
          <AddToVisit
            icon="pulse-outline"
            label="Reading"
            tint="#D6336C"
            onPress={() =>
              router.push(`/mini/health/reading?person=${visit.personId}&visit=${visit.id}`)
            }
          />
          <AddToVisit
            icon="medical-outline"
            label="Medicine"
            tint={colors.completed}
            onPress={() =>
              router.push(`/mini/health/medicine?person=${visit.personId}&visit=${visit.id}`)
            }
          />
          <AddToVisit
            icon="camera-outline"
            label="Report"
            tint="#8B5CF6"
            onPress={() =>
              router.push(`/mini/health/document?person=${visit.personId}&visit=${visit.id}`)
            }
          />
        </Row>
      </View>
    </Screen>
  );
}

/** Same local day — used to decide whether a report needs its own date shown. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** A small labelled chip for the visit's cost and follow-up. */
function Chip({
  icon,
  label,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
}) {
  const { radius, space } = useTheme();

  return (
    <Row
      gap={5}
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 5,
        borderRadius: radius.sm,
        backgroundColor: `${tint}14`,
      }}
    >
      <Ionicons name={icon} size={13} color={tint} />
      <Text variant="caption" color={tint} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Row>
  );
}

/** One record produced by this visit. */
function LinkedRow({
  icon,
  tint,
  title,
  detail,
  imageUri,
  muted = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  detail: string;
  imageUri?: string | null;
  muted?: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      })}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
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
          <Ionicons name={icon} size={17} color={tint} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          variant="bodyStrong"
          numberOfLines={1}
          tone={muted ? 'muted' : undefined}
          style={muted ? { textDecorationLine: 'line-through' } : undefined}
        >
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
    </Pressable>
  );
}

/** One "add this to the visit" button. */
function AddToVisit({
  icon,
  label,
  tint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Add a ${label.toLowerCase()} to this visit`}
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
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${tint}1A`,
        }}
      >
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}
