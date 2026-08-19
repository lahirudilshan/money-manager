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
import { toMinor, type Minor } from '~/shared/lib/money';

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
  /**
   * A qualifier shown after the merchant — "HNB ATM Withdrawal — Txn Fee".
   *
   * Kept OUT of `merchant` on purpose. The merchant is matched against learned
   * rules and scored for a category, so folding a qualifier into it would make
   * the fee row a different merchant from its own parent and teach the learning
   * table a name no future message will ever repeat. This is presentation: what
   * distinguishes this row from the one above it.
   *
   * Empty for ordinary messages, which have nothing to qualify.
   */
  detail?: string;
  /** Account / card fragment the message referenced (often last 4). */
  account: string;
  /**
   * The masked account the money went TO, verbatim ("13802XXXXX50"), or ''.
   *
   * Kept whole rather than reduced to a visible tail, which is what `account`
   * holds. HNB's payee tail is a mere "50" — useless as an identity, since
   * every account ending in 50 shares it (see MIN_MATCHABLE_ACCOUNT_DIGITS) —
   * while the full masked string is distinctive enough to recognise the SAME
   * payee across messages. That is exactly what an unnamed transfer needs: the
   * user typed no reason and the bank named no merchant, so the destination is
   * the only stable thing about it.
   *
   * Absent on anything that is not a transfer out to a named account — which
   * is most messages, hence optional rather than an empty string every caller
   * would have to supply.
   */
  payeeAccount?: string;
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

/**
 * The transaction-type label an alert states after its `SMS ALERT:` heading.
 *
 * Captured so both the direction and the finer kind can read the SAME token,
 * rather than each re-guessing from loose keywords scattered through the text.
 *
 * The separator is `\s*:?\s*` because the heading is written both ways in the
 * wild — "HNB SMS ALERT:INTERNET" glued, and "HNB SMS ALERT: PURCHASE" spaced.
 */
const ALERT_LABEL_RE = /\bSMS\s+ALERT\s*:?\s*([A-Z][A-Z\s/&-]{1,24}?)\s*(?:,|$)/i;

/** The label this message states as its transaction type, uppercased, or ''. */
function alertLabel(text: string): string {
  const match = text.match(ALERT_LABEL_RE);
  return match ? match[1].trim().toUpperCase() : '';
}

/**
 * Alert labels that mean money LEFT the account.
 *
 * Each is a way HNB names an outgoing transaction on a card or account.
 * "INTERNET" and "IPG" are card-not-present payments (an internet payment
 * gateway); "POS" is in person; the rest are self-describing. Deliberately a
 * fixed list rather than "any label", because the same heading also introduces
 * credits and notices, and guessing a direction from an unknown label would
 * invent spend out of a message nobody has read yet.
 */
const DEBIT_ALERT_LABELS =
  /^(?:INTERNET|IPG|POS|PURCHASE|ATM|CASH\s*WITHDRAWAL|WITHDRAWAL|FUND\s*TRANSFER|TRANSFER\s*OUT|OUTWARD\s*TRANSFER|PAYMENT|DEBIT|STANDING\s*ORDER|BILL\s*PAYMENT)$/;

/** Alert labels that mean money ARRIVED. */
const CREDIT_ALERT_LABELS = /^(?:CREDIT|DEPOSIT|INWARD\s*TRANSFER|TRANSFER\s*IN|SALARY|REFUND)$/;

const DEBIT_PATTERNS: RegExp[] = [
  /\bdebited\b/i,
  /\bwithdrawal\b/i,
  /\bpurchase\b/i,
  /\bPOS TXN\b/i,
  /\bspent\b/i,
  /*
   * The transaction TYPE stated as a bare label, HNB's field-list style:
   *
   *   "HNB SMS ALERT:INTERNET, Account:1380***6626,Location:UBER EATS, LK,..."
   *
   * These messages never conjugate a verb — the type IS the label after
   * "SMS ALERT:" — so every pattern above missed them and `classifyDirection`
   * returned null. That is a silent drop: the message is transaction-shaped, so
   * the classifier accepts it and `isDiscardableNoise` correctly keeps it, and
   * it then sits in the inbox file forever while the user watches the file grow
   * and no transaction appear. Only "PURCHASE" ever worked, because that word
   * happens to also be a debit verb.
   *
   * "INTERNET" is an online card purchase (HNB's word for a card-not-present
   * payment); the rest are the labels the same alert uses for the other ways
   * money leaves. Anchored to the `SMS ALERT:` prefix so these short, common
   * words cannot fire on an unrelated message that merely contains them.
   *
   * Applied in `classifyDirection` rather than listed here, because the test is
   * over the EXTRACTED label, not over the raw text a RegExp list matches.
   */
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

/**
 * A fee the message itemises ALONGSIDE the transaction.
 *
 * An ATM e-receipt states two separate movements in one SMS:
 *
 *   Amt(Approx.): 85000.00 LKR   <- the withdrawal
 *   Txn Fee: 30.00LKR            <- the bank's charge
 *
 * Both are real money leaving the account, and until now only the first
 * survived. `extractAmount` deliberately SKIPS the fee clause so the receipt
 * reports 85,000 rather than 30 — correct, but it meant the 30 was read,
 * recognised as not-the-amount, and then thrown away. The user's balance
 * dropped by 85,030 while the board recorded 85,000, and nothing on screen
 * accounted for the difference.
 *
 * So the fee is extracted too, and the caller emits it as its own draft on the
 * bank-charges line. The alternative — folding 30 into the withdrawal — is
 * worse: it inflates a cash figure the user can reconcile against what came out
 * of the machine, and it hides the charge on the one line that exists to make
 * charges visible.
 *
 * Returns null when the message itemises no fee, which is nearly all of them.
 */
export interface ItemisedFee {
  amountMinor: Minor;
  currency: string | null;
  /** The label the bank used, for the draft's description. */
  label: string;
}

/**
 * Fee labels, each followed by its amount.
 *
 * Anchored on the LABEL rather than on the word "fee" anywhere, because a
 * receipt that merely mentions charges is not itemising one. The amount must
 * follow the label directly — a lone "Txn Fee" with no figure yields nothing
 * rather than borrowing a number from elsewhere in the message.
 *
 * `\s*[:.]?\s*` keeps the separator optional: "Txn Fee: 30.00LKR",
 * "Txn Fee 30.00", and "Fee:30.00LKR" all occur.
 */
/**
 * The labels that may introduce an itemised fee.
 *
 * A QUALIFIED label ("Txn Fee", "Service Charge") is unambiguous — the words
 * name the line item's own type. A BARE "Fee"/"Charges" is not, and that
 * ambiguity is what produced the 9,000-rupee "bank fee": the bare alternative
 * matched a loose "charge" anywhere in the receipt and then swallowed the
 * WITHDRAWAL's amount, because nothing required the number to belong to the
 * label it was read from.
 *
 * Both are still accepted — banks really do print "Fee:30.00LKR" — but the bare
 * form is fenced in by `FEE_LABEL_SEPARATOR` below, which demands the amount sit
 * directly against the label rather than merely somewhere after it.
 */
const QUALIFIED_FEE_LABEL =
  '(?:txn|transaction|service|handling|processing|atm|bank|withdrawal|cash)\\s+(?:fee|fees|charge|charges)';

/**
 * What may sit between a fee's label and its amount: a colon, a dot, or spaces
 * — nothing else.
 *
 * This is the guard that keeps a fee's amount its OWN. Previously the separator
 * was `\s*[:.]?\s*`, which looks strict but sits in front of an alternation
 * whose second branch made the currency optional, so "Charges" could bind to a
 * number several tokens away — the receipt's real amount. Requiring the label
 * and figure to be adjacent means "Amt(Approx.): 9000.00 LKR ... Txn Fee:
 * 30.00LKR" can only ever read 30, and a receipt that mentions "charges" in
 * passing yields no fee at all rather than borrowing the withdrawal's number.
 */
const FEE_LABEL_SEPARATOR = '\\s*[:.]?\\s{0,3}';

const ITEMISED_FEE_RE = new RegExp(
  `\\b(${QUALIFIED_FEE_LABEL}|fee|charges?)${FEE_LABEL_SEPARATOR}` +
    `(?:(${CURRENCY_ALTERNATION})\\s*([\\d,]+(?:\\.\\d{1,2})?)|([\\d,]+(?:\\.\\d{1,2})?)\\s*(${CURRENCY_ALTERNATION})?)`,
  'i',
);

/**
 * The share of a transaction a plausible fee may be.
 *
 * A bank charge is a small cut of what it is charged on — 30 rupees on a 9,000
 * withdrawal is 0.3%. When a "fee" reads as a large fraction of the parent, the
 * label almost certainly captured the transaction's own amount, which is exactly
 * the misread that put 9,000 on the Bank charges line while the 30 beside it was
 * right. Half is deliberately loose: it rejects the misread (which reads 100%)
 * without second-guessing a genuinely steep charge on a small transfer.
 */
const MAX_FEE_SHARE_OF_PARENT = 0.5;

/**
 * The largest amount that can be a bank charge, in minor units.
 *
 * A bank charge is small — transfer charges, stamp duty and ATM fees are tens
 * of rupees, occasionally a few hundred. Nothing in four figures is a fee, and
 * treating this as a hard ceiling rather than a heuristic is what makes the
 * guarantee testable: no message, by any path, may be classified `bank_charge`
 * above it.
 *
 * 1,000 LKR is deliberately well above any real charge while far below the
 * withdrawals and transfers that were reaching the board as five-figure
 * "bank charges".
 */
export const MAX_PLAUSIBLE_CHARGE_MINOR = 100_000;

/**
 * Read a fee itemised inside a message that is mostly about something else.
 *
 * Only meaningful when the message's OWN kind is not already a bank charge —
 * a "CEFTS Transfer Charges" alert IS the fee, and splitting it would double
 * it. The caller enforces that; see `feeDraftFor` in the store.
 */
export function extractItemisedFee(text: string): ItemisedFee | null {
  if (typeof text !== 'string') return null;

  const match = text.match(ITEMISED_FEE_RE);
  if (!match) return null;

  const body = match[3] ?? match[4];
  if (!body) return null;

  const amountMinor = amountBodyToMinor(body);

  /*
   * A zero or absurd fee is not one.
   *
   * Banks print "Txn Fee: 0.00" on transactions they did not charge for, and
   * queueing a zero-rupee draft for the user to confirm is pure noise. The
   * upper bound guards the other failure: if the label ever matches loosely
   * enough to capture the transaction's own amount, an 85,000 "fee" is plainly
   * a misread and is better dropped than shown.
   */
  if (amountMinor <= 0) return null;

  return {
    amountMinor,
    currency: (match[2] ?? match[5] ?? null)?.toUpperCase() ?? null,
    label: clean(match[1]),
  };
}

/**
 * A utility bill delivered as a LABELLED STATEMENT rather than a sentence.
 *
 * Every bill format above narrates itself — "your bill of LKR 3,450 is due on
 * 15 Aug" — and the parser reads it with the same machinery it uses on a POS
 * alert: find the verb, take the first amount. A CEB e-bill is a different
 * document entirely. It is a ledger with named rows:
 *
 *   B/F: Rs. 9,470.76             last month's balance, carried forward
 *   Payments: Rs. 9,500.00        what has already been paid
 *   Outstanding: Rs. 23.84 by 2026-08-11
 *   Reading: 12764 - 12575 = 189 Units
 *   Monthly Bill: Rs. 9,071.79    this month's charge
 *   Total Due: Rs. 9,095.63       what the utility actually wants
 *
 * Read by the general extractors, this message produced NOTHING — no direction
 * matched, so it was dropped in silence. Read carelessly, it is worse than
 * nothing: the first amount in the text is `B/F`, a figure the user has already
 * paid and does not owe, sitting 375 rupees away from the real one. Neither
 * error is visible on screen, which is why the total is read from its LABEL
 * here rather than by position.
 *
 * Returns null for anything that is not a statement, so the ordinary path is
 * untouched.
 */
export interface StatementBill {
  /** What the utility is asking for — the payable figure. */
  totalDueMinor: Minor;
  /** This period's charge alone, before any carried balance. */
  monthlyBillMinor: Minor | null;
  /** Arrears carried in from previous periods. */
  outstandingMinor: Minor | null;
  /** Units consumed this period, as STATED by the biller. */
  units: number | null;
  /** Current meter reading. */
  readingCurrent: number | null;
  /** Previous meter reading. */
  readingPrevious: number | null;
  /** ISO date the meter was read. */
  readingDate: string | null;
  /** The utility account this bill is for. */
  accountNumber: string | null;
}

/**
 * A labelled money row: "Total Due: Rs. 9,095.63".
 *
 * Built per-label rather than as one generic "label: amount" scan, because the
 * whole point is to know WHICH figure was found. A generic scan would hand back
 * five numbers with no way to tell the total from the balance brought forward.
 */
function labelledAmount(text: string, label: RegExp): Minor | null {
  const re = new RegExp(
    `${label.source}\\s*[:.]?\\s*(?:${CURRENCY_ALTERNATION}|Rs\\.?)?\\s*([\\d,]+(?:\\.\\d{1,2})?)`,
    'i',
  );
  const match = text.match(re);
  if (!match) return null;
  return amountBodyToMinor(match[1]);
}

/**
 * The label that makes a statement payable.
 *
 * "Total Due" is the one row that must be present: without it there is no
 * figure to put in front of the user, and a message carrying only a reading and
 * a brought-forward balance is a notice, not a bill. Accepting "Amount Due" and
 * "Payable" alongside it because utilities word the same row all three ways.
 */
const TOTAL_DUE_LABEL = /\b(?:total\s+due|amount\s+due|total\s+payable|payable\s+amount)\b/;

/**
 * Wording that proves money ALREADY MOVED, which a statement never claims.
 *
 * A statement projects forward: it says what is owed and when. The moment a
 * message also reports a completed debit or credit, it is a transaction alert
 * that happens to quote a balance — and reading it as a statement loses the
 * transaction.
 *
 * This is not hypothetical. A credit-card alert states both:
 *
 *   "LKR 25,000.00 debited. Total Due: LKR 3,000.00 on your card ending 1234"
 *
 * Without this guard the `Total Due` label wins, the message becomes a
 * 3,000-rupee utility bill, and the 25,000 that actually left the account is
 * never recorded — the worst failure this parser can produce, because the
 * missing spend is invisible rather than wrong on screen.
 */
const COMPLETED_MOVEMENT =
  /\b(?:debited|credited|withdrawn|deposited|transferred|spent|purchased|reversed|refunded)\b/i;

export function extractStatementBill(text: string): StatementBill | null {
  if (typeof text !== 'string') return null;

  /*
   * A message reporting a completed movement is not a statement — see above.
   * Checked first, because this decides what KIND of document it is before any
   * figure is read out of it.
   */
  if (COMPLETED_MOVEMENT.test(text)) return null;

  const totalDueMinor = labelledAmount(text, TOTAL_DUE_LABEL);
  /*
   * No labelled total means this is not a statement. Deliberately the ONLY way
   * in: every other field below is optional, so without this gate a POS alert
   * that happens to mention "outstanding" would produce a bill with no amount.
   */
  if (totalDueMinor === null || totalDueMinor <= 0) return null;

  /*
   * The meter line: "Reading: 12764 - 12575 = 189 Units".
   *
   * `units` is taken from the STATED figure, never from `current - previous`.
   * A meter rolls over past its maximum and restarts at zero, which makes the
   * subtraction hugely negative while the biller prints the true count — so
   * recomputing it would put a negative bar on the usage chart on exactly the
   * month the reading is most interesting.
   */
  const reading = text.match(
    /\bReading\s*[:.]?\s*(\d+)\s*-\s*(\d+)\s*=\s*(\d+)\s*Units?\b/i,
  );
  // A statement may print only the consumption, with no meter pair.
  const unitsOnly = reading ? null : text.match(/\b(\d+)\s*Units?\b/i);

  const readingDate = text.match(/\bReading\s+Date\s*[:.]?\s*(\d{4}-\d{2}-\d{2})/i);
  const account = text.match(/\bA\/C\s*(?:No)?\s*[:.]?\s*(\d{6,})/i);

  return {
    totalDueMinor,
    monthlyBillMinor: labelledAmount(text, /\b(?:monthly\s+bill|current\s+bill|this\s+month)\b/),
    outstandingMinor: labelledAmount(text, /\boutstanding\b/),
    units: reading ? Number(reading[3]) : unitsOnly ? Number(unitsOnly[1]) : null,
    readingCurrent: reading ? Number(reading[1]) : null,
    readingPrevious: reading ? Number(reading[2]) : null,
    readingDate: readingDate ? readingDate[1] : null,
    accountNumber: account ? account[1] : null,
  };
}

/**
 * The fee a message itemises, as a movement in its own right.
 *
 * Returns null unless the message states BOTH a transaction and a separate fee
 * — which in practice means ATM receipts and little else.
 *
 * ## Why the fee gets its own draft rather than being added to the parent
 *
 * The two figures answer different questions and belong on different lines. The
 * 85,000 is cash the user withdrew and will reconcile against what the machine
 * handed them; the 30 is what the bank took for handing it over. Folding them
 * into 85,030 breaks the first and hides the second on the one line — "Bank
 * charges" — that exists precisely to make these visible and add them up.
 *
 * ## Why the raw text is annotated
 *
 * The draft's `raw` gets a "— Txn Fee" suffix. That is not cosmetic: the queue
 * de-duplicates on a fingerprint of `raw`, so a fee draft carrying the parent's
 * text verbatim would hash identically to the withdrawal and be rejected as a
 * duplicate of it. The suffix also means the review card shows the user which
 * half of the receipt each row came from.
 */
/**
 * The marker that turns a receipt's text into the FEE half of it.
 *
 * The queue stores `raw` and re-parses it on every load (see `loadSmsDrafts`),
 * so a fee row holding the receipt's text verbatim re-reads as the withdrawal —
 * 85,000 instead of 30, the parent counted twice. The marker is what makes the
 * split survive a round trip through the database, and `parseSms` honours it
 * before doing anything else.
 *
 * On screen it reads as a plain continuation line ("— Txn Fee"), so the review
 * card shows which half of the receipt the row came from.
 */
const FEE_MARKER = '\n— ';

/**
 * The receipt text a fee row was split OUT of, or null when it is not one.
 *
 * Used to keep the pair together on screen. The two rows share an account, a
 * date and a time, so the queue's "newest first" ordering falls through to
 * arrival order and puts the LATER-inserted fee above the withdrawal it was
 * charged for — the 30 rupees appearing before the 85,000 that explains it.
 *
 * Returning the parent's text rather than a boolean lets the caller match a fee
 * to its own parent specifically, which matters once a queue holds two ATM
 * receipts.
 */
export function parentReceiptOf(text: string): string | null {
  if (typeof text !== 'string') return null;
  if (markedFeeLabel(text) === null) return null;

  return text.slice(0, text.lastIndexOf(FEE_MARKER));
}

/** The fee label a marked message carries, or null when it is not marked. */
function markedFeeLabel(text: string): string | null {
  const at = text.lastIndexOf(FEE_MARKER);
  if (at === -1) return null;

  const label = text.slice(at + FEE_MARKER.length).trim();
  // A marker with nothing after it, or with a whole line after it, is not ours.
  if (label.length === 0 || label.includes('\n')) return null;

  return label;
}

export function splitItemisedFee(parsed: ParsedSms): ParsedSms | null {
  /*
   * A message that IS a fee is not split.
   *
   * "CEFTS Transfer Charges" would otherwise match its own fee vocabulary and
   * spawn a second draft for the same 25 rupees — the charge counted twice.
   */
  if (parsed.kind === 'bank_charge') return null;

  // Only a debit can carry one. A credit that mentions a fee is describing a
  // charge being refunded, which is the reversal path's business, not this one.
  if (parsed.direction !== 'debit') return null;

  const fee = extractItemisedFee(parsed.raw);
  if (!fee) return null;

  /*
   * Guard against the fee reading as the transaction itself.
   *
   * If a loose label match ever captured the main amount, the "fee" would equal
   * the parent and double the spend. Equal amounts are far more likely to be
   * that misread than a genuine fee that happens to match the withdrawal.
   *
   * The SHARE test extends that to the near-misses the equality test let
   * through. A 9,000 "fee" on a 9,000 withdrawal was caught; the same misread
   * reading a slightly different figure was not, and it reached the board as a
   * five-figure bank charge. A fee is a small cut of its parent or it is not a
   * fee — see `MAX_FEE_SHARE_OF_PARENT`.
   */
  if (fee.amountMinor >= parsed.amountMinor) return null;
  if (fee.amountMinor > parsed.amountMinor * MAX_FEE_SHARE_OF_PARENT) return null;

  return {
    ...parsed,
    kind: 'bank_charge',
    amountMinor: fee.amountMinor,
    currency: fee.currency ?? parsed.currency,
    merchant: feeMerchant(parsed.merchant),
    /*
     * Just "fee", not the bank's "Txn Fee".
     *
     * The pair reads "HNB ATM Withdrawal" and "HNB ATM Withdrawal — fee",
     * which says everything the user needs — which transaction this belongs
     * to, and that it is the charge rather than a second withdrawal — in the
     * least width. The bank's own label adds a word without adding meaning,
     * and the row is competing for space with the amount beside it.
     */
    detail: 'fee',
    raw: `${parsed.raw}${FEE_MARKER}${fee.label}`,
  };
}

/**
 * What the fee row calls itself.
 *
 * The PARENT's name, unchanged — "HNB ATM Withdrawal" — with the qualifier
 * carried separately in `detail` so the card reads "HNB ATM Withdrawal — Txn
 * Fee". That split matters beyond presentation: the merchant is what learned
 * rules key on and what the categoriser scores, so appending "fee" here would
 * make the charge a different merchant from the withdrawal it came from and
 * teach the learning table a name no future message will ever repeat.
 *
 * Falls back to a plain "Bank fee" when the parent has no name to borrow, since
 * a row needs something to show.
 */
function feeMerchant(parentMerchant: string): string {
  const parent = clean(parentMerchant ?? '');
  return parent.length === 0 ? 'Bank fee' : parent;
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
 * The masked account the money was sent TO, verbatim, or ''.
 *
 * Only "to Ac No:…" / "to A/C …" shapes — the preposition is what makes it a
 * destination rather than the source account the alert is about. Returned with
 * its mask intact because the mask is what makes it identifying: the visible
 * tail alone ("50") is shared by every account ending in those digits.
 */
function extractPayeeAccount(text: string): string {
  const match = text.match(
    /\bto\s+(?:A\/C|Ac(?:count)?)(?:\s*No)?\s*[:.]?\s*([X*\d]{6,})/i,
  );
  return match ? match[1].trim() : '';
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
 * Placeholders a bank prints where a reason would go when the user gave none.
 *
 * "ref" is HNB's — `Reason:MB:ref` is an empty marker, not a description, and
 * treating it as one is what previously produced merchants like "Bal:LKR
 * 405,757". These are rejected so a transfer with no stated purpose keeps an
 * empty merchant and is still recognised as an internal transfer by
 * `classifyKind`, which depends on exactly that emptiness.
 */
const EMPTY_REASON_MARKERS = /^(?:ref|n\/?a|nil|none|self|own|transfer|fund\s*transfer)$/i;

/**
 * The reason the user typed for a mobile-banking transfer, or ''.
 *
 * Stops at the bank's own trailing boilerplate — the balance, the scam warning,
 * the hotline — none of which is part of what the user wrote. Everything about
 * this is deliberately conservative, because the value becomes the row's name
 * and is fed to the learning table: a wrong reason teaches a merchant that will
 * never recur.
 */
function transferReason(text: string): string {
  const match = text.match(
    /Reason\s*:\s*(?:MB\s*:)?\s*([^\n]*?)(?=\s*(?:Bal(?:ance)?\s*[:.]|Av\.?\s*Bal|Protect\s+from|Hot\s?line|Call\s+\d|DO\s+NOT\s+SHARE|(?:transfer|txn|transaction|service|handling|processing|atm)\s+(?:charge|charges|fee|fees)\b|charges?\s*(?:applied|debited)\b)|[.\n]|$)/i,
  );
  if (!match) return '';

  const value = clean(match[1]);
  if (value.length === 0) return '';

  // A placeholder is the bank saying "no reason given" — see the marker list.
  if (EMPTY_REASON_MARKERS.test(value)) return '';

  /*
   * It must read as WORDS.
   *
   * A bare reference number ("TXN9931", "0071") describes nothing to the user
   * and would only pollute the learning table, so a reason with no real word in
   * it is treated as absent. Requiring three letters also keeps a stray
   * currency fragment out.
   */
  if (!/[a-z]{3,}/i.test(value)) return '';

  return value;
}

/**
 * Whether the BANK named a payee — a merchant that is not merely the reason the
 * user typed.
 *
 * The distinction is what keeps an annotated transfer a transfer. Both produce
 * a merchant, but only one means the money reached a shop; see the MB rule in
 * `classifyKind`.
 */
function namesPayee(text: string): boolean {
  const merchant = extractMerchant(text);
  if (merchant.length === 0) return false;

  // A merchant that is exactly the typed reason is not a payee.
  return merchant !== transferReason(text);
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

  /*
   * The reason the USER typed when they made the transfer.
   *
   * A mobile-banking transfer names no merchant — there is nothing for the bank
   * to print, because the money went to an account rather than a shop. What it
   * does carry is the reference the user wrote themselves:
   *
   *   "LKR 40,000.00 debited to Ac No:13802XXXXX50 ... Reason:MB:food expenses"
   *
   * That is the single best description of the transaction available anywhere in
   * the message — better than most merchant names, because the user chose it to
   * describe this exact payment. It was being thrown away: the merchant came out
   * empty, so the card showed "Need a category" on a message that says in plain
   * words what it was for.
   *
   * Read here, ahead of the generic clauses below, because a typed reason
   * outranks anything inferred from the message's boilerplate.
   */
  const reason = transferReason(text);
  if (reason) return reason;

  /*
   * A receipt TITLE outranks a Location field.
   *
   * On a POS alert `Location:` is the payee ("KEELLS SUPER") and belongs here.
   * On an ATM receipt it is where the MACHINE stood — "ICBS", "DFCC bank" —
   * which is an operator code the user has never heard of, printed where they
   * expect to read what happened. Three of the user's real withdrawals reached
   * the review queue titled "ICBS , LKA" and "DFCC bank , LKA", while the
   * message's own first line said "HNB ATM Withdrawal e-Receipt" all along.
   *
   * `receiptTitle` only fires on a first line that names a transaction type, so
   * a POS alert (which has no such heading) still falls through to Location
   * below and keeps its real merchant. The location is not discarded — it moves
   * to `detail` and shows after the name.
   */
  const title = receiptTitle(text);
  if (title) return title;

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
   *
   * A fee clause is one of those stops for the same reason. "Reason:MB:ref.
   * Transfer charge LKR 25.00" is a bare marker followed by the bank's own fee
   * line, and without the stop the merchant came out as "Transfer charge LKR
   * 25" — the fee described as if it were the payee.
   */
  const ref = text.match(
    /\bref\s*[:.]?\s*([^.\n]*?)(?=\s*(?:Bal(?:ance)?\s*[:.]|Av\.?\s*Bal|Protect\s+from|Hot\s?line|Call\s+\d|DO\s+NOT\s+SHARE|(?:transfer|txn|transaction|service|handling|processing|atm)\s+(?:charge|charges|fee|fees)\b|charges?\s*(?:applied|debited)\b|$)|[.\n])/i,
  );
  if (ref) {
    const value = clean(ref[1]);
    // Must contain real words — a bare "ref" marker, a reference number, or a
    // stray currency fragment names nothing and is worse than no merchant.
    if (/[a-z]{3,}/i.test(value) && !/^\s*(?:LKR|Rs\.?)\b/i.test(value)) return value;
  }

  return '';
}


/**
 * The human-readable title at the top of a receipt-style message, or ''.
 *
 * Deliberately narrow. It only accepts a FIRST line that names a transaction
 * type, so an ordinary alert whose opening words happen to be a sentence is not
 * mistaken for a heading — the test is that the line describes the transaction
 * ("Withdrawal", "Transfer", "Purchase", "e-Receipt") and carries no amount of
 * its own.
 */
function receiptTitle(text: string): string {
  const [line = ''] = text.split('\n');
  const heading = clean(line);

  // A heading is short and label-like; a sentence is not.
  if (heading.length === 0 || heading.length > 60) return '';

  // If it states an amount it is the transaction line, not a title.
  if (/\d[\d,]*\.\d{2}/.test(heading)) return '';

  /*
   * A title stands ALONE on its line.
   *
   * Both of the user's HNB formats open with the word "PURCHASE" or
   * "Withdrawal", so naming a transaction type is not enough to tell them
   * apart:
   *
   *   "HNB ATM Withdrawal e-Receipt\nAmt(Approx.): ..."      <- a heading
   *   "HNB SMS ALERT: PURCHASE, Debit account:1380***4150,Location:SPAR..."
   *
   * The second is one long comma-separated run carrying the entire
   * transaction, and treating its opening words as a title retitled every
   * KEELLS and SPAR purchase with the bank's letterhead. A comma or a labelled
   * field on the same line means the message started reporting immediately, so
   * this is not a heading.
   */
  if (/[,;]/.test(heading)) return '';
  if (/\b(?:account|a\/c|amount|location|bal)\b\s*[:.]/i.test(heading)) return '';

  const namesTransaction =
    /\b(?:e-?receipt|withdrawal|withdrawl|deposit|transfer|purchase|payment|transaction)\b/i.test(
      heading,
    );
  if (!namesTransaction) return '';

  /*
   * "e-Receipt" is dropped from the end.
   *
   * "HNB ATM Withdrawal" is what the user recognises; "e-Receipt" is the
   * bank's word for the format, and it only makes the row longer.
   */
  return clean(heading.replace(/\s*e-?receipt\s*$/i, ''));
}

function firstMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Who issued a statement bill.
 *
 * A statement names no merchant anywhere — there is no "at KEELLS SUPER" clause
 * to read, because the biller is not a shop and the document assumes you know
 * who sent it. `extractMerchant` therefore returns an empty string, and a draft
 * with no name reads as "Need a category" on a message that is unambiguously an
 * electricity bill.
 *
 * The e-bill LINK is the reliable identifier: CEB's statement carries
 * `ebill.ceb.lk`, and the domain is the one part of the format a utility cannot
 * change without changing where its customers go to pay. Matched ahead of the
 * body text for that reason.
 *
 * Falls back to a generic "Utility bill" rather than guessing, so an unknown
 * biller still produces a usable draft the user can rename — the amount and the
 * due figure are the parts that matter, and inventing a wrong name to sit above
 * them would be worse than admitting we do not know.
 */
const STATEMENT_BILLERS: [host: RegExp, name: string][] = [
  [/\bceb\.lk\b|\bceb\b/i, 'CEB Electricity'],
  [/\bleco\b/i, 'LECO Electricity'],
  [/\bwaterboard\.lk\b|\bnwsdb\b|\bwater\s+board\b/i, 'Water Board'],
];

function statementBiller(text: string): string {
  for (const [pattern, name] of STATEMENT_BILLERS) {
    if (pattern.test(text)) return name;
  }
  return 'Utility bill';
}

/** Direction from the wording; debit-issued bills fall through to 'bill'. */
function classifyDirection(text: string): SmsDirection | null {
  /*
   * A labelled statement is a bill, and it is checked FIRST.
   *
   * It has to outrank the debit verbs below, because a statement narrates
   * completed history on its way to stating what is owed: the CEB bill contains
   * "Payments: Rs. 9,500.00" and a "Debits:" row, so `DEBIT_PATTERNS` would
   * claim it as a 9,470-rupee spend that never happened. The `Total Due` label
   * is what this message IS; the debit rows are its arithmetic.
   */
  if (extractStatementBill(text) !== null) return 'bill';

  if (firstMatch(CREDIT_PATTERNS, text)) return 'credit';
  if (firstMatch(DEBIT_PATTERNS, text)) return 'debit';
  if (firstMatch(BILL_PATTERNS, text)) return 'bill';

  /*
   * Fall back to the alert's own TYPE LABEL, for the field-list formats that
   * state what happened instead of narrating it — see `DEBIT_ALERT_LABELS`.
   *
   * Checked last so the verb wins wherever a message has one: the verb
   * describes this specific transaction, while the label is a channel name that
   * a bank could in principle reuse across a reversal or a notice.
   */
  const label = alertLabel(text);
  if (label) {
    if (CREDIT_ALERT_LABELS.test(label)) return 'credit';
    if (DEBIT_ALERT_LABELS.test(label)) return 'debit';
  }

  return null;
}

/**
 * The finer kind, from cues in the text. Order matters: a loan reason and an
 * ATM receipt are recognised before the generic transfer/purchase split.
 */
/**
 * @param amountMinor The amount `parseSms` settled on, so the bank-charge rule
 * can tell a message that IS a fee from one that merely names its fee.
 */
function classifyKind(text: string, direction: SmsDirection, amountMinor: number): SmsKind {
  /*
   * A statement bill is a utility bill, stated outright.
   *
   * The generic rule below looks for "bill ... due" or "due on/by", and a
   * statement says neither — its total is a labelled row. Without this the kind
   * fell through to `other`, which costs the draft its "Bill due" label and the
   * utility prior the categoriser uses to find the right line.
   */
  if (direction === 'bill' && extractStatementBill(text) !== null) return 'utility';

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
    /*
     * Only when the amount read IS the fee.
     *
     * These patterns fire on fee vocabulary anywhere in the message, which is
     * right for "debited LKR 25.00 as CEFTS Transfer Charges" — the message is
     * the fee. It is wrong for a message that reports a TRANSACTION and names
     * its fee in passing: "LKR 10,000.00 transferred ... Transfer charge LKR
     * 50.00" is a 10,000 transfer, and tagging the whole thing a charge put the
     * transaction's amount on the Bank charges line. That is how five-figure
     * "bank charges" reached the board.
     *
     * Two signals separate them, both already computed:
     *
     *  - an itemised fee that differs from the amount read means the message
     *    itemises a fee SEPARATELY, so the amount is the parent transaction;
     *    `splitItemisedFee` will raise the fee as its own draft.
     *  - failing that, a charge that is a large share of nothing else to
     *    compare against is judged on plausibility: real bank charges are
     *    small. `MAX_PLAUSIBLE_CHARGE_MINOR` is deliberately generous — it
     *    exists to reject a withdrawal misread as a fee, not to second-guess a
     *    genuinely steep one.
     */
    const itemised = extractItemisedFee(text);
    const amountIsTheFee = !itemised || itemised.amountMinor === amountMinor;
    if (amountIsTheFee && amountMinor <= MAX_PLAUSIBLE_CHARGE_MINOR) {
      return 'bank_charge';
    }
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
   * Narrow on purpose: a `MB:` channel marker, a debit, and no PAYEE recovered.
   * A mobile-banking payment that DOES name a payee keeps flowing to the
   * merchant rules below, where it belongs.
   *
   * The payee test deliberately ignores a typed REASON. "Reason:MB:food
   * expenses" is the user describing their own transfer, not the bank naming a
   * shop — the money still went to an account — so a transfer that carries one
   * must stay a `transfer_out` and remain eligible for internal-transfer
   * pairing. Testing `extractMerchant` here instead would silently reclassify
   * every annotated transfer the moment reasons started being read, and a
   * top-up that cannot pair counts as both spend and income.
   */
  if (direction === 'debit' && /\bMB\s*:/i.test(text) && !namesPayee(text)) {
    return 'transfer_out';
  }
  if (/\bPOS TXN\b|purchase/i.test(text)) return 'purchase';
  if (/\bbill\b[^.]*\bdue\b|due (?:on|by)/i.test(text)) return 'utility';

  /*
   * The alert's own type label, for the field-list formats — see
   * `classifyDirection`, which reads the same token for the direction.
   *
   * Without this an "INTERNET" card payment survives as kind `other`, which
   * costs the user the category prior: `scoreSubcategory` treats `purchase`
   * as a merchant spend, while `other` matches nothing in particular and the
   * draft arrives with no suggestion at all. The ATM/transfer labels are
   * mapped for the same reason — a cash withdrawal announced only by its label
   * should still reach the cash line.
   */
  const label = alertLabel(text);
  if (label) {
    if (/^(?:ATM|CASH\s*WITHDRAWAL|WITHDRAWAL)$/.test(label)) return 'atm';
    if (/^(?:FUND\s*TRANSFER|TRANSFER\s*OUT|OUTWARD\s*TRANSFER)$/.test(label)) return 'transfer_out';
    if (/^(?:INWARD\s*TRANSFER|TRANSFER\s*IN|SALARY)$/.test(label)) return 'transfer_in';
    if (/^(?:INTERNET|IPG|POS|PURCHASE)$/.test(label)) return 'purchase';
  }

  return 'other';
}

/**
 * Whether a message looks CUT SHORT rather than genuinely unparseable.
 *
 * The known cause is a Shortcut whose deep link lacks a **URL Encode** action:
 * iOS truncates the URL at the first unencoded space, so the app receives a
 * fragment. That is invisible from the outside — the message simply never
 * appears — and it hits hardest on formats with long runs of spaces inside
 * them. HNB's POS alert pads its Location field ("BEN FOODS" followed by 16
 * spaces), which is exactly the shape that gets clipped.
 *
 * Detected so the intake can SAY "this arrived cut short" instead of silently
 * discarding it, which is the difference between a fixable setup problem and a
 * transaction that vanishes with no trace.
 *
 * Deliberately conservative: it requires the message to open like a real alert
 * AND to stop before reaching anything a complete one always has.
 */
export function looksTruncated(input: string): boolean {
  if (typeof input !== 'string') return false;
  const text = input.trim();

  // Too short to be any real alert, but long enough to be a fragment of one.
  if (text.length < 12) return false;

  // It must LOOK like a bank alert started.
  const startsLikeAlert =
    /\b(?:SMS\s+ALERT|debited|credited|withdrawal|purchase)\b/i.test(text) ||
    /^(?:LKR|USD|Rs\.?)\s*[\d,]/i.test(text);
  if (!startsLikeAlert) return false;

  /*
   * A complete alert always states an AMOUNT. A fragment clipped at the first
   * space usually stops before it — "HNB SMS ALERT: PURCHASE," and nothing
   * else. If a figure is present the message got far enough to be worth
   * parsing, so it is not treated as truncated however odd it looks.
   */
  const hasAmount = /(?:LKR|USD|EUR|GBP|Rs\.?)\s*[\d,]+|[\d,]+(?:\.\d{2})?\s*(?:LKR|USD)/i.test(
    text,
  );

  return !hasAmount;
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
/**
 * Enforce the one invariant a bank charge must satisfy: it is small.
 *
 * Applied to every value `parseSms` returns rather than at the point each kind
 * is decided, because there are several such points — the keyword classifier,
 * the itemised-fee split, and the stored-fee marker path — and each one was
 * separately capable of producing a five-figure "bank charge". Fixing them
 * individually is how this bug survived three rounds of fixes: the paths that
 * were checked were not the paths that fired.
 *
 * A message that names a fee but moves too much money for one is a
 * TRANSACTION that mentions its fee. `transfer_out` is the honest reading for a
 * debit; the fee itself, when the message itemises one, is raised separately by
 * `splitItemisedFee`.
 */
function enforceChargeCeiling(parsed: ParsedSms): ParsedSms {
  if (parsed.kind !== 'bank_charge') return parsed;
  if (parsed.amountMinor <= MAX_PLAUSIBLE_CHARGE_MINOR) return parsed;
  return { ...parsed, kind: parsed.direction === 'credit' ? 'transfer_in' : 'transfer_out' };
}

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

  /*
   * A statement's amount comes from its `Total Due` LABEL, never from position.
   *
   * `extractAmount` returns the first figure that is not a balance or a fee,
   * and on a CEB bill that is `B/F: Rs. 9,470.76` — the balance carried in from
   * last month, which the user has already paid. Reading it would put a wrong
   * five-figure amount in front of them with nothing on screen to reveal it,
   * since one plausible rupee total looks much like another.
   */
  const statement = extractStatementBill(text);

  const amount = extractAmount(text);
  if (!statement && (amount === null || amount.amountMinor <= 0)) return null;

  const resolvedAmountMinor = statement ? statement.totalDueMinor : amount!.amountMinor;

  const base: ParsedSms = {
    direction,
    kind: classifyKind(text, direction, resolvedAmountMinor),
    amountMinor: resolvedAmountMinor,
    /*
     * A statement quotes "Rs." with no ISO code, so `extractAmount`'s currency
     * (read off whichever figure it happened to land on) is the only source —
     * and it is null for these messages either way.
     */
    currency: amount?.currency ?? null,
    merchant: statement ? statementBiller(text) : extractMerchant(text),
    account: statement?.accountNumber ?? account,
    payeeAccount: extractPayeeAccount(text) || undefined,
    /*
     * A statement's own date is the READING date — when the meter was read, not
     * when the money is due. It is the only date in the message that describes
     * this bill (the outstanding-by date belongs to the previous one), so it is
     * what the card shows as "when".
     */
    date: statement?.readingDate ?? extractDate(text),
    time: statement ? null : extractTime(text),
    raw: text,
  };

  /*
   * A message marked as the FEE half of a receipt reads as the fee, not the
   * transaction.
   *
   * The queue re-parses `raw` on every load, so without this a stored fee row
   * comes back as its parent: the 30-rupee ATM charge redisplayed as a second
   * 85,000 withdrawal, doubling the very transaction this split exists to keep
   * accurate. The marker is only ever written by `splitItemisedFee`, and it is
   * checked LAST so a real message that happens to end in a dash line is still
   * parsed normally unless it also itemises a matching fee.
   */
  const marked = markedFeeLabel(text);
  if (marked) {
    const fee = extractItemisedFee(text);
    if (
      fee &&
      fee.amountMinor > 0 &&
      fee.amountMinor < base.amountMinor &&
      // Same share guard the split applies, so a stored row cannot come back
      // from the database as the misread the split refused to create.
      fee.amountMinor <= base.amountMinor * MAX_FEE_SHARE_OF_PARENT
    ) {
      return enforceChargeCeiling({
        ...base,
        kind: 'bank_charge',
        amountMinor: fee.amountMinor,
        currency: fee.currency ?? base.currency,
        /*
         * Named after the PARENT, exactly as `splitItemisedFee` names it.
         *
         * `base.merchant` was read from the receipt body, so it is the
         * withdrawal's own label — "HNB ATM Withdrawal" — and reusing it here
         * keeps a stored fee row identical to a freshly split one. Using the
         * marker's raw text instead would show the bank's "Txn Fee" again
         * after a reload, so the row would rename itself on restart.
         */
        merchant: feeMerchant(base.merchant),
        // Matches `splitItemisedFee`, so a reload cannot rename the row.
        detail: 'fee',
      });
    }
  }

  return enforceChargeCeiling(base);
}
