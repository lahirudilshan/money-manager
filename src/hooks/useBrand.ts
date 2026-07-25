import { useMemo } from 'react';
import { resolveBrand, type BankBrand } from '../data/banks';

/** The card/account fields brand resolution reads from. */
interface BrandInput {
  bankId?: string | null;
  bankName?: string | null;
  name?: string | null;
}

/**
 * Memoized bank-brand resolution for one card/account. `resolveBrand` is pure
 * and cheap, but callers were invoking it inline on every render (~30 sites);
 * this gives one shared, memoized entry point so a row re-renders don't redo the
 * lookup, and there's a single hook to change if brand resolution ever moves.
 */
export function useBrand(input: BrandInput): BankBrand {
  return useMemo(
    () => resolveBrand(input),
    [input.bankId, input.bankName, input.name],
  );
}
