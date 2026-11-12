import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader, GradientButton, Row, Surface, Text, useKeyboardHeight } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { useAppSelector } from '~/store/useAppStore';
import { usePersonHealth } from '~/features/health/components/usePersonHealth';
import { AiDisclaimer } from '~/features/health/components/LabUi';
import { starterQuestions, type AnswerSource } from '~/features/health/logic/askHealth';
import { plainName } from '~/features/health/logic/plainTests';
import { askAllowance } from '~/features/health/services/askHealth';
import { userGeminiKey } from '~/features/health/services/userGemini';
import {
  AREA_LABEL,
  AREA_SENDS,
  SCOPE_AREAS,
  SCOPE_META,
  SCOPE_STARTERS,
  type AskArea,
  type AskScope,
} from '~/features/ask/logic/askScope';
import { askBlocked, askQuestion, missingAreas, type AskBlock } from '~/features/ask/services/askService';
import { hasAreaConsent, setAreaConsent } from '~/features/ask/services/askConsent';

/**
 * Ask AI — one chat screen for every part of the app.
 *
 * The scope says which records go with each question (Health records, money,
 * vehicles…, or everything the user allowed for the global one); see
 * features/ask/logic/askScope.ts. Answers come from those records and from
 * Google Search when the question is about the world.
 *
 * The chat lives only while the screen is open: questions are not stored, so
 * nothing new needs backing up and nothing lingers.
 */

interface Message {
  id: string;
  question: string;
  answer: string;
  sources: AnswerSource[];
  web: boolean;
  error?: string;
  pending: boolean;
}

export function AskScreen({
  scope,
  personId,
  initialQuestion,
}: {
  scope: AskScope;
  personId?: string;
  initialQuestion?: string;
}) {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const people = useAppSelector((s) => s.healthPeople);
  const person = people.find((p) => p.id === personId) ?? people[0];
  const health = usePersonHealth(scope === 'health' ? person?.id : undefined, people);
  const meta = SCOPE_META[scope];

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(initialQuestion ?? '');
  const [blocked, setBlocked] = useState<AskBlock>(askBlocked(scope));
  const [missing, setMissing] = useState<AskArea[]>(missingAreas(scope));
  const [allowance, setAllowance] = useState(askAllowance());
  const busy = messages.some((m) => m.pending);
  const scroll = useRef<ScrollView>(null);
  const keyboardHeight = useKeyboardHeight(true);

  /*
   * The user's own Gemini key lives in the keychain and is read lazily. Until
   * it has been read, "is AI available?" answers no on a build that relies on
   * it — so read it first, then decide.
   */
  useEffect(() => {
    void userGeminiKey().then(() => {
      setBlocked(askBlocked(scope));
      setAllowance(askAllowance());
    });
  }, [scope]);

  useEffect(() => {
    // Only once there is a chat to follow — on open, the intro stays in view.
    if (messages.length === 0) return;
    const id = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [messages]);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const id = `${Date.now()}`;
    const earlier = messages
      .filter((m) => !m.error && !m.pending)
      .map((m) => ({ question: m.question, answer: m.answer }));
    setDraft('');
    setMessages((list) => [
      ...list,
      { id, question, answer: '', sources: [], web: false, pending: true },
    ]);
    const update = (patch: Partial<Message>) =>
      setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

    const result = await askQuestion({
      scope,
      personId: person?.id,
      earlier,
      question,
      onPartial: (answer) => update({ answer }),
    });
    if (result.ok) {
      update({
        answer: result.answer.text,
        sources: result.answer.sources,
        web: result.answer.route.web,
        pending: false,
      });
    } else {
      update({ error: result.error, pending: false });
    }
    setAllowance(askAllowance());
    setBlocked(askBlocked(scope));
  }

  const refreshConsent = () => {
    setBlocked(askBlocked(scope));
    setMissing(missingAreas(scope));
  };

  const starters =
    scope === 'health'
      ? starterQuestions(
          health.series.map((x) => ({ testName: plainName(x.testKey, x.testName, x.latest.unit), latest: x.latest })),
        )
      : [...SCOPE_STARTERS[scope]];
  const using = SCOPE_AREAS[scope].filter((a) => !missing.includes(a));
  const first = person?.name.trim().split(' ')[0] ?? '';
  const whose = !person || /^(me|myself|i)$/i.test(first) ? 'your' : `${first}’s`;
  const resetTime = allowance.resetsAt.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingBottom: keyboardHeight }}>
      {/* A full-screen modal: closed with ✕, not a back chevron. */}
      <AppHeader
        title={meta.title}
        action={{ icon: 'close', onPress: () => router.back(), label: 'Close' }}
      />

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {/* What is left today — the same free allowance report reading uses. */}
        <Row
          gap={space.sm}
          style={{
            alignSelf: 'center',
            paddingHorizontal: space.md,
            paddingVertical: 6,
            borderRadius: radius.pill,
            backgroundColor: allowance.left > 0 ? colors.accentSoft : colors.dangerSoft,
          }}
        >
          <Ionicons
            name="sparkles"
            size={14}
            color={allowance.left > 0 ? colors.accentInk : colors.danger}
          />
          <Text
            variant="caption"
            color={allowance.left > 0 ? colors.accentInk : colors.danger}
            style={{ fontWeight: '700' }}
          >
            {allowance.left > 0
              ? `${allowance.left} ${allowance.left === 1 ? 'question' : 'questions'} left today · resets ${resetTime}`
              : `No questions left today · resets ${resetTime}`}
          </Text>
        </Row>

        {/* What the answers can see, so nobody wonders. */}
        {using.length > 0 ? (
          <Text variant="caption" tone="secondary" style={{ textAlign: 'center', marginTop: -space.sm }}>
            {`Uses: ${using.map((a) => AREA_LABEL[a]).join(' · ')}`}
          </Text>
        ) : null}

        {messages.length === 0 ? (
          <View style={{ gap: space.lg }}>
            <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.md }}>
              <LinearGradient
                colors={[colors.gradientStart, colors.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="sparkles" size={26} color="#FFFFFF" />
              </LinearGradient>
              <Text variant="title" style={{ textAlign: 'center' }}>
                {scope === 'health' ? `Ask about ${whose} health` : scope === 'global' ? 'Ask about anything' : meta.title}
              </Text>
              <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
                {`Ask in your own words. ${meta.intro}`}
              </Text>
            </View>

            {blocked === 'consent' || (scope === 'global' && missing.length > 0 && messages.length === 0) ? (
              <ConsentCard scope={scope} missing={missing} onChange={refreshConsent} />
            ) : null}
            {blocked === 'off' || blocked === 'unavailable' ? (
              <Surface>
                <Text variant="small" tone="secondary">
                  {blocked === 'off'
                    ? 'AI is turned off. Turn it on in Settings → AI features to ask questions.'
                    : 'AI is not available in this version of the app.'}
                </Text>
              </Surface>
            ) : blocked === 'consent' ? null : (
              <View style={{ gap: space.sm }}>
                <Text variant="label" tone="muted">
                  TRY ASKING
                </Text>
                {starters.map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => ask(q)}
                    disabled={blocked !== null}
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      padding: space.md,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: colors.hairline,
                      backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
                    })}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
                    <Text variant="body" style={{ flex: 1 }}>
                      {q}
                    </Text>
                    <Ionicons name="arrow-up-circle" size={20} color={colors.accent} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : (
          messages.map((m) => <Exchange key={m.id} message={m} />)
        )}

        {messages.length > 0 ? <AiDisclaimer compact /> : null}
      </ScrollView>

      {/* The question box, on top of the keyboard. */}
      <View
        style={{
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          paddingBottom: (keyboardHeight > 0 ? 0 : insets.bottom) + space.sm,
          backgroundColor: colors.canvas,
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
        }}
      >
        <Row
          gap={space.sm}
          style={{
            alignItems: 'flex-end',
            paddingLeft: space.lg,
            paddingRight: 6,
            paddingVertical: 6,
            borderRadius: radius.xl,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairlineStrong,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type your question…"
            placeholderTextColor={colors.inkFaint}
            multiline
            editable={blocked === null}
            accessibilityLabel="Your question"
            style={{
              flex: 1,
              maxHeight: 120,
              paddingVertical: 8,
              fontSize: 16,
              color: colors.ink,
            }}
          />
          <Pressable
            onPress={() => ask(draft)}
            disabled={!draft.trim() || busy || blocked !== null}
            accessibilityRole="button"
            accessibilityLabel="Send question"
            style={({ pressed }) => ({
              opacity: !draft.trim() || busy || blocked !== null ? 0.35 : pressed ? 0.8 : 1,
            })}
          >
            <LinearGradient
              colors={[colors.gradientStart, colors.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
              )}
            </LinearGradient>
          </Pressable>
        </Row>
      </View>
    </View>
  );
}

/** One question and its answer. */
function Exchange({ message }: { message: Message }) {
  const { colors, radius, space } = useTheme();
  const lines = message.answer.split('\n').filter((l) => l.trim().length > 0);

  return (
    <View style={{ gap: space.sm }}>
      {/* The question, on the right like any chat. */}
      <View
        style={{
          alignSelf: 'flex-end',
          maxWidth: '85%',
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.lg,
          borderBottomRightRadius: radius.sm,
          backgroundColor: colors.accent,
        }}
      >
        <Text variant="body" color={colors.inkInverse}>
          {message.question}
        </Text>
      </View>

      <Surface>
        <View style={{ gap: space.sm }}>
          <Row gap={6}>
            <Ionicons name="sparkles" size={14} color={colors.gradientStart} />
            <Text variant="label" tone="muted">
              {message.pending
                ? 'THINKING'
                : message.web
                  ? 'FROM YOUR RECORDS + THE WEB'
                  : 'FROM YOUR RECORDS'}
            </Text>
          </Row>

          {message.error ? (
            <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} style={{ marginTop: 1 }} />
              <Text variant="body" style={{ flex: 1 }}>
                {message.error}
              </Text>
            </Row>
          ) : lines.length === 0 ? (
            <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start' }} />
          ) : (
            lines.map((line, index) =>
              line.startsWith('- ') ? (
                <Row key={index} gap={space.sm} style={{ alignItems: 'flex-start' }}>
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      marginTop: 9,
                      backgroundColor: colors.accent,
                    }}
                  />
                  <Text variant="body" style={{ flex: 1 }}>
                    {line.slice(2)}
                  </Text>
                </Row>
              ) : (
                <Text key={index} variant="body">
                  {line}
                </Text>
              ),
            )
          )}

          {message.sources.length > 0 ? (
            <View style={{ gap: 6, paddingTop: space.xs }}>
              <Text variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
                Sources
              </Text>
              {message.sources.map((s) => (
                <Pressable
                  key={s.uri}
                  onPress={() => void Linking.openURL(s.uri)}
                  accessibilityRole="link"
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Ionicons name="globe-outline" size={14} color={colors.accent} />
                  <Text variant="caption" tone="accent" numberOfLines={1} style={{ flex: 1 }}>
                    {s.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </Surface>
    </View>
  );
}

/**
 * Before the first question: what each part of the app would send, with a
 * switch per part. A section asks only for its own; the global one lists all,
 * and works with whichever the user turns on.
 */
function ConsentCard({
  scope,
  missing,
  onChange,
}: {
  scope: AskScope;
  missing: readonly AskArea[];
  onChange: () => void;
}) {
  const { colors, space } = useTheme();
  const areas = SCOPE_AREAS[scope];
  const single = areas.length === 1;

  return (
    <Surface>
      <View style={{ gap: space.md }}>
        <Text variant="bodyStrong">{single ? 'Before you ask' : 'Choose what AI can see'}</Text>
        <Text variant="small" tone="secondary">
          Your question goes to Google Gemini with only the parts you allow. Nothing is saved after
          you leave this screen. Change it any time in Settings → AI features.
        </Text>
        {single ? (
          <>
            <Text variant="small">{AREA_SENDS[areas[0]]}</Text>
            <GradientButton
              label="Agree and continue"
              icon="checkmark"
              onPress={() => {
                setAreaConsent(areas[0], true);
                onChange();
              }}
            />
          </>
        ) : (
          areas.map((area) => {
            const on = !missing.includes(area);
            return (
              <Row key={area} gap={space.md} style={{ alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{AREA_LABEL[area]}</Text>
                  <Text variant="caption" tone="secondary">
                    {AREA_SENDS[area]}
                  </Text>
                </View>
                <Switch
                  value={on || hasAreaConsent(area)}
                  onValueChange={(value) => {
                    setAreaConsent(area, value);
                    onChange();
                  }}
                  trackColor={{ true: colors.accent, false: colors.surfaceSunken }}
                  accessibilityLabel={`Let AI see ${AREA_LABEL[area]}`}
                />
              </Row>
            );
          })
        )}
      </View>
    </Surface>
  );
}
