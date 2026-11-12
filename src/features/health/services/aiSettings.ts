import { healthLabRepo, settingsRepo } from '~/db/repositories';
import { analysesToday, DAILY_ANALYSIS_LIMIT } from '~/features/health/logic/gemini';
import { usesOwnGoogleAi } from './firebaseAi';

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

/*
 * The master switch. ON unless the user turns it off in Settings → AI
 * features: off means nothing is sent to an AI from anywhere in the app, and
 * the screens that would use it say so instead of offering the button.
 */
const ENABLED_SETTING = 'ai_enabled';

export function isAiEnabled(): boolean {
  return settingsRepo.get(ENABLED_SETTING) !== '0';
}

export function setAiEnabled(on: boolean): void {
  settingsRepo.set(ENABLED_SETTING, on ? '1' : '0');
}

/** Today's AI use on this phone, for Settings. */
export function aiUsageToday(now = new Date()): {
  used: number;
  limit: number;
  left: number;
  /** On the user's own Google AI: Dayly's daily cap does not apply. */
  unlimited: boolean;
} {
  const used = analysesToday(healthLabRepo.analysedAtAll(), now);
  return {
    used,
    limit: DAILY_ANALYSIS_LIMIT,
    left: Math.max(0, DAILY_ANALYSIS_LIMIT - used),
    unlimited: usesOwnGoogleAi(),
  };
}

/** When the user agreed to send reports to AI, if they have. */
export function aiConsentDate(): Date | null {
  const raw = settingsRepo.get(CONSENT_SETTING);
  const ms = raw ? Number(raw) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}
