/**
 * Pairing the two halves of one bank relationship.
 *
 * Someone paid in foreign currency typically holds TWO accounts at one bank: a
 * USD account the salary lands in, and a local one a portion is converted into
 * and the bills are paid from. Those are genuinely two accounts — different
 * currencies, balances and jobs — so the app stores them as two rows, and every
 * figure stays in the currency it belongs to.
 *
 * But the list then shows "DFCC" twice with nothing saying the two are related,
 * which reads as a duplicate rather than as a pair. This groups them for
 * DISPLAY only: same bank, and either the same account number or the same last
 * four digits, which is exactly how a bank presents a multi-currency
 * relationship.
 *
 * Nothing downstream changes. A bill still points at one row, a balance still
 * belongs to one row; only the rendering knows about the grouping. That is
 * deliberate — making the pairing structural would mean every `cardId` needing
 * a second field to say WHICH half it meant.
 */

/** An account as this module needs to see it. */
export interface GroupableCard {
  id: string;
  bankId: string | null;
  accountNumber?: string | null;
  last4?: string | null;
}

export interface AccountGroup<T extends GroupableCard> {
  /** Stable key for rendering — the first member's id. */
  key: string;
  /** Two or more rows of one relationship, or a single standalone account. */
  cards: T[];
}

/** The join key, or null for a row that cannot be paired with anything. */
function relationshipKey(card: GroupableCard): string | null {
  if (!card.bankId) return null;

  /*
   * The account NUMBER first, then the last four.
   *
   * A bank that puts both currencies behind one number gives an exact match.
   * One that issues two numbers usually keeps the same tail, which `last4`
   * captures. Either is a deliberate signal from the user — they typed it —
   * whereas grouping on the bank alone would sweep together two genuinely
   * unrelated accounts that merely happen to share a bank, which is common
   * (a salary account and a joint account at the same bank are not a pair).
   */
  const number = card.accountNumber?.trim();
  if (number) return `${card.bankId}:n:${number}`;

  const tail = card.last4?.trim();
  if (tail) return `${card.bankId}:t:${tail}`;

  return null;
}

/**
 * Group accounts that belong to one bank relationship, preserving order.
 *
 * A group's position is where its FIRST member sat, so grouping never reorders
 * the list out from under someone who has arranged it — the second half simply
 * moves up beside the first.
 *
 * A row with no number and no last four is its own group: there is no evidence
 * pairing it with anything, and guessing would merge unrelated accounts.
 */
export function groupAccounts<T extends GroupableCard>(cards: readonly T[]): AccountGroup<T>[] {
  const groups: AccountGroup<T>[] = [];
  const byKey = new Map<string, AccountGroup<T>>();

  for (const card of cards) {
    const key = relationshipKey(card);

    if (key === null) {
      groups.push({ key: card.id, cards: [card] });
      continue;
    }

    const existing = byKey.get(key);
    if (existing) {
      existing.cards.push(card);
    } else {
      const group: AccountGroup<T> = { key: card.id, cards: [card] };
      byKey.set(key, group);
      groups.push(group);
    }
  }

  return groups;
}

/** Whether a group is a real pair rather than a lone account. */
export function isPaired<T extends GroupableCard>(group: AccountGroup<T>): boolean {
  return group.cards.length > 1;
}
