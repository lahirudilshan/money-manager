/**
 * Google Drive as the backup destination — the pure protocol half.
 *
 * ## Why Drive, and why a visible folder
 *
 * The user's data goes to storage THEY own. No account on our server, no
 * personal data in a database we run, and a phone lost tomorrow is restored on
 * a new one by signing into the Google account they already have. That is a
 * better privacy position than anything account-based this app could offer, and
 * it costs no backend.
 *
 * Everything is written to a VISIBLE "money-manager" folder in the user's
 * Drive, created on first upload. The `drive.file` scope grants access only to
 * files this app itself created — it cannot read anything else the user keeps
 * there, and Google's consent screen states that.
 *
 * The alternative, `appDataFolder`, hides the files completely: nothing shows
 * in the Drive UI. For a backup that is the wrong trade — a file the user
 * cannot see is one they cannot verify, download or restore by hand, and the
 * entire value of a backup is confidence that it exists.
 *
 * ## What is here and what is not
 *
 * This module is pure request-building and response-parsing: no fetch, no
 * tokens, no native modules. That keeps the wire format fully testable, and
 * confines the parts that need a device — OAuth and the HTTP calls — to
 * services/googleDrive.ts.
 */

/**
 * The scope this feature needs.
 *
 * `drive.file` grants access ONLY to files this app itself created — it cannot
 * read anything else in the user's Drive, and Google's consent screen says so.
 * That is the narrowest scope that still allows a VISIBLE folder, which is what
 * a user who wants to see and manage their own backups needs.
 *
 * The alternative, `drive.appdata`, hides the files entirely: nothing appears
 * in the Drive UI, and a backup the user cannot see is one they cannot verify,
 * copy or restore by hand. Given the whole point is trusting that their data is
 * safe somewhere they control, visible wins.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** The folder backups live in, created on first upload. */
export const BACKUP_FOLDER_NAME = 'money-manager';

/** Drive's "about this account" endpoint — see `accountRequest`. */
const DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/** A backup file as Drive reports it. */
export interface DriveFile {
  id: string;
  name: string;
  /** ISO timestamp Drive recorded. Used to order the restore list. */
  modifiedTime: string;
  /** Bytes, as a string in the API. Parsed for display only. */
  size?: string;
  /**
   * The user's own name for this backup, carried in Drive's `description`.
   *
   * A local backup keeps its label INSIDE the snapshot, which the restore list
   * reads at list time. That is not available here: Drive will not tell us what
   * is in a file without downloading it, so a labelled backup uploaded to Drive
   * came back as a bare timestamp — the label the user typed specifically to
   * tell two restore points apart survived on the phone and vanished off it.
   *
   * `description` is metadata, so it arrives with the listing at no extra cost,
   * and it is also what Drive's own web UI shows beside the file.
   */
  description?: string;
}

/** An HTTP request for the caller to execute. Keeps this module transport-free. */
export interface DriveRequest {
  url: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body?: string;
}

/** Bearer header, the one thing every request shares. */
function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Find the backup folder, if this app has already made one.
 *
 * Scoped with `trashed=false` because a folder the user deleted still matches
 * by name for 30 days, and uploading into a trashed folder succeeds silently —
 * the backup would exist and be invisible.
 */
export function findFolderRequest(token: string): DriveRequest {
  const query = `name='${BACKUP_FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const params = new URLSearchParams({ q: query, fields: 'files(id,name)', pageSize: '1' });

  return { url: `${DRIVE_FILES}?${params}`, method: 'GET', headers: auth(token) };
}

/** Create the backup folder. Called only when `findFolderRequest` found none. */
export function createFolderRequest(token: string): DriveRequest {
  return {
    url: `${DRIVE_FILES}?fields=id,name`,
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: FOLDER_MIME }),
  };
}

/**
 * Invite another Google account to the app's folder.
 *
 * ## Why sharing rather than one shared login
 *
 * The obvious way to get two phones onto one dataset is to sign both into the
 * same Google account. That means handing over a password, and there is no way
 * to revoke one phone without changing it. Sharing the FOLDER instead lets each
 * person keep their own account: Drive's own permissions become the access
 * control, the invite is visible in both accounts, and removing access is a
 * single tap in Drive rather than a password reset.
 *
 * `role: 'writer'` is the minimum that works — sync writes the shared file on
 * both sides, so a reader could never contribute their own changes.
 *
 * `sendNotificationEmail` is TRUE deliberately. Drive can share silently, but
 * an invitation the other person never sees is indistinguishable from a broken
 * feature, and they need the mail to find the folder in "Shared with me".
 */
export function shareFolderRequest(
  token: string,
  folderId: string,
  email: string,
): DriveRequest {
  return {
    url: `${DRIVE_FILES}/${encodeURIComponent(folderId)}/permissions?fields=id&sendNotificationEmail=true`,
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  };
}

/** Who currently has access, so the screen can show and revoke them. */
export function listPermissionsRequest(token: string, folderId: string): DriveRequest {
  return {
    url: `${DRIVE_FILES}/${encodeURIComponent(folderId)}/permissions?fields=permissions(id,emailAddress,role,type)`,
    method: 'GET',
    headers: auth(token),
  };
}

/** Revoke one person's access. */
export function revokePermissionRequest(
  token: string,
  folderId: string,
  permissionId: string,
): DriveRequest {
  return {
    url: `${DRIVE_FILES}/${encodeURIComponent(folderId)}/permissions/${encodeURIComponent(permissionId)}`,
    method: 'DELETE',
    headers: auth(token),
  };
}

/** One account with access to the shared folder. */
export interface FolderMember {
  id: string;
  email: string | null;
  role: string;
  /** True for the account that created the folder — it cannot be revoked. */
  owner: boolean;
}

export function parsePermissions(payload: unknown): FolderMember[] {
  const list = (payload as { permissions?: unknown } | null)?.permissions;
  if (!Array.isArray(list)) return [];

  return list
    .map((raw) => {
      const p = raw as { id?: unknown; emailAddress?: unknown; role?: unknown };
      if (typeof p.id !== 'string') return null;
      const role = typeof p.role === 'string' ? p.role : 'reader';
      return {
        id: p.id,
        email: typeof p.emailAddress === 'string' ? p.emailAddress : null,
        role,
        owner: role === 'owner',
      };
    })
    .filter((member): member is FolderMember => member !== null);
}

/**
 * Find the folder someone ELSE shared with this account.
 *
 * `sharedWithMe` is what makes the invited phone work: the folder is not in her
 * own Drive, so the ordinary name search — which looks at files she owns —
 * finds nothing and the app would helpfully create a second, empty folder of
 * the same name and sync into that instead. The two phones would then appear
 * paired while sharing nothing.
 *
 * Checked BEFORE creating anything, and only then falling back to her own.
 */
export function findSharedFolderRequest(token: string): DriveRequest {
  const query = [
    `name='${BACKUP_FOLDER_NAME}'`,
    `mimeType='${FOLDER_MIME}'`,
    'trashed=false',
    'sharedWithMe=true',
  ].join(' and ');

  const params = new URLSearchParams({ q: query, fields: 'files(id,name)', pageSize: '1' });
  return { url: `${DRIVE_FILES}?${params}`, method: 'GET', headers: auth(token) };
}

/** The folder id from a find/create response, or null. */
export function parseFolderId(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;

  const body = payload as { id?: unknown; files?: unknown };
  if (typeof body.id === 'string') return body.id;

  const files = Array.isArray(body.files) ? body.files : [];
  const first = files[0] as { id?: unknown } | undefined;
  return typeof first?.id === 'string' ? first.id : null;
}

/**
 * List the backups in the app folder, newest first.
 *
 * Scoped by PARENT rather than by name, so a file the user renamed in Drive is
 * still listed. `trashed=false` matters: a deleted backup lingers for 30 days
 * and would otherwise appear as restorable when it is on its way out.
 */
/**
 * Ask Drive who the token belongs to.
 *
 * Inside the existing `drive.file` scope — Drive's own `about` endpoint returns
 * the account's email without the `userinfo.email` scope, so showing which
 * account is connected costs the user no extra permission. Asking for one just
 * to render a label would be a poor trade.
 */
export function accountRequest(token: string): DriveRequest {
  return {
    url: `${DRIVE_ABOUT}?fields=user(emailAddress,displayName)`,
    method: 'GET',
    headers: auth(token),
  };
}

/** The signed-in account's email, or null when the payload lacks one. */
export function parseAccountEmail(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const user = (payload as { user?: unknown }).user;
  if (user === null || typeof user !== 'object') return null;
  const email = (user as { emailAddress?: unknown }).emailAddress;
  return typeof email === 'string' && email.length > 0 ? email : null;
}

export function listBackupsRequest(token: string, folderId: string): DriveRequest {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,modifiedTime,size,description)',
    orderBy: 'modifiedTime desc',
    pageSize: '50',
  });

  return { url: `${DRIVE_FILES}?${params}`, method: 'GET', headers: auth(token) };
}

/**
 * Upload a new backup.
 *
 * Multipart in one request: Drive needs the metadata (name, parent folder) and
 * the bytes together, and doing it as two calls leaves an orphaned empty file
 * when the second fails. The boundary is fixed rather than random because
 * nothing in a JSON snapshot can contain it — the content is JSON-escaped, so a
 * literal boundary string cannot appear unescaped in the body.
 */
export function uploadBackupRequest(
  token: string,
  filename: string,
  contents: string,
  folderId: string,
  /** The user's own name for this backup, stored as Drive's `description`. */
  label?: string,
): DriveRequest {
  const boundary = 'money-manager-backup-boundary';

  // `description` is omitted entirely when there is no label, rather than sent
  // as an empty string — an empty description is a value Drive stores and
  // shows, and "" is not what the user meant by not typing one.
  const metadata = JSON.stringify({
    name: filename,
    parents: [folderId],
    ...(label ? { description: label } : {}),
  });

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    contents,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return {
    url: `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime`,
    method: 'POST',
    headers: {
      ...auth(token),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  };
}

/**
 * Download one backup's contents.
 *
 * `alt=media` returns the bytes; without it Drive returns the file's METADATA
 * as JSON, which parses successfully and yields a "snapshot" with no tables —
 * a failure that looks like an empty backup rather than a wrong request.
 */
export function downloadBackupRequest(token: string, fileId: string): DriveRequest {
  return {
    url: `${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media`,
    method: 'GET',
    headers: auth(token),
  };
}

/**
 * The single file every paired device reads and writes.
 *
 * A fixed name, unlike backups which are timestamped: sync needs ONE shared
 * state, and a new file per upload would leave each device merging against
 * whichever copy it happened to find.
 */
export const SYNC_FILENAME = 'money-manager-sync.json';

/**
 * Find the shared sync file by name inside the app's folder.
 *
 * `trashed = false` matters: a file the user deleted in Drive still matches by
 * name, and syncing into the bin would look like the data silently stopped
 * travelling between phones.
 */
export function findSyncFileRequest(token: string, folderId: string): DriveRequest {
  const query = [
    `name = '${SYNC_FILENAME}'`,
    `'${folderId}' in parents`,
    'trashed = false',
  ].join(' and ');

  return {
    url: `${DRIVE_FILES}?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&pageSize=1`,
    method: 'GET',
    headers: auth(token),
  };
}

/**
 * Overwrite the shared file IN PLACE.
 *
 * `PATCH` against the existing file id, not a fresh `POST`: uploading a new
 * file each sync would accumulate copies and, worse, leave the two phones
 * pointing at different ones. The file id is the pairing.
 */
export function updateSyncFileRequest(
  token: string,
  fileId: string,
  contents: string,
): DriveRequest {
  return {
    url: `${DRIVE_UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media&fields=id,modifiedTime`,
    method: 'PATCH',
    headers: {
      ...auth(token),
      'Content-Type': 'application/json',
    },
    body: contents,
  };
}

/** Create the shared file the first time a device syncs. */
export function createSyncFileRequest(
  token: string,
  folderId: string,
  contents: string,
): DriveRequest {
  const boundary = 'money-manager-sync-boundary';
  const metadata = JSON.stringify({ name: SYNC_FILENAME, parents: [folderId] });

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    contents,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return {
    url: `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,modifiedTime`,
    method: 'POST',
    headers: {
      ...auth(token),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  };
}

/** The file id from a find, or null when the shared file does not exist yet. */
export function parseSyncFileId(payload: unknown): string | null {
  const files = (payload as { files?: { id?: unknown }[] } | null)?.files;
  if (!Array.isArray(files) || files.length === 0) return null;
  const id = files[0]?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Delete an old backup, for pruning. */
export function deleteBackupRequest(token: string, fileId: string): DriveRequest {
  return {
    url: `${DRIVE_FILES}/${encodeURIComponent(fileId)}`,
    method: 'DELETE',
    headers: auth(token),
  };
}

/** Parse a list response, tolerating a shape that is not what we expect. */
export function parseFileList(payload: unknown): DriveFile[] {
  if (payload === null || typeof payload !== 'object') return [];

  const files = (payload as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];

  return files.filter(
    (file): file is DriveFile =>
      file !== null &&
      typeof file === 'object' &&
      typeof (file as DriveFile).id === 'string' &&
      typeof (file as DriveFile).name === 'string',
  );
}

/**
 * How many backups to keep before pruning the oldest.
 *
 * Enough to recover from a mistake noticed late — a bad restore, a category
 * deleted a month ago — without growing without bound in the user's Drive
 * quota. At a few hundred KB each this is single-digit megabytes.
 */
export const MAX_BACKUPS = 10;

/**
 * Which files to delete after a successful upload.
 *
 * Ordered newest-first by the caller, so anything past the cap is the tail.
 * Returns ids rather than performing deletions, keeping this pure — and
 * deliberately never returns the newest file, so a bug here cannot delete the
 * backup that was just made.
 */
export function backupsToPrune(files: readonly DriveFile[], keep = MAX_BACKUPS): string[] {
  if (files.length <= keep) return [];
  return files.slice(keep).map((file) => file.id);
}

/** A friendly size for the restore list. Drive reports bytes as a string. */
export function formatSize(size: string | undefined): string {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
