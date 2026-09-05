/** Key/value settings, and the canonical key names. */
import { now } from './internal';

import { eq } from 'drizzle-orm';
import { db } from '~/db/client';
import {
  settings,
} from '~/db/schema';

export const settingsRepo = {
  get(key: string): string | undefined {
    return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
  },
  set(key: string, value: string): void {
    db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } })
      .run();
  },
  getNumber(key: string, fallback: number): number {
    const raw = settingsRepo.get(key);
    if (raw === undefined) return fallback;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
};

export const SETTINGS_KEYS = {
  currency: 'currency',
  usdRate: 'usd_rate',
  onboarded: 'onboarded',
  /**
   * An in-progress onboarding plan, so closing the app mid-setup does not lose
   * everything typed so far. Holds the DRAFT only — see core/onboardingDraft.ts
   * — never the board itself, which is still written on confirm.
   */
  onboardingDraft: 'onboarding_draft',
  themeMode: 'theme_mode',
  haptics: 'haptics',
  /** Require Face ID / Touch ID / passcode before the app's contents are shown. */
  appLock: 'app_lock',
  /** Subscription tier — see core/plans.ts. */
  plan: 'plan',
  /** Share anonymous merchant corrections with the shared catalog. */
  catalogSync: 'catalog_sync',
  /**
   * Whether the Shortcuts drop-file intake is set up.
   *
   * Stored rather than inferred from the file existing: the app DELETES that
   * file every time it drains it, so "does it exist" is false most of the time
   * on a working setup — which made the toggle appear to switch itself off.
   */
  smsInboxEnabled: 'sms_inbox_enabled',
  /** Cursor for incremental catalog pulls — the last row's `updated_at`|`id`. */
  catalogCursor: 'catalog_cursor',
  /** When the catalog last synced, for the Settings status line. */
  catalogSyncedAt: 'catalog_synced_at',
  /** Comma-separated ids of enabled mini apps — see core/miniApps.ts. */
  miniApps: 'mini_apps',
  /**
   * ISO timestamp of the last successful Drive upload.
   *
   * Stored rather than read back from Drive so the "last backed up" line
   * renders instantly and offline — asking Drive would make the screen depend
   * on a network round trip to say something it already knows.
   */
  lastCloudBackupAt: 'last_cloud_backup_at',
  /** ISO timestamp of the last local backup file written. */
  lastLocalBackupAt: 'last_local_backup_at',

  /** Whether the app refreshes the USD rate on its own — see core/exchangeRate.ts. */
  rateAutoFetch: 'rate_auto_fetch',
  /** Which figure the board converts with: 'live' | 'average' | 'safe'. */
  rateMode: 'rate_mode',
  /** JSON list of recent readings, newest first. */
  rateHistory: 'rate_history',
  /** ISO timestamp of the last successful fetch, for the daily cadence. */
  rateFetchedAt: 'rate_fetched_at',

  /**
   * JSON list of per-BANK rates, as last fetched — see features/rates.
   *
   * Cached so the rates screen renders instantly and offline. The figures are
   * captioned with their own timestamp, so stale data is shown as stale rather
   * than passed off as current.
   */
  bankRates: 'bank_rates',
  /**
   * Per-currency cache keys, for a board holding more than one foreign
   * currency.
   *
   * `bankRates` alone was a single slot, so viewing EUR rates overwrote the USD
   * ones the board converts with. Namespacing by currency lets each stand on
   * its own — and USD keeps the unsuffixed key, so an existing cache survives
   * the change rather than being refetched on first launch.
   */
  bankRatesFor: (currency: string) =>
    currency.toUpperCase() === 'USD' ? 'bank_rates' : `bank_rates_${currency.toLowerCase()}`,
  bankRatesFetchedAtFor: (currency: string) =>
    currency.toUpperCase() === 'USD'
      ? 'bank_rates_fetched_at'
      : `bank_rates_fetched_at_${currency.toLowerCase()}`,
  /** ISO timestamp of the last successful per-bank fetch. */
  bankRatesFetchedAt: 'bank_rates_fetched_at',
  /**
   * The last salary-bank rate the app successfully resolved.
   *
   * Kept separately from the full `bankRates` blob so the fallback survives
   * anything that invalidates that cache — a source that drops the bank, a
   * schema change, a corrupt write. Rates move by fractions of a percent a
   * day, so yesterday's figure is far closer to the truth than any default.
   */
  lastBankRate: 'last_bank_rate',
  /**
   * The account a USD salary lands in, as a card id.
   *
   * Null means "infer it" — the app picks the USD account with income planned
   * against it (see `resolveSalaryCardId`), which is right for the common case
   * of exactly one. Set explicitly only when that inference is wrong, so most
   * users never see this and the rest can correct it.
   */
  salaryCardId: 'salary_card_id',
  /**
   * Whether to hide messages about accounts the user does not hold.
   *
   * For a phone number the carrier reassigned: the new owner stays on some
   * bank's alert list and receives a stranger's credits forever. OFF by
   * default — the feature discards messages, and defaulting to discard would
   * hide a real transaction from anyone whose accounts are not all entered
   * yet, with nothing on screen to explain the gap.
   */
  hideForeignAccounts: 'hide_foreign_accounts',
} as const;
