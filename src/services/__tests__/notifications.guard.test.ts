import { describe, expect, it, vi } from 'vitest';

// Simulate Expo Go on Android: the module must never be requested.
vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'storeClient' },
  ExecutionEnvironment: { StoreClient: 'storeClient', Bare: 'bare', Standalone: 'standalone' },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const importSpy = vi.fn();
vi.mock('expo-notifications', () => {
  importSpy();
  throw new Error('expo-notifications: removed from Expo Go (simulated)');
});

describe('Expo Go Android guard', () => {
  it('never imports expo-notifications, and syncReminders resolves to 0', async () => {
    const mod = await import('../notifications');
    expect(mod.notificationsSupported).toBe(false);
    await expect(mod.syncCategoryReminders([
      { categoryId: 'g1', categoryName: 'Home Expenses', shortfallMinor: 6_000_000, dueDay: 5 },
    ])).resolves.toBe(0);
    await expect(mod.cancelAllReminders()).resolves.toBeUndefined();
    expect(importSpy).not.toHaveBeenCalled();
    expect(mod.unavailableReason()).toContain('development build');
  });
});
