import { describe, expect, it } from 'vitest';
import {
  applyUpload,
  attachmentFilename,
  describeImageSync,
  isRetryable,
  nextBatch,
  pendingUploads,
  UPLOAD_BATCH,
  type PendingImage,
} from '~/features/backup/logic/imageSync';
import { parseImageRef } from '~/shared/lib/imageRef';

const LOCAL = 'file:///var/mobile/Documents/transaction-photos/1.jpg';

describe('pendingUploads', () => {
  it('picks up a freshly attached photo', () => {
    const pending = pendingUploads({
      transactions: [{ id: 't1', image_uri: LOCAL }],
    });

    expect(pending).toEqual([
      { table: 'transactions', rowId: 't1', stored: LOCAL, localUri: LOCAL },
    ]);
  });

  /*
   * Rows written before this feature hold a bare path with no drive marker.
   * They are the backlog the first pass exists to clear, so they must not be
   * mistaken for already-uploaded.
   */
  it('includes legacy rows that predate Drive uploads', () => {
    expect(pendingUploads({ buddy_loans: [{ id: 'b1', image_uri: LOCAL }] })).toHaveLength(1);
  });

  it('skips a photo already in Drive', () => {
    const pending = pendingUploads({
      transactions: [{ id: 't1', image_uri: `drive:abc|${LOCAL}` }],
    });
    expect(pending).toEqual([]);
  });

  it('skips a row with no photo', () => {
    expect(pendingUploads({ transactions: [{ id: 't1', image_uri: null }] })).toEqual([]);
  });

  /* A reference with an id but no local copy has nothing left to send. */
  it('skips a Drive-only photo', () => {
    expect(pendingUploads({ vehicles: [{ id: 'v1', image_uri: 'drive:abc' }] })).toEqual([]);
  });

  it('walks every table that can hold a photo', () => {
    const pending = pendingUploads({
      transactions: [{ id: 't1', image_uri: LOCAL }],
      fuel_entries: [{ id: 'f1', image_uri: LOCAL }],
      health_documents: [{ id: 'h1', image_uri: LOCAL }],
    });
    expect(pending.map((p) => p.table)).toEqual([
      'transactions',
      'fuel_entries',
      'health_documents',
    ]);
  });

  it('is empty for an empty board', () => {
    expect(pendingUploads({})).toEqual([]);
  });
});

describe('applyUpload', () => {
  const pending: PendingImage = {
    table: 'transactions',
    rowId: 't1',
    stored: LOCAL,
    localUri: LOCAL,
  };

  /*
   * The local path stays. This device already holds the bytes, and dropping it
   * would make the phone that took the photo re-download its own file.
   */
  it('records the drive id and keeps the local copy', () => {
    const outcome = applyUpload(pending, 'abc');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(parseImageRef(outcome.nextStored)).toEqual({ driveId: 'abc', localUri: LOCAL });
  });

  it('leaves the row no longer pending', () => {
    const outcome = applyUpload(pending, 'abc');
    if (!outcome.ok) throw new Error('expected success');

    expect(
      pendingUploads({ transactions: [{ id: 't1', image_uri: outcome.nextStored }] }),
    ).toEqual([]);
  });
});

describe('isRetryable', () => {
  /*
   * A photo whose file is gone cannot be uploaded by any number of retries,
   * and a permanent entry in the queue would starve every later row.
   */
  it('gives up on a missing local file', () => {
    expect(isRetryable({ code: 'ENOENT' })).toBe(false);
  });

  it('keeps trying when offline or the server is unwell', () => {
    expect(isRetryable(null)).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
  });

  /* The token refreshes, so the same upload succeeds next pass. */
  it('keeps trying after an expired token', () => {
    expect(isRetryable({ status: 401 })).toBe(true);
  });

  it('gives up on a request that is simply wrong', () => {
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 403 })).toBe(false);
    expect(isRetryable({ status: 404 })).toBe(false);
  });
});

describe('nextBatch', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    table: 'transactions' as const,
    rowId: `t${i}`,
    stored: LOCAL,
    localUri: LOCAL,
  }));

  /*
   * A board with a year of receipts would otherwise attempt every upload at
   * once, on whatever connection the phone has.
   */
  it('caps one pass', () => {
    expect(nextBatch(many)).toHaveLength(UPLOAD_BATCH);
  });

  it('takes everything when there is less than a batch', () => {
    expect(nextBatch(many.slice(0, 3))).toHaveLength(3);
  });

  it('is empty rather than negative for a nonsense limit', () => {
    expect(nextBatch(many, -5)).toEqual([]);
  });
});

describe('describeImageSync', () => {
  it('counts what moved and what is left', () => {
    const report = describeImageSync(
      [
        { ok: true, table: 'transactions', rowId: 'a', nextStored: 'drive:1' },
        { ok: true, table: 'transactions', rowId: 'b', nextStored: 'drive:2' },
        { ok: false, table: 'transactions', rowId: 'c', error: 'offline', retryable: true },
      ],
      10,
    );

    expect(report).toEqual({ uploaded: 2, failed: 1, remaining: 8 });
  });

  it('never reports a negative remainder', () => {
    expect(describeImageSync([], 0).remaining).toBe(0);
  });
});

describe('attachmentFilename', () => {
  /* Drive shows these in a folder the user can open. */
  it('names the file after the record it belongs to', () => {
    expect(
      attachmentFilename({
        table: 'fuel_entries',
        rowId: 'f1',
        stored: LOCAL,
        localUri: LOCAL,
      }),
    ).toBe('fuel_entries-f1.jpg');
  });

  it('keeps a real extension', () => {
    expect(
      attachmentFilename({
        table: 'transactions',
        rowId: 't1',
        stored: 'file:///a.png',
        localUri: 'file:///a.png',
      }),
    ).toBe('transactions-t1.png');
  });

  /* A path with no usable extension still has to produce a valid filename. */
  it('falls back to jpg for anything odd', () => {
    expect(
      attachmentFilename({
        table: 'transactions',
        rowId: 't1',
        stored: 'file:///photo',
        localUri: 'file:///photo',
      }),
    ).toBe('transactions-t1.jpg');
  });
});
