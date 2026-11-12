import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { View } from 'react-native';
import { Label, Row, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { TOUR, type TourSlide } from '~/features/tour/logic/featureTour';
import { Reveal } from './ScrollReveal';

/**
 * Every feature, all on the page: the everyday ones first, then the add-ons
 * someone can switch on. Each is a card with what it does and a small example
 * of it in use, and each rises into view as the page scrolls (see Reveal).
 */
export function FeatureList({ newFirst = false }: { newFirst?: boolean }) {
  const { space } = useTheme();
  // Someone who already uses Dayly sees what is NEW first, in its own group.
  const rest = newFirst ? TOUR.filter((s) => !s.isNew) : TOUR;
  const groups = [
    ...(newFirst ? [{ label: 'NEW', slides: TOUR.filter((s) => s.isNew) }] : []),
    { label: 'EVERY DAY', slides: rest.filter((s) => !s.addOn) },
    { label: 'ADD-ONS YOU CAN SWITCH ON', slides: rest.filter((s) => s.addOn) },
  ].filter((g) => g.slides.length > 0);

  return (
    <View style={{ gap: space.xl }}>
      {groups.map((group) => (
        <View key={group.label} style={{ gap: space.sm }}>
          <Reveal>
            <Label>{group.label}</Label>
          </Reveal>
          {group.slides.map((slide, index) => (
            // Every other card lags a touch, so a pair entering together cascades.
            <Reveal key={slide.key} lag={(index % 2) * 28}>
              <FeatureCard slide={slide} />
            </Reveal>
          ))}
        </View>
      ))}
    </View>
  );
}

function FeatureCard({ slide }: { slide: TourSlide }) {
  const { colors, radius, space, shadow } = useTheme();
  const tile = 46;
  const icon = slide.icon as keyof typeof Ionicons.glyphMap;

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          gap: space.md,
          padding: space.lg,
          borderRadius: radius.lg,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: slide.ai ? colors.gradientStart : colors.hairline,
        },
        shadow.card,
      ]}
      accessible
      accessibilityLabel={`${slide.title}. ${slide.line} For example: ${slide.example}`}
    >
      {slide.ai ? (
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: tile, height: tile, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={icon} size={22} color="#FFFFFF" />
        </LinearGradient>
      ) : (
        <View
          style={{
            width: tile,
            height: tile,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: `${slide.color}22`,
          }}
        >
          <Ionicons name={icon} size={22} color={slide.color} />
        </View>
      )}

      <View style={{ flex: 1, gap: 6 }}>
        <Row gap={6} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Text variant="bodyStrong">{slide.title}</Text>
          {slide.isNew ? <Tag text="NEW" fg={colors.inkInverse} bg={colors.accent} /> : null}
          {slide.ai ? <Tag text="AI" icon="sparkles" fg={colors.accentInk} bg={colors.accentSoft} /> : null}
        </Row>
        <Text variant="small" tone="secondary">
          {slide.line}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            maxWidth: '100%',
            paddingHorizontal: space.sm,
            paddingVertical: 6,
            borderRadius: radius.sm,
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <Ionicons name="eye-outline" size={13} color={colors.inkSecondary} />
          <Text
            variant="caption"
            style={{ fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1 }}
          >
            {slide.example}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Tag({
  text,
  icon,
  fg,
  bg,
}: {
  text: string;
  icon?: keyof typeof Ionicons.glyphMap;
  fg: string;
  bg: string;
}) {
  const { radius } = useTheme();
  return (
    <Row gap={3} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: bg }}>
      {icon ? <Ionicons name={icon} size={10} color={fg} /> : null}
      <Text variant="label" color={fg}>
        {text}
      </Text>
    </Row>
  );
}
