import { describe, expect, it } from 'vitest';
import samplesFile from '~/features/sms/logic/sms-samples.json';
import { classifySms, isDiscardableNoise } from '../smsClassifier';

/**
 * The classifier decides IF a message is a transaction; the parser only reads
 * what it says. This file guards that decision.
 *
 * The tests that matter most are the ones over messages the classifier has
 * never seen. A blocklist scores 100% against its own pattern list by
 * construction and still fails on the next unseen promo — which is exactly how
 * "Max savings LKR 10,000" became a spend. So the real question is not whether
 * known junk is rejected, but whether UNKNOWN junk is.
 */

interface Sample {
  id: string;
  raw: string;
  expect: unknown | null;
}

describe('the whole sample corpus', () => {
  for (const sample of samplesFile.samples as Sample[]) {
    it(`agrees with the corpus on ${sample.id}`, () => {
      // `expect: null` in the corpus means "must not be a transaction".
      expect(classifySms(sample.raw).isTransaction).toBe(sample.expect !== null);
    });
  }
});

describe('promos the classifier has never seen', () => {
  /*
   * None of these has a pattern written for it. Under the old blocklist every
   * one would have been treated as a transaction, because none matched any
   * known promo rule — and each quotes an LKR amount, which was all it took.
   */
  const UNSEEN_PROMOS = [
    'Get LKR 5,000 off your next booking with Sampath Credit Cards! Book now at sampath.lk/travel',
    'Sampath Bank: Enjoy 0% installment plans up to 36 months on purchases above LKR 25,000.',
    'Win LKR 1,000,000! Deposit LKR 10,000 in your NSB account before 31 Aug for a chance to win.',
    'Your loan application for LKR 500,000 has been received. We will contact you shortly.',
    'HNB Priority: Exclusive dining privileges up to 25% at 100+ restaurants.',
    'Recharge now and get 10GB free data! Dial #123# or reload LKR 500 today.',
    'Flash Sale! Up to LKR 20,000 discount on all smartphones at Singer. Hurry!',
    'NDB Bank wishes you a happy new year! Enjoy special rates on FDs above LKR 100,000.',
    'Dear valued customer, thank you for banking with us. Your relationship value is LKR 2,500,000.',
    'Book your Sri Lankan Airlines ticket from LKR 45,000 return. Offer ends soon!',
  ];

  for (const promo of UNSEEN_PROMOS) {
    it(`rejects: ${promo.slice(0, 45)}…`, () => {
      expect(classifySms(promo).isTransaction).toBe(false);
    });
  }
});

describe('real alerts the classifier has never seen', () => {
  // The other half of the trade: rejecting junk is worthless if it also
  // rejects real transactions in formats not yet in the corpus.
  const UNSEEN_REAL = [
    'LKR 1,500.00 debited from AC XXXXXXXX6796 as POS TXN on 05 Aug 2026 09:12 at KEELLS SUPER. Avl Bal 7,197.20',
    'Your salary of LKR 750,000.00 has been credited to A/C 6796 on 25 Aug 2026. Avl Bal 757,197.20',
    'LKR 3,000.00 withdrawn from ATM, A/C:1380***4150, Avl Bal: 400,000.00',
  ];

  for (const message of UNSEEN_REAL) {
    it(`accepts: ${message.slice(0, 45)}…`, () => {
      expect(classifySms(message).isTransaction).toBe(true);
    });
  }
});

describe('the movement requirement', () => {
  it('rejects a balance enquiry, which names no movement', () => {
    /*
     * The case that forced the movement gate. This has an account, a balance
     * and a date — three signals, enough to clear the threshold on score alone
     * — but nothing moved. Without the gate the user's entire balance was
     * logged as a spend.
     */
    const result = classifySms(
      'Your available balance in AC XXXXXXXX6796 is LKR 84,300.15 as at 24 Jul 2026.',
    );
    expect(result.isTransaction).toBe(false);
    expect(result.signals).toContain('no-movement-verb');
  });

  it('accepts a bill notice, where nothing has moved YET', () => {
    // The deliberate exception: an obligation is real money the board wants,
    // it is simply in the future tense.
    expect(
      classifySms('CEB: Your electricity bill for Acct 0012345678 is Rs.8,450.00 due on 05/08/2026.')
        .isTransaction,
    ).toBe(true);
  });

  it('accepts a noun-form alert that conjugates no verb', () => {
    // HNB writes field lists, not sentences. Requiring the past tense lost two
    // real formats to a grammar assumption.
    expect(
      classifySms(
        'HNB SMS ALERT: PURCHASE, Debit account:1380***4150,Location:KEELLS SUPER,Amount(Approx.):3747.40 LKR',
      ).isTransaction,
    ).toBe(true);
  });
});

describe('vetoes beat any amount of transaction shape', () => {
  it('rejects an OTP even when it quotes an amount and a merchant', () => {
    const result = classifySms(
      'Your one-time password for transaction LKR 2500.00 at CEB is 681854.',
    );
    expect(result.isTransaction).toBe(false);
    expect(result.veto).not.toBeNull();
  });

  it('does NOT veto a real alert carrying a scam warning', () => {
    // Every HNB alert says "DO NOT SHARE ACCOUNT DETAILS /OTP". Vetoing on the
    // bare word would delete every genuine HNB message.
    expect(
      classifySms(
        'LKR 10,025.00 debited to Ac No:13802XXXXX50 on 04/08/26 11:57:03 Reason:MB:ref Bal:LKR 405,757.29 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
      ).isTransaction,
    ).toBe(true);
  });
});

describe('isDiscardableNoise — drop junk, KEEP parser gaps', () => {
  it('discards recognised junk', () => {
    expect(isDiscardableNoise('Your OTP is 123456')).toBe(true);
    expect(isDiscardableNoise('Amma called, ring her back')).toBe(true);
  });

  it('KEEPS an unreadable message that claims money moved', () => {
    /*
     * The distinction the retention rule turns on. This says plainly that money
     * moved; the parser just cannot find the amount in this bank's format. The
     * text is the only evidence of that gap, so discarding it destroys what is
     * needed to fix it.
     */
    expect(isDiscardableNoise('Card debited at SOME NEW MERCHANT, ref 99Z.')).toBe(false);
  });

  it('never discards something it classified as a transaction', () => {
    expect(
      isDiscardableNoise(
        'LKR 2,500.00 debited from AC XXXXXXXX6796 as POS TXN at CEYLON ELECTRICITY BOARD. Avl Bal 3,043.06',
      ),
    ).toBe(false);
  });
});
