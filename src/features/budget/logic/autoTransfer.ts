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
 * ## Why ROUNDED, not exact to the cent
 *
 * Almost exact. The board's total carries cents — a real one came to
 * LKR 282,533.59 — and nobody types that into a transfer form: they send
 * 282,534. Requiring the cent to agree would reject the very transfer the
 * feature exists to recognise, on every account whose bills do not happen to
 * sum to a whole rupee.
 *
 * So the match allows the gap between the figure and its rounding up to the
 * next whole unit, and no more. That is under one currency unit — far too
 * tight for a different payment to slip through, and exactly wide enough for
 * the rounding a human does when reading the number off the screen.
 *
 * Anything looser would be guessing. A tolerance of even a few rupees would
 * let a genuinely different transfer mark a month funded, hiding a shortfall
 * the user has no reason to go looking for.
 */

import { ownerOfAccount } from '~/features/sms/logic/accountMasks';

/** An account awaiting a transfer, as this module needs to see it. */
export interface PendingAccount {
  cardId: string;
  /** Still to move onto this card, in the home currency. */
  toTransferMinor: number;
  /** Last 4 of the account's number(s), for matching the message. */
  last4: string | null;
  foreignLast4?: string | null;
  /*
   * The FULL numbers as well as the tails.
   *
   * The two can disagree — a card saved before `last4` was derived from the
   * visible field carries a stale tail — and the full number is then the more
   * trustworthy of the two. Observed on a real device: an NDB account numbered
   * ...6796 still held last4 "3824" from an earlier edit, so it matched none of
   * its own messages.
   */
  accountNumber?: string | null;
  foreignAccountNumber?: string | null;
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

/**
 * The bank fees a CEFTS/SLIPS transfer commonly adds, in minor units.
 *
 * A transfer of 282,533.59 arrives as 282,534 — or as 282,559 when the bank
 * bundles its LKR 25 fee into the same movement. Those few fixed charges are
 * the difference between recognising the user's transfer and rejecting it, and
 * they are FIXED amounts rather than a percentage, which is what makes
 * allowing them safe: the window stays a few rupees wide however large the
 * transfer is.
 *
 * Listed explicitly rather than as a tolerance range. A range of "up to 30"
 * would also swallow a genuinely different payment that happens to fall inside
 * it; matching only the real fee amounts keeps the accident surface tiny.
 */
const BANK_FEES_MINOR = [0, 5_00, 25_00, 30_00, 50_00] as const;

/**
 * Whether a credit settles an outstanding balance.
 *
 * Three things are allowed, and nothing else:
 *
 *   - the exact figure;
 *   - it rounded UP to the next whole unit, because the board asks for
 *     282,533.59 and nobody types the cents;
 *   - either of those plus one of the fixed bank fees above, since the charge
 *     rides along with the transfer.
 *
 * Never LESS than what is owed. A short transfer has not settled the account,
 * and saying it has would hide a shortfall the user has no reason to look for
 * — which is the one failure this whole feature must not produce.
 */
function amountSettles(owedMinor: number, paidMinor: number): boolean {
  const roundedUp = Math.ceil(owedMinor / 100) * 100;

  return BANK_FEES_MINOR.some(
    (fee) => paidMinor === owedMinor + fee || paidMinor === roundedUp + fee,
  );
}

/** Whether the message's account fragment is one of this account's numbers. */
function accountMatches(account: PendingAccount, fragment: string): boolean {
  return ownerOfAccount([{ id: account.cardId, ...account }], fragment) !== null;
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
      amountSettles(account.toTransferMinor, credit.amountMinor) &&
      accountMatches(account, credit.account!),
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
