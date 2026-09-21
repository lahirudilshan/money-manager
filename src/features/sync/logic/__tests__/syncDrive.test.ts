import { describe, expect, it, vi } from 'vitest';

/*
 * `backupRepo` reaches for expo-sqlite, which does not exist under node. The
 * sync orchestration's decisions are what these tests are about, so the two
 * database calls are stubbed and every other branch runs for real.
 */
const applyMerged = vi.fn(() => ({ ok: true, written: {}, skipped: [] }));
const exportForSync = vi.fn(() => ({ t: [{ id: 'mine', updated_at: 100 }] }));

vi.mock('~/features/backup/logic/backupRepo', () => ({
  applyMerged: (...args: unknown[]) => applyMerged(...(args as [])),
  exportForSync: () => exportForSync(),
}));

import { countRows, parseSyncFile, runSync, type DriveGateway } from '~/features/sync/logic/syncDrive';

/** A gateway that succeeds, with overridable pieces per test. */
function gateway(over: Partial<DriveGateway> = {}): DriveGateway {
  return {
    token: async () => 'tok',
    folder: async () => 'folder',
    send: async () => ({ id: 'file-1' }),
    download: async () => ({ ok: true, contents: JSON.stringify({ t: [] }) }),
    ...over,
  };
}

describe('parseSyncFile', () => {
  it('reads a well-formed file', () => {
    expect(parseSyncFile('{"t":[{"id":"a"}]}')).toEqual({ t: [{ id: 'a' }] });
  });

  it('rejects anything that is not a table map', () => {
    expect(parseSyncFile('not json')).toBeNull();
    expect(parseSyncFile('[1,2,3]')).toBeNull();
    expect(parseSyncFile('{"t":"not an array"}')).toBeNull();
  });

  /* A newer device's table must survive a round trip through an older one. */
  it('keeps tables this build does not know about', () => {
    const parsed = parseSyncFile('{"future_feature":[{"id":"x"}]}');
    expect(parsed?.future_feature).toHaveLength(1);
  });
});

describe('runSync', () => {
  it('asks the user to reconnect when the account is gone', async () => {
    const result = await runSync(gateway({ token: async () => null }), { fileId: null });
    expect(result.ok).toBe(false);
    expect(result.signedOut).toBe(true);
  });

  it('creates the shared file on the first ever sync', async () => {
    const send = vi.fn(async (req: { method: string }) =>
      req.method === 'GET' ? { files: [] } : { id: 'new-file' },
    );
    const result = await runSync(gateway({ send }), { fileId: null });

    expect(result.ok).toBe(true);
    expect(result.fileId).toBe('new-file');
    // Nothing to pull from a file that did not exist.
    expect(result.pulled).toBe(0);
    expect(result.pushed).toBe(1);
  });

  it('merges the other device and reports what moved', async () => {
    const send = vi.fn(async () => ({ id: 'file-1' }));
    const result = await runSync(
      gateway({
        send,
        download: async () => ({
          ok: true,
          contents: JSON.stringify({ t: [{ id: 'theirs', updated_at: 200 }] }),
        }),
      }),
      { fileId: 'file-1' },
    );

    expect(result.ok).toBe(true);
    expect(result.pulled).toBe(1);
    expect(result.pushed).toBe(1);
    expect(applyMerged).toHaveBeenCalled();
  });

  /*
   * The most destructive thing this code could do is overwrite a file it failed
   * to understand — that would wipe whatever the other phone last wrote.
   */
  it('refuses to overwrite a file it cannot parse', async () => {
    const send = vi.fn(async () => ({ id: 'file-1' }));
    const result = await runSync(
      gateway({ send, download: async () => ({ ok: true, contents: 'corrupt' }) }),
      { fileId: 'file-1' },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/left untouched/i);
    // No PATCH was attempted.
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps their changes locally even when the upload fails', async () => {
    const result = await runSync(
      gateway({
        send: async () => null,
        download: async () => ({
          ok: true,
          contents: JSON.stringify({ t: [{ id: 'theirs', updated_at: 200 }] }),
        }),
      }),
      { fileId: 'file-1' },
    );

    expect(result.ok).toBe(false);
    // Pulled rows were written before the upload was attempted.
    expect(result.pulled).toBe(1);
    expect(result.pushed).toBe(0);
    expect(applyMerged).toHaveBeenCalled();
  });

  it('reports a download failure without touching local data', async () => {
    applyMerged.mockClear();
    const result = await runSync(
      gateway({ download: async () => ({ ok: false, error: 'offline' }) }),
      { fileId: 'file-1' },
    );

    expect(result.ok).toBe(false);
    expect(applyMerged).not.toHaveBeenCalled();
  });
});

describe('countRows', () => {
  it('totals rows across tables', () => {
    expect(countRows({ a: [1, 2], b: [3] })).toBe(3);
    expect(countRows({})).toBe(0);
  });
});
