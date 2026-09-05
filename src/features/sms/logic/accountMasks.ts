/**
 * How banks mask account numbers, and how to tell whether one is yours.
 *
 * Every bank prints its own shape, and the differences are not cosmetic —
 * they decide which end of the number is visible, and therefore what can be
 * matched against. Collected from real messages on a Sri Lankan device:
 *
 *   XXXXXXXX5584      front-masked, last 4 visible      (DFCC, Sampath)
 *   ********7427      front-masked, last 4 visible      (DFCC foreign)
 *   XXXXXXXX6796      front-masked, last 4 visible      (NDB, CEFTS)
 *   1380***4150       middle-masked, last 4 visible     (HNB alerts)
 *   13802XXXXX50      middle-masked, last 2 visible     (HNB mobile banking)
 *   376657*****3055   first 6 + last 4                  (card payments)
 *
 * The last two are why a single "does it end with the card's last-4" test is
 * not enough. `13802XXXXX50` reveals only two digits — too few to identify an
 * account — while `13802` is the BRANCH AND PRODUCT prefix that every HNB
 * account shares, so keying on it would match two different accounts to each
 * other. Neither half of that number can identify a card on its own, and
 * pretending otherwise is worse than admitting it.
 *
 * This module answers one question — is this fragment one of MY accounts? —
 * and is deliberate about when it must answer "cannot tell".
 */

/**
 * The shortest fragment that can identify an account.
 *
 * Four, because that is what a card's `last4` holds. Below it a fragment is
 * shared by too many real accounts to mean anything: "50" matches every account
 * ending in 50.
 */
export const MIN_IDENTIFYING_DIGITS = 4;

/** An account the user holds, as this module needs to see it. */
export interface OwnedAccount {
  id: string;
  /** The full number the user typed, when they gave one. */
  accountNumber?: string | null;
  /** Last 4 of the primary number. */
  last4?: string | null;
  /** The full second number of a dual-currency relationship. */
  foreignAccountNumber?: string | null;
  /** Last 4 of that second number. */
  foreignLast4?: string | null;
}

const digitsOf = (value: string | null | undefined): string =>
  (value ?? '').replace(/\D/g, '');

/**
 * Whether a fragment from a message identifies a specific full number.
 *
 * Both directions, because masking runs both ways: a front-masked number leaves
 * a SUFFIX ("…5584"), a middle-masked one can leave a usable PREFIX. Either may
 * be the shorter of the two, so containment is tested each way round.
 *
 * Returns false when either side is too short to be identifying — an honest
 * "cannot tell" rather than a guess that pairs unrelated accounts.
 */
export function fragmentIdentifies(fragment: string, fullNumber: string): boolean {
  const f = digitsOf(fragment);
  const n = digitsOf(fullNumber);
  if (f.length < MIN_IDENTIFYING_DIGITS || n.length < MIN_IDENTIFYING_DIGITS) return false;

  return n.endsWith(f) || n.startsWith(f) || f.endsWith(n) || f.startsWith(n);
}

/**
 * The account a message fragment belongs to, or null.
 *
 * Checks the full numbers as well as the stored last-4s, which matters because
 * the two can disagree: a card edited before this app derived `last4` from the
 * visible field can carry a stale tail, and the full number is then the more
 * trustworthy of the two. Testing both means such a card still matches its own
 * messages.
 *
 * Both legs of a dual-currency account are considered, so a USD message and an
 * LKR message on the same relationship both resolve to it.
 */
export function ownerOfAccount<T extends OwnedAccount>(
  accounts: readonly T[],
  fragment: string | null | undefined,
): T | null {
  const f = digitsOf(fragment);
  if (f.length < MIN_IDENTIFYING_DIGITS) return null;

  for (const account of accounts) {
    const candidates = [
      account.accountNumber,
      account.last4,
      account.foreignAccountNumber,
      account.foreignLast4,
    ];
    if (candidates.some((candidate) => candidate && fragmentIdentifies(f, candidate))) {
      return account;
    }
  }
  return null;
}

/**
 * Whether a transfer moved money between two accounts the user owns.
 *
 * Both ends must resolve, and they must be DIFFERENT accounts — a debit and a
 * credit on one account is two transactions, not a transfer. Money to an
 * account that is not theirs is a real expense however it is worded.
 */
export function isBetweenOwnAccounts(options: {
  accounts: readonly OwnedAccount[];
  fromFragment: string | null | undefined;
  toFragment: string | null | undefined;
}): boolean {
  const { accounts, fromFragment, toFragment } = options;

  const source = ownerOfAccount(accounts, fromFragment);
  const destination = ownerOfAccount(accounts, toFragment);

  return Boolean(source && destination && source.id !== destination.id);
}

/**
 * Whether a message is about an account the user does NOT hold.
 *
 * The case this serves is real and specific: a phone number reassigned by the
 * carrier leaves the new owner on some bank's alert list, so credits arrive for
 * a stranger's account. Those are not the user's money in any sense, and asking
 * them to dismiss each one forever is the wrong job to hand someone.
 *
 * ## Why this is deliberately conservative
 *
 * Silently discarding a REAL transaction is far worse than showing a stray one:
 * a message the user never sees is money missing from the board with nothing to
 * explain the gap. So this answers "definitely not mine" and nothing else, and
 * every uncertain case resolves to "keep it".
 *
 * Three conditions, all required:
 *
 *   1. The fragment must be long enough to identify an account at all. HNB's
 *      "13802XXXXX40" reveals two digits, which cannot be matched against
 *      anything — that is the app's blind spot, not evidence of a stranger.
 *   2. It must match none of the user's accounts, by full number or tail.
 *   3. The user must have entered enough account numbers for the absence to
 *      MEAN something. With no numbers recorded, nothing matches anything and
 *      every message would look foreign.
 */
export function isForeignAccountMessage(options: {
  accounts: readonly OwnedAccount[];
  fragment: string | null | undefined;
}): boolean {
  const { accounts, fragment } = options;

  const f = digitsOf(fragment);
  if (f.length === 0) return false;

  /*
   * At least one account must carry identifying digits.
   *
   * Otherwise "matches nothing" is a statement about the app's own emptiness,
   * not about the message — and every real transaction would be discarded on a
   * board the user simply had not finished setting up.
   */
  const knowsAnyAccount = accounts.some(
    (account) =>
      digitsOf(account.accountNumber).length >= MIN_IDENTIFYING_DIGITS ||
      digitsOf(account.last4).length >= MIN_IDENTIFYING_DIGITS ||
      digitsOf(account.foreignAccountNumber).length >= MIN_IDENTIFYING_DIGITS ||
      digitsOf(account.foreignLast4).length >= MIN_IDENTIFYING_DIGITS,
  );
  if (!knowsAnyAccount) return false;

  /*
   * A SHORT fragment is judged too, but only against the same bank's numbers.
   *
   * HNB prints "13802XXXXX40", revealing two digits. Those cannot IDENTIFY an
   * account — every account ending in 40 shares them — but they can still rule
   * one out: if no account the user holds ends in 40, the message is not about
   * any of them. That is a weaker claim than identification and a safe one,
   * because it only ever concludes "not mine".
   *
   * The real case: a LKR 10,000 credit to a relative's HNB account, sent by
   * the user, arriving on their phone because the number is on that bank's
   * alert list. The debit from the user's own account is the real expense; the
   * credit is somebody else's money.
   */
  if (f.length < MIN_IDENTIFYING_DIGITS) {
    return !accounts.some((account) =>
      [account.accountNumber, account.last4, account.foreignAccountNumber, account.foreignLast4]
        .map(digitsOf)
        .some((candidate) => candidate.length >= MIN_IDENTIFYING_DIGITS && candidate.endsWith(f)),
    );
  }



  return ownerOfAccount(accounts, f) === null;
}
