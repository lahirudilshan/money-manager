import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Alert, Pressable, Switch, View } from 'react-native';
import {
  BottomSheet,
  Divider,
  Glyph,
  GradientCard,
  Label,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { freeAllowance } from '~/features/health/services/aiQuotaStore';
import { questionsAskedToday } from '~/features/health/services/askHealth';
import { hasAreaConsent, setAreaConsent } from '~/features/ask/services/askConsent';
import { AREA_LABEL, AREA_SENDS } from '~/features/ask/logic/askScope';
import { OwnGoogleAiCard } from '~/features/health/components/OwnGoogleAiCard';
import { canSetUpUserGemini } from '~/features/health/services/userGemini';
import type { ModelQuota } from '~/features/health/logic/aiQuota';
import {
  aiConsentDate,
  aiUsageToday,
  isAiEnabled,
  setAiEnabled,
  withdrawAiConsent,
} from '~/features/health/services/aiSettings';

/**
 * Everything about AI in one place: the on/off switch, how much is used
 * today, where AI is used, and what is sent.
 */
export default function AiSettingsSheet() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const [enabled, setEnabled] = useState(isAiEnabled());
  const [consent, setConsent] = useState(aiConsentDate());
  // Bumped when the own-account card changes who pays, so the numbers re-read.
  const [, setOwnerVersion] = useState(0);
  const usage = aiUsageToday();
  const asked = questionsAskedToday();
  const [areas, setAreas] = useState({
    health: hasAreaConsent('health'),
    money: hasAreaConsent('money'),
    life: hasAreaConsent('life'),
  });
  const allowance = freeAllowance(usage.unlimited ? 'own' : 'shared');
  /*
   * What can really still be read today: Google's free allowance left, and on
   * Dayly's shared allowance also this phone's own daily cap — whichever runs
   * out first.
   */
  const reportsLeft = usage.unlimited
    ? allowance.reportsLeft
    : Math.min(usage.left, allowance.reportsLeft);
  const resetTime = allowance.resetsAt.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  function toggle(on: boolean) {
    setAiEnabled(on);
    setEnabled(on);
  }

  function withdraw() {
    Alert.alert(
      'Remove your AI agreement?',
      'Dayly will ask you again before it sends any report to AI. Reports already read stay saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            withdrawAiConsent();
            setConsent(null);
            setAreas((prev) => ({ ...prev, health: false }));
          },
        },
      ],
    );
  }

  const ai: readonly [string, string] = [colors.gradientStart, colors.gradientEnd];
  // Off is the same card gone quiet: slate, so the state reads before any word.
  const heroGradient: readonly [string, string] = enabled ? ai : ['#475569', '#334155'];
  const longDate = (d: Date) =>
    d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <BottomSheet
      visible
      asRoute
      onClose={() => router.back()}
      title="AI features"
      eyebrow="Settings"
      icon={<Glyph icon="sparkles" color={colors.gradientStart} size={40} gradient={ai} />}
      scroll
    >
      <View style={{ gap: space.lg }}>
        {/* The hero: the switch and today's allowance, on the AI gradient. */}
        <GradientCard gradient={heroGradient}>
          <View style={{ gap: space.lg }}>
            <Row gap={space.md} style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255,255,255,0.22)',
                }}
              >
                <Ionicons name={enabled ? 'sparkles' : 'sparkles-outline'} size={24} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="heading" color="#FFFFFF">
                  Dayly AI
                </Text>
                <Text variant="small" color="rgba(255,255,255,0.85)">
                  {enabled ? 'On · reads reports when you ask' : 'Off · nothing is sent to AI'}
                </Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={toggle}
                accessibilityLabel="Use AI"
                trackColor={{ false: 'rgba(255,255,255,0.25)', true: 'rgba(255,255,255,0.4)' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="rgba(255,255,255,0.25)"
              />
            </Row>

            <View style={{ gap: space.sm }}>
              <Row style={{ alignItems: 'flex-end', gap: space.sm }}>
                <Text variant="hero" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'] }}>
                  {String(reportsLeft)}
                </Text>
                <View style={{ flex: 1, paddingBottom: 7 }}>
                  <Text variant="bodyStrong" color="#FFFFFF">
                    {reportsLeft === 1 ? 'free report read left today' : 'free report reads left today'}
                  </Text>
                </View>
              </Row>
              <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                <HeroChip icon="logo-google" text={usage.unlimited ? 'Your own Gemini' : 'Shared Gemini'} />
                <HeroChip icon="time-outline" text={`Resets ${resetTime}`} />
                <HeroChip icon="pricetag-outline" text="Free, never billed" />
              </Row>
            </View>
          </View>
        </GradientCard>

        {/* Google's free allowance, per model */}
        <View style={{ gap: space.sm }}>
          <Label>GOOGLE FREE ALLOWANCE TODAY</Label>
          <Surface>
            <View style={{ gap: space.md }}>
              {allowance.models.map((m) => (
                <ModelMeter key={m.model} quota={m} />
              ))}
              {!usage.unlimited ? (
                <PhoneCapMeter used={usage.used} limit={usage.limit} />
              ) : null}
              <Divider />
              <Text variant="caption" tone="secondary">
                {`Each report uses 2 AI requests and each question 1. Google gives each model its own free amount every day, and resets it at midnight in California — ${resetTime} your time. Counted on this phone; when a model runs out, Google tells us its real limit and it shows here.`}
              </Text>
              {!usage.unlimited ? (
                <Text variant="caption" tone="secondary">
                  Dayly’s free Gemini is shared by everyone using the app, so less may be left than
                  shown. Get your own below for an allowance that is only yours.
                </Text>
              ) : null}
            </View>
          </Surface>
        </View>

        {/* The user's own free Gemini */}
        {canSetUpUserGemini() ? (
          <View style={{ gap: space.sm }}>
            <Label>YOUR OWN FREE GEMINI</Label>
            <OwnGoogleAiCard embedded onChange={() => setOwnerVersion((v) => v + 1)} />
          </View>
        ) : null}

        {/* Where */}
        <View style={{ gap: space.sm }}>
          <Label>WHERE AI IS USED</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            <Point
              tile={<Glyph icon="flask" color={colors.gradientStart} gradient={ai} />}
              title="Reading lab reports"
              body="In Health records, AI reads your report and explains each result in simple words. Only when you tap Analyse."
              badge={enabled ? 'ON' : 'OFF'}
              badgeColor={enabled ? colors.gradientStart : colors.inkSecondary}
            />
            <Divider />
            <Point
              tile={<Glyph icon="receipt" color={colors.gradientStart} gradient={ai} />}
              title="Filling in forms from a photo"
              body="In Fuel & vehicles, snap a garage bill or the fuel pump and AI fills in the parts, prices, litres and odometer. It can also match the maintenance schedule to your exact model. You check everything before it is saved, and it all works by hand too."
              badge={enabled ? 'ON' : 'OFF'}
              badgeColor={enabled ? colors.gradientStart : colors.inkSecondary}
            />
            <Divider />
            <Point
              tile={<Glyph icon="chatbubble-ellipses" color={colors.gradientStart} gradient={ai} />}
              title="Ask AI"
              body={`The sparkle button on the dashboard and each section. AI answers from the parts of the app you allow below, and searches Google when needed. ${asked} asked today.`}
              badge={enabled ? 'ON' : 'OFF'}
              badgeColor={enabled ? colors.gradientStart : colors.inkSecondary}
            />
            <Divider />
            <Point
              tile={<Glyph icon="wallet-outline" color={colors.completed} />}
              title="Money works without AI"
              body="Bills, SMS and balances are worked out on your phone. Money is only sent to AI if you allow it below — and then only totals."
            />
          </Surface>
        </View>

        {/* What Ask AI may see — one switch per part of the app. */}
        <View style={{ gap: space.sm }}>
          <Label>WHAT ASK AI CAN SEE</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {(['health', 'money', 'life'] as const).map((area, index) => (
              <View key={area}>
                {index > 0 ? <Divider /> : null}
                <Row gap={space.md} style={{ padding: space.lg, alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong">{AREA_LABEL[area]}</Text>
                    <Text variant="caption" tone="secondary">
                      {AREA_SENDS[area]}
                    </Text>
                  </View>
                  <Switch
                    value={areas[area]}
                    onValueChange={(on) => {
                      setAreaConsent(area, on);
                      setAreas((prev) => ({ ...prev, [area]: on }));
                      setConsent(aiConsentDate());
                    }}
                    disabled={!enabled}
                    trackColor={{ true: colors.accent, false: colors.surfaceSunken }}
                    accessibilityLabel={`Let Ask AI see ${AREA_LABEL[area]}`}
                  />
                </Row>
              </View>
            ))}
          </Surface>
        </View>

        {/* What is sent */}
        <View style={{ gap: space.sm }}>
          <Label>WHAT IS SENT</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            <Point
              tile={<Glyph icon="arrow-up" color={colors.accent} />}
              title="Sent to Google Gemini"
              body="The report photos or PDFs you choose, and the person's name, age and known health conditions. A garage bill or fill-up photo you attach, or your vehicle's make, model and year, with its maintenance list. With a question: only the parts you allowed above."
            />
            <Divider />
            <Point
              tile={<Glyph icon="lock-closed" color={colors.completed} />}
              title="Stays on your phone"
              body="Account and card numbers, SMS text, notes, names in personal loans, and any part you did not allow."
            />
            <Divider />
            <Point
              tile={<Glyph icon="alert-circle" color={colors.pending} />}
              title="AI can make mistakes"
              body="Always check results with a doctor."
            />
          </Surface>
        </View>

        {/* Agreement */}
        <View style={{ gap: space.sm }}>
          <Label>YOUR AGREEMENT</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            <Point
              tile={
                <Glyph
                  icon={consent ? 'checkmark-circle' : 'ellipse-outline'}
                  color={consent ? colors.completed : colors.inkSecondary}
                />
              }
              title={consent ? 'You agreed to send reports to AI' : 'Not agreed yet'}
              body={
                consent
                  ? `On ${longDate(consent)}`
                  : 'Dayly asks the first time you analyse a report.'
              }
            />
            <Divider />
            <LinkRow label="Read terms & privacy" onPress={() => router.push('/settings/terms')} />
            {consent ? (
              <>
                <Divider />
                <LinkRow label="Remove agreement" danger onPress={withdraw} />
              </>
            ) : null}
          </Surface>
        </View>
      </View>
    </BottomSheet>
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

/** One model's free daily amount: used, left, and whether the limit is Google's own figure. */
function ModelMeter({ quota }: { quota: ModelQuota }) {
  const { colors, radius, space } = useTheme();
  const fraction = quota.limit > 0 ? quota.left / quota.limit : 0;
  const tint = quota.left === 0 ? colors.danger : fraction <= 0.2 ? colors.pending : colors.gradientStart;
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ alignItems: 'center', gap: space.sm }}>
        <Text variant="small" style={{ fontWeight: '700', flex: 1 }}>
          {quota.label}
        </Text>
        <Text variant="small" color={tint} style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {quota.left === 0 ? 'Used up' : `${quota.left} of ${quota.limit} left`}
        </Text>
      </Row>
      <View
        style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: quota.limit, now: quota.left }}
      >
        {quota.left > 0 ? (
          <LinearGradient
            colors={quota.left === 0 || fraction <= 0.2 ? [tint, tint] : [colors.gradientStart, colors.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: 8, width: `${Math.round(fraction * 100)}%`, borderRadius: radius.pill }}
          />
        ) : null}
      </View>
      <Text variant="caption" tone="secondary">
        {`${quota.used} used today${quota.fromGoogle ? ' · limit from Google' : ''}`}
      </Text>
    </View>
  );
}

/** Dayly's own cap on the shared allowance: reads per phone per day. */
function PhoneCapMeter({ used, limit }: { used: number; limit: number }) {
  const { colors, radius, space } = useTheme();
  const left = Math.max(0, limit - used);
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ alignItems: 'center', gap: space.sm }}>
        <Text variant="small" style={{ fontWeight: '700', flex: 1 }}>
          This phone’s daily cap
        </Text>
        <Text variant="small" color={left === 0 ? colors.danger : colors.accent} style={{ fontWeight: '700' }}>
          {`${left} of ${limit} reports left`}
        </Text>
      </Row>
      <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}>
        <View
          style={{
            height: 8,
            width: `${Math.round((left / limit) * 100)}%`,
            borderRadius: radius.pill,
            backgroundColor: left === 0 ? colors.danger : colors.accent,
          }}
        />
      </View>
    </View>
  );
}

function LinkRow({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const { colors, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Text
        variant="bodyStrong"
        color={danger ? colors.danger : colors.accent}
        style={{ flex: 1 }}
      >
        {label}
      </Text>
      {danger ? null : <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />}
    </Pressable>
  );
}

function Point({
  tile,
  title,
  body,
  badge,
  badgeColor,
}: {
  tile: React.ReactNode;
  title: string;
  body: string;
  badge?: string;
  badgeColor?: string;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
      {tile}
      <View style={{ flex: 1, gap: 2 }}>
        <Row style={{ gap: space.sm, alignItems: 'center' }}>
          <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
            {title}
          </Text>
          {badge ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: radius.pill,
                backgroundColor: colors.surfaceSunken,
              }}
            >
              <Text variant="label" color={badgeColor}>
                {badge}
              </Text>
            </View>
          ) : null}
        </Row>
        <Text variant="small" tone="secondary">
          {body}
        </Text>
      </View>
    </View>
  );
}
