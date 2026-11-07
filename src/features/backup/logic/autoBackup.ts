/**
 * An automatic backup to Google Drive — daily, weekly or monthly.
 *
 * ## Why automatic, and why on by default
 *
 * A backup only protects what happened before it. Manual backups meant the
 * newest one was whatever the user last remembered — and a reinstall then
 * lost everything since. With Drive connected, one backup a day costs nothing
 * the user notices, so it is on unless they turn it off.
 *
 * ## When it runs
 *
 * When the app is opened or brought back, at most once per 24 hours. There is
 * no background task (that needs a native module this build does not carry),
 * so a phone that never opens the app does not back up — but a phone that is
 * never opened also has nothing new to lose.
 *
 * ## Keeping Drive tidy
 *
 * Automatic backups are labelled, and only THEY are pruned: the newest
 * `AUTO_BACKUPS_KEPT` stay, a fortnight of history. A backup the user made by
 * hand is never deleted by this.
 *
 * Pure: the store runs the network and database steps.
 */

/** The label every automatic backup carries, and pruning matches on. */
export const AUTO_BACKUP_LABEL = 'Automatic backup';

/** Labels automatic backups carried before, still pruned as automatic. */
const LEGACY_AUTO_LABELS = ['Automatic daily backup'];

export type AutoBackupFrequency = 'daily' | 'weekly' | 'monthly';
export const AUTO_BACKUP_FREQUENCIES: readonly AutoBackupFrequency[] = ['daily', 'weekly', 'monthly'];

const DAY = 24 * 60 * 60 * 1000;

/**
 * How often, and how many copies to keep — about two weeks of daily backups,
 * two months of weekly ones, half a year of monthly ones. Each keeps a useful
 * stretch of history without filling the user's Drive.
 */
export const FREQUENCY_RULE: Record<AutoBackupFrequency, { intervalMs: number; keep: number }> = {
  daily: { intervalMs: DAY, keep: 14 },
  weekly: { intervalMs: 7 * DAY, keep: 8 },
  monthly: { intervalMs: 30 * DAY, keep: 6 },
};

/** The stored frequency, defaulting to daily. */
export function autoBackupFrequency(setting: string | undefined): AutoBackupFrequency {
  return (AUTO_BACKUP_FREQUENCIES as readonly string[]).includes(setting ?? '')
    ? (setting as AutoBackupFrequency)
    : 'daily';
}

/** How many automatic backups to keep — kept for callers that do not pass a frequency. */
export const AUTO_BACKUPS_KEPT = FREQUENCY_RULE.daily.keep;

/** Setting values: absent means ON — the default. */
export function isAutoBackupEnabled(setting: string | undefined): boolean {
  return setting !== 'false';
}

/** Whether a backup is due now. */
export function isAutoBackupDue(
  lastBackupIso: string | undefined | null,
  now: Date,
  enabledSetting: string | undefined,
  frequency: AutoBackupFrequency = 'daily',
): boolean {
  if (!isAutoBackupEnabled(enabledSetting)) return false;
  if (!lastBackupIso) return true;
  const last = Date.parse(lastBackupIso);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= FREQUENCY_RULE[frequency].intervalMs;
}

/**
 * Which automatic backups to delete, given the folder newest-first.
 *
 * Matches on the label alone, so a manual backup — whatever it is called —
 * is never in the result.
 */
export function autoBackupsToPrune(
  files: readonly { id: string; description?: string | null }[],
  keep = AUTO_BACKUPS_KEPT,
): string[] {
  return files
    .filter(
      (file) =>
        file.description === AUTO_BACKUP_LABEL ||
        LEGACY_AUTO_LABELS.includes(file.description ?? ''),
    )
    .slice(keep)
    .map((file) => file.id);
}
