import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Divider, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { TERMS, type TermsSection } from '~/features/terms/logic/terms';

/**
 * The terms as one card of short rows: an icon, a title, one sentence.
 * The detail sits behind "More" on each row, so the page reads in seconds
 * and nothing is hidden from someone who wants it.
 */
export function TermsContent() {
  return (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      {TERMS.map((section, index) => (
        <View key={section.key}>
          {index > 0 ? <Divider /> : null}
          <TermRow section={section} />
        </View>
      ))}
    </Surface>
  );
}

function TermRow({ section }: { section: TermsSection }) {
  const { colors, radius, space } = useTheme();
  const [open, setOpen] = useState(false);
  const ai = section.key === 'ai';
  const icon = section.icon as keyof typeof Ionicons.glyphMap;
  const tile = 42;
  // One colour family per point, so the list scans as five different things.
  const tone = {
    data: { fg: colors.accent, bg: colors.accentSoft },
    advice: { fg: colors.pending, bg: colors.pendingSoft },
    care: { fg: colors.completed, bg: colors.completedSoft },
    use: { fg: colors.inkSecondary, bg: colors.surfaceSunken },
  }[section.key] ?? { fg: colors.accent, bg: colors.accentSoft };

  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: space.md,
        padding: space.lg,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      {ai ? (
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: tile, height: tile, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={icon} size={20} color="#FFFFFF" />
        </LinearGradient>
      ) : (
        <View
          style={{
            width: tile,
            height: tile,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tone.bg,
          }}
        >
          <Ionicons name={icon} size={20} color={tone.fg} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{section.title}</Text>
        <Text variant="small" tone="secondary">
          {section.summary}
        </Text>
        {open ? (
          <View style={{ gap: 6, marginTop: 4 }}>
            {section.points.map((point, index) => (
              <Row key={index} gap={space.sm} style={{ alignItems: 'flex-start' }}>
                <Ionicons
                  name="checkmark"
                  size={14}
                  color={ai ? colors.gradientStart : tone.fg}
                  style={{ marginTop: 2 }}
                />
                <Text variant="small" style={{ flex: 1 }}>
                  {point}
                </Text>
              </Row>
            ))}
          </View>
        ) : null}
      </View>
      <Ionicons
        name={open ? 'chevron-up' : 'chevron-down'}
        size={16}
        color={colors.inkMuted}
        style={{ marginTop: 2 }}
      />
    </Pressable>
  );
}
