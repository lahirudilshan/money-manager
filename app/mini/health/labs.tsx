import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Screen } from '~/shared/components/Screen';
import { Empty, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import type { MetricRow } from '~/features/health/logic/healthMetrics';
import { usePersonHealth } from '~/features/health/components/usePersonHealth';
import { useAppStore } from '~/store/useAppStore';
import {
  isOutOfRange,
  searchLabResults,
  suggestedQuestions,
  type TestGroup,
} from '~/features/health/logic/labReports';
import { HealthChart } from '~/features/health/components/HealthChart';
import {
  AiDisclaimer,
  formatLabValue,
  labBand,
  LabStatusPill,
  labStatusStyle,
} from '~/features/health/components/LabUi';
import { categoryLook } from '~/features/health/components/healthCategory';
import { normalRangeText } from '~/features/health/logic/healthMetrics';
import { plainName } from '~/features/health/logic/plainTests';
import { AnalyseRunBanner } from '~/features/health/components/AnalyseRunBanner';

/**
 * Ask about saved results — "what is my sugar level?" — answered offline.
 *
 * Nothing on this screen touches the network. The AI did its work when the
 * report was read; every answer here is a query over `health_lab_results`
 * (see `searchLabResults`), so it is instant, free, and can only ever show a
 * number that was actually printed on a report.
 *
 * An answer is a CARD per test — latest value, verdict, and the trend — rather
 * than a list of rows, because the question behind "what is my sugar?" is
 * almost always "and is it getting better?".
 */
export default function LabsScreen() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string; focus?: string; q?: string }>();
  const people = useAppStore((s) => s.healthPeople);
  const person = people.find((p) => p.id === params.person) ?? people[0];
  const [query, setQuery] = useState(params.q ?? '');

  /*
   * Home readings AND lab results, merged per measure (see healthMetrics.ts),
   * so "what is my sugar level?" finds the glucometer readings too.
   */
  const health = usePersonHealth(person?.id, people);
  const rows = useMemo(() => health.series.flatMap((s) => s.history), [health]);
  const groups = health.series;
  const suggestions = useMemo(() => suggestedQuestions(groups), [groups]);
  const answers = useMemo(() => searchLabResults(query, rows), [query, rows]);
  const searching = query.trim().length > 0;

  const byCategory = useMemo(() => {
    const map = new Map<string, TestGroup<MetricRow>[]>();
    for (const group of groups)
      map.set(group.category, [...(map.get(group.category) ?? []), group]);
    /*
     * Groups with something off first, so the screen opens on what needs a
     * look; then alphabetical. Inside a group, off results lead.
     */
    const offCount = (list: TestGroup<MetricRow>[]) =>
      list.filter((g) => isOutOfRange(g.latest.status) && !goodHdl(g)).length;
    return [...map.entries()]
      .map(([category, list]) => {
        const sorted = [...list].sort(
          (x, y) =>
            Number(isOutOfRange(y.latest.status) && !goodHdl(y)) -
            Number(isOutOfRange(x.latest.status) && !goodHdl(x)),
        );
        return [category, sorted] as const;
      })
      .sort(([a, la], [b, lb]) => offCount(lb) - offCount(la) || a.localeCompare(b));
  }, [groups]);

  if (!person) {
    return (
      <Screen title="My health numbers" onBack={() => router.back()}>
        <Text variant="body" tone="secondary">
          Add a person in Health first.
        </Text>
      </Screen>
    );
  }

  const openTest = (group: TestGroup) =>
    router.push(
      `/mini/health/lab-test?person=${person.id}&key=${encodeURIComponent(group.testKey)}`,
    );

  return (
    <Screen
      title={
        people.length === 1 || /^(me|myself|i)$/i.test(person.name.trim())
          ? 'My health numbers'
          : `${person.name.trim().split(' ')[0]}’s health numbers`
      }
      onBack={() => router.back()}
      footer={
        <GradientButton
          label="Read new reports with AI"
          icon="sparkles"
          onPress={() => router.push(`/mini/health/analyze?person=${person.id}`)}
        />
      }
    >
      {/* The question box */}
      <View style={{ gap: space.sm }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingHorizontal: space.lg,
            borderRadius: radius.pill,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: searching ? colors.accent : colors.hairlineStrong,
          }}
        >
          <Ionicons name="search" size={18} color={colors.inkSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus={params.focus === '1'}
            placeholder="What is my sugar level?"
            placeholderTextColor={colors.inkFaint}
            returnKeyType="search"
            autoCorrect={false}
            style={{ flex: 1, paddingVertical: space.md, fontSize: 15, color: colors.ink }}
          />
          {searching ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
            </Pressable>
          ) : null}
        </View>
        <Row style={{ gap: 6, alignItems: 'center', paddingHorizontal: space.xs }}>
          <Ionicons name="cloud-offline-outline" size={13} color={colors.inkMuted} />
          <Text variant="caption" tone="muted">
            Works offline — answers come from your saved reports.
          </Text>
        </Row>
        {!searching && suggestions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm }}
          >
            {suggestions.map((s) => (
              <Pressable
                key={s}
                onPress={() => setQuery(s)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? colors.accentSoft : colors.surface,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                })}
              >
                <Text variant="small" color={colors.accentInk} style={{ fontWeight: '600' }}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <AnalyseRunBanner personId={person.id} />

      {rows.length === 0 ? (
        <Empty
          icon="flask-outline"
          title="No health numbers yet"
          message="Scan a lab report and AI reads every result into here, or add a home reading. Then ask about any of them, any time, even offline."
          actionLabel="Upload reports"
          onAction={() => router.push(`/mini/health/analyze?person=${person.id}`)}
        />
      ) : searching ? (
        answers.length === 0 ? (
          <Surface>
            <View style={{ gap: space.sm, alignItems: 'center', paddingVertical: space.md }}>
              <Ionicons name="search-outline" size={28} color={colors.inkMuted} />
              <Text variant="heading">{`Nothing found for “${query.trim()}”`}</Text>
              <Text variant="small" tone="secondary" style={{ textAlign: 'center' }}>
                Try the test name or a simple word, like “sugar”, “cholesterol”, “kidney” or
                “haemoglobin”.
              </Text>
            </View>
          </Surface>
        ) : (
          <View style={{ gap: space.md }}>
            <Label>{`${answers.length} ${answers.length === 1 ? 'TEST' : 'TESTS'} FOUND`}</Label>
            {answers.map((group) => (
              <AnswerCard key={group.testKey} group={group} onPress={() => openTest(group)} />
            ))}
            <AiDisclaimer compact />
          </View>
        )
      ) : (
        <View style={{ gap: space.lg }}>
          {byCategory.map(([category, list]) => (
            <CategoryCard key={category} category={category} list={list} onOpen={openTest} />
          ))}
        </View>
      )}
    </Screen>
  );
}

/** One test as an answer: the number, the verdict, the trend. */
function AnswerCard({
  group,
  onPress,
}: {
  group: TestGroup<MetricRow>;
  onPress: () => void;
}) {
  const { colors, space } = useTheme();
  const latest = group.latest;
  const numeric = group.history.filter((r) => r.value !== null);
  const previous = numeric.length > 1 ? numeric[numeric.length - 2] : null;
  const change =
    previous && latest.value !== null ? latest.value - (previous.value as number) : null;

  return (
    <Surface onPress={onPress}>
      <View style={{ gap: space.md }}>
        <Row style={{ alignItems: 'flex-start', gap: space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" tone="secondary">
              {categoryLook(group.category).title}
            </Text>
            <Text variant="heading">{plainName(group.testKey, group.testName, group.latest.unit)}</Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.inkMuted}
            style={{ marginTop: 4 }}
          />
        </Row>

        <Row style={{ alignItems: 'flex-end', gap: space.md }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>
              {latest.valueText}
              {latest.unit ? (
                <Text variant="body" tone="secondary">{` ${latest.unit}`}</Text>
              ) : null}
            </Text>
            <Text variant="caption" tone="secondary">
              {`Last checked ${shortDate(latest.measuredAt)}`}
              {change !== null && previous
                ? ` · ${change === 0 ? 'same as' : change > 0 ? `up ${round(change)} from` : `down ${round(-change)} from`} ${shortDate(previous.measuredAt)}`
                : ''}
            </Text>
          </View>
          <LabStatusPill status={latest.status} />
        </Row>

        {numeric.length > 1 ? (
          <HealthChart
            points={numeric.map((r) => ({ at: r.measuredAt, value: r.value as number }))}
            band={labBand(latest)}
            height={96}
            color={colors.accent}
          />
        ) : null}
      </View>
    </Surface>
  );
}

function round(n: number): string {
  return String(Number(n.toFixed(2)));
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A high HDL is good news, not a result to flag. */
function goodHdl(group: TestGroup<MetricRow>): boolean {
  return group.testKey === 'hdl_cholesterol' && group.latest.status === 'high';
}

/**
 * One body area as a card: its name big with an icon, how it is doing in
 * words ("2 need a look · 12 normal"), then each test as a plain row. An area
 * that is all normal starts folded — nothing there needs reading.
 */
function CategoryCard({
  category,
  list,
  onOpen,
}: {
  category: string;
  list: readonly TestGroup<MetricRow>[];
  onOpen: (group: TestGroup) => void;
}) {
  const { colors, radius, space } = useTheme();
  const look = categoryLook(category);
  const off = list.filter((g) => isOutOfRange(g.latest.status) && !goodHdl(g)).length;
  const [open, setOpen] = useState(off > 0);
  const summary =
    off === 0
      ? list.length === 1
        ? 'Normal'
        : `All ${list.length} normal`
      : `${off} ${off === 1 ? 'needs' : 'need'} a look · ${list.length - off} normal`;

  return (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${look.title}, ${summary}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: look.color,
          }}
        >
          <Ionicons name={look.icon} size={22} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" style={{ fontSize: 19 }}>
            {look.title}
          </Text>
          <Row gap={4}>
            <Ionicons
              name={off === 0 ? 'checkmark-circle' : 'alert-circle'}
              size={14}
              color={off === 0 ? colors.completed : colors.pending}
            />
            <Text variant="small" tone="secondary" style={{ fontWeight: '700' }}>
              {summary}
            </Text>
          </Row>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.inkMuted} />
      </Pressable>

      {open
        ? list.map((group) => {
            const latest = group.latest;
            const good = goodHdl(group);
            const status = labStatusStyle(good ? 'normal' : latest.status, colors);
            const normal = normalRangeText(latest);
            return (
              <Pressable
                key={group.testKey}
                onPress={() => onOpen(group)}
                accessibilityRole="button"
                accessibilityLabel={`${plainName(group.testKey, group.testName, group.latest.unit)}, ${formatLabValue(latest)}, ${status.label}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: space.md,
                  alignItems: 'center',
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                  backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                })}
              >
                <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: status.fg }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {plainName(group.testKey, group.testName, group.latest.unit)}
                  </Text>
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {normal ? `Normal: ${normal}` : `Checked ${shortDate(latest.measuredAt)}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text variant="figure" style={{ fontVariant: ['tabular-nums'] }}>
                    {formatLabValue(latest)}
                  </Text>
                  {good ? (
                    <Text variant="label" color={colors.completed}>
                      GOOD
                    </Text>
                  ) : (
                    <LabStatusPill status={latest.status} />
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
              </Pressable>
            );
          })
        : null}
    </Surface>
  );
}
