import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { BottomSheet, Button, GradientButton, Row, Surface, Text } from '~/shared/components/ui';
import { Field, PillSelect } from '~/shared/components/forms';
import { healthMedicineRepo, healthVisitRepo } from '../../../src/db/repositories';
import { MEDICINE_FORM_LABEL, type MedicineForm } from '../../../src/db/schema';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

const FORMS: MedicineForm[] = [
  'tablet',
  'capsule',
  'syrup',
  'injection',
  'inhaler',
  'drops',
  'cream',
  'other',
];

/**
 * Record what was prescribed.
 *
 * A prescription line, not a regime to be tracked: the app never asks whether a
 * dose was taken. `instructions` is free text because it is copied verbatim off
 * the paper in your hand — "twice a day after meals" is both the fastest thing
 * to type and the most faithful record.
 */
export default function HealthMedicineForm() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const params = useLocalSearchParams<{ person?: string; id?: string; visit?: string }>();
  const store = useAppStore();

  /** The visit this record is being attached to, when opened from one. */
  const linkedVisit = params.visit ? healthVisitRepo.byId(params.visit) : undefined;

  const existing = params.id ? healthMedicineRepo.byId(params.id) : undefined;

  const person =
    store.healthPeople.find((p) => p.id === (existing?.personId ?? params.person)) ??
    store.healthPeople[0];

  const [name, setName] = useState(existing?.name ?? '');
  const [dosage, setDosage] = useState(existing?.dosage ?? '');
  const [form, setForm] = useState<MedicineForm>(existing?.form ?? 'tablet');
  const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  const [prescribedBy, setPrescribedBy] = useState(existing?.prescribedBy ?? '');
  const [note, setNote] = useState(existing?.note ?? '');

  function save() {
    const trimmed = name.trim();
    if (!person || !trimmed) return;

    const patch = {
      personId: person.id,
      name: trimmed,
      dosage: dosage.trim() || null,
      form,
      instructions: instructions.trim() || null,
      prescribedBy: prescribedBy.trim() || null,
      note: note.trim() || null,
      startedOn: existing?.startedOn ?? new Date(),
      // The consultation that wrote this prescription, when the form was
      // opened from one. Preserved on edit rather than cleared.
      visitId: existing?.visitId ?? params.visit ?? null,
    };

    if (existing) healthMedicineRepo.update(existing.id, patch);
    else healthMedicineRepo.create(patch);

    store.refresh();
    router.back();
  }

  /**
   * Mark a course finished without deleting it.
   *
   * Kept because "what antibiotic was she on in March?" is a real question a
   * year later — the whole reason to write any of this down.
   */
  function stop() {
    if (!existing) return;

    healthMedicineRepo.update(existing.id, { isActive: false, endedOn: new Date() });
    store.refresh();
    router.back();
  }

  function remove() {
    if (!existing) return;

    Alert.alert(
      `Delete ${existing.name}?`,
      'To keep it in the record instead, mark the course finished.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            healthMedicineRepo.remove(existing.id);
            store.refresh();
            router.back();
          },
        },
      ],
    );
  }

  if (!person) {
    return (
      <BottomSheet visible asRoute onClose={closeModal} title="Add a medicine" icon="medical-outline">
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
      title={existing ? 'Edit medicine' : 'Add a medicine'}
      icon="medical-outline"
      iconColor={colors.completed}
      footer={
        <GradientButton
          label="Save medicine"
          icon="checkmark"
          disabled={!name.trim()}
          onPress={save}
        />
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

      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Metformin"
        autoFocus
      />
      <Field label="Dose" value={dosage} onChangeText={setDosage} placeholder="500 mg" />

      <PillSelect
        label="FORM"
        options={FORMS.map((key) => ({ key, label: MEDICINE_FORM_LABEL[key] }))}
        selectedKey={form}
        onSelect={(key) => setForm(key as MedicineForm)}
      />

      <Field
        label="Instructions"
        value={instructions}
        onChangeText={setInstructions}
        placeholder="After meals"
      />
      <Field
        label="Prescribed by"
        value={prescribedBy}
        onChangeText={setPrescribedBy}
        placeholder="Dr Perera"
      />

      <Field label="Note" value={note} onChangeText={setNote} multiline />

      {existing ? (
        <View style={{ gap: space.sm, paddingTop: space.sm }}>
          {existing.isActive ? (
            <Button
              label="Stop this course"
              icon="stop-circle-outline"
              variant="secondary"
              onPress={stop}
            />
          ) : null}
          <Button
            label={`Delete ${existing.name}`}
            icon="trash-outline"
            variant="danger"
            onPress={remove}
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}
