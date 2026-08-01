import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import { merchantKey } from './db';
import * as repo from './repository';
import { rankSuggestions, type Suggestion } from './score';
import type { AmountBucket, Hint } from './contract';

/**
 * The cached read layer: fetch (repository) + decide (score), memoised.
 *
 * Every device asks on every launch and on every incoming message, but the
 * catalog changes on the timescale of user corrections. Caching turns "a query
 * per user per message" into a handful an hour, which is the single biggest cost
 * lever here because Neon bills compute time.
 *
 * Both caches carry the same tag, so one contribution invalidates everything a
 * correction could affect rather than each reader waiting out a TTL.
 */

export const CATALOG_TAG = 'catalog';

export type { Suggestion } from './score';

export interface CatalogPage {
  rules: {
    merchant: string;
    hint: Hint;
    votes: number;
    source: 'seed' | 'learned';
    margin: number;
  }[];
  nextSince: string | null;
  hasMore: boolean;
}

/** A page of the catalog for incremental sync. */
export async function getCatalogPage(
  cursorStamp: string,
  cursorId: number,
  limit: number,
): Promise<CatalogPage> {
  'use cache';
  // Corrections should reach other users quickly, but not at the cost of a query
  // per launch. Contributions revalidate this tag anyway, so the TTL is only the
  // backstop for writes that happened on another instance.
  cacheLife('minutes');
  cacheTag(CATALOG_TAG);

  const rows = await repo.catalogPage(cursorStamp, cursorId, limit);
  const last = rows[rows.length - 1];

  return {
    rules: rows.map((row) => ({
      merchant: row.merchant,
      hint: row.hint,
      votes: Number(row.votes),
      source: row.source,
      margin: Number(row.margin),
    })),
    nextSince: last ? `${last.cursor_stamp}|${last.id}` : null,
    hasMore: rows.length === limit,
  };
}

/**
 * Up to three ranked suggestions for one transaction.
 *
 * The sender distribution is consulted ONLY when the merchant is unknown.
 * Otherwise a bank like "HNB", which sends alerts for everything from groceries
 * to loan payments, would drown out a merchant the crowd has actually voted on.
 */
export async function getSuggestions(
  merchant: string,
  sender: string | null,
  direction: 'debit' | 'credit',
  amountBucket: AmountBucket | null,
): Promise<Suggestion[]> {
  'use cache';
  cacheLife('minutes');
  cacheTag(CATALOG_TAG);

  const key = merchantKey(merchant);
  if (!key) return [];

  const byMerchant = await repo.votesForMerchant(key);
  const bySignal = amountBucket ? await repo.signalsForMerchant(key, direction, amountBucket) : [];
  const bySender =
    sender && byMerchant.length === 0 ? await repo.signalsForSender(sender, direction) : [];

  return rankSuggestions(byMerchant, bySignal, bySender);
}
