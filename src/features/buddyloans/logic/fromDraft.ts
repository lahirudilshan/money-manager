/**
 * Turning a detected bank message into a LOAN rather than an expense.
 *
 * ## Why this exists
 *
 * Money sent to a friend who asked for a loan is not spending — it is an asset
 * that is coming back. Every confirm path in the review screen writes a
 * `transactions` row, so the only choices were to log the transfer as an
 * expense (overstating the month by the whole amount) or dismiss the message
 * (losing the record entirely). Neither is what happened in the world.
 *
 * ## What the bank can and cannot tell us
 *
 * The amount and the date come from the message. The PERSON does not: a CEFTS
 * transfer parses to `merchant: "CEFTS Outward Transfer"` — the channel the
 * bank used — even when the raw text names the payee. So the person is always
 * asked for, and a loan cannot be saved without one.
 *
 * The FORM itself lives in `components/LoanFields`, shared with the add-on's own
 * "New loan" sheet. What remains here is the pair of rules the review screen
 * needs before that form is ever shown: whether to offer the action at all, and
 * which way the money went.
 */

/** The direction of the money, from the user's point of view. */
export type LoanDirection = 'lent' | 'borrowed';

/**
 * Whether to offer "this was a loan" for a given message.
 *
 * Transfers only. A card purchase at a supermarket is not a loan, and putting
 * the action on every message would make it noise on the ninety-nine that are
 * ordinary spending — the review sheet's job is to make the common case one
 * tap, not to list every possibility.
 *
 * `transfer_in` counts too: money arriving can be someone repaying, or the user
 * BORROWING, which the add-on tracks in the same book.
 */
export function offersLoanAction(kind: string, miniAppEnabled: boolean): boolean {
  if (!miniAppEnabled) return false;
  return kind === 'transfer_out' || kind === 'transfer_in';
}

/**
 * Which way the money went, judged from the message.
 *
 * Money leaving is lending; money arriving is borrowing. Only a default — the
 * user can flip it, because a credit can equally be a friend paying back a loan
 * the user already recorded.
 */
export function defaultDirection(kind: string): LoanDirection {
  return kind === 'transfer_in' ? 'borrowed' : 'lent';
}
