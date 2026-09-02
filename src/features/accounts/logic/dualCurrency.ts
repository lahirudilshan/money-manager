/**
 * A bank relationship that holds two currencies, and what follows from it.
 *
 * Sri Lankan banks split two ways on a foreign-currency account: some put both
 * currencies behind ONE number, some issue a separate number per currency. A
 * card row therefore carries an optional second number (`foreignAccountNumber`)
 * and the currency behind it, so one entry covers both shapes.
 *
 * The reason this matters is not display. It is that converting USD into LKR
 * between your own two numbers produces bank messages that look exactly like
 * spending — a debit here, a credit there — when no money has left the
 * household at all. Counting those would double-count every month's income and
 * invent an expense that never happened. Recognising both ends as accounts the
 * user owns is what makes the move identifiable as internal.
 */

/** A card as this module needs to see it. */
export interface DualCurrencyCard {
  id: string;
  /** Last 4 of the primary account number. */
  last4?: string | null;
  /** What the primary number holds. Null means the home currency. */
  currency?: string | null;
  /** Last 4 of the second number, when the bank issues one per currency. */
  foreignLast4?: string | null;
  /** What the second number holds — "USD", "EUR". */
  foreignCurrency?: string | null;
}

/**
 * The shortest account fragment that can identify a card.
 *
 * Banks mask account numbers to varying lengths, and a fragment shorter than
 * four digits identifies nothing — "50" would `endsWith`-match any account
 * ending in 50. Four is the shortest that is worth trusting.
 */
const MIN_MATCHABLE = 4;

function matchable(fragment: string | null | undefined): boolean {
  const digits = (fragment ?? '').replace(/\D/g, '');
  return digits.length >= MIN_MATCHABLE;
}

/** Whether an account fragment from an SMS points at either leg of this card. */
export function cardOwnsAccount(card: DualCurrencyCard, account: string): boolean {
  const digits = account.replace(/\D/g, '');
  if (!matchable(digits)) return false;

  for (const tail of [card.last4, card.foreignLast4]) {
    if (matchable(tail) && digits.endsWith(tail!.replace(/\D/g, ''))) return true;
  }
  return false;
}

/** Every card the user owns that either end of a message could belong to. */
export function ownedCardFor(
  cards: readonly DualCurrencyCard[],
  account: string | null | undefined,
): DualCurrencyCard | undefined {
  if (!account) return undefined;
  return cards.find((card) => cardOwnsAccount(card, account));
}

/**
 * Whether this card holds two currencies.
 *
 * True for the one-number shape too: a row can name a foreign currency without
 * a second number, which is the bank that puts both behind one account.
 */
export function isDualCurrency(card: DualCurrencyCard): boolean {
  const foreign = card.foreignCurrency?.trim();
  return Boolean(foreign && foreign.length > 0);
}

/**
 * Whether a message describes a conversion between the user's OWN accounts.
 *
 * Two independent signals, and either alone is enough to be wrong:
 *
 *   - Both the source and destination accounts belong to cards the user owns.
 *     A transfer to someone else's account is a real expense no matter what
 *     currency it is in.
 *   - The message's currency differs from the home currency, OR the two ends
 *     are the two legs of one dual-currency relationship. A rupee transfer
 *     between two accounts the user owns is still an internal move, but it is
 *     the FX case that this exists for and the one that would otherwise be
 *     counted twice.
 *
 * Returns false when either account is missing: a message that does not say
 * where the money went cannot be shown to be internal, and guessing would
 * silently drop a real expense.
 */
export function isSelfConversion(options: {
  cards: readonly DualCurrencyCard[];
  /** The account the money left, as printed in the message. */
  fromAccount: string | null | undefined;
  /** The account it arrived in. */
  toAccount: string | null | undefined;
}): boolean {
  const { cards, fromAccount, toAccount } = options;

  const source = ownedCardFor(cards, fromAccount);
  const destination = ownedCardFor(cards, toAccount);

  // Both ends must be accounts the user holds. One end unknown means the money
  // genuinely went somewhere else.
  if (!source || !destination) return false;

  /*
   * The same card on both ends is the dual-currency case: one relationship,
   * two numbers, money moving between its own legs. Different cards is a
   * transfer between two accounts the user owns, which is also internal — the
   * money is still theirs.
   */
  return true;
}

/**
 * Why an account number cannot be used, or null when it is fine.
 *
 * Returns a sentence for the user rather than a code, since every caller shows
 * it verbatim — the same contract as `validateAmount` in shared/lib/money.
 *
 * An account number is DIGITS. Letters are always a mistake here: a pasted
 * "Ac No: 1002..." brings its label along, and a typo'd letter silently stops
 * the number matching any bank message, which is the failure the user would
 * never connect back to this field. Catching it at entry is the only place it
 * is cheap to fix.
 *
 * Empty is allowed and returns null: the field is optional, and an account with
 * no number simply cannot be matched to an SMS. Refusing to save over a blank
 * would make an optional field behave like a required one.
 */
export function validateAccountNumber(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  if (/[A-Za-z]/.test(trimmed)) return 'Account numbers are digits only';
  // Anything that is neither a digit nor ordinary separator punctuation.
  if (/[^0-9\s-]/.test(trimmed)) return 'Remove any symbols — digits only';

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return 'Enter the account number';

  /*
   * Four is the shortest fragment that can identify an account at all — see
   * `cardOwnsAccount`. Below that the number cannot do the one job it has, so
   * accepting it would store something that silently never matches.
   */
  if (digits.length < 4) return 'Too short — enter at least 4 digits';
  // Longer than any real account number; almost certainly two pasted together.
  if (digits.length > 20) return 'That looks too long for an account number';

  return null;
}
