/**
 * What happens around attaching a file, without `shared/` knowing about Drive.
 *
 * Every attach control (the photo slot on a transaction, a health report
 * upload) should offer to connect Google Drive the first time, and should push
 * the new file up as soon as it is saved. Both are Drive operations, which live
 * in `features/backup` — and `shared/` must not import from `features/`.
 *
 * So `shared/` declares the questions here and the app root answers them at
 * launch (`registerAttachmentGate` in app/_layout.tsx). Until it does, every
 * answer is the harmless one: never ask, upload nothing.
 */

export interface AttachmentGate {
  /** Whether to show the "keep your files in Google Drive" prompt now. */
  shouldOfferDrive(): Promise<boolean>;
  /** Run Google sign-in. */
  connectDrive(): Promise<{ ok: boolean; error?: string }>;
  /** The user said "not now" — stay quiet for a while. */
  snoozeDrive(): void;
  /** A file was just saved locally — upload it when possible. */
  afterAttach(): void;
  /** The Google account files are going to, for the confirmation line. */
  connectedAccount(): Promise<string | null>;
}

const NOOP: AttachmentGate = {
  shouldOfferDrive: async () => false,
  connectDrive: async () => ({ ok: false, error: 'Google Drive is not available.' }),
  snoozeDrive: () => {},
  afterAttach: () => {},
  connectedAccount: async () => null,
};

let gate: AttachmentGate = NOOP;

export function registerAttachmentGate(implementation: AttachmentGate): void {
  gate = implementation;
}

export function attachmentGate(): AttachmentGate {
  return gate;
}

/** How long "Not now" keeps the prompt away. Long enough not to nag. */
export const DRIVE_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether a snooze stored as epoch ms is still in force. Pure, for tests. */
export function isSnoozed(stored: string | undefined, now: number): boolean {
  const until = Number(stored);
  return Number.isFinite(until) && until > now;
}
