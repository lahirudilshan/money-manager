import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import Constants from 'expo-constants';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { BottomSheet, Divider, Label, Row, Surface, Text } from '../../src/components/ui';
import {
  describeScope,
  serialiseSnapshot,
  snapshotFilename,
  validateSnapshot,
  type RestoreScope,
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
  driveBlocker,
  isDriveAvailable,
  isSignedIn,
  signIn,
  signOut,
  uploadBackup,
} from '../../src/services/googleDrive';
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
    const snapshot = exportSnapshot(appVersion);
    const result = await uploadBackup(
      snapshotFilename(new Date(snapshot.createdAt)),
      serialiseSnapshot(snapshot),
    );

    if (!result.ok) {
      Alert.alert('Backup failed', result.error ?? 'The upload did not complete.');
      return;
    }

    settingsRepo.set(SETTINGS_KEYS.lastCloudBackupAt, result.uploadedAt ?? new Date().toISOString());
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
    }
  }

  async function handleDriveBackup() {
    setBusy('drive');
    try {
      await runDriveBackup();
    } finally {
      setBusy(null);
    }
  }

  function handleLocalBackup() {
    setBusy('local');
    try {
      const result = saveBackup(exportSnapshot(appVersion));

      if (!result.ok) {
        Alert.alert('Could not save', result.error ?? 'The file could not be written.');
        return;
      }

      settingsRepo.set(SETTINGS_KEYS.lastLocalBackupAt, new Date().toISOString());
      reload();
    } finally {
      setBusy(null);
    }
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
  function handleRestore(backup: StoredBackup) {
    const snapshot = readBackup(backup.filename);

    if (!snapshot) {
      Alert.alert('Cannot read that file', 'It may be damaged or not a backup.');
      return;
    }

    const validation = validateSnapshot(snapshot);
    if (!validation.ok) {
      Alert.alert('That backup is not usable', validation.problems.join('\n\n'));
      return;
    }

    Alert.alert(
      'What should we restore?',
      `Setup only — ${describeScope(snapshot, 'setup')}.\n\n` +
        `Everything — ${describeScope(snapshot, 'everything')}.\n\n` +
        'Either way, what is on your board now will be replaced.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Setup only', onPress: () => confirmRestore(snapshot, 'setup') },
        {
          text: 'Everything',
          style: 'destructive',
          onPress: () => confirmRestore(snapshot, 'everything'),
        },
      ],
    );
  }

  function confirmRestore(snapshot: Snapshot, scope: RestoreScope) {
    const result = restoreSnapshot(snapshot, scope);

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
      scope === 'setup'
        ? 'Your accounts, houses and budget lines are back. No transactions were added.'
        : 'Your board has been replaced with the backup.',
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
          backgroundColor: lastAny ? colors.completedSoft : colors.pendingSoft,
        }}
      >
        <Row gap={space.sm}>
          <Ionicons
            name={lastAny ? 'shield-checkmark' : 'alert-circle'}
            size={26}
            color={lastAny ? colors.completed : colors.pending}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading">
              {lastAny ? `Backed up ${relativeTime(lastAny)}` : 'Not backed up yet'}
            </Text>
            <Text variant="small" tone="secondary">
              {lastAny
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
              <ActionRow
                icon="cloud-upload-outline"
                label="Back up to Drive now"
                busy={busy === 'drive'}
                onPress={() => void handleDriveBackup()}
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
            sublabel={
              lastLocal
                ? `Last saved ${relativeTime(lastLocal)}`
                : 'Also share it to Drive or AirDrop from Files'
            }
            busy={busy === 'local'}
            onPress={handleLocalBackup}
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
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                  }}
                >
                  <Ionicons name="document-text-outline" size={20} color={colors.inkMuted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {readableStamp(backup.createdAt)}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {backup.summary || 'Could not read this file'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleRestore(backup)}
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${backup.filename}`}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.6 : 1,
                      paddingHorizontal: space.md,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: colors.hairline,
                    })}
                  >
                    <Text variant="caption" color={colors.accent}>
                      Restore
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(backup)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${backup.filename}`}
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.inkMuted} />
                  </Pressable>
                </View>
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
        <Text variant="small" tone="secondary">
          Put the backup file into {BACKUP_FILES_LOCATION} with the Files app —
          from Drive, AirDrop, or anywhere else — and it appears under Restore
          above.
        </Text>
        <Divider />
        <Row gap={space.sm}>
          <Ionicons name="eye-off-outline" size={16} color={colors.inkMuted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Bank messages waiting for review are never included in a backup.
          </Text>
        </Row>
      </Surface>

    </BottomSheet>
  );
}

/** A tappable row that shows a spinner in place of its icon while working. */
function ActionRow({
  icon,
  label,
  sublabel,
  busy,
  onPress,
  emphasis = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  busy: boolean;
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
          {busy ? 'Working…' : label}
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
