/**
 * A garage visit, as the user edits it: the bill lines, which schedule item
 * each one counts as, and what else was done without a line of its own.
 *
 * One visit answers both questions the old split screens asked separately —
 * "what did I spend" (the service log) and "what is due" (the schedule). The
 * link between them is `itemKey` on each line, confirmed by the user, plus a
 * `maintenance_marks` row per covered item carrying the brand and grade.
 *
 * Pure: the screen and services/serviceVisits.ts do the I/O.
 */

import type { FuelType, ServiceKind, VehicleKind } from '~/db/schema';
import { scheduleFor, serviceCovers, type MaintenanceItem } from './maintenance';
import { partFor } from './maintenanceGuide';
import { field, type FormValues } from '~/features/ai/logic/aiForm';

export type LineKind = 'part' | 'fluid' | 'labour' | 'other';

export interface DraftLine {
  name: string;
  quantity: number;
  unitPriceMinor: number;
  kind: LineKind;
  /** The schedule item this line counts as; '' = not on the schedule. */
  itemKey: string;
  brand: string;
  spec: string;
}

/** The best schedule item for a bill line, by its name — '' when none fits. */
export function suggestItemKey(items: readonly MaintenanceItem[], name: string): string {
  const probe = { servicedAt: new Date(0), title: '', itemNames: [name] };
  return items.find((item) => serviceCovers(item, probe))?.key ?? '';
}

/**
 * The brand and grade named in a line, from that item's suggestion lists —
 * "Mobil Super 5W-30 4L" gives Mobil / 5W-30.
 */
export function detectPart(
  key: string,
  kind: VehicleKind,
  fuel: FuelType,
  text: string,
): { brand: string; spec: string } {
  const parts = key ? partFor(key, kind, fuel) : null;
  if (!parts) return { brand: '', spec: '' };
  const lower = text.toLowerCase();
  const brand =
    parts.brands.find((b) => {
      const word = b.replace(/\s*\(.*\)$/, '').toLowerCase();
      return word.length > 1 && lower.includes(word);
    }) ?? '';
  const compact = lower.replace(/[\s-]/g, '');
  const spec =
    parts.specs.find((s) => {
      const bare = s.replace(/\s*\(.*\)$/, '').toLowerCase().replace(/[\s-]/g, '');
      return bare.length > 1 && compact.includes(bare);
    }) ?? '';
  return { brand: brand.startsWith('Genuine') && !/genuine/i.test(text) ? '' : brand, spec };
}

/** The schedule keys a visit covers: its mapped lines plus the extra ticks. */
export function coveredKeys(lines: readonly DraftLine[], extra: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const line of lines) if (line.itemKey) keys.add(line.itemKey);
  for (const key of extra) if (key) keys.add(key);
  return [...keys];
}

/**
 * A title written from what the visit is — how a garage would name it.
 *
 *   "48,000 km service · engine oil, oil filter, air filter"
 *   "Repair · radiator fan motor"           (no schedule item: the bill's own lines)
 *   "New tyres · Bridgestone 175/65 R15"    (tyres: the brand and size)
 *   "Insurance renewal" / "Licence renewal"
 *
 * A service is named by the odometer rounded to the thousand, the way dealers
 * name the 5,000 / 10,000 km services; anything else by its kind.
 */
export function autoTitle(
  kind: ServiceKind,
  covered: readonly MaintenanceItem[],
  extra: {
    odometer?: number | null;
    /** The vehicle's service interval: "10,000 km service" rounds to it. */
    serviceKm?: number | null;
    /** The bill's lines, for a visit with nothing on the schedule. */
    lines?: readonly { name: string; kind?: LineKind; brand?: string; spec?: string; itemKey?: string }[];
  } = {},
): string {
  if (kind === 'insurance') return 'Insurance renewal';
  if (kind === 'licence') return 'Licence renewal';

  const lines = (extra.lines ?? []).filter((l) => l.name.trim());
  const roundTo = extra.serviceKm && extra.serviceKm >= 1_000 ? extra.serviceKm : 1_000;
  const odo =
    extra.odometer != null && extra.odometer > 0
      ? Math.max(roundTo, Math.round(extra.odometer / roundTo) * roundTo)
      : null;
  const base =
    kind === 'repair'
      ? 'Repair'
      : kind === 'tyres'
        ? 'New tyres'
        : kind === 'other'
          ? 'Vehicle work'
          : odo
            ? `${odo.toLocaleString()} km service`
            : 'Service';

  if (kind === 'tyres') {
    const tyre = lines.find((l) => l.itemKey === 'tyres') ?? lines.find((l) => /tyre|tire/i.test(l.name));
    const part = [tyre?.brand, tyre?.spec].filter(Boolean).join(' ');
    return part ? `${base} · ${part}` : base;
  }

  const shorten = (items: string[]) =>
    items.length <= 3 ? items.join(', ') : `${items.slice(0, 2).join(', ')} +${items.length - 2} more`;

  if (covered.length > 0) {
    // Inspections are part of any service; name what was DONE when there is any.
    const done = covered.filter((i) => i.action !== 'inspect');
    const shown = (done.length > 0 ? done : covered).map((i) =>
      i.title.replace(/ change$/i, '').replace(/ \(.*\)$/, '').toLowerCase(),
    );
    return `${base} · ${shorten(shown)}`;
  }

  const named = lines
    .filter((l) => l.kind !== 'labour' && l.kind !== 'other')
    .map((l) => l.name.trim().toLowerCase());
  return named.length > 0 ? `${base} · ${shorten(named)}` : base;
}

/* ------------------------------------------------------------------ invoice */

/**
 * The form AI fills from an invoice photo.
 *
 * `itemKey` is a CHOICE of this vehicle's own schedule keys, so the schema
 * itself stops the model inventing one; the descriptions are the instructions.
 */
export function invoiceForm(items: readonly MaintenanceItem[]) {
  return {
    garage: field.text('The garage or dealer name printed at the top.'),
    date: field.date('The invoice or job date.'),
    odometer: field.number(
      'The vehicle mileage on the job card — often labelled Mileage, ODO, KM or Meter. Not a phone, invoice or vehicle number.',
      { min: 1, max: 2_000_000 },
    ),
    total: field.number('The final amount paid, after tax and discount.', { min: 0 }),
    lines: field.list('Every billed line: parts, oils and fluids, labour and other charges.', {
      name: field.text('The line as written, short. Translate Sinhala or Tamil to English.'),
      quantity: field.number('How many, if shown.', { min: 0 }),
      unitPrice: field.number('Price for one, if shown.', { min: 0 }),
      lineTotal: field.number('The amount for the whole line, if shown.', { min: 0 }),
      kind: field.choice('What the line is.', ['part', 'fluid', 'labour', 'other'] as const),
      itemKey: field.choice(
        `Which maintenance job this line is. ${items.map((i) => `${i.key} = ${i.title}`).join('; ')}. The oil is engine_oil and the oil filter is oil_filter (when the vehicle has one). Labour, washing, tax and anything else: null.`,
        items.map((i) => i.key),
      ),
      brand: field.text('The maker if written: Mobil, Castrol, NGK, Denso, Toyota genuine…'),
      spec: field.text('The grade, size or type if written: 5W-30, DOT 4, 175/65 R15, NS60, iridium.'),
    }),
  } as const;
}

export type InvoiceValues = FormValues<ReturnType<typeof invoiceForm>>;

export interface ReadInvoice {
  garage: string | null;
  date: Date | null;
  odometer: number | null;
  totalMinor: number | null;
  lines: DraftLine[];
}

/**
 * The filled form, turned into draft lines. A line with no item the model
 * was sure of falls back to the name match; a brand or grade it missed falls
 * back to what the line's own text names.
 */
export function invoiceFromForm(
  values: InvoiceValues,
  vehicle: { kind: VehicleKind; fuelType: FuelType },
  items: readonly MaintenanceItem[] = scheduleFor(vehicle.kind, vehicle.fuelType),
): { ok: true; invoice: ReadInvoice } | { ok: false; error: string } {
  const lines: DraftLine[] = [];
  for (const line of values.lines) {
    if (!line.name) continue;
    const quantity = line.quantity && line.quantity > 0 ? line.quantity : 1;
    const unit = line.unitPrice ?? (line.lineTotal != null ? line.lineTotal / quantity : 0);
    const itemKey = line.itemKey ?? suggestItemKey(items, line.name);
    const detected = detectPart(itemKey, vehicle.kind, vehicle.fuelType, line.name);
    lines.push({
      name: line.name,
      quantity,
      unitPriceMinor: Math.round(unit * 100),
      kind: line.kind ?? 'part',
      itemKey,
      brand: line.brand ?? detected.brand,
      spec: line.spec ?? detected.spec,
    });
  }
  if (lines.length === 0 && values.total == null) {
    return { ok: false, error: 'No lines could be read from that photo. Try a clearer, flatter shot.' };
  }
  return {
    ok: true,
    invoice: {
      garage: values.garage,
      date: values.date,
      odometer: values.odometer,
      totalMinor: values.total != null && values.total > 0 ? Math.round(values.total * 100) : null,
      lines,
    },
  };
}

/* ------------------------------------------------------------------ history */

export interface HistoryVisit {
  type: 'visit';
  id: string;
  at: Date;
  odometer: number | null;
  title: string;
  kind: ServiceKind;
  costMinor: number | null;
  /** Schedule items this visit counted as done. */
  covered: MaintenanceItem[];
  lineCount: number;
  hasInvoice: boolean;
}

export interface HistoryMark {
  type: 'mark';
  id: string;
  at: Date;
  odometer: number | null;
  item: MaintenanceItem;
  part: string | null;
}

export type HistoryEntry = HistoryVisit | HistoryMark;

/**
 * One timeline: garage visits and things marked done on their own, newest
 * first. A mark made BY a visit is part of that visit, not a second entry.
 */
export function maintenanceHistory(input: {
  kind: VehicleKind;
  fuelType: FuelType;
  services: readonly {
    id: string;
    servicedAt: Date;
    odometer: number | null;
    title: string;
    kind: ServiceKind;
    costMinor: number | null;
    imageUri?: string | null;
    lines: readonly { name: string; itemKey: string | null }[];
  }[];
  marks: readonly {
    id: string;
    itemKey: string;
    action: 'done' | 'not_applicable';
    doneAt: Date;
    odometer: number | null;
    serviceId: string | null;
    brand?: string | null;
    spec?: string | null;
  }[];
  /** The vehicle's own schedule, when it has custom items. */
  items?: readonly MaintenanceItem[];
}): HistoryEntry[] {
  const items = input.items ?? scheduleFor(input.kind, input.fuelType);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const entries: HistoryEntry[] = [];

  for (const s of input.services) {
    const linked = input.marks.filter((m) => m.serviceId === s.id && m.action === 'done');
    const confirmed = linked.length > 0 || s.lines.some((l) => l.itemKey !== null);
    const covered = confirmed
      ? [...new Set([...linked.map((m) => m.itemKey), ...s.lines.map((l) => l.itemKey ?? '')])]
          .map((k) => byKey.get(k))
          .filter((i): i is MaintenanceItem => !!i)
      : items.filter((i) =>
          serviceCovers(i, { servicedAt: s.servicedAt, title: s.title, itemNames: s.lines.map((l) => l.name) }),
        );
    entries.push({
      type: 'visit',
      id: s.id,
      at: s.servicedAt,
      odometer: s.odometer,
      title: s.title,
      kind: s.kind,
      costMinor: s.costMinor,
      covered,
      lineCount: s.lines.length,
      hasInvoice: !!s.imageUri,
    });
  }

  for (const m of input.marks) {
    if (m.action !== 'done' || m.serviceId) continue;
    const item = byKey.get(m.itemKey);
    if (!item) continue;
    const part = [m.brand, m.spec].filter(Boolean).join(' · ') || null;
    entries.push({ type: 'mark', id: m.id, at: m.doneAt, odometer: m.odometer, item, part });
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}
