import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Divider, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { homeSeries, normalRangeText, type MetricSeries } from '~/features/health/logic/healthMetrics';
import { reportStory, type NeedsWork } from '~/features/health/logic/reportStory';
import { FOCUS_LABEL, planDayIndex, type WeeklyPlan } from '~/features/health/logic/weeklyPlan';
import { starterQuestions } from '~/features/health/logic/askHealth';
import { plainName, tidyValue } from '~/features/health/logic/plainTests';
import { labStatusStyle, RangeBar } from './LabUi';
import { categoryLook, ON_FILL } from './healthCategory';
import type { PersonHealth } from './usePersonHealth';

/**
 * The health home, top to bottom — three questions, in the order people ask:
 *
 *   AskAiBar         — "I have a question" (first, because it answers anything)
 *   ReportStoryCard  — "What did my reports say?" in simple English
 *   WeekPlanCard     — "What should I do?" — today's exercise and meals
 *   NumbersList      — every measure as one plain row, for looking things up
 *
 * Words before numbers everywhere; "high" and "low" spelled out with an
 * arrow; the normal range beside every value; a next step on everything off.
 */

const metricHref = (personId: string, key: string) =>
  `/mini/health/lab-test?person=${personId}&key=${encodeURIComponent(key)}`;

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/*
 * ---------------------------------------------------------------------------
 * Ask AI
 * ---------------------------------------------------------------------------
 */

export function AskAiBar({ personId, health }: { personId: string; health: PersonHealth }) {
  const { colors, radius, shadow, space } = useTheme();
  const router = useRouter();
  const open = (q?: string) =>
    router.push(`/ask?scope=health&person=${personId}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const starters = starterQuestions(
    health.series.map((x) => ({ testName: plainName(x.testKey, x.testName, x.latest.unit), latest: x.latest })),
    3,
  );

  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        onPress={() => open()}
        accessibilityRole="button"
        accessibilityLabel="Ask AI anything about your health"
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        {/*
          A plain field with the gradient only on its send button. The gradient
          rim around the whole bar spent the screen's one gradient on a border,
          and made the bar louder than the record it sits above.
        */}
          <Row
            gap={space.sm}
            style={{
              paddingLeft: space.lg,
              paddingRight: 6,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              ...shadow.card,
            }}
          >
            <Ionicons name="sparkles" size={18} color={colors.gradientStart} />
            <Text variant="body" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
              Ask AI anything about your health…
            </Text>
            <LinearGradient
              colors={[colors.gradientStart, colors.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="arrow-up" size={18} color={ON_FILL} />
            </LinearGradient>
          </Row>
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
      >
        {starters.map((q) => (
          <Pressable
            key={q}
            onPress={() => open(q)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingHorizontal: space.md,
              paddingVertical: 7,
              borderRadius: radius.pill,
              backgroundColor: pressed ? colors.surfaceSunken : colors.accentSoft,
            })}
          >
            <Text variant="caption" color={colors.accentInk} style={{ fontWeight: '700' }}>
              {q}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/*
 * ---------------------------------------------------------------------------
 * What your reports say
 * ---------------------------------------------------------------------------
 */

export function ReportStoryCard({ personId, health }: { personId: string; health: PersonHealth }) {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const scan = () => router.push(`/mini/health/analyze?person=${personId}`);

  if (health.series.length === 0) {
    return (
      <View style={{ gap: space.sm }}>
        <Label>WHAT YOUR REPORTS SAY</Label>
        <Surface onPress={scan}>
          <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.md,
                backgroundColor: colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="scan-outline" size={22} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text variant="heading">Scan a report to start</Text>
              <Text variant="small" tone="secondary">
                Take a photo of a lab report. Dayly tells you what it says in simple words, and gives
                you a plan for the week.
              </Text>
              <Row style={{ gap: 4, marginTop: space.xs }}>
                <Text variant="bodyStrong" tone="accent">
                  Scan a report
                </Text>
                <Ionicons name="arrow-forward" size={16} color={colors.accent} />
              </Row>
            </View>
          </Row>
        </Surface>
      </View>
    );
  }

  const story = reportStory(health.series);
  const total = health.series.length;
  const offCount = story.needsWork.length;
  const normalCount = total - offCount;
  const shown = story.needsWork.slice(0, 3);
  const more = story.needsWork.length - shown.length;

  return (
    <View style={{ gap: space.sm }}>
      <Label>WHAT YOUR REPORTS SAY</Label>
      <Surface padded={false} style={{ overflow: 'hidden' }}>
        <View style={{ padding: space.lg, gap: space.lg }}>
          {/* The score: one number and one bar, before any words. */}
          <View style={{ gap: space.sm }}>
            <Row style={{ alignItems: 'flex-end', gap: space.sm }}>
              <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>
                {`${normalCount}/${total}`}
              </Text>
              <Text variant="body" tone="secondary" style={{ paddingBottom: 5, flex: 1 }}>
                results normal
              </Text>
            </Row>
            <View
              style={{
                flexDirection: 'row',
                height: 10,
                gap: 3,
                borderRadius: radius.pill,
                overflow: 'hidden',
              }}
            >
              {normalCount > 0 ? <View style={{ flex: normalCount, backgroundColor: colors.completed }} /> : null}
              {offCount > 0 ? <View style={{ flex: offCount, backgroundColor: colors.pending }} /> : null}
            </View>
            {story.upTo ? (
              <Text variant="caption" tone="secondary">
                {`Up to ${shortDate(story.upTo)}`}
              </Text>
            ) : null}
          </View>

          {/* Each body area as a tile: a glance shows where the trouble is. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {story.areas.map((area) => (
              <AreaTile
                key={area.category}
                category={area.category}
                off={area.off}
                onPress={() => router.push(`/mini/health/labs?person=${personId}`)}
              />
            ))}
          </View>

          {shown.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Text variant="label" tone="muted">
                NEEDS WORK
              </Text>
              {shown.map((item) => (
                <NeedsWorkItem
                  key={item.testKey}
                  item={item}
                  onPress={() => router.push(metricHref(personId, item.testKey))}
                />
              ))}
              {more > 0 ? (
                <Pressable
                  onPress={() => router.push(`/mini/health/labs?person=${personId}`)}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text variant="small" tone="accent" style={{ fontWeight: '700' }}>
                    {`See ${more} more`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        {health.latestAnalysis ? (
          <>
            <Divider />
            <Pressable
              onPress={() => router.push(`/mini/health/analysis?id=${health.latestAnalysis!.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
              })}
            >
              <Ionicons name="document-text-outline" size={18} color={colors.accent} />
              <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
                See the full report
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.accent} />
            </Pressable>
          </>
        ) : null}
      </Surface>
    </View>
  );
}

/** One body area: its icon, its name, and a tick or a warning badge. */
function AreaTile({ category, off, onPress }: { category: string; off: number; onPress: () => void }) {
  const { colors, radius, space } = useTheme();
  const look = categoryLook(category);
  const ok = off === 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${look.title}: ${ok ? 'normal' : `${off} need a look`}`}
      style={({ pressed }) => ({
        width: '31.5%',
        alignItems: 'center',
        gap: 6,
        paddingVertical: space.md,
        paddingHorizontal: 4,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.hairline : colors.surfaceSunken,
      })}
    >
      <View>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: look.color,
          }}
        >
          <Ionicons name={look.icon} size={20} color={ON_FILL} />
        </View>
        <View
          style={{
            position: 'absolute',
            right: -5,
            bottom: -3,
            width: 18,
            height: 18,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
          }}
        >
          <Ionicons
            name={ok ? 'checkmark-circle' : 'alert-circle'}
            size={17}
            color={ok ? colors.completed : colors.pending}
          />
        </View>
      </View>
      <View style={{ alignItems: 'center' }}>
        <Text variant="caption" numberOfLines={1} style={{ textAlign: 'center', fontWeight: '700' }}>
          {look.short}
        </Text>
        <Text
          variant="caption"
          color={ok ? colors.completed : colors.pending}
          numberOfLines={1}
          style={{ fontSize: 11, fontWeight: '700' }}
        >
          {ok ? 'All normal' : `${off} to check`}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * One result that is off, drawn first and explained second:
 *
 *   Fasting blood sugar                142 mg/dL
 *   [ low |  normal  | ●  high ]
 *   👣 See your doctor soon.
 *   Why it matters ▾                      (opens the meaning)
 */
function NeedsWorkItem({ item, onPress }: { item: NeedsWork; onPress: () => void }) {
  const { colors, radius, space } = useTheme();
  const [why, setWhy] = useState(false);
  const status = labStatusStyle(item.status, colors);
  const value = item.numbers.split('. Normal is')[0].replace(/\.$/, '');
  const hasBar = item.value !== null && (item.refLow !== null || item.refHigh !== null);

  return (
    <View
      style={{
        padding: space.md,
        gap: space.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.hairline,
      }}
    >
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.numbers}`}>
        <Row style={{ gap: space.sm, alignItems: 'center' }}>
          <Ionicons name={status.icon} size={20} color={status.fg} />
          <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
            {item.title}
          </Text>
          <Text variant="bodyStrong" color={status.fg} style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1}>
            {value}
          </Text>
        </Row>
      </Pressable>

      {hasBar ? (
        <RangeBar value={item.value} refLow={item.refLow} refHigh={item.refHigh} status={item.status} />
      ) : (
        <Text variant="caption" tone="secondary">
          {item.numbers}
        </Text>
      )}

      <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
        <Ionicons name="footsteps" size={15} color={colors.accent} style={{ marginTop: 2 }} />
        <Text variant="small" style={{ flex: 1 }}>
          {item.todo}
        </Text>
      </Row>

      {item.meaning ? (
        <>
          <Pressable
            onPress={() => setWhy((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: why }}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text variant="caption" tone="accent" style={{ fontWeight: '700' }}>
              {why ? 'Hide' : 'Why it matters'}
            </Text>
            <Ionicons name={why ? 'chevron-up' : 'chevron-down'} size={13} color={colors.accent} />
          </Pressable>
          {why ? (
            <Text variant="small" tone="secondary">
              {item.meaning}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/*
 * ---------------------------------------------------------------------------
 * This week's plan
 * ---------------------------------------------------------------------------
 */

const EXERCISE_ICON = { walk: 'walk', strength: 'barbell', active: 'bicycle', rest: 'bed' } as const;

export function WeekPlanCard({ personId, plan }: { personId: string; plan: WeeklyPlan }) {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const todayIndex = planDayIndex(new Date());
  const today = plan.days[todayIndex];
  const stop = plan.cautions.find((c) => c.level === 'stop');

  return (
    <View style={{ gap: space.sm }}>
      <Label>YOUR PLAN FOR THIS WEEK</Label>
      <Surface padded={false} style={{ overflow: 'hidden' }}>
        <View style={{ padding: space.lg, gap: space.lg }}>
          <View style={{ gap: space.sm }}>
            <Text variant="heading">{plan.summary}</Text>
            {plan.focus.length > 0 ? (
              <Row gap={6} style={{ flexWrap: 'wrap' }}>
                {plan.focus.map((f) => (
                  <View
                    key={f}
                    style={{
                      paddingHorizontal: space.sm,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      backgroundColor: colors.accentSoft,
                    }}
                  >
                    <Text variant="caption" color={colors.accentInk} style={{ fontWeight: '700' }}>
                      {FOCUS_LABEL[f]}
                    </Text>
                  </View>
                ))}
              </Row>
            ) : null}
          </View>

          {stop ? (
            <Row
              gap={space.sm}
              style={{ alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft }}
            >
              <Ionicons name="warning" size={18} color={colors.danger} />
              <Text variant="small" style={{ flex: 1, fontWeight: '700' }}>
                {stop.text}
              </Text>
            </Row>
          ) : null}

          {/* The week at a glance: one icon per day, today ringed. */}
          <Row style={{ justifyContent: 'space-between' }}>
            {plan.days.map((d, index) => {
              const isToday = index === todayIndex;
              const rest = d.exercise.kind === 'rest';
              return (
                <View key={d.short} style={{ alignItems: 'center', gap: 4 }}>
                  <Text
                    variant="caption"
                    tone={isToday ? undefined : 'secondary'}
                    style={{ fontWeight: isToday ? '800' : '500', fontSize: 11 }}
                  >
                    {d.short.charAt(0)}
                  </Text>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isToday ? colors.completed : rest ? colors.surfaceSunken : colors.completedSoft,
                    }}
                  >
                    <Ionicons
                      name={EXERCISE_ICON[d.exercise.kind]}
                      size={18}
                      color={isToday ? ON_FILL : rest ? colors.inkMuted : colors.completed}
                    />
                  </View>
                </View>
              );
            })}
          </Row>

          {/* Today, in four short lines. */}
          <View style={{ gap: space.sm }}>
            <Text variant="label" tone="muted">
              {`TODAY · ${today.day.toUpperCase()}`}
            </Text>
            <TodayLine icon={EXERCISE_ICON[today.exercise.kind]} color={colors.completed} text={today.exercise.title} />
            {today.extras.slice(0, 1).map((e) => (
              <TodayLine key={e} icon="add-circle" color={colors.completed} text={e} />
            ))}
            <TodayLine icon="sunny" color={colors.pending} text={today.meals.breakfast} />
            <TodayLine icon="restaurant" color={colors.accent} text={today.meals.lunch} />
            <TodayLine icon="moon" color={colors.inkSecondary} text={today.meals.dinner} />
          </View>
        </View>

        <Divider />
        <Pressable
          onPress={() => router.push(`/mini/health/plan?person=${personId}`)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
          })}
        >
          <Ionicons name="calendar-outline" size={18} color={colors.accent} />
          <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
            See the whole week and why
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.accent} />
        </Pressable>
      </Surface>
    </View>
  );
}

function TodayLine({ icon, color, text }: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string }) {
  const { space } = useTheme();
  return (
    <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={17} color={color} style={{ marginTop: 1, width: 20 }} />
      <Text variant="small" style={{ flex: 1 }} numberOfLines={2}>
        {text}
      </Text>
    </Row>
  );
}

export function PlanLine({
  icon,
  color,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  body: string;
}) {
  const { radius, space } = useTheme();
  return (
    <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${color}1A`,
        }}
      >
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" tone="secondary">
          {body}
        </Text>
      </View>
    </Row>
  );
}

/*
 * ---------------------------------------------------------------------------
 * My numbers
 * ---------------------------------------------------------------------------
 */

export function NumbersList({ personId, health }: { personId: string; health: PersonHealth }) {
  const { colors, space } = useTheme();
  const router = useRouter();
  if (health.series.length === 0) return null;
  const shown = homeSeries(health.series);

  return (
    <View style={{ gap: space.sm }}>
      <Label>MY NUMBERS</Label>
      <Surface padded={false} style={{ overflow: 'hidden' }}>
        {shown.map((s, index) => (
          <View key={s.testKey}>
            {index > 0 ? <Divider /> : null}
            <NumberRow series={s} onPress={() => router.push(metricHref(personId, s.testKey))} />
          </View>
        ))}
        {health.series.length > shown.length ? (
          <>
            <Divider />
            <Pressable
              onPress={() => router.push(`/mini/health/labs?person=${personId}`)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                paddingVertical: space.md,
                backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
              })}
            >
              <Text variant="small" tone="accent" style={{ fontWeight: '700' }}>
                {`See all ${health.series.length} tests`}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.accent} />
            </Pressable>
          </>
        ) : null}
      </Surface>
    </View>
  );
}

/** Name and normal range on the left; the number and its word on the right. */
function NumberRow({ series, onPress }: { series: MetricSeries; onPress: () => void }) {
  const { colors, radius, space } = useTheme();
  const latest = series.latest;
  const status = labStatusStyle(latest.status, colors);
  const normal = normalRangeText(latest);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${series.testName}, ${latest.valueText} ${latest.unit ?? ''}, ${status.label}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {plainName(series.testKey, series.testName, latest.unit)}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {normal ? `Normal: ${normal}` : `Checked ${shortDate(latest.measuredAt)}`}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text variant="figure" style={{ fontVariant: ['tabular-nums'] }}>
          {tidyValue(latest.valueText)}
          {latest.unit ? <Text variant="caption" tone="secondary">{` ${latest.unit}`}</Text> : null}
        </Text>
        <Row
          gap={3}
          style={{
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: radius.pill,
            backgroundColor: status.bg,
          }}
        >
          <Ionicons name={status.icon} size={12} color={status.fg} />
          <Text variant="label" color={status.fg}>
            {status.label.toUpperCase()}
          </Text>
        </Row>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
    </Pressable>
  );
}
