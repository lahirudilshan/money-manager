import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { bandIndexFor, type MeasureGuide } from '~/features/health/logic/measureGuide';
import type { LabStatusKey } from '~/features/health/logic/labReports';
import { labStatusStyle } from './LabUi';

/**
 * "Understanding blood pressure": what it is, what each level means and does
 * to the body, what helps, and when not to wait.
 *
 * The band the person is in right now is OPEN and marked "You are here"; the
 * others stay one tap away. Opening all four at once is a page of text, and
 * the one that matters is the one that applies.
 */
export function MeasureGuideCard({
  guide,
  status,
}: {
  guide: MeasureGuide;
  status: LabStatusKey;
}) {
  const { colors, radius, space } = useTheme();
  const current = bandIndexFor(guide, status);
  const [open, setOpen] = useState<number | null>(current >= 0 ? current : null);

  return (
    <View style={{ gap: space.sm }}>
      <Label>{`${guide.title.toUpperCase()} LEVELS`}</Label>
      <Surface>
        <View style={{ gap: space.md }}>
          <Text variant="body" tone="secondary">
            {guide.what}
          </Text>

          {/* The levels, one row each; the person's own level open. */}
          <View
            style={{
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              overflow: 'hidden',
            }}
          >
            {guide.bands.map((band, index) => {
              const style = labStatusStyle(band.status, colors);
              const here = index === current;
              const expanded = open === index;
              return (
                <View
                  key={band.name}
                  style={{
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colors.hairline,
                    backgroundColor: here ? style.bg : 'transparent',
                  }}
                >
                  <Pressable
                    onPress={() => setOpen(expanded ? null : index)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${band.name}, ${band.range}${here ? ', your level' : ''}`}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      padding: space.md,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Ionicons name={style.icon} size={18} color={style.fg} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <Row style={{ gap: space.sm, alignItems: 'center' }}>
                        <Text variant="bodyStrong">{band.name}</Text>
                        {here ? (
                          <View
                            style={{
                              paddingHorizontal: 6,
                              paddingVertical: 1,
                              borderRadius: radius.pill,
                              backgroundColor: style.fg,
                            }}
                          >
                            <Text variant="label" color={colors.inkInverse} style={{ fontSize: 9 }}>
                              YOU ARE HERE
                            </Text>
                          </View>
                        ) : null}
                      </Row>
                      <Text
                        variant="caption"
                        tone="secondary"
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
                        {`${band.range} ${guide.unit}`}
                      </Text>
                    </View>
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.inkMuted}
                    />
                  </Pressable>
                  {expanded ? (
                    <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
                      <Text variant="small">{band.meaning}</Text>
                      <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
                        <Ionicons name="body-outline" size={15} color={colors.inkSecondary} style={{ marginTop: 2 }} />
                        <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                          {band.effects}
                        </Text>
                      </Row>
                      <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
                        <Ionicons name="footsteps-outline" size={15} color={colors.accent} style={{ marginTop: 2 }} />
                        <Text variant="small" style={{ flex: 1 }}>
                          <Text variant="small" style={{ fontWeight: '700' }}>
                            {'What to do: '}
                          </Text>
                          {band.todo}
                        </Text>
                      </Row>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {guide.helps.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Text variant="small" style={{ fontWeight: '700' }}>
                What helps
              </Text>
              {guide.helps.map((item) => (
                <Row key={item} style={{ gap: space.sm, alignItems: 'flex-start' }}>
                  <Ionicons name="leaf-outline" size={15} color={colors.completed} style={{ marginTop: 2 }} />
                  <Text variant="small" style={{ flex: 1 }}>
                    {item}
                  </Text>
                </Row>
              ))}
            </View>
          ) : null}

          {guide.urgent ? (
            <View
              style={{
                flexDirection: 'row',
                gap: space.sm,
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: colors.dangerSoft,
              }}
            >
              <Ionicons name="warning" size={16} color={colors.danger} style={{ marginTop: 1 }} />
              <Text variant="small" style={{ flex: 1 }}>
                {guide.urgent}
              </Text>
            </View>
          ) : null}

          <Text variant="caption" tone="muted">
            General information for adults, not advice for you personally. Labs may use slightly
            different ranges — your doctor knows your full picture.
          </Text>
        </View>
      </Surface>
    </View>
  );
}
