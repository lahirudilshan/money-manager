import { describe, expect, it, vi } from 'vitest';

/**
 * Inverse of the Expo Go guard: on a platform where the module is safe to
 * import, the service must actually load and use it. Without this, a guard
 * that disabled notifications everywhere would still pass the guard test.
 */

vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'storeClient' },
  ExecutionEnvironment: {
    StoreClient: 'storeClient',
    Bare: 'bare',
    Standalone: 'standalone',
  },
}));

// Expo Go, but iOS — the import is safe here.
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const scheduleNotificationAsync = vi.fn().mockResolvedValue('id');
const cancelAllScheduledNotificationsAsync = vi.fn().mockResolvedValue(undefined);
const setNotificationHandler = vi.fn();

vi.mock('expo-notifications', () => ({
  setNotificationHandler,
  getPermissionsAsync: vi.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  requestPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  setNotificationChannelAsync: vi.fn().mockResolvedValue(undefined),
  cancelAllScheduledNotificationsAsync,
  scheduleNotificationAsync,
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

describe('supported platform', () => {
  it('loads the module and schedules a reminder', async () => {
    const mod = await import('../notifications');

    expect(mod.notificationsSupported).toBe(true);
    expect(mod.unavailableReason()).toBeNull();

    const count = await mod.syncCategoryReminders([
      { categoryId: 'g1', categoryName: 'Home Expenses', shortfallMinor: 6_000_000, dueDay: 5 },
    ], 2);

    expect(count).toBe(1);
    expect(setNotificationHandler).toHaveBeenCalled();
    expect(cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // The reminder must carry the transaction id so tapping it can deep-link.
    const payload = scheduleNotificationAsync.mock.calls[0][0];
    expect(payload.content.data).toEqual({ categoryId: 'g1' });
    expect(payload.trigger.type).toBe('date');
  });
});
