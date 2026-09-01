import { describe, expect, it } from 'vitest';
import { parseSms } from '../smsParser';

/**
 * What the review card is TITLED, for the two drafts that reached the user's
 * queue on 2026-09-01 with nothing useful on them.
 *
 * The merchant field is the draft's headline — it is what the user reads to
 * decide what a transaction was, and what `scoreSubcategory` matches a category
 * against. Two real messages produced titles that were worse than useless:
 *
 *   "Dear ... LKR 5,000.00 Credited to your A/c XXXXXXXX5891 on 27/08/2026
 *    at 09:32.AvlBal ... Transaction ATM Cash Deposit."
 *      -> titled "09:32"
 *
 *   "Thank you for your payment of LKR 46,567.00 made to Card # 3766..."
 *      -> titled "" (blank)
 *
 * The first is the more serious of the two. `\bat\s+(.+?)` exists to read a POS
 * merchant out of "at KEELLS SUPER", and on this message the only "at" is the
 * one before the CLOCK TIME — so a timestamp was presented as the payee. It is
 * not merely unhelpful: a draft titled with a time can never match a category,
 * and it tells the user nothing about what the money was.
 *
 * Both messages state their own type in plain words. That is what should be
 * read when no genuine merchant exists.
 */

const ATM_DEPOSIT =
  'Dear MR M N LAHIRU DILSHAN,LKR 5,000.00 Credited to your A/c XXXXXXXX5891 on 27/08/2026 at 09:32.AvlBal LKR 310,158.83.Transaction ATM Cash Deposit.Thank you for banking with us.Call Centre 1972.';

const CARD_PAYMENT =
  'Thank you for your payment of LKR 46,567.00 made to Card # 376657*****3055 on 28-08-2026.';

describe('the draft title', () => {
  it('never reads a clock time as the merchant', () => {
    // The actual regression: "on 27/08/2026 at 09:32" is a timestamp, and the
    // "at" clause that finds POS merchants must not claim it.
    expect(parseSms(ATM_DEPOSIT)?.merchant).not.toBe('09:32');
  });

  it('uses the stated transaction type for the ATM deposit', () => {
    // The message says "Transaction ATM Cash Deposit." — exactly the label the
    // user expects to read on the card.
    expect(parseSms(ATM_DEPOSIT)?.merchant).toBe('ATM Cash Deposit');
  });

  it('titles the card payment rather than leaving it blank', () => {
    // No merchant exists — the money went to a card, not a shop — so the type
    // stands in, the same way "CEFTS Outward Transfer" already does.
    expect(parseSms(CARD_PAYMENT)?.merchant).toBe('Card Payment');
  });

  it('still prefers a REAL merchant over the transaction type', () => {
    /*
     * The rule must not overshoot. A POS alert names an actual payee, and that
     * always outranks a generic type label — otherwise every KEELLS purchase
     * would be retitled with its channel.
     */
    const pos =
      'LKR 2,500.00 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 00:45 at CEYLON ELECTRICITY BOARD 1987. Avl Bal 3,043.06 Call 94112448888 for info';
    expect(parseSms(pos)?.merchant).toBe('CEYLON ELECTRICITY BOARD 1987');
  });

  it('still reads a merchant from an "at" clause that is not a time', () => {
    const pos =
      'LKR 4,270.86 debited from AC XXXXXXXX6796 as POS TXN on 04 Aug 2026 11:59 at National Water Supply Rathmalana. Avl Bal 8,772.20 Call 94112448888 for info';
    expect(parseSms(pos)?.merchant).toBe('National Water Supply Rathmalana');
  });
});
