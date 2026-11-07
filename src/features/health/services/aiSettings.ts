import { healthLabRepo, settingsRepo } from '~/db/repositories';
import { analysesToday, DAILY_ANALYSIS_LIMIT } from '~/features/health/logic/gemini';

/**
 * The user's one-time agreement to send reports to Google's AI, and the daily
 * limit that keeps a runaway loop (or a curious child) from running up the
 * project's bill.
 */

const CONSENT_SETTING = 'health_ai_consent_at';

export function hasAiConsent(): boolean {
  return Boolean(settingsRepo.get(CONSENT_SETTING));
}

export function giveAiConsent(): void {
  settingsRepo.set(CONSENT_SETTING, String(Date.now()));
}

export function withdrawAiConsent(): void {
  settingsRepo.set(CONSENT_SETTING, '');
}

/** How many analyses are left today on this phone. */
export function analysesLeftToday(now = new Date()): number {
  const used = analysesToday(healthLabRepo.analysedAtAll(), now);
  return Math.max(0, DAILY_ANALYSIS_LIMIT - used);
}
