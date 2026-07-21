import { describe, expect, it, vi } from 'vitest';

/**
 * A prebuilt/dev Android build must NOT be treated as Expo Go.
 *
 * expo-constants' native Android implementation (ConstantsService.kt) reports
 * `executionEnvironment: "bare"` for a prebuilt app, so the Expo Go guard must
 * not fire here — otherwise the dev build the user made specifically to get
 * reminders would silently have them disabled.
 */

vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'bare' },
  ExecutionEnvironment: {
    StoreClient: 'storeClient',
    Bare: 'bare',
    Standalone: 'standalone',
  },
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const scheduleNotificationAsync = vi.fn().mockResolvedValue('id');
const setNotificationChannelAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  getPermissionsAsync: vi.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  requestPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  setNotificationChannelAsync,
  cancelAllScheduledNotificationsAsync: vi.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync,
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

describe('Android development build', () => {
  it('is not treated as Expo Go and schedules reminders', async () => {
    const mod = await import('../notifications');

    expect(mod.isExpoGo).toBe(false);
    expect(mod.notificationsSupported).toBe(true);
    expect(mod.unavailableReason()).toBeNull();

    const count = await mod.syncCategoryReminders([
      { categoryId: 'g1', categoryName: 'Home Expenses', shortfallMinor: 6_000_000, dueDay: 5 },
    ], 2);
    expect(count).toBe(1);

    // Android requires a channel before notifications are delivered.
    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      'funding-reminders',
      expect.objectContaining({ name: 'Funding reminders' }),
    );
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});
