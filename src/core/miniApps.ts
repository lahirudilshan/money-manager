/**
 * Optional extras the user can switch on, one at a time.
 *
 * The app's core is the funding board, and everything on the dashboard earns
 * its place by being about money moving this month. A fuel log is genuinely
 * useful to someone who drives and pure noise to someone who does not — so
 * rather than shipping it to everybody and apologising with a settings toggle
 * buried later, these are OFF by default and appear only once asked for.
 *
 * The registry is plain data so a new mini app is one entry here plus its
 * screens. Nothing else in the app needs to learn about it.
 *
 * Enabled ids live in a single `settings` row rather than a table of their own:
 * the set is a handful of short strings, and a table would mean a migration
 * every time one is added.
 */

import type { Ionicons } from '@expo/vector-icons';

export type MiniAppId = 'fuel';

export interface MiniApp {
  id: MiniAppId;
  /** Shown in the settings list and on the dashboard card. */
  name: string;
  /** One line saying what it does, for the settings row. */
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Accent for the dashboard card, so each mini app is recognisable. */
  color: string;
  /** Where the dashboard card and the settings row navigate to. */
  route: string;
}

export const MINI_APPS: MiniApp[] = [
  {
    id: 'fuel',
    name: 'Fuel & vehicles',
    description: 'Track fill-ups, real tank-to-tank mileage, running costs and services.',
    icon: 'car-sport-outline',
    color: '#0E9F6E',
    route: '/mini/fuel',
  },
];

export function miniAppById(id: string): MiniApp | undefined {
  return MINI_APPS.find((app) => app.id === id);
}

/**
 * Read the stored list into a set of ids.
 *
 * Tolerant of anything the column might hold: an absent key on a device that
 * has never opened the section, stray whitespace, and — importantly — ids that
 * no longer exist, so removing a mini app from the registry cannot leave a
 * device pointing at a route that was deleted with it.
 */
export function parseEnabled(raw: string | undefined | null): Set<MiniAppId> {
  if (!raw) return new Set();

  const known = new Set(MINI_APPS.map((app) => app.id as string));

  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => known.has(id)) as MiniAppId[],
  );
}

/**
 * Serialise back to the stored form.
 *
 * Sorted by registry order rather than insertion order, so the value is stable:
 * enabling A then B and enabling B then A produce the same string, and a diff
 * of the settings table does not churn.
 */
export function serialiseEnabled(enabled: ReadonlySet<MiniAppId>): string {
  return MINI_APPS.filter((app) => enabled.has(app.id))
    .map((app) => app.id)
    .join(',');
}

/** The registry entries that are currently switched on, in registry order. */
export function enabledMiniApps(raw: string | undefined | null): MiniApp[] {
  const enabled = parseEnabled(raw);
  return MINI_APPS.filter((app) => enabled.has(app.id));
}

/** Flip one id on or off, returning the new stored string. */
export function toggleMiniApp(
  raw: string | undefined | null,
  id: MiniAppId,
  on: boolean,
): string {
  const next = parseEnabled(raw);
  if (on) next.add(id);
  else next.delete(id);
  return serialiseEnabled(next);
}
