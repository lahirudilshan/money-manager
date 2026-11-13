import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { Row, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { relationLabel, type HealthPerson } from '~/db/schema';
import { bodyReport, formatHeight, formatWaist } from '~/features/health/logic/bodyMeasures';
import { HEALTH_TINT, ON_FILL } from './healthCategory';

/**
 * Who this record is for, and the facts needed in a hurry:
 *
 *   (M)  Me                                   ✎
 *        31 years · Male
 *   ┌────────┬────────┬────────┬────────┐
 *   │ 💧 B+  │ ↕ 5′8″ │ ⚖ 68kg │ ◔ 22.8 │
 *   │ Blood  │ Height │ Weight │ Healthy│
 *   └────────┴────────┴────────┴────────┘
 *   ⚠ Allergic to: penicillin
 *
 * Four equal tiles instead of a dotted sentence, so each fact can be found
 * at a glance; BMI carries its verdict word and colour. A missing fact says
 * "Not set" — the prompt that gets the profile filled in.
 */
export function PersonCard({
  person,
  weight,
  onPress,
}: {
  person: HealthPerson;
  /** The latest weight, from a home reading or a lab report. */
  weight: { value: number | null; unit: string | null } | undefined;
  onPress: () => void;
}) {
  const { colors, radius, shadow, space } = useTheme();
  const age = person.bornOn
    ? Math.floor((Date.now() - person.bornOn.getTime()) / (365.25 * 86_400_000))
    : null;
  const weightKg =
    weight?.value != null ? (/lb/i.test(weight.unit ?? '') ? weight.value * 0.453592 : weight.value) : null;
  const body = bodyReport({
    heightCm: person.heightCm ?? null,
    weightKg,
    waistCm: person.waistCm ?? null,
    age,
    sex: person.sex ?? null,
  });
  const bmi = body.bmi && !body.bmi.isChild ? body.bmi : null;
  const bmiTone =
    bmi?.who === 'healthy'
      ? { fg: colors.completed, bg: colors.completedSoft, line: 'A healthy weight for your height' }
      : bmi?.who === 'underweight'
        ? { fg: colors.pending, bg: colors.pendingSoft, line: 'A little light for your height' }
        : bmi?.who === 'overweight'
          ? { fg: colors.pending, bg: colors.pendingSoft, line: 'A little heavy for your height' }
          : bmi?.who === 'obese'
            ? { fg: colors.danger, bg: colors.dangerSoft, line: 'Heavy for your height — worth working on' }
            : null;

  const subtitle = [
    person.relation !== 'self' && relationLabel(person) !== person.name ? relationLabel(person) : null,
    age !== null ? `${age} years` : null,
    person.sex ? (person.sex === 'male' ? 'Male' : 'Female') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const tiles: { key: string; icon: keyof typeof Ionicons.glyphMap; tint: string; value: string | null; label: string; labelColor?: string }[] = [
    { key: 'blood', icon: 'water', tint: HEALTH_TINT.blood, value: person.bloodGroup ?? null, label: 'Blood' },
    {
      key: 'height',
      icon: 'resize',
      tint: colors.accent,
      value: person.heightCm ? formatHeight(person.heightCm, person.lengthUnit) : null,
      label: 'Height',
    },
    {
      key: 'weight',
      icon: 'barbell',
      tint: HEALTH_TINT.weight,
      value: weight?.value != null ? `${trim(weight.value)} ${weight.unit ?? 'kg'}` : null,
      label: 'Weight',
    },
    bmi && bmiTone
      ? { key: 'bmi', icon: 'speedometer', tint: bmiTone.fg, value: trim(bmi.value), label: 'BMI', labelColor: bmiTone.fg }
      : {
          key: 'waist',
          icon: 'ellipse-outline',
          tint: HEALTH_TINT.waist,
          value: person.waistCm ? formatWaist(person.waistCm, person.lengthUnit) : null,
          label: 'Waist',
        },
  ];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${person.name}'s profile`}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      {/*
        A plain card, ringed in the person's own colour — the same colour as
        their avatar in the people strip, so switching person visibly changes
        the card. The green wash it had was the same for everyone.
      */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          padding: space.lg,
          gap: space.lg,
          borderWidth: 1,
          borderColor: colors.hairline,
          ...shadow.card,
        }}
      >
        <Row gap={space.md}>
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: 29,
              borderWidth: 2,
              borderColor: person.color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: person.color,
                overflow: 'hidden',
              }}
            >
              {person.imageUri ? (
                <Image source={{ uri: person.imageUri }} style={{ width: 48, height: 48 }} />
              ) : (
                <Text variant="title" color={ON_FILL}>
                  {person.name.trim().charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" numberOfLines={1}>
              {person.name}
            </Text>
            <Text variant="small" tone="secondary" numberOfLines={1}>
              {subtitle || 'Add age and other details'}
            </Text>
          </View>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceSunken,
            }}
          >
            <Ionicons name="create-outline" size={18} color={colors.inkSecondary} />
          </View>
        </Row>

        {/* One strip, hairlines between: four facts read left to right. */}
        <View
          style={{
            flexDirection: 'row',
            borderRadius: radius.md,
            backgroundColor: colors.surfaceSunken,
            paddingVertical: space.md,
          }}
        >
          {tiles.map((t, index) => (
            <View
              key={t.key}
              style={{
                flex: 1,
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 2,
                borderLeftWidth: index === 0 ? 0 : 1,
                borderLeftColor: colors.hairlineStrong,
              }}
            >
              <Ionicons name={t.icon} size={16} color={t.tint} />
              <Text
                variant="figure"
                color={t.value ? t.labelColor : undefined}
                tone={t.value ? undefined : 'muted'}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                style={{ fontVariant: ['tabular-nums'], fontSize: t.value ? 17 : 12 }}
              >
                {t.value ?? 'Not set'}
              </Text>
              <Text variant="caption" tone="secondary" numberOfLines={1} style={{ fontSize: 11 }}>
                {t.label}
              </Text>
            </View>
          ))}
        </View>

        {person.allergies ? (
          <Row
            gap={space.sm}
            style={{
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: radius.md,
              backgroundColor: colors.dangerSoft,
            }}
          >
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text variant="small" numberOfLines={2} style={{ flex: 1 }}>
              <Text variant="small" style={{ fontWeight: '700' }}>
                {'Allergic to: '}
              </Text>
              {person.allergies}
            </Text>
          </Row>
        ) : null}
      </View>
    </Pressable>
  );
}

function trim(n: number): string {
  return String(Number(n.toFixed(1)));
}
