/** Health mini-app: people and their records. */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '~/db/client';
import {
  healthDocuments,
  healthMedicines,
  healthPeople,
  healthReadings,
  healthVisits,
  type HealthDocument,
  type HealthMedicine,
  type HealthPerson,
  type HealthReading,
  type HealthVisit,
  type NewHealthDocument,
  type NewHealthMedicine,
  type NewHealthPerson,
  type NewHealthReading,
  type NewHealthVisit,
} from '~/db/schema';
import { createId, now } from './internal';

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

export const healthPersonRepo = {
  all(): HealthPerson[] {
    return db
      .select()
      .from(healthPeople)
      .orderBy(
        // The phone's owner first — it is who the timeline opens on.
        desc(healthPeople.isSelf),
        asc(healthPeople.sortOrder),
        asc(healthPeople.createdAt),
      )
      .all();
  },

  byId(id: string): HealthPerson | undefined {
    return db.select().from(healthPeople).where(eq(healthPeople.id, id)).get();
  },

  /**
   * Add a person, keeping `isSelf` in step with a `self` relation.
   *
   * The two are one fact stored twice — the flag is what the timeline sorts and
   * defaults by, the relation is what the user actually picked — so deriving
   * one from the other here is what stops them disagreeing. Written as a
   * transaction because claiming `self` also has to release the previous holder.
   */
  create(input: Omit<NewHealthPerson, 'id'> & { id?: string }): HealthPerson {
    const isSelf = input.relation === 'self' || input.isSelf === true;

    return db.transaction((tx) => {
      if (isSelf) clearSelf(tx);

      return tx
        .insert(healthPeople)
        .values({ ...input, id: input.id ?? createId(), isSelf })
        .returning()
        .get();
    });
  },

  update(id: string, patch: Partial<NewHealthPerson>): void {
    db.transaction((tx) => {
      /*
       * Only touch `isSelf` when the relation is actually being changed.
       *
       * A patch that just edits a blood group must not silently demote the
       * person from "self" — `patch.relation` is undefined there, which is
       * different from it being set to something that is not `self`.
       */
      const next =
        patch.relation === undefined
          ? patch
          : { ...patch, isSelf: patch.relation === 'self' };

      if (patch.relation === 'self') clearSelf(tx);

      tx.update(healthPeople)
        .set({ ...next, updatedAt: now() })
        .where(eq(healthPeople.id, id))
        .run();
    });
  },

  /**
   * Make one person the "self", clearing any previous holder.
   *
   * Enforced here rather than by a constraint, the same way `houseRepo.setPrimary`
   * does it: SQLite cannot express "exactly one row has this flag", and two
   * selves would make the timeline's default person ambiguous.
   *
   * Moves the RELATION too, so the person who was "Myself" does not keep that
   * label after somebody else claimed it.
   */
  setSelf(id: string): void {
    db.transaction((tx) => {
      clearSelf(tx);
      tx.update(healthPeople)
        .set({ isSelf: true, relation: 'self', updatedAt: now() })
        .where(eq(healthPeople.id, id))
        .run();
    });
  },

  /** Cascades to every medicine, dose, visit, document and reading. */
  remove(id: string): void {
    db.delete(healthPeople).where(eq(healthPeople.id, id)).run();
  },
};

export const healthMedicineRepo = {
  /** Active courses first, then finished ones — both newest first. */
  byPerson(personId: string): HealthMedicine[] {
    return db
      .select()
      .from(healthMedicines)
      .where(eq(healthMedicines.personId, personId))
      .orderBy(desc(healthMedicines.isActive), desc(healthMedicines.startedOn))
      .all();
  },

  byId(id: string): HealthMedicine | undefined {
    return db.select().from(healthMedicines).where(eq(healthMedicines.id, id)).get();
  },

  /**
   * What one visit prescribed.
   *
   * The visit detail page reads this to show a consultation and its
   * prescriptions as a single episode, which is how it happened in the room.
   */
  byVisit(visitId: string): HealthMedicine[] {
    return db
      .select()
      .from(healthMedicines)
      .where(eq(healthMedicines.visitId, visitId))
      .orderBy(desc(healthMedicines.startedOn))
      .all();
  },

  /** Every active medicine across everyone — for the refill warnings. */
  allActive(): HealthMedicine[] {
    return db
      .select()
      .from(healthMedicines)
      .where(eq(healthMedicines.isActive, true))
      .all();
  },

  create(input: Omit<NewHealthMedicine, 'id'> & { id?: string }): HealthMedicine {
    return db
      .insert(healthMedicines)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewHealthMedicine>): void {
    db.update(healthMedicines)
      .set({ ...patch, updatedAt: now() })
      .where(eq(healthMedicines.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(healthMedicines).where(eq(healthMedicines.id, id)).run();
  },
};

export const healthVisitRepo = {
  byPerson(personId: string): HealthVisit[] {
    return db
      .select()
      .from(healthVisits)
      .where(eq(healthVisits.personId, personId))
      .orderBy(desc(healthVisits.visitedAt))
      .all();
  },

  byId(id: string): HealthVisit | undefined {
    return db.select().from(healthVisits).where(eq(healthVisits.id, id)).get();
  },

  /** Every visit carrying a follow-up date — feeds `upcoming()`. */
  withFollowUps(): HealthVisit[] {
    return db
      .select()
      .from(healthVisits)
      .where(sql`${healthVisits.followUpOn} IS NOT NULL`)
      .orderBy(asc(healthVisits.followUpOn))
      .all();
  },

  create(input: Omit<NewHealthVisit, 'id'> & { id?: string }): HealthVisit {
    return db
      .insert(healthVisits)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewHealthVisit>): void {
    db.update(healthVisits)
      .set({ ...patch, updatedAt: now() })
      .where(eq(healthVisits.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(healthVisits).where(eq(healthVisits.id, id)).run();
  },
};

export const healthDocumentRepo = {
  byPerson(personId: string): HealthDocument[] {
    return db
      .select()
      .from(healthDocuments)
      .where(eq(healthDocuments.personId, personId))
      .orderBy(desc(healthDocuments.documentDate))
      .all();
  },

  byVisit(visitId: string): HealthDocument[] {
    return db
      .select()
      .from(healthDocuments)
      .where(eq(healthDocuments.visitId, visitId))
      .orderBy(desc(healthDocuments.documentDate))
      .all();
  },

  create(input: Omit<NewHealthDocument, 'id'> & { id?: string }): HealthDocument {
    return db
      .insert(healthDocuments)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewHealthDocument>): void {
    db.update(healthDocuments)
      .set({ ...patch, updatedAt: now() })
      .where(eq(healthDocuments.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(healthDocuments).where(eq(healthDocuments.id, id)).run();
  },
};

export const healthReadingRepo = {
  byPerson(personId: string): HealthReading[] {
    return db
      .select()
      .from(healthReadings)
      .where(eq(healthReadings.personId, personId))
      .orderBy(desc(healthReadings.measuredAt))
      .all();
  },

  /** Readings taken at one visit — the figures measured in the room. */
  byVisit(visitId: string): HealthReading[] {
    return db
      .select()
      .from(healthReadings)
      .where(eq(healthReadings.visitId, visitId))
      .orderBy(desc(healthReadings.measuredAt))
      .all();
  },

  /** One metric's history, oldest first — the order a chart plots in. */
  byMetric(personId: string, metric: HealthReading['metric']): HealthReading[] {
    return db
      .select()
      .from(healthReadings)
      .where(and(eq(healthReadings.personId, personId), eq(healthReadings.metric, metric)))
      .orderBy(asc(healthReadings.measuredAt))
      .all();
  },

  create(input: Omit<NewHealthReading, 'id'> & { id?: string }): HealthReading {
    return db
      .insert(healthReadings)
      .values({ ...input, id: input.id ?? createId() })
      .returning()
      .get();
  },

  update(id: string, patch: Partial<NewHealthReading>): void {
    db.update(healthReadings)
      .set({ ...patch, updatedAt: now() })
      .where(eq(healthReadings.id, id))
      .run();
  },

  remove(id: string): void {
    db.delete(healthReadings).where(eq(healthReadings.id, id)).run();
  },
};
