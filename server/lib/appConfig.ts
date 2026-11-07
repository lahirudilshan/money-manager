import 'server-only';

import { cacheLife } from 'next/cache';
import { sql } from './db';

/**
 * Runtime settings for the app, read from the `app_config` table.
 *
 * Only the keys listed here leave the server. Each is renamed to the camelCase
 * field the app expects, so a column rename on either side is one line here.
 */
const PUBLIC_KEYS = {
  sms_shortcut_url: 'smsShortcutUrl',
} as const;

export type AppConfig = Partial<Record<(typeof PUBLIC_KEYS)[keyof typeof PUBLIC_KEYS], string>>;

export async function getAppConfig(): Promise<AppConfig> {
  'use cache';
  // Edited by hand in the Neon console, with no write path to revalidate a
  // tag, so the TTL is the only thing that publishes a change. "minutes" is a
  // one-minute revalidate: fast enough to fix a broken link, and still one
  // query a minute however many devices ask.
  cacheLife('minutes');

  const rows = (await sql`
    SELECT key, value FROM app_config WHERE key = ANY(${Object.keys(PUBLIC_KEYS)})
  `) as { key: keyof typeof PUBLIC_KEYS; value: string }[];

  const config: AppConfig = {};
  for (const row of rows) config[PUBLIC_KEYS[row.key]] = row.value;
  return config;
}
