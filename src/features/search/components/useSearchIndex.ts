import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { transactionRepo } from '~/db/repositories/board';
import { docFileRepo, docFolderRepo } from '~/db/repositories/documents';
import { fuelEntryRepo, vehicleServiceRepo } from '~/db/repositories/fuel';
import {
  healthDocumentRepo,
  healthLabRepo,
  healthMedicineRepo,
  healthReadingRepo,
  healthVisitRepo,
} from '~/db/repositories/health';
import { smsLogRepo, type SmsLogRow } from '~/db/repositories/sms';
import { refillRepo } from '~/db/repositories/trackers';
import type {
  DocFile,
  DocFolder,
  FuelEntry,
  HealthDocument,
  HealthLabResult,
  HealthMedicine,
  HealthReading,
  HealthVisit,
  RefillRow,
  Transaction,
  VehicleService,
} from '~/db/schema';
import { pathLabel } from '~/features/documents/logic/folders';
import { useAppSelector, useAppStore } from '~/store/useAppStore';
import { accountLabel, accountName } from '~/shared/data/banks';
import { formatDateLabel } from '~/shared/lib/dates';
import { parseEnabled } from '~/shared/lib/miniApps';
import { formatMoney } from '~/shared/lib/money';
import type { SearchItem } from '../logic/globalSearch';

/** Rows the store doesn't hold, read from the database when the screen focuses. */
interface Loaded {
  transactions: Transaction[];
  files: DocFile[];
  folders: DocFolder[];
  medicines: HealthMedicine[];
  visits: HealthVisit[];
  healthDocs: HealthDocument[];
  readings: HealthReading[];
  labs: HealthLabResult[];
  fuelEntries: FuelEntry[];
  services: VehicleService[];
  refills: RefillRow[];
  sms: SmsLogRow[];
}

const EMPTY: Loaded = {
  transactions: [],
  files: [],
  folders: [],
  medicines: [],
  visits: [],
  healthDocs: [],
  readings: [],
  labs: [],
  fuelEntries: [],
  services: [],
  refills: [],
  sms: [],
};

/** SMS history kept on the device is capped by the log itself; this bounds the read. */
const SMS_LIMIT = 1000;

function asDate(value: Date | number | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

/** "blood_sugar" → "Blood sugar". */
function humanize(value: string | null | undefined): string {
  if (!value) return '';
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A failed read shows as no results for that source, never a crash. */
function safe<T>(read: () => T[]): T[] {
  try {
    return read();
  } catch {
    return [];
  }
}

/** Amount in both spellings people type: "12,500" and "12500". */
function amountWords(minor: number): string {
  const shown = formatMoney(minor, { showCurrency: false });
  return `${shown} ${shown.replace(/[^0-9.]/g, '')}`;
}

/**
 * Read every row the store doesn't hold. Synchronous SQLite, so it is only
 * ever run after interactions — never in the frame that opens the screen.
 */
function readAll(): Loaded {
  const state = useAppStore.getState();
  const enabled = parseEnabled(state.miniApps);
  const people = enabled.has('health') ? state.healthPeople : [];
  const vehicles = enabled.has('fuel') ? state.vehicles : [];
  return {
    transactions: safe(() => transactionRepo.all()),
    files: enabled.has('documents') ? safe(() => docFileRepo.all()) : [],
    folders: enabled.has('documents') ? safe(() => docFolderRepo.all()) : [],
    medicines: people.flatMap((p) => safe(() => healthMedicineRepo.byPerson(p.id))),
    visits: people.flatMap((p) => safe(() => healthVisitRepo.byPerson(p.id))),
    healthDocs: people.flatMap((p) => safe(() => healthDocumentRepo.byPerson(p.id))),
    readings: people.flatMap((p) => safe(() => healthReadingRepo.byPerson(p.id))),
    labs: people.flatMap((p) => safe(() => healthLabRepo.resultsByPerson(p.id))),
    fuelEntries: vehicles.flatMap((v) => safe(() => fuelEntryRepo.byVehicle(v.id))),
    services: vehicles.flatMap((v) => safe(() => vehicleServiceRepo.byVehicle(v.id))),
    refills: enabled.has('trackers') ? safe(() => refillRepo.all()) : [],
    sms: safe(() => smsLogRepo.recent(SMS_LIMIT)),
  };
}

/**
 * The last read, kept for the life of the JS runtime so a second open shows
 * results instantly. Each open still refreshes it in the background, so an
 * edit made since shows up a moment later rather than never.
 */
let cache: Loaded | null = null;

/**
 * Warm the cache while the dashboard is idle, so even the FIRST open of Search
 * has data ready. Runs when the JS thread is idle, so it never delays a dashboard frame.
 */
export function preloadSearchIndex(): void {
  if (cache) return;
  requestIdleCallback(() => {
    if (!cache) cache = readAll();
  });
}

/**
 * Every searchable row in the app as one flat list, add-ons included only when
 * they are switched on.
 */
export function useSearchIndex(): {
  items: SearchItem[];
  enabled: ReturnType<typeof parseEnabled>;
  /** Document rows by id, so a document hit opens the preview sheet instead of a screen. */
  files: Map<string, DocFile>;
  folders: DocFolder[];
  reload: () => void;
  /** True until the first read lands; store-held rows are searchable before it. */
  loading: boolean;
} {
  const miniApps = useAppSelector((s) => s.miniApps);
  const cards = useAppSelector((s) => s.cards);
  const categories = useAppSelector((s) => s.categories);
  const subcategories = useAppSelector((s) => s.subcategories);
  const loans = useAppSelector((s) => s.loans);
  const vehicles = useAppSelector((s) => s.vehicles);
  const healthPeople = useAppSelector((s) => s.healthPeople);
  const trackedItems = useAppSelector((s) => s.trackedItems);
  const buddyLoans = useAppSelector((s) => s.buddyLoans);
  const incomes = useAppSelector((s) => s.incomes);

  const enabled = useMemo(() => parseEnabled(miniApps), [miniApps]);
  const [loaded, setLoaded] = useState<Loaded>(() => cache ?? EMPTY);
  const [loading, setLoading] = useState(cache === null);

  const reload = useCallback(() => {
    // After the opening animation, so the box, keyboard and history paint first.
    const handle = requestIdleCallback(() => {
      cache = readAll();
      setLoaded(cache);
      setLoading(false);
    });
    return () => cancelIdleCallback(handle);
  }, []);

  // Re-read when an add-on is switched on or a person/vehicle is added.
  useFocusEffect(
    useCallback(() => reload(), [reload, enabled, healthPeople, vehicles]),
  );

  const items = useMemo(() => {
    const out: SearchItem[] = [];
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const billById = new Map(subcategories.map((s) => [s.id, s]));
    const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
    const when = (date: Date | null) => (date ? formatDateLabel(date) : null);
    const money = (minor: number | null | undefined) => (minor != null ? amountWords(minor) : null);

    // Board
    for (const tx of loaded.transactions) {
      const bill = tx.subcategoryId ? billById.get(tx.subcategoryId) : undefined;
      const category = bill ? categoryById.get(bill.categoryId) : undefined;
      const card = tx.cardId ? cardById.get(tx.cardId) : undefined;
      const date = asDate(tx.date);
      out.push({
        key: `transactions:${tx.id}`,
        scope: 'transactions',
        title: tx.name,
        subtitle: join(when(date), bill?.name ?? category?.name, card ? accountName(card) : null),
        details: [tx.note, category?.name, money(tx.amountMinor)],
        amountMinor: tx.amountMinor,
        flow: bill?.type === 'income' ? 'in' : 'out',
        route: bill ? `/subcategory/${bill.id}` : '/list',
        date,
      });
    }

    for (const bill of subcategories) {
      const category = categoryById.get(bill.categoryId);
      out.push({
        key: `bills:${bill.id}`,
        scope: 'bills',
        title: bill.name,
        subtitle: join(category?.name, humanize(bill.frequency)),
        details: [bill.type, money(bill.plannedMinor)],
        amountMinor: bill.plannedMinor || null,
        kind: bill.type === 'income' ? 'Income line' : undefined,
        route: `/subcategory/${bill.id}`,
      });
    }

    for (const category of categories) {
      const count = subcategories.filter((s) => s.categoryId === category.id).length;
      out.push({
        key: `categories:${category.id}`,
        scope: 'categories',
        title: category.name,
        subtitle: `${count} ${count === 1 ? 'bill' : 'bills'}`,
        route: `/category/${category.id}`,
      });
    }

    for (const card of cards) {
      const label = accountLabel(card);
      out.push({
        key: `accounts:${card.id}`,
        scope: 'accounts',
        title: label.primary,
        subtitle: join(label.secondary, humanize(card.kind), card.accountNumber ? `•••• ${card.accountNumber.slice(-4)}` : null),
        details: [card.bankName, card.nickname, card.accountNumber, card.cardNumber?.slice(-4)],
        route: `/account/${card.id}`,
      });
    }

    for (const loan of loans) {
      out.push({
        key: `loans:${loan.id}`,
        scope: 'loans',
        title: loan.name,
        subtitle: join(humanize(loan.kind), `${loan.termMonths} months`, loan.isActive ? null : 'Closed'),
        details: [money(loan.principalMinor), loan.isActive ? 'active' : 'closed'],
        amountMinor: loan.principalMinor,
        route: '/loans',
      });
    }

    for (const income of incomes) {
      const card = income.cardId ? cardById.get(income.cardId) : undefined;
      out.push({
        key: `income:${income.id}`,
        scope: 'income',
        title: income.name,
        subtitle: join(card ? accountName(card) : null, income.isActive ? 'Monthly' : 'Paused'),
        details: [money(income.amountMinor), 'salary'],
        amountMinor: income.amountMinor,
        flow: 'in',
        route: '/income',
      });
    }

    for (const sms of loaded.sms) {
      const seen = new Date(sms.seen_at);
      out.push({
        key: `sms:${sms.id}`,
        scope: 'sms',
        title: sms.merchant || sms.raw.slice(0, 60),
        subtitle: join(when(seen), humanize(sms.outcome)),
        details: [sms.raw, sms.kind, sms.reason, money(sms.amount_minor)],
        amountMinor: sms.amount_minor,
        route: '/settings/sms-history',
        date: seen,
      });
    }

    // Add-ons
    for (const file of loaded.files) {
      const folder = pathLabel(loaded.folders, file.folderId);
      out.push({
        key: `documents:${file.id}`,
        scope: 'documents',
        title: file.title,
        subtitle: join(folder || 'Documents', file.tags?.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3).join(', ')),
        details: [file.description, file.tags, file.fileName, folder],
        kind: file.pinned ? 'Pinned' : undefined,
        icon: file.mimeType?.startsWith('image/') ? 'image-outline' : 'document-text-outline',
        route: `/mini/documents/file?id=${file.id}`,
        date: asDate(file.createdAt),
      });
    }

    if (enabled.has('fuel')) {
      const vehicleName = new Map(vehicles.map((v) => [v.id, v.name]));
      for (const vehicle of vehicles) {
        out.push({
          key: `vehicles:${vehicle.id}`,
          scope: 'vehicles',
          title: vehicle.name,
          subtitle: join(vehicle.registration, humanize(vehicle.fuelType)),
          details: [vehicle.kind, vehicle.registration?.replace(/[^a-z0-9]/gi, '')],
          kind: 'Vehicle',
          route: `/mini/fuel/history?vehicle=${vehicle.id}`,
        });
      }
      for (const entry of loaded.fuelEntries) {
        const at = asDate(entry.filledAt);
        out.push({
          key: `vehicles:fuel:${entry.id}`,
          scope: 'vehicles',
          title: entry.station || `${entry.litres} L fill-up`,
          subtitle: join(when(at), vehicleName.get(entry.vehicleId), entry.station ? `${entry.litres} L` : null),
          details: ['fuel fill up', entry.note, String(entry.odometer), money(entry.totalMinor)],
          amountMinor: entry.totalMinor,
          flow: 'out',
          kind: 'Fill-up',
          icon: 'water-outline',
          route: `/mini/fuel/entry?id=${entry.id}`,
          date: at,
        });
      }
      for (const service of loaded.services) {
        const at = asDate(service.servicedAt);
        out.push({
          key: `vehicles:service:${service.id}`,
          scope: 'vehicles',
          title: service.title,
          subtitle: join(when(at), vehicleName.get(service.vehicleId)),
          details: [service.kind, service.note, 'service', money(service.costMinor)],
          amountMinor: service.costMinor,
          flow: 'out',
          kind: 'Service',
          icon: 'construct-outline',
          route: `/mini/fuel/services?vehicle=${service.vehicleId}`,
          date: at,
        });
      }
    }

    if (enabled.has('buddyloans')) {
      for (const loan of buddyLoans) {
        const lentOn = asDate(loan.lentOn);
        out.push({
          key: `buddyloans:${loan.id}`,
          scope: 'buddyloans',
          title: loan.personName,
          subtitle: join(loan.direction === 'lent' ? 'You lent' : 'You borrowed', when(lentOn)),
          details: [loan.note, loan.personContact, money(loan.amountMinor)],
          amountMinor: loan.amountMinor,
          flow: loan.direction === 'lent' ? 'out' : 'in',
          kind: loan.status === 'outstanding' ? 'Outstanding' : humanize(loan.status),
          route: `/mini/buddyloans/detail?id=${loan.id}`,
          date: lentOn,
        });
      }
    }

    if (enabled.has('trackers')) {
      const itemName = new Map(trackedItems.map((t) => [t.id, t.name]));
      for (const item of trackedItems) {
        out.push({
          key: `trackers:${item.id}`,
          scope: 'trackers',
          title: item.name,
          subtitle: join(item.unitLabel, item.expectedDays ? `Lasts ~${item.expectedDays} days` : null, item.archived && 'Archived'),
          details: [item.note],
          kind: 'Tracked item',
          route: `/mini/trackers/detail?id=${item.id}`,
        });
      }
      for (const refill of loaded.refills) {
        const at = asDate(refill.filledOn);
        out.push({
          key: `trackers:refill:${refill.id}`,
          scope: 'trackers',
          title: itemName.get(refill.itemId) ?? 'Item',
          subtitle: join('Replaced', when(at)),
          details: ['refill', refill.note, money(refill.priceMinor)],
          amountMinor: refill.priceMinor,
          flow: 'out',
          kind: 'Refill',
          icon: 'refresh-outline',
          route: `/mini/trackers/refill?itemId=${refill.itemId}&id=${refill.id}`,
          date: at,
        });
      }
    }

    if (enabled.has('health')) {
      const personName = new Map(healthPeople.map((p) => [p.id, p.name]));
      for (const person of healthPeople) {
        out.push({
          key: `health:person:${person.id}`,
          scope: 'health',
          title: person.name,
          subtitle: join(person.relationLabel ?? humanize(person.relation), person.bloodGroup),
          details: [person.allergies, person.conditions, person.note],
          kind: 'Person',
          icon: 'person-outline',
          route: `/mini/health/person?id=${person.id}`,
        });
      }
      for (const medicine of loaded.medicines) {
        out.push({
          key: `health:medicine:${medicine.id}`,
          scope: 'health',
          title: medicine.name,
          subtitle: join(medicine.dosage, personName.get(medicine.personId), medicine.isActive ? null : 'Stopped'),
          details: [medicine.genericName, medicine.instructions, medicine.prescribedBy, medicine.note],
          kind: 'Medicine',
          icon: 'medkit-outline',
          route: `/mini/health/medicine?id=${medicine.id}`,
          date: asDate(medicine.startedOn),
        });
      }
      for (const visit of loaded.visits) {
        const at = asDate(visit.visitedAt);
        out.push({
          key: `health:visit:${visit.id}`,
          scope: 'health',
          title: visit.doctor || visit.facility || visit.reason || 'Visit',
          subtitle: join(when(at), personName.get(visit.personId), visit.doctor ? visit.facility : null),
          details: [visit.speciality, visit.reason, visit.diagnosis, visit.note, 'doctor visit'],
          amountMinor: visit.costMinor,
          flow: 'out',
          kind: 'Visit',
          icon: 'medical-outline',
          route: `/mini/health/visit?id=${visit.id}`,
          date: at,
        });
      }
      for (const doc of loaded.healthDocs) {
        const at = asDate(doc.documentDate);
        out.push({
          key: `health:document:${doc.id}`,
          scope: 'health',
          title: doc.title,
          subtitle: join(when(at), personName.get(doc.personId)),
          details: [doc.summary, doc.note, doc.tags, 'report', doc.kind],
          kind: humanize(doc.kind) || 'Report',
          icon: 'document-text-outline',
          route: `/mini/health/document?person=${doc.personId}&id=${doc.id}`,
          date: at,
        });
      }
      for (const reading of loaded.readings) {
        const at = asDate(reading.measuredAt);
        const value =
          reading.valueSecondary != null ? `${reading.value}/${reading.valueSecondary}` : String(reading.value);
        out.push({
          key: `health:reading:${reading.id}`,
          scope: 'health',
          title: humanize(reading.metric),
          subtitle: join(`${value}${reading.unit ? ` ${reading.unit}` : ''}`, when(at), personName.get(reading.personId)),
          details: ['reading', humanize(reading.context), reading.note],
          kind: 'Reading',
          icon: 'pulse-outline',
          route: `/mini/health/reading?id=${reading.id}`,
          date: at,
        });
      }
      for (const lab of loaded.labs) {
        const at = asDate(lab.measuredAt);
        out.push({
          key: `health:lab:${lab.id}`,
          scope: 'health',
          title: lab.testName,
          subtitle: join(`${lab.valueText}${lab.unit ? ` ${lab.unit}` : ''}`, when(at), personName.get(lab.personId)),
          details: ['lab test', lab.category, lab.testKey, lab.meaning],
          kind: humanize(lab.status) || 'Lab result',
          icon: 'flask-outline',
          route: `/mini/health/labs?person=${lab.personId}`,
          date: at,
        });
      }
    }

    return out;
  }, [loaded, cards, categories, subcategories, loans, incomes, vehicles, buddyLoans, trackedItems, healthPeople, enabled]);

  const files = useMemo(() => new Map(loaded.files.map((f) => [f.id, f])), [loaded.files]);

  return { items, enabled, files, folders: loaded.folders, reload, loading };
}
