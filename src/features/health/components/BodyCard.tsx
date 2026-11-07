import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import type { HealthPerson } from '~/db/schema';
import type { MetricSeries } from '../logic/healthMetrics';
import {
  BMI_BAND_LABEL,
  bodyReport,
  explainBody,
  WAIST_BAND_LABEL,
  type BmiBand,
} from '../logic/bodyMeasures';

/**
 * BMI and the figures that come with it, worked out from the profile's height,
 * waist, age and sex and the latest weight (home reading or lab report).
 *
 * Says what is missing instead of hiding: "Add height to see your BMI" is the
 * prompt that gets the profile filled in.
 */
export function BodyCard({
  person,
  weightSeries,
  onEdit,
}: {
  person: HealthPerson;
  weightSeries: MetricSeries | undefined;
  onEdit: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const [open, setOpen] = useState(false);

  const latest = weightSeries?.latest;
  const weightKg =
    latest?.value != null ? (/lb/i.test(latest.unit ?? '') ? latest.value * 0.453592 : latest.value) : null;
  const age = person.bornOn ? yearsSince(person.bornOn) : null;

  const report = bodyReport({
    heightCm: person.heightCm ?? null,
    weightKg,
    waistCm: person.waistCm ?? null,
    age,
    sex: person.sex ?? null,
  });

  const bandColor = (band: BmiBand | null) =>
    band === 'healthy'
      ? colors.completed
      : band === 'underweight' || band === 'overweight'
        ? colors.pending
        : band === 'obese'
          ? colors.danger
          : colors.inkSecondary;

  // Nothing at all yet — one prompt, not an empty card.
  if (!report.bmi && !report.healthyWeight) {
    return (
      <Pressable onPress={onEdit} accessibilityRole="button">
        <Surface>
          <Row gap={space.md} style={{ alignItems: 'center' }}>
            <Ionicons name="body-outline" size={22} color={colors.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">Add height and weight</Text>
              <Text variant="caption" tone="secondary">
                To see BMI, a healthy weight for your height, and daily calories.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
          </Row>
        </Surface>
      </Pressable>
    );
  }

  const bmi = report.bmi;
  const tint = bandColor(bmi?.who ?? null);

  return (
    <View style={{ gap: space.sm }}>
      <Label>BODY</Label>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityHint="Show how this is worked out">
        <Surface style={{ gap: space.md }}>
          {bmi ? (
            <View style={{ gap: space.sm }}>
              <Row style={{ alignItems: 'center', gap: space.sm }}>
                <Text variant="caption" tone="secondary">
                  BMI
                </Text>
                <Text variant="title" style={{ fontVariant: ['tabular-nums'] }}>
                  {bmi.value.toFixed(1)}
                </Text>
                <View style={{ flex: 1 }} />
                {bmi.who ? (
                  <View
                    style={{
                      paddingHorizontal: space.sm,
                      paddingVertical: 3,
                      borderRadius: radius.sm,
                      backgroundColor: tint + '22',
                    }}
                  >
                    <Text variant="caption" color={tint} style={{ fontWeight: '800' }}>
                      {BMI_BAND_LABEL[bmi.who]}
                      {bmi.obeseClass ? ` ${'I'.repeat(bmi.obeseClass)}` : ''}
                    </Text>
                  </View>
                ) : null}
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.inkMuted} />
              </Row>
              {bmi.isChild ? (
                <Text variant="caption" tone="secondary">
                  Under 18 — read BMI against growth charts, not adult ranges.
                </Text>
              ) : (
                <>
                  <BmiScale value={bmi.value} />
                  {bmi.asian && bmi.asian !== bmi.who ? (
                    <Text variant="caption" color={colors.pending}>
                      {`${BMI_BAND_LABEL[bmi.asian]} by Asian cut-offs (healthy up to 22.9)`}
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          ) : null}

          {/* The figures, one short line each. */}
          {report.healthyWeight || report.dailyCalories || report.waistToHeight ? (
            <View style={{ gap: 6 }}>
              {report.healthyWeight ? (
                <Fact
                  icon="scale-outline"
                  label="Healthy weight"
                  value={`${Math.round(report.healthyWeight.low)}–${Math.round(report.healthyWeight.high)} kg`}
                  extra={
                    report.toHealthy && report.toHealthy > 0
                      ? `${report.toHealthy} kg over`
                      : report.toHealthy && report.toHealthy < 0
                        ? `${Math.abs(report.toHealthy)} kg under`
                        : undefined
                  }
                  warn={Boolean(report.toHealthy)}
                />
              ) : null}
              {report.dailyCalories ? (
                <Fact
                  icon="flame-outline"
                  label="Calories a day"
                  value={`${report.dailyCalories.low.toLocaleString()}–${report.dailyCalories.high.toLocaleString()}`}
                />
              ) : null}
              {report.waistToHeight ? (
                <Fact
                  icon="resize-outline"
                  label="Waist ÷ height"
                  value={report.waistToHeight.value.toFixed(2)}
                  extra={WAIST_BAND_LABEL[report.waistToHeight.band]}
                  warn={report.waistToHeight.band === 'raised' || report.waistToHeight.band === 'high'}
                />
              ) : null}
            </View>
          ) : null}

          {/* The explanation, in plain words — on tap, so the card stays short. */}
          {open ? (
            <View style={{ gap: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.hairline }}>
              {explainBody(report, { heightCm: person.heightCm ?? null, weightKg, lengthUnit: person.lengthUnit }).map(
                (part) => (
                  <View key={part.title} style={{ gap: 4 }}>
                    <Text variant="bodyStrong">{part.title}</Text>
                    <Text variant="small" tone="secondary">
                      {part.text}
                    </Text>
                  </View>
                ),
              )}
            </View>
          ) : null}

          {report.missing.length > 0 ? (
            <Pressable onPress={onEdit} accessibilityRole="button">
              <Row gap={space.sm} style={{ alignItems: 'center' }}>
                <Ionicons name="add-circle-outline" size={16} color={colors.accent} />
                <Text variant="caption" color={colors.accent} style={{ flex: 1, fontWeight: '700' }}>
                  {`Add ${joinWords(report.missing)} for ${missingFor(report.missing)}`}
                </Text>
              </Row>
            </Pressable>
          ) : null}
        </Surface>
      </Pressable>
    </View>
  );
}

/** A bar from 15 to 40 with the WHO bands, and a marker at the value. */
function BmiScale({ value }: { value: number }) {
  const { colors, radius } = useTheme();
  const min = 15;
  const max = 40;
  const at = (v: number) => ((Math.min(Math.max(v, min), max) - min) / (max - min)) * 100;
  const segments = [
    { from: 15, to: 18.5, color: colors.pending },
    { from: 18.5, to: 25, color: colors.completed },
    { from: 25, to: 30, color: colors.pending },
    { from: 30, to: 40, color: colors.danger },
  ];
  return (
    <View style={{ gap: 4 }}>
      <View style={{ height: 8, flexDirection: 'row', borderRadius: radius.sm, overflow: 'hidden' }}>
        {segments.map((s) => (
          <View key={s.from} style={{ width: `${at(s.to) - at(s.from)}%`, backgroundColor: s.color, opacity: 0.75 }} />
        ))}
      </View>
      <View style={{ height: 10 }}>
        <View
          style={{
            position: 'absolute',
            left: `${at(value)}%`,
            marginLeft: -6,
            top: -14,
            width: 12,
            height: 12,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: colors.surface,
            backgroundColor: colors.ink,
          }}
        />
        <Row style={{ justifyContent: 'space-between' }}>
          {['15', '18.5', '25', '30', '40'].map((t) => (
            <Text key={t} variant="caption" tone="muted" style={{ fontSize: 10 }}>
              {t}
            </Text>
          ))}
        </Row>
      </View>
    </View>
  );
}

function Fact({
  icon,
  label,
  value,
  extra,
  warn,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  extra?: string;
  warn?: boolean;
}) {
  const { colors, space } = useTheme();
  return (
    <Row gap={space.sm} style={{ alignItems: 'center' }}>
      <Ionicons name={icon} size={15} color={warn ? colors.pending : colors.accent} />
      <Text variant="small" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      {extra ? (
        <Text variant="caption" color={warn ? colors.pending : colors.inkSecondary} style={{ fontWeight: '700' }}>
          {extra}
        </Text>
      ) : null}
      <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
    </Row>
  );
}

function yearsSince(date: Date): number {
  const now = new Date();
  let years = now.getFullYear() - date.getFullYear();
  if (
    now.getMonth() < date.getMonth() ||
    (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())
  )
    years -= 1;
  return years;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function missingFor(missing: string[]): string {
  if (missing.includes('height') || missing.includes('weight')) return 'your BMI';
  if (missing.includes('waist') && missing.length === 1) return 'waist-to-height';
  return 'daily calories';
}
