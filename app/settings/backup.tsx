import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native';
import { BottomSheet, Divider, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import {
  ALL_PARTS,
  BACKUP_PARTS,
  describeSnapshot,
  parseSnapshot,
  partsOf,
  serialiseSnapshot,
  SETUP_PARTS,
  summariseSnapshot,
  snapshotFilename,
  stampToIso,
  absoluteTime,
  readableStamp,
  titleFor,
  validateSnapshot,
  type BackupPartKey,
  type Snapshot,
} from '~/features/backup/logic/backup';
import { exportSnapshot, restoreSnapshot } from '~/features/backup/logic/backupRepo';
import { settingsRepo, SETTINGS_KEYS } from '../../src/db/repositories';
import { useModalClose } from '~/shared/hooks/useModalClose';
import {
  BACKUP_FILES_LOCATION,
  deleteBackup,
  listBackups,
  readBackup,
  saveBackup,
  type StoredBackup,
} from '~/features/backup/logic/backupFile';
import {
  deleteDriveBackup,
  downloadDriveBackup,
  driveBlocker,
  isDriveAvailable,
  isSignedIn,
  connectedAccount,
  listDriveBackupsResult,
  signIn,
  signOut,
  uploadBackup,
} from '~/features/backup/logic/googleDrive';
import { formatSize as formatDriveSize, type DriveFile } from '~/features/backup/logic/driveSync';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Google Drive's brand colours, used on the connected card so the section is
 * recognisably about Drive rather than generically "the cloud".
 */
/**
 * One row in the Restore list, from either source.
 *
 * A tagged union rather than two lists: the row renders identically whichever
 * source it came from, and only the tap handler differs — local files are read
 * off disk, Drive files are downloaded first. Keeping them in one array is what
 * lets the list sort by age across both, which is the question a user restoring
 * a phone actually has.
 */
type RestoreRow = {
  key: string;
  source: 'local' | 'drive';
  title: string;
  subtitle: string;
  /** ISO-ish string; both sources sort correctly as text, newest last. */
  sortKey: string;
  backup?: StoredBackup;
  file?: DriveFile;
};

const DRIVE_BLUE = '#0066DA';
const DRIVE_GREEN = '#00AC47';
const DRIVE_YELLOW = '#FFBA00';

/**
 * Width of the gradient frame around the connected Drive card.
 *
 * Named because two places must agree on it: the gradient's padding, and the
 * inner radius that has to be smaller by exactly this much for the corners to
 * stay concentric.
 */
const DRIVE_BORDER = 2;

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
  /*
   * Every part ticked, including the sensitive one.
   *
   * `DEFAULT_BACKUP_PARTS` leaves "Messages awaiting review" out — raw bank SMS
   * text — on the argument that it should never leave the phone because a
   * default said so. Chosen deliberately against that here: a backup that
   * quietly omits a part is how someone restores onto a new phone and finds
   * their unreviewed messages gone. The tickbox is right there to drop it, and
   * the privacy note at the foot of the screen now states which way this falls.
   */
  const [parts, setParts] = useState<BackupPartKey[]>(ALL_PARTS);
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
    null | {
      backup: StoredBackup;
      snapshot: Snapshot | null;
      /** Where this copy lives, so the panel's mark matches the row's. */
      source: 'local' | 'drive';
      /** Contents still downloading — Drive only; local files read instantly. */
      loading?: boolean;
    }
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
  /**
   * The rows ticked for a bulk delete, by their `RestoreRow.key`.
   *
   * Keyed rather than held as objects so the set survives a reload: after
   * deleting four of six files the list is re-fetched, and a selection holding
   * stale `DriveFile` records would be pointing at rows that no longer exist.
   *
   * An EMPTY set is also the "not selecting" state — there is no separate
   * mode flag, because a selection mode with nothing selected is a state the
   * user can only leave by finding a Cancel button, and every exit path here
   * (deleting, clearing, deselecting the last row) naturally empties the set.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** True while a bulk delete is working through its files. */
  const [bulkBusy, setBulkBusy] = useState(false);

  /** Why the Drive listing is empty, when it is empty for a reason. */
  const [driveError, setDriveError] = useState<string | null>(null);
  /** The connected account's email, once known. */
  const [account, setAccount] = useState<string | null>(null);
  const [lastCloud, setLastCloud] = useState<string | null>(null);
  const [lastLocal, setLastLocal] = useState<string | null>(null);

  const driveAvailable = isDriveAvailable();
  const blocker = driveBlocker();
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  /**
   * Re-read what is on THIS PHONE, plus the "last backed up" stamps.
   *
   * Deliberately local-only and synchronous. Anything that also changes what is
   * in Drive must use `reloadAll` — see its note for why calling this alone was
   * a bug rather than an omission.
   */
  const reload = useCallback(() => {
    setBackups(listBackups());
    setLastCloud(settingsRepo.get(SETTINGS_KEYS.lastCloudBackupAt) ?? null);
    setLastLocal(settingsRepo.get(SETTINGS_KEYS.lastLocalBackupAt) ?? null);
  }, []);


  /**
   * Fetch the Drive listing into state, keeping WHY it failed.
   *
   * It used to swallow every failure and show an empty list, which produced the
   * worst possible screen: "Connected · last upload 9 days ago" directly above
   * "No backups yet, on this phone or in your Google Drive." Someone reading
   * that concludes their backups are gone. An expired sign-in and a genuinely
   * empty Drive folder look identical unless the reason is carried out.
   */
  const refreshDriveFiles = useCallback(async () => {
    setDriveBusy(true);
    try {
      const result = await listDriveBackupsResult();
      setDriveFiles(result.files);
      setDriveError(result.ok ? null : (result.error ?? null));
      // A dead refresh token signs the account out inside `accessToken`, so the
      // header has to stop claiming "Connected" as soon as the listing finds it.
      if (result.signedOut) {
        setSignedIn(false);
        setAccount(null);
      }
      if (result.ok) void connectedAccount().then(setAccount);
    } finally {
      setDriveBusy(false);
    }
  }, []);

  /**
   * Re-read BOTH sources — this phone and Drive.
   *
   * The Restore section lists them together, so anything that changes the set
   * of backups has to refresh both or the screen contradicts what just
   * happened. Uploading to Drive called the local-only `reload` and so did not
   * show the file it had just created; deleting from Drive refreshed only the
   * cloud rows. Both looked like the action had failed.
   *
   * Skips the network call when no account is connected, so a local-only user
   * pays nothing for it.
   */
  const reloadAll = useCallback(async () => {
    reload();
    if (await isSignedIn()) await refreshDriveFiles();
  }, [reload, refreshDriveFiles]);

  useEffect(() => {
    /*
     * Both sources on open, through the same helper every mutation uses.
     *
     * The Restore section lists them together, and a Drive backup that only
     * loaded when a separate sheet was opened meant the one place the user
     * looks to restore showed "no backups on this phone" while their actual
     * backups sat in Drive. Someone restoring onto a new phone has nothing
     * local by definition — that is the whole case — so the cloud copies have
     * to be visible without hunting for them.
     *
     * `reloadAll` also sets `signedIn` as a side effect of its listing, so the
     * header settles from the same pass.
     */
    void (async () => {
      setSignedIn(await isSignedIn());
      await reloadAll();
    })();
  }, [reloadAll]);

  /**
   * Catch a Drive failure that is really a LOST CONNECTION, and offer the fix.
   *
   * A revoked or expired refresh token signs the account out (see
   * `accessToken` in googleDrive.ts), so any Drive call can be the one that
   * discovers it. Two things then have to happen, and neither did before: the
   * row above must stop claiming "Connected", and the user must be given the
   * button that resolves it — "Sign in to Google again" with only an OK to
   * dismiss leaves them to find the way back themselves.
   *
   * Returns true when it has handled the failure, so the caller skips its own
   * generic message.
   */
  async function handledAsSignedOut(action: string): Promise<boolean> {
    const stillSignedIn = await isSignedIn();
    setSignedIn(stillSignedIn);
    if (stillSignedIn) return false;

    setDriveFiles([]);
    Alert.alert(
      'Google Drive disconnected',
      `Your Google sign-in has expired. Sign in again to ${action}.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign in', onPress: () => void handleConnect() },
      ],
    );
    return true;
  }

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
      // Carried as the Drive file's description so the restore list can show it
      // without downloading the file — see `DriveFile.description`.
      snapshot.label,
    );

    if (!result.ok) {
      if (await handledAsSignedOut('back up to Drive')) return;
      Alert.alert('Backup failed', result.error ?? 'The upload did not complete.');
      return;
    }

    settingsRepo.set(SETTINGS_KEYS.lastCloudBackupAt, result.uploadedAt ?? new Date().toISOString());
    setProgress('Done');
    // Both: the upload changed what is in Drive, and the stamps above are
    // local. Listing only the phone left the new file invisible under Restore.
    await reloadAll();
  }

  /**
   * Sign in, and stop there.
   *
   * Connecting an account is NOT a request to upload. The backup's scope — which
   * parts, what label — is chosen on this screen, so a sign-in that immediately
   * uploaded sent a snapshot the user had not composed yet, and did it before
   * they could see what connecting had done. Someone who wants a backup now has
   * the Back up button right there; someone who only wanted the account linked
   * (to restore an existing backup, most of all) no longer gets a stray upload
   * they never asked for.
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
      /*
       * Re-list immediately. Connecting is very often the fix for a listing
       * that just failed, and without this the Restore section keeps showing
       * the stale error — and no backups — until the screen is closed and
       * reopened, which reads as the sign-in not having worked.
       */
      setDriveError(null);
      await refreshDriveFiles();
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
    await refreshDriveFiles();
  }

  /*
   * The Restore list: every backup the user can reach, from either source.
   *
   * Merged rather than shown as two sections, because "which copy is newest"
   * is the question being asked and two separately-sorted lists cannot answer
   * it. Each row carries where it came from, so the choice is still visible —
   * it just is not the primary axis.
   *
   * Sorted newest-first across both. Local rows date from their filename (see
   * `listBackups`); Drive rows from `modifiedTime`, which is what Drive orders
   * its own listing by.
   */
  const restoreRows = useMemo((): RestoreRow[] => {
    const local: RestoreRow[] = backups.map((backup) => ({
      key: `local:${backup.filename}`,
      source: 'local',
      /*
       * The name, then the moment it was taken — "before reset · 4 Aug, 12:00".
       *
       * A label is free text and nothing stops the same one being reused
       * ("before reset" twice in an afternoon is ordinary, not a corner case),
       * so a title that is only the name is not unique and two such rows are
       * indistinguishable. Appending the timestamp makes every title unique by
       * construction, without having to reject or rename what the user typed.
       *
       * An unnamed backup is just the timestamp, which is what it always was.
       */
      title: titleFor(backup.label, backup.createdAt),
      /*
       * Age first, then what is in it.
       *
       * A Drive row leads with its age and a local row led with its contents,
       * so the merged list — whose whole point is "which copy is newest?" —
       * answered that question for half its rows and not the other half. The
       * age is the axis the list is sorted on; it belongs in the same position
       * on every row. The exact moment now lives in the title, so the subtitle
       * keeps the relative age it is sorted by.
       */
      subtitle: backup.summary
        ? `${relativeTime(stampToIso(backup.createdAt))} · ${backup.summary}`
        : 'Could not read this file',
      sortKey: backup.createdAt,
      backup,
    }));

    const drive: RestoreRow[] = (driveFiles ?? []).map((file) => ({
      key: `drive:${file.id}`,
      source: 'drive',
      /*
       * Name then moment, composed exactly as a local row is.
       *
       * The stamp comes from the FILENAME rather than Drive's `modifiedTime`:
       * the filename records when the backup was taken, while `modifiedTime`
       * records when the file last changed in Drive. They are usually the same
       * moment, but a re-upload or a Drive-side touch moves the latter — and a
       * title that shifts under the user is worse than one that is merely
       * approximate. `modifiedTime` still drives sorting and the relative age,
       * which is what it is right for.
       */
      title: titleFor(
        file.description?.trim(),
        file.name.replace(/^money-manager-/, '').replace(/\.json$/i, ''),
      ),
      // Drive does not tell us what is INSIDE without downloading it, so the
      // row shows size and age instead of the contents summary a local row
      // carries. The counts appear in the panel once it is opened.
      subtitle: [formatDriveSize(file.size), file.modifiedTime ? relativeTime(file.modifiedTime) : '']
        .filter(Boolean)
        .join(' · '),
      sortKey: file.modifiedTime,
      file,
    }));

    return [...local, ...drive].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [backups, driveFiles]);

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
                if (await handledAsSignedOut('manage backups in Drive')) return;
                Alert.alert('Could not delete', result.error ?? 'Please try again.');
                return;
              }
              // Re-fetch rather than splicing locally: the folder may have
              // changed on another device while this sheet was open.
              await reloadAll();
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
          onPress: () =>
            void signOut().then(() => {
              setSignedIn(false);
              /*
               * Drop the cloud rows with the connection. They were listed under
               * Restore, and tapping one after disconnecting would fail on a
               * token that no longer exists — the files are still in Drive, but
               * this app can no longer reach them.
               */
              setDriveFiles([]);
              setDriveError(null);
              setAccount(null);
            }),
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
      setInspecting({ backup, snapshot: null, source: 'local' });
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
    setInspecting({ backup, snapshot, source: 'local' });
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

  /**
   * Restore straight from a Drive file.
   *
   * The sheet used to tell the user to open the Drive app, save the file into
   * the app's documents folder, and come back — which meant a backup made on a
   * lost phone was, in practice, not restorable at all. The file is already
   * reachable with the token this screen holds, so it is downloaded here and
   * handed to the SAME inspect panel a local backup opens.
   *
   * Going through that panel rather than restoring on the spot is what keeps the
   * two gates: `validateSnapshot` below refuses a corrupt file before anything
   * is deleted, and the panel is where the user picks what to bring back.
   */
  async function openDriveBackup(file: DriveFile) {
    /*
     * The panel opens FIRST, then fills in.
     *
     * Downloading before opening meant a tap on a Drive row did nothing visible
     * until the file arrived — on a slow connection, several seconds of a screen
     * that looked like it had ignored the tap, which is what makes people tap
     * again. The sheet now answers immediately and shows its own loader, so the
     * wait happens somewhere the user is already looking.
     *
     * Everything known without the download goes in now — the name and the size
     * come from the listing — so only the contents are missing while it loads.
     */
    const backup: StoredBackup = {
      filename: file.name,
      // `size` comes back from Drive as a string and is only ever displayed.
      size: Number(file.size) || 0,
      createdAt: file.modifiedTime,
      summary: '',
      // Known from the listing, so the panel opens with the user's own name for
      // the backup already in its header rather than switching from a timestamp
      // to a label once the download lands.
      ...(file.description?.trim() ? { label: file.description.trim() } : {}),
    };

    setDriveOpen(false);
    setInspecting({ backup, snapshot: null, source: 'drive', loading: true });

    const fail = (title: string, message: string) => {
      // Close the panel on failure: it has nothing to show, and leaving it up
      // behind an alert offers a restore of a file that never loaded.
      setInspecting(null);
      Alert.alert(title, message);
    };

    const result = await downloadDriveBackup(file.id);

    if (!result.ok || !result.contents) {
      setInspecting(null);
      if (await handledAsSignedOut('restore from Drive')) return;
      fail('Could not open it', result.error ?? 'The download did not complete.');
      return;
    }

    const snapshot = parseSnapshot(result.contents);
    if (!snapshot) {
      fail('That backup is not usable', 'The file could not be read as a backup.');
      return;
    }

    const validation = validateSnapshot(snapshot);
    if (!validation.ok) {
      fail('That backup is not usable', validation.problems.join('\n\n'));
      return;
    }

    /*
     * Adapted into the shape the panel already takes, so a Drive backup and a
     * local one are inspected and restored by exactly one code path — there is
     * no second restore flow here that could drift from the local one.
     */
    setRestoreParts(partsOf(snapshot));
    setInspecting({
      backup: { ...backup, summary: describeSnapshot(snapshot) },
      snapshot,
      source: 'drive',
    });
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

  /** Tick or untick one row. Emptying the set leaves selection mode. */
  function toggleSelected(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selecting = selected.size > 0;

  /**
   * Delete every ticked backup, local and Drive alike, after one confirmation.
   *
   * Clearing out old restore points was a per-file chore: each row's trash
   * asked its own question, so tidying six files meant twelve taps and six
   * identical dialogs. The set spans both sources deliberately — the list is
   * merged, so a selection that could only cover half of it would be a rule
   * the user has to learn from being refused.
   *
   * Local files delete synchronously and cannot really fail; Drive files are
   * network calls that can. So failures are COUNTED and reported at the end
   * rather than aborting the run: stopping at the first error would leave the
   * user with a half-deleted selection and no idea which half.
   */
  function handleDeleteSelected() {
    const rows = restoreRows.filter((row) => selected.has(row.key));
    if (rows.length === 0) return;

    const driveCount = rows.filter((row) => row.source === 'drive').length;
    const localCount = rows.length - driveCount;
    // Names the split, because deleting from Drive is the irreversible half and
    // "3 backups" hides whether any of them was the off-phone copy.
    const where = [
      localCount > 0 ? `${localCount} on this phone` : '',
      driveCount > 0 ? `${driveCount} in Google Drive` : '',
    ]
      .filter(Boolean)
      .join(' and ');

    Alert.alert(
      `Delete ${rows.length} ${rows.length === 1 ? 'backup' : 'backups'}?`,
      `This removes ${where}. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBulkBusy(true);
              let failed = 0;
              let signedOut = false;

              for (const row of rows) {
                if (row.source === 'local') {
                  if (!deleteBackup(row.backup!.filename)) failed += 1;
                  continue;
                }

                const result = await deleteDriveBackup(row.file!.id);
                if (!result.ok) {
                  failed += 1;
                  // A session that expired mid-run fails every remaining Drive
                  // file for the same reason; note it once and let the loop
                  // finish so the local deletions still land.
                  signedOut = true;
                }
              }

              setBulkBusy(false);
              setSelected(new Set());
              await reloadAll();

              if (failed > 0) {
                if (signedOut && (await handledAsSignedOut('manage backups in Drive'))) return;
                Alert.alert(
                  'Some could not be deleted',
                  `${rows.length - failed} of ${rows.length} were removed. Please try the rest again.`,
                );
              }
            })();
          },
        },
      ],
    );
  }

  const lastAny = newest(lastCloud, lastLocal);

  /**
   * How safe the data actually is, in three states rather than two.
   *
   * The banner used to be green for ANY past backup, so a copy from a fortnight
   * ago looked as reassuring as one from this morning — while a fortnight of
   * transactions sat on the phone alone. "Backed up" is not a fact about the
   * past, it is a claim about now, and the screen was making it falsely.
   *
   * A week is the threshold because this app is fed by bank messages arriving
   * daily: after seven days a backup is missing enough that restoring it would
   * visibly lose work.
   */
  const daysSinceBackup = lastAny
    ? Math.floor((Date.now() - new Date(lastAny).getTime()) / 86_400_000)
    : null;
  const safety: 'none' | 'stale' | 'safe' =
    daysSinceBackup === null ? 'none' : daysSinceBackup >= 7 ? 'stale' : 'safe';

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
            : safety === 'safe'
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
              name={safety === 'safe' ? 'shield-checkmark' : 'alert-circle'}
              size={26}
              color={safety === 'safe' ? colors.completed : colors.pending}
            />
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading">
              {busy
                ? 'Backing up…'
                : safety === 'safe'
                  ? `Backed up ${relativeTime(lastAny!)}`
                  : safety === 'stale'
                    ? 'Your backup is out of date'
                    : 'Not backed up yet'}
            </Text>
            {/*
              One line, not two.

              A safe backup showed a relative time on top and an absolute one
              underneath — the same fact twice, in two formats. The exact
              timestamp is the useful half once you know it is recent, so the
              headline carries the plain state and this carries the detail.
            */}
            <Text variant="small" tone="secondary">
              {busy
                ? (progress ?? 'Working…')
                : safety === 'safe'
                  ? absoluteTime(lastAny!)
                  : safety === 'stale'
                    ? 'Anything since then exists only on this phone.'
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

        {/*
          The gradient WRAPS the card while connected.

          React Native has no gradient border, so the gradient is the outer
          layer and the card sits inside it inset by a hairline — the same
          trick the Smart Detect section uses. A band across the top alone left
          three plain edges and read as a decorative stripe rather than as the
          section being live.
        */}
        <LinearGradient
          colors={
            signedIn
              ? [DRIVE_BLUE, DRIVE_GREEN, DRIVE_YELLOW]
              : [colors.hairline, colors.hairline]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: radius.lg, padding: signedIn ? DRIVE_BORDER : 0 }}
        >
        {/*
          The inner radius is the outer MINUS the border width.
        
          Concentric corners only look right when the inner curve is tighter by
          exactly the gap between them. Leaving both at `radius.lg` let the
          square inner corner cut across the rounded outer one, so the gradient
          bunched into a hard right angle at each corner — the card looked like
          a sticker peeling off rather than a bordered surface.
        
          The Surface's own hairline is dropped while the gradient is showing:
          two borders 2px apart read as a double line, not a frame.
        */}
        <Surface
          padded={false}
          style={{
            overflow: 'hidden',
            ...(signedIn
              ? { borderRadius: radius.lg - DRIVE_BORDER, borderWidth: 0 }
              : null),
          }}
        >
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
                {/* Drive's own logo, not the sign-in "G" — once connected the
                    row is about the folder, not the account. */}
                <DriveMark />
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={6}>
                    <Text variant="bodyStrong">Google Drive</Text>
                    <StatusDot color={colors.completed} label="Connected" />
                  </Row>
                  {/* The account, then the timing. Which Google account is
                      connected is the fact someone with two of them needs, and
                      "Connected" alone never answered it. */}
                  {account ? (
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {account}
                    </Text>
                  ) : null}
                  <Text variant="caption" tone="muted">
                    {lastCloud
                      ? `Last upload ${relativeTime(lastCloud)}`
                      : 'Uploads to your "money-manager" folder'}
                  </Text>
                </View>
                {/*
                  An icon, not the word.

                  "Disconnect" spelled out competed with the account name beside
                  it for a control almost nobody uses. A close glyph in a quiet
                  circle stays legible without arguing for attention — and
                  `handleDisconnect` already confirms before signing out, so a
                  mistaken tap costs nothing.
                */}
                <Pressable
                  onPress={handleDisconnect}
                  accessibilityRole="button"
                  accessibilityLabel="Disconnect Google Drive"
                  hitSlop={10}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.55 : 1,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.dangerSoft,
                  })}
                >
                  {/* Red: disconnecting stops every future cloud backup, which
                      is the one destructive thing this row can do. */}
                  <Ionicons name="close" size={15} color={colors.danger} />
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
        </LinearGradient>

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
            /* Was "Share it to Drive or AirDrop from the Files app" — a
               Files-app workflow the "Moving to a new phone" card below already
               explains in full. Saying it twice made a one-line row look like
               it needed instructions. This states the trade-off instead, which
               is the reason to pick Drive over it. */
            sublabel="Stays on this phone — lost with it"
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
      {driveBusy && !driveOpen ? (
        /*
          Loading, and it does not yet know what it will find.

          The Drive listing is fetched on mount whenever an account is
          connected, and until it lands this section cannot honestly claim
          either "here are your backups" or "you have none". It used to claim
          the latter: `restoreRows` was empty during the fetch, so someone
          restoring onto a new phone — who by definition has nothing local —
          was told "No backups yet" for a second or two before their Drive
          copies appeared. That is the worst possible lie to tell at exactly
          that moment.

          Local rows are known synchronously, so they render immediately and
          the skeleton fills in only for what is still arriving.
        */
        <View style={{ gap: space.sm }}>
          <SectionHeading
            icon="time-outline"
            title="Restore"
            subtitle="Replace what is on your board with a saved copy"
          />
          <BackupSkeleton rows={Math.max(3, restoreRows.length)} />
          <Row gap={space.sm} style={{ paddingHorizontal: space.xs }}>
            <ActivityIndicator size="small" color={colors.inkMuted} />
            <Text variant="caption" tone="muted">
              Checking Google Drive…
            </Text>
          </Row>
        </View>
      ) : restoreRows.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <SectionHeading
            icon="time-outline"
            title="Restore"
            subtitle="Replace what is on your board with a saved copy"
          />

          {/*
            The selection bar, present only once something is ticked.

            It replaces nothing and hides nothing — the rows stay exactly where
            they were — so entering selection mode does not rearrange the
            screen under the user's finger. It carries the count (what is about
            to be deleted), a way out, and the destructive action itself.
          */}
          {selecting ? (
            <Row
              gap={space.sm}
              align="center"
              style={{
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceSunken,
              }}
            >
              <Text variant="caption" tone="secondary" style={{ flex: 1, fontWeight: '700' }}>
                {selected.size} selected
              </Text>

              {/*
                Select-all is offered only when it would actually change
                something — with every row already ticked it is a button that
                does nothing, which reads as broken rather than complete.
              */}
              {selected.size < restoreRows.length ? (
                <Pressable
                  onPress={() => setSelected(new Set(restoreRows.map((row) => row.key)))}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                    Select all
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => setSelected(new Set())}
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={handleDeleteSelected}
                disabled={bulkBusy}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${selected.size} selected backups`}
                hitSlop={8}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: space.sm,
                  paddingVertical: 4,
                  borderRadius: 999,
                  backgroundColor: colors.dangerSoft,
                  opacity: pressed || bulkBusy ? 0.6 : 1,
                })}
              >
                {bulkBusy ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Ionicons name="trash-outline" size={14} color={colors.danger} />
                )}
                <Text variant="caption" color={colors.danger} style={{ fontWeight: '700' }}>
                  Delete
                </Text>
              </Pressable>
            </Row>
          ) : (
            /*
              How to get INTO selection mode, said once above the list.

              A long-press with no affordance is a gesture nobody finds. This
              line is the affordance, and it disappears the moment it has been
              acted on — by which point the selection bar is saying what to do
              next.
            */
            <Text variant="caption" tone="muted" style={{ paddingHorizontal: space.xs }}>
              Hold a backup to select several and delete them at once.
            </Text>
          )}

          <Surface padded={false} style={{ overflow: 'hidden' }}>
            {restoreRows.map((row, index) => (
              <View key={row.key}>
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
                  /*
                    While selecting, a tap TICKS the row rather than opening it.

                    A list in selection mode where a tap still navigated would
                    throw the user off the screen mid-selection, losing what
                    they had ticked. Long-press is what enters the mode, and
                    once in it the plain tap is the selection gesture.
                  */
                  onPress={() =>
                    selecting
                      ? toggleSelected(row.key)
                      : row.source === 'local'
                        ? openBackup(row.backup!)
                        : void openDriveBackup(row.file!)
                  }
                  onLongPress={() => toggleSelected(row.key)}
                  delayLongPress={300}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selected.has(row.key) }}
                  accessibilityLabel={
                    selecting
                      ? `${row.title}, ${selected.has(row.key) ? 'selected' : 'not selected'}. Tap to ${
                          selected.has(row.key) ? 'deselect' : 'select'
                        }.`
                      : `Details for ${row.title}, ${
                          row.source === 'drive' ? 'in Google Drive' : 'on this phone'
                        }${index === 0 ? ', most recent backup' : ''}. Hold to select.`
                  }
                  style={({ pressed }) => ({
                    backgroundColor: selected.has(row.key)
                      ? colors.accentSoft
                      : pressed
                        ? colors.surfaceSunken
                        : 'transparent',
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
                  {/*
                    The mark says WHERE the copy lives.

                    Drive rows carry Drive's OWN four-colour triangle rather
                    than a blue cloud outline. In a merged list the source is
                    the thing a reader is scanning for — "which of these
                    survives losing the phone?" — and a brand mark is recognised
                    before any label is read, where one generic glyph tinted
                    blue against another tinted accent is a colour difference
                    the eye has to decode.

                    The connected-account card above already uses this mark, so
                    the rows and the account now agree on what "Drive" looks
                    like. A local file keeps the document glyph: it has no brand
                    and it is genuinely a file on this phone.
                  */}
                  {/*
                    The source mark becomes the TICKBOX while selecting.

                    Adding a checkbox beside it would push every row wider and
                    leave two competing marks in the same spot. The source is
                    still named in the row's subtitle ("Drive" / "Phone"), so
                    nothing is lost by borrowing the icon's place for the state
                    that currently matters.
                  */}
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: radius.sm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selecting
                        ? selected.has(row.key)
                          ? colors.accent
                          : colors.surfaceSunken
                        : row.source === 'drive'
                          ? `${DRIVE_BLUE}1A`
                          : colors.accentSoft,
                    }}
                  >
                    {selecting ? (
                      <Ionicons
                        name={selected.has(row.key) ? 'checkmark' : 'ellipse-outline'}
                        size={17}
                        color={selected.has(row.key) ? colors.inkInverse : colors.inkFaint}
                      />
                    ) : row.source === 'drive' ? (
                      <DriveMark size={18} />
                    ) : (
                      <Ionicons
                        name="document-text-outline"
                        size={17}
                        color={colors.accent}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    {/* The user's own name leads when they gave one — that is
                        what makes a list of backups tellable apart. */}
                    <Row gap={6} align="center">
                      <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {row.title}
                      </Text>
                      {/*
                        The newest copy ACROSS BOTH SOURCES, marked.
                        
                        The list is sorted newest-first, but "which is the most
                        recent?" is otherwise a date-comparison exercise across
                        rows whose dates are formatted differently — a local
                        file's stamp against Drive's relative time. That is the
                        one question this list exists to answer, and it matters
                        more here than in the Drive-only sheet, which already
                        had this tag while the merged list did not.
                      */}
                      {index === 0 ? (
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
                    <Row gap={6}>
                      {/*
                        Named source, not just a coloured icon.

                        "Is this the copy that survives losing the phone?" is the
                        question, and colour alone cannot answer it for someone
                        who cannot separate the two tints.
                      */}
                      <Text
                        variant="caption"
                        color={row.source === 'drive' ? DRIVE_BLUE : colors.inkFaint}
                        style={{ fontWeight: '700' }}
                      >
                        {row.source === 'drive' ? 'Drive' : 'Phone'}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                        {row.subtitle}
                      </Text>
                    </Row>
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
                  {/*
                    Both per-row affordances stand down while selecting: the
                    chevron would promise a navigation the tap no longer does,
                    and a single-file trash beside a bulk Delete is two
                    destructive buttons on one row asking the same question at
                    different scales.
                  */}
                  {selecting ? null : (
                    <>
                      <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
                      <Pressable
                        onPress={() =>
                          row.source === 'local'
                            ? handleDelete(row.backup!)
                            : handleDriveDelete(row.file!)
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${row.title} from ${
                          row.source === 'drive' ? 'Google Drive' : 'this phone'
                        }`}
                        hitSlop={8}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                      >
                        <Ionicons name="trash-outline" size={17} color={colors.inkFaint} />
                      </Pressable>
                    </>
                  )}
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
            {/*
              Says which places were actually checked, and never claims Drive
              is empty when it could not be READ.
              
              "No backups yet, on this phone or in your Google Drive" beside a
              connected account is a statement about the user's data, and
              stating it after a failed listing tells them their backups are
              gone when they are not.
            */}
            {driveError ? (
              <>
                <Text variant="small" tone="secondary">
                  No backups on this phone yet.
                </Text>
                <Text variant="caption" color={colors.pending}>
                  {driveError}
                </Text>
              </>
            ) : (
              <Text variant="small" tone="secondary">
                {signedIn
                  ? 'No backups yet, on this phone or in your Google Drive. Save one above and it will appear here.'
                  : 'No backups on this phone yet. Save one above, or connect Google Drive to see copies stored there.'}
              </Text>
            )}
            {driveBusy ? (
              <Text variant="caption" tone="muted">
                Checking Google Drive…
              </Text>
            ) : null}
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
          {/* Kept in step with the default above. This said message text was
              only included if you ticked it, which stopped being true when
              every part became ticked by default — and a note that is quietly
              wrong about privacy is worse than none. */}
          Backups include bank message text awaiting review. Untick "Messages
          awaiting review" to leave it on this phone.
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

              {/* Enough rows to reach the bottom of the sheet — five filled
                  only the top third, which looked like a short list that had
                  finished loading rather than a page still arriving. */}
              <BackupSkeleton rows={10} />
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
                    {/*
                      The whole row opens the backup, matching the local list.

                      No separate "Restore" chip, for the reason the local rows
                      note: a button labelled Restore implies it restores, when
                      what it actually does is open a panel to choose from.
                    */}
                    <Pressable
                      onPress={() => void openDriveBackup(file)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open backup from ${relativeTime(file.modifiedTime)}`}
                      style={({ pressed }) => ({
                        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                      })}
                    >
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
                      {/*
                        Drive's own mark on every row in Drive's own folder.

                        The newest row used to be marked by filling this chip
                        solid green, which cannot work with a four-colour logo
                        — a multicolour mark on a saturated fill is unreadable.
                        The LATEST tag beside the name already says which is
                        current, so the chip stays a light Drive-blue tint on
                        every row and the distinction moves to a small tick
                        badge in the corner.
                      */}
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: radius.sm,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: `${DRIVE_BLUE}14`,
                        }}
                      >
                        <DriveMark size={18} />
                        {index === 0 ? (
                          <View
                            style={{
                              position: 'absolute',
                              right: -3,
                              bottom: -3,
                              width: 15,
                              height: 15,
                              borderRadius: 8,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: colors.completed,
                              // A ring in the surface colour so the badge reads
                              // as sitting ON the tile rather than merging with
                              // the row behind it.
                              borderWidth: 2,
                              borderColor: colors.surface,
                            }}
                          >
                            <Ionicons name="checkmark" size={8} color={colors.inkInverse} />
                          </View>
                        ) : null}
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Row gap={6}>
                          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                            {/* Name then moment — the same rule the merged
                                restore list follows, so a backup does not
                                change its name between the two screens. */}
                            {titleFor(
                              file.description?.trim(),
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
                      {/*
                        No Restore chip here, matching the local list.

                        The row already opens the same inspect panel, and a
                        button labelled Restore implies it restores when what it
                        actually does is open a panel to choose from. The
                        chevron says "there is more here", which is the honest
                        description of the tap.
                      */}
                      <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
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
                    </Pressable>
                  </View>
                ))}
              </Surface>

              <Row gap={space.sm} style={{ alignItems: 'flex-start', paddingHorizontal: space.xs }}>
                <Ionicons
                  name="information-circle-outline"
                  size={15}
                  color={colors.inkMuted}
                  style={{ marginTop: 1 }}
                />
                <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                  Tap any backup to see what it holds and choose what to bring back.
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
  entry: null | {
    backup: StoredBackup;
    snapshot: Snapshot | null;
    source: 'local' | 'drive';
    loading?: boolean;
  };
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

  const { backup, snapshot, source, loading } = entry;
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
      // Composed exactly as the row that opened it, so the heading and the row
      // the user just tapped read the same.
      title={titleFor(backup.label, backup.createdAt)}
      /*
       * Shown in FULL here, unlike the list rows.
       *
       * The heading is the user's own name plus the moment the backup was
       * taken, and this is the screen where they decide whether to overwrite
       * their board with it. Clamped to one line, a name of any length pushed
       * the date off the end — so the panel identified the copy by a name the
       * user may well have reused, with the half that disambiguates it hidden.
       * A list row can truncate because the panel is one tap away; the panel
       * has nowhere further to defer to.
       */
      wrapTitle
      /*
       * The mark says WHERE this copy lives, matching the row that opened it.
       *
       * A Drive backup opened into a panel headed by a document icon, which is
       * the local mark — so the one screen where you decide to overwrite your
       * board gave no sign which copy you were about to restore from. The list
       * rows already distinguish the two; the panel has to agree with them.
       */
      icon={source === 'drive' ? <DriveMark size={22} /> : 'document-text-outline'}
      /*
       * A pale tile behind the brand mark, a solid one behind the glyph.
       *
       * The glyph path draws white on a saturated fill, which is right for a
       * monochrome icon and wrong for a four-colour logo — Drive's triangle on
       * solid blue loses its blue arm entirely. The light tint keeps all three
       * colours readable, and matches the chip the restore rows use.
       */
      iconColor={source === 'drive' ? `${DRIVE_BLUE}14` : colors.accent}
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
      {loading ? (
        /*
          Downloading. Same shape as the loaded panel, so nothing jumps.

          "This file cannot be read" is what a null snapshot means everywhere
          else, and showing it here for the second the download takes would
          accuse a perfectly good backup of being corrupt.
        */
        <View style={{ gap: space.sm }}>
          <Row style={{ alignItems: 'center', paddingRight: space.xs }}>
            <Label>WHAT TO BRING BACK</Label>
            <View style={{ flex: 1 }} />
            <Row gap={6}>
              <ActivityIndicator size="small" color={colors.inkMuted} />
              <Text variant="caption" tone="muted">
                Downloading…
              </Text>
            </Row>
          </Row>
          <BackupSkeleton rows={BACKUP_PARTS.length} />
        </View>
      ) : snapshot === null ? (
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

/**
 * Placeholder rows in the shape of a backup list.
 *
 * A lone spinner says "something is happening" and nothing else, so a list
 * appears empty until it resolves and then jumps as rows push in. Placeholders
 * shaped like the real rows say what is coming and keep the layout still, which
 * makes a slow network feel slow rather than broken.
 *
 * Shared by the Drive sheet and the Restore section: they render the same row —
 * chip, two lines of text — so two hand-built skeletons would drift apart, and
 * the one on the Restore section was missing entirely.
 */
function BackupSkeleton({ rows = 5 }: { rows?: number }) {
  const { colors, space, radius } = useTheme();

  return (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      {Array.from({ length: rows }, (_, row) => (
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
               * A steep fade would leave the last rows invisible and the list
               * looking half-drawn. A shallow one reads as "more below", which
               * a folder of backups usually has.
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

/**
 * The Google DRIVE triangle, in Drive's own colours.
 *
 * Used once connected, where the plain "G" was wrong: the G is a sign-in mark,
 * and after sign-in the row is no longer about an account — it is about the
 * folder the backups live in. Drive's logo says which product holds them.
 */
function DriveMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {/* Left blue arm. */}
      <Path fill="#0066DA" d="M6.6 39.2 2.3 31.7c-.4-.7-.4-1.6 0-2.3L15.6 6.5l8.6 15L10.9 44.6a2.6 2.6 0 0 1-.9-.9L6.6 39.2z" />
      {/* Right green arm. */}
      <Path fill="#00AC47" d="M45.7 29.4 32.4 6.5H15.6l13.3 22.9h16.8z" />
      {/* Bottom yellow arm. */}
      <Path fill="#FFBA00" d="M45.7 29.4H19.1l-8.4 14.5c.4.1.8.2 1.2.2h24.2c.9 0 1.7-.5 2.1-1.2l7.5-13.5z" />
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

