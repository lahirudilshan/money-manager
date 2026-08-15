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

## Known environment quirk

Dev builds float the **Expo dev-client gear** above the app, and it swallows
taps beneath it. `tap()` detects this and aims elsewhere within the same
element. It cost a false "this bank tile won't select" bug report before the
workaround existed — the tile was fine. The gear does not ship in release
builds.
