/**
 * Turn a raw bank / utility SMS into a structured money movement.
 *
 * This is deliberately a *pure* function over a string — it never touches the
 * database, the store, or any platform API. That keeps it fully testable
 * (see __tests__/smsParser.test.ts, which runs it over src/data/sms-samples.json)
 * and means it does not care how the SMS arrived: deep link, share sheet, paste,
 * or an iOS Shortcuts automation all feed the same text in here.
 *
 * Scope started as Sri Lankan LKR alerts and now covers any ISO currency code a
 * bank prints — LKR, USD, EUR, GBP, AED and the rest — because the same account
 * receives inward SWIFT payments denominated in foreign currency. Real banks
 * vary wildly in wording — amount before or after the verb, currency before or
 * after the number, glued to the digits or spaced, text or dotted dates, the
 * merchant in an "at ...", "Location:...", or "Reason:..." clause — so the
 * extractors below each try several shapes. The goal is not to understand every
 * message perfectly; it is to extract enough for a *draft* the user then
 * confirms or edits. When unsure, we return null rather than guess a
 * transaction into existence.
 */

import { classifySms, isDiscardableNoise } from './smsClassifier';
import { toMinor, type Minor } from './money';

/** Which way money moved, as read from the SMS wording. */
export type SmsDirection =
  /** Money left an account now — a purchase, ATM, outgoing transfer, payment. */
  | 'debit'
  /** Money arrived — salary, incoming transfer, refund. */
  | 'credit'
  /** A bill was *issued* (due later), not yet paid — CEB/water/telco notices. */
  | 'bill';

/**
 * A finer classification than direction, so the board can treat movements
 * differently: an internal transfer between the user's own accounts is not
 * spend, and a loan installment should settle a loan-linked line rather than an
 * ordinary bill.
 */
export type SmsKind =
  | 'purchase' // POS / card purchase at a merchant
  | 'atm' // cash withdrawal
  | 'transfer_out' // money sent out (CEFTS/own-account) — not necessarily spend
  | 'transfer_in' // money received
  | 'loan_payment' // installment against a loan
  | 'utility' // an issued utility bill (due later)
  /**
   * A charge being undone — "A reversal for POS TXN of LKR 1,038.30 credited".
   *
   * Distinct from `transfer_in` because it is not new money: it cancels an
   * earlier debit, and the pair should disappear together rather than appear as
   * a spend plus an unrelated income. See `cancelReversals` in smsInbox.ts.
   */
  | 'reversal'
  /**
   * A fee the bank charged for doing something — "CEFTS Transfer Charges",
   * stamp duty, an ATM fee, a monthly service charge.
   *
   * Split out from `transfer_out` because a fee is not a transfer: it is real
   * money genuinely leaving (so it must NOT be cancelled as half of an internal
   * transfer pair, which its wording and timing would otherwise invite), but it
   * is also never worth the user's attention individually. These all belong on
   * one "Bank charges" line, which is what `isBankCharge` drives.
   */
  | 'bank_charge'
  | 'other';

export interface ParsedSms {
  direction: SmsDirection;
  kind: SmsKind;
  /** Amount in minor units (cents), always positive. */
  amountMinor: Minor;
  /**
   * ISO code of the currency the message stated ("LKR", "USD", …), or null when
   * it used a bare symbol/"Rs." with no code. Carried so a foreign-currency
   * alert can be shown — and converted — as what the bank actually sent, rather
   * than silently reading as the user's home currency.
   */
  currency: string | null;
  /** Best-effort payee/merchant/description, trimmed. Empty string if none. */
  merchant: string;
  /** Account / card fragment the message referenced (often last 4). */
  account: string;
  /** ISO date (YYYY-MM-DD) the message referenced, or null if none found. */
  date: string | null;
  /**
   * 24-hour "HH:MM" the message referenced, or null. Kept separate from `date`
   * rather than folded into a timestamp: plenty of alerts carry a date and no
   * time, and the review UI shows whichever it actually has.
   */
  time: string | null;
  /** The original text, kept so the confirm UI can show what it came from. */
  raw: string;
}

/**
 * Words that mark a message as *not* a money movement. Checked carefully: real
 * transaction alerts often carry a "do not share your OTP" scam warning, so we
 * only bail on an *actual* OTP delivery — a message that leads with the code and
 * calls itself an OTP/one-time password — not on any mention of the word.
 */
const OTP_DELIVERY_PATTERNS: RegExp[] = [
  /\b\d{4,8}\b\s+is\s+your\s+(?:one[-\s]?time\s+password|otp)/i,
  /\byour\s+(?:otp|one[-\s]?time\s+password)\s+is\b/i,
  /*
   * The shape that actually reached the device: the OTP is announced FIRST and
   * the code arrives at the end, with the transaction's amount in between.
   *
   *   "Your one-time password for transaction LKR 2500.00 at CEB is 681854."
   *
   * Every earlier pattern anchored on "<code> is your OTP" or "your OTP is
   * <code>", and this says neither — so it fell through to the amount
   * extractor, which happily found "LKR 2500.00" and drafted a CEB purchase
   * that never happened. Worse, the real POS alert for the same payment also
   * arrives, so the user saw the electricity bill twice.
   *
   * Anchored on the PURPOSE clause ("password for transaction/payment"), which
   * is what makes this an authorisation request rather than a receipt. A
   * genuine debit alert never describes itself as a password for something.
   */
  /\b(?:one[-\s]?time\s+password|otp|password)\b[^.]{0,60}?\bfor\s+(?:your\s+)?(?:transaction|payment|purchase|txn)\b/i,
  /*
   * "... is 681854" / "... is: 681854" trailing a message that called itself an
   * OTP anywhere. Kept separate and deliberately narrow — it requires BOTH the
   * OTP vocabulary and a bare 4-8 digit code as the final token — so a real
   * alert ending in a hotline number cannot trip it.
   */
  /\b(?:otp|one[-\s]?time\s+password|verification\s+code)\b[\s\S]{0,80}?\bis\s*:?\s*\d{4,8}\b/i,
];

/**
 * Marketing blasts. These are the messages that made the inbox file "full of
 * promo junk containing LKR": a dining-offer blast quotes "Max savings LKR
 * 10,000", which is a currency amount in a message about no transaction at all.
 *
 * The list leads with the structural giveaways rather than the word "offer",
 * because banks send legitimate alerts that mention offers. What a marketing
 * SMS has and a transaction alert never does:
 *   - an opt-out footer ("StopAd", "SMS BL ... to 9010", "to unsubscribe")
 *   - a shortened marketing URL / "visit ..." call to action
 *   - "valid till", "T&C apply", "% off"/"% savings"
 */
const PROMO_PATTERNS: RegExp[] = [
  /\bcashback\b/i,
  /\bspecial offer\b/i,
  /\bpromo(?:tion|tional)?\b/i,
  /T&C\s+apply/i,
  // Opt-out footers — the single most reliable marketing marker.
  /\bstop\s?ad\b/i,
  /\bto\s+(?:stop|unsubscribe|opt[-\s]?out)\b/i,
  /\bSMS\s+[A-Z]{2,}\s+[A-Za-z0-9]+\s+to\s+\d{3,6}\b/,
  // Calls to action / campaign links.
  /\bbit\.ly\b/i,
  /\bvisit\s+(?:https?:\/\/|www\.|bit\.ly)/i,
  // Time-boxed discount language.
  /\bvalid\s+till\b/i,
  /\b\d{1,3}\s*%\s*(?:off|savings|discount)\b/i,
  /\benjoy\b[^.]{0,40}\b(?:savings|discount|off)\b/i,
  /\bmax(?:imum)?\s+savings\b/i,
];

/**
 * Wording that describes money arriving/leaving WITHOUT naming an account the
 * app can tie it to — a peer-to-peer notification rather than a bank statement
 * line. "You received LKR 10,000 from DILSHAN M N L" is the real example: it is
 * a genuine event, but the SAME money also arrives as a proper CEFTS credit
 * alert on the account, so drafting both double-counts the income.
 *
 * Only rejected when the message names no account at all — see `parseSms`,
 * which applies this together with an empty `extractAccount`. A bank alert that
 * says "credited to AC XXXX6796" is unaffected.
 */
const ACCOUNTLESS_NOTIFICATION_PATTERNS: RegExp[] = [
  /\byou\s+(?:have\s+)?received\b/i,
  /\bmoney\s+received\b/i,
  /\bhas\s+sent\s+you\b/i,
];

/** A message that only reports a balance is informational, not a movement. */
const BALANCE_ONLY_PATTERNS: RegExp[] = [
  /^\s*your\s+available\s+balance/i,
  /^\s*(?:avl|available)\s+bal/i,
];

/** Direction cues. A message can hold several amounts (movement + "Avl Bal"). */
const CREDIT_PATTERNS: RegExp[] = [/\bcredited\b/i, /\bcredit of\b/i, /\breceived to\b/i];

const BILL_PATTERNS: RegExp[] = [/\bbill\b[^.]*\bdue\b/i, /\bdue (?:on|by)\b/i, /\bamounting to\b/i];

const DEBIT_PATTERNS: RegExp[] = [
  /\bdebited\b/i,
  /\bwithdrawal\b/i,
  /\bpurchase\b/i,
  /\bPOS TXN\b/i,
  /\bspent\b/i,
];

/**
 * Wording that marks a debit as a bank fee rather than a payment the user made.
 *
 * Kept tight: it must name a CHARGE/FEE/DUTY/COMMISSION, not merely mention
 * one. "Transfer Charges", "Txn Fee", "Stamp Duty", "Service Charge" all
 * qualify; a purchase at a shop called "Charges Ltd" does not, because the
 * words must appear as the transaction's own type.
 */
const BANK_CHARGE_PATTERNS: RegExp[] = [
  /\b(?:transfer|txn|transaction|service|handling|processing|annual|monthly|late|overdraft|atm)\s+(?:charge|charges|fee|fees)\b/i,
  /\bcharges?\s*(?:applied|debited)\b/i,
  /\bstamp\s+duty\b/i,
  /\bcommission\b/i,
  /\bas\s+(?:[A-Za-z]+\s+)*(?:charges|fees)\b/i,
];

/**
 * Currency codes a message may state. Restricted to a known list rather than a
 * generic `[A-Z]{3}` because bare three-letter runs are everywhere in these
 * alerts ("POS", "ATM", "LKA", "REF") and treating one as a currency would let
 * an unrelated number win the amount slot.
 */
const CURRENCY_CODES = [
  'LKR', 'USD', 'EUR', 'GBP', 'AUD', 'AED', 'SGD', 'INR', 'JPY', 'CAD',
  'CHF', 'NZD', 'SAR', 'QAR', 'KWD', 'MYR', 'CNY', 'HKD', 'THB', 'ZAR',
] as const;

const CURRENCY_ALTERNATION = CURRENCY_CODES.join('|');

/**
 * An amount in either order, with a currency code or a local symbol:
 * "LKR 12,500.00", "USD2,500.00", "3747.40 LKR", "Rs.1,000.00".
 *
 * Three capture groups, matching the three shapes:
 *   1 = code before the number, 2 = its numeric body
 *   3 = numeric body, 4 = code after the number
 *   5 = numeric body following a bare "Rs."/"Rs" symbol (no ISO code)
 *
 * The code side is optional-space (`\s*`) so the very common glued form
 * "USD2,500.00" — which the user's SWIFT credit alert uses — matches. The `g`
 * flag lets us scan every amount in the message and pick the right one.
 */
const AMOUNT_RE = new RegExp(
  `(?:(${CURRENCY_ALTERNATION})\\s*([\\d,]+(?:\\.\\d{1,2})?))` +
    `|(?:([\\d,]+(?:\\.\\d{1,2})?)\\s*(${CURRENCY_ALTERNATION})\\b)` +
    `|(?:Rs\\.?\\s*([\\d,]+(?:\\.\\d{1,2})?))`,
  'gi',
);

/**
 * Clauses whose amount is NOT the transaction: the remaining balance and any
 * transaction fee. An amount immediately preceded by one of these is skipped so
 * "Avl Bal 127,496.03" and "Txn Fee: 30.00LKR" never win.
 */
const NON_AMOUNT_CLAUSE_RE =
  /(?:avl|available)\s*bal(?:ance)?|av\.?\s*bal|txn\s*fee|bal\s*(?:is)?\s*:?\s*$|your\s+bal(?:ance)?\s+is\s*$/i;

/** Convert a matched "12,500.00" body to minor units. */
function amountBodyToMinor(body: string): Minor {
  return toMinor(Number.parseFloat(body.replace(/,/g, '')));
}

/**
 * Pick the amount that represents the actual movement, skipping balance and fee
 * clauses that sit right before an amount. The first surviving amount wins,
 * since banks lead with the transaction value and append the balance.
 *
 * Returns the currency alongside it: the same scan already knows which code (if
 * any) sat against the winning number, and re-deriving it separately could pick
 * a *different* amount's currency in a message that mixes them — an inward SWIFT
 * alert states "USD2,500.00" then "Your bal is USD5,002.26", and a remittance
 * can quote both the sent and received currency.
 */
function extractAmount(text: string): { amountMinor: Minor; currency: string | null } | null {
  for (const match of text.matchAll(AMOUNT_RE)) {
    const index = match.index ?? 0;
    // Look back a short window; if it names a balance or fee, this is not it.
    const preceding = text.slice(Math.max(0, index - 24), index);
    if (NON_AMOUNT_CLAUSE_RE.test(preceding)) continue;

    // Which pair matched depends on where the currency sat; see AMOUNT_RE.
    const body = match[2] ?? match[3] ?? match[5];
    const code = match[1] ?? match[4];
    if (body) {
      return {
        amountMinor: amountBodyToMinor(body),
        currency: code ? code.toUpperCase() : null,
      };
    }
  }
  return null;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Expand a 2-digit year to 20xx; pass 4-digit years through. */
function fullYear(year: string): string {
  return year.length === 2 ? `20${year}` : year;
}

/**
 * Extract a date and normalise to ISO. Handles the shapes local alerts use:
 * "24 Jul 2026" (text month), "22.07.26" / "24/07/26" (dotted or slashed,
 * 2-digit year, DD first), and ISO "2026-07-24".
 */
function extractDate(text: string): string | null {
  // ISO first, so its leading 4-digit year is not misread as a day.
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "24 Jul 2026" — day, text month, year.
  const textMonth = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})\b/);
  if (textMonth) {
    const month = MONTHS[textMonth[2].toLowerCase()];
    if (month) {
      return `${fullYear(textMonth[3])}-${month}-${textMonth[1].padStart(2, '0')}`;
    }
  }

  // "22.07.26" / "24/07/2026" — DD, MM, YY(YY), dots or slashes, DD first.
  const numeric = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (numeric) {
    return `${fullYear(numeric[3])}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  }

  return null;
}

/**
 * Extract a 24-hour "HH:MM" clock time, or null.
 *
 * Deliberately narrow. A bare `\d{2}:\d{2}` also matches things that are not
 * times — a "Time:" label is the reliable signal, so a labelled match is tried
 * first and an unlabelled one is only accepted when the digits form a valid
 * clock reading (so a 10-digit hotline or a masked account can't pose as one).
 * Seconds, when present, are dropped: the card shows "20:54", never "20:54:03".
 */
function extractTime(text: string): string | null {
  const labelled = text.match(/\bTime\s*[:.]?\s*(\d{1,2}):(\d{2})/i);
  const bare = labelled ?? text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  if (!bare) return null;

  const hour = Number(bare[1]);
  const minute = Number(bare[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour > 23 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${bare[2]}`;
}

/**
 * The account/card fragment the message referenced, reduced to its trailing
 * significant digits so it can be matched against a card's last-4. Handles
 * "AC XXXXXXXX6796", "account:1380***4150", "A/C: 1380***4150",
 * "Ac No:13802XXXXX50".
 */
function extractAccount(text: string): string {
  const labelled = text.match(
    /(?:A\/C|Ac(?:count)?)(?:\s*No)?\s*[:.]?\s*([X*\d]{3,})/i,
  );
  if (labelled) {
    // Everything after the last run of mask characters is the visible tail.
    const value = labelled[1];
    const tail = value.split(/[X*]+/).filter(Boolean).pop() ?? value;
    return tail.replace(/[^\d]/g, '');
  }
  return '';
}

/**
 * How many trailing digits of an account number a message actually revealed.
 *
 * `extractAccount` returns the visible tail, but the tail's LENGTH decides what
 * it may be used for, and conflating the two caused a real bug. HNB prints
 * "Ac No:13802XXXXX50", whose tail is a mere "50" — matching that against a
 * card's last-4 with `endsWith` is meaningless (every account ending in 50
 * matches), yet it is still a perfectly good signal that two HNB messages came
 * from the SAME account, which is what internal-transfer pairing needs.
 *
 * So the tail is kept and callers ask this before trusting it as a card key.
 * Four digits is the threshold: that is what a card's `last4` holds.
 */
export const MIN_MATCHABLE_ACCOUNT_DIGITS = 4;

/** Whether an account fragment is specific enough to identify a card. */
export function isMatchableAccount(account: string): boolean {
  return account.length >= MIN_MATCHABLE_ACCOUNT_DIGITS;
}

function clean(value: string): string {
  return value.trim().replace(/\s+$/g, '').replace(/[.,]\s*$/, '').replace(/\s+/g, ' ');
}

/**
 * The payee/merchant/description. Each shape hides it differently: NDB uses
 * "at MERCHANT." (POS) or "as TYPE" (transfers), HNB uses "Location:MERCHANT,"
 * and "Reason:MB:loan-CODE". Tried in that order; empty when none applies.
 */
function extractMerchant(text: string): string {
  // "Reason:MB:loan-AML08" — surface the loan code as the description.
  const loan = text.match(/Reason\s*:\s*(?:MB:)?(loan-[A-Z0-9]+)/i);
  if (loan) return clean(loan[1]);

  // "Location:KEELLS SUPER - SINHARAMUL, LK," — up to the amount/next label.
  const location = text.match(/Location\s*:\s*(.+?)\s*,?\s*(?:Amount|Av\.?Bal|Term ID|$)/i);
  if (location) return clean(location[1]);

  // "at National Water Supply Rathmalana." — POS merchant, up to "Avl Bal".
  const at = text.match(/\bat\s+(.+?)(?:\.\s*Avl|\.\s*Av\.|\s+Avl\b|\n|$)/i);
  if (at) return clean(at[1]);

  /*
   * "as CEFTS Outward Transfer." / "as Transfer Out." — the transaction type
   * stands in as the payee, because these messages name no merchant at all.
   *
   * The clause runs to the end of the sentence rather than stopping at the word
   * "Transfer": an earlier version anchored on Transfer as the LAST word, so
   * "Transfer Out" and "CEFTS Transfer Charges" both fell through and produced
   * an empty merchant — which in turn means no category match and a draft the
   * user has to categorise by hand.
   */
  const asType = text.match(
    // The words before the keyword are OPTIONAL: "as Transfer Out" puts the
    // keyword first, so requiring a prefix silently dropped it.
    /\bas\s+((?:[A-Z][A-Za-z]*\s+)*(?:Transfer|Charges|Payment|Withdrawal)(?:\s+[A-Z][A-Za-z]*)*)/,
  );
  if (asType) return clean(asType[1]);

  /*
   * "ref: Inward SWIFT Payment." — the reference names what the money was, and
   * is the only description a SWIFT/remittance credit carries.
   *
   * Stopping at the next full stop is NOT enough, which HNB proved:
   *
   *   "...Reason:MB:ref Bal:LKR 405,757.29 Protect from scams..."
   *
   * Here "ref" is a bare marker with no reference after it, so the match ran on
   * into the balance and the merchant came out as "Bal:LKR 405,757" — which is
   * not a payee, defeats every category match, and shows the user a bill named
   * after their own bank balance.
   *
   * So the capture now stops at a balance/scam-warning/hotline label as well as
   * at a sentence end, and a reference that is empty or has no letters in it is
   * rejected outright rather than returned as junk.
   */
  const ref = text.match(
    /\bref\s*[:.]?\s*([^.\n]*?)(?=\s*(?:Bal(?:ance)?\s*[:.]|Av\.?\s*Bal|Protect\s+from|Hot\s?line|Call\s+\d|DO\s+NOT\s+SHARE|$)|[.\n])/i,
  );
  if (ref) {
    const value = clean(ref[1]);
    // Must contain real words — a bare "ref" marker, a reference number, or a
    // stray currency fragment names nothing and is worse than no merchant.
    if (/[a-z]{3,}/i.test(value) && !/^\s*(?:LKR|Rs\.?)\b/i.test(value)) return value;
  }

  return '';
}

function firstMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** Direction from the wording; debit-issued bills fall through to 'bill'. */
function classifyDirection(text: string): SmsDirection | null {
  if (firstMatch(CREDIT_PATTERNS, text)) return 'credit';
  if (firstMatch(DEBIT_PATTERNS, text)) return 'debit';
  if (firstMatch(BILL_PATTERNS, text)) return 'bill';
  return null;
}

/**
 * The finer kind, from cues in the text. Order matters: a loan reason and an
 * ATM receipt are recognised before the generic transfer/purchase split.
 */
function classifyKind(text: string, direction: SmsDirection): SmsKind {
  /*
   * Checked FIRST, and only on a credit.
   *
   * "A reversal for POS TXN of LKR 1,038.30 credited to AC ..." contains
   * "POS TXN", so any later rule would claim it as a purchase — which is how a
   * refund ended up looking like a spend. A reversal is money coming BACK, and
   * pairing it with the original debit is what stops both from reaching the
   * board (see `cancelReversals`).
   */
  if (direction === 'credit' && /\brevers(?:al|ed)\b|\brefund(?:ed)?\b/i.test(text)) {
    return 'reversal';
  }

  /*
   * Loan/lease repayments, by any of the words a bank prints for them.
   *
   * Was `\bloan[-\s]` alone, which missed the two most common alternatives: a
   * vehicle "lease"/"leasing" rental, and a bare "instalment" (both spellings —
   * UK doubles the L, and Sri Lankan banks use either). Those messages fell
   * through to 'other', so the loan prior in `scoreSubcategory` never fired and
   * a repayment was scored against every bill on the board like an ordinary
   * spend.
   *
   * "EMI" is included as the equated-monthly-instalment abbreviation, bounded so
   * it cannot fire inside a longer word.
   */
  if (
    /\bloan[-\s]/i.test(text) ||
    /\bleas(?:e|ing)\b/i.test(text) ||
    /\binstal{1,2}ment\b/i.test(text) ||
    /\bEMI\b/.test(text) ||
    /Reason\s*:\s*MB:loan/i.test(text)
  ) {
    return 'loan_payment';
  }
  /*
   * ATM withdrawals outrank the fee rule below.
   *
   * An ATM e-receipt itemises its own charge ("Txn Fee: 30.00LKR"), so testing
   * for fee vocabulary first reclassified every cash withdrawal as a bank
   * charge. The fee is a LINE ITEM inside the receipt; the transaction is the
   * withdrawal, and `extractAmount` already skips the fee clause when reading
   * the amount.
   */
  if (/\bATM\b|withdrawal/i.test(text)) return 'atm';

  /*
   * Bank fees, checked before the transfer rules.
   *
   * "LKR 25.00 debited ... as CEFTS Transfer Charges" contains the word
   * "Transfer", so the transfer rule below claimed it — which put a 25-rupee fee
   * in front of the user as a transfer to categorise, and worse, made it
   * eligible for internal-transfer cancellation. Fees are their own thing: real
   * spend, always trivial, always the same category.
   *
   * Requires a debit, so a credited "charges reversal" is not swept in here.
   */
  if (direction === 'debit' && BANK_CHARGE_PATTERNS.some((p) => p.test(text))) {
    return 'bank_charge';
  }
  // Inward money arrives under several names: a plain "transfer", or the
  // remittance wording a cross-border payment uses ("Inward SWIFT Payment",
  // "remittance"). All are the same thing to the board — money landing.
  if (direction === 'credit' && /transfer|swift|remittance|inward/i.test(text)) {
    return 'transfer_in';
  }
  if (direction === 'debit' && /transfer|outward/i.test(text)) return 'transfer_out';

  /*
   * A mobile-banking debit that names no merchant is a transfer.
   *
   * HNB's outward transfers carry NO transfer vocabulary at all — the entire
   * description is "Reason:MB:ref", where "MB" is the mobile-banking channel and
   * "ref" is an empty reference marker. Both halves of the user's real HNB→NDB
   * transfers land here, and while they were classified 'other' they could never
   * pair with the NDB credit, so every top-up counted as spend AND income.
   *
   * Narrow on purpose: a `MB:` channel marker, a debit, and no merchant text
   * recovered. A mobile-banking payment that DOES name a payee keeps flowing to
   * the merchant rules below, where it belongs.
   */
  if (direction === 'debit' && /\bMB\s*:/i.test(text) && !extractMerchant(text)) {
    return 'transfer_out';
  }
  if (/\bPOS TXN\b|purchase/i.test(text)) return 'purchase';
  if (/\bbill\b[^.]*\bdue\b|due (?:on|by)/i.test(text)) return 'utility';
  return 'other';
}

/**
 * Whether a message was DELIBERATELY rejected as noise, rather than merely not
 * understood.
 *
 * The distinction decides what happens to the text in the inbox file. A message
 * the parser does not recognise is retained, so a parser gap is visible and
 * fixable rather than silently destroying a real transaction. But that same
 * retention rule applied to junk means every OTP, promo blast and delivery
 * notification the user ever receives accumulates in the file forever — which
 * is exactly what happened: the file filled with marketing SMS quoting LKR
 * amounts, and the user had to clear it by hand.
 *
 * So: noise is CONSUMED (recognised, discarded, gone), and only genuinely
 * unparseable text is kept for inspection. This function is what tells the two
 * apart, and it is deliberately the same set of checks `parseSms` runs first.
 */
export function isRejectedAsNoise(input: string): boolean {
  if (typeof input !== 'string') return false;
  const text = input.trim();
  if (text.length === 0) return false;

  /*
   * The classifier owns this decision now — see `isDiscardableNoise`, which
   * distinguishes "recognised as junk" (drop it) from "looks like a
   * transaction but could not be read" (keep it, that is a parser gap and the
   * text is the only evidence).
   */
  if (isDiscardableNoise(text)) return true;

  // Retained as a second line of defence; each encodes a real message that
  // once slipped through.
  if (firstMatch(OTP_DELIVERY_PATTERNS, text)) return true;
  if (firstMatch(PROMO_PATTERNS, text)) return true;
  if (firstMatch(BALANCE_ONLY_PATTERNS, text)) return true;

  // A "you received X" with no account named — see the pattern list.
  if (!extractAccount(text) && firstMatch(ACCOUNTLESS_NOTIFICATION_PATTERNS, text)) return true;

  return false;
}

/**
 * Parse an SMS into a money movement, or null when it is not one (OTP delivery,
 * promo, balance report) or cannot be understood well enough to draft. Never
 * throws — a malformed message simply returns null.
 */
export function parseSms(input: string): ParsedSms | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text.length === 0) return null;

  /*
   * The classifier decides IF this is a transaction; the code below only reads
   * WHAT it says.
   *
   * Splitting the two is the point. This function used to do both, via a
   * blocklist of OTP and promo patterns — so anything unanticipated defaulted
   * to "transaction" and became a wrong amount on the board. `classifySms`
   * inverts that: it requires positive evidence of a bank alert, so an unseen
   * marketing format is ignored rather than invented as spend.
   *
   * The old pattern lists are retained below as a second line of defence —
   * they cost nothing and each encodes a real message that once slipped
   * through — but the classifier is what actually holds the line.
   */
  if (!classifySms(text).isTransaction) return null;

  if (firstMatch(OTP_DELIVERY_PATTERNS, text)) return null;
  if (firstMatch(PROMO_PATTERNS, text)) return null;
  if (firstMatch(BALANCE_ONLY_PATTERNS, text)) return null;

  const direction = classifyDirection(text);
  if (!direction) return null;

  const account = extractAccount(text);

  /*
   * A "you received X from <person>" with no account named is a wallet/app
   * notification duplicating a real bank alert — see the pattern list.
   */
  if (!account && firstMatch(ACCOUNTLESS_NOTIFICATION_PATTERNS, text)) return null;

  const amount = extractAmount(text);
  if (amount === null || amount.amountMinor <= 0) return null;

  return {
    direction,
    kind: classifyKind(text, direction),
    amountMinor: amount.amountMinor,
    currency: amount.currency,
    merchant: extractMerchant(text),
    account,
    date: extractDate(text),
    time: extractTime(text),
    raw: text,
  };
}
