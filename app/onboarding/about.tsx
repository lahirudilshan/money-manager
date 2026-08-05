import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, Label, PinnedFooter, Row, Surface, Text } from '../../src/components/ui';
import {
  ageFrom,
  describePersona,
  suggestedLines,
  type Household,
  type PersonaAnswers,
  type Transport,
} from '../../src/core/personas';
import { CATALOG_SUBCATEGORY_BY_ID } from '../../src/data/categoryCatalog';
import { useOnboardingDraft } from '../../src/store/useOnboardingDraft';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Onboarding step 2: three questions that build a starting plan.
 *
 * The design constraint the user set is that this must not be boring, which
 * rules out a form. So there are exactly three questions, each a row of tappable
 * tiles rather than a text field, and each one visibly changes the plan — the
 * live summary at the bottom updates as they tap, so the effort has a visible
 * payoff before they commit to it.
 *
 * Nothing here is mandatory. Every answer has a sensible default and the whole
 * step can be skipped, because a user who wants to build their own plan should
 * not have to answer questions to reach the category picker.
 */
export default function OnboardingAboutScreen() {
  const { colors, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const draft = useOnboardingDraft();

  const [household, setHousehold] = useState<Household[]>(['just_me']);
  const [transport, setTransport] = useState<Transport>('none');
  const [birthYear, setBirthYear] = useState('');

  const answers: PersonaAnswers = {
    household,
    transport,
    birthYear: birthYear.length === 4 ? Number(birthYear) : null,
  };

  const suggested = suggestedLines(answers);
  const age = ageFrom(answers.birthYear);

  /**
   * "Just me" is exclusive — it is the ABSENCE of the others.
   *
   * Without this a user taps "Just me", then "Kids", and ends up with both,
   * which is contradictory and quietly adds childcare to a single person's
   * plan.
   */
  function toggleHousehold(value: Household) {
    setHousehold((current) => {
      if (value === 'just_me') return ['just_me'];

      const without = current.filter((entry) => entry !== 'just_me');
      const next = without.includes(value)
        ? without.filter((entry) => entry !== value)
        : [...without, value];

      return next.length === 0 ? ['just_me'] : next;
    });
  }

  /** Pre-tick the suggested lines, then hand over to the category picker. */
  function handleContinue() {
    // Only ids the catalog actually has — a typo here would otherwise create
    // nothing and silently drop the category the user's answer asked for.
    draft.pickAll(
      suggested.filter((id) => CATALOG_SUBCATEGORY_BY_ID.has(id)),
      true,
    );
    router.push('/onboarding/categories');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + space.lg,
          paddingBottom: space.lg,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 2 }}>
          <Label>STEP 2 OF 5</Label>
          <Text variant="title">A bit about you</Text>
          <Text variant="small" tone="muted">
            Three quick taps and we'll build a plan you can edit. Skip if you'd
            rather start from scratch.
          </Text>
        </View>

        <Question
          label="WHO ARE YOU LOOKING AFTER?"
          hint="Pick everything that applies."
          options={[
            { key: 'just_me', label: 'Just me', icon: 'person-outline' },
            { key: 'partner', label: 'Partner', icon: 'people-outline' },
            { key: 'kids', label: 'Children', icon: 'happy-outline' },
            { key: 'parents', label: 'Parents', icon: 'heart-outline' },
          ]}
          isSelected={(key) => household.includes(key as Household)}
          onSelect={(key) => toggleHousehold(key as Household)}
        />

        <Question
          label="DO YOU DRIVE?"
          hint="Adds fuel, service and insurance — or leaves them out."
          options={[
            { key: 'car', label: 'Car', icon: 'car-sport-outline' },
            { key: 'bike', label: 'Bike', icon: 'bicycle-outline' },
            { key: 'none', label: 'Neither', icon: 'bus-outline' },
          ]}
          isSelected={(key) => transport === key}
          onSelect={(key) => setTransport(key as Transport)}
        />

        <View style={{ gap: space.sm }}>
          <Label>WHAT YEAR WERE YOU BORN?</Label>
          <TextInput
            value={birthYear}
            onChangeText={(text) => setBirthYear(text.replace(/[^\d]/g, '').slice(0, 4))}
            placeholder="1990"
            placeholderTextColor={colors.inkMuted}
            keyboardType="number-pad"
            accessibilityLabel="Birth year"
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              paddingHorizontal: space.md,
              paddingVertical: 13,
              fontSize: 16,
              letterSpacing: 0,
              color: colors.ink,
            }}
          />
          <Text variant="caption" tone="muted">
            {age === null
              ? 'Optional — it only nudges which savings lines we suggest.'
              : `You're ${age}. We'll lean the plan that way.`}
          </Text>
        </View>

        {/* The payoff, updating live as they tap. Three questions feel worth
            answering only if the answers visibly do something. */}
        <Surface style={{ gap: space.xs }}>
          <Row gap={space.sm}>
            <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {suggested.length} lines ready
            </Text>
          </Row>
          <Text variant="small" tone="secondary">
            {describePersona(answers)} — you can add or remove anything next.
          </Text>
        </Surface>
      </ScrollView>

      <PinnedFooter>
        <View style={{ gap: space.sm }}>
          <GradientButton label="Build my plan" icon="arrow-forward" onPress={handleContinue} />
          <Pressable
            onPress={() => router.push('/onboarding/categories')}
            accessibilityRole="button"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: space.xs })}
          >
            <Row justify="center">
              <Text variant="small" tone="muted">
                Skip — I'll pick my own
              </Text>
            </Row>
          </Pressable>
        </View>
      </PinnedFooter>
    </View>
  );
}

/** One question: a label, a hint, and a row of tappable tiles. */
function Question({
  label,
  hint,
  options,
  isSelected,
  onSelect,
}: {
  label: string;
  hint: string;
  options: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[];
  isSelected: (key: string) => boolean;
  onSelect: (key: string) => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {options.map((option) => {
          const selected = isSelected(option.key);
          return (
            <Pressable
              key={option.key}
              onPress={() => onSelect(option.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                flexGrow: 1,
                flexBasis: '30%',
                alignItems: 'center',
                gap: 6,
                paddingVertical: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: selected ? colors.accent : colors.hairline,
                backgroundColor: selected ? colors.accentSoft : colors.surface,
              })}
            >
              <Ionicons
                name={option.icon}
                size={22}
                color={selected ? colors.accent : colors.inkSecondary}
              />
              <Text
                variant="small"
                color={selected ? colors.accent : colors.inkSecondary}
                style={{ fontWeight: selected ? '700' : '500' }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" tone="muted">
        {hint}
      </Text>
    </View>
  );
}
