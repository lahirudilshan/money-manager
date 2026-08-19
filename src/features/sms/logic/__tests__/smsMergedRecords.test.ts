import { describe, expect, it } from 'vitest';
import { parseInbox, splitMergedMessages } from '../smsInbox';
import { parseSms } from '../smsParser';

/**
 * Records holding more than one message — the worst failure this intake has,
 * because it is SILENT and it corrupts amounts rather than losing them.
 *
 * Found in the user's live database: a peer-to-peer notification and a Dialog
 * POS purchase were stored as a single row, and the parser took the amount from
 * the first message and the merchant from the second. The row read LKR
 * 10,000.00 for a transaction that actually cost LKR 50.00 — two hundred times
 * too high, on a row that looked perfectly ordinary in the UI.
 *
 * A missing `---` separator leaves no evidence, which is why the braced
 * `{message}` format was added: it delimits both ends, so a mistake shows up as
 * text outside any braces instead of a wrong number.
 */

/** The exact row that was corrupted on the device, verbatim. */
const MERGED_P2P_AND_PURCHASE =
  'You received LKR 10,000 from DILSHAN M N L\n' +
  'OTP අංකය හෝ රහස්‍ය තොරතුරු කිසිවෙකුටවත් ලබා නොදෙන්න.\n' +
  'Do not share OTP & sensitive information with anyone.\n\n' +
  'LKR 50.00 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 13:28 at Dialog Axiata PLC Colombo 02. Avl Bal 8,697.20 Call 94112448888 for info';

describe('splitMergedMessages', () => {
  it('recovers the real LKR 50.00 purchase from the corrupted row', () => {
    const pieces = splitMergedMessages(MERGED_P2P_AND_PURCHASE);
    expect(pieces).toHaveLength(2);

    // The preamble is kept as its own piece and judged on its merits — the
    // parser rejects it as an accountless notification, which is correct.
    expect(parseSms(pieces[0])).toBeNull();

    const purchase = parseSms(pieces[1]);
    expect(purchase).not.toBeNull();
    // 5_000 minor units = LKR 50.00. The merged row stored 1_000_000.
    expect(purchase!.amountMinor).toBe(5_000);
    expect(purchase!.merchant).toBe('Dialog Axiata PLC Colombo 02');
  });

  it('splits an alert that follows a non-alert preamble', () => {
    /*
     * The case a two-opening rule missed entirely. "You received..." begins
     * with words rather than an amount, so only ONE amount-first opening
     * exists — yet the record is still two messages.
     */
    const pieces = splitMergedMessages(MERGED_P2P_AND_PURCHASE);
    expect(pieces.length).toBeGreaterThan(1);
  });

  it('separates two back-to-back bank alerts', () => {
    const merged =
      'LKR 2,500.00 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 00:45 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 3,043.06\n' +
      'LKR 4,270.86 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 11:59 at National Water Supply Rathmalana. Avl Bal 8,772.20';

    const pieces = splitMergedMessages(merged);
    expect(pieces).toHaveLength(2);
    expect(parseSms(pieces[0])!.amountMinor).toBe(250_000);
    expect(parseSms(pieces[1])!.amountMinor).toBe(427_086);
  });

  it('leaves an ordinary single message completely alone', () => {
    // The guard that matters: over-eager splitting would shred real messages.
    const single =
      'LKR 2,500.00 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 00:45 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 3,043.06 Call 94112448888 for info';
    expect(splitMergedMessages(single)).toEqual([single]);
  });

  it('does not split a message that merely opens with a greeting', () => {
    /*
     * The regression the preamble rule had to be narrowed for. Plenty of alerts
     * lead with a salutation or a bank name before stating the amount, and
     * treating that as a separate message invents a transaction out of "Dear
     * Customer,". A greeting carries no figure of its own; a genuinely separate
     * message does, which is the discriminator.
     */
    const greeting = 'Dear Customer,\nLKR 500.00 spent at SPAR.\nAvail bal 1,200.00';
    expect(splitMergedMessages(greeting)).toEqual([greeting]);
  });

  it('does not split a multi-line receipt that quotes several figures', () => {
    // HNB's ATM e-receipt names an amount, a fee and a balance across nine
    // lines. Exactly one of them is a movement opening, so it stays whole.
    const receipt =
      'HNB ATM Withdrawal e-Receipt\nAmt(Approx.):  85000.00 LKR\nA/C: 1380***4150\nTxn Fee: 30.00LKR\nLocation: NSB MAKOLA ATM LK     , LKA\nAvl Bal: 640099.67 LKR\nHotline:94112462462';

    expect(splitMergedMessages(receipt)).toEqual([receipt]);
  });
});

describe('braced {message} records', () => {
  it('reads each braced record as its own message', () => {
    const file = '{LKR 100.00 debited from AC 6796 at SHOP A}\n{LKR 200.00 debited from AC 6796 at SHOP B}';
    expect(parseInbox(file)).toEqual([
      'LKR 100.00 debited from AC 6796 at SHOP A',
      'LKR 200.00 debited from AC 6796 at SHOP B',
    ]);
  });

  it('keeps a multi-line message inside one pair of braces intact', () => {
    const file = '{HNB ATM Withdrawal e-Receipt\nAmt(Approx.):  85000.00 LKR\nA/C: 1380***4150}';
    expect(parseInbox(file)).toEqual([
      'HNB ATM Withdrawal e-Receipt\nAmt(Approx.):  85000.00 LKR\nA/C: 1380***4150',
    ]);
  });

  it('is unaffected by the seed header sitting above the records', () => {
    const file =
      '# money-manager SMS inbox\n# End each message with three dash characters.\n{LKR 100.00 debited from AC 6796 at SHOP A}';
    expect(parseInbox(file)).toEqual(['LKR 100.00 debited from AC 6796 at SHOP A']);
  });

  it('still reads legacy dash-separated records', () => {
    // A user whose Shortcut predates the brace format must lose nothing.
    const file = 'LKR 100.00 debited at SHOP A---LKR 200.00 debited at SHOP B';
    expect(parseInbox(file)).toEqual([
      'LKR 100.00 debited at SHOP A',
      'LKR 200.00 debited at SHOP B',
    ]);
  });

  it('handles a file midway through the format change', () => {
    // Braced records plus a legacy one left over from before the switch.
    const file = '{LKR 100.00 debited at SHOP A}\nLKR 300.00 debited at SHOP C';
    const records = parseInbox(file);
    expect(records).toContain('LKR 100.00 debited at SHOP A');
    expect(records).toContain('LKR 300.00 debited at SHOP C');
  });

  it('recovers both messages when a closing brace is missing', () => {
    /*
     * A dropped keystroke in Shortcuts. The non-greedy match does not stop
     * where the first record should have ended — it runs on to the SECOND
     * record's closing brace — so without recovery the two collapse into one
     * capture and the second message is lost. Braces exist to stop a formatting
     * slip costing a transaction, so this must not lose one either.
     */
    const file =
      '{LKR 100.00 debited at SHOP A\n{LKR 200.00 debited at SHOP B}';
    const records = parseInbox(file);

    expect(records).toHaveLength(2);
    expect(records.map((r) => parseSms(r)?.amountMinor)).toEqual([10_000, 20_000]);
  });

  it('splits two messages crammed into ONE pair of braces', () => {
    // A brace is not a licence to stop checking — the same mistake is possible.
    const file =
      '{LKR 100.00 debited at SHOP A\nLKR 200.00 debited at SHOP B}';
    expect(parseInbox(file)).toHaveLength(2);
  });
});
