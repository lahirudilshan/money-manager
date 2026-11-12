import { settingsRepo } from '~/db/repositories';
import { giveAiConsent, hasAiConsent, withdrawAiConsent } from '~/features/health/services/aiSettings';
import type { AskArea } from '~/features/ask/logic/askScope';

/**
 * Which areas the user has let AI see — one agreement per area.
 *
 * Health keeps the agreement it always had (report reading and health
 * questions send the same kind of data). Money and "life" are new and OFF
 * until the user turns them on: agreeing to health never shares a bank
 * balance.
 */
const KEY: Record<Exclude<AskArea, 'health'>, string> = {
  money: 'ai_consent_money',
  life: 'ai_consent_life',
};

export function hasAreaConsent(area: AskArea): boolean {
  if (area === 'health') return hasAiConsent();
  return Boolean(settingsRepo.get(KEY[area]));
}

export function setAreaConsent(area: AskArea, on: boolean): void {
  if (area === 'health') {
    if (on) giveAiConsent();
    else withdrawAiConsent();
    return;
  }
  settingsRepo.set(KEY[area], on ? String(Date.now()) : '');
}
