import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';
import { Button, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { SETUP_STEPS, type SetupStep } from '../logic/userGemini';
import {
  canSetUpUserGemini,
  forgetUserGemini,
  setUpUserGemini,
  userGeminiKey,
} from '../services/userGemini';
import { healthLabRepo } from '~/db/repositories';
import { analysesToday, DAILY_ANALYSIS_LIMIT } from '../logic/gemini';
import { useActiveAnalyseRun } from '../services/analyseRun';

/**
 * "Use my Google account" for AI reading: set up once, then every report uses
 * the user's own free Gemini allowance instead of the one Dayly shares among
 * everyone. See logic/userGemini.ts.
 *
 * Three states in one card — offer, setting up (a step list, because it takes
 * 20–40 seconds and a bare spinner reads as stuck), and in use.
 */
export function OwnGoogleAiCard({ onChange }: { onChange?: (inUse: boolean) => void }) {
  const { colors, radius, space } = useTheme();
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'off' } | { kind: 'on'; account: string | null }
  >({ kind: 'loading' });
  const [step, setStep] = useState<SetupStep | null>(null);
  const [error, setError] = useState<{ message: string; url?: string } | null>(null);
  // Re-counted when a reading ends, so the number is never a run behind.
  const run = useActiveAnalyseRun();
  const runEnded = run === null || run.outcome !== null;
  const [usedToday, setUsedToday] = useState(0);
  useEffect(() => {
    if (runEnded) setUsedToday(analysesToday(healthLabRepo.analysedAtAll(), new Date()));
  }, [runEnded]);
  const leftToday = Math.max(0, DAILY_ANALYSIS_LIMIT - usedToday);

  useEffect(() => {
    void userGeminiKey().then((user) =>
      setState(user ? { kind: 'on', account: user.account } : { kind: 'off' }),
    );
  }, []);

  if (!canSetUpUserGemini() || state.kind === 'loading') return null;

  async function setUp() {
    setError(null);
    setStep('signing-in');
    const result = await setUpUserGemini(setStep);
    setStep(null);
    if (result.ok) {
      setState({ kind: 'on', account: result.account });
      onChange?.(true);
    } else if (!('cancelled' in result && result.cancelled)) {
      setError({ message: result.error, url: result.url });
    }
  }

  function stop() {
    Alert.alert(
      'Stop using your Google account?',
      'Reports will use Dayly’s shared AI allowance again. The “Dayly AI” project stays in your Google account and costs nothing; you can delete it there.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop using it',
          style: 'destructive',
          onPress: async () => {
            await forgetUserGemini();
            setState({ kind: 'off' });
            onChange?.(false);
          },
        },
      ],
    );
  }

  if (state.kind === 'on') {
    return (
      <View style={{ gap: space.sm }}>
        <Label>AI ALLOWANCE</Label>
        <Surface>
          <Row style={{ gap: space.md, alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={26} color={colors.completed} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">Using your Google account</Text>
              <Text variant="caption" tone="secondary">
                {state.account ? `${state.account} · ` : ''}your own free daily allowance
              </Text>
              <Text variant="caption" tone="secondary">
                {usedToday === 0
                  ? 'Nothing read with AI today'
                  : `${usedToday} ${usedToday === 1 ? 'reading' : 'readings'} today`}
              </Text>
            </View>
            <Button label="Stop" variant="ghost" size="sm" onPress={stop} />
          </Row>
        </Surface>
      </View>
    );
  }

  const current = step ? SETUP_STEPS.findIndex((s) => s.key === step) : -1;

  return (
    <View style={{ gap: space.sm }}>
      <Label>AI ALLOWANCE</Label>
      <Surface>
        <View style={{ gap: space.md }}>
          <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                backgroundColor: colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="logo-google" size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">Use your own Google AI allowance</Text>
              <Text variant="small" tone="secondary">
                Sign in once and Dayly sets up Gemini in your Google account. Your reports then use
                your own free daily allowance, not the one shared by everyone using Dayly.
              </Text>
            </View>
          </Row>

          <AllowanceMeter left={leftToday} />

          {step ? (
            <View style={{ gap: space.sm }}>
              {SETUP_STEPS.map((s, index) => {
                const done = index < current;
                const active = index === current;
                return (
                  <Row key={s.key} style={{ gap: space.sm, alignItems: 'center' }}>
                    {active ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Ionicons
                        name={done ? 'checkmark-circle' : 'ellipse-outline'}
                        size={18}
                        color={done ? colors.completed : colors.inkMuted}
                      />
                    )}
                    <Text variant="small" tone={active || done ? undefined : 'secondary'}>
                      {s.label}
                    </Text>
                  </Row>
                );
              })}
            </View>
          ) : (
            <Button label="Set up with Google" variant="secondary" icon="logo-google" onPress={setUp} />
          )}

          {error ? (
            <View style={{ gap: space.sm }}>
              <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
                <Ionicons
                  name="alert-circle"
                  size={16}
                  color={colors.danger}
                  style={{ marginTop: 2 }}
                />
                <Text variant="small" style={{ flex: 1 }}>
                  {error.message}
                </Text>
              </Row>
              {error.url ? (
                <Button
                  label="Open Google Cloud"
                  variant="ghost"
                  size="sm"
                  icon="open-outline"
                  onPress={() => void Linking.openURL(error.url!)}
                />
              ) : null}
            </View>
          ) : null}

          <Text variant="caption" tone="secondary">
            Dayly asks Google for permission to make one project called “Dayly AI” and a key that
            only this app can use. The permission is used once and not kept.
          </Text>
        </View>
      </Surface>
    </View>
  );
}

/**
 * Dayly's shared allowance, as readings left today on this phone. Google does
 * not report what is left of a free quota, so this is the app's own daily cap
 * (DAILY_ANALYSIS_LIMIT) — the one that actually stops a reading here.
 */
function AllowanceMeter({ left }: { left: number }) {
  const { colors, radius, space } = useTheme();
  const fraction = left / DAILY_ANALYSIS_LIMIT;
  const tint = left === 0 ? colors.danger : left <= 2 ? colors.pending : colors.accent;
  return (
    <View style={{ gap: space.xs }}>
      <Row style={{ alignItems: 'baseline', gap: space.sm }}>
        <Text variant="small" style={{ flex: 1 }}>
          {left === 0 ? 'No AI readings left today' : 'AI readings left today'}
        </Text>
        <Text variant="bodyStrong" color={tint} style={{ fontVariant: ['tabular-nums'] }}>
          {`${left} of ${DAILY_ANALYSIS_LIMIT}`}
        </Text>
      </Row>
      <View
        style={{
          height: 6,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceSunken,
          overflow: 'hidden',
        }}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: DAILY_ANALYSIS_LIMIT, now: left }}
      >
        <View
          style={{
            height: '100%',
            width: `${Math.round(fraction * 100)}%`,
            borderRadius: radius.pill,
            backgroundColor: tint,
          }}
        />
      </View>
      <Text variant="caption" tone="secondary">
        {left === 0
          ? 'Starts again tomorrow — or use your own Google allowance below.'
          : 'Shared by everyone using Dayly. Your own Google allowance has no limit here.'}
      </Text>
    </View>
  );
}
