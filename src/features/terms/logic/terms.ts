/**
 * The terms the user agrees to before using the app, said in plain words.
 *
 * Versioned: raising TERMS_VERSION when the terms change in a way that matters
 * (a new kind of data leaves the phone, a new AI use) asks everyone to read
 * and agree again, instead of quietly assuming the old "yes" covers it.
 */
export const TERMS_VERSION = 3;

export const TERMS_SETTING = 'terms_accepted';

/** Stored as "<version>:<epoch ms>". */
export function encodeAcceptance(version: number, at: Date): string {
  return `${version}:${at.getTime()}`;
}

export function readAcceptance(raw: string | undefined | null): { version: number; at: Date } | null {
  if (!raw) return null;
  const [v, ms] = raw.split(':').map(Number);
  if (!Number.isFinite(v) || !Number.isFinite(ms) || ms <= 0) return null;
  return { version: v, at: new Date(ms) };
}

export function isCurrentAcceptance(raw: string | undefined | null): boolean {
  const accepted = readAcceptance(raw);
  return accepted !== null && accepted.version >= TERMS_VERSION;
}

export interface TermsSection {
  key: string;
  icon: string;
  /** Short and plain, so the whole page can be read at a glance. */
  title: string;
  /** One sentence: the part that matters. */
  summary: string;
  /** The rest, behind "More". */
  points: string[];
}

/** The terms themselves: one line each, details one tap away. */
export const TERMS: TermsSection[] = [
  {
    key: 'data',
    icon: 'phone-portrait-outline',
    title: 'Your data is yours',
    summary: 'Everything is saved on this phone. We cannot see it.',
    points: [
      'Dayly has no account for you and no server holding your data.',
      'If you connect Google Drive, backups and photos go to your own Drive.',
    ],
  },
  {
    key: 'ai',
    icon: 'sparkles-outline',
    title: 'AI is your choice',
    summary: 'Google Gemini can explain your lab reports and answer your questions. Only when you ask, with only what you allow.',
    points: [
      'When you ask a question, only the parts you allowed are sent with it: health records, money totals, or vehicles, trackers and documents. Each has its own switch.',
      'Money is sent as totals only — never account or card numbers, SMS text or notes.',
      'Some questions are also searched on Google.',
      'It is free. Dayly never turns on billing.',
      'You can get your own free Gemini with your Google email.',
      'Dayly does not keep or read what you send or search.',
      'AI can make mistakes. Check with a doctor.',
      'Turn it off any time in Settings → AI features.',
    ],
  },
  {
    key: 'advice',
    icon: 'medkit-outline',
    title: 'Not advice',
    summary: 'Dayly helps you keep track. It does not replace a doctor or a bank.',
    points: ['Check important numbers, like bills and test results, yourself.'],
  },
  {
    key: 'care',
    icon: 'shield-checkmark-outline',
    title: 'Keep it safe',
    summary: 'Turn on App lock and make backups.',
    points: ['Without a backup, a lost phone means lost data.'],
  },
  {
    key: 'use',
    icon: 'document-text-outline',
    title: 'Fair use',
    summary: 'The app is given as it is. We will ask again if these terms change.',
    points: ['We work hard to keep it correct, but we cannot promise it has no mistakes.'],
  },
];
