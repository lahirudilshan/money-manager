/**
 * Recognising the funding transfer itself, from the bank's own message.
 *
 * The dashboard says "move LKR 158,347 onto Spending". The user goes and does
 * it, the bank texts to say the money arrived — and then they still have to
 * come back and tick the row by hand, restating something the bank already
 * confirmed. This closes that loop: an inbound credit whose ACCOUNT and AMOUNT
 * both match what an account was waiting for is that transfer, and the row is
 * marked moved automatically.
 *
 * ## Why both signals are required
 *
 * Either alone is far too weak. An amount can coincide — two accounts can be
 * owed similar figures in the same month. An account match says only that money
 * arrived somewhere, not that it was THE funding move. Requiring the pair, on
 * an account with a non-zero outstanding balance, is what makes the inference
 * safe enough to act on without asking.
 *
 * ## Why exact, not approximate
 *
 * No tolerance at all. A near-match is a different transfer that happens to be
 * close, and marking a month funded on "close enough" hides a shortfall the
 * user would never think to look for. Exact means the figure the app told them
 * to move is the figure that arrived.
 */

/** An account awaiting a transfer, as this module needs to see it. */
export interface PendingAccount {
  cardId: string;
  /** Still to move onto this card, in the home currency. */
  toTransferMinor: number;
  /** Last 4 of the account's number(s), for matching the message. */
  last4: string | null;
  foreignLast4?: string | null;
}

/** A credit the app has just seen, reduced to what identifies it. */
export interface InboundCredit {
  /** The destination account, as printed in the message. */
  account: string | null;
  /** How much arrived, in the home currency's minor units. */
  amountMinor: number;
  /** Whether the message describes money coming IN. */
  isCredit: boolean;
}

const MIN_MATCHABLE = 4;

function tailMatches(tail: string | null | undefined, account: string): boolean {
  const t = (tail ?? '').replace(/\D/g, '');
  const a = account.replace(/\D/g, '');
  return t.length >= MIN_MATCHABLE && a.length >= MIN_MATCHABLE && a.endsWith(t);
}

/**
 * The account this credit settles, or null when nothing matches exactly.
 *
 * Deliberately returns null rather than a best guess. This drives an automatic
 * state write, so "no confident answer" must mean "do nothing" — a wrong
 * auto-mark tells the user a month is funded when it is not, which is the one
 * error they have no reason to go looking for.
 */
export function matchTransferToAccount(
  credit: InboundCredit,
  accounts: readonly PendingAccount[],
): PendingAccount | null {
  // Only money arriving. A debit leaving an account is the user spending, not
  // funding — and would otherwise match the very account it left.
  if (!credit.isCredit) return null;
  if (!credit.account) return null;
  if (!Number.isFinite(credit.amountMinor) || credit.amountMinor <= 0) return null;

  const candidates = accounts.filter(
    (account) =>
      // An account with nothing outstanding has no transfer to confirm, and
      // matching one would mark a settled month "moved" a second time.
      account.toTransferMinor > 0 &&
      account.toTransferMinor === credit.amountMinor &&
      (tailMatches(account.last4, credit.account!) ||
        tailMatches(account.foreignLast4, credit.account!)),
  );

  /*
   * Exactly one, or none.
   *
   * Two accounts owed the identical amount and sharing a matching tail cannot
   * be told apart by anything this function knows, and picking either would be
   * a coin flip written into the user's board.
   */
  return candidates.length === 1 ? candidates[0] : null;
}
