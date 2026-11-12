import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { GradientButton, Label, Row, Text } from '~/shared/components/ui';
import { setAiEnabled } from '~/features/health/services/aiSettings';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { TermsContent } from '~/features/terms/components/TermsContent';
import { acceptTerms } from '~/features/terms/components/termsStore';
import { FeatureList } from '~/features/tour/components/FeatureList';
import { Reveal, RevealProvider } from '~/features/tour/components/ScrollReveal';
import { TOUR } from '~/features/tour/logic/featureTour';

/** Height of the gradient hero, before the safe-area inset. */
const HERO = 300;
/** Room the pinned footer takes at the bottom of the window. */
const FOOTER = 96;

/**
 * The first screen anyone sees — one page that reads top to bottom:
 *
 *   1. what Dayly is (the hero),
 *   2. everything it does, each feature with a small example,
 *   3. five plain things to know (the terms),
 *   4. one question: turn AI on or not — then "I agree".
 *
 * Everything is on the page; nothing hides in a carousel. Each block rises
 * into view as it scrolls in (see ScrollReveal), the hero drifts away with a
 * little parallax, and a compact title bar fades in once it is gone.
 *
 * `then=app` is the path for someone who already set the app up before terms
 * existed (or before they changed): agreeing returns them to their board.
 */
export default function TermsScreen() {
  const { colors, radius, space, shadow } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{ then?: string }>();
  const existingUser = params.then === 'app';
  // Asked, never assumed: AI stays off unless the person picks it.
  const [ai, setAi] = useState<'on' | 'off' | null>(null);
  const [still, setStill] = useState(false);
  const scrollY = useSharedValue(0);
  const newCount = TOUR.filter((t) => t.isNew).length;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
  }, []);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const heroTop = insets.top + HERO;
  const heroStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, HERO * 0.8], [1, 0.2], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [-100, 0, HERO], [-30, 0, HERO * 0.35], Extrapolation.CLAMP) },
      { scale: interpolate(scrollY.value, [-120, 0], [1.08, 1], Extrapolation.CLAMP) },
    ],
  }));
  // Gentle loops: the icon floats, the light drifts, the arrow nudges down.
  const loop = useSharedValue(0);
  const nudge = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    loop.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
    // One continuous sine glide down and back up — no jumps, no pauses.
    nudge.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [still, loop, nudge]);
  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(loop.value, [0, 1], [0, -6]) }],
  }));
  const driftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(loop.value, [0, 1], [0, -14]) },
      { translateY: interpolate(loop.value, [0, 1], [0, 10]) },
    ],
  }));
  const bounceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(nudge.value, [0, 1], [-3, 4]) }],
    opacity: interpolate(nudge.value, [0, 1], [1, 0.75]),
  }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 90], [1, 0], Extrapolation.CLAMP),
  }));
  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [HERO - 120, HERO - 40], [0, 1], Extrapolation.CLAMP),
  }));

  function agree() {
    if (!ai) return;
    setAiEnabled(ai === 'on');
    acceptTerms();
    router.replace(existingUser ? '/(tabs)' : '/onboarding/welcome');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <RevealProvider scrollY={scrollY} viewportBottom={height - FOOTER - insets.bottom} still={still}>
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: FOOTER + insets.bottom + space.xl }}
        >
          {/* 1. The hero */}
          <Animated.View style={heroStyle}>
            <LinearGradient
              colors={[colors.gradientStart, colors.gradientStart, colors.gradientEnd]}
              locations={[0, 0.25, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                minHeight: heroTop,
                paddingTop: insets.top + space.xxl,
                paddingHorizontal: space.xl,
                paddingBottom: space.xxl,
                borderBottomLeftRadius: radius.xl,
                borderBottomRightRadius: radius.xl,
                gap: space.lg,
                justifyContent: 'flex-end',
                overflow: 'hidden',
              }}
            >
              {/* Soft light shapes, so the gradient has depth rather than a flat wash. */}
              <View pointerEvents="none" style={[StyleSheet.absoluteFill]}>
                <Animated.View
                  style={[
                    {
                      position: 'absolute',
                      top: -90,
                      right: -70,
                      width: 260,
                      height: 260,
                      borderRadius: 130,
                      backgroundColor: 'rgba(255,255,255,0.12)',
                    },
                    driftStyle,
                  ]}
                />
                <View
                  style={{
                    position: 'absolute',
                    top: 60,
                    right: 40,
                    width: 90,
                    height: 90,
                    borderRadius: 45,
                    backgroundColor: 'rgba(255,255,255,0.08)',
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    bottom: -120,
                    left: -80,
                    width: 280,
                    height: 280,
                    borderRadius: 140,
                    backgroundColor: 'rgba(255,255,255,0.07)',
                  }}
                />
              </View>
              {/* The app icon on a white plate with a soft halo, floating gently,
                  so it stands off the gradient instead of melting into it. */}
              <Animated.View style={floatStyle}>
                <View
                  style={{
                    width: 92,
                    height: 92,
                    borderRadius: 30,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.18)',
                  }}
                >
                  <View
                    style={[
                      {
                        width: 76,
                        height: 76,
                        borderRadius: 24,
                        padding: 4,
                        backgroundColor: '#FFFFFF',
                      },
                      shadow.lifted,
                    ]}
                  >
                    <Image
                      source={require('../../assets/icon.png')}
                      style={{ width: 68, height: 68, borderRadius: 20 }}
                    />
                  </View>
                </View>
              </Animated.View>
              <View style={{ gap: space.xs }}>
                <Text variant="hero" color="#FFFFFF">
                  {existingUser ? 'What’s new' : 'Welcome to Dayly'}
                </Text>
                <Text variant="body" color="rgba(255,255,255,0.92)">
                  {existingUser
                    ? `${newCount} new ${newCount === 1 ? 'feature' : 'features'}, and Dayly can now use AI — only if you want it.`
                    : 'Your money and health in one calm app. Kept private on your phone.'}
                </Text>
              </View>
              <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                <HeroChip icon="phone-portrait-outline" text="On your phone" />
                <HeroChip icon="sparkles-outline" text="AI if you want" />
                <HeroChip icon="pricetag-outline" text="Free" />
              </Row>
              <Animated.View style={[{ alignSelf: 'flex-start' }, hintStyle]}>
                <Row
                  gap={space.sm}
                  style={{
                    paddingLeft: space.md,
                    paddingRight: 6,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    backgroundColor: 'rgba(255,255,255,0.18)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.28)',
                  }}
                >
                  <Text variant="caption" color="#FFFFFF" style={{ fontWeight: '700' }}>
                    Scroll to see everything
                  </Text>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#FFFFFF',
                      overflow: 'hidden',
                    }}
                  >
                    <Animated.View style={bounceStyle}>
                      <Ionicons name="arrow-down" size={15} color={colors.gradientStart} />
                    </Animated.View>
                  </View>
                </Row>
              </Animated.View>
            </LinearGradient>
          </Animated.View>

          <View style={{ padding: space.lg, gap: space.xxl }}>
            {/* 2. Everything Dayly does */}
            <FeatureList newFirst={existingUser} />

            {/* 3. The terms */}
            <View style={{ gap: space.sm }}>
              <Reveal>
                <Label>FIVE THINGS TO KNOW</Label>
              </Reveal>
              <Reveal>
                <TermsContent />
              </Reveal>
            </View>

            {/* 4. The one question */}
            <View style={{ gap: space.sm }}>
              <Reveal>
                <Label>TURN ON AI?</Label>
              </Reveal>
              <Reveal>
                <Row gap={space.sm} style={{ alignItems: 'stretch' }}>
                  <AiChoice
                    selected={ai === 'on'}
                    onPress={() => setAi('on')}
                    icon="sparkles"
                    title="Yes, use AI"
                    body="Explain my lab reports in simple words"
                    brand
                  />
                  <AiChoice
                    selected={ai === 'off'}
                    onPress={() => setAi('off')}
                    icon="eye-off-outline"
                    title="Keep AI off"
                    body="Nothing is sent. The rest works the same"
                  />
                </Row>
              </Reveal>
              <Reveal>
                <Row gap={space.sm} style={{ alignItems: 'flex-start', paddingHorizontal: space.xs, marginTop: space.xs }}>
                  <Ionicons name="settings-outline" size={15} color={colors.inkSecondary} style={{ marginTop: 1 }} />
                  <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                    You can read this again, and turn AI on or off, any time in Settings.
                  </Text>
                </Row>
              </Reveal>
            </View>
          </View>
        </Animated.ScrollView>
      </RevealProvider>

      {/* A compact title once the hero has scrolled away. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            paddingTop: insets.top + space.sm,
            paddingBottom: space.sm,
            alignItems: 'center',
            backgroundColor: colors.canvas,
            borderBottomWidth: 1,
            borderBottomColor: colors.hairline,
          },
          barStyle,
        ]}
      >
        <Text variant="heading">{existingUser ? 'What’s new' : 'Welcome to Dayly'}</Text>
      </Animated.View>

      {/* The answer, always in reach. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.sm,
          backgroundColor: colors.canvas,
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
        }}
      >
        <GradientButton
          label={ai ? 'I agree' : 'Choose if AI is on to continue'}
          icon="checkmark"
          disabled={!ai}
          onPress={agree}
        />
      </View>
    </View>
  );
}

function HeroChip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { radius, space } = useTheme();
  return (
    <Row
      gap={5}
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 5,
        borderRadius: radius.pill,
        backgroundColor: 'rgba(255,255,255,0.2)',
      }}
    >
      <Ionicons name={icon} size={13} color="#FFFFFF" />
      <Text variant="caption" color="#FFFFFF" style={{ fontWeight: '700' }}>
        {text}
      </Text>
    </Row>
  );
}

/** One side of the AI question: a tile with a radio mark, picked by tapping anywhere on it. */
function AiChoice({
  selected,
  onPress,
  icon,
  title,
  body,
  brand = false,
}: {
  selected: boolean;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  brand?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  const tile = 44;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flex: 1,
        gap: space.sm,
        padding: space.lg,
        borderRadius: radius.lg,
        backgroundColor: selected ? colors.accentSoft : colors.surface,
        borderWidth: 2,
        borderColor: selected ? colors.accent : colors.hairline,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Row style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        {brand ? (
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
              backgroundColor: colors.surfaceSunken,
            }}
          >
            <Ionicons name={icon} size={22} color={colors.inkSecondary} />
          </View>
        )}
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={selected ? colors.accent : colors.inkMuted}
        />
      </Row>
      <Text variant="bodyStrong">{title}</Text>
      <Text variant="small" tone="secondary">
        {body}
      </Text>
    </Pressable>
  );
}
