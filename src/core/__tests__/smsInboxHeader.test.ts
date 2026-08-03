import { describe, expect, it } from 'vitest';
import { parseInbox, planDrain } from '../smsInbox';

/**
 * The seed-header/first-message fusion bug.
 *
 * The inbox file is created holding a `#`-commented header that ends in PROSE,
 * not in a separator. A Shortcuts automation then appends `<message>---`. Since
 * a record boundary is only ever a run of dashes, the header and the first
 * message land in the SAME record:
 *
 *   # money-manager SMS inbox — TEMPORARY HANDOFF FILE
 *   # ...
 *   # End each message with three dash characters (a new line is optional).
 *   LKR 1,038.30 debited from AC 6796---
 *
 * `parseSms` sees a block beginning with `#`, rejects it, and the drain files it
 * under "not a transaction" — and then clears the file, because the drain
 * succeeded. The user watches their message disappear from the Files app and
 * nothing arrives in the app. No error is logged anywhere.
 *
 * Critically this hit the FIRST message of every drain and spared the rest, so
 * it read as flaky rather than as the systematic total loss it was.
 *
 * The fix strips `#` lines per record. These tests pin the real Shortcut output
 * shapes, because the format's whole purpose is tolerating what users build.
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

const REAL_SMS = 'LKR 1,038.30 debited from AC 6796 at KEELLS on 02/08.';

describe('inbox seed header', () => {
  /** The exact regression: one message appended to a freshly created inbox. */
  it('does not swallow the first message appended after the header', () => {
    const messages = parseInbox(`${SEED_HEADER}${REAL_SMS}---`);

    expect(messages).toEqual([REAL_SMS]);
  });

  /**
   * The shape that made it look intermittent: only message one was lost, so a
   * user testing with a burst saw "some of them worked".
   */
  it('keeps every message when several are appended in one burst', () => {
    const messages = parseInbox(`${SEED_HEADER}FIRST 500.00---SECOND 900.00---THIRD 120.00---`);

    expect(messages).toEqual(['FIRST 500.00', 'SECOND 900.00', 'THIRD 120.00']);
  });

  /** The other common Shortcut build: a newline before and after the dashes. */
  it('keeps the first message in the newline-separated style', () => {
    const messages = parseInbox(`${SEED_HEADER}\nFIRST 500.00\n---\nSECOND 900.00\n---\n`);

    expect(messages).toEqual(['FIRST 500.00', 'SECOND 900.00']);
  });

  /** Some Shortcuts actions emit CRLF. */
  it('keeps the first message when the automation writes CRLF', () => {
    const messages = parseInbox(`${SEED_HEADER}\r\nFIRST 500.00\r\n---\r\nSECOND 900.00\r\n`);

    expect(messages).toEqual(['FIRST 500.00', 'SECOND 900.00']);
  });

  /**
   * A drained inbox holds only the header, and must read as EMPTY.
   *
   * This is also what the Smart Detect screen counts, so before the fix an idle
   * inbox reported "1 waiting" forever.
   */
  it('reports an untouched header as no waiting messages', () => {
    expect(parseInbox(SEED_HEADER)).toEqual([]);
  });

  /** A bank alert spanning several lines must survive whole. */
  it('preserves the internal newlines of a multi-line bank message', () => {
    const multiline = 'Dear Customer,\nLKR 500.00 spent at SPAR.\nAvail bal 1,200.00';

    expect(parseInbox(`${SEED_HEADER}${multiline}---`)).toEqual([multiline]);
  });

  /** A note the user adds themselves must not corrupt the message beside it. */
  it('strips a user comment without damaging the adjacent message', () => {
    expect(parseInbox(`# my own note\n${REAL_SMS}---`)).toEqual([REAL_SMS]);
  });

  /** Nothing here may depend on the header being present. */
  it('still parses a file that has no header at all', () => {
    expect(parseInbox('FIRST 500.00---SECOND 900.00')).toEqual([
      'FIRST 500.00',
      'SECOND 900.00',
    ]);
  });

  /**
   * A capped drain writes its remainder back WITHOUT the header, and the next
   * drain must read those messages back identically — including the one that
   * used to be first.
   */
  it('round-trips the deferred remainder of a capped drain', () => {
    const file = `${SEED_HEADER}${['M0', 'M1', 'M2', 'M3', 'M4'].join('---')}---`;

    const plan = planDrain(file, 2);

    expect(plan.messages).toEqual(['M0', 'M1']);
    expect(plan.deferred).toBe(3);
    expect(parseInbox(plan.remainder)).toEqual(['M2', 'M3', 'M4']);
  });
});
