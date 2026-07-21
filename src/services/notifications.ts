import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { formatMoney } from '../core/money';

/**
 * Local reminders for categories that still need funding.
 *
 * On Android in Expo Go the `expo-notifications` import itself throws: its
 * entry point re-exports `getExpoPushTokenAsync`, which transitively evaluates
 * `DevicePushTokenAutoRegistration.fx.js`, and that module calls
 * `addPushTokenListener()` at global scope — removed from Expo Go in SDK 53.
 * No try/catch around a static import can prevent it, so the module must never
 * be requested on that platform. Everything here degrades to a no-op instead.
 */

export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const notificationsSupported = !(isExpoGo && Platform.OS === 'android');

let lastFailureReason: string | null = null;

/** Human-readable reason reminders will not fire, or null when they work. */
export function unavailableReason(): string | null {
  if (!notificationsSupported) {
    return 'Expo Go on Android cannot schedule reminders. Run a development build (npx expo run:android) to enable them.';
  }
  return lastFailureReason;
}

type NotificationsModule = typeof import('expo-notifications');

let modulePromise: Promise<NotificationsModule | null> | null = null;
let handlerConfigured = false;

async function loadNotifications(): Promise<NotificationsModule | null> {
  // Must bail out before the import() below — see the note above.
  if (!notificationsSupported) return null;

  if (!modulePromise) {
    modulePromise = import('expo-notifications')
      .then((module) => {
        // Configured here rather than at module scope so a throw cannot take
        // down the route tree at import time.
        if (!handlerConfigured) {
          module.setNotificationHandler({
            handleNotification: async () => ({
              shouldShowBanner: true,
              shouldShowList: true,
              shouldPlaySound: false,
              shouldSetBadge: true,
            }),
          });
          handlerConfigured = true;
        }
        return module;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('expo-notifications unavailable:', message);
        lastFailureReason = 'Reminders are unavailable on this device.';
        return null;
      });
  }

  return modulePromise;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export interface CategoryReminder {
  categoryId: string;
  categoryName: string;
  /** Amount still to transfer. */
  shortfallMinor: number;
  /** Day of the month the category is normally funded. */
  dueDay: number;
}

/**
 * Rebuild the reminder schedule from categories that are not yet fully funded.
 *
 * Cancels everything first rather than diffing: the schedule is small, and a
 * rebuild cannot drift out of sync with the plan the way an incremental update
 * can. Returns the number scheduled — 0 when unsupported.
 */
export async function syncCategoryReminders(
  reminders: readonly CategoryReminder[],
  daysBefore = 2,
): Promise<number> {
  const Notifications = await loadNotifications();
  if (!Notifications) return 0;

  const granted = await requestNotificationPermission();
  if (!granted) {
    lastFailureReason = 'Notification permission was declined.';
    return 0;
  }

  try {
    return await scheduleAll(Notifications, reminders, daysBefore);
  } catch (error: unknown) {
    // Scheduling can fail on OEM builds that restrict background alarms.
    const message = error instanceof Error ? error.message : String(error);
    console.warn('Reminder scheduling failed:', message);
    lastFailureReason = 'Reminders could not be scheduled on this device.';
    return 0;
  }
}

async function scheduleAll(
  Notifications: NotificationsModule,
  reminders: readonly CategoryReminder[],
  daysBefore: number,
): Promise<number> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('funding-reminders', {
      name: 'Funding reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  let scheduled = 0;

  for (const reminder of reminders) {
    if (reminder.shortfallMinor <= 0) continue;

    const fireAt = nextFireDate(reminder.dueDay, daysBefore, now);
    if (fireAt.getTime() <= now.getTime()) continue;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${reminder.categoryName} needs funding`,
        body: `${formatMoney(reminder.shortfallMinor)} still to transfer`,
        data: { categoryId: reminder.categoryId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId: 'funding-reminders',
      },
    });
    scheduled += 1;
  }

  return scheduled;
}

/**
 * The next time this category's reminder should fire: `daysBefore` ahead of
 * its due day, rolling into next month once this month's slot has passed.
 * The day is clamped so a due day of 31 still works in February.
 */
function nextFireDate(dueDay: number, daysBefore: number, from: Date): Date {
  const build = (year: number, month: number) => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const date = new Date(year, month, Math.min(dueDay, daysInMonth));
    date.setDate(date.getDate() - daysBefore);
    date.setHours(9, 0, 0, 0);
    return date;
  };

  const thisMonth = build(from.getFullYear(), from.getMonth());
  if (thisMonth.getTime() > from.getTime()) return thisMonth;
  return build(from.getFullYear(), from.getMonth() + 1);
}

export async function cancelAllReminders(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
