import {
  buildAskPrompt,
  cleanAnswer,
  routeQuestion,
  sourcesFrom,
  type AnswerSource,
  type ChatTurn,
  type QuestionRoute,
} from '~/features/health/logic/askHealth';
import { askAllowance, recordQuestion } from '~/features/health/services/askHealth';
import { isAiEnabled } from '~/features/health/services/aiSettings';
import { generateAnswerText, isAiAvailable } from '~/features/health/services/firebaseAi';
import { withLiveWork } from '~/shared/lib/liveWork';
import { userGeminiKey } from '~/features/health/services/userGemini';
import { askInstruction, SCOPE_AREAS, type AskArea, type AskScope } from '~/features/ask/logic/askScope';
import { buildAskContext } from './askContext';
import { hasAreaConsent } from './askConsent';

/**
 * One Ask AI question, from any screen. The scope decides which records go
 * with it (see logic/askScope.ts); the question decides the model (see
 * `routeQuestion`). Every question counts against the same daily allowance.
 */

export type AskBlock = 'off' | 'unavailable' | 'consent' | 'limit' | null;

/** The areas of this scope the user still has to allow. */
export function missingAreas(scope: AskScope): AskArea[] {
  return SCOPE_AREAS[scope].filter((a) => !hasAreaConsent(a));
}

/** Why a question cannot be asked here right now, or null when it can. */
export function askBlocked(scope: AskScope): AskBlock {
  if (!isAiEnabled()) return 'off';
  if (!isAiAvailable()) return 'unavailable';
  // A section needs its own area; global needs at least one.
  if (missingAreas(scope).length === SCOPE_AREAS[scope].length) return 'consent';
  if (askAllowance().left <= 0) return 'limit';
  return null;
}

export interface AskAnswer {
  text: string;
  sources: AnswerSource[];
  route: QuestionRoute;
  areas: AskArea[];
}

export async function askQuestion(input: {
  scope: AskScope;
  personId?: string;
  earlier: readonly ChatTurn[];
  question: string;
  onPartial?: (text: string) => void;
}): Promise<{ ok: true; answer: AskAnswer } | { ok: false; error: string }> {
  // Load the user's own key (if any) before asking whether AI is available.
  await userGeminiKey();
  const blocked = askBlocked(input.scope);
  if (blocked === 'off') return { ok: false, error: 'AI is turned off in Settings → AI features.' };
  if (blocked === 'unavailable') return { ok: false, error: 'AI is not available in this version of the app.' };
  if (blocked === 'consent') return { ok: false, error: 'Allow AI to see this part of the app first.' };
  if (blocked === 'limit') return { ok: false, error: 'No free AI questions left today. Try again tomorrow.' };

  const route = routeQuestion(input.question);
  const context = buildAskContext(input.scope, { personId: input.personId });
  // Keeps answering if the phone is locked or the user switches apps, with a
  // notification carrying the start of the answer — see shared/lib/liveWork.ts.
  const shortQuestion = input.question.length > 60 ? `${input.question.slice(0, 57)}…` : input.question;
  const result = await withLiveWork(
    {
      title: 'Answering your question',
      subtitle: shortQuestion,
      expectedSeconds: route.web ? 20 : 10,
      done: (r) =>
        r.ok
          ? { title: 'Your answer is ready', body: previewOf(cleanAnswer(r.text)) }
          : { title: 'Could not answer', body: 'Open Dayly to ask again.' },
      failed: { title: 'Could not answer', body: 'Open Dayly to ask again.' },
    },
    () =>
      generateAnswerText({
        models: route.models,
        systemInstruction: askInstruction(input.scope, context.areas),
        prompt: buildAskPrompt({ context: context.text, earlier: input.earlier, question: input.question }),
        web: route.web,
        onPartial: input.onPartial ? (text) => input.onPartial?.(cleanAnswer(text)) : undefined,
      }),
  );
  if (!result.ok) return result;

  recordQuestion();
  return {
    ok: true,
    answer: {
      text: cleanAnswer(result.text),
      sources: sourcesFrom(result.grounding),
      route,
      areas: context.areas,
    },
  };
}

/** The first line or so of an answer, for the notification. */
function previewOf(text: string): string {
  const plain = text.replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > 140 ? `${plain.slice(0, 137)}…` : plain;
}
