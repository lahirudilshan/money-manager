import { settingsRepo } from '~/db/repositories';
import {
  addQuestion,
  DAILY_QUESTION_LIMIT,
  parseQuestionLog,
  questionsUsedToday,
} from '~/features/health/logic/askHealth';
import { freeAllowance } from './aiQuotaStore';
import { aiUsageToday } from './aiSettings';
import { usesOwnGoogleAi } from './firebaseAi';

/**
 * The daily Ask AI allowance — shared by every scope (see features/ask). One
 * question is one request against the same free allowance report reading uses.
 */

const LOG_KEY = 'health_ai_questions';

export interface AskAllowance {
  /** Questions that can still be asked today. */
  left: number;
  /** On the user's own Google AI: Dayly's phone cap does not apply. */
  own: boolean;
  /** Report reads still possible today — the same allowance, shown together. */
  reportsLeft: number;
  resetsAt: Date;
}

/**
 * What is left today, overall: Google's free allowance (shared with report
 * reading — one question is one request), and on Dayly's shared project also
 * this phone's daily question cap.
 */
export function askAllowance(now = new Date()): AskAllowance {
  const own = usesOwnGoogleAi();
  const allowance = freeAllowance(own ? 'own' : 'shared', now);
  const usage = aiUsageToday(now);
  const asked = questionsUsedToday(parseQuestionLog(settingsRepo.get(LOG_KEY)), now);
  const capLeft = Math.max(0, DAILY_QUESTION_LIMIT - asked);
  return {
    left: own ? allowance.requestsLeft : Math.min(capLeft, allowance.requestsLeft),
    own,
    reportsLeft: own ? allowance.reportsLeft : Math.min(usage.left, allowance.reportsLeft),
    resetsAt: allowance.resetsAt,
  };
}

export function questionsAskedToday(now = new Date()): number {
  return questionsUsedToday(parseQuestionLog(settingsRepo.get(LOG_KEY)), now);
}

/** Count one answered question against today's phone cap. */
export function recordQuestion(now = new Date()): void {
  try {
    settingsRepo.set(LOG_KEY, JSON.stringify(addQuestion(parseQuestionLog(settingsRepo.get(LOG_KEY)), now)));
  } catch {
    // Counting must never lose an answer.
  }
}
