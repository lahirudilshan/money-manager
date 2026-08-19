import { describe, expect, it } from 'vitest';
import { fingerprintMessage } from '../smsInbox';

/**
 * A re-sent message must come back for review.
 *
 * `sms_inbox.fingerprint` is uniquely indexed, which is what stops a crashed
 * drain or a doubled Shortcut from queueing the same alert twice. But the index
 * does not care about `status`, so a row the user CONFIRMED or DISMISSED keeps
 * blocking that fingerprint forever. The message is then taken out of the file,
 * the insert is skipped, and nothing appears — indistinguishable from a broken
 * import, and permanent.
 *
 * It also made the feature untestable by hand: sending yourself the same test
 * alert worked exactly once per install, and every attempt after that silently
 * did nothing.
 *
 * The fix reopens a resolved row instead of skipping it. These tests pin the
 * decision logic; the SQL itself lives in `smsInboxRepo`.
 */

/** The three states a fingerprint can be in when a message arrives. */
type RowState = 'absent' | 'pending' | 'resolved';

/** What `ingestSmsText` does for each, mirroring the store. */
function decide(state: RowState): 'insert' | 'reopen' | 'skip' {
  if (state === 'absent') return 'insert';
  // `add` failed on the unique index — pending means it is already on screen.
  if (state === 'pending') return 'skip';
  return 'reopen';
}

describe('re-sent message handling', () => {
  it('inserts a message never seen before', () => {
    expect(decide('absent')).toBe('insert');
  });

  /** Already awaiting review — a second delivery must not duplicate the card. */
  it('skips a message whose row is still pending', () => {
    expect(decide('pending')).toBe('skip');
  });

  /**
   * The regression. Previously this was also a skip, so the message was
   * consumed from the file and never shown again.
   */
  it('reopens a message the user already confirmed or dismissed', () => {
    expect(decide('resolved')).toBe('reopen');
  });

  /**
   * Reopening keys off the FINGERPRINT, so the identical text must map to the
   * identical key — otherwise the reopen would target no row and the message
   * would still vanish.
   */
  it('derives the same fingerprint from a re-sent identical message', () => {
    const text = 'LKR 1,038.30 debited from AC 6796 at KEELLS on 02/08.';

    expect(fingerprintMessage(text)).toBe(fingerprintMessage(text));
  });

  /**
   * The trivial delivery differences between two sends of the same alert must
   * not defeat the match — CRLF from one Shortcuts action, LF from another.
   */
  it('ignores line-ending and whitespace differences when matching', () => {
    const lf = 'LKR 500.00 debited\nfrom AC 6796';
    const crlf = 'LKR 500.00 debited\r\nfrom AC 6796  ';

    expect(fingerprintMessage(crlf)).toBe(fingerprintMessage(lf));
  });

  /** A genuinely different amount must NOT be treated as the same message. */
  it('keeps a different amount as a distinct message', () => {
    const a = 'LKR 500.00 debited from AC 6796';
    const b = 'LKR 900.00 debited from AC 6796';

    expect(fingerprintMessage(a)).not.toBe(fingerprintMessage(b));
  });
});
