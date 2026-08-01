import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, Pressable, Switch, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SMART_DETECT_NAME, SmartDetectBadge } from '../../src/components/SmartDetectBadge';
import { BottomSheet, Label, Row, Surface, Text } from '../../src/components/ui';
import { describeDrain } from '../../src/core/smsInbox';
import { copyToClipboard } from '../../src/services/clipboard';
import {
  ensureInboxExists,
  FILES_APP_LOCATION,
  INBOX_FILE_NAME,
  INBOX_FILE_PATH,
  INBOX_FOLDER_NAME,
} from '../../src/services/smsInboxFile';
import { openTestAlertComposer } from '../../src/services/testAlert';
import { settingsRepo, SETTINGS_KEYS } from '../../src/db/repositories';
import { useAppStore } from '../../src/store/useAppStore';
import { useModalClose } from '../../src/hooks/useModalClose';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Setup guide for the iOS Shortcuts automation behind Smart Detect.
 *
 * iOS gives no app access to the SMS inbox, so a Shortcuts personal automation
 * appends each bank message to a text file the app imports on open.
 *
 * The screen teaches ONE path. It previously taught two — this and a deep-link
 * variant that reopened the app per message — and two full setups on one screen
 * meant people followed the wrong one or stopped reading. The steps mirror the
 * Shortcuts UI screen by screen, because the whole difficulty is knowing which
 * button to press next.
 */
export default function SmsAutomationGuide() {
  const { colors, radius, space } = useTheme();
  const closeModal = useModalClose();

  const waiting = useAppStore((s) => s.smsInboxWaiting);
  const drainSmsInbox = useAppStore((s) => s.drainSmsInbox);
  const refreshInboxCount = useAppStore((s) => s.refreshInboxCount);

  /*
   * Read from settings, NOT from whether the file exists.
   *
   * The app deletes the inbox file every time it drains it, so on a working
   * setup the file is absent most of the time — inferring the toggle from it
   * made the switch appear to turn itself off after every import.
   */
  const [enabled, setEnabled] = React.useState(
    () => settingsRepo.get(SETTINGS_KEYS.smsInboxEnabled) === 'true',
  );
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    refreshInboxCount();
  }, [refreshInboxCount]);

  function handleToggle(next: boolean) {
    if (!next) {
      settingsRepo.set(SETTINGS_KEYS.smsInboxEnabled, 'false');
      setEnabled(false);
      return;
    }

    const result = ensureInboxExists();
    if (!result.ok) {
      Alert.alert(
        'Could not turn this on',
        'The app could not write to its own folder. Reinstalling usually clears this.',
      );
      return;
    }

    settingsRepo.set(SETTINGS_KEYS.smsInboxEnabled, 'true');
    setEnabled(true);
    refreshInboxCount();
  }

  /**
   * Offer the path to copy.
   *
   * A share sheet rather than a silent clipboard write: `expo-clipboard` throws
   * on any build that predates it being linked, and the throw escapes a `try`
   * because Metro hoists the import. Share needs no native module, and its
   * first item IS Copy — so the user's actual action is one tap either way.
   */
  async function handleCopy() {
    const ok = await copyToClipboard(INBOX_FILE_PATH);
    if (!ok) {
      Alert.alert('Could not open', `Type it instead:\n\n${INBOX_FILE_PATH}`);
      return;
    }
    // Acknowledged on the button rather than in an alert the user has to dismiss
    // before switching back to Shortcuts.
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  /**
   * Test the whole chain.
   *
   * Explained BEFORE Messages opens, because a screen suddenly switching to a
   * half-written text is alarming if you did not expect it — and the user has
   * to know they are sending this to themselves for the test to mean anything.
   */
  function handleTest() {
    Alert.alert(
      'Send yourself a test alert',
      `Messages will open with a fake bank alert ready to send.\n\nSend it to your OWN number, then come back here — the draft should be waiting.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Messages',
          onPress: () => {
            void openTestAlertComposer().then((ok) => {
              if (!ok) {
                Alert.alert(
                  'Could not open Messages',
                  'Text yourself “debited LKR 1,250.00 at KEELLS” instead.',
                );
              }
            });
          },
        },
      ],
    );
  }

  function handleImportNow() {
    const summary = drainSmsInbox();
    Alert.alert(summary.queued > 0 ? 'Imported' : 'Nothing yet', describeDrain(summary));
  }

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
      <View style={{ gap: space.sm }}>
        <SmartDetectBadge />
        <Text variant="small" tone="secondary">
          {SMART_DETECT_NAME} reads the bank alerts you already receive and turns each one into a
          draft — amount, shop and account filled in, with the right category already suggested.
          You confirm with one tap instead of typing it out.
        </Text>
      </View>

      {/* The switch, described by what it DOES for the user rather than by its
          mechanism. "Save messages to a file" named an implementation detail
          and read like a chore. */}
      <Surface style={{ gap: space.md }}>
        <Row justify="space-between" align="center">
          <View style={{ flex: 1, gap: 3, paddingRight: space.md }}>
            <Text variant="bodyStrong">Enable smart alert detection</Text>
            <Text variant="caption" tone="muted">
              {enabled
                ? 'On — finish the Shortcuts setup below'
                : 'Turn bank SMS into ready-to-confirm drafts'}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={handleToggle}
            trackColor={{ false: colors.surfaceSunken, true: colors.accent }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Enable smart alert detection"
          />
        </Row>

        {!enabled ? (
          <View style={{ gap: space.sm }}>
            <Benefit icon="flash-outline" text="No typing — the amount and shop are read for you" />
            <Benefit icon="pricetag-outline" text="Category suggested from what you and others log" />
            <Benefit icon="lock-closed-outline" text="Your messages never leave this phone" />
          </View>
        ) : null}
      </Surface>

      {/*
        Privacy, stated plainly and specifically.

        "Secure" and "private" are claims anyone can print; what earns trust is
        naming what happens to each thing the user is worried about. So this
        lists the actual facts — no permission, nothing uploaded, no account —
        and the one thing that IS shared, in the same breath, because a privacy
        note that omits the sharing is the kind users learn not to believe.
      */}
      <Surface style={{ gap: space.md }}>
        <Row gap={space.sm}>
          <Ionicons name="shield-checkmark" size={19} color={colors.completed} />
          <Text variant="bodyStrong">Your messages stay yours</Text>
        </Row>

        <View style={{ gap: space.sm }}>
          <Privacy text="The app never reads your inbox — iOS doesn’t allow it, and no permission is ever requested." />
          <Privacy text="Only messages matching your filter are passed along, by a Shortcut you build and can delete." />
          <Privacy text="Balances, account numbers and message text are never uploaded anywhere." />
          <Privacy text="No sign-in, no account, no profile. Your transactions live only on this phone." />
        </View>

        <View style={{ height: 1, backgroundColor: colors.hairline }} />

        <Text variant="caption" tone="muted">
          To improve category suggestions for everyone, the app shares shop names it has learned —
          like “KEELLS SUPER” → Groceries — and nothing else. No amounts, no dates, no account
          details, and nothing that identifies you.
        </Text>
      </Surface>

      {enabled ? (
        <>
          {/*
            The path, framed by what the user DOES with it.

            "Where Shortcuts saves them" described the folder without saying why
            the user was being shown one. Step 6 asks them to paste a path into
            Shortcuts, so this block names that job, shows the exact string, and
            puts Copy next to it.

            A card, not a text input: it is something to copy, never to edit, and
            an input invites both editing and the question of where Save is.
          */}
          <Surface style={{ gap: space.md }}>
            <View style={{ gap: 3 }}>
              <Text variant="bodyStrong">Paste this into Shortcuts</Text>
              <Text variant="caption" tone="muted">
                Step 6 asks for a File Path — this is it.
              </Text>
            </View>

            <Row
              gap={space.md}
              style={{
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceSunken,
              }}
            >
              <Ionicons name="folder-open-outline" size={20} color={colors.accent} />
              <Text
                variant="small"
                selectable
                style={{ flex: 1, fontFamily: 'Courier', color: colors.ink }}
              >
                {INBOX_FILE_PATH}
              </Text>
            </Row>

            <Pressable
              onPress={handleCopy}
              accessibilityRole="button"
              accessibilityLabel="Copy file path"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 11,
                borderRadius: radius.md,
                backgroundColor: copied ? colors.completedSoft : colors.accentSoft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={15}
                color={copied ? colors.completed : colors.accent}
              />
              <Text
                variant="caption"
                color={copied ? colors.completed : colors.accent}
                style={{ fontWeight: '700' }}
              >
                {copied ? 'Shared' : 'Copy path'}
              </Text>
            </Pressable>

            <Row gap={6}>
              <Ionicons name="eye-outline" size={13} color={colors.inkSecondary} />
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                You can open this file any time in Files → <B>{FILES_APP_LOCATION}</B>
              </Text>
            </Row>
          </Surface>

          <PartHeader tag="Shortcuts app" title="Set it up once" />

          {/* The recording sits with the steps it illustrates, not at the top of
              the screen: the first decision is the toggle, and a 560pt video
              above it would push that below the fold. */}
          <Walkthrough />
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            <Step n={1}>
              Open <Tap>Shortcuts</Tap> → <Tap>Automation</Tap> tab → <Tap>New Automation</Tap>.
            </Step>
            <Step n={2}>
              Search <Tap>Message</Tap> and choose it.
            </Step>
            <Step
              n={3}
              code="LKR"
              note="Paid in another currency? Make a second automation with USD, or whichever code your bank prints."
            >
              Tap <Tap>Message Contains</Tap> → <Tap>Choose</Tap>, type this, then <Tap>Done</Tap>.
            </Step>
            <Step n={4}>
              Pick <Tap>Run Immediately</Tap>, then <Tap>Next</Tap>.
            </Step>
            <Step n={5}>
              Choose <Tap>New Blank Automation</Tap> → <Tap>Add Action</Tap>, and search{' '}
              <Tap>Append to Text File</Tap>.
            </Step>
            <Step
              n={6}
              last
              warn="Insert the chip, don’t type it — tap and hold Text, then pick Shortcut Input."
            >
              Tap and hold <Tap>Text</Tap> → <Chip>Shortcut Input</Chip>. Then under{' '}
              <Tap>File Path</Tap>, paste the path you copied above.
            </Step>
          </Surface>

          {/* Test, as a gradient button: it is the one action on this screen and
              the only way to find out whether any of the above worked. */}
          <Surface style={{ gap: space.md }}>
            <Row gap={space.sm}>
              <Ionicons name="paper-plane-outline" size={19} color={colors.accent} />
              <Text variant="bodyStrong">Check it works</Text>
            </Row>
            <Text variant="small" tone="secondary">
              Send yourself a test bank alert. If everything is wired up, a draft appears here.
            </Text>

            <Pressable
              onPress={handleTest}
              accessibilityRole="button"
              style={({ pressed }) => ({
                borderRadius: radius.md,
                overflow: 'hidden',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <LinearGradient
                colors={[colors.gradientStart, colors.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  paddingVertical: 13,
                }}
              >
                <Ionicons name="send" size={15} color="#FFFFFF" />
                <Text variant="bodyStrong" color="#FFFFFF">
                  Send test alert
                </Text>
              </LinearGradient>
            </Pressable>

            <Pressable
              onPress={handleImportNow}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 11,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceSunken,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="download-outline" size={15} color={colors.ink} />
              <Text variant="caption" style={{ fontWeight: '700' }}>
                {waiting > 0 ? `Import ${waiting} waiting` : 'Check for messages'}
              </Text>
            </Pressable>
          </Surface>

          <Warn>
            Needs a recent build of the app installed on this phone. On an older one the folder
            won&apos;t appear in the Files app and Shortcuts will have nowhere to write.
          </Warn>
        </>
      ) : null}
    </BottomSheet>
  );
}

/**
 * A screen recording of the Shortcuts setup, above the written steps.
 *
 * Watching the Shortcuts UI once answers "which button, which screen" far faster
 * than prose can — especially step 6, where the variable chip has to be INSERTED
 * by tap-and-hold rather than typed, which is much clearer seen than described.
 */
function Walkthrough() {
  const { colors, radius, space } = useTheme();

  // Nothing to show on a binary without the native module — the written steps
  // are the fallback, and they are complete on their own.
  if (!VideoPlayback) return null;

  return (
    <View style={{ gap: space.sm }}>
      {/* No frame around the clip: it is already a recording of a phone screen,
          so a bordered panel put a rectangle inside a rectangle. */}
      <View style={{ alignItems: 'center', borderRadius: radius.lg, overflow: 'hidden' }}>
        <VideoPlayback />
      </View>
      <Row gap={6}>
        <Ionicons name="information-circle-outline" size={13} color={colors.inkSecondary} />
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          Pause on any step, or tap fullscreen for a closer look. The written steps below are
          what to follow — the clip shows an older version of the last action.
        </Text>
      </Row>
    </View>
  );
}

/**
 * The player itself, resolved at module load so a binary without `expo-video`
 * linked degrades to no video rather than a crash.
 *
 * `expo-video` calls `requireNativeModule` at its own top level, so a JS-only
 * reload after installing it would hit "Cannot find native module 'ExpoVideo'".
 * It is already in this app's native build, so the require succeeds — but the
 * guard stays, because a future prebuild that drops it should cost the clip
 * rather than the whole screen.
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
       * Start from the beginning every time the guide is opened. This screen is
       * a route modal expo-router can keep mounted between visits, so a player
       * left paused mid-clip would sit frozen on whatever frame the user
       * stopped at.
       */
      React.useEffect(() => {
        player.currentTime = 0;
        player.play();
      }, [player]);

      return (
        <VideoView
          player={player}
          // Sized from the HEIGHT: at 888×1920 a full-width portrait clip would
          // be taller than the sheet, and `width: '100%'` with a maxHeight
          // leaves the view its full width while the picture shrinks inside —
          // so the clip looked off-centre against a much wider transparent box.
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

/** One privacy fact, checkmarked so the block scans as a list of assurances. */
function Privacy({ text }: { text: string }) {
  const { colors, space } = useTheme();
  return (
    <Row gap={space.sm} align="flex-start">
      <Ionicons name="checkmark-circle" size={15} color={colors.completed} />
      <Text variant="small" tone="secondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </Row>
  );
}

/** One selling point, as an icon and a line — used only in the off state. */
function Benefit({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors, space } = useTheme();
  return (
    <Row gap={space.sm} align="flex-start">
      <Ionicons name={icon} size={15} color={colors.accent} />
      <Text variant="small" tone="secondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </Row>
  );
}

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
        <Text variant="caption" color={colors.accent} style={{ fontWeight: '800' }}>
          {tag.toUpperCase()}
        </Text>
      </View>
      <Text variant="heading" style={{ flex: 1 }}>
        {title}
      </Text>
    </Row>
  );
}

/** A numbered step card with an optional code block and callouts. */
function Step({
  n,
  children,
  code,
  warn,
  note,
  last,
}: {
  n: number;
  children: React.ReactNode;
  code?: string;
  warn?: string;
  /** A quieter aside under the step — an optional extra, not a correction. */
  note?: string;
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
          <Text variant="small" color="#FFFFFF" style={{ fontWeight: '800' }}>
            {n}
          </Text>
        </View>
        <View style={{ flex: 1, gap: space.sm }}>
          <Text variant="body" style={{ lineHeight: 22 }}>
            {children}
          </Text>
          {code ? <CodeBlock>{code}</CodeBlock> : null}
          {warn ? <Warn>{warn}</Warn> : null}
          {note ? (
            <Text variant="caption" tone="muted" style={{ lineHeight: 17 }}>
              {note}
            </Text>
          ) : null}
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
      <Text variant="small" style={{ fontFamily: 'Courier', color: colors.ink }}>
        {children}
      </Text>
    </View>
  );
}

/** An inline pill styling a phrase the user taps in the Shortcuts UI. */
function Tap({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text variant="body" color={colors.ink} style={{ fontWeight: '700' }}>
      {children}
    </Text>
  );
}

function B({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text variant="body" color={colors.ink} style={{ fontWeight: '700' }}>
      {children}
    </Text>
  );
}

/** A Shortcuts variable chip, shown inline in prose. */
function Chip({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
      {`[${children}]`}
    </Text>
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
      <Text variant="caption" tone="secondary" style={{ flex: 1, lineHeight: 18 }}>
        {children}
      </Text>
    </View>
  );
}

/** One troubleshooting entry: the symptom, then what to change. */
