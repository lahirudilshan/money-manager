import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet, Button, GradientButton, Label, Row, Surface, Text } from '../../../src/components/ui';
import { Field, PillSelect } from '../../../src/components/forms';
import {
  BLOOD_GROUPS,
  isBloodGroup,
  PERSON_RELATION_LABEL,
  PERSON_RELATIONS,
  type PersonRelation,
} from '../../../src/db/schema';
import { useModalClose } from '../../../src/hooks/useModalClose';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

/** Colours a person can be marked with, so a family reads apart at a glance. */
const PERSON_COLORS = ['#D6336C', '#0F6FDE', '#0E9F6E', '#F59E0B', '#8B5CF6', '#EF4444'];

/**
 * Add or edit a person whose health is tracked.
 *
 * The form is deliberately short. Everything except the name is optional,
 * because the alternative — asking for a date of birth and a blood group before
 * you can record a single tablet — is how a feature like this gets abandoned on
 * its first screen. The emergency facts have their own section rather than
 * being buried among the rest, since they are the ones worth going back to fill
 * in.
 */
export default function HealthPersonForm() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const params = useLocalSearchParams<{ id?: string }>();
  const store = useAppStore();

  const existing = params.id
    ? store.healthPeople.find((person) => person.id === params.id)
    : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  /*
   * Defaults to "Myself" for the very first person, and to nothing after that.
   *
   * Someone enabling a health tracker is overwhelmingly adding themselves
   * first, so pre-selecting it saves the common case a tap — but it is a
   * visible, changeable default rather than the silent `isSelf` flag this
   * replaced, which decided the same thing without ever showing it.
   *
   * Once a self exists, a new person defaults to unset rather than to a guess.
   */
  const [relation, setRelation] = useState<PersonRelation | null>(
    existing?.relation ?? (store.healthPeople.some((p) => p.isSelf) ? null : 'self'),
  );
  const [relationLabel, setRelationLabel] = useState(existing?.relationLabel ?? '');
  const [birthYear, setBirthYear] = useState(
    existing?.bornOn ? String(existing.bornOn.getFullYear()) : '',
  );
  const [bloodGroup, setBloodGroup] = useState(existing?.bloodGroup ?? '');
  const [allergies, setAllergies] = useState(existing?.allergies ?? '');
  const [conditions, setConditions] = useState(existing?.conditions ?? '');
  const [color, setColor] = useState(existing?.color ?? PERSON_COLORS[0]!);

  /*
   * A year that cannot be one, reported only once something was typed.
   *
   * Blank is valid — date of birth is optional — so an empty field must not
   * show an error, which is the usual way this kind of check goes wrong.
   */
  const thisYear = new Date().getFullYear();
  const parsedYear = Number.parseInt(birthYear, 10);
  const birthYearError =
    birthYear.trim() === ''
      ? undefined
      : !Number.isFinite(parsedYear) || parsedYear < 1900 || parsedYear > thisYear
        ? `Enter a year between 1900 and ${thisYear}`
        : undefined;

  function save() {
    const trimmed = name.trim();
    if (!trimmed || birthYearError) return;

    const patch = {
      name: trimmed,
      relation,
      // Only meaningful alongside `other`; cleared otherwise so a stale word
      // cannot resurface if the relation is later changed back.
      relationLabel: relation === 'other' ? relationLabel.trim() || null : null,
      // Mid-year, so an age derived from it is never off by one in a way that
      // depends on today's date. Only the year was asked for.
      bornOn: birthYear.trim() ? new Date(parsedYear, 6, 1) : null,
      bloodGroup: bloodGroup.trim() || null,
      allergies: allergies.trim() || null,
      conditions: conditions.trim() || null,
      color,
    };

    if (existing) store.updateHealthPerson(existing.id, patch);
    else store.addHealthPerson(patch);

    router.back();
  }

  function remove() {
    if (!existing) return;

    Alert.alert(
      `Delete ${existing.name}?`,
      'Every medicine, dose, visit, prescription and reading for this person is deleted with them. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            store.deleteHealthPerson(existing.id);
            router.back();
          },
        },
      ],
    );
  }

  return (
    <BottomSheet
      visible
      asRoute
      scroll
      onClose={closeModal}
      title={existing ? existing.name : 'Add a person'}
      icon="person-outline"
      iconColor={colors.accent}
      footer={
        <GradientButton
          label={existing ? 'Save changes' : 'Add person'}
          icon="checkmark"
          disabled={!name.trim() || Boolean(birthYearError)}
          onPress={save}
        />
      }
    >
      <Field label="Name" value={name} onChangeText={setName} placeholder="Amma" autoFocus />

      {/*
        Relation as a list, "Myself" included.

        Free text made "Mother", "mother" and "Amma" three different things in a
        list whose entire job is telling a handful of people apart — and left no
        way to say which one was you, since that was a hidden flag set on
        whoever happened to be added first. Picking "Myself" IS that
        declaration now; the repository keeps the flag in step.
      */}
      <PillSelect
        label="RELATION"
        options={PERSON_RELATIONS.map((key) => ({
          key,
          label: PERSON_RELATION_LABEL[key],
        }))}
        selectedKey={relation}
        onSelect={(key) => setRelation(key as PersonRelation)}
      />

      {/* Only when the list has no word for it — see `healthPeople.relation`. */}
      {relation === 'other' ? (
        <Field
          label="What relation"
          value={relationLabel}
          onChangeText={setRelationLabel}
          placeholder="Mother-in-law"
        />
      ) : null}

      {/*
        Says what picking "Myself" actually did.

        It sets which person the timeline opens on, and only one person can hold
        it — a consequence worth stating, because choosing it for a second
        person quietly takes it off the first.
      */}
      {relation === 'self' && !existing?.isSelf ? (
        <Row gap={space.sm} style={{ paddingHorizontal: space.xs, alignItems: 'flex-start' }}>
          <Ionicons
            name="information-circle-outline"
            size={15}
            color={colors.inkMuted}
            style={{ marginTop: 1 }}
          />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {store.healthPeople.some((p) => p.isSelf)
              ? `Health records will open on this person instead of ${
                  store.healthPeople.find((p) => p.isSelf)?.name ?? 'the current one'
                }.`
              : 'Health records will open on this person.'}
          </Text>
        </Row>
      ) : null}

      {/*
        Year of birth, typed — not the date picker.

        `DatePickerField` is built for recent dates: it opens on this month with
        "Today" and "Yesterday" shortcuts, which is right for logging a dose and
        wrong for a birth year forty years back, where it means forty months of
        tapping. The age shown beside a reading only needs the year to be
        useful, so that is all this asks for.
      */}
      <Field
        label="Year of birth"
        value={birthYear}
        onChangeText={setBirthYear}
        placeholder="1962"
        keyboardType="numeric"
        error={birthYearError}
      />

      {/*
        Colour as rounded swatches, not pills.

        This was `PillSelect` with a blank label, which is a control built for
        text: it produced six wide, empty pills whose only content was their
        own background. A swatch should be the colour and nothing else, so it
        gets a square-ish rounded tile sized to be tappable, with a tick to say
        which is chosen rather than relying on the border alone.
      */}
      <View style={{ gap: space.sm }}>
        <Label>COLOUR</Label>
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          {PERSON_COLORS.map((value) => {
            const selected = color === value;
            return (
              <Pressable
                key={value}
                onPress={() => setColor(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Colour ${value}`}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: radius.md,
                  backgroundColor: value,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.75 : 1,
                  /*
                   * The ring sits OUTSIDE the swatch, drawn as a border in the
                   * surface colour plus an offset shadow-free outline. A border
                   * on the swatch itself would eat into the colour, which is
                   * the one thing this control is showing.
                   */
                  borderWidth: 3,
                  borderColor: selected ? colors.ink : 'transparent',
                })}
              >
                {selected ? (
                  <Ionicons name="checkmark" size={20} color="#FFFFFF" />
                ) : null}
              </Pressable>
            );
          })}
        </Row>
      </View>

      {/*
        The emergency section, kept together and labelled as such.

        These three are the reason someone would open this app in a hurry, and
        grouping them says so — mixed in with "relation" they read as just more
        profile fields.
      */}
      <Surface style={{ gap: space.md }}>
        <Text variant="bodyStrong">In an emergency</Text>
        <Text variant="caption" tone="muted">
          Shown at the top of this person's timeline, where it can be found
          without scrolling.
        </Text>
        {/*
          Blood group is PICKED, not typed.

          A closed set of eight, and the one field here where a typo could
          matter in an emergency — "0+" for "O+", "O+ve", "o positive" — which
          is exactly what a free-text box invited. Tapping the selected chip
          again clears it, since the field is optional and a picker with no way
          back would trap someone who tapped it by accident.
        */}
        <View style={{ gap: space.sm }}>
          <Label>BLOOD GROUP</Label>
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            {BLOOD_GROUPS.map((group) => {
              const selected = bloodGroup === group;
              return (
                <Pressable
                  key={group}
                  onPress={() => setBloodGroup(selected ? '' : group)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Blood group ${group}`}
                  style={({ pressed }) => ({
                    minWidth: 56,
                    paddingHorizontal: space.md,
                    paddingVertical: 10,
                    borderRadius: radius.md,
                    alignItems: 'center',
                    opacity: pressed ? 0.75 : 1,
                    backgroundColor: selected ? colors.danger : colors.surface,
                    borderWidth: 1.5,
                    borderColor: selected ? colors.danger : colors.hairline,
                  })}
                >
                  <Text
                    variant="body"
                    color={selected ? '#FFFFFF' : colors.inkSecondary}
                    style={{ fontWeight: '700' }}
                  >
                    {group}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
          {/*
            An old hand-typed value that is not one of the eight.

            The column predates this picker, so a value like "O positive" can
            already be stored. Silently dropping it would lose a fact the user
            entered; showing it says why nothing above is highlighted.
          */}
          {bloodGroup && !isBloodGroup(bloodGroup) ? (
            <Text variant="caption" tone="muted">
              Currently saved as "{bloodGroup}" — pick one above to replace it.
            </Text>
          ) : null}
        </View>
        <Field
          label="Allergies"
          value={allergies}
          onChangeText={setAllergies}
          placeholder="Penicillin, peanuts"
          multiline
        />
        <Field
          label="Long-term conditions"
          value={conditions}
          onChangeText={setConditions}
          placeholder="Type 2 diabetes, hypertension"
          multiline
        />
      </Surface>

      {existing ? (
        <View style={{ paddingTop: space.sm }}>
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
