import { describe, expect, it } from 'vitest';
import {
  findSharedFolderRequest,
  listPermissionsRequest,
  parsePermissions,
  revokePermissionRequest,
  shareFolderRequest,
} from '~/features/backup/logic/driveSync';

describe('shareFolderRequest', () => {
  it('invites the address as a writer', () => {
    const request = shareFolderRequest('tok', 'folder-1', 'wife@example.com');
    const body = JSON.parse(request.body ?? '{}');

    expect(request.method).toBe('POST');
    expect(body).toEqual({
      type: 'user',
      role: 'writer',
      emailAddress: 'wife@example.com',
    });
  });

  /*
   * A reader could never write the shared file, so sync would appear to work on
   * one phone and silently fail on the other.
   */
  it('never invites as a reader', () => {
    const body = JSON.parse(shareFolderRequest('tok', 'f', 'a@b.com').body ?? '{}');
    expect(body.role).toBe('writer');
  });

  /* An invitation nobody sees is indistinguishable from a broken feature. */
  it('asks Drive to send the notification email', () => {
    expect(shareFolderRequest('tok', 'f', 'a@b.com').url).toContain(
      'sendNotificationEmail=true',
    );
  });

  it('escapes a folder id that needs it', () => {
    expect(shareFolderRequest('tok', 'a/b', 'x@y.com').url).toContain('a%2Fb');
  });
});

describe('findSharedFolderRequest', () => {
  /*
   * The whole reason the invited phone works: her copy of the folder is not in
   * her own Drive. Without `sharedWithMe` the app finds nothing, creates a
   * second empty folder of the same name, and both phones look paired while
   * sharing nothing at all.
   */
  it('searches what was shared WITH this account', () => {
    const url = decodeURIComponent(findSharedFolderRequest('tok').url);
    expect(url).toContain('sharedWithMe=true');
    expect(url).toContain("name='money-manager'");
    expect(url).toContain('trashed=false');
  });
});

describe('parsePermissions', () => {
  it('reads the members of a shared folder', () => {
    const members = parsePermissions({
      permissions: [
        { id: '1', emailAddress: 'me@example.com', role: 'owner', type: 'user' },
        { id: '2', emailAddress: 'wife@example.com', role: 'writer', type: 'user' },
      ],
    });

    expect(members).toHaveLength(2);
    expect(members[0].owner).toBe(true);
    expect(members[1].owner).toBe(false);
    expect(members[1].email).toBe('wife@example.com');
  });

  /* Drive omits the address on some permission types; the row must survive. */
  it('keeps a member whose email Drive did not return', () => {
    const members = parsePermissions({ permissions: [{ id: '9', role: 'writer' }] });
    expect(members[0].email).toBeNull();
  });

  it('is empty for a malformed payload', () => {
    expect(parsePermissions(null)).toEqual([]);
    expect(parsePermissions({})).toEqual([]);
    expect(parsePermissions({ permissions: 'nope' })).toEqual([]);
  });

  it('drops entries with no id rather than inventing one', () => {
    expect(parsePermissions({ permissions: [{ role: 'writer' }] })).toEqual([]);
  });
});

describe('revokePermissionRequest', () => {
  it('deletes the named permission', () => {
    const request = revokePermissionRequest('tok', 'folder-1', 'perm-7');
    expect(request.method).toBe('DELETE');
    expect(request.url).toContain('/folder-1/permissions/perm-7');
  });
});

describe('listPermissionsRequest', () => {
  it('asks for the fields the screen renders', () => {
    const url = decodeURIComponent(listPermissionsRequest('tok', 'f').url);
    expect(url).toContain('emailAddress');
    expect(url).toContain('role');
  });
});
