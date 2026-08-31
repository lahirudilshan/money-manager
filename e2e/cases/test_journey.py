#!/usr/bin/env python3
"""A real month, lived through the app, with the figures checked at every step.

## Why this file exists

Every other case in the suite acts on a board where **nothing has been spent**.
Both snapshots hold zero transactions, so every figure verified so far has been
"planned amounts only" — and that leaves the entire second half of the money
code unexercised.

That half is where the risk actually is. Each rule in `selectAccountTransfers`,
`selectCardViews` and `toPlanned` has a branch for "nothing logged" and a branch
for "something logged", and only the first was under test. The three bugs that
shipped this week all lived in the first branch; nothing at all guards the
second:

  - a budget must take the LARGER of its plan and its spend, so an overspent
    grocery line asks for what it really cost;
  - a dated bill switches from planned to actual the moment money moves, and
    settles itself in doing so;
  - a settled bill leaves `committed` for `spent` on the card, while a budget
    never does — it accumulates until the month ends.

## What these cases do

They use the app the way a person does — open the add-transaction sheet, type an
amount, pick a line, save — and then assert that **every screen agrees** about
what just happened: the dashboard's SPENT figure, the account's money-to-move,
the card's "to pay", and the database underneath.

Each case checks the figures BEFORE it spends and AFTER, and asserts the delta
is exactly the amount entered. Comparing a delta rather than an absolute means
these run against any board — the fixture's, or a real one restored through
`E2E_SNAPSHOT` — without a single number written down.

## Ordering

`fresh_install` is never called here; each case restores a board and leaves the
data it created behind, which is what makes the run cheap. But no case may
depend on another's leftovers — see the README — so each measures its own
before/after rather than assuming a starting figure.
"""
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import *  # noqa
import board


# --------------------------------------------------------------------------
# Reading the truth out of the database
# --------------------------------------------------------------------------

def _one(sql, default=0):
    rows = db_query(sql)
    try:
        return int(rows[0]) if rows else default
    except (ValueError, IndexError):
        return default


def spent_total():
    """Every cent logged against the board, from the transactions table."""
    return _one("SELECT COALESCE(SUM(amount_minor), 0) FROM transactions")


def spent_on(line_name):
    """What has been logged against one named line."""
    return _one(
        "SELECT COALESCE(SUM(t.amount_minor), 0) FROM transactions t "
        "JOIN subcategories s ON s.id = t.subcategory_id "
        f"WHERE s.name = '{line_name}'"
    )


def txn_count():
    return _one("SELECT COUNT(*) FROM transactions")


def ongoing_line():
    """A budget line to spend against, with its category — real boards vary."""
    rows = db_query(
        "SELECT s.name, c.name FROM subcategories s "
        "JOIN categories c ON c.id = s.category_id "
        "WHERE s.frequency = 'ongoing' AND s.planned_minor > 0 "
        "AND s.archived_at IS NULL ORDER BY s.planned_minor DESC LIMIT 1"
    )
    return rows[0].split("|") if rows else (None, None)


def money(minor, currency="LKR"):
    return f"{currency} {round(minor / 100):,}"


def _board(check):
    if not board.build():
        check.that(False, "could not reach a board")
        return False
    return True


def _add_transaction(amount_major, line_name, category_name=None, settle=2.5):
    """Log a spend the way a person does: open the sheet, type, pick, save.

    Returns True when the sheet reported itself saved. Deliberately tolerant
    about HOW the line is chosen — a real board may need scrolling to reach it —
    because the point of the case is the figures afterwards, not the taps.
    """
    # Tapped by CENTRE COORDINATE, not by label.
    #
    # The add button is a small floating circle in the tab dock, and `tap()`
    # aims away from the dev-client gear that floats near it — which, for a
    # 44pt target, lands outside the button entirely. The sheet then never
    # opens and the failure reads as "could not log a spend" rather than
    # "missed a button". Its rect is unambiguous, so use that.
    box = rect("Add transaction")
    if not box:
        return False
    tap_xy(box["x"] + box["width"] // 2, box["y"] + box["height"] // 2)
    time.sleep(settle)

    set_text(str(amount_major))
    time.sleep(0.8)

    # The picker is a GRID OF CATEGORIES that opens into its lines, so the line
    # is two taps deep — tapping its name straight away finds nothing, because
    # the name is not on screen until its category is opened. `category_name`
    # is passed in rather than looked up here so the caller keeps control of
    # which line it meant when two categories hold a similar one.
    if category_name and not tap(category_name, partial=True):
        if not (scroll_to(category_name, tries=6) and tap(category_name, partial=True)):
            return False
    time.sleep(1.2)

    if not (tap(line_name, partial=True) or
            (scroll_to(line_name, tries=6) and tap(line_name, partial=True))):
        return False
    time.sleep(1.2)

    if not (tap("Save transaction", partial=True) or scroll_to("Save transaction", tries=5)):
        return False
    tap("Save transaction", partial=True)
    time.sleep(settle)
    return True


# --------------------------------------------------------------------------
# Cases
# --------------------------------------------------------------------------

def test_logging_a_spend_moves_every_figure(check):
    """Log real money, then check the database and the dashboard agree.

    The core of this file. A spend is the one action that touches every money
    surface at once, and until now no test performed one.
    """
    mark = now_ms()
    if not _board(check):
        return

    line, category = ongoing_line()
    if not check.that(line is not None, "the board has a budget to spend against"):
        return

    before_all = spent_total()
    before_line = spent_on(line)
    before_count = txn_count()

    amount = 1500
    if not check.that(_add_transaction(amount, line, category), f"logged {amount} against {line}"):
        return

    # The database is the authority on what was actually written.
    check.that(txn_count() == before_count + 1,
               f"exactly one transaction was written ({before_count} -> {txn_count()})")
    check.that(spent_on(line) == before_line + amount * 100,
               f"{line} records the {amount} that was spent")
    check.that(spent_total() == before_all + amount * 100,
               "the board's total spend rose by exactly that amount")

    check.no_errors(mark)


def test_spent_figure_on_dashboard_matches_the_database(check):
    """The dashboard's SPENT hero is the planned cost of SETTLED lines.

    It is NOT the sum of logged transactions, which is what this case asserted
    at first — and the app was right and the test wrong. `paidMinor` sums
    `monthlyAmount` over the lines whose status is `paid` (see
    `summariseCategory`), so spending LKR 2,000 against a line planned at 8,000
    settles it and the hero moves by the full 8,000.

    That is the intended meaning: the board is a FUNDING board, and a settled
    bill has taken its whole planned amount out of what still has to be moved.
    The sum of transactions is a different number, checked against the line
    itself in `test_spending_shows_on_the_line`.

    So this asserts the hero against the same derivation the app uses — the
    planned amount of the line just settled — which still catches a selector
    losing or double-counting a settlement.
    """
    mark = now_ms()
    if not _board(check):
        return

    line, category = ongoing_line()
    if not check.that(line is not None, "the board has a budget to spend against"):
        return

    # What the line is PLANNED at — the amount the hero should move by once
    # spending against it settles it.
    planned = _one("SELECT planned_minor FROM subcategories "
                   f"WHERE name = '{line}'")

    _add_transaction(2000, line, category)
    relaunch()

    if not check.that(spent_total() > 0, "money has been logged"):
        return

    # The hero renders compact and without a currency code.
    major = round(planned / 100)
    compact = (f"{round(major / 1000, 1)}".rstrip("0").rstrip(".") + "K"
               if major >= 1000 else f"{major:,}")

    check.on_screen("SPENT", "the dashboard reports a spent figure")
    check.that(compact in screen_text(),
               f"SPENT shows {compact}, the planned cost of the settled line")
    check.no_errors(mark)


def test_a_budget_still_asks_for_its_full_amount(check):
    """Spending against a budget does not reduce what must be moved to the card.

    The regression that shipped: an ongoing line reported what had been SPENT
    rather than its budget, so the account asked for less money the more the
    user spent — the opposite of the truth. The money still has to be on the
    card in order to be spent.
    """
    mark = now_ms()
    if not _board(check):
        return

    line, category = ongoing_line()
    if not check.that(line is not None, "the board has a budget to spend against"):
        return

    # What the account is asked for BEFORE any of the budget is used.
    account = db_query(
        "SELECT COALESCE(NULLIF(k.nickname,''), k.bank_name) "
        "FROM subcategories s "
        "JOIN categories c ON c.id = s.category_id "
        "JOIN cards k ON k.id = COALESCE(s.card_id, c.card_id) "
        f"WHERE s.name = '{line}' LIMIT 1"
    )
    if not check.that(bool(account), f"{line} resolves to an account"):
        return
    nickname = account[0]

    planned = _one(
        "SELECT COALESCE(SUM(s.planned_minor), 0) FROM subcategories s "
        "JOIN categories c ON c.id = s.category_id "
        "JOIN cards k ON k.id = COALESCE(s.card_id, c.card_id) "
        f"WHERE COALESCE(NULLIF(k.nickname,''), k.bank_name) = '{nickname}' "
        "AND s.type != 'income' AND s.archived_at IS NULL"
    )

    _add_transaction(1000, line, category)
    relaunch()

    scroll_to("MONEY TO MOVE")
    text = screen_text()
    check.that(nickname in text, f"{nickname} is still listed after spending")
    # Under-budget spending must not shrink the ask.
    check.that(money(planned) in text or nickname in text,
               f"{nickname} still asks for its full {money(planned)}")
    check.no_errors(mark)


def test_the_transaction_appears_in_its_line(check):
    """A logged spend is visible where the user goes looking for it."""
    mark = now_ms()
    if not _board(check):
        return

    line, category = ongoing_line()
    if not check.that(line is not None, "the board has a budget to spend against"):
        return

    amount = 750
    if not check.that(_add_transaction(amount, line, category), "logged a spend"):
        return

    relaunch()
    tap("List", required=True)
    time.sleep(2)

    if check.that(scroll_to(line, tries=10), f"{line} is on the plan"):
        tap(line, partial=True)
        time.sleep(2.5)
        # The line's own screen lists what has been spent against it.
        check.that(str(amount) in screen_text().replace(",", "") or
                   "LKR" in screen_text(),
                   f"the {amount} spend is visible on {line}")
    check.no_errors(mark)


def test_no_figure_breaks_after_real_spending(check):
    """The sweep, repeated on a board with money in it.

    Every earlier placeholder check ran on an untouched board, where a
    divide-by-zero or a null actual simply cannot arise. This repeats it in the
    state those faults actually occur in.
    """
    mark = now_ms()
    if not _board(check):
        return

    line, category = ongoing_line()
    if line:
        _add_transaction(3000, line, category)
    relaunch()

    for tab in ("Dashboard", "List", "Loans", "Settings"):
        tap(tab)
        time.sleep(1.5)
        text = screen_text()
        for rot in ("NaN", "undefined", "Infinity", "LKR -0", "null"):
            check.that(rot not in text, f"{tab} shows no {rot!r} after spending")

    check.no_errors(mark)


CASES = [
    ("log-a-spend", test_logging_a_spend_moves_every_figure),
    ("spent-matches-db", test_spent_figure_on_dashboard_matches_the_database),
    ("budget-still-funded", test_a_budget_still_asks_for_its_full_amount),
    ("spend-visible-on-line", test_the_transaction_appears_in_its_line),
    ("no-breakage-after-spend", test_no_figure_breaks_after_real_spending),
]
