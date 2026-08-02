import { describe, expect, it } from 'vitest';
import { fingerprintMessage } from '../smsInbox';

/**
 * Guards the dedupe key behind the durable SMS queue.
 *
 * The unique index on `sms_inbox.fingerprint` is the only thing that makes the
 * drain safe to retry — the file is cleared only after rows land, so an
 * interrupted import replays the same messages. If this function stopped
 * collapsing trivially-different deliveries of one alert, that replay would
 * queue every message twice.
 */
describe('fingerprintMessage', () => {
  const ALERT =
    'LKR 2,867.40 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 12:11 at National Water Supply';

  it('is stable for the same text', () => {
    expect(fingerprintMessage(ALERT)).toBe(fingerprintMessage(ALERT));
  });

  /*
   * Each of these is something a real Shortcuts automation does: one action
   * emits CRLF where another emits LF, "Append to File" adds a trailing
   * newline, and a re-delivery can arrive with collapsed whitespace.
   */
  it('ignores line-ending, whitespace and trailing-newline differences', () => {
    const baseline = fingerprintMessage(ALERT);

    expect(fingerprintMessage(ALERT.replace(/ /g, '\r\n'))).toBe(baseline);
    expect(fingerprintMessage(`${ALERT}\n`)).toBe(baseline);
    expect(fingerprintMessage(`  ${ALERT}  `)).toBe(baseline);
    expect(fingerprintMessage(ALERT.replace(/ /g, '   '))).toBe(baseline);
  });

  it('ignores case, so a re-send in caps is still the same message', () => {
    expect(fingerprintMessage(ALERT.toUpperCase())).toBe(fingerprintMessage(ALERT));
  });

  /*
   * The other half of the contract: two genuinely different transactions must
   * NOT collapse, or the second would be silently dropped as a duplicate.
   */
  it('differs when the amount, merchant or account differs', () => {
    const baseline = fingerprintMessage(ALERT);

    expect(fingerprintMessage(ALERT.replace('2,867.40', '2,867.41'))).not.toBe(baseline);
    expect(fingerprintMessage(ALERT.replace('National Water Supply', 'Ceylon Electricity'))).not.toBe(
      baseline,
    );
    expect(fingerprintMessage(ALERT.replace('6796', '1234'))).not.toBe(baseline);
  });

  it('survives an empty string rather than throwing', () => {
    expect(typeof fingerprintMessage('')).toBe('string');
  });
});
