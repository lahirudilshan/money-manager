import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { BottomSheet, Button, GradientButton, Surface, Text } from '~/shared/components/ui';
import { Field, PillSelect } from '~/shared/components/forms';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { formatAmountInput, parseAmount } from '~/shared/lib/money';
import { healthVisitRepo } from '../../../src/db/repositories';
import { VISIT_KIND_LABEL, type VisitKind } from '../../../src/db/schema';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

const KINDS: VisitKind[] = [
  'consultation',
  'checkup',
  'lab',
  'dental',
  'vaccination',
  'emergency',
  'therapy',
  'other',
];

/**
 * Record a visit to a doctor, hospital or lab.
 *
 * The anchor most other records hang off — a prescription comes from a visit, a
 * report is the result of one — so it carries the fields that give those
 * context: who was seen, what they concluded, and when to go back.
 *
 * `followUpOn` is the field that earns this screen its place. A follow-up date
 * given verbally in a consulting room is exactly what gets forgotten, and it is
 * what puts a card at the top of the timeline.
 */
export default function HealthVisitForm() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const params = useLocalSearchParams<{ person?: string; id?: string }>();
  const store = useAppStore();

  const existing = params.id ? healthVisitRepo.byId(params.id) : undefined;

  const person =
    store.healthPeople.find((p) => p.id === (existing?.personId ?? params.person)) ??
    store.healthPeople[0];

  const [kind, setKind] = useState<VisitKind>(existing?.kind ?? 'consultation');
  const [visitedAt, setVisitedAt] = useState(existing?.visitedAt ?? new Date());
  const [doctor, setDoctor] = useState(existing?.doctor ?? '');
  const [facility, setFacility] = useState(existing?.facility ?? '');
  const [reason, setReason] = useState(existing?.reason ?? '');
  const [diagnosis, setDiagnosis] = useState(existing?.diagnosis ?? '');
  // Seeded through the field's own formatter so an existing cost opens grouped
  // rather than gaining its separators on the first keystroke.
  const [cost, setCost] = useState(
    existing?.costMinor != null ? formatAmountInput(String(existing.costMinor / 100)) : '',
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [followUp, setFollowUp] = useState<Date | null>(existing?.followUpOn ?? null);

  function save() {
    if (!person) return;

    const costMinor = cost.trim() ? parseAmount(cost) : null;

    const patch = {
      personId: person.id,
      visitedAt,
      kind,
      doctor: doctor.trim() || null,
      facility: facility.trim() || null,
      reason: reason.trim() || null,
      diagnosis: diagnosis.trim() || null,
      costMinor,
      note: note.trim() || null,
      followUpOn: followUp,
    };

    if (existing) healthVisitRepo.update(existing.id, patch);
    else healthVisitRepo.create(patch);

    store.refresh();
    router.back();
  }

  function remove() {
    if (!existing) return;

    Alert.alert('Delete this visit?', 'The record is removed from the timeline.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          healthVisitRepo.remove(existing.id);
          store.refresh();
          router.back();
        },
      },
    ]);
  }

  if (!person) {
    return (
      <BottomSheet visible asRoute onClose={closeModal} title="Add a visit" icon="medkit-outline">
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
      title={existing ? 'Edit visit' : 'Add a visit'}
      icon="medkit-outline"
      iconColor={colors.accent}
      footer={<GradientButton label="Save visit" icon="checkmark" onPress={save} />}
    >
      <PillSelect
        label="KIND"
        options={KINDS.map((key) => ({ key, label: VISIT_KIND_LABEL[key] }))}
        selectedKey={kind}
        onSelect={(key) => setKind(key as VisitKind)}
      />

      <DatePickerField label="Visited on" value={visitedAt} onChange={setVisitedAt} />

      <Field label="Doctor" value={doctor} onChangeText={setDoctor} placeholder="Dr Perera" />
      <Field
        label="Hospital or clinic"
        value={facility}
        onChangeText={setFacility}
        placeholder="Nawaloka"
      />
      <Field
        label="Reason for going"
        value={reason}
        onChangeText={setReason}
        placeholder="Persistent cough"
      />
      <Field
        label="Diagnosis"
        value={diagnosis}
        onChangeText={setDiagnosis}
        placeholder="What they concluded"
        multiline
      />
      <Field
        label="What it cost"
        value={cost}
        onChangeText={setCost}
        placeholder="0"
        money
      />
      <Field label="Note" value={note} onChangeText={setNote} multiline />

      {/*
        The follow-up, in its own card.

        Separated from the record of what happened because it is the one field
        here about the FUTURE — it is what puts a reminder at the top of the
        timeline, and burying it under "note" is how it gets skipped.
      */}
      <Surface style={{ gap: space.sm }}>
        <Text variant="bodyStrong">Come back on</Text>
        <Text variant="caption" tone="muted">
          Sits at the top of the timeline until it passes. Leave it if there is
          no follow-up.
        </Text>
        {followUp ? (
          <>
            <DatePickerField
              label="Follow-up"
              value={followUp}
              onChange={setFollowUp}
              // A follow-up is by definition ahead, so the usual "no future
              // dates" cap would make the field impossible to fill.
              maximumDate={new Date(Date.now() + 3 * 365 * 86_400_000)}
            />
            <Button label="No follow-up" variant="ghost" onPress={() => setFollowUp(null)} />
          </>
        ) : (
          <Button
            label="Set a follow-up date"
            icon="calendar-outline"
            variant="secondary"
            onPress={() => setFollowUp(new Date(Date.now() + 14 * 86_400_000))}
          />
        )}
      </Surface>

      {existing ? (
        <View style={{ paddingTop: space.sm }}>
          <Button label="Delete this visit" icon="trash-outline" variant="danger" onPress={remove} />
        </View>
      ) : null}
    </BottomSheet>
  );
}
