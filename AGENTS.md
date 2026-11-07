# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Architecture

See [docs/architecture.md](docs/architecture.md). The short version:

- **Imports use the `~/` alias**, not relative paths — `~/features/sms/logic/smsParser`.
  Exceptions: siblings in the same module (`./internal`), and assets outside `src/`.
- **Feature code goes in `src/features/<name>/`**, split `logic/` (pure TS, tested)
  and `components/`. Shared-by-two-or-more goes in `src/shared/`.
- **`app/` is expo-router**: the directory layout IS the routing. Don't move files
  there — `/sms` is the deep link older Shortcuts automations still open.
- **Subscribe narrowly**: `useAppActions()` to dispatch, `useAppSelector(fn)` for a
  slice. Bare `useAppStore()` re-renders on every mutation.
- **Reload narrowly after a write**: `refreshBoard()` / `refreshSettings()` /
  `refreshMerchantRules()` / `refreshMiniAppData()`, not `refresh()`.

# Verifying

`yarn typecheck` and `yarn test` both pass but neither catches a broken import at
runtime. For anything touching imports or file layout, also build a bundle:

```
curl -s -o /tmp/b.js "http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true&minify=false&cacheBust=$RANDOM"
grep -c UnableToResolveError /tmp/b.js   # expect 0
```

`cacheBust` is required — Metro serves a cached bundle otherwise and hides the change.

# Adding data (tables or columns) — it MUST be backed up

Every table the user's data lives in must travel in a full backup and in Drive
sync. Buddy loans and split-payment parts were silently missing from every
backup for months because nobody added them to a backup part. Follow the
`add-table` skill (`.claude/skills/add-table/SKILL.md`). The short version:

1. `src/db/schema.ts` — the Drizzle table (spread `timestamps`).
2. `src/db/client.ts` — `CREATE TABLE IF NOT EXISTS` in `DDL`, the table in
   `SYNCED_TABLES`; a new COLUMN on an existing table also goes in
   `ensureAdditiveColumns`.
3. `src/features/backup/logic/backup.ts` — the table in `SNAPSHOT_TABLES`
   (parents before children), in a `BACKUP_PARTS` entry, in the history-scope
   list if it is history, and a `TABLE_LABELS` entry.
4. Excluding a table from backups is a decision: add it to `NOT_BACKED_UP`
   with the reason.

`backupCoverage.test.ts` reads the DDL and fails if a table is in none of
these — run `yarn test` before calling the change done.
