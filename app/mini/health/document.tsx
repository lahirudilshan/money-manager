import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet, Button, GradientButton, Row, Text } from '../../../src/components/ui';
import { Field, PillSelect } from '../../../src/components/forms';
import { DatePickerField } from '../../../src/components/DatePickerField';
import { ImageUploader } from '../../../src/components/ImageUploader';
import { healthDocumentRepo, healthVisitRepo } from '../../../src/db/repositories';
import { DOCUMENT_KIND_LABEL, type DocumentKind } from '../../../src/db/schema';
import { useModalClose } from '../../../src/hooks/useModalClose';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

const KINDS: DocumentKind[] = [
  'prescription',
  'report',
  'scan',
  'bill',
  'vaccination',
  'insurance',
  'other',
];

/**
 * Photograph a prescription, report or scan.
 *
 * The paper problem is the real one this feature solves. Prescriptions and lab
 * reports arrive as physical sheets that are lost within a year, and the phone
 * camera is already how people half-solve it — into a photo library where the
 * report is indistinguishable from a screenshot six months later.
 *
 * The photo therefore comes FIRST on this form: it is the point, and the title
 * and date are what make it findable afterwards.
 */
export default function HealthDocumentForm() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const params = useLocalSearchParams<{ person?: string; id?: string; visit?: string }>();
  const store = useAppStore();

  /** The visit this record is being attached to, when opened from one. */
  const linkedVisit = params.visit ? healthVisitRepo.byId(params.visit) : undefined;

  const person =
    store.healthPeople.find((p) => p.id === params.person) ?? store.healthPeople[0];

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<DocumentKind>('prescription');
  const [documentDate, setDocumentDate] = useState(new Date());
  const [summary, setSummary] = useState('');

  function save() {
    const trimmed = title.trim();
    if (!person || !trimmed) return;

    healthDocumentRepo.create({
      personId: person.id,
      visitId: params.visit ?? null,
      title: trimmed,
      kind,
      imageUri,
      documentDate,
      summary: summary.trim() || null,
    });

    store.refresh();
    router.back();
  }

  if (!person) {
    return (
      <BottomSheet visible asRoute onClose={closeModal} title="Add a document" icon="camera-outline">
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
      title="Add a document"
      icon="camera-outline"
      iconColor={'#8B5CF6'}
      footer={
        <GradientButton
          label="Save document"
          icon="checkmark"
          disabled={!title.trim()}
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

      {/* The photo leads — it is the reason this screen exists. */}
      <ImageUploader label="Photo of the document" value={imageUri} onChange={setImageUri} size={140} />

      <Field
        label="What is it"
        value={title}
        onChangeText={setTitle}
        placeholder="Blood test results"
        autoFocus
      />

      <PillSelect
        label="KIND"
        options={KINDS.map((key) => ({ key, label: DOCUMENT_KIND_LABEL[key] }))}
        selectedKey={kind}
        onSelect={(key) => setKind(key as DocumentKind)}
      />

      {/* The date ON the document, which is not when it was photographed —
          someone filing a backlog of old reports needs these to differ. */}
      <DatePickerField label="Dated" value={documentDate} onChange={setDocumentDate} />

      <Field
        label="What it says"
        value={summary}
        onChangeText={setSummary}
        placeholder="Anything worth being able to search for later"
        multiline
      />

      <Text variant="caption" tone="muted" style={{ paddingHorizontal: space.xs }}>
        The photo is stored on this phone only. It is included in a backup just
        when "Health records" is ticked.
      </Text>
    </BottomSheet>
  );
}
