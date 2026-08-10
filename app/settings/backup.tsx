import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import Constants from 'expo-constants';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native';
import { BottomSheet, Divider, GradientButton, Label, Row, Surface, Text } from '../../src/components/ui';
import {
  ALL_PARTS,
  DEFAULT_BACKUP_PARTS,
  BACKUP_PARTS,
  partsOf,
  serialiseSnapshot,
  SETUP_PARTS,
  summariseSnapshot,
  snapshotFilename,
  validateSnapshot,
  type BackupPartKey,
  type Snapshot,
} from '../../src/core/backup';
import { exportSnapshot, restoreSnapshot } from '../../src/db/backupRepo';
import { settingsRepo, SETTINGS_KEYS } from '../../src/db/repositories';
import { useModalClose } from '../../src/hooks/useModalClose';
import {
  BACKUP_FILES_LOCATION,
  deleteBackup,
  listBackups,
  readBackup,
  saveBackup,
  type StoredBackup,
} from '../../src/services/backupFile';
import {
  deleteDriveBackup,
  driveBlocker,
  isDriveAvailable,
  isSignedIn,
  listDriveBackups,
  signIn,
  signOut,
  uploadBackup,
} from '../../src/services/googleDrive';
import { formatSize as formatDriveSize, type DriveFile } from '../../src/core/driveSync';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Backup & restore.
 *
 * Everything lives in one local SQLite file, so a lost or wiped phone loses
 * every transaction the user has recorded — this screen is the only way off the
 * device, which is why it sits under SECURITY.
 *
 * Three bands, in the order someone actually thinks about them:
 *
 *   1. STATUS — when did this last happen? The first question anyone opening a
 *      backup screen has, and the one a wall of buttons fails to answer.
 *   2. BACK UP — the action. Drive first, with a local file always available
 *      beneath it.
 *   3. RESTORE — the destructive half, deliberately last so it is never what a
 *      thumb lands on first.
 */
export default function BackupScreen() {
  const { colors, space, radius } = useTheme();
  const closeModal = useModalClose();
  const refresh = useAppStore((state) => state.refresh);

  const [backups, setBackups] = useState<StoredBackup[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState<'drive' | 'local' | 'signin' | null>(null);
  /**
   * What the app is doing right now, in the user's words.
   *
   * A bare spinner labelled "Working…" left the user watching an indeterminate
   * animation with no idea whether it was talking to Google, reading their
   * board, or uploading — and an upload that finished instantly looked
   * identical to one that had not started. Naming the step makes a slow
   * network legible rather than alarming.
   */
  const [progress, setProgress] = useState<string | null>(null);
  /**
   * Which parts the NEXT backup will include, and what to call it.
   *
   * Held on the screen rather than persisted: the selection is a decision about
   * this one backup, and silently reusing last month's choice is how someone
   * ends up with a file missing their transactions without having asked for
   * that.
   */
  const [parts, setParts] = useState<BackupPartKey[]>(DEFAULT_BACKUP_PARTS);
  const [label, setLabel] = useState('');
  /**
   * Whether the "what should this backup include?" sheet is open.
   *
   * A plain boolean now. It used to also carry a restore target, because one
   * component served both questions — but a restore is chosen inside the
   * backup's own panel (see `BackupDetails`), where the counts being chosen
   * against are visible. Only the backup direction still needs a picker.
   */
  const [picking, setPicking] = useState(false);
  /**
   * The restore selection, kept apart from the backup one.
   *
   * They answer different questions — "what should I save?" versus "what should
   * I bring back?" — and sharing one list meant opening the restore picker
   * silently rewrote the backup choice the user had just made.
   */
  const [restoreParts, setRestoreParts] = useState<BackupPartKey[]>(ALL_PARTS);
  /**
   * The backup whose contents are being inspected, or null.
   *
   * Separate from `picking` because looking is not choosing: the row is now
   * tappable to answer "what is in this file?" without committing to the
   * restore flow, which previously was the only way to find out — and it opened
   * with a destructive action already in reach.
   */
  const [inspecting, setInspecting] = useState<
    null | { backup: StoredBackup; snapshot: Snapshot | null }
  >(null);
  /**
   * What is actually in the Drive folder, and whether it is being fetched.
   *
   * Null means "not looked yet" — distinct from an empty array, which means
   * "looked, and there is nothing there". Collapsing the two would show
   * "No backups in Drive" during the fetch, which is a lie for the second or
   * two it takes.
   */
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [lastCloud, setLastCloud] = useState<string | null>(null);
  const [lastLocal, setLastLocal] = useState<string | null>(null);

  const driveAvailable = isDriveAvailable();
  const blocker = driveBlocker();
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const reload = useCallback(() => {
    setBackups(listBackups());
    setLastCloud(settingsRepo.get(SETTINGS_KEYS.lastCloudBackupAt) ?? null);
    setLastLocal(settingsRepo.get(SETTINGS_KEYS.lastLocalBackupAt) ?? null);
  }, []);

  useEffect(() => {
    reload();
    void isSignedIn().then(setSignedIn);
  }, [reload]);

  async function runDriveBackup() {
    /*
     * Each stage is announced BEFORE it starts.
     *
     * `exportSnapshot` reads every table synchronously, so on a large board the
     * UI is blocked for a moment — without a message first, that pause reads as
     * a frozen screen. The upload that follows is the slow part on a poor
     * connection, and naming it is what stops the user tapping again.
     */
    setProgress('Preparing your data…');
    const snapshot = exportSnapshot(appVersion, { parts, label: label.trim() || undefined });

    setProgress('Uploading to Google Drive…');
    const result = await uploadBackup(
      snapshotFilename(new Date(snapshot.createdAt)),
      serialiseSnapshot(snapshot),
    );

    if (!result.ok) {
      Alert.alert('Backup failed', result.error ?? 'The upload did not complete.');
      return;
    }

    settingsRepo.set(SETTINGS_KEYS.lastCloudBackupAt, result.uploadedAt ?? new Date().toISOString());
    setProgress('Done');
    reload();
  }

  /**
   * Sign in, then upload immediately.
   *
   * Connecting an account and then having to hunt for a second button serves
   * nobody: someone signing into Google on a backup screen has already decided
   * they want a backup, so the sign-in produces one.
   */
  async function handleConnect() {
    setBusy('signin');
    setProgress('Opening Google…');
    try {
      const result = await signIn();

      if (!result.ok) {
        // Cancelling is not a failure and must not be reported as one.
        if (result.error && !/cancel/i.test(result.error)) {
          Alert.alert('Could not connect', result.error);
        }
        return;
      }

      setSignedIn(true);
      await runDriveBackup();
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  /** Whichever destination the user last chose, run after the picker closes. */
  const [pendingDestination, setPendingDestination] = useState<'drive' | 'local'>('local');

  async function handleDriveOrLocal() {
    if (pendingDestination === 'drive') {
      await handleDriveBackup();
      return;
    }
    handleLocalBackup();
  }

  async function handleDriveBackup() {
    setBusy('drive');
    try {
      await runDriveBackup();
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  function handleLocalBackup() {
    setBusy('local');
    try {
      const result = saveBackup(
        exportSnapshot(appVersion, { parts, label: label.trim() || undefined }),
      );

      if (!result.ok) {
        Alert.alert('Could not save', result.error ?? 'The file could not be written.');
        return;
      }

      settingsRepo.set(SETTINGS_KEYS.lastLocalBackupAt, new Date().toISOString());
      reload();
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  /**
   * Open the Drive folder listing, fetching it each time.
   *
   * Deliberately not cached: the folder is shared with every other device the
   * user signs in from, and a stale list would offer a Restore for a file
   * somebody already deleted elsewhere.
   */
  async function openDriveFiles() {
    setDriveOpen(true);
    setDriveBusy(true);
    try {
      setDriveFiles(await listDriveBackups());
    } finally {
      setDriveBusy(false);
    }
  }

  /**
   * Delete one file from Drive, after asking.
   *
   * A Drive backup may be the ONLY copy — the local folder is on the phone this
   * protects against — so this confirms even though the row already required a
   * deliberate tap.
   */
  function handleDriveDelete(file: DriveFile) {
    Alert.alert(
      'Delete from Drive?',
      `"${file.name}" will be removed from your Google Drive. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await deleteDriveBackup(file.id);
              if (!result.ok) {
                Alert.alert('Could not delete', result.error ?? 'Please try again.');
                return;
              }
              // Re-fetch rather than splicing locally: the folder may have
              // changed on another device while this sheet was open.
              setDriveFiles(await listDriveBackups());
            })();
          },
        },
      ],
    );
  }

  function handleDisconnect() {
    Alert.alert(
      'Disconnect Google?',
      'Backups already in Drive stay there. This only stops the app uploading new ones.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => void signOut().then(() => setSignedIn(false)),
        },
      ],
    );
  }

  /**
   * Restore, behind two gates: the scope choice below, and `validateSnapshot`,
   * which runs BEFORE anything is deleted so a corrupt file cannot destroy a
   * good board.
   */
  /**
   * Open a backup's panel: what is in it, and what to bring back.
   *
   * Validation happens HERE rather than on the restore button, so a damaged
   * file is caught when the user opens it — not after they have read a list of
   * contents and chosen from it. A file that cannot be parsed at all still
   * opens the panel (which says so plainly and offers deletion); one that parses
   * but fails its integrity check is refused outright, because its counts would
   * be a lie to choose against.
   */
  function openBackup(backup: StoredBackup) {
    const snapshot = readBackup(backup.filename);

    if (!snapshot) {
      // Unreadable: the panel says so and offers deletion, which is the only
      // useful action left.
      setInspecting({ backup, snapshot: null });
      return;
    }

    const validation = validateSnapshot(snapshot);
    if (!validation.ok) {
      Alert.alert('That backup is not usable', validation.problems.join('\n\n'));
      return;
    }

    // Pre-ticked with what the file ACTUALLY holds — offering to restore
    // transactions from a backup that has none would be a lie.
    setRestoreParts(partsOf(snapshot));
    setInspecting({ backup, snapshot });
  }

  function confirmRestore(snapshot: Snapshot, chosen: readonly BackupPartKey[]) {
    const result = restoreSnapshot(snapshot, chosen);

    if (!result.ok) {
      // One transaction, so a failure leaves the board exactly as it was —
      // worth saying, because "restore failed" otherwise reads as "and now I
      // have nothing".
      Alert.alert(
        'Restore failed',
        `${result.error ?? 'Unknown error.'}\n\nYour existing data was left untouched.`,
      );
      return;
    }

    refresh();
    Alert.alert(
      'Restored',
      chosen.includes('history')
        ? 'Your board has been replaced with the backup.'
        : 'Your setup is back. No transactions were added.',
    );
  }

  function handleDelete(backup: StoredBackup) {
    Alert.alert('Delete this backup?', 'This removes the file from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteBackup(backup.filename);
          reload();
        },
      },
    ]);
  }

  const lastAny = newest(lastCloud, lastLocal);

  return (
    <BottomSheet
      visible
      asRoute
      scroll
      onClose={closeModal}
      title="Backup & restore"
      icon="shield-checkmark-outline"
      iconColor={colors.completed}
    >
      {/*
        1. STATUS — the hero.
        
        Tinted by state rather than rendered as another white card: this is the
        one thing on the screen that answers "am I safe?", and when the answer
        is no it has to look different from the rows below it, not merely say
        so. A neutral card saying "Not backed up yet" reads as a label; an amber
        one reads as a warning.
      */}
      <View
        style={{
          gap: space.sm,
          padding: space.lg,
          borderRadius: radius.lg,
          backgroundColor: busy
            ? colors.accentSoft
            : lastAny
              ? colors.completedSoft
              : colors.pendingSoft,
        }}
      >
        <Row gap={space.sm}>
          {/*
            The hero doubles as the progress indicator.

            A spinner buried in a row further down is easy to miss, and this is
            the element the eye is already on — so a backup in flight replaces
            the shield here rather than animating somewhere else.
          */}
          {busy ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons
              name={lastAny ? 'shield-checkmark' : 'alert-circle'}
              size={26}
              color={lastAny ? colors.completed : colors.pending}
            />
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading">
              {busy
                ? 'Backing up…'
                : lastAny
                  ? `Backed up ${relativeTime(lastAny)}`
                  : 'Not backed up yet'}
            </Text>
            <Text variant="small" tone="secondary">
              {busy
                ? (progress ?? 'Working…')
                : lastAny
                  ? absoluteTime(lastAny)
                  : 'Everything you have recorded exists only on this phone.'}
            </Text>
          </View>
        </Row>

      </View>

      {/*
        2. BACK UP.
        
        The two destinations are NOT peers and must not look like it. Drive
        survives losing the phone; a local file does not — it is a copy on the
        very device the backup exists to protect against. So Drive carries the
        section's recommendation badge and the local option sits under a
        quieter "also" heading, rather than both being identical white cards
        the user has to read carefully to tell apart.
      */}
      <View style={{ gap: space.sm }}>
        <SectionHeading
          icon="cloud-upload-outline"
          title="Back up"
          subtitle="Keep a copy somewhere that survives this phone"
        />

        <Surface padded={false} style={{ overflow: 'hidden' }}>
          {signedIn ? (
            <>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                }}
              >
                <GoogleMark />
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={6}>
                    <Text variant="bodyStrong">Google Drive</Text>
                    <StatusDot color={colors.completed} label="Connected" />
                  </Row>
                  <Text variant="caption" tone="muted">
                    {lastCloud
                      ? `Last upload ${relativeTime(lastCloud)}`
                      : 'Uploads to your "money-manager" folder'}
                  </Text>
                </View>
                <Pressable
                  onPress={handleDisconnect}
                  accessibilityRole="button"
                  accessibilityLabel="Disconnect Google"
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Text variant="caption" tone="muted">
                    Disconnect
                  </Text>
                </Pressable>
              </View>
              <Divider />
              {/*
                What is already UP there.

                Until now the screen could upload to Drive and never show what
                was in it — so a folder filling with backups was invisible from
                inside the app, and the only way to clear one out was the Drive
                app itself.
              */}
              <ActionRow
                icon="folder-open-outline"
                label="Backups in Drive"
                sublabel="See what is stored, or remove one"
                busy={false}
                onPress={() => void openDriveFiles()}
              />
              <Divider />
              <ActionRow
                icon="cloud-upload-outline"
                label="Back up to Drive now"
                busy={busy === 'drive'}
                busyLabel={progress}
                // Choose WHAT first. Firing straight into an upload gave the
                // user no say in what left their phone.
                onPress={() => {
                  setPendingDestination('drive');
                  setPicking(true);
                }}
                emphasis
              />
            </>
          ) : (
            <Pressable
              onPress={() => void handleConnect()}
              disabled={busy !== null || !driveAvailable}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              style={({ pressed }) => ({
                opacity: pressed || busy !== null ? 0.7 : driveAvailable ? 1 : 0.55,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingVertical: space.md,
                paddingHorizontal: space.lg,
              })}
            >
              {busy === 'signin' ? (
                <ActivityIndicator size="small" color={colors.inkSecondary} />
              ) : (
                <GoogleMark />
              )}
              <View style={{ flex: 1, gap: 3 }}>
                <Row gap={6}>
                  <Text variant="bodyStrong">
                    {busy === 'signin' ? 'Connecting…' : 'Continue with Google'}
                  </Text>
                  {driveAvailable ? <Badge label="RECOMMENDED" /> : null}
                </Row>
                <Text variant="caption" tone="muted">
                  {driveAvailable
                    ? 'Uploads to a "money-manager" folder in your Drive'
                    : blocker === 'needs-rebuild'
                      ? 'Ready — rebuild the app to switch this on'
                      : 'Not set up in this build — see docs/google-drive-backup.md'}
                </Text>
              </View>
              <Ionicons
                name={driveAvailable ? 'chevron-forward' : 'lock-closed-outline'}
                size={16}
                color={colors.inkMuted}
              />
            </Pressable>
          )}
        </Surface>

        {/* Always works — no account, no network, no rebuild. But it is a copy
            on the phone the backup protects against, hence the caveat. */}
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          <ActionRow
            icon="phone-portrait-outline"
            label="Save a file on this phone"
            /*
             * Says what this option IS, not when it last ran.
             *
             * "Last saved 1 day ago" repeated the hero banner three rows above
             * it, so the screen stated the same fact twice and neither told the
             * user the thing that actually matters here: a file on this phone
             * does not survive losing this phone. That caveat is the reason
             * Drive carries the recommendation, and it belongs on the row it
             * qualifies.
             */
            sublabel="Share it to Drive or AirDrop from the Files app"
            busy={busy === 'local'}
            busyLabel={progress}
            onPress={() => {
              setPendingDestination('local');
              setPicking(true);
            }}
          />
        </Surface>
      </View>

      {/*
        3. RESTORE — destructive, so deliberately last.

        Rendered even when EMPTY. Without the section a first-time user has no
        idea restoring is possible at all, and the "moving to a new phone" card
        below refers to a "Restore" heading that is not on screen — which reads
        as an instruction for an app they do not have.
      */}
      {backups.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <SectionHeading
            icon="time-outline"
            title="Restore"
            subtitle="Replace what is on your board with a saved copy"
          />
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {backups.map((backup, index) => (
              <View key={backup.filename}>
                {index > 0 ? <Divider /> : null}
                {/*
                  The row body opens the file's contents.

                  Tapping a list row to see more is what every other list in the
                  app does, and here it fills a real gap: the only way to learn
                  what a backup held was to start restoring it, which put a
                  board-replacing action in reach of someone who was still
                  deciding. The Restore chip and the trash keep their own
                  handlers, so opening details cannot be mistaken for either.
                */}
                <Pressable
                  onPress={() => openBackup(backup)}
                  accessibilityRole="button"
                  accessibilityLabel={`Details for ${backup.label || readableStamp(backup.createdAt)}`}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                  })}
                >
                  {/*
                    A tinted chip rather than a grey outline glyph.

                    Every row on this screen was a white card with a hairline
                    border, so nothing carried any weight and the eye had no
                    entry point. Giving the file icon the same soft tint the
                    rest of the app uses for grouped rows makes each backup read
                    as an object you can act on.
                  */}
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: radius.sm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.accentSoft,
                    }}
                  >
                    <Ionicons name="document-text-outline" size={17} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    {/* The user's own name leads when they gave one — that is
                        what makes a list of backups tellable apart. */}
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {backup.label || readableStamp(backup.createdAt)}
                    </Text>
                    {/*
                      CONTENTS lead the second line, with the date after.

                      "10 bills · 142 transactions" is what distinguishes two
                      restore points; the timestamp was already the row's title
                      when unnamed, so leading with it again said nothing twice
                      and pushed the counts to the end of the line where they
                      truncate first.
                    */}
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {backup.summary || 'Could not read this file'}
                      {backup.label ? ` · ${readableStamp(backup.createdAt)}` : ''}
                    </Text>
                  </View>
                  {/*
                    No "Restore" chip on the row.

                    The chip and the row body now lead to the SAME sheet, so
                    offering both invited the reading that they differ — and a
                    button labelled Restore implies it restores, when it opens a
                    panel to choose from. A chevron says "there is more here",
                    which is what tapping actually does. Restoring is confirmed
                    inside, next to what is being replaced.
                  */}
                  <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
                  <Pressable
                    onPress={() => handleDelete(backup)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${backup.filename}`}
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Ionicons name="trash-outline" size={17} color={colors.inkFaint} />
                  </Pressable>
                </Pressable>
              </View>
            ))}
          </Surface>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <SectionHeading
            icon="time-outline"
            title="Restore"
            subtitle="Replace what is on your board with a saved copy"
          />
          <Surface style={{ gap: space.xs }}>
            <Text variant="small" tone="secondary">
              No backups on this phone yet. Save one above, or copy a backup
              file into {BACKUP_FILES_LOCATION} and it will appear here.
            </Text>
          </Surface>
        </View>
      )}

      {/*
        The "how do I get this onto a new phone" answer, as a labelled card
        rather than a paragraph. It was a wall of grey text at the bottom of the
        screen, which is where explanations go to be ignored.
      */}
      <Surface style={{ gap: space.sm }}>
        <Row gap={space.sm}>
          <Ionicons name="swap-horizontal-outline" size={18} color={colors.inkSecondary} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            Moving to a new phone
          </Text>
        </Row>
        {/*
          Numbered steps, not a paragraph.

          This was one sentence carrying three separate actions — get the file,
          put it in a named folder, then look under Restore — with the folder
          name buried mid-sentence. A person following instructions on a device
          they just set up needs to see where they are up to, which a wall of
          grey text cannot show.
        */}
        <View style={{ gap: 7 }}>
          {[
            `Open the Files app and go to ${BACKUP_FILES_LOCATION}`,
            'Copy your backup file there — from Drive, AirDrop, anywhere',
            'It appears under Restore above, ready to bring back',
          ].map((step, index) => (
            <Row key={step} gap={space.sm} style={{ alignItems: 'flex-start' }}>
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.surfaceSunken,
                  marginTop: 1,
                }}
              >
                <Text variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
                  {index + 1}
                </Text>
              </View>
              <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                {step}
              </Text>
            </Row>
          ))}
        </View>
      </Surface>

      {/*
        The privacy note stands alone.

        It was a divider inside the "moving phones" card, which made a fact
        about EVERY backup look like a footnote to one specific task. It
        belongs to the whole screen, so it reads as the screen's closing line.
      */}
      <Row gap={space.sm} style={{ paddingHorizontal: space.xs, alignItems: 'flex-start' }}>
        <Ionicons name="eye-off-outline" size={15} color={colors.inkMuted} style={{ marginTop: 1 }} />
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          Bank messages waiting for review are never included in a backup.
        </Text>
      </Row>

      <BackupPicker
        open={picking}
        parts={parts}
        label={label}
        onLabel={setLabel}
        onToggle={(key: BackupPartKey) =>
          setParts((current) =>
            current.includes(key)
              ? current.filter((entry) => entry !== key)
              : [...current, key],
          )
        }
        onClose={() => setPicking(false)}
        onConfirm={() => {
          setPicking(false);
          void handleDriveOrLocal();
        }}
      />

      {/*
        ONE sheet for a backup file, not two.

        Tapping a row opened a details panel listing seven parts with their
        counts; tapping its Restore button closed that and opened a picker
        listing the same seven parts with the same counts, now with tickboxes.
        The user read the identical list twice to do one thing, and the second
        sheet threw away the context of the first.

        So the details sheet IS the picker: the counts are the information, the
        ticks are the decision, and they belong on the same rows.
      */}
      {/*
        The Drive folder, listed.

        Read-only apart from delete: restoring FROM Drive would mean
        downloading and validating a file the app has never seen, and the Files
        route already covers that — drop it into the money-manager folder and
        it appears under Restore with the same panel as everything else. This
        sheet answers "what is up there, and can I clear some out?", which is
        what was missing.
      */}
      {driveOpen ? (
        <BottomSheet
          visible
          scroll
          onClose={() => setDriveOpen(false)}
          title="Backups in Drive"
          icon="folder-open-outline"
        >
          {driveBusy ? (
            /*
              Skeleton rows, not a spinner on a line.

              A lone spinner says "something is happening" and nothing else, so
              the sheet appears empty until it resolves and then jumps as rows
              push in. Placeholders in the shape of the real list say what is
              coming and keep the layout still, which makes a slow network feel
              slow rather than broken.
            */
            <View style={{ gap: space.sm }}>
              {/* A placeholder for the count/size header, so the whole sheet
                  holds its shape rather than only the list part. */}
              <Row style={{ alignItems: 'center', paddingHorizontal: space.xs }}>
                <View
                  style={{
                    height: 10,
                    width: 96,
                    borderRadius: 4,
                    backgroundColor: colors.surfaceSunken,
                  }}
                />
                <View style={{ flex: 1 }} />
                <View
                  style={{
                    height: 10,
                    width: 64,
                    borderRadius: 4,
                    backgroundColor: colors.surfaceSunken,
                  }}
                />
              </Row>

              <Surface padded={false} style={{ overflow: 'hidden' }}>
              {/* Enough rows to reach the bottom of the sheet — five filled
                  only the top third, which looked like a short list that had
                  finished loading rather than a page still arriving. */}
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((row) => (
                <View key={row}>
                  {row > 0 ? <Divider /> : null}
                  <Row
                    gap={space.md}
                    style={{
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                      alignItems: 'center',
                      /*
                       * Fades gently down the page rather than to nothing.
                       *
                       * Five rows fill the sheet, so a steep fade would leave
                       * the last two invisible and the page looking half-drawn.
                       * A shallow one reads as "more below", which is what a
                       * folder of backups usually has.
                       */
                      opacity: 1 - row * 0.075,
                    }}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: radius.sm,
                        backgroundColor: colors.surfaceSunken,
                      }}
                    />
                    <View style={{ flex: 1, gap: 6 }}>
                      <View
                        style={{
                          height: 11,
                          width: '55%',
                          borderRadius: 4,
                          backgroundColor: colors.surfaceSunken,
                        }}
                      />
                      <View
                        style={{
                          height: 9,
                          width: '35%',
                          borderRadius: 4,
                          backgroundColor: colors.surfaceSunken,
                        }}
                      />
                    </View>
                  </Row>
                </View>
              ))}
              </Surface>
            </View>
          ) : driveFiles === null || driveFiles.length === 0 ? (
            <Surface style={{ gap: space.xs }}>
              <Text variant="bodyStrong">Nothing in Drive yet</Text>
              <Text variant="small" tone="secondary">
                Back up to Drive and the file appears here, in a folder called
                money-manager.
              </Text>
            </Surface>
          ) : (
            <>
              {/*
                What the folder amounts to, before the rows.

                A bare list answers "which files" but not "how much is up
                there" — and the folder keeps the last few backups, so knowing
                it holds 5 files at 20 KB is what tells someone whether to
                bother clearing any out.
              */}
              <Row style={{ alignItems: 'center', paddingHorizontal: space.xs }}>
                <Label>
                  {driveFiles.length} BACKUP{driveFiles.length === 1 ? '' : 'S'}
                </Label>
                <View style={{ flex: 1 }} />
                <Text variant="caption" tone="muted">
                  {formatDriveSize(
                    String(
                      driveFiles.reduce(
                        (total, file) => total + (Number(file.size) || 0),
                        0,
                      ),
                    ),
                  )}{' '}
                  in total
                </Text>
              </Row>

              <Surface padded={false} style={{ overflow: 'hidden' }}>
                {driveFiles.map((file, index) => (
                  <View key={file.id}>
                    {index > 0 ? <Divider /> : null}
                    <Row
                      gap={space.md}
                      style={{
                        paddingHorizontal: space.lg,
                        paddingVertical: space.md,
                        alignItems: 'center',
                        /*
                         * No tinted band on the newest row.
                         *
                         * The solid green icon and the LATEST tag already mark
                         * it twice; a third signal shaded the whole row and
                         * made the list look like two different kinds of thing
                         * rather than one list with a current entry.
                         */
                      }}
                    >
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: radius.sm,
                          alignItems: 'center',
                          justifyContent: 'center',
                          // Solid on the highlighted row — a soft chip on a
                          // soft band disappears into it.
                          backgroundColor: index === 0 ? colors.completed : colors.accentSoft,
                        }}
                      >
                        <Ionicons
                          name={index === 0 ? 'cloud-done' : 'cloud-outline'}
                          size={17}
                          color={index === 0 ? colors.inkInverse : colors.accent}
                        />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Row gap={6}>
                          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                            {readableStamp(
                              file.name.replace(/^money-manager-/, '').replace(/\.json$/i, ''),
                            )}
                          </Text>
                          {/*
                            The newest one is marked.

                            `listBackupsRequest` orders newest-first, so this is
                            the file someone would actually restore — and with
                            five near-identical rows, "which is the latest?" is
                            otherwise a date-comparison exercise.
                          */}
                          {index === 0 ? (
                            /*
                              Its own tag, not the shared blue `Badge`.

                              On a green band a blue pill fights the row it sits
                              in, and `Badge` is used elsewhere for other things.
                              A solid green chip with a tick reads as one idea
                              with the band and the icon: this is the current one.
                            */
                            <Row
                              gap={3}
                              style={{
                                paddingLeft: 5,
                                paddingRight: 7,
                                paddingVertical: 2,
                                borderRadius: 999,
                                backgroundColor: colors.completed,
                                alignItems: 'center',
                              }}
                            >
                              <Ionicons name="checkmark" size={10} color={colors.inkInverse} />
                              <Text
                                variant="caption"
                                color={colors.inkInverse}
                                style={{ fontWeight: '800', fontSize: 10 }}
                              >
                                LATEST
                              </Text>
                            </Row>
                          ) : null}
                        </Row>
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {formatDriveSize(file.size)}
                          {file.modifiedTime ? ` · ${relativeTime(file.modifiedTime)}` : ''}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => handleDriveDelete(file)}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${file.name} from Drive`}
                        hitSlop={8}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                      >
                        {/* Red: this deletes from Drive, which for a backup
                            uploaded off a lost phone may be the only copy. The
                            theme reserves `danger` for exactly this. */}
                        <Ionicons name="trash-outline" size={17} color={colors.danger} />
                      </Pressable>
                    </Row>
                  </View>
                ))}
              </Surface>

              {/* Says how to get one BACK, since this sheet cannot do it. */}
              <Row gap={space.sm} style={{ alignItems: 'flex-start', paddingHorizontal: space.xs }}>
                <Ionicons
                  name="information-circle-outline"
                  size={15}
                  color={colors.inkMuted}
                  style={{ marginTop: 1 }}
                />
                <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                  To restore one, save it from the Drive app into{' '}
                  {BACKUP_FILES_LOCATION} — it then appears under Restore.
                </Text>
              </Row>
            </>
          )}
        </BottomSheet>
      ) : null}

      <BackupDetails
        entry={inspecting}
        parts={restoreParts}
        onToggle={(key: BackupPartKey) =>
          setRestoreParts((current) =>
            current.includes(key)
              ? current.filter((entry) => entry !== key)
              : [...current, key],
          )
        }
        onPreset={setRestoreParts}
        onClose={() => setInspecting(null)}
        onRestore={(snapshot) => {
          setInspecting(null);
          confirmRestore(snapshot, restoreParts);
        }}
      />
    </BottomSheet>
  );
}

/**
 * What is actually inside a backup file.
 *
 * Exists because the restore list could only say "10 bills · 142 transactions"
 * — enough to tell two very different files apart, useless for two taken a day
 * apart. Restoring REPLACES the board, so the decision deserves the real
 * contents, and the only way to see them used to be to start the restore
 * itself.
 *
 * Reads the file when opened rather than at list time: parsing every backup on
 * every render to fill a panel most people never open is work for nothing, and
 * `listBackups` already pays that cost once for the summary line.
 */
function BackupDetails({
  entry,
  parts,
  onToggle,
  onPreset,
  onClose,
  onRestore,
}: {
  entry: null | { backup: StoredBackup; snapshot: Snapshot | null };
  parts: readonly BackupPartKey[];
  onToggle: (key: BackupPartKey) => void;
  onPreset: (keys: BackupPartKey[]) => void;
  onClose: () => void;
  onRestore: (snapshot: Snapshot) => void;
}) {
  const { colors, space, radius } = useTheme();
  /** Which part is showing its table breakdown — one at a time. */
  const [expanded, setExpanded] = useState<BackupPartKey | null>(null);
  if (!entry) return null;

  const { backup, snapshot } = entry;
  const summary = snapshot ? summariseSnapshot(snapshot) : [];
  /** Parts this file carries — the only ones that can be ticked. */
  const available = summary.filter((part) => part.included).map((part) => part.key);
  const chosen = parts.filter((key) => available.includes(key));

  return (
    <BottomSheet
      visible
      onClose={onClose}
      /*
       * `scroll` for the PADDING as much as the scrolling.
       *
       * The sheet's non-scroll path renders children with no insets at all, so
       * every bare heading sat flush against the screen edge while the cards
       * below carried their own — a ragged left margin down the whole panel.
       * The scroll variant applies the standard padding and gap, and a long
       * enough backup (seven parts plus four file facts) genuinely needs to
       * scroll on a smaller phone anyway.
       */
      scroll
      title={backup.label || readableStamp(backup.createdAt)}
      icon="document-text-outline"
      footer={
        snapshot ? (
          <View style={{ gap: space.sm }}>
        {/*
          The warning sits with the BUTTON, not at the top of the sheet.

          A caution read on arrival is forgotten by the time the user has scrolled
          seven rows and made a decision; next to the action it qualifies, it is
          read at the moment it matters.
        */}
        {snapshot ? (
          <Row
            gap={space.sm}
            style={{
              alignItems: 'flex-start',
              padding: space.md,
              borderRadius: radius.md,
              backgroundColor: colors.pendingSoft,
            }}
          >
            <Ionicons name="alert-circle" size={17} color={colors.pending} style={{ marginTop: 1 }} />
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              What you tick <Text variant="caption" style={{ fontWeight: '700' }}>replaces</Text> that
              part of your board. Anything unticked stays exactly as it is.
            </Text>
          </Row>
        ) : null}

        {/* The action the panel exists to inform. Only offered when the file is
            actually readable — restoring a corrupt snapshot cannot work. */}
        {snapshot ? (
          <GradientButton
            label={
              chosen.length === available.length
                ? 'Restore everything'
                : `Restore ${chosen.length} of ${available.length}`
            }
            icon="arrow-undo-outline"
            disabled={chosen.length === 0}
            onPress={() => onRestore(snapshot)}
          />
        ) : null}
          </View>
        ) : null
      }
    >
      {snapshot === null ? (
        /* A corrupt file still LISTS so it can be deleted — see `listBackups`.
           Saying so plainly beats an empty panel that looks like a bug. */
        <Surface style={{ gap: space.xs }}>
          <Text variant="bodyStrong">This file cannot be read</Text>
          <Text variant="small" tone="secondary">
            It may have been copied incompletely, or written by a much newer
            version of the app. Delete it and take a fresh backup.
          </Text>
        </Surface>
      ) : null}

      {snapshot === null ? null : (
        <View style={{ gap: space.sm }}>
          {/* `paddingRight` so the shortcut clears the sheet edge — without it
              "Setup only" was clipped mid-word. */}
          <Row style={{ alignItems: 'center', paddingRight: space.xs }}>
            <Label>WHAT TO BRING BACK</Label>
            <View style={{ flex: 1 }} />
            {/* One tap for the two selections people actually want, rather
                than seven taps to clear history off a full backup. */}
            <Pressable
              onPress={() =>
                onPreset(
                  chosen.length === available.length
                    ? available.filter((key) => key !== 'history')
                    : [...available],
                )
              }
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                {chosen.length === available.length ? 'Setup only' : 'Select all'}
              </Text>
            </Pressable>
          </Row>
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          {summary.map((part, index) => {
            const ticked = part.included && parts.includes(part.key);
            // `core` travels with every restore, so it cannot be unticked.
            const locked = !part.included || part.key === 'core';

            const open = expanded === part.key;

            return (
            <View key={part.key}>
              {index > 0 ? <Divider /> : null}
              {/*
                Two targets in one row: the TICK decides, the row EXPANDS.

                They are different questions — "bring this back?" versus "what
                is in it?" — and binding both to one tap meant a user who wanted
                to look first had to toggle their own selection to find out.
              */}
              <Pressable
                onPress={() => setExpanded(open ? null : part.key)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${part.label} details`}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.6 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  paddingHorizontal: space.lg,
                  paddingVertical: 12,
                })}
              >
                <Pressable
                  onPress={() => {
                    if (!locked) onToggle(part.key);
                  }}
                  disabled={locked}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ticked, disabled: locked }}
                  accessibilityLabel={part.label}
                  hitSlop={10}
                  style={({ pressed }) => ({ opacity: pressed && !locked ? 0.5 : 1 })}
                >
                {/*
                  A tick, an empty ring, or a dash.

                  Parts the file does NOT carry are the most important thing
                  about a selective backup — "this one has no transactions" is
                  exactly what someone needs before restoring it over a board
                  that does. Omitting those rows would leave them to notice an
                  absence, which nobody does reliably.
                */}
                <Ionicons
                  name={
                    !part.included
                      ? 'remove-circle-outline'
                      : ticked
                        ? 'checkmark-circle'
                        : 'ellipse-outline'
                  }
                  size={20}
                  color={
                    !part.included
                      ? colors.inkFaint
                      : ticked
                        ? colors.accent
                        : colors.inkMuted
                  }
                />
                </Pressable>
                <Text
                  variant="small"
                  tone={part.included ? undefined : 'muted'}
                  style={{ flex: 1 }}
                >
                  {part.label}
                </Text>
                <Text
                  variant="caption"
                  tone={part.included ? 'secondary' : 'muted'}
                  style={{ fontWeight: part.included ? '700' : '400' }}
                >
                  {part.included ? part.count.toLocaleString() : 'Not included'}
                </Text>
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={13}
                  color={colors.inkFaint}
                />
              </Pressable>

              {/*
                What the part is actually MADE OF.

                A part is a bundle — "Transactions & history" is five tables —
                so its single number hides its contents. "142 of what?" is a
                fair question when the answer decides whether to overwrite a
                board, and the file's own counts already hold it.
              */}
              {open ? (
                <View
                  style={{
                    paddingLeft: space.lg + 28,
                    paddingRight: space.lg,
                    paddingBottom: 12,
                    gap: 5,
                  }}
                >
                  {part.tables.map((table) => (
                    <Row key={table.label} gap={space.sm}>
                      <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                        {table.label}
                      </Text>
                      <Text variant="caption" tone="secondary">
                        {table.count.toLocaleString()}
                      </Text>
                    </Row>
                  ))}
                </View>
              ) : null}
            </View>
            );
          })}
        </Surface>
        </View>
      )}

    </BottomSheet>
  );
}

/** Bytes as something a person can read — files here run KB to a few MB. */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Choose what a backup contains, or what a restore brings back.
 *
 * One component for both, because they are the same question asked twice and
 * two near-identical sheets would inevitably drift apart. What differs is the
 * verb and whether a name field is shown — you name a backup, you do not name a
 * restore.
 *
 * Every part states what it IS in the user's words ("Categories & bills"), not
 * the table it maps to. Someone deciding what to keep cannot reason about
 * `subcategory_states`.
 */
function BackupPicker({
  open,
  parts,
  label,
  onLabel,
  onToggle,
  onClose,
  onConfirm,
}: {
  open: boolean;
  parts: readonly BackupPartKey[];
  label: string;
  onLabel: (next: string) => void;
  onToggle: (key: BackupPartKey) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { colors, radius, space } = useTheme();
  if (!open) return null;

  /** A backup is taken from the live board, so every part is available. */
  const available = ALL_PARTS;

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title="Back up what?"
      icon="cloud-upload-outline"
      iconColor={colors.accent}
      scroll
      footer={
        <GradientButton
          label="Back up selected"
          icon="cloud-upload-outline"
          onPress={onConfirm}
          disabled={parts.length === 0}
        />
      }
    >
      <Text variant="small" tone="secondary">
        Tick what this backup should include. Leaving history out makes a small
        file you can reuse as a starting plan.
      </Text>

      {/*
        Presets on BOTH sheets.

        They were backup-only, so choosing "just my setup" on a restore meant
        seven individual taps — the one flow where the user is most likely to
        want exactly that, moving a plan to a new phone without last year's
        transactions. The same two shortcuts serve both questions.
      */}
      <Row gap={space.sm}>
        <Preset
          label="Everything"
          active={available.every((key) => parts.includes(key))}
          onPress={() => {
            for (const key of available) if (!parts.includes(key)) onToggle(key);
          }}
        />
        <Preset
          label="Setup only"
          active={!parts.includes('history') && parts.length > 0}
          onPress={() => {
            if (parts.includes('history')) onToggle('history');
            for (const key of SETUP_PARTS) {
              if (available.includes(key) && !parts.includes(key)) onToggle(key);
            }
          }}
        />
      </Row>

      <Surface padded={false} style={{ overflow: 'hidden' }}>
        {BACKUP_PARTS.map((part, index) => {
          const missing = !available.includes(part.key);
          const ticked = parts.includes(part.key) && !missing;
          const locked = part.required || missing;

          return (
            <View key={part.key}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                onPress={() => {
                  if (locked) return;
                  onToggle(part.key);
                }}
                disabled={locked}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: ticked, disabled: locked }}
                accessibilityLabel={part.label}
                style={({ pressed }) => ({
                  opacity: pressed && !locked ? 0.6 : missing ? 0.45 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                })}
              >
                <Ionicons
                  name={
                    missing
                      ? 'remove-circle-outline'
                      : ticked
                        ? 'checkmark-circle'
                        : 'ellipse-outline'
                  }
                  size={22}
                  color={ticked ? colors.accent : colors.inkMuted}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{part.label}</Text>
                  <Text variant="caption" tone="muted">
                    {missing ? 'Not in this backup' : part.required ? 'Always included' : part.hint}
                  </Text>
                </View>
              </Pressable>
            </View>
          );
        })}
      </Surface>

      {/* Naming, so a list of backups is readable a month later. */}
      <View style={{ gap: space.sm }}>
          <Label>NAME THIS BACKUP (OPTIONAL)</Label>
          <TextInput
            value={label}
            onChangeText={onLabel}
            placeholder="e.g. before 2027 reset"
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel="Backup name"
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              paddingHorizontal: space.md,
              paddingVertical: 13,
              fontSize: 15,
              letterSpacing: 0,
              color: colors.ink,
            }}
          />
      </View>
    </BottomSheet>
  );
}

/** A preset chip — the two selections almost everybody wants. */
function Preset({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        flex: 1,
        alignItems: 'center',
        paddingVertical: 9,
        borderRadius: radius.md,
        backgroundColor: active ? colors.accent : colors.surface,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.hairline,
      })}
    >
      <Text
        variant="caption"
        color={active ? colors.inkInverse : colors.inkSecondary}
        style={{ fontWeight: '700' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A tappable row that shows a spinner in place of its icon while working. */
function ActionRow({
  icon,
  label,
  sublabel,
  busy,
  busyLabel,
  onPress,
  emphasis = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  busy: boolean;
  /** What is happening, replacing the label while `busy`. */
  busyLabel?: string | null;
  onPress: () => void;
  /** Tint the row, for the one action a section is really offering. */
  emphasis?: boolean;
}) {
  const { colors, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        opacity: pressed || busy ? 0.7 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        backgroundColor: emphasis ? colors.accentSoft : 'transparent',
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Ionicons name={icon} size={20} color={colors.accent} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color={emphasis ? colors.accent : undefined}>
          {busy ? (busyLabel ?? 'Working…') : label}
        </Text>
        {sublabel && !busy ? (
          <Text variant="caption" tone="muted">
            {sublabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * A section heading: icon, title, and a line saying why the section exists.
 *
 * Replaces a bare uppercase `Label`. "BACK UP" names a section but explains
 * nothing; someone who does not already know the difference between a cloud
 * backup and a local file gets no help from it, and this screen exists largely
 * for people in exactly that position.
 */
function SectionHeading({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}) {
  const { colors, space } = useTheme();

  return (
    <View style={{ gap: 2, marginTop: space.xs }}>
      <Row gap={space.sm}>
        <Ionicons name={icon} size={18} color={colors.inkSecondary} />
        <Text variant="heading" style={{ flex: 1 }}>
          {title}
        </Text>
      </Row>
      <Text variant="caption" tone="muted">
        {subtitle}
      </Text>
    </View>
  );
}

/** A small uppercase pill — "RECOMMENDED" beside the option worth taking. */
function Badge({ label }: { label: string }) {
  const { colors, space } = useTheme();

  return (
    <View
      style={{
        paddingHorizontal: space.xs,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: colors.accentSoft,
      }}
    >
      <Text variant="caption" color={colors.accent} style={{ fontWeight: '800', fontSize: 10 }}>
        {label}
      </Text>
    </View>
  );
}

/** A coloured dot plus a word — connected/disconnected at a glance. */
function StatusDot({ color, label }: { color: string; label: string }) {
  const { space } = useTheme();

  return (
    <Row gap={4} style={{ paddingHorizontal: space.xs }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text variant="caption" color={color} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Row>
  );
}

/**
 * The Google "G", as the real four-colour mark.
 *
 * Drawn as SVG paths rather than approximated with coloured views: an earlier
 * version used four quadrants behind a white circle, which at 20pt read as a
 * generic colour wheel rather than as Google — verified on the simulator. The
 * mark is the single element that makes a sign-in button recognisable, so a
 * rough stand-in defeats the purpose of having one.
 *
 * `react-native-svg` is already a dependency, so this costs no new package and
 * no bundled image asset.
 */
function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

/** The later of two optional timestamps. */
function newest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * "2 hours ago" — the form that answers "am I covered?" at a glance.
 *
 * An absolute date makes the reader do the subtraction themselves, which is
 * exactly the work this line exists to save. The exact moment sits underneath
 * for anyone who wants certainty.
 */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'recently';

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** The exact moment, for anyone who wants certainty rather than a rough age. */
function absoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Turn a filename stamp ("2026-08-04T12-00-00") into something readable. */
function readableStamp(stamp: string): string {
  const iso = stamp.replace(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/,
    '$1-$2-$3T$4:$5:$6',
  );
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? stamp : absoluteTime(date.toISOString());
}
