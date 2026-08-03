import { describe, expect, it } from 'vitest';
import { parseInbox, planDrain, RECORD_SEPARATOR } from '../smsInbox';
import { parseSms } from '../smsParser';

/**
 * Guards the `---` record separator end to end, from file text to parsed
 * transactions.
 *
 * This is the contract the USER has to get right in Shortcuts: their automation
 * appends the message and then a line containing only `---`. Everything else in
 * the intake path is ours, but this one join is theirs, so the cost of getting
 * it wrong is worth pinning down — see the "without a separator" case below,
 * which silently loses a real transaction rather than failing loudly.
 */

const WATER =
  'LKR 2,867.40 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 12:11 at National Water Supply Rathmalana. Avl Bal 174,121.03 Call 94112448888 for info';

const ELECTRICITY =
  'LKR 9,500.00 debited from AC XXXXXXXX6796 as POS TXN on 24 Jul 2026 12:08 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 176,988.43 Call 94112448888 for info';

/** The file exactly as a correctly-configured Shortcut leaves it. */
const TWO_MESSAGES = `${WATER}\n${RECORD_SEPARATOR}\n${ELECTRICITY}`;

describe('two SMS separated by ---', () => {
  it('splits into one record per message', () => {
    expect(parseInbox(TWO_MESSAGES)).toEqual([WATER, ELECTRICITY]);
  });

  it('parses both into distinct transactions, oldest first', () => {
    const parsed = planDrain(TWO_MESSAGES, 99).messages.map(parseSms);

    expect(parsed.map((entry) => entry?.amountMinor)).toEqual([286740, 950000]);
    expect(parsed.map((entry) => entry?.merchant)).toEqual([
      'National Water Supply Rathmalana',
      'CEYLON ELECTRICITY BOARD 1987',
    ]);
    // Same account, two separate movements — neither may absorb the other.
    expect(parsed.map((entry) => entry?.account)).toEqual(['6796', '6796']);
  });

  /*
   * The whole reason the separator is worth a test of its own.
   *
   * Two messages appended with no `---` between them are ONE record, and the
   * parser reads the first amount it finds — so the second transaction vanishes
   * with no error anywhere. That is a silent data-loss bug in the user's
   * Shortcut, which is why the setup steps have to spell out the separator.
   */
  it('loses the second transaction when the separator is missing', () => {
    const glued = planDrain(`${WATER}\n${ELECTRICITY}`, 99);

    expect(glued.messages).toHaveLength(1);
    expect(parseSms(glued.messages[0])?.amountMinor).toBe(286740);
  });

  /*
   * Each of these is something a real Shortcuts automation produces: CRLF from
   * some actions, a trailing separator from one that writes `---` after every
   * message rather than between them, and a blank record from a double append.
   */
  it('tolerates CRLF, a trailing separator and blank records', () => {
    const messy = `${WATER}\r\n---\r\n\r\n---\r\n${ELECTRICITY}\r\n---\r\n`;

    expect(parseInbox(messy)).toEqual([WATER, ELECTRICITY]);
  });

  it('ignores whitespace after the separator, which Shortcuts can append', () => {
    expect(parseInbox(`${WATER}\n---   \n${ELECTRICITY}`)).toEqual([WATER, ELECTRICITY]);
  });

  /*
   * The separator no longer has to be a whole line — see the note in
   * smsInbox.test.ts. One or two dashes are still ordinary punctuation, which
   * is what keeps "SHOP - BRANCH 2" intact.
   */
  it('keeps one and two dashes inside a message', () => {
    const hyphenated = 'LKR 500.00 debited from AC XXXX1111 at SHOP - BRANCH 2';

    expect(parseInbox(hyphenated)).toEqual([hyphenated]);
    expect(parseSms(hyphenated)?.amountMinor).toBe(50000);
  });

  /*
   * The exact file that lost five transactions in production.
   *
   * A real six-message batch where the Shortcut appended `---` to the END of
   * each message rather than on its own line. Under the whole-line rule this
   * parsed as ONE record and only the first amount was ever seen. Kept verbatim
   * as the regression guard, because the failure was silent — nothing errored,
   * the file was cleared, and five real transactions simply never appeared.
   */
  it('splits a real batch with the separator glued to each message', () => {
    const batch = [
      'HNB SMS ALERT: PURCHASE, Debit account:1380***4150,Location:BAS DIL HAULIERS & ENTERP, LK,Amount(Approx.):1597.00 LKR,Av.Bal:415782.29 LKR,Date:02.08.26,Time:12:01, Hot Line:0112462462---',
      'LKR 122,867.00 debited from AC XXXXXXXX6796 on 01 Aug 2026 06:04 as Transfer Out. Avl Bal 5,543.06 Call 94112448888 for info---',
      'LKR 25.00 debited from AC XXXXXXXX6796 on 30 Jul 2026 20:41 as CEFTS Transfer Charges. Avl Bal 127,672.03 Call 94112448888 for info---',
      'A reversal for POS TXN of LKR 1,038.30 credited to AC XXXXXXXX6796 on 28 Jul 2026 20:31. Avl Bal 127,697.03 Call 94112448888 for info---',
      'LKR 1,038.30 debited from AC XXXXXXXX6796 as POS TXN on 28 Jul 2026 20:25 at UBER 852. Avl Bal 126,658.73 Call 94112448888 for info---',
      'LKR 9,200.00 debited from AC XXXXXXXX6796 as POS TXN on 28 Jul 2026 15:17 at STARLINK INTERNET.2DS 94. Avl Bal 127,697.03 Call 94112448888 for info---',
    ].join('\n');

    const records = planDrain(batch, 99).messages;
    expect(records).toHaveLength(6);

    const parsed = records.map(parseSms);
    expect(parsed.map((entry) => entry?.amountMinor)).toEqual([
      159700, 12286700, 2500, 103830, 103830, 920000,
    ]);

    // The reversal is a CREDIT — money coming back — not another spend.
    expect(parsed.map((entry) => entry?.direction)).toEqual([
      'debit',
      'debit',
      'debit',
      'credit',
      'debit',
      'debit',
    ]);

    // Every message that names something has a merchant. The reversal names no
    // payee at all, so an empty string is the honest answer there.
    expect(parsed.map((entry) => entry?.merchant)).toEqual([
      'BAS DIL HAULIERS & ENTERP, LK',
      'Transfer Out',
      'CEFTS Transfer Charges',
      '',
      'UBER 852',
      'STARLINK INTERNET.2DS 94',
    ]);
  });

  /*
   * The header the app writes back after every drain must not contain a literal
   * `---`.
   *
   * `parseInbox` splits on three-or-more dashes ANYWHERE, so an instruction line
   * spelling the separator out would cut the header in two and leave a phantom
   * record in the file after every single import. Caught in testing, and only
   * because the round-trip was checked rather than assumed.
   */
  it('does not split the header the drain writes back', () => {
    const header = [
      '# money-manager SMS inbox — TEMPORARY HANDOFF FILE',
      '#',
      '# End each message with three dash characters (a new line is optional).',
      '',
    ].join('\n');

    // `parseInbox` strips the `#` lines itself, so a header-only file yields no
    // messages at all — no filtering by the caller required.
    expect(planDrain(header, 99).messages).toHaveLength(0);
  });

  /**
   * The header is removed outright, not merely ignored downstream.
   *
   * It used to survive as its own record that `parseSms` rejected, which the
   * drain then reported to the user as "1 not a transaction" after every single
   * import. Stripping `#` lines inside `parseInbox` means it never reaches the
   * parser and never inflates that count.
   */
  it('removes the seed header entirely rather than emitting a dead record', () => {
    const withHeader = `# money-manager SMS inbox\n#\n# Separate messages with three dashes.\n---\n${WATER}\n---\n${ELECTRICITY}`;
    const records = planDrain(withHeader, 99).messages;

    expect(records).toHaveLength(2);
    expect(records.map((entry) => parseSms(entry)?.amountMinor)).toEqual([286740, 950000]);
  });

  /**
   * The same, for the shape that actually caused the data loss: a header that
   * ends in prose with the first message appended straight onto it, no
   * separator in between.
   */
  it('recovers the first message when it is glued to the header', () => {
    const withHeader = `# money-manager SMS inbox\n#\n# End each message with three dash characters.\n${WATER}\n---\n${ELECTRICITY}`;
    const records = planDrain(withHeader, 99).messages;

    expect(records).toHaveLength(2);
    expect(records.map((entry) => parseSms(entry)?.amountMinor)).toEqual([286740, 950000]);
  });
});
