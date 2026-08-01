/**
 * GET /api/suggest — ranked category suggestions for one merchant.
 *
 * A read-only view of what `/api/detect` computes internally, for callers that
 * have a merchant but no board to rank against (a debugging dashboard, or a
 * future "what is this shop?" lookup).
 *
 * Note the shape of the query: a merchant key, a bank short code, a direction
 * and a coarse amount BAND. There is no parameter for message text, the exact
 * amount, or the account — a suggestion never needs them, so the endpoint
 * cannot receive them even by accident.
 */

import { getSuggestions } from '@/lib/catalog';
import { suggestQuerySchema } from '@/lib/contract';
import { guard, preflight, readQuery } from '@/lib/http';

export async function GET(request: Request) {
  const input = readQuery(request, suggestQuerySchema, (params) => ({
    merchant: params.get('merchant') ?? '',
    sender: params.get('sender'),
    direction: params.get('direction') ?? undefined,
    amountBucket: params.get('amountBucket') ?? undefined,
  }));
  if (!input.ok) return input.response;

  const { merchant, sender, direction, amountBucket } = input.data;

  // An empty list rather than a 500: the caller degrades to local detection, so
  // an outage costs accuracy rather than blocking a draft.
  return guard(
    'suggest',
    async () => ({
      suggestions: await getSuggestions(merchant, sender ?? null, direction, amountBucket ?? null),
    }),
    { suggestions: [] },
  );
}

export function OPTIONS() {
  return preflight();
}
