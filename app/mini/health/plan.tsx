import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Screen } from '~/shared/components/Screen';
import { Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { useAppSelector } from '~/store/useAppStore';
import { usePersonHealth } from '~/features/health/components/usePersonHealth';
import { useWeeklyPlan } from '~/features/health/components/useWeeklyPlan';
import { PlanLine } from '~/features/health/components/HealthHomeSections';
import { FOCUS_LABEL, planDayIndex, type Focus } from '~/features/health/logic/weeklyPlan';

/**
 * The whole week: pick a day for its exercise and meals, then the food rules
 * that hold every day, what to cut down on, how to stay safe, and where the
 * advice comes from. See logic/weeklyPlan.ts for the guidelines behind it.
 */
export default function WeeklyPlanScreen() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string }>();
  const people = useAppSelector((s) => s.healthPeople);
  const person = people.find((p) => p.id === params.person) ?? people[0];
  const health = usePersonHealth(person?.id, people);
  const plan = useWeeklyPlan(person, health);
  const todayIndex = planDayIndex(new Date());
  const [selected, setSelected] = useState(todayIndex);
  const day = plan.days[selected];

  const groups = new Map<Focus | null, string[]>();
  for (const rule of plan.rules) groups.set(rule.focus, [...(groups.get(rule.focus) ?? []), rule.text]);

  return (
    <Screen title="Weekly plan" onBack={() => router.back()}>
      <Surface>
        <View style={{ gap: space.sm }}>
          <Text variant="title">{plan.summary}</Text>
          <Text variant="small" tone="secondary">
            {`${plan.weeklyMinutes} minutes of activity and 2 strength days a week, with meals that suit all your results together.`}
          </Text>
        </View>
      </Surface>

      {plan.cautions
        .filter((c) => c.level === 'stop')
        .map((c) => (
          <Row
            key={c.text}
            gap={space.sm}
            style={{
              alignItems: 'flex-start',
              padding: space.md,
              borderRadius: radius.md,
              backgroundColor: colors.dangerSoft,
            }}
          >
            <Ionicons name="warning" size={18} color={colors.danger} />
            <Text variant="body" style={{ flex: 1, fontWeight: '700' }}>
              {c.text}
            </Text>
          </Row>
        ))}

      {/* The day picker. */}
      <View style={{ gap: space.sm }}>
        <Label>PICK A DAY</Label>
        <Row gap={4}>
          {plan.days.map((d, index) => {
            const active = index === selected;
            return (
              <Pressable
                key={d.short}
                onPress={() => setSelected(index)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={d.day}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: space.sm,
                  borderRadius: radius.md,
                  backgroundColor: active ? colors.accent : colors.surface,
                  borderWidth: 1,
                  borderColor: active ? colors.accent : colors.hairline,
                }}
              >
                <Text
                  variant="caption"
                  color={active ? colors.inkInverse : undefined}
                  style={{ fontWeight: '700' }}
                >
                  {d.short}
                </Text>
                {index === todayIndex ? (
                  <View
                    style={{
                      marginTop: 3,
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: active ? colors.inkInverse : colors.accent,
                    }}
                  />
                ) : (
                  <View style={{ marginTop: 3, height: 5 }} />
                )}
              </Pressable>
            );
          })}
        </Row>
      </View>

      <View style={{ gap: space.sm }}>
        <Label>{`${day.day.toUpperCase()}${selected === todayIndex ? ' · TODAY' : ''}`}</Label>
        <Surface>
          <View style={{ gap: space.lg }}>
            <PlanLine
              icon={day.exercise.kind === 'strength' ? 'barbell' : day.exercise.kind === 'rest' ? 'bed' : 'walk'}
              color={colors.completed}
              title={day.exercise.title}
              body={day.exercise.detail}
            />
            {day.extras.map((extra) => (
              <PlanLine key={extra} icon="add-circle" color={colors.completed} title="Also today" body={extra} />
            ))}
            <PlanLine icon="sunny" color={colors.pending} title="Breakfast" body={day.meals.breakfast} />
            <PlanLine icon="restaurant" color={colors.accent} title="Lunch" body={day.meals.lunch} />
            <PlanLine icon="cafe" color={colors.completed} title="Snack" body={day.meals.snack} />
            <PlanLine icon="moon" color={colors.inkSecondary} title="Dinner" body={day.meals.dinner} />
          </View>
        </Surface>
      </View>

      {/* Every day. */}
      <View style={{ gap: space.sm }}>
        <Label>EVERY DAY</Label>
        <Surface>
          <View style={{ gap: space.lg }}>
            {[...groups.entries()].map(([focus, texts]) => (
              <View key={focus ?? 'all'} style={{ gap: space.sm }}>
                <Text variant="bodyStrong">
                  {focus ? `For your ${FOCUS_LABEL[focus].toLowerCase()}` : 'For everyone'}
                </Text>
                {texts.map((text) => (
                  <Row key={text} gap={space.sm} style={{ alignItems: 'flex-start' }}>
                    <Ionicons name="checkmark" size={18} color={colors.completed} style={{ marginTop: 1 }} />
                    <Text variant="body" style={{ flex: 1 }}>
                      {text}
                    </Text>
                  </Row>
                ))}
              </View>
            ))}
          </View>
        </Surface>
      </View>

      {plan.avoid.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>CUT DOWN ON</Label>
          <Surface>
            <View style={{ gap: space.sm }}>
              {plan.avoid.map((text) => (
                <Row key={text} gap={space.sm} style={{ alignItems: 'flex-start' }}>
                  <Ionicons name="close-circle" size={18} color={colors.danger} style={{ marginTop: 1 }} />
                  <Text variant="body" style={{ flex: 1 }}>
                    {text}
                  </Text>
                </Row>
              ))}
            </View>
          </Surface>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Label>STAY SAFE</Label>
        <Surface>
          <View style={{ gap: space.sm }}>
            {plan.cautions
              .filter((c) => c.level === 'care')
              .map((c) => (
                <Row key={c.text} gap={space.sm} style={{ alignItems: 'flex-start' }}>
                  <Ionicons name="shield-checkmark" size={18} color={colors.pending} style={{ marginTop: 1 }} />
                  <Text variant="body" style={{ flex: 1 }}>
                    {c.text}
                  </Text>
                </Row>
              ))}
          </View>
        </Surface>
      </View>

      <View style={{ gap: space.sm }}>
        <Label>BASED ON</Label>
        <Surface>
          <View style={{ gap: space.sm }}>
            {plan.sources.map((src) => (
              <View key={src.title} style={{ gap: 1 }}>
                <Text variant="small" style={{ fontWeight: '700' }}>
                  {src.org}
                </Text>
                <Text variant="caption" tone="secondary">
                  {src.title}
                </Text>
              </View>
            ))}
            <Text variant="caption" tone="secondary" style={{ marginTop: space.xs }}>
              General advice from these guidelines, matched to your results. It is not a
              prescription — your doctor knows your full picture.
            </Text>
          </View>
        </Surface>
      </View>
    </Screen>
  );
}
