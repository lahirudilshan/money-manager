/**
 * Decide whether a message is a REAL transaction alert, before anything tries
 * to read an amount out of it.
 *
 * ## Why this is separate from the parser
 *
 * The parser's job is extraction: given a bank alert, pull out the amount, the
 * merchant, the account. It is good at that. What it was also being asked to do
 * — decide whether the text is a bank alert at all — it did with a blocklist: a
 * growing list of OTP and promo patterns, and anything that matched none of
 * them was treated as a transaction.
 *
 * A blocklist is the wrong shape for this problem, and it failed in exactly the
 * way blocklists fail. Every unanticipated marketing format defaults to
 * "transaction", so the failure mode is silent and wrong: a dining offer
 * quoting "Max savings LKR 10,000" became a 10,000-rupee spend, and an OTP
 * reading "password for transaction LKR 2500.00 at CEB is 681854" became a
 * duplicate electricity bill. Each fix was another pattern, and the next unseen
 * format was another wrong transaction.
 *
 * ## What this does instead
 *
 * Requires POSITIVE EVIDENCE. A message must look like a bank alert to be
 * treated as one, and the default for anything unrecognised is rejection. That
 * inverts the failure mode: an unseen promo is now ignored (safe, and visible
 * as a message that never appeared), rather than silently invented as spend.
 *
 * Evidence is scored rather than required outright, because real alerts vary —
 * some name no merchant, some no account, HNB's carry no transfer vocabulary at
 * all. A single mandatory field would reject real messages. So several weak
 * signals combine, and a handful of strong DISQUALIFIERS (an OTP code, a
 * marketing opt-out footer) veto regardless of score, because those are
 * conclusive: no genuine transaction alert asks you to reply STOP.
 *
 * Pure and data-driven, so every rule is testable against the real corpus in
 * `src/data/sms-samples.json` without a device.
 */

/** Why a message was accepted or rejected — for tests and diagnostics. */
export interface Classification {
  /** Whether this should be parsed as a money movement. */
  isTransaction: boolean;
  /** 0-1. Above `ACCEPT_THRESHOLD` and un-vetoed means transaction. */
  score: number;
  /** The disqualifier that vetoed it, or null. Wins over any score. */
  veto: string | null;
  /** Named signals that fired, strongest first — the "why". */
  signals: string[];
}

/**
 * Conclusive disqualifiers. Any one of these vetoes the message outright,
 * regardless of how transaction-shaped the rest of it looks.
 *
 * Each entry is something a genuine bank transaction alert NEVER contains.
 * That is a deliberately high bar: a veto beats all positive evidence, so a
 * rule that is merely "usually" true would silently delete real transactions.
 */
const DISQUALIFIERS: [name: string, pattern: RegExp][] = [
  /*
   * OTP / verification codes.
   *
   * The wording must tie the code to being a PASSWORD, not merely mention one:
   * every HNB alert carries "DO NOT SHARE ACCOUNT DETAILS /OTP" as a scam
   * warning, and vetoing on the bare word would delete every real HNB message.
   */
  ['otp-is-code', /\b(?:otp|one[-\s]?time\s+password|verification\s+code|passcode)\b[\s\S]{0,80}?\bis\s*:?\s*\d{3,8}\b/i],
  ['otp-code-is', /\b\d{3,8}\b\s+is\s+your\s+(?:one[-\s]?time\s+password|otp|verification\s+code)/i],
  ['otp-for-txn', /\b(?:one[-\s]?time\s+password|otp|password|pin)\b[^.]{0,60}?\bfor\s+(?:your\s+)?(?:transaction|payment|purchase|txn|login|registration)\b/i],
  ['otp-do-not-share-code', /\bdo\s+not\s+share\b[^.]{0,40}\b\d{4,8}\b/i],

  /*
   * Marketing opt-out footers — the single most reliable promo marker. No bank
   * transaction alert offers you a way to stop receiving them.
   */
  ['optout-stopad', /\bstop\s?ad\b/i],
  ['optout-sms-keyword', /\bSMS\s+[A-Z]{2,}\s+\S+\s+to\s+\d{3,6}\b/],
  ['optout-reply', /\b(?:reply|sms|text)\s+(?:stop|unsub\w*)\b/i],
  ['optout-generic', /\bto\s+(?:stop|unsubscribe|opt[-\s]?out)\b/i],

  /*
   * Campaign calls-to-action. A transaction alert reports what already
   * happened; it never asks you to go and do something to get an offer.
   */
  ['promo-shortlink', /\b(?:bit\.ly|tinyurl|t\.co|lnk\.to)\b/i],
  ['promo-visit', /\b(?:visit|click|tap|download|apply\s+now|register\s+now)\b[^.]{0,30}(?:https?:\/\/|www\.|bit\.ly)/i],
  ['promo-tnc', /\bT&C[’'s]*\s+apply\b/i],
  ['promo-valid-till', /\bvalid\s+(?:till|until|upto|up\s+to)\b/i],
  ['promo-discount', /\b\d{1,3}\s*%\s*(?:off|discount|savings|cashback)\b/i],
  ['promo-savings', /\b(?:max(?:imum)?\s+savings|special\s+offer|promo(?:tion|tional)?\b|limited\s+time)/i],
  ['promo-win', /\b(?:you\s+could\s+win|congratulations|lucky\s+draw|free\s+gift)\b/i],
];

/**
 * A currency amount. The single most necessary ingredient — a money movement
 * without a figure is not one — though nowhere near sufficient, since promos
 * quote amounts constantly.
 */
const AMOUNT = /(?:LKR|USD|EUR|GBP|AUD|AED|SGD|INR|JPY|CAD|CHF|NZD|SAR|QAR|KWD|MYR|CNY|HKD|THB|ZAR|Rs\.?)\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:LKR|USD|EUR|GBP|AED|INR)\b/i;

/**
 * Positive evidence, each with the weight it contributes.
 *
 * Weights are deliberately coarse — this is a shape test, not a probability
 * model, and precision here would be false confidence. What matters is that no
 * SINGLE signal reaches the threshold alone: "contains an amount" must never be
 * enough, because that is exactly the promo failure.
 */
const SIGNALS: [name: string, pattern: RegExp, weight: number][] = [
  /*
   * A movement verb in the past tense. The strongest single signal: it reports
   * something that ALREADY HAPPENED to money, which is what a transaction alert
   * is and what an offer never is.
   */
  ['verb-moved', /\b(?:debited|credited|withdrawn|deposited|transferred|spent|charged|paid|purchased|reversed|refunded)\b/i, 0.4],

  /*
   * The NOUN forms of the same thing.
   *
   * Not every bank writes a sentence. HNB's alerts are field lists — "HNB SMS
   * ALERT: PURCHASE, Debit account:1380***4150,Location:..." and "HNB ATM
   * Withdrawal e-Receipt" — which name the movement as a label rather than
   * conjugating a verb. Requiring the past tense rejected both, which is two
   * real transaction formats lost to a grammar assumption.
   *
   * Weighted the same as the verb, because it is the same evidence: the
   * message is naming a completed money movement. Kept as a separate signal so
   * the movement gate below can accept either.
   */
  ['noun-moved', /\b(?:purchase|withdrawal|deposit|transfer|payment|debit|credit|reversal|refund)\b(?=\s*[,:.\n]|\s+(?:e-?Receipt|account|alert|to|from))|\bSMS\s+ALERT\s*:/i, 0.4],

  /*
   * An account reference. Strong because promos are broadcast to a list and
   * cannot name your account — they have no idea what it is.
   */
  ['account-ref', /(?:A\/C|Ac(?:count)?)\s*(?:No)?\s*[:.]?\s*[X*\d]{3,}|\b(?:card|account)\s+(?:ending|no\.?)\s*[:\s]*[X*\d]{3,}/i, 0.3],

  /*
   * A balance report. Only the bank knows this, so it cannot be faked by a
   * marketing blast.
   */
  ['balance', /\b(?:avl|available|avail|av\.?)\s*bal(?:ance)?\b|\bbal(?:ance)?\s*[:.]?\s*(?:LKR|USD|Rs)/i, 0.25],

  /** A transaction-type marker banks print. */
  ['txn-type', /\bPOS\s*TXN\b|\bATM\b|\bCEFTS\b|\bSLIPS\b|\bSWIFT\b|\bIMPS\b|\bNEFT\b|\bstanding\s+order\b|\be-?Receipt\b/i, 0.25],

  /** A reference/transaction number — bookkeeping, not marketing. */
  ['txn-ref', /\b(?:txn|transaction|ref(?:erence)?|trace|auth)\s*(?:no\.?|id|code)?\s*[:.#]\s*\w{4,}|\bReason\s*:/i, 0.2],

  /** A timestamp of when it happened. */
  ['when', /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\b/i, 0.15],

  /** A merchant/location clause — where the money went. */
  ['merchant', /\b(?:at|to|from)\s+[A-Z][A-Za-z0-9&.\-']{2,}|\bLocation\s*:/, 0.1],
];

/**
 * The score a message must reach to be treated as a transaction.
 *
 * Set at exactly one movement signal, which makes the REAL gate the mandatory
 * movement check below rather than the arithmetic: a message must say that
 * money moved, and must not trip a disqualifier. Everything else adds
 * confidence but is not required.
 *
 * Deliberately not higher. A stricter score punishes terse alerts — "LKR
 * 42,350.00 debited for lease rental" carries a verb and an amount and nothing
 * else, and that is a perfectly real message — while doing nothing extra
 * against promos, which are rejected by the movement gate and the
 * disqualifiers, not by failing to reach a number. Raising this trades real
 * transactions for no gain in junk rejection.
 */
export const ACCEPT_THRESHOLD = 0.4;

/**
 * Classify a message, with the reasoning attached.
 *
 * Never throws; anything unreadable is simply not a transaction.
 */
export function classifySms(input: string): Classification {
  const empty: Classification = { isTransaction: false, score: 0, veto: null, signals: [] };

  if (typeof input !== 'string') return empty;
  const text = input.trim();
  if (text.length === 0) return empty;

  /*
   * An amount is NECESSARY. Checked before the disqualifiers only because a
   * message with no figure cannot be a money movement whatever else it says.
   */
  if (!AMOUNT.test(text)) {
    return { ...empty, signals: ['no-amount'] };
  }

  // Conclusive disqualifiers beat any amount of positive evidence.
  for (const [name, pattern] of DISQUALIFIERS) {
    if (pattern.test(text)) return { ...empty, veto: name };
  }

  const signals: string[] = [];
  let score = 0;
  for (const [name, pattern, weight] of SIGNALS) {
    if (pattern.test(text)) {
      signals.push(name);
      score += weight;
    }
  }

  /*
   * A movement verb is REQUIRED, not merely weighted.
   *
   * Everything else describes the context of a transaction; only the verb says
   * one actually happened. Without this gate a balance enquiry — "Your
   * available balance in AC XXXX6796 is LKR 84,300.15 as at 24 Jul" — clears
   * the threshold on its account, balance and date signals alone, and the
   * user's whole balance gets logged as a spend.
   *
   * A bill NOTICE is the deliberate exception: "your bill of LKR 3,450 is due
   * on 15 Aug" reports no completed movement, but it is a real obligation the
   * board wants. It has to announce itself as a due bill to qualify.
   */
  const hasMovement = signals.includes('verb-moved') || signals.includes('noun-moved');
  /*
   * A bill NOTICE — an obligation, not a completed movement.
   *
   * "CEB: Your electricity bill for Acct 0012345678 is Rs.8,450.00 due on
   * 05/08/2026" reports nothing that has happened yet, so no movement word
   * appears anywhere in it. It is still a real message the board wants, so it
   * needs its own way in.
   *
   * Both orderings are accepted, because utilities use both: the amount can
   * precede the due date (CEB, above) or follow it. An earlier version only
   * matched "due on ... <amount>" and silently rejected every CEB bill.
   *
   * "bill" and "due" together are what make this an obligation rather than an
   * advert — a promo says "valid till", never "your bill is due", and the
   * promo disqualifiers have already run by this point regardless.
   */
  const isBillNotice =
    /\bbill\b[\s\S]{0,80}?\bdue\b/i.test(text) ||
    /\bdue\s+(?:on|by|date)\b/i.test(text) ||
    /\b(?:outstanding|payable|amount\s+due)\b/i.test(text);

  if (!hasMovement && !isBillNotice) {
    return { ...empty, score: Math.min(1, score), signals: [...signals, 'no-movement-verb'] };
  }

  if (isBillNotice && !hasMovement) {
    /*
     * A bill notice earns the same weight a movement verb would.
     *
     * It cannot score one — nothing has moved yet — so without this it clears
     * the movement gate and then fails the threshold anyway, which rejected
     * every CEB/utility bill in the corpus. "Your bill is due" is exactly as
     * strong a statement about real money as "debited"; it is simply in the
     * future tense.
     */
    signals.push('bill-notice');
    score += 0.4;
  }

  score = Math.min(1, score);

  score = Math.min(1, score);

  return {
    isTransaction: score >= ACCEPT_THRESHOLD,
    score,
    veto: null,
    signals,
  };
}

/**
 * Movement wording, for the retention decision below.
 *
 * Broader than the scoring signals on purpose: this asks only "does this text
 * claim money moved", to decide whether an unparseable message is worth keeping
 * as evidence of a parser gap.
 */
const MOVEMENT_WORDING =
  /\b(?:debited|credited|withdrawn|deposited|transferred|spent|charged|paid|purchased|reversed|refunded|purchase|withdrawal|transfer|payment)\b/i;

/**
 * Whether a message should be DISCARDED rather than kept for a future parser.
 *
 * The inbox file retains anything unreadable so a parser gap stays visible and
 * fixable. Applied to junk that would fill the file forever, so the two need
 * separating: a message vetoed as an OTP or a promo, or carrying no amount at
 * all, is recognised noise and safe to drop. A message that looks
 * transaction-shaped but scored short is NOT — that is the parser's gap to
 * close, and the text is the only evidence of it.
 */
export function isDiscardableNoise(input: string): boolean {
  const result = classifySms(input);
  if (result.isTransaction) return false;

  // Vetoed — conclusive, and the strongest reason to drop something.
  if (result.veto !== null) return true;

  /*
   * No amount is usually conclusive too, but NOT when the text otherwise reads
   * like a transaction.
   *
   * "Card debited at SOME NEW MERCHANT, ref 99Z" states plainly that money
   * moved; the reason no figure was found is that the parser does not yet know
   * this bank's amount format. That is precisely a parser gap — the retained
   * text is the only evidence of it — so discarding it destroys the thing
   * needed to fix it. A message with no amount AND no movement wording is
   * genuinely not about money and is dropped.
   */
  if (result.signals.includes('no-amount')) {
    return !MOVEMENT_WORDING.test(input);
  }

  /*
   * Scored so low it carries almost no transaction structure. A message with an
   * amount and nothing else is far more likely to be an unrecognised promo than
   * a bank format nobody has seen — but the bar is kept deliberately low so
   * anything with real structure is retained for inspection.
   */
  return result.score < 0.2;
}
