# End-to-end tests

Drives the real app on a simulator through Appium/XCUITest — taps, scrolls and
typing, exactly as a person would.

## Why these exist alongside `vitest`

The unit suite covers pure logic and cannot see the app. Every bug in
`cases/test_regressions.py` was invisible to it by construction:

- a **fresh install could not finish onboarding at all** — a migration ran
  before the table it migrates existed, so the column it adds was never created.
  Upgraded devices were fine, which is why it survived so long;
- the dashboard said **"Nothing due right now"** on a board full of unpaid
  bills, because its filter dropped everything more than 7 days out;
- the last card on five onboarding screens sat **permanently under the pinned
  footer**, unreachable however far you scrolled;
- **deleting a subcategory crashed the app** — a hook below an early return.

Each needed a real screen to find. That is the gap this fills.

## Prerequisites

```bash
npm install -g appium@3
appium driver install xcuitest
```

Then, in three terminals:

```bash
# 1. Metro (the app loads its JS from here)
npx expo start --dev-client

# 2. Appium
appium --port 4723

# 3. A booted simulator with the app installed
xcrun simctl boot "iPhone 16 Pro"
npx expo run:ios --device "iPhone 16 Pro"
```

The first run builds WebDriverAgent and takes a few minutes; later runs attach
in seconds.

## Running

```bash
python3 e2e/run.py                     # everything
python3 e2e/run.py regressions         # one file
python3 e2e/run.py delete-subcategory  # one case
```

Exit code is non-zero if any case fails, so this can gate a commit. Failures
write a screenshot to `e2e/artifacts/`.

## Layout

| Path | What it holds |
| --- | --- |
| `harness.py` | Appium wrapper: `tap`, `set_text`, `scroll_to`, `fresh_install`, `db_query`, `Check` |
| `cases/test_regressions.py` | One case per bug already fixed — these must never fail again |
| `cases/test_personas.py` | Whole journeys as different people (see `docs/persona-test-plan.md`) |
| `run.py` | Runner and reporter |

## Writing a case

```python
def test_something(check):
    mark = now_ms()
    fresh_install()

    tap("Commercial Bank of Ceylon", required=True)
    check.on_screen("1 account selected", "bank selection registers")
    check.no_errors(mark)          # the app logged nothing to Metro

CASES = [("something", test_something)]
```

Three things worth knowing:

**Assert on the database when the guarantee is not visible.** `db_query()` reads
the app's SQLite directly — "bank charges are stored with no funding account"
cannot be checked any other way.

**Always `check.no_errors(mark)`.** A screen can look perfectly correct while
the app throws underneath; several defects here were found that way.

**`fresh_install()` is not the same as `relaunch()`.** The migration bug
reproduced *only* on a device with no database, so any test about first-run
behaviour must wipe.

**Setup is cached; you should almost never wipe the device.** Three layers keep
the suite off the slow path, and a case only needs to pick the right one:

| Need | Call | Cost |
| --- | --- | --- |
| A finished board to act on | `board.build()` | ~0s if already loaded, else ~12s |
| Onboarding's questions on an empty app | `blank_slate()` | ~12s |
| A genuinely wiped database | `fresh_install()` | ~110s |

`fresh_install()` is now used by exactly ONE case — the migration regression,
which reproduces only on a database that never existed. Everything else that
"needs a fresh app" wants `blank_slate()`: the same empty database, restored
from a snapshot instead of recreated.

`board.build()` is free when the device already holds that board and no case has
written to it. The harness tracks this: typing, or tapping a commit-ish word
(`Save`, `Done`, `Delete`, `Add`…), marks the board dirty and the next request
for it restores for real. So **a read-only case costs nothing to set up**, and
you never have to reason about what the previous case left behind.

If you write data through a path the harness cannot see as a write, call
`mark_data_dirty()` yourself — a needless restore costs 12 seconds; a missed one
hands the next case your spending.

Cases are also **reordered** so board cases run together and the one wiping case
runs last; the runner prints its five slowest cases, so the next person tuning
this can see where the minutes went.

**Do not walk onboarding to get a board — call `built_board()`.** Walking it
takes about four minutes, and most cases only want a finished plan to act on,
not the flow itself. `built_board()` walks it once, saves the SQLite files, and
restores them in seconds for every later case *and every later run*. Two files
each carried their own copy of that walk before this existed, and the suite
spent over half its time rebuilding a board it already had.

The exception is a case about onboarding ITSELF — those call `fresh_install()`
and walk it deliberately, because a restored board skips the screens they exist
to check.

**To test against a different board, restore a different snapshot.** `board.build()`
reads `E2E_SNAPSHOT`, so the whole suite can run against a real board pulled off
a phone:

```bash
python3 e2e/pull_device_db.py          # copies the phone's board (read-only)
E2E_SNAPSHOT=device python3 e2e/run.py # runs everything against it
```

Delete `e2e/artifacts/snapshots/board-*.db` to force a rebuild after a change to
onboarding itself — nothing else invalidates that cache automatically.

**Build your own board; do not inherit one.** A case that assumed the previous
test had left bills on the dashboard failed when it found none — which proved
nothing about the feature under test and cost time chasing a phantom bug. Cases
must be runnable in any order, and individually.

**Do not assert on a truncated list.** The onboarding preview names only the
first few lines and collapses the rest to "+N more", so a missing chip there
says nothing about the plan. Assert against a screen that shows everything.

**A field showing text is not a field holding a value.** XCUITest reports a
placeholder as the element's `value`, so the loan form's rate reads "11.5"
before anything is typed. Write every field you depend on, even one that appears
to be filled already.

**Beware controls that re-render the form you are filling.** Picking a lender on
the loan form re-suggests the loan's name, which re-renders it — doing that
midway through entry left the amount field holding "700" instead of "7,200,000".
The failure looked exactly like broken loan maths; the app was computing
correctly the whole time. Set such controls before you start typing, or not at
all.

**A sheet leaves the dashboard on screen behind it.** `BALANCE` is visible while
the board is completely unreachable, so "am I on the dashboard?" cannot be
answered by looking for it. `_settle_on_dashboard()` therefore closes any sheet
*before* checking, and `open_settings()` verifies it arrived instead of trusting
its own tap.

This cost a confusing failure: the SMS case left "Paste a message" open, and the
next case wanting Settings tapped a keyboard key through the sheet, never left
the dashboard, and failed with "settings shows no sections" — which reads as a
broken Settings screen rather than a tap that went nowhere. If a case fails
claiming a screen is empty, screenshot it before believing the assertion.

**A snapshot is written once, then only read.** Re-saving one on a later call
looks harmless and is not: `blank_slate()` briefly re-saved on every fallthrough,
so the first time it fell through with the app still on its splash screen it
overwrote the blank fixture with a *finished board*. Every later persona then
restored that and failed looking for a bank tile — on a device whose database
was not blank at all. The failures pointed at the tiles, the cache was the
culprit, and it survived across runs.

Two habits follow. Guard any `snapshot_db()` behind "did this exist already?",
and when a cached case fails inexplicably, check the fixture before the app:

```bash
sqlite3 e2e/artifacts/snapshots/blank-onboarding.db "select count(*) from cards"
```

Delete a snapshot to force a rebuild — nothing invalidates one automatically.

**Restoring data does not reset the SCREEN.** Picking a bank in onboarding
writes no row — `cards` stays empty until the plan is committed — so the
selection lives in React state, which survives both a database restore and a
relaunch. A persona case inherited the previous persona's bank and saw "3
accounts selected" after choosing two. `blank_slate()` checks for this and wipes
for real when it finds it; if you cache any other mid-flow screen, check what it
holds rather than assuming an empty database means an empty form.

**SPENT is not the sum of transactions.** The dashboard hero is `paidMinor`, the
planned cost of lines marked *paid* — so spending 2,000 against a line planned
at 8,000 settles it and the hero moves by 8,000. That is correct for a funding
board: a settled bill has taken its whole planned amount out of what still has
to be moved. A case asserting the hero equals `SUM(amount_minor)` failed against
an app that was behaving properly. Check a figure's derivation in
`planning.ts` before trusting an assertion about it.

## Known environment quirk

Dev builds float the **Expo dev-client gear** above the app, and it swallows
taps beneath it. `tap()` detects this and aims elsewhere within the same
element. It cost a false "this bank tile won't select" bug report before the
workaround existed — the tile was fine. The gear does not ship in release
builds.
