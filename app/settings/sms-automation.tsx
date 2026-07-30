import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { SMART_DETECT_NAME, SmartDetectBadge } from '../../src/components/SmartDetectBadge';
import { BottomSheet, Label, Row, Surface, T } from '../../src/components/ui';
import { useModalClose } from '../../src/hooks/useModalClose';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * In-app setup guide for the iOS Shortcuts automation that turns incoming bank
 * SMS into Money Manager drafts. Lives under Settings → Auto-detect
 * transactions. iOS gives no app access to the SMS inbox, so this documents the
 * one mechanism that does work — a Shortcuts personal automation opening the
 * app's `moneymanager://sms?text=…` deep link — as numbered, tappable-labelled
 * steps mirroring what the user sees in the Shortcuts app.
 */
export default function SmsAutomationGuide() {
  const { colors, radius, space } = useTheme();
  const closeModal = useModalClose();

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="Auto-detect transactions"
      icon="flash-outline"
      iconColor={colors.accent}
      scroll
    >
        {/* Branded so the feature is recognisable wherever it appears. */}
        <View style={{ gap: space.sm }}>
          <SmartDetectBadge />
          <T variant="small" tone="secondary">
            iOS won&apos;t let apps read messages, so a <B>Shortcut</B> does it: a bank SMS arrives,
            the app opens, and {SMART_DETECT_NAME} turns it into a draft waiting on your dashboard.
          </T>
        </View>

        {/* A screen recording of the real thing, above the written steps, and
            playing as soon as the guide opens. Watching the Shortcuts UI once
            answers "which button, which screen" far faster than the prose can,
            and step 3 — inserting the variable chip rather than typing it — is
            much clearer seen than described. */}
        <Walkthrough />

        {/* Four steps, each one action. Everything that used to be explained in
            prose beside them is either in the step itself or dropped — the guide
            was long enough that people stopped reading before step 3, which is
            the only one that is actually easy to get wrong. */}
        <PartHeader tag="Shortcuts app" title="Set it up once" />
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          <Step n={1}>
            <Tap>Automation</Tap> → <Tap>＋</Tap> → <Tap>Message</Tap>.
          </Step>
          <Step n={2} code="LKR">
            <Tap>Message Contains</Tap> this, then <Tap>Run Immediately</Tap> and <Tap>Next</Tap>.
          </Step>
          <Step
            n={3}
            code="moneymanager://sms?text="
            result={<Result prefix="moneymanager://sms?text=" chip="Shortcut Input" />}
            warn="Insert the chip, don’t type it — tap the “Shortcut Input” suggestion above the keyboard."
          >
            Add <Tap>Text</Tap>, type the link, then insert <Chip>Shortcut Input</Chip> after the{' '}
            <B>=</B>.
          </Step>
          <Step n={4} last result={<Result label="Open" chip="Text" />}>
            Add <Tap>Open URLs</Tap>, set it to that <Chip>Text</Chip>, then <Tap>Done</Tap>.
          </Step>
        </Surface>

        {/* Test — the one instruction worth its own block, since it is how the
            user finds out whether any of the above worked. */}
        <Surface style={{ gap: space.sm, borderColor: colors.accentSoft }}>
          <Row gap={space.sm}>
            <Ionicons name="checkmark-circle" size={20} color={colors.completed} />
            <T variant="bodyStrong">Test it</T>
          </Row>
          <T variant="small" tone="secondary">
            Text yourself <B>&ldquo;debited LKR 1,250.00 at KEELLS&rdquo;</B>. The app should open
            with a draft waiting.
          </T>
        </Surface>

        {/* Two fixes, not three: the third was a restatement of step 3's warning. */}
        <PartHeader tag="If nothing happens" title="Common fixes" />
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          <Fix
            title="Nothing opened"
            body="Check Run Immediately is on. With “Notify When Run” enabled, iOS waits for you to tap a notification instead."
          />
          <Fix
            title="It opened but no draft appeared"
            body="The message may carry no readable amount, or be an OTP or promo — those are ignored on purpose. Paste it into Add → Paste a message to see what’s detected."
            last
          />
        </Surface>

        <T variant="caption" tone="muted">
          On Android, any automation app that can open a URL on an incoming SMS (Tasker, MacroDroid)
          works the same way — point it at <B>moneymanager://sms?text=</B> with the message appended.
        </T>
    </BottomSheet>
  );
}

/**
 * The screen recording of the setup, as it happens in the Shortcuts app.
 *
 * A video rather than a GIF so it can be paused, scrubbed and replayed — at
 * nearly a minute long, a looping GIF gives no way to stop on the one step the
 * user is mid-way through copying, which is the whole reason to watch it.
 *
 * Native controls are used rather than a custom overlay: they bring scrubbing
 * and fullscreen for free, and fullscreen matters here because the recording is
 * of a phone screen, so detail is small at inline size.
 */
function Walkthrough() {
  const { radius, space } = useTheme();

  // Nothing to show on a binary without the native module — the guide's written
  // steps are the fallback, and they are complete on their own.
  if (!VideoPlayback) {
    return null;
  }

  return (
    <View style={{ gap: space.sm }}>
      {/* No frame around the clip: it is already a recording of a phone screen,
          so a bordered panel put a rectangle inside a rectangle. The player is
          centred and sized to its own aspect ratio instead, letting the sheet's
          own surface show through. */}
      <View style={{ alignItems: 'center', borderRadius: radius.lg, overflow: 'hidden' }}>
        <VideoPlayback />
      </View>
      <T variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        Playing from the start — pause on any step, or tap fullscreen for a closer look.
      </T>
    </View>
  );
}

/**
 * The player itself, resolved at module load so a binary without `expo-video`
 * linked degrades to no video rather than a crash.
 *
 * `expo-video` ships native code, so a JS-only reload after installing it hits
 * "Cannot find native module 'ExpoVideo'" — and because the import sat at the
 * top of this file, that error took down the whole route rather than just the
 * clip. Requiring inside a try mirrors services/biometrics.ts, which loads its
 * native dependency the same way and for the same reason.
 */
const VideoPlayback: (() => React.ReactElement) | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useVideoPlayer, VideoView } = require('expo-video') as typeof import('expo-video');

    return function VideoPlaybackInner() {
      const player = useVideoPlayer(
        require('../../assets/video/automation-tutorial.mp4'),
        (instance) => {
          instance.loop = true;
          instance.muted = true;
        },
      );

      /*
       * Start from the beginning every time the guide is opened.
       *
       * The `useVideoPlayer` setup callback above runs once per player, so
       * autoplaying there alone would be enough for a fresh mount — but this
       * screen is a route modal that expo-router can keep mounted between
       * visits, and a player left paused mid-clip would sit frozen on whatever
       * frame the user stopped at. Seeking to 0 first makes "open the guide"
       * always mean "watch it from the top".
       */
      React.useEffect(() => {
        player.currentTime = 0;
        player.play();
      }, [player]);

      return (
        <VideoView
          player={player}
          // Sized from the height rather than the width: at 888×1920 a
          // full-width portrait clip would be far taller than the sheet, and
          // `width: '100%'` with a maxHeight leaves the view its full width
          // while the picture shrinks inside it — so the clip looked off-centre
          // against a much wider transparent box. Fixing the height and letting
          // the aspect ratio set the width keeps the two the same size.
          style={{ height: 560, aspectRatio: 888 / 1920 }}
          contentFit="contain"
          // Both default to on; named here because the caption promises pause
          // and fullscreen, so turning either off would make it lie.
          nativeControls
          fullscreenOptions={{ enable: true }}
          accessibilityLabel="Screen recording of the Shortcuts automation being set up"
        />
      );
    };
  } catch {
    return null;
  }
})();

/** A "Part A / Part B" section heading with a pill tag. */
function PartHeader({ tag, title }: { tag: string; title: string }) {
  const { colors, space } = useTheme();
  return (
    <Row gap={space.sm} style={{ marginTop: space.sm }}>
      <View
        style={{
          paddingHorizontal: space.sm,
          paddingVertical: 3,
          borderRadius: 999,
          backgroundColor: colors.accentSoft,
        }}
      >
        <T variant="caption" color={colors.accent} style={{ fontWeight: '800' }}>
          {tag.toUpperCase()}
        </T>
      </View>
      <T variant="heading" style={{ flex: 1 }}>
        {title}
      </T>
    </Row>
  );
}

/** A numbered step card with optional code block, result preview, and callouts. */
function Step({
  n,
  children,
  code,
  result,
  warn,
  last,
}: {
  n: number;
  children: React.ReactNode;
  code?: string;
  result?: React.ReactNode;
  warn?: string;
  last?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <T variant="small" color="#FFFFFF" style={{ fontWeight: '800' }}>
            {n}
          </T>
        </View>
        <View style={{ flex: 1, gap: space.sm }}>
          <T variant="body" style={{ lineHeight: 22 }}>
            {children}
          </T>
          {code ? <CodeBlock>{code}</CodeBlock> : null}
          {result ? result : null}
          {warn ? <Warn>{warn}</Warn> : null}
        </View>
      </View>
      {!last ? <View style={{ height: 1, backgroundColor: colors.hairline }} /> : null}
    </View>
  );
}

/** Monospace string the user must type verbatim. */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surfaceSunken,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        borderRadius: radius.sm,
        paddingHorizontal: space.md,
        paddingVertical: 10,
      }}
    >
      <T variant="small" style={{ fontFamily: 'Courier', color: colors.ink }}>
        {children}
      </T>
    </View>
  );
}

/** An inline pill styling a phrase the user taps in the Shortcuts UI. */
function Tap({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <T variant="body" color={colors.ink} style={{ fontWeight: '700' }}>
      {children}
    </T>
  );
}

function B({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <T variant="body" color={colors.ink} style={{ fontWeight: '700' }}>
      {children}
    </T>
  );
}

/** A Shortcuts variable chip, shown inline in prose. */
function Chip({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
      {`[${children}]`}
    </T>
  );
}

/** "Result should read" preview mimicking a finished Shortcuts action. */
function Result({ label, prefix, chip }: { label?: string; prefix?: string; chip: string }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surfaceSunken,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        borderRadius: radius.sm,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          paddingHorizontal: space.md,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <Label>Result should read</Label>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 4,
          paddingHorizontal: space.md,
          paddingVertical: 10,
        }}
      >
        {label ? (
          <T variant="small" color={colors.ink} style={{ fontWeight: '600' }}>
            {label}
          </T>
        ) : null}
        {prefix ? (
          <T variant="small" style={{ fontFamily: 'Courier', color: colors.ink }}>
            {prefix}
          </T>
        ) : null}
        <View
          style={{
            backgroundColor: colors.accentSoft,
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <T variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
            {chip}
          </T>
        </View>
      </View>
    </View>
  );
}

/** Amber "watch out" callout for the tricky steps. */
function Warn({ children }: { children: React.ReactNode }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.sm,
        backgroundColor: colors.pendingSoft,
        borderWidth: 1,
        borderColor: colors.pending,
        borderRadius: radius.sm,
        padding: space.md,
      }}
    >
      <Ionicons name="alert-circle" size={16} color={colors.pending} style={{ marginTop: 1 }} />
      <T variant="caption" tone="secondary" style={{ flex: 1, lineHeight: 18 }}>
        {children}
      </T>
    </View>
  );
}

/** One troubleshooting entry: the symptom, then what to change. */
function Fix({ title, body, last }: { title: string; body: string; last?: boolean }) {
  const { colors, space } = useTheme();
  return (
    <View>
      <View style={{ gap: 4, padding: space.lg }}>
        <Row gap={space.sm}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.pending} />
          <T variant="small" style={{ fontWeight: '700', flex: 1 }}>
            {title}
          </T>
        </Row>
        <T variant="caption" tone="secondary" style={{ lineHeight: 18 }}>
          {body}
        </T>
      </View>
      {!last ? <View style={{ height: 1, backgroundColor: colors.hairline }} /> : null}
    </View>
  );
}

/** One keyword row in the "catch more" list. */
function Keyword({ word, desc, last }: { word: string; desc: string; last?: boolean }) {
  const { colors, radius, space } = useTheme();
  return (
    <View>
      <Row gap={space.md} style={{ padding: space.lg }}>
        <View
          style={{
            backgroundColor: colors.surfaceSunken,
            borderWidth: 1,
            borderColor: colors.hairlineStrong,
            borderRadius: radius.sm,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <T variant="small" style={{ fontFamily: 'Courier', color: colors.ink }}>
            {word}
          </T>
        </View>
        <T variant="caption" tone="secondary" style={{ flex: 1 }}>
          {desc}
        </T>
      </Row>
      {!last ? <View style={{ height: 1, backgroundColor: colors.hairline }} /> : null}
    </View>
  );
}
