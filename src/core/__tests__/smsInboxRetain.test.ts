import { describe, expect, it } from 'vitest';
import { parseInbox, planDrain, RECORD_SEPARATOR } from '../smsInbox';

/**
 * Messages the parser cannot read must SURVIVE the drain.
 *
 * `drainInbox` used to clear the file unconditionally once `commit` returned.
 * But `commit` stores nothing for a message `parseSms` rejects — it just counts
 * it as "not a transaction" — so the clear destroyed the only copy of the text.
 * From the user's side: the SMS is visible in the Files app, they open the app,
 * the file empties, and no draft ever appears. Nothing is logged, and the
 * evidence needed to fix the parser is gone.
 *
 * `commit` now returns the messages it could not consume, and the drain writes
 * them back. A parser gap becomes a message still sitting in the file — visible,
 * reportable, and imported retroactively once the parser learns the format.
 *
 * These tests cover the rewrite arithmetic that makes that safe. The file I/O
 * itself needs a device, but the round-trip below is where the bugs live: what
 * is written back must re-parse to exactly what was kept, or a drain would
 * corrupt the queue it just preserved.
 */

/** Byte-identical to `SEED_HEADER` in services/smsInboxFile.ts. */
const SEED_HEADER = [
  '# money-manager SMS inbox — TEMPORARY HANDOFF FILE',
  '#',
  '# Your Shortcuts automation appends bank messages here. The app moves',
  '# each one into its database and clears them from this file, so seeing',
  '# only these lines means everything has been imported.',
  '#',
  '# End each message with three dash characters (a new line is optional).',
  '',
].join('\n');

/**
 * The rewrite `drainInbox` performs, in pure form.
 *
 * `unconsumed` are messages `commit` handed back; `remainder` is what the
 * per-drain cap deferred. Both must end up in the file.
 */
function rewrite(unconsumed: string[], remainder: string): string {
  const kept = [...unconsumed, remainder].filter((part) => part.length > 0);

  return kept.length > 0
    ? `${SEED_HEADER}${RECORD_SEPARATOR}\n${kept.join(`\n${RECORD_SEPARATOR}\n`)}\n`
    : SEED_HEADER;
}

const UNREADABLE = 'Some format the parser has never seen, ref 99XZ';
const OTHER_UNREADABLE = 'Another unknown shape, code 42';

describe('drain retains what it could not store', () => {
  /** The regression: an unreadable message must still be in the file after. */
  it('writes an unreadable message back into the file', () => {
    const after = rewrite([UNREADABLE], '');

    expect(parseInbox(after)).toEqual([UNREADABLE]);
  });

  /** A fully-consumed batch must leave the file empty, or it never drains. */
  it('leaves only the header when everything was consumed', () => {
    const after = rewrite([], '');

    expect(after).toBe(SEED_HEADER);
    expect(parseInbox(after)).toEqual([]);
  });

  /**
   * The mixed batch, which is the realistic one: some messages import, one does
   * not. Only the failure is kept, so the good ones are not re-imported.
   */
  it('keeps only the unreadable message from a mixed batch', () => {
    // Two parsed fine and were stored; one did not.
    const after = rewrite([UNREADABLE], '');

    expect(parseInbox(after)).toEqual([UNREADABLE]);
    expect(parseInbox(after)).not.toContain('LKR 500.00 debited from AC 6796');
  });

  /** Cap-deferred messages and unreadable ones must BOTH survive together. */
  it('preserves unreadable messages alongside a capped remainder', () => {
    const remainder = ['M8', 'M9'].join(`\n${RECORD_SEPARATOR}\n`);

    const after = rewrite([UNREADABLE], remainder);

    expect(parseInbox(after)).toEqual([UNREADABLE, 'M8', 'M9']);
  });

  /** Several failures in one batch all come back. */
  it('writes back every unreadable message in the batch', () => {
    const after = rewrite([UNREADABLE, OTHER_UNREADABLE], '');

    expect(parseInbox(after)).toEqual([UNREADABLE, OTHER_UNREADABLE]);
  });

  /** A multi-line unreadable message must not be split by the rewrite. */
  it('preserves the newlines inside a retained message', () => {
    const multiline = 'Dear Customer,\nSomething unrecognised happened.\nRef 77';

    expect(parseInbox(rewrite([multiline], ''))).toEqual([multiline]);
  });

  /**
   * The retained message must survive REPEATED drains unchanged.
   *
   * The watcher re-drains every couple of seconds, so a rewrite that mangled
   * the text a little each pass would corrupt it into nonsense within a minute.
   */
  it('is stable across repeated drain cycles', () => {
    let file = rewrite([UNREADABLE], '');

    for (let i = 0; i < 5; i += 1) {
      const plan = planDrain(file);
      // The parser still cannot read it, so it is handed straight back.
      file = rewrite(plan.messages, plan.remainder);
    }

    expect(parseInbox(file)).toEqual([UNREADABLE]);
  });
});
