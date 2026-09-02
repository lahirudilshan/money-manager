/**
 * Which account the salary lands in — and therefore which bank's rate applies.
 *
 * The rates screen only means something if the app knows WHOSE rate is the
 * user's. Asking would be a settings question most people would have to think
 * about, so this infers it and lets the answer be corrected: an explicit choice
 * always wins, and the inference only has to be right for the common case.
 *
 * The common case is specific: someone paid in dollars has one foreign-currency
 * account, and it is the one their income lines are planned against. That is a
 * strong enough signal to act on without asking.
 */

/** A card as this module needs to see it. */
export interface SalaryCardLike {
  id: string;
  bankId: string | null;
  currency?: string | null;
}

/**
 * An income line, reduced to what identifies a foreign salary.
 *
 * `foreignAmount` is the load-bearing field, not the account's currency. The
 * app records a USD salary by storing the dollar figure and the rate it was
 * converted at (see the `incomes` table) — the ACCOUNT it lands in is usually
 * an ordinary local one, because that is what actually happens: the bank
 * receives the wire, converts it, and credits rupees. Keying off
 * `cards.currency` therefore found nothing on real data, where every card's
 * currency is blank and the salary is still plainly in dollars.
 */
export interface IncomeLineLike {
  cardId: string | null;
  /** Home-currency value of this income. */
  amountMinor: number;
  /** The ORIGINAL foreign figure, when this income is paid in one. */
  foreignAmount?: number | null;
  /** Inactive lines are projections ("salary after raise"), not today's money. */
  isActive?: boolean;
}

/**
 * The card a foreign salary arrives in.
 *
 * Resolution order, most trustworthy first:
 *
 *   1. The user's explicit choice, when the card still exists. An answer they
 *      gave outranks anything derived.
 *   2. The FOREIGN-currency account with the most income planned against it.
 *      "Most" rather than "any" because a second, smaller foreign line (a
 *      freelance top-up) should not displace the salary it is dwarfed by.
 *   3. The only foreign account, if there is exactly one and no income is
 *      planned yet — true during onboarding, before any line exists.
 *
 * Returns null when none of those hold, which the UI reads as "we don't know
 * which bank is yours" and renders the list without a highlight rather than
 * guessing and highlighting the wrong one.
 */
export function resolveSalaryCardId(options: {
  cards: readonly SalaryCardLike[];
  incomeLines: readonly IncomeLineLike[];
  /** The user's explicit pick, when they have made one. */
  chosenCardId?: string | null;
  homeCurrency: string;
}): string | null {
  const { cards, incomeLines, chosenCardId, homeCurrency } = options;

  // 1. An explicit choice wins — but only while it still points at a real card.
  if (chosenCardId && cards.some((card) => card.id === chosenCardId)) return chosenCardId;

  const exists = (cardId: string | null) =>
    Boolean(cardId) && cards.some((card) => card.id === cardId);

  /*
   * 2. The account the largest FOREIGN-PAID income lands in.
   *
   * An income is foreign because it carries a `foreignAmount`, not because its
   * account is denominated abroad — a USD salary is normally wired into an
   * ordinary local account and converted on arrival, which is exactly the case
   * this whole feature is about. Inactive lines are excluded: the app uses them
   * for projections ("salary after raise"), and a hypothetical future figure
   * should not decide which bank's rate is shown today.
   */
  let bestId: string | null = null;
  let bestAmount = 0;

  for (const line of incomeLines) {
    if (line.isActive === false) continue;
    if (!line.foreignAmount || line.foreignAmount <= 0) continue;
    if (!exists(line.cardId)) continue;

    if (line.amountMinor > bestAmount) {
      bestAmount = line.amountMinor;
      bestId = line.cardId;
    }
  }
  if (bestId) return bestId;

  /*
   * 3. A foreign-CURRENCY account, for anyone who genuinely holds one.
   *
   * Rarer than the case above but real — someone with an actual USD account
   * has no `foreignAmount` on the income if they never recorded one, and the
   * account's own currency is then the only signal there is.
   */
  const home = homeCurrency.trim().toUpperCase();
  const foreign = cards.filter((card) => {
    const code = card.currency?.trim().toUpperCase();
    return Boolean(code) && code !== home;
  });

  if (foreign.length === 0) return null;

  const byCard = new Map<string, number>();
  for (const line of incomeLines) {
    if (line.isActive === false) continue;
    if (!line.cardId) continue;
    if (!foreign.some((card) => card.id === line.cardId)) continue;
    byCard.set(line.cardId, (byCard.get(line.cardId) ?? 0) + line.amountMinor);
  }

  let foreignBestId: string | null = null;
  let foreignBestAmount = 0;
  for (const [cardId, amount] of byCard) {
    if (amount > foreignBestAmount) {
      foreignBestAmount = amount;
      foreignBestId = cardId;
    }
  }
  if (foreignBestId) return foreignBestId;

  // 4. Exactly one foreign account and nothing planned against it yet.
  return foreign.length === 1 ? foreign[0].id : null;
}

/** The bank id behind the resolved salary account, for joining to a rate. */
export function salaryBankId(
  cards: readonly SalaryCardLike[],
  salaryCardId: string | null,
): string | null {
  if (!salaryCardId) return null;
  return cards.find((card) => card.id === salaryCardId)?.bankId ?? null;
}
