import { describe, expect, it } from 'vitest';
import {
  classifyCloudError,
  createKeyRequest,
  createProjectRequest,
  describeCloudProblem,
  enableGeminiRequest,
  findProjectRequest,
  geminiRestUrl,
  newProjectId,
  operationRequest,
  readExistingKey,
  readFoundProject,
  readKeyString,
  readOperation,
  readSse,
  responseText,
} from '~/features/health/logic/userGemini';

const BUNDLE = 'com.lahirudilshan.dayly';

describe('setting up Gemini in the user’s own Google account', () => {
  it('makes a valid, prefixed project id', () => {
    const id = newProjectId('AbC_12xyz9999');
    expect(id).toBe('dayly-ai-abc12xyz');
    expect(id).toMatch(/^[a-z][a-z0-9-]{5,29}$/);
    expect(newProjectId('x')).toBe('dayly-ai-x00000');
  });

  it('reuses an existing "Dayly AI" project instead of making another', () => {
    expect(findProjectRequest().url).toContain('displayName%3A%22Dayly%20AI%22');
    expect(
      readFoundProject({
        projects: [
          { projectId: 'old', state: 'DELETE_REQUESTED' },
          { projectId: 'dayly-ai-abc123', state: 'ACTIVE' },
        ],
      }),
    ).toBe('dayly-ai-abc123');
    expect(readFoundProject({})).toBeNull();
  });

  it('builds the project, enable and key requests', () => {
    expect(JSON.parse(createProjectRequest('dayly-ai-abc123').body!)).toEqual({
      projectId: 'dayly-ai-abc123',
      displayName: 'Dayly AI',
    });
    expect(enableGeminiRequest('p').url).toBe(
      'https://serviceusage.googleapis.com/v1/projects/p/services/generativelanguage.googleapis.com:enable',
    );
    const key = JSON.parse(createKeyRequest('p', BUNDLE).body!);
    expect(key.restrictions.apiTargets).toEqual([{ service: 'generativelanguage.googleapis.com' }]);
    expect(key.restrictions.iosKeyRestrictions.allowedBundleIds).toEqual([BUNDLE]);
  });

  it('reuses only a live key this app made, for this app', () => {
    const keys = {
      keys: [
        { name: 'k-deleted', displayName: 'Dayly app', deleteTime: '2026-01-01', restrictions: { iosKeyRestrictions: { allowedBundleIds: [BUNDLE] } } },
        { name: 'k-other', displayName: 'Something else' },
        { name: 'k-good', displayName: 'Dayly app', restrictions: { iosKeyRestrictions: { allowedBundleIds: [BUNDLE] } } },
      ],
    };
    expect(readExistingKey(keys, BUNDLE)).toBe('k-good');
    expect(readExistingKey(keys, 'com.other')).toBeNull();
  });

  it('polls each operation at the API that started it', () => {
    expect(operationRequest('operations/create_project.global.71').url).toMatch(/^https:\/\/cloudresourcemanager/);
    expect(operationRequest('operations/acat.p2-56-06').url).toMatch(/^https:\/\/serviceusage/);
    expect(operationRequest('operations/akmf.p7-56-02').url).toMatch(/^https:\/\/apikeys/);
  });

  it('reads operations and key strings', () => {
    expect(readOperation({ name: 'x' })).toEqual({ done: false, error: null, response: null });
    expect(readOperation({ done: true, error: { message: 'nope' } }).error).toBe('nope');
    expect(readKeyString({ keyString: 'AIzaSyExampleExample' })).toBe('AIzaSyExampleExample');
    expect(readKeyString({})).toBeNull();
  });

  it('turns Google’s refusals into something the user can act on', () => {
    expect(classifyCloudError(400, 'Callers must accept Terms of Service')).toBe('terms');
    expect(classifyCloudError(400, 'You have exceeded your allotted project quota')).toBe('project-limit');
    expect(
      classifyCloudError(403, 'Cloud Resource Manager API has not been used in project 486010862889'),
    ).toBe('app-not-configured');
    expect(classifyCloudError(403, 'The caller does not have permission')).toBe('denied');
    expect(classifyCloudError(400, 'photos of stuff')).toBe('other');
    expect(describeCloudProblem('terms').url).toBe('https://console.cloud.google.com/');
  });
});

describe('calling Gemini with the user’s key', () => {
  it('reads a streamed answer across chunk boundaries', () => {
    const a = readSse('data: {"candidates":[{"content":{"parts":[{"text":"{\\"a\\""}]}}]}\n\ndata: {"cand');
    expect(a.events.map(responseText)).toEqual(['{"a"']);
    const b = readSse(`${a.rest}idates":[{"content":{"parts":[{"text":":1}"}]}}]}\n`);
    expect(b.events.map(responseText)).toEqual([':1}']);
    expect(b.rest).toBe('');
  });

  it('leaves thoughts out of the answer', () => {
    expect(
      responseText({ candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text: 'ok' }] } }] }),
    ).toBe('ok');
  });

  it('uses the streaming endpoint', () => {
    expect(geminiRestUrl('gemini-flash-latest', true)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse',
    );
  });
});
