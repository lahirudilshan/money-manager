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
];

const PROMO_PATTERNS: RegExp[] = [
  /\bcashback\b/i,
  /\bspecial offer\b/i,
  /\bpromo(?:tion)?\b/i,
  /T&C\s+apply/i,
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

  // "ref: Inward SWIFT Payment." — the reference names what the money was, and
  // is the only description a SWIFT/remittance credit carries. Stops at the
  // next sentence so the trailing balance and hotline are not swept in.
  const ref = text.match(/\bref\s*[:.]?\s*([^.\n]+)/i);
  if (ref) return clean(ref[1]);

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
  if (/\bATM\b|withdrawal/i.test(text)) return 'atm';
  // Inward money arrives under several names: a plain "transfer", or the
  // remittance wording a cross-border payment uses ("Inward SWIFT Payment",
  // "remittance"). All are the same thing to the board — money landing.
  if (direction === 'credit' && /transfer|swift|remittance|inward/i.test(text)) {
    return 'transfer_in';
  }
  if (direction === 'debit' && /transfer|outward/i.test(text)) return 'transfer_out';
  if (/\bPOS TXN\b|purchase/i.test(text)) return 'purchase';
  if (/\bbill\b[^.]*\bdue\b|due (?:on|by)/i.test(text)) return 'utility';
  return 'other';
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

  if (firstMatch(OTP_DELIVERY_PATTERNS, text)) return null;
  if (firstMatch(PROMO_PATTERNS, text)) return null;
  if (firstMatch(BALANCE_ONLY_PATTERNS, text)) return null;

  const direction = classifyDirection(text);
  if (!direction) return null;

  const amount = extractAmount(text);
  if (amount === null || amount.amountMinor <= 0) return null;

  return {
    direction,
    kind: classifyKind(text, direction),
    amountMinor: amount.amountMinor,
    currency: amount.currency,
    merchant: extractMerchant(text),
    account: extractAccount(text),
    date: extractDate(text),
    time: extractTime(text),
    raw: text,
  };
}
