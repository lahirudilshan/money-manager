import { describe, expect, it } from 'vitest';
import {
  backupsToPrune,
  BACKUP_FOLDER_NAME,
  createFolderRequest,
  DRIVE_SCOPE,
  findFolderRequest,
  parseFolderId,
  deleteBackupRequest,
  downloadBackupRequest,
  formatSize,
  listBackupsRequest,
  MAX_BACKUPS,
  parseFileList,
  uploadBackupRequest,
  type DriveFile,
} from '../driveSync';

const TOKEN = 'ya29.test-token';

describe('scope', () => {
  it('asks only for files this app created', () => {
    /*
     * The privacy promise. `drive.file` cannot read anything the app did not
     * create — the user's documents are untouchable — while still allowing a
     * VISIBLE folder they can open and verify. Full `drive` would grant read
     * access to everything, which a backup has no business asking for.
     */
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    expect(DRIVE_SCOPE).not.toBe('https://www.googleapis.com/auth/drive');
  });
});

describe('the backup folder', () => {
  it('is named money-manager', () => {
    expect(BACKUP_FOLDER_NAME).toBe('money-manager');
  });

  it('looks for an existing folder before making one', () => {
    const request = findFolderRequest(TOKEN);
    expect(decodeURIComponent(request.url)).toContain("name='money-manager'");
    expect(decodeURIComponent(request.url)).toContain('mimeType=');
  });

  it('excludes trashed folders from the search', () => {
    /*
     * A folder the user deleted still matches by name for 30 days, and
     * uploading into a trashed folder SUCCEEDS — the backup would exist and be
     * invisible.
     */
    expect(decodeURIComponent(findFolderRequest(TOKEN).url)).toContain('trashed=false');
  });

  it('creates it as a folder, not a file', () => {
    const request = createFolderRequest(TOKEN);
    expect(request.method).toBe('POST');
    expect(request.body).toContain('application/vnd.google-apps.folder');
    expect(request.body).toContain('money-manager');
  });

  it('reads the folder id from either a create or a search response', () => {
    expect(parseFolderId({ id: 'folder-1' })).toBe('folder-1');
    expect(parseFolderId({ files: [{ id: 'folder-2' }] })).toBe('folder-2');
    expect(parseFolderId({ files: [] })).toBeNull();
    expect(parseFolderId(null)).toBeNull();
  });
});

describe('listBackupsRequest', () => {
  const request = listBackupsRequest(TOKEN, 'folder-1');

  it('lists only what is inside the backup folder', () => {
    // Scoped by PARENT, so a file the user renamed in Drive is still found.
    // `URLSearchParams` encodes spaces as `+`, so normalise before matching.
    const query = decodeURIComponent(request.url).replace(/\+/g, ' ');
    expect(query).toContain("'folder-1' in parents");
    expect(decodeURIComponent(request.url)).toContain('trashed=false');
  });

  it('orders newest first and asks for the fields the UI shows', () => {
    expect(request.url).toContain('orderBy=modifiedTime+desc');
    expect(decodeURIComponent(request.url)).toContain('modifiedTime');
  });

  it('carries the bearer token', () => {
    expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe('uploadBackupRequest', () => {
  const request = uploadBackupRequest(
    TOKEN,
    'money-manager-2026-08-04.json',
    '{"version":1}',
    'folder-1',
  );

  it('uploads into the backup folder', () => {
    expect(request.body).toContain('"parents":["folder-1"]');
  });

  it('sends metadata and content in ONE multipart request', () => {
    // Two calls would leave an orphaned empty file when the second fails.
    expect(request.url).toContain('uploadType=multipart');
    expect(request.headers['Content-Type']).toContain('multipart/related; boundary=');
    expect(request.body).toContain('{"version":1}');
  });

  it('closes the multipart body', () => {
    // An unterminated body is accepted by Drive and stores a truncated file.
    expect(request.body?.trimEnd().endsWith('--money-manager-backup-boundary--')).toBe(true);
  });
});

describe('downloadBackupRequest', () => {
  it('asks for the bytes, not the metadata', () => {
    /*
     * Without `alt=media` Drive returns the file's METADATA as JSON, which
     * parses fine and yields a snapshot with no tables — a failure that reads
     * as an empty backup rather than a wrong request.
     */
    expect(downloadBackupRequest(TOKEN, 'file-1').url).toContain('alt=media');
  });

  it('escapes the file id', () => {
    expect(downloadBackupRequest(TOKEN, 'a/b c').url).toContain('a%2Fb%20c');
  });
});

describe('deleteBackupRequest', () => {
  it('targets one file by id', () => {
    const request = deleteBackupRequest(TOKEN, 'file-1');
    expect(request.method).toBe('DELETE');
    expect(request.url).toMatch(/files\/file-1$/);
  });
});

describe('parseFileList', () => {
  it('reads a normal response', () => {
    const files = parseFileList({
      files: [{ id: '1', name: 'a.json', modifiedTime: '2026-08-04T00:00:00Z' }],
    });
    expect(files).toHaveLength(1);
  });

  it('survives a response that is not the shape we expect', () => {
    // An auth error or an HTML error page must not crash the restore screen.
    expect(parseFileList(null)).toEqual([]);
    expect(parseFileList({})).toEqual([]);
    expect(parseFileList({ files: 'nope' })).toEqual([]);
    expect(parseFileList({ files: [null, 42, { id: '1', name: 'a' }] })).toHaveLength(1);
  });
});

describe('backupsToPrune', () => {
  function files(count: number): DriveFile[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `f${i}`,
      name: `money-manager-${i}.json`,
      modifiedTime: '2026-08-04T00:00:00Z',
    }));
  }

  it('keeps everything below the cap', () => {
    expect(backupsToPrune(files(MAX_BACKUPS))).toEqual([]);
  });

  it('drops the oldest beyond the cap', () => {
    const prune = backupsToPrune(files(MAX_BACKUPS + 3));
    expect(prune).toHaveLength(3);
  });

  it('NEVER prunes the newest file', () => {
    // The list is newest-first, so a bug here could delete the backup that was
    // just taken. Asserted explicitly because the cost is total.
    const all = files(MAX_BACKUPS + 5);
    expect(backupsToPrune(all)).not.toContain(all[0].id);
  });
});

describe('formatSize', () => {
  it('reads bytes as Drive reports them — a string', () => {
    expect(formatSize('512')).toBe('512 B');
    expect(formatSize('2048')).toBe('2 KB');
    expect(formatSize('3145728')).toBe('3.0 MB');
  });

  it('says nothing when the size is missing or nonsense', () => {
    expect(formatSize(undefined)).toBe('');
    expect(formatSize('not a number')).toBe('');
  });
});
