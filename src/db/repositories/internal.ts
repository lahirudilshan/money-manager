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
