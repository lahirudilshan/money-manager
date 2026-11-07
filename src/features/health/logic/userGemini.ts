/**
 * "Use my Google account" for AI reading — the pure half.
 *
 * ## Why
 *
 * Gemini's free API tier belongs to a Google Cloud PROJECT, not to a person.
 * On Dayly's own project that is one small daily allowance shared by every
 * user of the app (20 Flash requests a day, measured 2026-11-07). Every Gmail
 * account can own projects of its own, each with its own free allowance — so
 * the user signs in once, and Dayly does what AI Studio's "Create API key"
 * button does, in THEIR account:
 *
 *   1. find or create a project named "Dayly AI",
 *   2. turn on the Gemini API in it,
 *   3. find or create a key limited to Gemini AND to this app's bundle id,
 *   4. keep the key in the keychain, and throw the sign-in away.
 *
 * After that, reports go to Gemini on the user's own quota. Verified end to
 * end against Google's real APIs on 2026-11-07, including that the key is
 * refused when another bundle id presents it.
 *
 * Driving the Gemini CHAT app instead (a hidden browser logged into the
 * user's account) was rejected: it breaks Google's terms, can get the user's
 * whole Google account restricted, needs their password, and breaks whenever
 * the page changes.
 *
 * Request builders and response readers live here so they are tested
 * without a phone; `services/userGemini.ts` runs them.
 */

/** Broad, but only used during set-up: the token is never stored. */
export const CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
/** To show which account the key belongs to. */
export const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export const PROJECT_DISPLAY_NAME = 'Dayly AI';
export const KEY_DISPLAY_NAME = 'Dayly app';
export const GEMINI_SERVICE = 'generativelanguage.googleapis.com';

const CRM = 'https://cloudresourcemanager.googleapis.com/v3';
const SERVICE_USAGE = 'https://serviceusage.googleapis.com/v1';
const API_KEYS = 'https://apikeys.googleapis.com/v2';

export interface CloudRequest {
  method: 'GET' | 'POST';
  url: string;
  body?: string;
}

/** Project ids are global: a fixed prefix and a random tail, 6–30 chars. */
export function newProjectId(random: string): string {
  const tail = random.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8).padEnd(6, '0');
  return `dayly-ai-${tail}`;
}

export function findProjectRequest(): CloudRequest {
  const query = encodeURIComponent(`displayName:"${PROJECT_DISPLAY_NAME}" state:ACTIVE`);
  return { method: 'GET', url: `${CRM}/projects:search?query=${query}` };
}

/** The id of an existing "Dayly AI" project, so a second set-up reuses it. */
export function readFoundProject(payload: unknown): string | null {
  const projects = (payload as { projects?: { projectId?: string; state?: string }[] } | null)
    ?.projects;
  const found = (projects ?? []).find((p) => p.state === 'ACTIVE' && p.projectId);
  return found?.projectId ?? null;
}

export function createProjectRequest(projectId: string): CloudRequest {
  return {
    method: 'POST',
    url: `${CRM}/projects`,
    body: JSON.stringify({ projectId, displayName: PROJECT_DISPLAY_NAME }),
  };
}

export function enableGeminiRequest(projectId: string): CloudRequest {
  return {
    method: 'POST',
    url: `${SERVICE_USAGE}/projects/${projectId}/services/${GEMINI_SERVICE}:enable`,
    body: '{}',
  };
}

export function listKeysRequest(projectId: string): CloudRequest {
  return { method: 'GET', url: `${API_KEYS}/projects/${projectId}/locations/global/keys` };
}

/** An existing key this app made earlier — its resource name. */
export function readExistingKey(payload: unknown, bundleId: string): string | null {
  const keys = (payload as { keys?: CloudKey[] } | null)?.keys ?? [];
  const found = keys.find(
    (k) =>
      k.displayName === KEY_DISPLAY_NAME &&
      !k.deleteTime &&
      (k.restrictions?.iosKeyRestrictions?.allowedBundleIds ?? []).includes(bundleId),
  );
  return found?.name ?? null;
}

interface CloudKey {
  name?: string;
  displayName?: string;
  deleteTime?: string;
  keyString?: string;
  restrictions?: { iosKeyRestrictions?: { allowedBundleIds?: string[] } };
}

/**
 * A key that only works for Gemini, and only from this app: Google refuses
 * it from any other bundle id (verified — 403 "Requests from this iOS client
 * application … are blocked").
 */
export function createKeyRequest(projectId: string, bundleId: string): CloudRequest {
  return {
    method: 'POST',
    url: `${API_KEYS}/projects/${projectId}/locations/global/keys`,
    body: JSON.stringify({
      displayName: KEY_DISPLAY_NAME,
      restrictions: {
        apiTargets: [{ service: GEMINI_SERVICE }],
        iosKeyRestrictions: { allowedBundleIds: [bundleId] },
      },
    }),
  };
}

export function keyStringRequest(keyName: string): CloudRequest {
  return { method: 'GET', url: `${API_KEYS}/${keyName}/keyString` };
}

/** Which API an operation name belongs to, so it is polled at the right host. */
export function operationRequest(operationName: string): CloudRequest {
  const base = operationName.startsWith('operations/akmf')
    ? API_KEYS
    : operationName.startsWith('operations/acat') || operationName.startsWith('operations/acf')
      ? SERVICE_USAGE
      : CRM;
  return { method: 'GET', url: `${base}/${operationName}` };
}

export interface OperationState {
  done: boolean;
  error: string | null;
  response: Record<string, unknown> | null;
}

export function readOperation(payload: unknown): OperationState {
  const op = (payload ?? {}) as {
    done?: boolean;
    error?: { message?: string };
    response?: Record<string, unknown>;
  };
  return {
    done: op.done === true,
    error: op.error ? (op.error.message ?? 'Google reported an error.') : null,
    response: op.response ?? null,
  };
}

/** A key's secret, from a finished create operation or a keyString reply. */
export function readKeyString(payload: unknown): string | null {
  const value = (payload as { keyString?: unknown } | null)?.keyString;
  return typeof value === 'string' && value.length > 10 ? value : null;
}

export type CloudProblem =
  /** The account has never accepted Google Cloud's terms. */
  | 'terms'
  /** The account has used up how many projects it may own. */
  | 'project-limit'
  /** Dayly's own OAuth project is missing an API — a set-up job for the developer. */
  | 'app-not-configured'
  | 'denied'
  | 'other';

/** What a failed Cloud call means, from its status and body. */
export function classifyCloudError(status: number, body: string): CloudProblem {
  const text = body.toLowerCase();
  if (/terms of service|\btos\b|accept.*terms/.test(text)) return 'terms';
  if (/project quota|projects? limit|allotted project quota|too many projects/.test(text)) {
    return 'project-limit';
  }
  // The management APIs are billed to the OAuth client's project; when one is
  // off there, Google names that project: "… has not been used in project 4860…".
  if (/has not been used in project|service_disabled|is disabled/.test(text)) {
    return 'app-not-configured';
  }
  if (status === 401 || status === 403) return 'denied';
  return 'other';
}

/** Where to send the user for each problem, and what to say. */
export function describeCloudProblem(problem: CloudProblem): { message: string; url?: string } {
  switch (problem) {
    case 'terms':
      return {
        message:
          'Google needs you to accept its Cloud terms once. Open the page, tap Agree, then come back and try again.',
        url: 'https://console.cloud.google.com/',
      };
    case 'project-limit':
      return {
        message:
          'Your Google account already has as many projects as it can own. Remove an unused one, then try again.',
        url: 'https://console.cloud.google.com/cloud-resource-manager',
      };
    case 'app-not-configured':
      return {
        message:
          'This version of Dayly is not set up for this yet. Use Dayly’s shared AI allowance for now.',
      };
    case 'denied':
      return { message: 'Google did not allow the set-up. Sign in again and allow access.' };
    default:
      return { message: 'The set-up did not finish. Check your connection and try again.' };
  }
}

/** The set-up's steps, for the progress list on screen. */
export type SetupStep = 'signing-in' | 'project' | 'gemini' | 'key' | 'checking' | 'done';

export const SETUP_STEPS: { key: Exclude<SetupStep, 'done'>; label: string }[] = [
  { key: 'signing-in', label: 'Signing in to Google' },
  { key: 'project', label: 'Making a “Dayly AI” space in your account' },
  { key: 'gemini', label: 'Turning on Gemini there' },
  { key: 'key', label: 'Creating a key only Dayly can use' },
  { key: 'checking', label: 'Checking it works' },
];

/*
 * ---------------------------------------------------------------------------
 * Calling Gemini with the user's key (no Firebase in between)
 * ---------------------------------------------------------------------------
 */

export function geminiRestUrl(model: string, stream: boolean): string {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
  return stream ? `${base}:streamGenerateContent?alt=sse` : `${base}:generateContent`;
}

/**
 * Split a server-sent-events buffer into finished `data:` payloads and the
 * unfinished tail, which waits for the next chunk.
 */
export function readSse(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  let rest = buffer;
  let newline: number;
  while ((newline = rest.indexOf('\n')) >= 0) {
    const line = rest.slice(0, newline).trim();
    rest = rest.slice(newline + 1);
    if (!line.startsWith('data:')) continue;
    try {
      events.push(JSON.parse(line.slice(5)));
    } catch {
      // A malformed event is skipped; the final JSON parse catches real damage.
    }
  }
  return { events, rest };
}

/** The text in one Gemini response (or stream event), thoughts excluded. */
export function responseText(payload: unknown): string {
  const parts =
    (payload as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })
      ?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
}

export function responseUsage(payload: unknown): Record<string, number> | null {
  const usage = (payload as { usageMetadata?: Record<string, number> } | null)?.usageMetadata;
  return usage ?? null;
}
