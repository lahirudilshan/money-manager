/**
 * Shared plumbing for the repository modules.
 *
 * Not exported from the barrel: these are internals the repos agree on (id
 * generation, legacy status normalisation), not part of the data-access API.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  merchantKey,
  type MerchantRule,
  type RuleUpsert,
} from '~/features/sms/logic/merchantRules';
import { SEED_MERCHANT_PATTERNS } from '~/features/sms/logic/smsCategoryHints';
import type { CatalogPlan } from '~/features/sms/logic/catalogSync';
import { db, expoDb } from '~/db/client';
import {
  cards,
  categories,
  categoryStates,
  fundings,
  houses,
  incomes,
  loans,
  merchantRules,
  settings,
  smsInbox,
  subcategories,
  subcategoryStates,
  transactions,
  fuelEntries,
  vehicles,
  vehicleServices,
  serviceItems,
  healthPeople,
  healthMedicines,
  healthVisits,
  healthDocuments,
  healthReadings,
  meterReadings,
  type MeterReading,
  type NewMeterReading,
  type Card,
  type Category,
  type CategoryFundingStatus,
  type CategoryState,
  type Funding,
  type House,
  type Income,
  type Loan,
  type NewHouse,
  type MerchantRuleRow,
  type NewCard,
  type NewCategory,
  type NewFunding,
  type NewIncome,
  type NewLoan,
  type NewSmsInboxRow,
  type NewSubcategory,
  type NewTransaction,
  type SmsInboxRow,
  type SmsInboxStatus,
  type Subcategory,
  type SubcategoryState,
  type SubcategoryStatus,
  type Transaction,
  type FuelEntry,
  type NewFuelEntry,
  type NewVehicle,
  type NewVehicleService,
  type Vehicle,
  type VehicleService,
  type ServiceItem,
  type NewServiceItem,
  type HealthPerson,
  type NewHealthPerson,
  type HealthMedicine,
  type NewHealthMedicine,
  type HealthVisit,
  type NewHealthVisit,
  type HealthDocument,
  type NewHealthDocument,
  type HealthReading,
  type NewHealthReading,
} from '~/db/schema';

/**
 * Collapse a stored subcategory status to the 2-value model used everywhere
 * above the DB. Old rows can hold `transferred`/`completed` from the previous
 * 3-state design; both mean the bill is settled, so both read as `paid`.
 */
export function normaliseSubStatus(stored: string): SubcategoryStatus {
  return stored === 'pending' ? 'pending' : 'paid';
}

/** A subcategory state row with its status collapsed to pending/paid. */
export function readSubState(row: SubcategoryState): SubcategoryState {
  return { ...row, status: normaliseSubStatus(row.status) };
}

/** Collision-resistant id without a uuid dependency. */
export function createId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export const now = () => new Date();

/**
 * "This row is not a tombstone."
 *
 * Every read path in every repository composes this, so the rule lives in one
 * place: a deleted row stays in the table — see `deletedAt` in schema.ts — and
 * must be invisible to the app while remaining visible to sync. Spelling the
 * condition out at each call site would mean 40 chances to forget one, and a
 * forgotten filter shows the user rows they deleted.
 */
export function liveOnly<T extends { deletedAt: unknown }>(table: T) {
  return isNull(table.deletedAt as never);
}

/**
 * Mark a row deleted instead of removing it.
 *
 * `updatedAt` is bumped alongside `deletedAt` because the merge compares rows
 * by `updatedAt`: a tombstone stamped with an old modification time would lose
 * to the other device's live copy and the row would come back.
 */
export function tombstone(): { deletedAt: Date; updatedAt: Date } {
  const at = new Date();
  return { deletedAt: at, updatedAt: at };
}
