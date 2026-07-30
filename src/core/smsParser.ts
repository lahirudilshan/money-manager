/**
 * Turn a raw bank / utility SMS into a structured money movement.
 *
 * This is deliberately a *pure* function over a string — it never touches the
 * database, the store, or any platform API. That keeps it fully testable
 * (see __tests__/smsParser.test.ts, which runs it over src/data/sms-samples.json)
 * and means it does not care how the SMS arrived: deep link, share sheet, paste,
 * or an iOS Shortcuts automation all feed the same text in here.
 *
 * Scope is Sri Lankan LKR alerts. Real banks vary wildly in wording — amount
 * before or after the verb, currency before or after the number, text or dotted
 * dates, the merchant in an "at ...", "Location:...", or "Reason:..." clause —
 * so the extractors below each try several shapes. The goal is not to
 * understand every message perfectly; it is to extract enough for a *draft* the
 * user then confirms or edits. When unsure, we return null rather than guess a
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
  | 'other';

export interface ParsedSms {
  direction: SmsDirection;
  kind: SmsKind;
  /** Amount in minor units (cents), always positive. */
  amountMinor: Minor;
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
 * An LKR amount in either order: "LKR 12,500.00" or "3747.40 LKR". Captures the
 * numeric body (with thousands separators) so it can be normalised to minor.
 * The `g` flag lets us scan every amount and pick the right one.
 */
const AMOUNT_RE = /(?:LKR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*LKR\b/gi;

/**
 * Clauses whose amount is NOT the transaction: the remaining balance and any
 * transaction fee. An amount immediately preceded by one of these is skipped so
 * "Avl Bal 127,496.03" and "Txn Fee: 30.00LKR" never win.
 */
const NON_AMOUNT_CLAUSE_RE = /(?:avl|available)\s*bal(?:ance)?|av\.?\s*bal|txn\s*fee|bal\s*:/i;

/** Convert a matched "12,500.00" body to minor units. */
function amountBodyToMinor(body: string): Minor {
  return toMinor(Number.parseFloat(body.replace(/,/g, '')));
}

/**
 * Pick the amount that represents the actual movement, skipping balance and fee
 * clauses that sit right before an amount. The first surviving amount wins,
 * since banks lead with the transaction value and append the balance.
 */
function extractAmountMinor(text: string): Minor | null {
  for (const match of text.matchAll(AMOUNT_RE)) {
    const index = match.index ?? 0;
    // Look back a short window; if it names a balance or fee, this is not it.
    const preceding = text.slice(Math.max(0, index - 24), index);
    if (NON_AMOUNT_CLAUSE_RE.test(preceding)) continue;
    // Either capture group holds the body, depending on the currency's side.
    const body = match[1] ?? match[2];
    if (body) return amountBodyToMinor(body);
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
    /(?:A\/C|Ac(?:count)?(?:\s*No)?)\s*[:.]?\s*([X*\d]{3,})/i,
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

  // "as CEFTS Outward Transfer." — the transaction type stands in as payee.
  const asType = text.match(/\bas\s+(CEFTS[^.]*Transfer|[A-Z][A-Za-z ]*Transfer)/);
  if (asType) return clean(asType[1]);

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
  if (/\bloan[-\s]/i.test(text) || /Reason\s*:\s*MB:loan/i.test(text)) return 'loan_payment';
  if (/\bATM\b|withdrawal/i.test(text)) return 'atm';
  if (direction === 'credit' && /transfer/i.test(text)) return 'transfer_in';
  if (direction === 'debit' && /transfer/i.test(text)) return 'transfer_out';
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

  const amountMinor = extractAmountMinor(text);
  if (amountMinor === null || amountMinor <= 0) return null;

  return {
    direction,
    kind: classifyKind(text, direction),
    amountMinor,
    merchant: extractMerchant(text),
    account: extractAccount(text),
    date: extractDate(text),
    time: extractTime(text),
    raw: text,
  };
}
