import { describe, expect, it } from 'vitest';
import {
  autoBackupFrequency,
  AUTO_BACKUP_LABEL,
  autoBackupsToPrune,
  isAutoBackupDue,
  isAutoBackupEnabled,
} from '~/features/backup/logic/autoBackup';

const NOW = new Date('2026-11-06T12:00:00Z');

describe('automatic backup', () => {
  it('is on unless turned off', () => {
    expect(isAutoBackupEnabled(undefined)).toBe(true);
    expect(isAutoBackupEnabled('true')).toBe(true);
    expect(isAutoBackupEnabled('false')).toBe(false);
  });

  it('runs once a day', () => {
    expect(isAutoBackupDue(undefined, NOW, undefined)).toBe(true);
    expect(isAutoBackupDue('2026-11-06T01:00:00Z', NOW, undefined)).toBe(false);
    expect(isAutoBackupDue('2026-11-05T11:59:00Z', NOW, undefined)).toBe(true);
    expect(isAutoBackupDue('garbage', NOW, undefined)).toBe(true);
    expect(isAutoBackupDue(undefined, NOW, 'false')).toBe(false);
  });

  it('prunes only automatic backups, keeping the newest', () => {
    const files = [
      { id: 'a1', description: AUTO_BACKUP_LABEL },
      { id: 'manual', description: 'Before moving phones' },
      { id: 'a2', description: AUTO_BACKUP_LABEL },
      { id: 'a3', description: AUTO_BACKUP_LABEL },
      { id: 'unlabelled' },
    ];
    expect(autoBackupsToPrune(files, 2)).toEqual(['a3']);
    expect(autoBackupsToPrune(files, 14)).toEqual([]);
  });
});

describe('backup frequency', () => {
  it('defaults to daily and reads the stored choice', () => {
    expect(autoBackupFrequency(undefined)).toBe('daily');
    expect(autoBackupFrequency('weekly')).toBe('weekly');
    expect(autoBackupFrequency('hourly')).toBe('daily');
  });

  it('waits a week, or a month, before the next one', () => {
    const twoDaysAgo = '2026-11-04T12:00:00Z';
    expect(isAutoBackupDue(twoDaysAgo, NOW, undefined, 'daily')).toBe(true);
    expect(isAutoBackupDue(twoDaysAgo, NOW, undefined, 'weekly')).toBe(false);
    expect(isAutoBackupDue('2026-10-30T12:00:00Z', NOW, undefined, 'weekly')).toBe(true);
    expect(isAutoBackupDue('2026-10-30T12:00:00Z', NOW, undefined, 'monthly')).toBe(false);
  });

  it('still prunes backups made under the old daily label', () => {
    expect(
      autoBackupsToPrune([{ id: 'old', description: 'Automatic daily backup' }], 0),
    ).toEqual(['old']);
  });
});
