import { describe, expect, it } from 'vitest';
import {
  formatImageRef,
  hasImage,
  localRef,
  needsUpload,
  parseImageRef,
  withDriveId,
  withoutLocal,
} from '~/shared/lib/imageRef';

/**
 * The stored form of an attached photo.
 *
 * Eight tables hold this column, so the format has to survive being read by
 * code that predates it and written by code that postdates it. The cases that
 * matter are the mixed ones: a photo that exists in both places, and a row
 * written before Drive uploads existed at all.
 */
describe('parseImageRef', () => {
  const LOCAL = 'file:///var/mobile/Containers/Data/x/Documents/transaction-photos/1.jpg';

  /*
   * Every row written before this format existed holds a bare path. If those
   * did not parse, every existing receipt in the app would vanish at once.
   */
  it('reads a legacy bare file:// path as local-only', () => {
    expect(parseImageRef(LOCAL)).toEqual({ driveId: null, localUri: LOCAL });
  });

  it('reads an uploaded photo that still has its local copy', () => {
    expect(parseImageRef(`drive:1a2B3c|${LOCAL}`)).toEqual({
      driveId: '1a2B3c',
      localUri: LOCAL,
    });
  });

  it('reads a photo that exists only in Drive', () => {
    expect(parseImageRef('drive:1a2B3c')).toEqual({ driveId: '1a2B3c', localUri: null });
  });

  it('treats an absent or empty value as no photo', () => {
    expect(parseImageRef(null)).toEqual({ driveId: null, localUri: null });
    expect(parseImageRef(undefined)).toEqual({ driveId: null, localUri: null });
    expect(parseImageRef('')).toEqual({ driveId: null, localUri: null });
  });

  /*
   * This runs while rendering a list. A malformed value must read as "no
   * photo", never throw — a corrupt string should cost one missing thumbnail,
   * not the screen.
   */
  it('never throws on malformed input', () => {
    expect(() => parseImageRef('drive:')).not.toThrow();
    expect(parseImageRef('drive:')).toEqual({ driveId: null, localUri: null });
    expect(() => parseImageRef('|||')).not.toThrow();
    expect(parseImageRef('|||')).toEqual({ driveId: null, localUri: null });
  });
});

describe('formatImageRef', () => {
  it('round-trips every state', () => {
    for (const ref of [
      { driveId: 'abc', localUri: 'file:///a.jpg' },
      { driveId: 'abc', localUri: null },
      { driveId: null, localUri: 'file:///a.jpg' },
    ]) {
      expect(parseImageRef(formatImageRef(ref))).toEqual(ref);
    }
  });

  /*
   * Null rather than "", so the column reads as "no photo" rather than as a
   * photo whose path was lost — a distinction the screens act on.
   */
  it('is null when there is nothing to store', () => {
    expect(formatImageRef({ driveId: null, localUri: null })).toBeNull();
  });

  it('puts the drive id first, so the portable half leads', () => {
    expect(formatImageRef({ driveId: 'abc', localUri: 'file:///a.jpg' })).toBe(
      'drive:abc|file:///a.jpg',
    );
  });
});

describe('transitions', () => {
  const LOCAL = 'file:///a.jpg';

  it('a freshly picked photo is local and needs uploading', () => {
    const stored = localRef(LOCAL);
    expect(needsUpload(stored)).toBe(true);
    expect(hasImage(stored)).toBe(true);
  });

  it('recording the upload keeps the local copy', () => {
    const uploaded = withDriveId(localRef(LOCAL), 'abc');
    expect(parseImageRef(uploaded)).toEqual({ driveId: 'abc', localUri: LOCAL });
    // Already up: a second pass must not re-upload it.
    expect(needsUpload(uploaded)).toBe(false);
  });

  /*
   * The receiving device caches a download, but the cache is disposable — the
   * reference must not claim a path that may be swept away.
   */
  it('dropping the local copy leaves a usable Drive reference', () => {
    const remote = withoutLocal(withDriveId(localRef(LOCAL), 'abc'));
    expect(parseImageRef(remote)).toEqual({ driveId: 'abc', localUri: null });
    expect(hasImage(remote)).toBe(true);
    expect(needsUpload(remote)).toBe(false);
  });

  it('a photo that was never attached needs nothing', () => {
    expect(needsUpload(null)).toBe(false);
    expect(hasImage(null)).toBe(false);
  });

  /* A legacy row is exactly the thing the upload pass should pick up. */
  it('treats a legacy bare path as pending upload', () => {
    expect(needsUpload(LOCAL)).toBe(true);
  });
});
