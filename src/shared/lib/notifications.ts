import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { formatMoney } from '~/shared/lib/money';

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

  /*
   * Cancel only the FUNDING reminders, not everything.
   *
   * This used to cancel every scheduled notification, which was fine while
   * funding was the only kind. Maintenance reminders share the queue now, and
   * a launch-time funding rebuild silently wiped them all.
   */
  await cancelScheduled(Notifications, (id) => !id.startsWith(MAINTENANCE_PREFIX));

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

const MAINTENANCE_PREFIX = 'maint:';

async function cancelScheduled(
  Notifications: NotificationsModule,
  keep: (identifier: string) => boolean,
): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => keep(request.identifier))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}

export interface MaintenanceReminder {
  vehicleId: string;
  itemKey: string;
  vehicleName: string;
  itemTitle: string;
  /** What was fitted last time ("Mobil · 0W-20"), so the reminder doubles as a shopping note. */
  lastPart?: string | null;
  /** When it is expected to fall due — the reminder fires `daysBefore` ahead. */
  expectedDate: Date;
}

/**
 * Rebuild the vehicle-maintenance reminders.
 *
 * Mileage is only known when the user logs it, so a reminder for "oil due at
 * 15,000 km" is scheduled for the DATE that reading is expected on, at the
 * vehicle's usual daily distance (see features/fuel/logic/maintenance.ts). A
 * rebuild after every fill-up keeps that projection current.
 *
 * Never asks for permission: this runs at launch and after a fill-up, and a
 * prompt the user did not initiate is worse than a reminder they did not get.
 * The settings screen is where permission is requested.
 */
export async function syncMaintenanceReminders(
  reminders: readonly MaintenanceReminder[],
  daysBefore = 3,
): Promise<number> {
  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return 0;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return 0;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('maintenance-reminders', {
        name: 'Vehicle maintenance',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    await cancelScheduled(Notifications, (id) => id.startsWith(MAINTENANCE_PREFIX));

    const now = Date.now();
    // iOS keeps at most 64 pending notifications across the whole app, and
    // funding reminders need room too — the nearest 30 are the ones that matter.
    const upcoming = reminders
      .map((r) => {
        const fireAt = new Date(r.expectedDate.getTime() - daysBefore * 86_400_000);
        fireAt.setHours(9, 0, 0, 0);
        return { ...r, fireAt };
      })
      .filter((r) => r.fireAt.getTime() > now)
      .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
      .slice(0, 30);

    for (const r of upcoming) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${MAINTENANCE_PREFIX}${r.vehicleId}:${r.itemKey}`,
        content: {
          title: `${r.vehicleName}: ${r.itemTitle} due soon`,
          body: r.lastPart
            ? `Expected in a few days at your usual driving. Last time: ${r.lastPart}.`
            : 'Expected in a few days at your usual driving. Tap to see the schedule.',
          data: { route: `/mini/fuel/maintenance?vehicle=${r.vehicleId}` },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: r.fireAt,
          channelId: 'maintenance-reminders',
        },
      });
    }
    return upcoming.length;
  } catch (error) {
    lastFailureReason = String(error);
    return 0;
  }
}

/**
 * Announce items that a fill-up just pushed into "due soon" or "overdue".
 *
 * Delivered now — the odometer reading that made them due has just been
 * typed. One notification per vehicle, not per item: an overdue 10,000 km
 * service crosses five items at once, and five banners for one visit to the
 * garage is noise.
 */
export async function notifyMaintenanceDue(
  vehicleId: string,
  vehicleName: string,
  items: readonly { title: string; overdue: boolean }[],
): Promise<void> {
  if (items.length === 0) return;
  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;

    const overdue = items.filter((i) => i.overdue).length;
    const names = items.map((i) => i.title);
    const body =
      names.length <= 2
        ? names.join(' and ')
        : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title:
          overdue > 0
            ? `${vehicleName}: maintenance overdue`
            : `${vehicleName}: maintenance due soon`,
        body,
        data: { route: `/mini/fuel/maintenance?vehicle=${vehicleId}` },
      },
      trigger: null,
    });
  } catch (error) {
    lastFailureReason = String(error);
  }
}

/**
 * "Your invoice is read" — a job the user started, finished while they were
 * in another app or had the phone locked. Delivered now; never asks for
 * permission (a finished job is no moment to interrupt with a system prompt).
 */
export async function notifyWorkDone(input: {
  title: string;
  body: string;
  /** Opened on tap; omit to just bring the app back where it was. */
  route?: string;
}): Promise<void> {
  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        data: input.route ? { route: input.route } : {},
      },
      trigger: null,
    });
  } catch (error) {
    lastFailureReason = String(error);
  }
}

export async function cancelAllReminders(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Tell the user that bank messages just became drafts.
 *
 * This is the answer to "how do I know something arrived while the app was
 * closed". iOS suspends the app in the background, so nothing can watch the
 * file then — but the import happens the moment the app is reopened, and this
 * fires right after it, so returning to the app is never silent.
 *
 * Fires ONLY when rows were actually queued. A notification for an empty drain
 * would train the user to ignore them, which is worse than not sending one.
 *
 * `null` trigger means "deliver now" rather than schedule — this reports
 * something that has already happened.
 *
 * Never throws: an import must not fail because a notification could not be
 * shown, and permission may simply have been declined.
 */
export async function notifyDraftsImported(count: number): Promise<void> {
  if (count <= 0) return;

  try {
    const Notifications = await loadNotifications();
    if (!Notifications) return;

    // Silent when permission was never granted — asking here would interrupt
    // whatever the user is doing with a prompt they did not initiate.
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: count === 1 ? 'New transaction to review' : `${count} transactions to review`,
        body:
          count === 1
            ? 'A bank message was turned into a draft. Tap to confirm it.'
            : 'Bank messages were turned into drafts. Tap to confirm them.',
        data: { route: '/' },
      },
      trigger: null,
    });
  } catch (error) {
    lastFailureReason = String(error);
  }
}


/**
 * Follow a tapped notification's `data.route`.
 *
 * Loaded lazily for the same Expo Go reason as everything else here, so the
 * listener is attached once the module resolves. Returns an unsubscribe.
 */
export function onNotificationRoute(navigate: (route: string) => void): () => void {
  let remove: (() => void) | null = null;
  let cancelled = false;

  void loadNotifications().then((Notifications) => {
    if (!Notifications || cancelled) return;
    const follow = (response: { notification: { request: { content: { data?: unknown } } } }) => {
      const data = response.notification.request.content.data as { route?: unknown } | undefined;
      if (typeof data?.route === 'string' && data.route.startsWith('/')) navigate(data.route);
    };
    // A tap that launched the app from cold arrives before any listener exists.
    void Notifications.getLastNotificationResponseAsync()
      .then((last) => {
        if (last && !cancelled) follow(last);
      })
      .catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(follow);
    remove = () => subscription.remove();
  });

  return () => {
    cancelled = true;
    remove?.();
  };
}
