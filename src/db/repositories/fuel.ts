/** Fuel mini-app: vehicles, fill-ups and servicing. */

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '~/db/client';
import {
  fuelEntries,
  healthPeople,
  maintenanceMarks,
  maintenanceOverrides,
  serviceItems,
  vehicleServices,
  vehicles,
  type FuelEntry,
  type MaintenanceMark,
  type MaintenanceOverride,
  type NewMaintenanceOverride,
  type NewFuelEntry,
  type NewMaintenanceMark,
  type NewServiceItem,
  type NewVehicle,
  type NewVehicleService,
  type ServiceItem,
  type Vehicle,
  type VehicleService,
} from '~/db/schema';
import { createId, now } from './internal';

/** Vehicles for the fuel mini-app. Empty on a device that never enables it. */
export const vehicleRepo = {
  all(): Vehicle[] {
    return db
      .select()
      .from(vehicles)
      .orderBy(asc(vehicles.sortOrder), asc(vehicles.createdAt))
      .all();
  },

  create(input: Omit<NewVehicle, 'id'> & { id?: string }): Vehicle {
    return db
      .insert(vehicles)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewVehicle>): void {
    db.update(vehicles)
      .set({ ...patch, updatedAt: now() })
      .where(eq(vehicles.id, id))
      .run();
  },

  /** Cascades to the vehicle's fill-ups and services — see the schema. */
  remove(id: string): void {
    db.delete(vehicles).where(eq(vehicles.id, id)).run();
  },
};

export const fuelEntryRepo = {
  /**
   * A vehicle's fill-ups, ordered by ODOMETER.
   *
   * That is the order consumption is measured in: a receipt entered late has a
   * truthful reading and a misleading timestamp. See core/fuel.ts.
   */
  byVehicle(vehicleId: string): FuelEntry[] {
    return db
      .select()
      .from(fuelEntries)
      .where(eq(fuelEntries.vehicleId, vehicleId))
      .orderBy(asc(fuelEntries.odometer), asc(fuelEntries.filledAt))
      .all();
  },

  /** One fill-up, for the screen that edits it. */
  byId(id: string): FuelEntry | null {
    return db.select().from(fuelEntries).where(eq(fuelEntries.id, id)).get() ?? null;
  },

  create(input: Omit<NewFuelEntry, 'id'> & { id?: string }): FuelEntry {
    return db
      .insert(fuelEntries)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewFuelEntry>): void {
    db.update(fuelEntries)
      .set({ ...patch, updatedAt: now() })
      .where(eq(fuelEntries.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(fuelEntries).where(eq(fuelEntries.id, id)).run();
  },
};

export const vehicleServiceRepo = {
  /** Newest first — a service log is read as history, not as a route. */
  byVehicle(vehicleId: string): VehicleService[] {
    return db
      .select()
      .from(vehicleServices)
      .where(eq(vehicleServices.vehicleId, vehicleId))
      .orderBy(desc(vehicleServices.servicedAt))
      .all();
  },

  create(input: Omit<NewVehicleService, 'id'> & { id?: string }): VehicleService {
    return db
      .insert(vehicleServices)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewVehicleService>): void {
    db.update(vehicleServices)
      .set({ ...patch, updatedAt: now() })
      .where(eq(vehicleServices.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(vehicleServices).where(eq(vehicleServices.id, id)).run();
  },
};

/**
 * The parts, fluids and labour on one service bill.
 *
 * Kept apart from `vehicleServices.costMinor`, which stays the authoritative
 * total: a real invoice carries tax and discounts the lines do not sum to, so
 * the two are allowed to differ and the UI says so rather than silently
 * overwriting what the user typed.
 */
export const serviceItemRepo = {
  byService(serviceId: string): ServiceItem[] {
    return db
      .select()
      .from(serviceItems)
      .where(eq(serviceItems.serviceId, serviceId))
      .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.createdAt))
      .all();
  },

  /** Every item for a set of services, grouped — one query for a whole list. */
  byServices(serviceIds: readonly string[]): Map<string, ServiceItem[]> {
    if (serviceIds.length === 0) return new Map();

    const rows = db
      .select()
      .from(serviceItems)
      .where(inArray(serviceItems.serviceId, [...serviceIds]))
      .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.createdAt))
      .all();

    const grouped = new Map<string, ServiceItem[]>();
    for (const row of rows) {
      const list = grouped.get(row.serviceId) ?? [];
      list.push(row);
      grouped.set(row.serviceId, list);
    }
    return grouped;
  },

  create(input: Omit<NewServiceItem, 'id'> & { id?: string }): ServiceItem {
    return db
      .insert(serviceItems)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewServiceItem>): void {
    db.update(serviceItems)
      .set({ ...patch, updatedAt: now() })
      .where(eq(serviceItems.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(serviceItems).where(eq(serviceItems.id, id)).run();
  },
};

/**
 * "Done here" / "does not apply" facts against the maintenance schedule — see
 * `maintenanceMarks` in the schema and features/fuel/logic/maintenance.ts.
 */
export const maintenanceMarkRepo = {
  byVehicle(vehicleId: string): MaintenanceMark[] {
    return db
      .select()
      .from(maintenanceMarks)
      .where(eq(maintenanceMarks.vehicleId, vehicleId))
      .orderBy(desc(maintenanceMarks.doneAt))
      .all();
  },

  create(input: Omit<NewMaintenanceMark, 'id'> & { id?: string }): MaintenanceMark {
    return db
      .insert(maintenanceMarks)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  remove(id: string): void {
    db.delete(maintenanceMarks).where(eq(maintenanceMarks.id, id)).run();
  },
};

/** This vehicle's own changes to the maintenance schedule — see `maintenanceOverrides`. */
export const maintenanceOverrideRepo = {
  byVehicle(vehicleId: string): MaintenanceOverride[] {
    return db
      .select()
      .from(maintenanceOverrides)
      .where(eq(maintenanceOverrides.vehicleId, vehicleId))
      .all();
  },

  /** One row per item: replaces whatever was there for this key. */
  put(
    vehicleId: string,
    itemKey: string,
    values: Omit<NewMaintenanceOverride, 'id' | 'vehicleId' | 'itemKey'>,
  ): void {
    db.delete(maintenanceOverrides)
      .where(and(eq(maintenanceOverrides.vehicleId, vehicleId), eq(maintenanceOverrides.itemKey, itemKey)))
      .run();
    db.insert(maintenanceOverrides)
      .values({ ...values, id: createId(), vehicleId, itemKey })
      .run();
  },

  remove(vehicleId: string, itemKey: string): void {
    db.delete(maintenanceOverrides)
      .where(and(eq(maintenanceOverrides.vehicleId, vehicleId), eq(maintenanceOverrides.itemKey, itemKey)))
      .run();
  },

  /** Back to Dayly's defaults for this vehicle. */
  clear(vehicleId: string): void {
    db.delete(maintenanceOverrides).where(eq(maintenanceOverrides.vehicleId, vehicleId)).run();
  },
};

/*
 * ---------------------------------------------------------------------------
 * Health mini-app — see core/miniApps.ts. Opt-in; these tables stay empty on a
 * device that never enables it.
 * ---------------------------------------------------------------------------
 */

/**
 * Release whoever currently holds "self", relation included.
 *
 * Clearing only the flag would leave the previous holder still labelled
 * "Myself" in the list — two people answering the same question. Their relation
 * is nulled rather than guessed at: the app cannot know whether the person who
 * used to be you is now a spouse or a sibling, and an unset relation simply
 * shows no subtitle (see `relationLabel`).
 *
 * Takes the transaction so every caller runs inside one — claiming self and
 * releasing it are halves of the same write.
 */
function clearSelf(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): void {
  tx.update(healthPeople)
    .set({ isSelf: false, relation: null, updatedAt: now() })
    .where(eq(healthPeople.isSelf, true))
    .run();
}
