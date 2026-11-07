import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { BottomSheet, Button, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { Field, PillSelect } from '~/shared/components/forms';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { formatReading, trend } from '~/features/health/logic/health';
import { healthReadingRepo, healthVisitRepo } from '../../../src/db/repositories';
import {
  HEALTH_METRIC_LABEL,
  HEALTH_METRIC_UNIT,
  isPairedMetric,
  READING_CONTEXT_LABEL,
  type HealthMetric,
  type ReadingContext,
} from '../../../src/db/schema';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** Metrics offered, in the order people actually record them. */
const METRICS: HealthMetric[] = [
  'blood_pressure',
  'blood_sugar',
  'weight',
  'heart_rate',
  'temperature',
  'oxygen',
  'cholesterol',
  'hba1c',
  'other',
];

/**
 * Record one measured reading.
 *
 * The form reshapes itself around the metric, which is the whole reason this is
 * not four separate screens: blood pressure needs two boxes and no context,
 * blood sugar needs one box and a fasting/post-meal choice that changes what
 * the number MEANS, and weight needs neither.
 *
 * Opened with `?id=` it edits an existing reading instead, and offers to
 * delete it — a mistyped 210/80 otherwise sat on the chart forever, dragging
 * the average and drawing a spike nobody had.
 */
export default function HealthReadingForm() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const params = useLocalSearchParams<{ person?: string; id?: string; visit?: string }>();
  const store = useAppStore();

  /** The visit this record is being attached to, when opened from one. */
  const linkedVisit = params.visit ? healthVisitRepo.byId(params.visit) : undefined;

  /** The reading being edited, when opened from the history list. */
  const existing = useMemo(
    () => (params.id ? healthReadingRepo.byId(params.id) : undefined),
    [params.id],
  );

  const person =
    store.healthPeople.find((p) => p.id === (existing?.personId ?? params.person)) ??
    store.healthPeople[0];

  const [metric, setMetric] = useState<HealthMetric>(existing?.metric ?? 'blood_pressure');
  const [value, setValue] = useState(existing ? String(existing.value) : '');
  const [secondary, setSecondary] = useState(
    existing?.valueSecondary != null ? String(existing.valueSecondary) : '',
  );
  const [context, setContext] = useState<ReadingContext | null>(existing?.context ?? null);
  const [measuredAt, setMeasuredAt] = useState(existing?.measuredAt ?? new Date());
  const [note, setNote] = useState(existing?.note ?? '');

  const paired = isPairedMetric(metric);
  const unit = HEALTH_METRIC_UNIT[metric];

  /*
   * The last few readings of this metric, shown while typing.
   *
   * A single number means very little on its own — "128" is only informative
   * next to the 140 from last month. Putting recent history on the entry form
   * is what turns logging into something with a payoff at the moment of doing
   * it, rather than data disappearing into a list.
   */
  const history = useMemo(() => {
    if (!person) return null;
    const rows = healthReadingRepo.byMetric(person.id, metric);
    return trend(
      rows.map((row) => ({
        id: row.id,
        personId: row.personId,
        metric: row.metric,
        value: row.value,
        valueSecondary: row.valueSecondary,
        unit: row.unit,
        context: row.context,
        measuredAt: row.measuredAt,
      })),
      { metric },
    );
  }, [person, metric, store.healthPeople]);

  const parsedValue = Number.parseFloat(value);
  const parsedSecondary = Number.parseFloat(secondary);
  const valid =
    Number.isFinite(parsedValue) && (!paired || Number.isFinite(parsedSecondary));

  function save(confirmedRepeat = false) {
    if (!person || !valid) return;

    /*
     * A double entry guard. The same figure for the same measure within ten
     * minutes is almost always one reading saved twice (the sheet seemed not
     * to respond, so it was filled in again) — and it skews the average and
     * doubles a point on the chart. Asked, not blocked: two identical real
     * readings minutes apart do happen.
     */
    if (!existing && !confirmedRepeat) {
      const repeat = healthReadingRepo
        .byMetric(person.id, metric)
        .some(
          (r) =>
            r.value === parsedValue &&
            (r.valueSecondary ?? null) === (paired ? parsedSecondary : null) &&
            Math.abs(r.measuredAt.getTime() - measuredAt.getTime()) < 10 * 60 * 1000,
        );
      if (repeat) {
        Alert.alert(
          'Already added?',
          'You saved the same reading a few minutes ago. Add it again?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Add anyway', onPress: () => save(true) },
          ],
        );
        return;
      }
    }

    const fields = {
      metric,
      value: parsedValue,
      valueSecondary: paired ? parsedSecondary : null,
      unit: unit || null,
      measuredAt,
      context,
      note: note.trim() || null,
    };

    if (existing) {
      healthReadingRepo.update(existing.id, fields);
    } else {
      healthReadingRepo.create({
        ...fields,
        personId: person.id,
        // Set when this form was opened from a visit's case page — the figure
        // was measured in that room, not at home.
        visitId: params.visit ?? null,
      });
    }

    store.refresh();
    router.back();
  }

  function remove() {
    if (!existing) return;
    Alert.alert(
      'Delete this reading?',
      `${formatReading({
        metric: existing.metric,
        value: existing.value,
        valueSecondary: existing.valueSecondary,
        unit: existing.unit,
      })} on ${existing.measuredAt.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })} is removed from the chart and history. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            healthReadingRepo.remove(existing.id);
            store.refresh();
            router.back();
          },
        },
      ],
    );
  }

  if (!person) {
    return (
      <BottomSheet visible asRoute onClose={closeModal} title="Add a reading" icon="pulse-outline">
        <Text variant="small" tone="secondary" style={{ padding: 16 }}>
          Add a person first.
        </Text>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible
      asRoute
      scroll
      onClose={closeModal}
      title={existing ? 'Edit reading' : 'Add a reading'}
      icon="pulse-outline"
      iconColor={colors.accent}
      footer={
        <View style={{ gap: space.sm }}>
          <GradientButton
            label={existing ? 'Save changes' : 'Save reading'}
            icon="checkmark"
            disabled={!valid}
            onPress={() => save()}
          />
          {existing ? (
            <Button label="Delete reading" icon="trash-outline" variant="danger" onPress={remove} />
          ) : null}
        </View>
      }
    >
      {/*
        Says the record is being attached to a visit.

        Without this the link is invisible — the form looks identical whether
        it was opened standalone or from a case page, and a silent association
        is one the user cannot verify or correct.
      */}
      {linkedVisit ? (
        <Row
          gap={space.sm}
          style={{
            alignItems: 'flex-start',
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.accentSoft,
          }}
        >
          <Ionicons name="link" size={15} color={colors.accent} style={{ marginTop: 1 }} />
          <Text variant="caption" color={colors.accentInk} style={{ flex: 1 }}>
            Part of the visit on{' '}
            {linkedVisit.visitedAt.toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            })}
            {linkedVisit.doctor ? ` with ${linkedVisit.doctor}` : ''}.
          </Text>
        </Row>
      ) : null}

      <PillSelect
        label="WHAT WAS MEASURED"
        options={METRICS.map((key) => ({ key, label: HEALTH_METRIC_LABEL[key] }))}
        selectedKey={metric}
        onSelect={(key) => {
          setMetric(key as HealthMetric);
          // Context belongs to blood sugar; carrying "fasting" onto a weight
          // reading would attach a qualifier that means nothing there.
          setContext(null);
        }}
      />

      {/* Blood pressure is two boxes side by side, everything else is one. */}
      {paired ? (
        <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Systolic"
              value={value}
              onChangeText={setValue}
              placeholder="120"
              keyboardType="numeric"
              autoFocus
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Diastolic"
              value={secondary}
              onChangeText={setSecondary}
              placeholder="80"
              keyboardType="numeric"
            />
          </View>
        </Row>
      ) : (
        <Field
          label={unit ? `Reading (${unit})` : 'Reading'}
          value={value}
          onChangeText={setValue}
          placeholder="0"
          keyboardType="decimal-pad"
          autoFocus
        />
      )}

      {/*
        Context, for the metrics where it changes the meaning.

        A blood sugar of 140 is unremarkable after lunch and a problem fasting,
        so a chart mixing the two describes neither (see `trend`). Only asked
        where it applies — tagging a weight "fasting" is noise.
      */}
      {metric === 'blood_sugar' ? (
        <PillSelect
          label="WHEN"
          options={(['fasting', 'post_meal', 'random'] as ReadingContext[]).map((key) => ({
            key,
            label: READING_CONTEXT_LABEL[key],
          }))}
          selectedKey={context}
          onSelect={(key) => setContext(key as ReadingContext)}
          singleRow
        />
      ) : null}

      <DatePickerField label="Measured on" value={measuredAt} onChange={setMeasuredAt} />

      <Field
        label="Note"
        value={note}
        onChangeText={setNote}
        placeholder="Anything worth remembering"
        multiline
      />

      {/* Recent history, so the number being typed has something to sit against. */}
      {history && history.points.length > 0 ? (
        <Surface style={{ gap: space.sm }}>
          <Row>
            <Label>RECENT</Label>
            <View style={{ flex: 1 }} />
            {history.average !== null ? (
              <Text variant="caption" tone="muted">
                Average {history.average.toFixed(1)}
                {unit ? ` ${unit}` : ''}
              </Text>
            ) : null}
          </Row>
          {history.points
            .slice(-5)
            .reverse()
            .map((point) => (
              <Row key={point.at.toISOString()} gap={space.sm}>
                <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                  {point.at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </Text>
                <Text variant="small" style={{ fontWeight: '700' }}>
                  {formatReading({
                    metric,
                    value: point.value,
                    valueSecondary: point.valueSecondary,
                    unit,
                  })}
                </Text>
              </Row>
            ))}
        </Surface>
      ) : null}
    </BottomSheet>
  );
}
