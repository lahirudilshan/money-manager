/**
 * Garage visits: read an invoice with AI, and save / load / delete a visit
 * together with its bill lines and the schedule marks it makes.
 *
 * The pure rules are in logic/serviceVisit.ts.
 */

import { maintenanceMarkRepo, serviceItemRepo, vehicleServiceRepo } from '~/db/repositories';
import type { ServiceKind, Vehicle, VehicleService } from '~/db/schema';
import {
  detectPart,
  invoiceForm,
  invoiceFromForm,
  suggestItemKey,
  type DraftLine,
  type ReadInvoice,
} from '~/features/fuel/logic/serviceVisit';
import { aiFill } from '~/features/ai/services/aiFill';
import { vehicleItems, withMaintenanceCheck } from './maintenanceReminders';

/** Read an invoice photo into draft lines — AI is optional; see aiFill. */
export async function readInvoice(
  imageUri: string,
  vehicle: Vehicle,
): Promise<{ ok: true; invoice: ReadInvoice } | { ok: false; error: string }> {
  const result = await aiFill({
    form: invoiceForm(vehicleItems(vehicle)),
    documentKind: 'a vehicle service invoice, bill or job card',
    purpose: 'The form records a garage visit: what was done, what it cost, and the odometer.',
    rules: ['Do not add lines that are not on the bill, and never make up a price.'],
    context: `Vehicle: ${vehicle.kind.replace('_', '-')}, ${vehicle.fuelType}.`,
    fileUri: imageUri,
    live: {
      title: 'Reading your garage bill',
      subtitle: vehicle.name,
      expectedSeconds: 20,
      done: {
        title: `${vehicle.name}: bill read`,
        body: 'The parts, prices and odometer are filled in. Open Dayly to check them and save the visit.',
      },
      failed: {
        title: 'Could not read the bill',
        body: 'Open Dayly to try another photo, or type the lines in.',
      },
    },
  });
  if (!result.ok) return result;
  return invoiceFromForm(result.values, vehicle, vehicleItems(vehicle));
}

export interface VisitDraft {
  servicedAt: Date;
  odometer: number | null;
  kind: ServiceKind;
  title: string;
  costMinor: number | null;
  note: string | null;
  imageUri: string | null;
  lines: DraftLine[];
  /** Schedule items done on this visit without a bill line of their own. */
  extraKeys: string[];
}

/**
 * A stored visit as a draft, for editing.
 *
 * Lines saved before the schedule existed have no `itemKey`; they get the
 * name-match suggestion here, so an old "5W-30 x4" shows up already mapped to
 * the oil change and the user only has to correct the wrong ones.
 */
export function loadVisit(vehicle: Vehicle, service: VehicleService): VisitDraft {
  const items = vehicleItems(vehicle);
  const marks = maintenanceMarkRepo
    .byVehicle(vehicle.id)
    .filter((m) => m.serviceId === service.id && m.action === 'done');
  const markByKey = new Map(marks.map((m) => [m.itemKey, m]));

  const lines: DraftLine[] = serviceItemRepo.byService(service.id).map((row) => {
    const itemKey = row.itemKey ?? suggestItemKey(items, row.name);
    const mark = itemKey ? markByKey.get(itemKey) : undefined;
    const detected = detectPart(itemKey, vehicle.kind, vehicle.fuelType, row.name);
    return {
      name: row.name,
      quantity: row.quantity,
      unitPriceMinor: row.unitPriceMinor,
      kind: row.kind,
      itemKey,
      brand: mark?.brand ?? detected.brand,
      spec: mark?.spec ?? detected.spec,
    };
  });

  const lineKeys = new Set(lines.map((l) => l.itemKey));
  // An old visit with no lines: its title is all there is to match.
  const extraKeys =
    marks.length > 0
      ? marks.map((m) => m.itemKey).filter((k) => !lineKeys.has(k))
      : lines.length === 0
        ? items
            .filter((i) => i.match?.test(service.title) && !(i.notMatch?.test(service.title) ?? false))
            .map((i) => i.key)
        : [];

  return {
    servicedAt: service.servicedAt,
    odometer: service.odometer,
    kind: service.kind,
    title: service.title,
    costMinor: service.costMinor,
    note: service.note,
    imageUri: service.imageUri ?? null,
    lines,
    extraKeys,
  };
}

/**
 * Write a visit: the service row, its lines, and one schedule mark per
 * covered item (with the brand and grade from its line). Editing replaces the
 * lines and marks wholesale — a visit is small, and a diff would be a place
 * for the two to drift apart.
 */
export function saveVisit(vehicle: Vehicle, draft: VisitDraft, existingId?: string): VehicleService {
  return withMaintenanceCheck(vehicle, () => {
    const row = {
      vehicleId: vehicle.id,
      servicedAt: draft.servicedAt,
      odometer: draft.odometer,
      kind: draft.kind,
      title: draft.title,
      costMinor: draft.costMinor,
      note: draft.note,
      imageUri: draft.imageUri,
    };

    let service: VehicleService;
    if (existingId) {
      vehicleServiceRepo.update(existingId, row);
      service = { ...(vehicleServiceRepo.byVehicle(vehicle.id).find((s) => s.id === existingId)!) };
      serviceItemRepo.byService(existingId).forEach((item) => serviceItemRepo.remove(item.id));
      maintenanceMarkRepo
        .byVehicle(vehicle.id)
        .filter((m) => m.serviceId === existingId)
        .forEach((m) => maintenanceMarkRepo.remove(m.id));
    } else {
      service = vehicleServiceRepo.create(row);
    }

    draft.lines.forEach((line, index) =>
      serviceItemRepo.create({
        serviceId: service.id,
        name: line.name,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        kind: line.kind,
        itemKey: line.itemKey,
        sortOrder: index,
      }),
    );

    const done = new Map<string, { brand: string; spec: string }>();
    for (const line of draft.lines) {
      if (!line.itemKey) continue;
      const prev = done.get(line.itemKey);
      // The oil and the oil filter are both "engine oil"; keep whichever line named a brand.
      done.set(line.itemKey, {
        brand: prev?.brand || line.brand,
        spec: prev?.spec || line.spec,
      });
    }
    for (const key of draft.extraKeys) if (!done.has(key)) done.set(key, { brand: '', spec: '' });

    for (const [itemKey, part] of done) {
      maintenanceMarkRepo.create({
        vehicleId: vehicle.id,
        itemKey,
        action: 'done',
        doneAt: draft.servicedAt,
        odometer: draft.odometer,
        serviceId: service.id,
        brand: part.brand.trim() || null,
        spec: part.spec.trim() || null,
      });
    }
    return service;
  });
}

/** Delete a visit and the schedule marks it made. */
export function removeVisit(vehicle: Vehicle, serviceId: string): void {
  withMaintenanceCheck(vehicle, () => {
    maintenanceMarkRepo
      .byVehicle(vehicle.id)
      .filter((m) => m.serviceId === serviceId)
      .forEach((m) => maintenanceMarkRepo.remove(m.id));
    serviceItemRepo.byService(serviceId).forEach((item) => serviceItemRepo.remove(item.id));
    vehicleServiceRepo.remove(serviceId);
  });
}

/**
 * What each schedule item cost on its most recent bill — the parts lines
 * mapped to it (confirmed, or matched by name on older records). Feeds the
 * rough "about LKR 18,500 last time" on the next-services list.
 */
export function lastItemCosts(vehicle: Vehicle): Map<string, number> {
  const items = vehicleItems(vehicle);
  const services = vehicleServiceRepo.byVehicle(vehicle.id); // newest first
  const lines = serviceItemRepo.byServices(services.map((sv) => sv.id));
  const costs = new Map<string, number>();
  for (const service of services) {
    const perItem = new Map<string, number>();
    for (const line of lines.get(service.id) ?? []) {
      const key = line.itemKey ?? suggestItemKey(items, line.name);
      if (!key) continue;
      perItem.set(key, (perItem.get(key) ?? 0) + line.quantity * line.unitPriceMinor);
    }
    for (const [key, minor] of perItem) {
      if (!costs.has(key) && minor > 0) costs.set(key, Math.round(minor));
    }
  }
  return costs;
}

/**
 * Take one item off a visit without deleting the visit: its mark goes, and
 * the bill lines that counted as it now count as nothing — so the visit stays
 * confirmed and the name match does not quietly put it back.
 */
export function removeItemFromVisit(vehicle: Vehicle, serviceId: string, itemKey: string): void {
  withMaintenanceCheck(vehicle, () => {
    maintenanceMarkRepo
      .byVehicle(vehicle.id)
      .filter((m) => m.serviceId === serviceId && m.itemKey === itemKey)
      .forEach((m) => maintenanceMarkRepo.remove(m.id));
    const items = vehicleItems(vehicle);
    for (const line of serviceItemRepo.byService(serviceId)) {
      const key = line.itemKey ?? suggestItemKey(items, line.name);
      if (key === itemKey) serviceItemRepo.update(line.id, { itemKey: '' });
      else if (line.itemKey === null) serviceItemRepo.update(line.id, { itemKey: key });
    }
  });
}
