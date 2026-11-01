/**
 * Turning a bank alert's reported balance into a checkpoint the ledger anchors to.
 *
 * Pure: the drain, the paste path and the launch backfill all call this with a
 * parsed message and the user's cards, and record what it returns.
 */

import { accountCurrency } from '~/features/accounts/logic/accountCurrency';
import {
  accountFragmentOf,
  matchAccountLeg,
  type OwnedAccount,
} from '~/features/sms/logic/accountMasks';
import type { ParsedSms } from '~/features/sms/logic/smsParser';
import type { Minor } from '~/shared/lib/money';

export interface CheckpointCard extends OwnedAccount {
  currency?: string | null;
  foreignCurrency?: string | null;
}

export interface SmsCheckpoint {
  cardId: string;
  balanceMinor: Minor;
  at: Date;
  /** What the message was about — its merchant or transfer label. */
  note: string | null;
}

/**
 * When an alert's figure was true: its own date and time, local.
 *
 * A message with a date but no clock (DFCC prints "on 30 OCT 2026") is taken
 * as the END of that day. Its own transaction is dated that day too, so it
 * falls inside the figure either way; and a later same-day movement from
 * another account's message carries its own balance and anchors itself.
 */
export function alertMoment(date: string | null, time: string | null): Date | null {
  if (!date) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return null;
  if (time) {
    const [hours, minutes] = time.split(':').map(Number);
    return new Date(year, month - 1, day, hours || 0, minutes || 0, 59);
  }
  return new Date(year, month - 1, day, 23, 59, 59);
}

/**
 * The checkpoint a message states, or null.
 *
 * Only for the account's PRIMARY leg, in the currency it holds: a dual-currency
 * card is one balance in the app, so "Your bal is USD5,912.67" on its USD
 * number must not overwrite the rupee balance. A message that names a currency
 * other than the account's is refused for the same reason.
 */
export function checkpointFromSms(
  parsed: Pick<ParsedSms, 'account' | 'balance' | 'date' | 'time' | 'raw'> & { merchant?: string },
  cards: readonly CheckpointCard[],
  homeCurrency: string,
): SmsCheckpoint | null {
  if (!parsed.balance) return null;
  const match = matchAccountLeg(cards, accountFragmentOf(parsed));
  if (!match || match.leg !== 'primary') return null;
  const held = accountCurrency(match.account, homeCurrency).toUpperCase();
  if (parsed.balance.currency && parsed.balance.currency.toUpperCase() !== held) return null;
  const at = alertMoment(parsed.date, parsed.time);
  if (!at) return null;
  return {
    cardId: match.account.id,
    balanceMinor: parsed.balance.amountMinor,
    at,
    note: parsed.merchant?.trim() || null,
  };
}
