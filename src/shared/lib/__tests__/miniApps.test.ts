import { describe, expect, it } from 'vitest';
import {
  enabledMiniApps,
  MINI_APPS,
  parseEnabled,
  serialiseEnabled,
  toggleMiniApp,
} from '../miniApps';

/**
 * Which optional extras are switched on.
 *
 * Stored as one comma-separated `settings` value rather than a table: the set is
 * a handful of short strings, and a table would mean a migration every time a
 * mini app is added. That choice puts the burden on parsing being forgiving,
 * which is what these tests cover.
 */

describe('parseEnabled', () => {
  /** A device that has never opened the section has no key at all. */
  it('reads absent or empty as nothing enabled', () => {
    expect(parseEnabled(undefined).size).toBe(0);
    expect(parseEnabled(null).size).toBe(0);
    expect(parseEnabled('').size).toBe(0);
  });

  it('reads a single id', () => {
    expect([...parseEnabled('fuel')]).toEqual(['fuel']);
  });

  it('tolerates whitespace around ids', () => {
    expect([...parseEnabled('  fuel  ')]).toEqual(['fuel']);
  });

  /**
   * The reason ids are validated on read.
   *
   * Removing a mini app from the registry would otherwise leave devices holding
   * its id and rendering a dashboard card that routes to a screen deleted along
   * with it.
   */
  it('drops ids that are no longer in the registry', () => {
    expect([...parseEnabled('fuel,retired-app')]).toEqual(['fuel']);
    expect(parseEnabled('retired-app').size).toBe(0);
  });
});

describe('toggleMiniApp', () => {
  it('switches one on', () => {
    expect(toggleMiniApp('', 'fuel', true)).toBe('fuel');
  });

  it('switches one off', () => {
    expect(toggleMiniApp('fuel', 'fuel', false)).toBe('');
  });

  /** Enabling twice must not duplicate the id in the stored string. */
  it('is idempotent', () => {
    expect(toggleMiniApp('fuel', 'fuel', true)).toBe('fuel');
  });

  it('leaves a value unchanged when switching off something already off', () => {
    expect(toggleMiniApp('', 'fuel', false)).toBe('');
  });
});

describe('serialiseEnabled', () => {
  /**
   * Registry order, not insertion order, so the stored value is stable —
   * enabling A then B and B then A produce the same string.
   */
  it('writes ids in registry order', () => {
    const all = new Set(MINI_APPS.map((app) => app.id));

    expect(serialiseEnabled(all)).toBe(MINI_APPS.map((app) => app.id).join(','));
  });

  it('round-trips through parse', () => {
    const stored = toggleMiniApp('', 'fuel', true);

    expect([...parseEnabled(stored)]).toEqual(['fuel']);
  });
});

describe('enabledMiniApps', () => {
  it('resolves stored ids to registry entries', () => {
    const apps = enabledMiniApps('fuel');

    expect(apps).toHaveLength(1);
    expect(apps[0].name).toBeTruthy();
    expect(apps[0].route).toBeTruthy();
  });

  /** Nothing enabled means nothing rendered — the dashboard stays untouched. */
  it('resolves to nothing when none are enabled', () => {
    expect(enabledMiniApps('')).toEqual([]);
  });
});

describe('the registry itself', () => {
  it('has a unique id, a route and an icon for every entry', () => {
    const ids = MINI_APPS.map((app) => app.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const app of MINI_APPS) {
      expect(app.route.startsWith('/')).toBe(true);
      expect(app.icon).toBeTruthy();
      expect(app.description).toBeTruthy();
    }
  });

  /** Ids are persisted, so a comma would corrupt the stored list. */
  it('has no comma in any id', () => {
    for (const app of MINI_APPS) expect(app.id).not.toContain(',');
  });
});
