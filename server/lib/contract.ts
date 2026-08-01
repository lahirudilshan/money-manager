/**
 * The wire contract, as executable schemas.
 *
 * Validation is the privacy boundary, not a formality. The rule that keeps
 * message text, balances and account numbers out of a database every user can
 * read is `.strict()`: an unknown key is a 400, not a silently dropped field.
 * If a future client is modified to send `raw` or `balance`, the request fails
 * loudly instead of quietly polluting the shared catalog.
 */

import { z } from 'zod';

/** Must stay in sync with CategoryHint in src/core/smsCategoryHints.ts. */
export const HINTS = [
  'water',
  'electricity',
  'telecom',
  'groceries',
  'fuel',
  'subscription',
  'loan',
  'transfer',
  'atm',
  'income',
] as const;

export type Hint = (typeof HINTS)[number];

/**
 * Coarse amount bands, in home-currency major units.
 *
 * The exact amount never leaves the device: it is a personal detail and, across
 * a few transactions, a fingerprint. A band is enough to separate "a phone bill"
 * from "a new handset on the same merchant", which is all the ranking needs.
 *
 * Bands are wide and few on purpose — the more of them there are, the closer the
 * bucket gets to being the amount itself.
 */
export const AMOUNT_BUCKETS = [
  'under_500',
  '500_2k',
  '2k_10k',
  '10k_50k',
  '50k_200k',
  'over_200k',
] as const;

export type AmountBucket = (typeof AMOUNT_BUCKETS)[number];

/** Place an amount (major units) into its band. */
export function bucketFor(amountMajor: number): AmountBucket {
  const amount = Math.abs(amountMajor);
  if (amount < 500) return 'under_500';
  if (amount < 2_000) return '500_2k';
  if (amount < 10_000) return '2k_10k';
  if (amount < 50_000) return '10k_50k';
  if (amount < 200_000) return '50k_200k';
  return 'over_200k';
}

export const hintSchema = z.enum(HINTS);
export const bucketSchema = z.enum(AMOUNT_BUCKETS);

/**
 * A bank/utility short code such as "DIALOG" or "HNB".
 *
 * This is the SENDER of the alert — a public, institutional identifier. It is
 * never the user's own number, and the pattern rejects anything that looks like
 * a phone number so a client bug cannot turn this field into one.
 */
export const senderSchema = z
  .string()
  .trim()
  .max(24)
  .regex(/^[A-Za-z][A-Za-z0-9 .&-]*$/, 'sender must be an alphanumeric short code')
  .transform((value) => value.toUpperCase());

/** Merchant keys longer than this are junk, not shop names. */
const MAX_MERCHANT = 120;

export const merchantSchema = z.string().trim().min(1).max(MAX_MERCHANT);

/**
 * One contributed observation.
 *
 * `.strict()` is the privacy guarantee — see the module comment. Note what has
 * no field here at all: message text, exact amount, balance, account or card
 * number, reference id, date, and the user's own category names.
 */
export const observationSchema = z
  .object({
    merchant: merchantSchema,
    hint: hintSchema,
    sender: senderSchema.nullable().optional(),
    direction: z.enum(['debit', 'credit']),
    amountBucket: bucketSchema,
  })
  .strict();

export type Observation = z.infer<typeof observationSchema>;

/** Observations per request: generous for a backlog flush, bounded vs abuse. */
export const MAX_OBSERVATIONS = 100;

export const contributeSchema = z
  .object({
    deviceId: z.uuid(),
    observations: z.array(observationSchema).min(1).max(MAX_OBSERVATIONS),
  })
  .strict();

/** Suggestions returned per draft. Three is the cap the UI renders. */
export const MAX_SUGGESTIONS = 3;

export const suggestQuerySchema = z.object({
  merchant: merchantSchema,
  sender: senderSchema.nullable().optional(),
  direction: z.enum(['debit', 'credit']).default('debit'),
  amountBucket: bucketSchema.optional(),
});

/**
 * One of the user's budget lines, as sent for ranking.
 *
 * The board is used to answer one request and discarded — it is never written
 * to any table. It has to be sent because only the user's own line names and
 * planned amounts can say which line a transaction belongs to, and those live
 * on the device.
 */
export const boardLineSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().max(120),
    type: z.enum(['income', 'expense']),
    plannedMinor: z.number().int().nonnegative(),
    groupName: z.string().max(120).default(''),
    /** Last 4 of the card behind this line. Four digits, never a full number. */
    cardLast4: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .optional(),
    isLoan: z.boolean().optional(),
  })
  .strict();

/** Lines per request. A large board still fits; an unbounded array does not. */
const MAX_LINES = 400;

/**
 * The detect request.
 *
 * `.strict()` again, and note the absence: there is no field for the raw
 * message. The device parses locally and sends what it extracted, so the SMS
 * text — with its balances, account numbers and reference ids — never reaches
 * the server. A client that tried to send it gets a 400.
 */
export const detectSchema = z
  .object({
    merchant: z.string().trim().max(200),
    direction: z.enum(['debit', 'credit', 'bill']),
    kind: z.string().max(40).default('other'),
    amountMinor: z.number().int().nonnegative(),
    /** Account fragment for last-4 matching. Digits only, at most 6. */
    account: z
      .string()
      .regex(/^\d{0,6}$/)
      .default(''),
    sender: senderSchema.nullable().optional(),
    lines: z.array(boardLineSchema).max(MAX_LINES).default([]),
  })
  .strict();
