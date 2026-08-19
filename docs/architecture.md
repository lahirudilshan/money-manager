# Architecture

How this codebase is laid out, and the rules that keep it that way.

## Layers

```
app/            expo-router routes — screens only
  └─ imports ──▶
src/features/   one directory per product area
  └─ imports ──▶
src/shared/     cross-cutting UI, hooks, lib, theme, reference data
  └─ imports ──▶
src/db/         schema, client, repositories
```

Dependencies point **down** this list. A feature may import from `shared/` and
`db/`; `shared/` must not import from `features/`; `db/` imports neither.

`src/store/` sits beside these: it reads through `db/`, is consumed by `app/`,
and is the one place screens get application state.

## Where things go

| Directory | Holds | Rule of thumb |
|---|---|---|
| `src/features/<name>/logic/` | Pure TypeScript: parsing, matching, calculation | No React imports. This is where the tests live. |
| `src/features/<name>/components/` | UI belonging to one feature | If a second feature needs it, it belongs in `shared/`. |
| `src/shared/components/ui/` | The design system | `primitives` (atoms), `sheet` (the one BottomSheet), `composites` |
| `src/shared/lib/` | Money, dates, device services | Used by two or more features |
| `src/db/repositories/` | Data access, one module per feature | The only place SQL lives |
| `src/store/` | Application state (`useAppStore`), derived views (`selectors`) | |

### `app/` is not reorganised, deliberately

expo-router derives routes from the directory layout, so moving a file there
changes a URL. `/sms/new` in particular is the deep link the iOS Shortcuts
automation posts into, and `/settings/backup` and the `/onboarding/*` flow are
navigated to by path. Screens stay where routing needs them; their logic lives
in the matching feature.

## Imports

Use the `~/` alias (`~/features/sms/logic/smsParser`), not relative paths.
Metro reads `paths` from `tsconfig.json` natively; `vitest.config.ts` mirrors
the same alias so a module resolves identically in the app and in its test.

Relative imports are still correct for two cases: a sibling inside the same
module (`./internal`), and assets outside `src/` (`../../../assets/...`).

## State and re-rendering

`useAppStore()` with no argument subscribes a component to **every** field, so
any mutation re-renders it. Prefer:

- `useAppActions()` — the actions, with a stable identity, so a component that
  only dispatches never re-renders. See `selectActions.ts` for why the result
  is cached and how that guarantee is tested.
- `useAppSelector(selectCardViews)` — one derived slice.

### Reloading after a write

The store re-reads from SQLite after every mutation rather than mutating its
copy, so derived values cannot drift from the database. The reload is split so
a write only pays for what it can affect:

| Call | Reloads |
|---|---|
| `refreshBoard()` | cards, houses, groups, lines, this period's state and totals, incomes, loans |
| `refreshSettings()` | the settings-backed fields, and republishes display currency |
| `refreshMerchantRules()` | the learned merchant → line map |
| `refreshMiniAppData()` | vehicles, health people |
| `refresh()` | all of the above |

Use the narrowest one that covers the write. `refresh()` is for launch, restore,
and anything that clears tables wholesale — `resetAllData` needs it, because a
board-only reload would leave stale settings pointing at deleted rows.

## Testing

`vitest` runs in plain node, which cannot parse React Native's Flow-typed
`index.js`. So the suite covers `features/*/logic` and `shared/lib` — pure
TypeScript — and not screens or the store module itself. Logic that needs a
guarantee should be extracted to a module that node can import: `selectActions.ts`
exists in that shape for exactly this reason.

```
yarn test        # 1093 tests, ~3s
yarn typecheck   # tsc --noEmit, strict
```

Type checking and tests both pass but neither catches a broken import path at
runtime. To verify a bundle actually builds:

```
npx expo start
curl -s -o /tmp/b.js -w '%{http_code}\n' \
  "http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true&minify=false&cacheBust=$RANDOM"
grep -c UnableToResolveError /tmp/b.js   # expect 0
```

The `cacheBust` matters: Metro will serve a cached bundle and hide your change.
