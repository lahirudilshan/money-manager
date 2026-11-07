import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Image, Linking, Pressable, Switch, View } from 'react-native';
import { SMART_DETECT_NAME, SmartDetectBadge } from '~/features/sms/components/SmartDetectBadge';
import { BottomSheet, Button, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { describeDrain } from '~/features/sms/logic/smsInbox';
import { cleanPhoneNumber, openTestAlertComposer } from '~/shared/lib/testAlert';
import { fetchAppConfig } from '~/shared/lib/catalogApi';
import { isShortcutLink, resolveShortcutUrl } from '~/features/sms/logic/shortcutLink';
import { settingsRepo, SETTINGS_KEYS } from '../../src/db/repositories';
import { lastDrainReport, useAppStore } from '../../src/store/useAppStore';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Setup for the iOS Shortcuts automation behind Smart Detect.
 *
 * iOS gives no app access to the SMS inbox, so a Shortcuts automation hands
 * each message to Dayly's own action, "Send Message to Dayly" (a native App
 * Intent — plugins/ios/SendMessageToDaylyIntent.swift), which drops anything
 * not about money and queues the rest without opening the app.
 *
 * Setup is one shared shortcut (see `shortcutLink.ts`) that already contains
 * the Message trigger and that action. The screen is that one button; the
 * Shortcuts app's own screens take it from there.
 */
export default function SmsAutomationGuide() {
  const { colors, radius, space } = useTheme();
  const closeModal = useModalClose();
  const router = useRouter();

  const waiting = useAppStore((s) => s.smsInboxWaiting);
  const drainSmsInbox = useAppStore((s) => s.drainSmsInbox);
  const refreshInboxCount = useAppStore((s) => s.refreshInboxCount);
  const recheckQueue = useAppStore((s) => s.recheckQueueAfterAccountChange);
  // The test alert names one of the user's own accounts — see `testAlertBody`.
  const ownAccountLast4 = useAppStore(
    (s) => s.cards.find((card) => !card.isCard && !card.archivedAt && card.last4)?.last4 ?? null,
  );

  // Opt-in: see `hideForeignAccounts` for why the default is off.
  const [hideForeign, setHideForeign] = React.useState(
    () => settingsRepo.get(SETTINGS_KEYS.hideForeignAccounts) === 'true',
  );

  React.useEffect(() => {
    refreshInboxCount();
  }, [refreshInboxCount]);

  // The link lives on the server so a new shortcut needs no app release. Start
  // from the cached one, then take the server's if it answers with a valid link.
  const [shortcutUrl, setShortcutUrl] = React.useState(() =>
    resolveShortcutUrl(settingsRepo.get(SETTINGS_KEYS.smsShortcutUrl)),
  );
  React.useEffect(() => {
    let live = true;
    void fetchAppConfig().then(({ smsShortcutUrl }) => {
      if (!live || !isShortcutLink(smsShortcutUrl)) return;
      const url = smsShortcutUrl.trim();
      settingsRepo.set(SETTINGS_KEYS.smsShortcutUrl, url);
      setShortcutUrl(url);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Open the shared shortcut. Shortcuts shows it with an Add Shortcut button;
   * the trigger and the "Send Message to Dayly" action come with it.
   */
  function handleInstall() {
    settingsRepo.set(SETTINGS_KEYS.smsInboxEnabled, 'true');
    void Linking.openURL(shortcutUrl).catch(() =>
      Alert.alert('Could not open Shortcuts', `Open this link in Safari instead:\n\n${shortcutUrl}`),
    );
  }

  /**
   * Test the whole chain: a fake alert texted to the user's own number.
   *
   * iOS never tells an app its own phone number, so it is asked for once and
   * kept on the phone; after that Messages opens addressed and ready, and the
   * user only taps Send.
   */
  function handleTest() {
    const saved = settingsRepo.get(SETTINGS_KEYS.ownPhoneNumber);
    if (!saved) {
      askForNumber();
      return;
    }
    Alert.alert('Send a test alert', `Messages opens with a test bank alert to ${saved}. Just tap Send.`, [
      { text: 'Change number', onPress: askForNumber },
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Messages', onPress: () => sendTest(saved) },
    ]);
  }

  function askForNumber() {
    Alert.prompt(
      'Your mobile number',
      'The test alert is sent to yourself. iOS doesn’t let apps read your number, so type it once — it stays on this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save and send',
          onPress: (value?: string) => {
            const number = value ? cleanPhoneNumber(value) : null;
            if (!number) {
              Alert.alert('That doesn’t look like a phone number', 'Type it with the area code, e.g. 0771234567.');
              return;
            }
            settingsRepo.set(SETTINGS_KEYS.ownPhoneNumber, number);
            sendTest(number);
          },
        },
      ],
      'plain-text',
      settingsRepo.get(SETTINGS_KEYS.ownPhoneNumber) ?? '',
      'phone-pad',
    );
  }

  function sendTest(number: string) {
    void openTestAlertComposer(ownAccountLast4, number).then((ok) => {
      if (!ok) {
        Alert.alert(
          'Could not open Messages',
          'Text yourself “LKR 1,250.00 debited at KEELLS SUPER (TEST)” instead.',
        );
      }
    });
  }

  /**
   * Import, and on a no-op say WHY.
   *
   * "Nothing yet" alone is the least useful message this screen can show: it is
   * identical whether the app is reading a different path than Shortcuts writes,
   * the file is present but empty, or it holds a message the parser rejects.
   * Those need completely different fixes, so the file's real state is reported
   * whenever the import comes back empty.
   */
  function handleImportNow() {
    const summary = drainSmsInbox();

    /*
     * Report the queue state even on success.
     *
     * "Imported" alone hid the failure being chased here: rows can be written
     * and counted while the dashboard stays empty, and that reads to the user
     * as the import not having happened at all. Showing the pending-row and
     * draft counts separates "nothing was stored" from "it was stored but not
     * shown", which need opposite fixes.
     */
    if (summary.queued > 0) {
      const report = lastDrainReport;
      const shown =
        report && report.draftsInStore === 0
          ? '\n\nStored, but the review list is empty — this is a display problem, not an import one. Please screenshot this.'
          : '';

      Alert.alert(
        'Imported',
        `${describeDrain(summary)}${
          report ? `\n\nPending rows: ${report.pendingRows}\nDrafts on screen: ${report.draftsInStore}` : ''
        }${shown}`,
      );
      return;
    }

    /*
     * The duplicate case, which looks exactly like "nothing happened".
     *
     * A message whose fingerprint is already in `sms_inbox` is skipped — and
     * the existing row keeps whatever status it has. If that row was already
     * confirmed or dismissed (including during earlier testing), the message is
     * consumed from the file and correctly never shown again. Indistinguishable
     * from a broken import unless it is said out loud.
     */
    const report = lastDrainReport;
    if (report && report.duplicates > 0 && report.queued === 0) {
      Alert.alert(
        'Already imported before',
        `${report.duplicates} message(s) were skipped because the app has seen them before — they were confirmed or dismissed earlier, so they are not shown again.\n\n` +
          `Pending rows: ${report.pendingRows}\n\n` +
          'To test with a fresh message, send yourself an alert with a DIFFERENT amount.',
      );
      return;
    }

    /*
     * Nothing arrived. The app cannot see the automation, so name the three
     * settings that account for nearly every silent setup, in the order the
     * steps below set them.
     */
    Alert.alert(
      'Nothing has arrived yet',
      `${describeDrain(summary)}\n\nIf you sent a test alert, open the Shortcuts app and check that the Dayly App Automation is added, and that you ran it once with the play button and chose Allow.`,
    );
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
          {SMART_DETECT_NAME} turns the bank alerts you already receive into drafts — amount, shop
          and account filled in, category suggested. You confirm with one tap.
        </Text>
      </View>

      {/*
        Setup is ONE tap: the shared shortcut already holds the Message trigger
        and the "Send Message to Dayly" action, and the Shortcuts app walks the
        user through adding it. Nothing else to explain.
      */}
      <View style={{ gap: space.sm }}>
        <Label>Set up</Label>
        <Surface style={{ gap: space.lg }}>
          <View style={{ gap: 3 }}>
            <Text variant="heading">Add the Dayly automation</Text>
            <Text variant="small" tone="secondary">
              An automation in Apple&apos;s Shortcuts app passes each new message to Dayly, so your
              bank alerts arrive here on their own. Tap below — the Shortcuts app opens; follow its
              steps to add it.
            </Text>
            <Text variant="small" tone="secondary">
              Works with every bank. Dayly keeps only the bank alerts and ignores your other
              messages.
            </Text>
          </View>

          <GradientButton label="Add automation" icon="add-circle-outline" onPress={handleInstall} />

          {/*
            The one step the Shortcuts app does not prompt for: an added
            automation asks permission the first time it runs, and an
            automation that fires on its own cannot ask. Running it once by
            hand from its tile is where that Allow appears — skip it and the
            automation never runs.
          */}
          <Row
            gap={space.md}
            align="center"
            style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }}
          >
            <Image
              source={require('../../assets/images/shortcut-run-once.png')}
              style={{ width: 108, height: 70, borderRadius: radius.sm }}
              accessibilityLabel="The Dayly App Automation tile in Shortcuts, with its play button highlighted"
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">Then run it once</Text>
              <Text variant="small" tone="secondary">
                In the Shortcuts app, tap the play button on Dayly App Automation and choose Allow.
                After that the automation runs by itself whenever a message arrives.
              </Text>
            </View>
          </Row>
        </Surface>
      </View>

      <View style={{ gap: space.sm }}>
        <Label>Check it works</Label>
        <Surface style={{ gap: space.md }}>
          <Text variant="small" tone="secondary">
            Texts a test bank alert to your own number. A draft for LKR 1,250.00 at KEELLS SUPER
            (TEST) should appear within a few seconds.
          </Text>
          <Button label="Send test alert" icon="send-outline" variant="secondary" onPress={handleTest} />
          <Button
            label={waiting > 0 ? `Import ${waiting} waiting` : 'Check for messages'}
            icon="download-outline"
            variant="ghost"
            onPress={handleImportNow}
          />
        </Surface>
      </View>

      {/*
        Privacy, stated plainly and specifically: what happens to each thing
        the user is worried about, and the one thing that IS shared, in the
        same breath.
      */}
      <Surface style={{ gap: space.md }}>
        <Row gap={space.sm}>
          <Ionicons name="shield-checkmark" size={19} color={colors.completed} />
          <Text variant="bodyStrong">Your messages stay yours</Text>
        </Row>
        <View style={{ gap: space.sm }}>
          <Privacy text="Texts that aren’t about money are dropped the moment they arrive — never saved." />
          <Privacy text="Balances, account numbers and message text are never uploaded anywhere." />
          <Privacy text="No sign-in, no account. Your transactions live only on this phone." />
        </View>
        <View style={{ height: 1, backgroundColor: colors.hairline }} />
        <Text variant="caption" tone="muted">
          To improve suggestions for everyone, the app shares shop names it has learned — like
          “KEELLS SUPER” → Groceries — and nothing else.
        </Text>
      </Surface>

      {/*
        Hide messages about accounts that are not the user's. Carriers reassign
        numbers, and the new owner keeps getting the old owner's alerts. OFF by
        default because it DISCARDS messages.
      */}
      <Surface padded={false} style={{ overflow: 'hidden' }}>
        <Row gap={space.md} style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
          <Ionicons name="person-remove-outline" size={19} color={colors.accent} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Ignore other people&apos;s accounts</Text>
            <Text variant="caption" tone="muted">
              Hides alerts for accounts you have not added. Add every account number first, or
              your own messages will be hidden too.
            </Text>
          </View>
          <Switch
            value={hideForeign}
            onValueChange={(next) => {
              setHideForeign(next);
              settingsRepo.set(SETTINGS_KEYS.hideForeignAccounts, next ? 'true' : 'false');
              // Applies to the backlog too, not just future messages.
              if (next) recheckQueue();
            }}
          />
        </Row>
      </Surface>

      {/* Where someone lands when a message did not appear. */}
      <Pressable
        onPress={() => router.push('/settings/sms-history')}
        accessibilityRole="button"
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Surface>
          <Row gap={space.sm}>
            <Ionicons name="pulse-outline" size={19} color={colors.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">Detection log</Text>
              <Text variant="caption" tone="muted">
                What was detected, skipped, or went wrong
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
          </Row>
        </Surface>
      </Pressable>
    </BottomSheet>
  );
}

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
