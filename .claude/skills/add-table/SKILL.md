---
name: add-table
description: Checklist for adding a new database table or column to Dayly so it is migrated, synced and BACKED UP. Use whenever a change touches src/db/schema.ts or adds a CREATE TABLE / new column — a new feature's storage, a mini-app, a new field on an existing record.
---

# Adding a table or column to Dayly

Data the user enters must survive a backup → restore and travel with Drive
sync. Buddy loans and split-payment parts were silently dropped from every
backup for months because they were added to the database but never to a
backup part — the user lost their buddy loans on a reinstall. This checklist
exists so that cannot happen again.

## A new table

1. **Schema** — `src/db/schema.ts`: define the table with `sqliteTable`, spread
   `...timestamps` (gives `created_at`, `updated_at`, `deleted_at`), add indexes,
   export `$inferSelect` / `$inferInsert` types.
2. **DDL** — `src/db/client.ts`:
   - `CREATE TABLE IF NOT EXISTS …` in the `DDL` array, columns matching the
     schema exactly, including `deleted_at INTEGER`.
   - indexes as separate `CREATE INDEX IF NOT EXISTS` entries.
   - the table name in `SYNCED_TABLES` (every table spreading `timestamps` must
     be there — `tombstoneColumns.test.ts` enforces it).
3. **Backup** — `src/features/backup/logic/backup.ts`:
   - `SNAPSHOT_TABLES`: add it AFTER every table it references (restore inserts
     in this order with foreign keys).
   - `BACKUP_PARTS`: put it in an existing part, or add a part (and extend
     `BackupPartKey`). A table in no part is never written to a backup.
   - The history-scope list, if the rows are history (dated events) rather
     than structure — and exclude its part from `SETUP_PARTS` if so.
   - `TABLE_LABELS`: a human name for the restore preview.
   - `describeParts`: a count line if the user would want to see it.
4. **Clear data** — `src/features/backup/logic/resetPlan.ts`:
   - put the table in a `RESET_AREAS` entry (the "Erase only what I choose"
     list), adding an area if it is a new feature;
   - decide setup vs record: records (dated events, money moving) go in
     `RECORD_TABLES`; setup goes in the `setup` set in `resetPlan.test.ts`.
   "Erase everything" picks it up automatically from `SNAPSHOT_TABLES`.
5. **Repository** — `src/db/repositories/<feature>.ts`, exported from the barrel.
6. **Tests** — `yarn test`. `backupCoverage.test.ts` reads the DDL and fails if
   the table is missing from backups; `resetPlan.test.ts` fails if it is not
   classified for Clear data. Fix the cause, never the test.

## A new column on an existing table

1. `schema.ts` — the column.
2. `client.ts` — the column in the table's `CREATE TABLE` (new installs) AND an
   `ensureColumn(...)` in `ensureAdditiveColumns` (existing installs), guarded by
   a `sqlite_master` check if the table is created on first use. An index on
   the new column goes in `ensureAdditiveColumns` too, never in `DDL`.
3. Nothing to do for backup: snapshots copy whole rows (`SELECT *`), and
   restore keeps only columns the target database has.

## Deliberately NOT backing something up

Only for data that must not leave the phone (e.g. raw bank message text). Add
it to `NOT_BACKED_UP` in `backup.ts` with a written reason. The default is:
back it up.

## Verify

- `yarn typecheck` and `yarn test` (the coverage test must pass).
- Bundle check from AGENTS.md if imports changed.
- Make a backup in the app and confirm the restore preview lists the new data
  with a non-zero count.
