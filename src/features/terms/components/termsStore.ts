import { settingsRepo } from '~/db/repositories';
import {
  encodeAcceptance,
  isCurrentAcceptance,
  readAcceptance,
  TERMS_SETTING,
  TERMS_VERSION,
} from '~/features/terms/logic/terms';

export function hasAcceptedTerms(): boolean {
  return isCurrentAcceptance(settingsRepo.get(TERMS_SETTING));
}

export function acceptTerms(now = new Date()): void {
  settingsRepo.set(TERMS_SETTING, encodeAcceptance(TERMS_VERSION, now));
}

export function termsAcceptedAt(): Date | null {
  return readAcceptance(settingsRepo.get(TERMS_SETTING))?.at ?? null;
}
