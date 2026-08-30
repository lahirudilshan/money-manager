import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { File } from 'expo-file-system';
import Svg, { Path } from 'react-native-svg';
import {
  Divider,
  GradientButton,
  Label,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import {
  ALL_PARTS,
  describeSnapshot,
  parseSnapshot,
  partsOf,
  stampToIso,
  titleFor,
  validateSnapshot,
  type Snapshot,
} from '~/features/backup/logic/backup';
import { formatSize as formatDriveSize, type DriveFile } from '~/features/backup/logic/driveSync';
import { restoreSnapshot } from '~/features/backup/logic/backupRepo';
import { listBackups, readBackup, type StoredBackup } from '~/features/backup/logic/backupFile';
import {
  downloadDriveBackup,
  driveBlocker,
  isDriveAvailable,
  isSignedIn,
  connectedAccount,
  listDriveBackupsResult,
  signIn,
  signOut,
} from '~/features/backup/logic/googleDrive';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * The very first screen: start fresh, or bring back an existing backup.
 *
 * ## Why this comes before anything else
 *
 * Onboarding used to open on "pick your banks" — six screens of building a plan
 * from scratch. For the single most important case that is exactly backwards:
 * someone setting up a NEW PHONE already has a plan, and asking them to rebuild
 * it before they can restore it is asking them to do work that is about to be
 * thrown away. Worse, the restore screen lived in Settings, behind an
 * onboarding flow they had to complete first — so the feature that exists for
 * this moment was unreachable at this moment.
 *
 * So the fork is the first question, and restoring skips the rest of setup
 * entirely: a restored board is already configured, and walking someone through
 * choosing categories they already have would overwrite the very thing they
 * just brought back.
 *
 * ## Why both sources are offered here
 *
 * A new phone has nothing in its local Documents folder by definition, so Drive
 * is the case that matters — but the local list is what someone who AirDropped
 * a file across, or is reinstalling on the same device, will use. Showing only
 * one of them would strand half the people this screen exists for.
 */
export default function OnboardingWelcomeScreen() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const refresh = useAppStore((state) => state.refresh);
  const completeOnboarding = useAppStore((state) => state.completeOnboarding);

  const [localBackups, setLocalBackups] = useState<StoredBackup[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  /** Why the Drive listing is empty, when it is empty for a reason. */
  const [driveError, setDriveError] = useState<string | null>(null);
  /** The connected account's email, once known. Null while loading, or if the
   *  lookup failed — the row falls back to a generic label rather than break. */
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'drive' | 'restore'>(null);

  const driveAvailable = isDriveAvailable();
  /*
   * WHY Drive is unavailable, when it is.
   *
   * The strip used to be hidden outright on `!driveAvailable`, which made a
   * missing native module indistinguishable from a working app that simply had
   * no backups — the screen looked identical either way and gave the user
   * nothing to act on. Naming the reason is the difference between "this app
   * cannot do that" and "rebuild to switch it on".
   */
  const blocker = driveBlocker();

  /**
   * Load the Drive listing, keeping WHY it failed.
   *
   * An empty array cannot say whether the account holds no backups or whether
   * we could not look — and this screen states one of those as fact. Telling
   * someone mid-restore that their Drive folder is empty, when really their
   * sign-in expired, is the worst version of this bug: a new phone has nothing
   * local to fall back on, so that sentence reads as "your data is gone".
   */
  const refreshDrive = useCallback(async () => {
    setBusy('drive');
    try {
      const result = await listDriveBackupsResult();
      setDriveFiles(result.files);
      setDriveError(result.ok ? null : (result.error ?? null));
      // Alongside the listing, so the row can name the account rather than
      // saying only that SOME account is connected.
      if (result.ok) void connectedAccount().then(setAccount);
      // A dead refresh token signs the account out inside `accessToken`, so the
      // screen must fall back to offering sign-in rather than claiming a
      // connection it no longer has.
      if (result.signedOut) setSignedIn(false);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    setLocalBackups(listBackups());

    // A device that is already signed in — a reinstall rather than a new phone
    // — should not have to tap "connect" again just to see its own backups.
    void isSignedIn().then((yes) => {
      setSignedIn(yes);
      if (yes) void refreshDrive();
    });
  }, [refreshDrive]);

  async function connectDrive() {
    setBusy('drive');
    try {
      const result = await signIn();
      if (!result.ok) {
        // Cancelling is a choice, not a failure, and must not be reported as one.
        if (result.error && !/cancel/i.test(result.error)) {
          Alert.alert('Could not connect', result.error);
        }
        return;
      }
      setSignedIn(true);
      setDriveError(null);
      await refreshDrive();
    } finally {
      setBusy(null);
    }
  }

  /**
   * Sign out and straight back in, to reach a DIFFERENT Google account.
   *
   * Signing out first is what makes the account chooser appear: Google skips it
   * and reuses the existing grant otherwise, so "switch" would silently return
   * the same account and look broken.
   *
   * The local list is untouched — those files live on the phone and have
   * nothing to do with which account is connected.
   */
  async function switchAccount() {
    setBusy('drive');
    try {
      await signOut();
      setSignedIn(false);
      setDriveFiles(null);
      setDriveError(null);
      setAccount(null);
    } finally {
      setBusy(null);
    }
    await connectDrive();
  }

  /**
   * Bring a snapshot back, then leave onboarding entirely.
   *
   * Restores EVERYTHING the file holds (`partsOf`) rather than offering the
   * part picker the Settings screen has. At this point the board is empty, so
   * there is nothing a partial restore could protect — and a choice with no
   * consequence is a question that should not be asked. Someone who wants a
   * selective restore can do it from Settings afterwards.
   */
  function applyRestore(snapshot: Snapshot, label: string) {
    const validation = validateSnapshot(snapshot);
    if (!validation.ok) {
      Alert.alert('That backup is not usable', validation.problems.join('\n\n'));
      return;
    }

    const result = restoreSnapshot(snapshot, partsOf(snapshot));
    if (!result.ok) {
      Alert.alert(
        'Restore failed',
        `${result.error ?? 'Unknown error.'}\n\nNothing was changed.`,
      );
      return;
    }

    /*
     * Mark setup finished, or the app bounces straight back here.
     *
     * `needsOnboarding` is what routes into this flow, and a restored board is
     * by definition already set up — leaving the flag set would trap someone in
     * onboarding with a full board behind it.
     */
    completeOnboarding();
    refresh();

    Alert.alert('Restored', `${label} is back. Welcome back.`, [
      { text: 'Open my board', onPress: () => router.replace('/(tabs)') },
    ]);
  }

  /**
   * Restore a file the user picks from ANYWHERE on the phone.
   *
   * The list below only shows what is already in the app's own Documents
   * folder, so a backup sitting in iCloud Drive, Downloads, or just received
   * over AirDrop was unreachable — the screen told people to copy it across in
   * the Files app first, which is a detour at the exact moment they are trying
   * to get their data back.
   *
   * Goes through the same `applyRestore` as every other path, so a picked file
   * gets the same validation gate: a corrupt or foreign JSON is refused before
   * anything is written.
   */
  async function restoreFromFile() {
    /*
     * Probe the NATIVE registry before requiring the JS wrapper.
     *
     * `expo-document-picker` calls `requireNativeModule` at module scope, which
     * throws on a binary built before this dependency was added — and that
     * throw does not reliably land in a try/catch around `require`, because
     * Metro evaluates the failing module outside this call stack. Same lesson
     * as `expo-web-browser` in googleDrive.ts. Checking the registry asks the
     * question that matters — is it in this binary — without evaluating
     * anything that can throw.
     */
    const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
    if (!registry?.ExpoDocumentPicker) {
      Alert.alert(
        'Not available in this build',
        'Choosing a file needs a rebuild of the app. Sign in with Google, or copy your backup into the money-manager folder in Files.',
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker');

    setBusy('restore');
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        // Not `application/json`: iOS types a file by its extension only when
        // it recognises it, and a backup that arrived over AirDrop is often
        // typed as generic data — which would grey it out in the picker.
        type: ['application/json', 'public.json', 'public.data'],
        copyToCacheDirectory: true,
      });

      if (picked.canceled) return;

      const file = picked.assets?.[0];
      if (!file) return;

      // `textSync`, matching backupFile.ts — the picker already copied the
      // file into the cache, so this is a local read.
      const contents = new File(file.uri).textSync();
      const snapshot = parseSnapshot(contents);
      if (!snapshot) {
        Alert.alert(
          'That file is not a backup',
          'It could not be read as a money-manager backup. Pick the .json file you saved from this app.',
        );
        return;
      }

      applyRestore(snapshot, file.name ?? 'Your backup');
    } catch {
      Alert.alert('Could not open that file', 'Try picking it again.');
    } finally {
      setBusy(null);
    }
  }

  function restoreLocal(backup: StoredBackup) {
    const snapshot = readBackup(backup.filename);
    if (!snapshot) {
      Alert.alert('That backup is not usable', 'The file could not be read.');
      return;
    }
    applyRestore(snapshot, backup.label || 'Your backup');
  }

  async function restoreFromDrive(file: DriveFile) {
    setBusy('restore');
    try {
      const result = await downloadDriveBackup(file.id);
      if (!result.ok || !result.contents) {
        Alert.alert('Could not open it', result.error ?? 'The download did not complete.');
        return;
      }

      const snapshot = parseSnapshot(result.contents);
      if (!snapshot) {
        Alert.alert('That backup is not usable', 'The file could not be read as a backup.');
        return;
      }
      applyRestore(snapshot, 'Your backup');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Every backup the user can reach, from both sources, newest first.
   *
   * Merged rather than shown as two cards, because the question being asked is
   * "which copy is the most recent one?" and two separately-sorted lists cannot
   * answer it — someone restoring a phone would have to compare dates across
   * headings by eye. Each row still says where it came from, so the choice
   * between a cloud copy and a local file stays visible; it just is not the
   * axis the list is organised on.
   *
   * The same shape the Settings restore screen uses, deliberately: two
   * different orderings of the same backups in two places is how one of them
   * ends up quietly wrong.
   */
  const rows = useMemo(() => {
    const local = localBackups.map((backup) => ({
      key: `local:${backup.filename}`,
      source: 'local' as const,
      // Name then moment — see `titleFor`. This is the screen where picking the
      // wrong copy overwrites a fresh board, so two rows must never read alike.
      title: titleFor(backup.label, backup.createdAt),
      detail: backup.summary || 'Could not read this file',
      sortKey: stampToIso(backup.createdAt),
      backup,
      file: undefined as DriveFile | undefined,
    }));

    const drive = (driveFiles ?? []).map((file) => ({
      key: `drive:${file.id}`,
      source: 'drive' as const,
      /*
       * The user's own name leads, as it does everywhere else. This showed the
       * timestamp unconditionally, so a backup the user had carefully named
       * appeared here as a bare date with the name nowhere on the screen.
       */
      title: titleFor(
        file.description?.trim(),
        file.name.replace(/^money-manager-/, '').replace(/\.json$/i, ''),
      ),
      // Drive cannot say what is INSIDE without downloading it, so the row
      // shows size instead of the contents summary a local row carries.
      detail: formatDriveSize(file.size),
      sortKey: file.modifiedTime,
      backup: undefined as StoredBackup | undefined,
      file,
    }));

    return [...local, ...drive].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [localBackups, driveFiles]);

  const hasSomethingToRestore = rows.length > 0;

  return (
    <Screen
      title="Welcome"
      footer={
        /*
         * Starting fresh is the FOOTER action, not a card in the list.
         *
         * It is the fallback, not the recommendation: someone with a backup
         * should restore it, and someone without one reaches this button
         * anyway. Putting it in the pinned footer keeps it one tap away
         * without competing with the backups above it.
         */
        <GradientButton
          /*
           * The label follows the branch the user is on.
           *
           * Before signing in this button is the SKIP — "I have no backup,
           * take me to setup". Once backups are listed it is the fallback for
           * someone who decided not to restore any of them. Same destination,
           * but "Skip and set up" answers the question actually on screen.
           */
          label={signedIn || rows.length > 0 ? 'Set up a new plan' : 'Skip and set up a new plan'}
          icon="sparkles-outline"
          // `/onboarding` IS the index route — expo-router does not resolve an
          // explicit `/index` segment, which would push a route that does not
          // exist and leave the button dead.
          onPress={() => router.push('/onboarding')}
        />
      }
    >
      <View style={{ gap: space.sm, paddingTop: space.sm }}>
        <Text variant="title">Already using this app?</Text>
        <Text variant="small" tone="secondary">
          If you have a backup from another phone, bring it back now — your
          accounts, bills and history return exactly as they were. Otherwise
          set up a new plan below.
        </Text>
      </View>

      {/*
        STEP 1 — connect Google, or skip.

        The screen asks one question at a time. Someone restoring a new phone
        signs in and gets their Drive backups; someone starting fresh skips and
        goes to setup. Showing a sign-in button, a list of local files and a
        "new plan" button all at once made three different journeys compete for
        the same glance.

        Rendered whenever Drive is CONFIGURED — the strip states its own
        blocker rather than vanishing, because a hidden button and a broken one
        look identical to someone who knows their backups are in Drive.
      */}
      {!signedIn ? (
        /*
         * Google's own button shape: white ground, hairline border, the "G"
         * at the left of centred label text. People recognise it as "this
         * opens Google and is safe", which a generic row with a chevron does
         * not communicate — and this button hands an account to a third party,
         * so looking like what it is matters more than matching our own rows.
         */
        <Pressable
          onPress={() => (driveAvailable ? void connectDrive() : undefined)}
          disabled={busy !== null || !driveAvailable}
          accessibilityRole="button"
          accessibilityLabel="Sign in with Google to find your backups"
          style={({ pressed }) => ({
            opacity: pressed || busy !== null ? 0.7 : driveAvailable ? 1 : 0.55,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.md,
            paddingHorizontal: space.lg,
            height: 52,
            borderRadius: radius.md,
            // Google's guidance is a white button in both themes; on a dark
            // ground it keeps the surface colour so it does not glare.
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairlineStrong,
          })}
        >
          {busy === 'drive' ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <GoogleMark size={20} />
          )}
          <Text variant="bodyStrong">
            {busy === 'drive' ? 'Looking for backups…' : 'Sign in with Google'}
          </Text>
        </Pressable>
      ) : null}

      {/* Why the button is there, or why it cannot be used — kept OUT of the
          button so its face stays the standard Google one. */}
      {!signedIn ? (
        <Text variant="caption" tone="muted" style={{ paddingHorizontal: space.xs }}>
          {driveAvailable
            ? 'To find backups saved from your old phone'
            : blocker === 'needs-rebuild'
              ? 'Ready — rebuild the app to switch this on'
              : 'Not set up in this build'}
        </Text>
      ) : null}

      {/*
        The other way in: a file the user already has.

        Offered ALONGSIDE Google rather than below the list, because it is the
        second half of the same question — "where is your backup?" — and someone
        whose copy came over AirDrop or sits in iCloud Drive has no Google
        account to sign into. Without it the screen's only answer was to open
        the Files app, copy the file into the app's folder, and come back.
      */}
      <Pressable
        onPress={() => void restoreFromFile()}
        disabled={busy !== null}
        accessibilityRole="button"
        accessibilityLabel="Choose a backup file from this phone"
        style={({ pressed }) => ({
          opacity: pressed || busy !== null ? 0.7 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.hairline,
        })}
      >
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
          <Ionicons name="folder-open-outline" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Choose a backup file</Text>
          <Text variant="caption" tone="muted">
            From iCloud Drive, Files, or one someone sent you
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
      </Pressable>

      {/*
        Signed in — name the ACCOUNT, and offer the way out of the wrong one.

        The email is the point: someone with a personal and a work account
        cannot tell which one the phone signed them into, and "Signed in to
        Google" beside an empty backup list is indistinguishable from having no
        backups at all. Naming it turns a dead end into an obvious next step.
      */}
      {signedIn ? (
        <Row
          gap={space.md}
          style={{
            alignItems: 'center',
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
          }}
        >
          <DriveMark size={20} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text variant="small" numberOfLines={1}>
              {account ?? 'Signed in to Google'}
            </Text>
            <Text variant="caption" tone="muted">
              Google Drive connected
            </Text>
          </View>
          {busy === 'drive' ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Pressable
              onPress={() => void switchAccount()}
              accessibilityRole="button"
              accessibilityLabel="Use a different Google account"
              hitSlop={8}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                paddingHorizontal: space.sm,
                paddingVertical: 4,
                borderRadius: radius.sm,
                backgroundColor: colors.surfaceSunken,
              })}
            >
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                Switch
              </Text>
            </Pressable>
          )}
        </Row>
      ) : null}

      {/*
        STEP 2 — the backups themselves, from both sources, newest first.

        One list rather than a Drive card above a local card: the question is
        "which is the most recent copy?", and answering it across two headings
        means comparing dates by eye. The row's own mark says where each lives.
      */}
      {rows.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>YOUR BACKUPS</Label>
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {rows.map((row, index) => (
              <View key={row.key}>
                {index > 0 ? <Divider /> : null}
                <BackupRow
                  title={row.title}
                  detail={row.detail}
                  drive={row.source === 'drive'}
                  latest={index === 0}
                  busy={busy === 'restore'}
                  onPress={() =>
                    row.source === 'drive'
                      ? void restoreFromDrive(row.file!)
                      : restoreLocal(row.backup!)
                  }
                />
              </View>
            ))}
          </Surface>
          <Text variant="caption" tone="muted" style={{ paddingHorizontal: space.xs }}>
            Restoring brings back everything in the file — accounts, bills and
            history — and takes you straight to your board.
          </Text>
        </View>
      ) : null}

      {/*
        Why the Drive list is empty — the folder really is, or we could not
        read it. Silence here reads as "still loading" to someone who knows
        they have a backup, and claiming the folder is empty after a FAILED
        listing tells them their data is gone at the one moment they have
        nothing local to fall back on.
      */}
      {driveError && busy !== 'drive' ? (
        <Row gap={space.sm} style={{ alignItems: 'flex-start', paddingHorizontal: space.xs }}>
          <DriveMark size={15} />
          <Text variant="caption" color={colors.pending} style={{ flex: 1 }}>
            {driveError}
          </Text>
        </Row>
      ) : signedIn && driveFiles !== null && driveFiles.length === 0 && busy !== 'drive' ? (
        <Row gap={space.sm} style={{ alignItems: 'flex-start', paddingHorizontal: space.xs }}>
          <DriveMark size={15} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            No backups in this Google account&apos;s money-manager folder.
          </Text>
        </Row>
      ) : null}

      {/*
        Says where else to look, when nothing was found.

        Someone who KNOWS they have a backup and sees an empty screen needs the
        next step, not silence — and the Files-app route is how a backup moved
        by AirDrop or from another cloud gets here.
      */}
      {!hasSomethingToRestore ? (
        <Row gap={space.sm} style={{ alignItems: 'flex-start', paddingHorizontal: space.xs }}>
          <Ionicons
            name="information-circle-outline"
            size={15}
            color={colors.inkMuted}
            style={{ marginTop: 1 }}
          />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Have a backup file? Copy it into the app's folder using the Files
            app and it will appear here. You can also restore later from
            Settings.
          </Text>
        </Row>
      ) : null}
    </Screen>
  );
}

/** One restorable backup. */
function BackupRow({
  title,
  detail,
  drive = false,
  latest = false,
  busy,
  onPress,
}: {
  title: string;
  detail: string;
  drive?: boolean;
  /** The newest copy across both sources — the one most people want. */
  latest?: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Restore ${title}${latest ? ', most recent backup' : ''}`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
        opacity: busy ? 0.6 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: drive ? '#0066DA14' : colors.accentSoft,
        }}
      >
        {drive ? (
          <DriveMark size={17} />
        ) : (
          /* The Files app's blue folder — where a local backup actually lives
             ("On My iPhone → money-manager"), so the row points at the place
             the user would go to find it. */
          <FilesMark size={18} />
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Row gap={6}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </Text>
          {/*
            The newest copy, marked.

            The list is sorted newest-first, but with several backups a few days
            apart "which is the most recent?" is otherwise a date-comparison
            exercise — and on a new phone it is the one question being asked.
          */}
          {latest ? (
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
          {detail}
        </Text>
      </View>
      <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
        Restore
      </Text>
    </Pressable>
  );
}

/**
 * The Google "G", for the SIGN-IN row.
 *
 * Deliberately not Drive's triangle: signing in is about the account, and the
 * folder's logo belongs on the files that came out of it. Same paths as the
 * backup screen uses, so the two screens agree on what Google looks like.
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

/**
 * The iOS Files app's blue folder, for a backup stored on the phone.
 *
 * A local file lives at "On My iPhone → money-manager", and the Files app is
 * literally where the user would go to find or move it — so its own mark says
 * where the row points far better than a generic document glyph, which read as
 * the same "some file" as everything else on the screen.
 */
function FilesMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {/* Back tab, a shade darker so the folder reads as two surfaces. */}
      <Path fill="#2C8FF7" d="M4 12a4 4 0 0 1 4-4h11l4 5h13a4 4 0 0 1 4 4v3H4z" />
      {/* Front face. */}
      <Path fill="#5AC8FA" d="M4 17h40v19a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
    </Svg>
  );
}

/** Drive's own mark — same paths as the backup screen uses. */
function DriveMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#0066DA" d="M6.6 39.2 2.3 31.7c-.4-.7-.4-1.6 0-2.3L15.6 6.5l8.6 15L10.9 44.6a2.6 2.6 0 0 1-.9-.9L6.6 39.2z" />
      <Path fill="#00AC47" d="M45.7 29.4 32.4 6.5H15.6l13.3 22.9h16.8z" />
      <Path fill="#FFBA00" d="M45.7 29.4H19.1l-8.4 14.5c.4.1.8.2 1.2.2h24.2c.9 0 1.7-.5 2.1-1.2l7.5-13.5z" />
    </Svg>
  );
}

