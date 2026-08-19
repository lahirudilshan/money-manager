# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Architecture

See [docs/architecture.md](docs/architecture.md). The short version:

- **Imports use the `~/` alias**, not relative paths — `~/features/sms/logic/smsParser`.
  Exceptions: siblings in the same module (`./internal`), and assets outside `src/`.
- **Feature code goes in `src/features/<name>/`**, split `logic/` (pure TS, tested)
  and `components/`. Shared-by-two-or-more goes in `src/shared/`.
- **`app/` is expo-router**: the directory layout IS the routing. Don't move files
  there — `/sms/new` is the Shortcuts deep link.
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
