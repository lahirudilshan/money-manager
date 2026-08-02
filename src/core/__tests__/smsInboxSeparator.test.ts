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
   * `---` only separates when it is the WHOLE line. A message that happens to
   * contain three dashes mid-sentence must stay one record, or a legitimate
   * alert would be torn in half.
   */
  it('does not split on dashes inside a message', () => {
    const withDashes = 'LKR 500.00 debited from AC XXXX1111 at SHOP --- BRANCH 2';

    expect(parseInbox(withDashes)).toEqual([withDashes]);
    expect(parseSms(withDashes)?.amountMinor).toBe(50000);
  });

  it('keeps the seed header out of the way as its own ignorable record', () => {
    const withHeader = `# money-manager SMS inbox\n#\n# Separate messages with three dashes.\n---\n${WATER}\n---\n${ELECTRICITY}`;
    const records = planDrain(withHeader, 99).messages;

    // Three records: the header plus both messages. The header parses to null,
    // which the drain reports as "not a transaction" rather than queueing it.
    expect(records).toHaveLength(3);
    expect(parseSms(records[0])).toBeNull();
    expect(records.slice(1).map((entry) => parseSms(entry)?.amountMinor)).toEqual([286740, 950000]);
  });
});
