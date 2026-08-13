import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import {
  BottomSheet,
  FOOTER_CLEARANCE,
  GradientButton,
  PinnedFooter,
  Row,
  StepHeader,
  Surface,
  Text,
} from '../../src/components/ui';
import { normaliseTransport } from '../../src/core/onboardingDraft';
import {
  ageFrom,
  describePersona,
  suggestedLines,
  type Household,
  type PersonaAnswers,
  type Transport,
} from '../../src/core/personas';
import { CATALOG_SUBCATEGORY_BY_ID } from '../../src/data/categoryCatalog';
import { hydrateOnboardingDraft, useOnboardingDraft } from '../../src/store/useOnboardingDraft';
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
 *
 * ## Reading the screen without reading the words
 *
 * Each question states its rule in a chip beside the number ("Pick any" /
 * "Pick one") rather than relying on the user inferring it from the prose. The
 * instruction sits ABOVE the tiles, since a hint printed underneath is read
 * after the tap it was meant to inform.
 *
 * Both tile questions are multi-select, and each has one option that is the
 * ABSENCE of the others — "Just me" and "Neither". Those clear the rest of the
 * row rather than joining it, so the contradictory states ("just me" plus
 * "kids", "neither" plus "car") cannot be reached.
 */
/**
 * How many category chips the preview names before collapsing to "+N more".
 *
 * Enough that a tap visibly changes the list, few enough that the card cannot
 * grow tall enough to push the primary button below the fold.
 */
const PREVIEW_LIMIT = 8;

/** Fixed row height in the year list, so `getItemLayout` can be exact. */
const YEAR_ROW_HEIGHT = 48;


/**
 * The lines `suggestedLines` gives everyone regardless of their answers.
 *
 * Mirrors the unconditional set at the top of that function. Listed here so the
 * preview can push them BEHIND the answer-driven ones — they are true for every
 * persona, so leading with them makes three different sets of answers produce
 * an identical-looking card.
 *
 * A drift here costs nothing worse than a chip ordered oddly, which is why this
 * is a display hint rather than a second source of truth: the ids still come
 * from `suggestedLines`, and anything not listed simply sorts first.
 */
const BASELINE_LINES = new Set([
  'salary',
  'groceries',
  'electricity',
  'water',
  'mobile',
  'emergency',
  'rent',
]);

export default function OnboardingAboutScreen() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const draft = useOnboardingDraft();

  /*
   * Seeded from the saved draft, so a mid-setup kill does not re-ask.
   *
   * Local state still drives the inputs — the store is the durable copy, not
   * the source of truth per keystroke — and every change is mirrored into it by
   * the effect below.
   */
  // Pull the saved draft in before these initialisers read it — see
  // `hydrateOnboardingDraft` for why this cannot be an effect.
  const [saved] = useState(() => {
    hydrateOnboardingDraft();
    return useOnboardingDraft.getState().answers;
  });
  const [household, setHousehold] = useState<Household[]>(
    () => (saved?.household as Household[]) ?? ['just_me'],
  );
  // `normaliseTransport` lifts a draft saved before this question became
  // multi-select — it holds a bare string there — into the array used here.
  const [transport, setTransport] = useState<Transport[]>(
    () => normaliseTransport(saved?.transport) as Transport[],
  );
  const [birthYear, setBirthYear] = useState(() => saved?.birthYear ?? '');
  const [yearPickerOpen, setYearPickerOpen] = useState(false);

  /*
   * Mirror answers into the draft on every change.
   *
   * An effect rather than a write inside each setter: `toggleHousehold` alone
   * has three branches, and the birth-year field changes on every keystroke —
   * one place that watches the values cannot miss a path the way five call
   * sites can.
   */
  React.useEffect(() => {
    draft.setAnswers({ household, transport, birthYear });
  }, [household, transport, birthYear]);

  const answers: PersonaAnswers = {
    household,
    transport,
    birthYear: birthYear.length === 4 ? Number(birthYear) : null,
  };

  const suggested = suggestedLines(answers);
  const age = ageFrom(answers.birthYear);

  /*
   * The named lines behind the count — the ones the ANSWERS earned, first.
   *
   * `suggestedLines` emits its universal baseline (salary, groceries, power,
   * water, mobile, emergency fund) before anything answer-specific, so taking
   * the first eight showed the same eight chips for every persona and only the
   * "+N more" counter moved. That is exactly the deadness the card exists to
   * fix, so the answer-driven lines are hoisted ahead of the baseline and the
   * chips visibly change on each tap.
   *
   * Filtered through the catalog for the same reason `handleContinue` does it —
   * an id with no catalog entry creates nothing — so the preview can never
   * promise a line the next screen will not show. Capped so a big household's
   * twenty lines do not push the primary button off the screen.
   */
  const previewLines = React.useMemo(() => {
    const specific = suggested.filter((id) => !BASELINE_LINES.has(id));
    const baseline = suggested.filter((id) => BASELINE_LINES.has(id));

    return [...specific, ...baseline]
      .map((id) => CATALOG_SUBCATEGORY_BY_ID.get(id)?.subcategory)
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .slice(0, PREVIEW_LIMIT);
  }, [suggested]);
  const overflowCount = Math.max(0, suggested.length - previewLines.length);

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

  /**
   * "Neither" is exclusive, the same way "Just me" is — it is the ABSENCE of a
   * vehicle, so it cannot coexist with one.
   *
   * Represented as an EMPTY array rather than `['none']`, because that is what
   * `suggestedLines` reads: no car and no bike is what puts public transport on
   * the plan. Keeping a 'none' member would mean two encodings of the same
   * answer, and one of them would eventually be checked wrong.
   */
  function toggleTransport(value: Transport) {
    setTransport((current) => {
      if (value === 'none') return [];

      return current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value];
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
      <StepHeader step={2} title="A bit about you" onBack={() => router.back()}>
        Three quick taps and we'll build a plan you can edit. Skip if you'd
        rather start from scratch.
      </StepHeader>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          /*
           * Room for the pinned footer, which OVERLAYS this scroll view rather
           * than sitting below it.
           *
           * `space.lg` was not nearly enough: the footer here is two stacked
           * controls ("Build my plan" plus the skip link) over the home
           * indicator, so the last ~120pt of content sat permanently underneath
           * it. What got clipped was the preview card naming the lines the
           * answers produced — the entire payoff for answering three questions,
           * and unreachable because the list was already scrolled to its end.
           */
          paddingBottom: space.lg + FOOTER_CLEARANCE,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Question
          index={1}
          label="Who are you looking after?"
          rule="multi"
          hint="Adds the lines a household actually pays for."
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
          index={2}
          label="Do you drive?"
          rule="multi"
          hint="Adds fuel, service and insurance — or leaves them out."
          options={[
            { key: 'car', label: 'Car', icon: 'car-sport-outline' },
            { key: 'bike', label: 'Motorbike', icon: 'bicycle-outline' },
            { key: 'none', label: 'Neither', icon: 'bus-outline' },
          ]}
          // "Neither" reads as chosen exactly when no vehicle is — the empty
          // array IS that answer, so it has no member of its own to match.
          isSelected={(key) =>
            key === 'none' ? transport.length === 0 : transport.includes(key as Transport)
          }
          onSelect={(key) => toggleTransport(key as Transport)}
        />

        <View style={{ gap: space.sm }}>
          <QuestionHeader
            index={3}
            label="What year were you born?"
            badge="Optional"
            hint="Only nudges which savings lines we suggest."
          />

          {/*
            A picker rather than a free text field.

            Typing four digits on a number pad is the only keyboard on this
            screen, and it accepts "3" and "19" as happily as "1990" — states
            that are neither valid nor an error, so the caption underneath
            flickered between "You're 35" and nothing as the user typed. A list
            of real years can only produce answers `ageFrom` accepts.
          */}
          <Row gap={space.sm}>
            <Pressable
              onPress={() => setYearPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={birthYear ? `Birth year ${birthYear}. Change` : 'Choose birth year'}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                opacity: pressed ? 0.7 : 1,
                backgroundColor: colors.surface,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.hairline,
                paddingHorizontal: space.md,
                paddingVertical: 13,
              })}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.inkMuted} />
              <Text variant="body" style={{ flex: 1 }} color={birthYear ? colors.ink : colors.inkFaint}>
                {birthYear || 'Choose a year'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.inkMuted} />
            </Pressable>

            {/* Only earns its place once there is something to clear. */}
            {birthYear.length > 0 && (
              <Pressable
                onPress={() => setBirthYear('')}
                accessibilityRole="button"
                accessibilityLabel="Clear birth year"
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: space.xs })}
              >
                <Ionicons name="close-circle" size={22} color={colors.inkMuted} />
              </Pressable>
            )}
          </Row>

          {age !== null && (
            <Text variant="caption" tone="secondary">
              You're {age} — we'll lean the plan that way.
            </Text>
          )}
        </View>

        {/*
          The payoff, updating live as they tap. Three questions feel worth
          answering only if the answers visibly do something — and a bare count
          ("8 lines ready") is not visibly anything, because the user cannot
          tell what changed when it becomes 13. Naming the lines makes each tap
          legible, so the preview shows the actual categories and keeps the
          count as a summary.
        */}
        <Surface style={{ gap: space.sm }}>
          <Row gap={space.sm}>
            <Ionicons name="sparkles" size={18} color={colors.accent} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {suggested.length} lines ready
            </Text>
          </Row>
          <Text variant="small" tone="secondary">
            {describePersona(answers)}.
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {previewLines.map((line) => (
              <View
                key={line.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingVertical: 4,
                  paddingHorizontal: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: colors.accentSoft,
                }}
              >
                <Ionicons name={line.icon} size={12} color={colors.accentInk} />
                <Text variant="caption" color={colors.accentInk}>
                  {line.name}
                </Text>
              </View>
            ))}
            {overflowCount > 0 && (
              <View
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surfaceSunken,
                }}
              >
                <Text variant="caption" tone="muted">
                  +{overflowCount} more
                </Text>
              </View>
            )}
          </View>

          <Text variant="caption" tone="muted">
            You can add or remove anything on the next screen.
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

      <YearPicker
        visible={yearPickerOpen}
        selected={birthYear}
        onClose={() => setYearPickerOpen(false)}
        onSelect={(year) => {
          setBirthYear(year);
          setYearPickerOpen(false);
        }}
      />
    </View>
  );
}

/**
 * Birth-year picker: a searchable list of every plausible year.
 *
 * Search matters more than it looks. The list is ~95 rows and the answer is
 * always 2–4 digits the user knows exactly, so typing "88" to land on 1988
 * beats scrolling through eighty rows to reach it. The match is a substring
 * rather than a prefix so both "88" and "1988" find the same row.
 *
 * Opens scrolled to the current answer when there is one, so re-opening to
 * change a year by one does not start from the top of the list.
 */
function YearPicker({
  visible,
  selected,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selected: string;
  onClose: () => void;
  onSelect: (year: string) => void;
}) {
  const { colors, radius, space } = useTheme();
  const [query, setQuery] = useState('');

  // Newest first: the youngest plausible user is the likeliest, and it puts the
  // common answers at the top rather than eighty rows down.
  const years = React.useMemo(() => {
    const current = new Date().getFullYear();
    // Mirrors `ageFrom`'s accepted band (13–110), so the list cannot offer a
    // year that function then rejects as a typo.
    return Array.from({ length: 110 - 13 + 1 }, (_, i) => String(current - 13 - i));
  }, []);

  const matches = React.useMemo(() => {
    const q = query.trim();
    if (!q) return years;
    return years.filter((year) => year.includes(q));
  }, [query, years]);

  // A fresh search each time the sheet opens — a stale filter from last time
  // would hide the list behind a query the user cannot see the reason for.
  React.useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="What year were you born?"
      icon="calendar-outline"
    >
      <View style={{ flex: 1, gap: space.sm, padding: space.lg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.hairline,
            backgroundColor: colors.surface,
          }}
        >
          <Ionicons name="search" size={16} color={colors.inkMuted} />
          <TextInput
            value={query}
            onChangeText={(text) => setQuery(text.replace(/[^\d]/g, '').slice(0, 4))}
            placeholder="Search year…"
            placeholderTextColor={colors.inkMuted}
            keyboardType="number-pad"
            autoCorrect={false}
            accessibilityLabel="Search year"
            style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.ink }}
          />
          {query ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
            >
              <Ionicons name="close-circle" size={16} color={colors.inkMuted} />
            </Pressable>
          ) : null}
        </View>

        {matches.length === 0 ? (
          <Surface>
            <Text variant="caption" tone="muted">
              No year matches “{query.trim()}”.
            </Text>
          </Surface>
        ) : (
          <FlatList
            data={matches}
            keyExtractor={(year) => year}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // Fixed row height, so scrolling to the selected year lands exactly
            // rather than being estimated.
            getItemLayout={(_, index) => ({
              length: YEAR_ROW_HEIGHT,
              offset: YEAR_ROW_HEIGHT * index,
              index,
            })}
            initialScrollIndex={Math.max(0, matches.indexOf(selected))}
            renderItem={({ item: year }) => {
              const isSelected = year === selected;
              return (
                <Pressable
                  onPress={() => onSelect(year)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={year}
                  style={({ pressed }) => ({
                    height: YEAR_ROW_HEIGHT,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: space.md,
                    borderRadius: radius.md,
                    backgroundColor: isSelected
                      ? colors.accentSoft
                      : pressed
                        ? colors.surfaceSunken
                        : 'transparent',
                  })}
                >
                  <Text
                    variant="body"
                    color={isSelected ? colors.accent : colors.ink}
                    style={{ fontWeight: isSelected ? '700' : '500' }}
                  >
                    {year}
                  </Text>
                  {isSelected ? (
                    <Ionicons name="checkmark" size={18} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </BottomSheet>
  );
}


/**
 * The numbered heading above each question.
 *
 * Carries the one thing the old screen left implicit: whether this question
 * takes one answer or several. Stated as a chip rather than buried in prose,
 * and placed above the tiles so it is read before the tap rather than after.
 */
function QuestionHeader({
  index,
  label,
  badge,
  hint,
}: {
  index: number;
  label: string;
  badge: string;
  hint: string;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.xs }}>
      <Row gap={space.sm}>
        {/* The step number, so three questions read as a short countable list
            rather than an open-ended form. */}
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accentSoft,
          }}
        >
          <Text variant="caption" color={colors.accentInk} style={{ fontWeight: '700' }}>
            {index}
          </Text>
        </View>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {label}
        </Text>
        <View
          style={{
            paddingVertical: 2,
            paddingHorizontal: space.sm,
            borderRadius: radius.pill,
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <Text variant="caption" tone="muted">
            {badge}
          </Text>
        </View>
      </Row>
      <Text variant="caption" tone="muted">
        {hint}
      </Text>
    </View>
  );
}

/** One question: a numbered heading, a rule chip, and a grid of tappable tiles. */
function Question({
  index,
  label,
  rule,
  hint,
  options,
  isSelected,
  onSelect,
}: {
  index: number;
  label: string;
  /** Whether the question takes several answers or exactly one. */
  rule: 'multi' | 'single';
  hint: string;
  options: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[];
  isSelected: (key: string) => boolean;
  onSelect: (key: string) => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      <QuestionHeader
        index={index}
        label={label}
        badge={rule === 'multi' ? 'Pick any' : 'Pick one'}
        hint={hint}
      />

      {/*
        Fixed columns, not growing ones.

        With `flexGrow: 1` a last row holding fewer tiles than the row above
        stretched to fill the width. Pinning the column width keeps every tile
        on the same grid however many the row happens to hold.

        Half a gutter on each column rather than a row `gap`, since that divides
        evenly across a short last row; the row is pulled out by the same half
        gutter so the grid's outer edge still meets the screen margin. Same
        approach as the bank grid in step 1.
      */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          rowGap: space.sm,
          marginHorizontal: -(space.sm / 2),
        }}
      >
        {options.map((option) => {
          const selected = isSelected(option.key);
          return (
            <View
              key={option.key}
              style={{ width: '33.333%', paddingHorizontal: space.sm / 2 }}
            >
              <Pressable
                onPress={() => onSelect(option.key)}
                accessibilityRole={rule === 'multi' ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: selected, selected }}
                accessibilityLabel={option.label}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: space.md,
                  borderRadius: radius.md,
                  // Two borders' worth of emphasis on the selected tile: colour
                  // alone is not enough for a user who cannot separate the
                  // accent from the hairline.
                  borderWidth: selected ? 2 : 1,
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
                  numberOfLines={1}
                  color={selected ? colors.accent : colors.inkSecondary}
                  style={{ fontWeight: selected ? '700' : '500' }}
                >
                  {option.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
