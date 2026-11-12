import { settingsRepo } from '~/db/repositories';
import { MODELS_FOR } from '~/features/health/logic/gemini';
import { parseLog, quotaSummary, recordCall, type QuotaSummary } from '~/features/health/logic/aiQuota';

/**
 * Where the per-model free-allowance counts live — a settings row, so they
 * survive a restart. See logic/aiQuota.ts for what is counted and why.
 *
 * Counted separately for Dayly's shared project and the user's own Google
 * project: they are different allowances, and switching between them must not
 * carry one's usage over to the other.
 */
const KEY = { shared: 'ai_quota_log_shared', own: 'ai_quota_log_own' } as const;
export type AllowanceOwner = keyof typeof KEY;

export function recordAiCall(
  owner: AllowanceOwner,
  call: { model: string; ok: boolean; status?: number; body?: string },
): void {
  try {
    const next = recordCall(parseLog(settingsRepo.get(KEY[owner])), { ...call, at: new Date() });
    settingsRepo.set(KEY[owner], JSON.stringify(next));
  } catch {
    // Counting must never break a reading.
  }
}

/** Every model Dayly may call, in the order they are tried. */
export const ALL_MODELS: readonly string[] = [
  ...new Set([...MODELS_FOR.extract, ...MODELS_FOR.explain]),
];

export function freeAllowance(owner: AllowanceOwner, now = new Date()): QuotaSummary {
  return quotaSummary(parseLog(settingsRepo.get(KEY[owner])), ALL_MODELS, now);
}
