/**
 * The maintenance plan for a stored vehicle, and the reminders built from it.
 *
 * The glue between the repositories and the pure schedule in
 * logic/maintenance.ts — kept out of `logic/` because it reads the database.
 */

import {
  fuelEntryRepo,
  maintenanceMarkRepo,
  maintenanceOverrideRepo,
  serviceItemRepo,
  vehicleRepo,
  vehicleServiceRepo,
} from '~/db/repositories';
import type { Vehicle } from '~/db/schema';
import {
  maintenancePlan,
  newlyDue,
  vehicleSchedule,
  type MaintenanceItem,
  type MaintenancePlan,
  type ScheduleOverrideInput,
} from '~/features/fuel/logic/maintenance';
import { describePart } from '~/features/fuel/logic/maintenanceGuide';
import {
  notifyMaintenanceDue,
  syncMaintenanceReminders,
  type MaintenanceReminder,
} from '~/shared/lib/notifications';

/** This vehicle's schedule changes, in the shape the pure logic takes. */
export function vehicleOverrides(vehicle: Vehicle): ScheduleOverrideInput[] {
  return maintenanceOverrideRepo.byVehicle(vehicle.id);
}

/** Every schedule item for this vehicle — catalogue, overrides and custom items. */
export function vehicleItems(vehicle: Vehicle): MaintenanceItem[] {
  return vehicleSchedule(vehicle.kind, vehicle.fuelType, vehicleOverrides(vehicle), {
    km: vehicle.serviceIntervalKm,
    months: vehicle.serviceIntervalMonths,
  }).items;
}

/** The latest regular service with a reading — where the next one counts from. */
export function lastRegularService(vehicle: Vehicle): { odometer: number; date: Date } | null {
  const visit = vehicleServiceRepo
    .byVehicle(vehicle.id)
    .find((v) => v.kind === 'service' && v.odometer != null);
  return visit ? { odometer: visit.odometer!, date: visit.servicedAt } : null;
}

export function vehicleMaintenancePlan(vehicle: Vehicle, today = new Date()): MaintenancePlan {
  const services = vehicleServiceRepo.byVehicle(vehicle.id);
  const items = serviceItemRepo.byServices(services.map((s) => s.id));
  const marks = maintenanceMarkRepo.byVehicle(vehicle.id);
  const linked = new Set(marks.map((m) => m.serviceId).filter(Boolean));

  return maintenancePlan({
    vehicle,
    today,
    marks,
    overrides: vehicleOverrides(vehicle),
    services: services.map((s) => {
      const lines = items.get(s.id) ?? [];
      return {
        servicedAt: s.servicedAt,
        odometer: s.odometer,
        title: s.title,
        itemNames: lines.map((i) => i.name),
        confirmed: linked.has(s.id) || lines.some((l) => l.itemKey !== null),
      };
    }),
    readings: fuelEntryRepo
      .byVehicle(vehicle.id)
      .map((f) => ({ at: f.filledAt, odometer: f.odometer })),
  });
}

/** Rebuild the projected reminders for every vehicle. Never throws. */
export async function syncAllMaintenanceReminders(vehicles: readonly Vehicle[]): Promise<void> {
  try {
    const reminders: MaintenanceReminder[] = [];
    for (const vehicle of vehicles) {
      if (!vehicle.isActive) continue;
      for (const entry of vehicleMaintenancePlan(vehicle).items) {
        // Already due is announced when it happens and shown in the app; only
        // what is still ahead gets a scheduled reminder.
        if (entry.status !== 'ok' || !entry.expectedDate) continue;
        reminders.push({
          vehicleId: vehicle.id,
          itemKey: entry.item.key,
          vehicleName: vehicle.name,
          itemTitle: entry.item.title,
          lastPart: entry.lastDone
            ? (describePart(entry.lastDone) ?? entry.lastDone.partName ?? null)
            : null,
          expectedDate: entry.expectedDate,
        });
      }
    }
    await syncMaintenanceReminders(reminders);
  } catch (error) {
    console.warn('Maintenance reminder sync skipped:', error);
  }
}

/**
 * Run a write that may move the odometer, then announce what it made due.
 *
 * `write` is the fill-up (or service) save itself, so the before/after plans
 * bracket exactly the change the user just made.
 */
export function withMaintenanceCheck<T>(vehicle: Vehicle, write: () => T): T {
  let before: MaintenancePlan | null = null;
  try {
    before = vehicleMaintenancePlan(vehicle);
  } catch (error) {
    console.warn('Maintenance check skipped:', error);
  }

  const result = write();

  if (before) {
    try {
      const due = newlyDue(before, vehicleMaintenancePlan(vehicle));
      void notifyMaintenanceDue(
        vehicle.id,
        vehicle.name,
        due.map((e) => ({ title: e.item.title, overdue: e.status === 'overdue' })),
      );
    } catch (error) {
      console.warn('Maintenance check skipped:', error);
    }
  }
  // The projected dates moved with the odometer (or the work just done).
  void syncAllMaintenanceReminders(vehicleRepo.all());
  return result;
}
