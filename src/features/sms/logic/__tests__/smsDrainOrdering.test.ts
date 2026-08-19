import { describe, expect, it } from 'vitest';
import { fingerprintMessage, planDrain, RECORD_SEPARATOR } from '../smsInbox';

/**
 * Guards the crash-safety contract of the file → database drain.
 *
 * `drainInbox` in services/smsInboxFile.ts hands the batch to a `commit`
 * callback and clears the file only after it returns. The real function needs a
 * device filesystem, so this reproduces that ordering over an in-memory file and
 * an in-memory table — enough, because the property under test is purely one of
 * *ordering*, exactly like smsIntakeDrain.test.ts does for the deep-link buffer.
 *
 * The bug being guarded is the one the previous design shipped with: clearing
 * the file first meant an interrupted import destroyed real transactions,
 * because nothing had persisted them yet.
 */

/** A stand-in for the `sms_inbox` table, including its unique fingerprint index. */
function makeTable() {
  const rows = new Map<string, string>();
  return {
    add(message: string): boolean {
      const key = fingerprintMessage(message);
      if (rows.has(key)) return false;
      rows.set(key, message);
      return true;
    },
    get size() {
      return rows.size;
    },
    messages() {
      return [...rows.values()];
    },
  };
}

/** `drainInbox`'s ordering, verbatim in behaviour, over a string "file". */
function drain(file: { contents: string | null }, commit: (messages: string[]) => void) {
  if (file.contents === null) return { ok: true, taken: 0 };

  const plan = planDrain(file.contents);
  if (plan.messages.length === 0) return { ok: true, taken: 0 };

  // Persist first — a throw here must leave the file untouched.
  commit(plan.messages);

  file.contents = plan.remainder ? plan.remainder : null;
  return { ok: true, taken: plan.messages.length };
}

const MSG_A = 'LKR 100.00 debited from AC XXXX1111 at SHOP A';
const MSG_B = 'LKR 200.00 debited from AC XXXX2222 at SHOP B';
const FILE = `${MSG_A}\n${RECORD_SEPARATOR}\n${MSG_B}`;

describe('drain ordering', () => {
  it('stores every message and then clears the file', () => {
    const file = { contents: FILE };
    const table = makeTable();

    drain(file, (messages) => messages.forEach((m) => table.add(m)));

    expect(table.size).toBe(2);
    expect(file.contents).toBeNull();
  });

  it('leaves the file intact when storing throws, so nothing is lost', () => {
    const file = { contents: FILE };

    expect(() =>
      drain(file, () => {
        throw new Error('database unavailable');
      }),
    ).toThrow();

    // The whole point: the messages are still on disk to retry.
    expect(file.contents).toBe(FILE);
  });

  /*
   * The replay that the new ordering makes possible — and which is only
   * acceptable because the fingerprint index absorbs it.
   */
  it('is idempotent when a crashed drain replays the same batch', () => {
    const table = makeTable();

    const first = { contents: FILE };
    // The crash tears down the process; the next launch is a separate `drain`.
    expect(() =>
      drain(first, (messages) => {
        messages.forEach((m) => table.add(m));
        throw new Error('killed after writing rows, before clearing the file');
      }),
    ).toThrow();
    expect(first.contents).toBe(FILE);

    // The file survived, so the next launch drains it again.
    const second = { contents: FILE };
    drain(second, (messages) => messages.forEach((m) => table.add(m)));

    expect(table.size).toBe(2);
    expect(table.messages()).toEqual([MSG_A, MSG_B]);
    expect(second.contents).toBeNull();
  });

  it('keeps messages above the cap in the file for the next drain', () => {
    const many = Array.from({ length: 60 }, (_, i) => `LKR ${i + 1}.00 debited at SHOP ${i}`);
    const file = { contents: many.join(`\n${RECORD_SEPARATOR}\n`) };
    const table = makeTable();

    drain(file, (messages) => messages.forEach((m) => table.add(m)));

    expect(table.size).toBe(50);
    // The remainder must round-trip, or a capped drain would corrupt the queue.
    expect(planDrain(file.contents ?? '', 99).messages).toHaveLength(10);
  });
});
