import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Divider, Empty, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import { healthMedicineRepo } from '../../../src/db/repositories';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * What this person has been prescribed — current first, then finished.
 *
 * A list, not a tracker. There is no dose logging, no adherence score and
 * nothing to tick: those demanded input several times a day and answered a
 * question ("did she take the 8pm one?") that nobody keeping a family health
 * record actually asks months later. What they ask is "what was Amma put on,
 * and who put her on it?", which is a list of names with dates against them.
 *
 * The split is between still-taking and finished because those are genuinely
 * different questions — one is "what is she on now", asked at a pharmacy or a
 * new doctor, the other is "what has she been on", asked when something
 * recurs.
 */
export default function HealthPrescriptions() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string }>();
  const store = useAppStore();

  const person =
    store.healthPeople.find((p) => p.id === params.person) ?? store.healthPeople[0];

  const medicines = useMemo(
    () => (person ? healthMedicineRepo.byPerson(person.id) : []),
    [person, store.healthPeople],
  );

  const current = medicines.filter((medicine) => medicine.isActive);
  const finished = medicines.filter((medicine) => !medicine.isActive);

  if (!person) {
    return (
      <Screen title="Prescriptions" onBack={() => router.back()}>
        <Text variant="small" tone="secondary">
          Add a person first.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      title={`${person.name}'s medicines`}
      onBack={() => router.back()}
      footer={
        <GradientButton
          label="Add a medicine"
          icon="add"
          onPress={() => router.push(`/mini/health/medicine?person=${person.id}`)}
        />
      }
    >
      {medicines.length === 0 ? (
        <Empty
          icon="medical-outline"
          title="No medicines recorded"
          message="Add what was prescribed, with the doctor's instructions, so you can look it up later."
          actionLabel="Add a medicine"
          onAction={() => router.push(`/mini/health/medicine?person=${person.id}`)}
        />
      ) : null}

      {current.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>STILL TAKING</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {current.map((medicine, index) => (
              <View key={medicine.id}>
                {index > 0 ? <Divider /> : null}
                <MedicineRow
                  name={medicine.name}
                  dosage={medicine.dosage}
                  instructions={medicine.instructions}
                  prescribedBy={medicine.prescribedBy}
                  startedOn={medicine.startedOn}
                  onPress={() => router.push(`/mini/health/medicine?id=${medicine.id}`)}
                />
              </View>
            ))}
          </Surface>
        </View>
      ) : null}

      {finished.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>FINISHED</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {finished.map((medicine, index) => (
              <View key={medicine.id}>
                {index > 0 ? <Divider /> : null}
                <MedicineRow
                  name={medicine.name}
                  dosage={medicine.dosage}
                  instructions={medicine.instructions}
                  prescribedBy={medicine.prescribedBy}
                  startedOn={medicine.startedOn}
                  endedOn={medicine.endedOn}
                  muted
                  onPress={() => router.push(`/mini/health/medicine?id=${medicine.id}`)}
                />
              </View>
            ))}
          </Surface>
        </View>
      ) : null}
    </Screen>
  );
}

function MedicineRow({
  name,
  dosage,
  instructions,
  prescribedBy,
  startedOn,
  endedOn,
  muted = false,
  onPress,
}: {
  name: string;
  dosage?: string | null;
  instructions?: string | null;
  prescribedBy?: string | null;
  startedOn?: Date | null;
  endedOn?: Date | null;
  muted?: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  const when = endedOn
    ? `Until ${endedOn.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
    : startedOn
      ? `Since ${startedOn.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
      : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
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
          width: 34,
          height: 34,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: muted ? colors.surfaceSunken : colors.accentSoft,
        }}
      >
        <Ionicons
          name="medical-outline"
          size={17}
          color={muted ? colors.inkMuted : colors.accent}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" tone={muted ? 'muted' : undefined} numberOfLines={1}>
          {name}
          {dosage ? ` · ${dosage}` : ''}
        </Text>
        {/* The instruction line is the useful part at a pharmacy counter. */}
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {[instructions, prescribedBy ? `by ${prescribedBy}` : null, when]
            .filter(Boolean)
            .join(' · ') || 'No details'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
    </Pressable>
  );
}
