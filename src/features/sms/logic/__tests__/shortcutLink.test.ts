import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUT_URL, isShortcutLink, resolveShortcutUrl } from '../shortcutLink';

const GOOD = 'https://www.icloud.com/shortcuts/1c6f472795854c769e76e9639ee8eb81';

describe('isShortcutLink', () => {
  it('accepts a shared iCloud shortcut link', () => {
    expect(isShortcutLink(GOOD)).toBe(true);
    expect(isShortcutLink(DEFAULT_SHORTCUT_URL)).toBe(true);
  });

  it('rejects anything that is not exactly that shape', () => {
    for (const bad of [
      undefined,
      null,
      42,
      '',
      'http://www.icloud.com/shortcuts/1c6f472795854c769e76e9639ee8eb81',
      'https://evil.example/shortcuts/1c6f472795854c769e76e9639ee8eb81',
      'https://www.icloud.com/shortcuts/1c6f4727',
      `${GOOD}?next=https://evil.example`,
      'moneymanager://sms?text=x',
    ]) {
      expect(isShortcutLink(bad)).toBe(false);
    }
  });
});

describe('resolveShortcutUrl', () => {
  it('prefers a valid cached link', () => {
    expect(resolveShortcutUrl(GOOD)).toBe(GOOD);
  });

  it('falls back to the built-in link when nothing valid is cached', () => {
    expect(resolveShortcutUrl(undefined)).toBe(DEFAULT_SHORTCUT_URL);
    expect(resolveShortcutUrl('not a link')).toBe(DEFAULT_SHORTCUT_URL);
  });
});
