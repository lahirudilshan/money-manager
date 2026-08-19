/**
 * Repositories behind SMS intake: the learned merchant rules, the review queue
 * and the durable intake log.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { merchantKey, type MerchantRule, type RuleUpsert } from '~/features/sms/logic/merchantRules';
import { SEED_MERCHANT_PATTERNS } from '~/features/sms/logic/smsCategoryHints';
import type { CatalogPlan } from '~/features/sms/logic/catalogSync';
import { db, expoDb } from '~/db/client';
import {
  merchantRules,
  smsInbox,
  transactions,
  type MerchantRuleRow,
  type NewSmsInboxRow,
  type SmsInboxRow,
  type SmsInboxStatus,
} from '~/db/schema';
import { createId, now } from './internal';

/**
 * The learned merchant → line map (see core/merchantRules.ts for the matching
 * logic, which stays pure; this is only storage).
 *
 * Reads return the plain `MerchantRule` shape the core module expects, so the
 * ranking code never sees a Drizzle row or a nullable timestamp.
 */
export const merchantRuleRepo = {
  all(): MerchantRule[] {
    return db
      .select()
      .from(merchantRules)
      .orderBy(desc(merchantRules.hitCount))
      .all()
      .map(toMerchantRule);
  },

  /**
   * Apply the edit `planRuleUpsert` decided on. Inserting records a brand-new
   * merchant; strengthening bumps `hitCount` and re-points the rule at the line
   * the user actually chose — which is what turns a correction into learning.
   */
  apply(upsert: RuleUpsert): void {
    if (upsert.kind === 'insert') {
      db.insert(merchantRules)
        .values({
          id: createId(),
          pattern: upsert.pattern,
          subcategoryId: upsert.subcategoryId,
          hint: upsert.hint,
          source: 'learned',
          hitCount: 1,
        })
        .run();
      return;
    }

    db.update(merchantRules)
      .set({
        subcategoryId: upsert.subcategoryId,
        // A corrected rule is now user-authored, whatever it started as.
        source: 'learned',
        hitCount: sql`${merchantRules.hitCount} + 1`,
        updatedAt: now(),
      })
      .where(eq(merchantRules.id, upsert.id))
      .run();
  },

  /**
   * Populate the shipped merchant patterns once, so a brand-new install already
   * recognises the common Sri Lankan chains instead of asking about every one.
   * Idempotent: patterns that already exist are skipped, so this is safe to run
   * on every launch and never overwrites what the user has taught.
   */
  seed(): void {
    const existing = new Set(
      db.select({ pattern: merchantRules.pattern }).from(merchantRules).all().map((r) => r.pattern),
    );

    const rows = SEED_MERCHANT_PATTERNS.flatMap(([hint, patterns]) =>
      patterns
        .map((pattern) => merchantKey(pattern))
        .filter((pattern) => pattern && !existing.has(pattern))
        .map((pattern) => ({
          id: createId(),
          pattern,
          // Seeds carry the hint only — they cannot know the user's lines.
          subcategoryId: null,
          hint,
          source: 'seed' as const,
          hitCount: 0,
        })),
    );

    if (rows.length > 0) db.insert(merchantRules).values(rows).run();
  },

  /**
   * Apply a merge plan from the shared catalog (see core/catalogSync.ts).
   *
   * Inserted rows carry `subcategoryId: null` and stay `source: 'seed'`: the
   * catalog knows what a merchant IS, never which of this user's lines it
   * belongs to. Keeping them 'seed' is what makes them eligible for a later
   * catalog correction — and what stops them being uploaded back as votes,
   * which would let the catalog endlessly re-confirm its own output.
   *
   * Returns the counts the Settings screen reports.
   */
  applyCatalog(plan: CatalogPlan): { inserted: number; updated: number } {
    for (const row of plan.insert) {
      db.insert(merchantRules)
        .values({
          id: createId(),
          pattern: row.pattern,
          subcategoryId: null,
          hint: row.hint,
          source: 'seed',
          hitCount: 0,
        })
        .run();
    }

    for (const row of plan.updateHint) {
      db.update(merchantRules)
        .set({ hint: row.hint, updatedAt: now() })
        .where(eq(merchantRules.id, row.id))
        .run();
    }

    return { inserted: plan.insert.length, updated: plan.updateHint.length };
  },

  remove(id: string): void {
    db.delete(merchantRules).where(eq(merchantRules.id, id)).run();
  },
};

/** Drizzle row → the plain shape core/merchantRules.ts ranks over. */
function toMerchantRule(row: MerchantRuleRow): MerchantRule {
  return {
    id: row.id,
    pattern: row.pattern,
    subcategoryId: row.subcategoryId,
    hint: (row.hint as MerchantRule['hint']) ?? null,
    source: row.source,
    hitCount: row.hitCount,
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * The durable SMS review queue.
 *
 * Every write here is idempotent on `fingerprint`, which is what lets the drain
 * be retried safely: the file is cleared only AFTER these rows land, so a crash
 * in between replays the same messages and the unique index absorbs them.
 */
export const smsInboxRepo = {
  /**
   * Queue a message, or do nothing if it is already known.
   *
   * Returns whether a new row was created, which is what the drain reports back
   * to the user as "3 to review" versus "already added". `onConflictDoNothing`
   * covers both a retried drain and a Shortcut that appended the same alert
   * twice, without a read-then-write race.
   */
  add(input: Omit<NewSmsInboxRow, 'id'>): boolean {
    const changes = db
      .insert(smsInbox)
      .values({ ...input, id: createId() })
      .onConflictDoNothing({ target: smsInbox.fingerprint })
      .run().changes;

    return changes > 0;
  },

  /**
   * Whether a fingerprint is already queued and still awaiting the user.
   *
   * Distinguishes the two cases `add` returning false collapses together: a row
   * that is still `pending` (genuinely a repeat delivery of something already on
   * screen) from one the user already confirmed or dismissed. Only the first is
   * a real duplicate; treating both alike is what made a re-sent test message
   * vanish with no trace.
   */
  isPending(fingerprint: string): boolean {
    const row = db
      .select({ id: smsInbox.id })
      .from(smsInbox)
      .where(and(eq(smsInbox.fingerprint, fingerprint), eq(smsInbox.status, 'pending')))
      .get();

    return row !== undefined;
  },

  /**
   * Put a resolved row back in the queue, keeping its id and fingerprint.
   *
   * The queue is fingerprint-unique so the same message can never occupy two
   * rows — which means a message the user acted on months ago is permanently
   * unimportable, even when the bank genuinely sends that exact text again.
   * Reopening is the escape hatch: the row returns to `pending` with its
   * resolution cleared, so it appears for review instead of being swallowed.
   *
   * Used only when a message arrives whose fingerprint maps to an ALREADY
   * RESOLVED row. A still-pending row is left alone — it is on screen already.
   */
  /**
   * Rewrite a row's PARSED columns from a fresh parse of its `raw` text.
   *
   * The columns are a snapshot from whichever parser drained the message, and
   * nothing else updates them — so a row queued before a parser improvement
   * keeps its old verdict forever. Only the parse is touched: `status`,
   * `fingerprint` and the timestamps are untouched, so this can never resurrect
   * a resolved row or duplicate one.
   */
  updateParse(
    id: string,
    parse: Partial<Pick<NewSmsInboxRow,
      'direction' | 'kind' | 'amountMinor' | 'currency' | 'merchant' | 'account' | 'occurredOn' | 'occurredAt'
    >>,
  ): void {
    db.update(smsInbox)
      .set({ ...parse, updatedAt: now() })
      .where(eq(smsInbox.id, id))
      .run();
  },

  reopen(fingerprint: string): boolean {
    const changes = db
      .update(smsInbox)
      .set({ status: 'pending', resolvedAt: null, receivedAt: new Date(), updatedAt: now() })
      .where(eq(smsInbox.fingerprint, fingerprint))
      .run().changes;

    return changes > 0;
  },

  /**
   * Messages still awaiting the user, NEWEST TRANSACTION FIRST.
   *
   * Ordered by when the money actually moved (`occurred_on` + `occurred_at`),
   * not by when the app happened to import the row. Those differ constantly: a
   * batch drained in one go shares a single `received_at`, so ordering by it
   * left messages from the same import in arbitrary order — a 15:21 purchase
   * could sit above a 15:20 one. Worse, a backlog imported after a week offline
   * would order by import time and interleave old and new transactions at
   * random.
   *
   * Rows with no parsed date sort last rather than first: an unknown date is
   * not evidence of being recent, and putting them at the top would push the
   * messages the user actually recognises off the screen.
   *
   * COALESCE supplies a low sentinel for the missing case, and the time falls
   * back to midnight so a dateless-but-timed row still sorts sensibly within its
   * day. `received_at` breaks any remaining tie so the order is stable across
   * reloads rather than shifting under the user.
   */
  pending(): SmsInboxRow[] {
    return db
      .select()
      .from(smsInbox)
      .where(eq(smsInbox.status, 'pending'))
      .orderBy(
        sql`COALESCE(${smsInbox.occurredOn}, '0000-00-00') DESC`,
        sql`COALESCE(${smsInbox.occurredAt}, '00:00') DESC`,
        desc(smsInbox.receivedAt),
      )
      .all();
  },

  /** How many are waiting, for the badge — cheaper than loading the rows. */
  pendingCount(): number {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(smsInbox)
      .where(eq(smsInbox.status, 'pending'))
      .get();

    return row?.count ?? 0;
  },

  /**
   * Mark a row acted-on. The row is KEPT, not deleted: its fingerprint is what
   * stops the same message being re-queued if it arrives again.
   */
  resolve(id: string, status: Extract<SmsInboxStatus, 'confirmed' | 'dismissed'>): void {
    db.update(smsInbox)
      .set({ status, resolvedAt: now(), updatedAt: now() })
      .where(eq(smsInbox.id, id))
      .run();
  },
};

/**
 * The durable record of every message the intake has seen.
 *
 * Separate from `smsInboxRepo`, which is the pending REVIEW QUEUE and empties
 * as the user acts. This never empties (beyond pruning), because its whole
 * purpose is answering "what happened to the message from Tuesday?" long after
 * the queue has moved on.
 *
 * Raw SQL rather than Drizzle: the table is diagnostics, deliberately absent
 * from schema.ts and from backups, so it has no generated model.
 */
export const smsLogRepo = {
  /** Record an outcome. Same fingerprint twice updates rather than duplicates. */
  record(entry: {
    raw: string;
    fingerprint: string;
    outcome: string;
    reason?: string | null;
    source?: string;
    amountMinor?: number | null;
    merchant?: string | null;
    kind?: string | null;
    occurredOn?: string | null;
  }): void {
    try {
      /*
       * Keyed by fingerprint, so a message re-delivered by the automation
       * updates its row instead of filling the log with copies. The LATEST
       * outcome wins — a message that failed and later succeeded should read as
       * succeeded.
       */
      expoDb.runSync(
        `INSERT INTO sms_log (id, raw, fingerprint, outcome, reason, source, amount_minor, merchant, kind, occurred_on, seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(fingerprint) DO UPDATE SET
           outcome = excluded.outcome,
           reason = excluded.reason,
           amount_minor = excluded.amount_minor,
           merchant = excluded.merchant,
           kind = excluded.kind,
           seen_at = excluded.seen_at`,
        [
          createId(),
          entry.raw,
          entry.fingerprint,
          entry.outcome,
          entry.reason ?? null,
          entry.source ?? 'file',
          entry.amountMinor ?? null,
          entry.merchant ?? null,
          entry.kind ?? null,
          entry.occurredOn ?? null,
          Date.now(),
        ],
      );
    } catch {
      // Diagnostics must never break intake. A log write that fails is a lost
      // log line; a throw here would lose the transaction itself.
    }
  },

  /** Newest first. `outcome` filters to one bucket for the segmented view. */
  recent(limit = 200, outcome?: string): SmsLogRow[] {
    try {
      return expoDb.getAllSync(
        outcome
          ? `SELECT * FROM sms_log WHERE outcome = ? ORDER BY seen_at DESC LIMIT ?`
          : `SELECT * FROM sms_log ORDER BY seen_at DESC LIMIT ?`,
        outcome ? [outcome, limit] : [limit],
      ) as SmsLogRow[];
    } catch {
      return [];
    }
  },

  /** How many of each outcome, for the summary chips. */
  counts(): Record<string, number> {
    try {
      const rows = expoDb.getAllSync(
        `SELECT outcome, count(*) AS n FROM sms_log GROUP BY outcome`,
      ) as { outcome: string; n: number }[];

      return Object.fromEntries(rows.map((row) => [row.outcome, row.n]));
    } catch {
      return {};
    }
  },

  clear(): void {
    try {
      expoDb.execSync('DELETE FROM sms_log;');
    } catch {
      // Nothing to clear.
    }
  },
};

export interface SmsLogRow {
  id: string;
  raw: string;
  fingerprint: string;
  outcome: string;
  reason: string | null;
  source: string;
  amount_minor: number | null;
  merchant: string | null;
  kind: string | null;
  occurred_on: string | null;
  seen_at: number;
}
