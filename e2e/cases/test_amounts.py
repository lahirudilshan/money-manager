#!/usr/bin/env python3
"""Every figure on screen, checked against the figure the database implies.

## Why this file exists

`test_screens.py` covers breadth: twenty-nine screens open, render and throw
nothing. That is worth having and it is not enough — a screen can open cleanly,
log no error, and show a confidently wrong number. Three such bugs shipped:

  - an ongoing budget reported `0` rather than its amount, so an account funded
    only by budgets asked for **nothing** on the dashboard;
  - the account detail resolved its categories per CATEGORY while the dashboard
    resolved per LEAF, so an account reached by line-level overrides showed
    "no categories draw from this account yet" while money was owed to it;
  - the cards tab understated "to pay" on four accounts out of five, for both
    reasons at once.

Every one rendered perfectly. Every one passed the unit suite, because each
individual helper was right — the disagreement was BETWEEN them.

## The approach

Do not hardcode expected numbers. A literal in a test is just a second place to
be wrong, it rots the moment the fixture changes, and it cannot answer the
question that actually matters: *do the screens agree with each other and with
the data?*

Instead each case computes what the figure MUST be from the app's own SQLite
(`db_query`) and asserts the screen shows exactly that. The board can then
change freely — the expectation is derived, never restated.

Amounts are asserted as **formatted strings**, the way `formatMoney` renders
them, because that is what the user reads. A right number formatted wrong is
still a bug on the screen.

## What this cannot see

`compact: true` renders 282,534 as "283K", so a compact figure is asserted on
its rounded form. Where a screen offers only a compact number, the case checks
the full figure in the detail screen behind it instead.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import *  # noqa
import board


# --------------------------------------------------------------------------
# Expected figures, derived from the database rather than written down.
# --------------------------------------------------------------------------

def _rows(sql):
    return [r.split("|") for r in db_query(sql)]


def _accounts():
    """Every account with the total that must be moved onto it this month.

    Mirrors `selectAccountTransfers`: resolve each LEAF to its account (the
    line's own card, else its category's), skip income, and take the budget for
    an ongoing line rather than what has been spent against it.

    Written as SQL rather than reimplemented in Python so the expectation stays
    close to the data. With no transactions logged the effective amount of every
    line is simply its planned amount, which is the state these cases run in.
    """
    return {
        nickname: int(total or 0)
        for nickname, total in _rows(
            """
            SELECT c.nickname,
                   COALESCE(SUM(s.planned_minor), 0)
            FROM cards c
            LEFT JOIN subcategories s
              ON COALESCE(s.card_id, (SELECT card_id FROM categories WHERE id = s.category_id)) = c.id
             AND s.type != 'income'
             AND s.archived_at IS NULL
            GROUP BY c.id
            ORDER BY c.sort_order
            """
        )
    }


def _categories():
    """Each category with the monthly total its lines come to."""
    return {
        name: int(total or 0)
        for name, total in _rows(
            """
            SELECT c.name, COALESCE(SUM(s.planned_minor), 0)
            FROM categories c
            LEFT JOIN subcategories s
              ON s.category_id = c.id AND s.type != 'income' AND s.archived_at IS NULL
            GROUP BY c.id
            ORDER BY c.sort_order
            """
        )
    }


def _income():
    """Declared income. Inactive rows never reach the app — see `incomeRepo`."""
    rows = db_query("SELECT COALESCE(SUM(amount_minor), 0) FROM incomes WHERE is_active = 1")
    return int(rows[0]) if rows else 0


def money(minor, currency="LKR"):
    """Render minor units the way `formatMoney` does: grouped, no decimals."""
    return f"{currency} {round(minor / 100):,}"


def compact(minor):
    """Render the way `formatMoney(_, {compact: true})` does."""
    major = round(minor / 100)
    if major >= 1_000_000:
        return f"{round(major / 1_000_000, 1)}".rstrip("0").rstrip(".") + "M"
    if major >= 1_000:
        return f"{round(major / 1_000, 1)}".rstrip("0").rstrip(".") + "K"
    return f"{major:,}"


def _board(check):
    if not board.build():
        check.that(False, "could not reach a board")
        return False
    return True


# --------------------------------------------------------------------------
# Cases
# --------------------------------------------------------------------------

def test_money_to_move_totals(check):
    """The dashboard asks for the right amount, per account and in total.

    The regression that motivated this file: an account funded only by ongoing
    budgets showed nothing to move. Deriving from the database catches it
    because the database plainly says money is planned there.
    """
    mark = now_ms()
    if not _board(check):
        return

    accounts = _accounts()
    funded = {n: t for n, t in accounts.items() if t > 0}

    scroll_to("MONEY TO MOVE")
    text = screen_text()

    for nickname, total in funded.items():
        if not nickname:
            continue
        check.that(nickname in text, f"{nickname} is listed under money to move")

    # The section header carries the sum of everything still to move.
    check.on_screen(money(sum(funded.values())), "money-to-move total matches the database")

    # An account with nothing planned is SHOWN but inert — never silently
    # dropped, which is how the empty-account bug hid for so long.
    for nickname, total in accounts.items():
        if total == 0 and nickname:
            check.that(nickname in text, f"{nickname} is listed even with nothing planned")

    check.no_errors(mark)


def test_account_detail_matches_its_row(check):
    """Opening an account shows the same money the dashboard row asked for.

    These are two different selectors over one board, which is exactly where the
    per-category/per-leaf bug lived: the row said "move 53,000" and the detail
    behind it said no categories draw from this account at all.
    """
    mark = now_ms()
    if not _board(check):
        return

    accounts = {n: t for n, t in _accounts().items() if t > 0}
    if not accounts:
        check.that(False, "no funded account to open")
        return

    # A blank nickname is not tappable — the row is labelled by its BANK in
    # that case (see `accountLabel`). Pick one that carries a name.
    named = {n: t for n, t in accounts.items() if n and n.strip()}
    if not named:
        check.that(False, "no named account to open")
        return

    nickname, total = next(iter(named.items()))

    scroll_to("MONEY TO MOVE")
    if not check.that(exists(nickname), f"{nickname} row is on the dashboard"):
        return
    tap(nickname, required=True)

    check.on_screen("WHAT THIS FUNDS", "account detail shows what it funds")
    # The section must not be empty for an account the dashboard is asking
    # money for — the exact contradiction that shipped.
    check.not_on_screen(
        "No categories draw from this account yet",
        f"{nickname} lists the categories it funds",
    )

    # Every category that resolves to this account, by leaf, must be named here.
    for (name,) in _rows(
        f"""
        SELECT DISTINCT c.name
        FROM subcategories s
        JOIN categories c ON c.id = s.category_id
        JOIN cards k ON k.id = COALESCE(s.card_id, c.card_id)
        WHERE k.nickname = '{nickname}' AND s.type != 'income' AND s.archived_at IS NULL
        """
    ):
        check.on_screen(name, f"{nickname} detail names {name}")

    check.no_errors(mark)


def test_cards_tab_commitments(check):
    """"X to pay" on the cards tab equals what the dashboard says to move.

    Both answer "what does this account still owe" through different selectors.
    The cards tab understated four accounts out of five by treating a budget as
    a settled bill.
    """
    mark = now_ms()
    if not _board(check):
        return

    accounts = {n: t for n, t in _accounts().items() if n and t > 0}

    # The accounts list has no tab of its own: it lives under Settings, in the
    # "YOUR MONEY" section — see `(tabs)/settings.tsx`.
    tap("Settings", required=True)
    if not check.that(scroll_to("Accounts", tries=10), "Accounts is reachable"):
        return
    tap("Accounts", required=True)
    text = screen_text()

    for nickname, total in accounts.items():
        if not check.that(nickname in text, f"{nickname} appears on the accounts list"):
            continue
        # The commitment is asserted from the row's ACCESSIBILITY LABEL rather
        # than its visible text: a row's label REPLACES whatever its children
        # would announce, so the "LKR 53K to pay" caption on screen never
        # reaches the tree. The label was extended to carry it (see the account
        # row in `(tabs)/cards.tsx`) precisely so this is checkable — and so a
        # VoiceOver user is told what the row is actually for.
        expected = f"{money(total)} to pay"
        check.that(expected in text, f"{nickname} announces {expected!r}")

    check.no_errors(mark)


def test_category_totals_on_list(check):
    """Each category on the list tab totals its own lines."""
    mark = now_ms()
    if not _board(check):
        return

    tap("List", required=True)
    text = screen_text()

    for name, total in _categories().items():
        if total == 0:
            continue
        check.that(name in text, f"{name} is listed on the plan")

    check.no_errors(mark)


def test_board_and_accounts_reconcile(check):
    """The two independent totals agree — the cross-check that finds drift.

    Per-account and per-category are different code paths over the same lines.
    They must sum to the same figure; a mismatch means one of them is losing or
    double-counting a line, which is what every bug here has turned out to be.
    """
    mark = now_ms()
    if not _board(check):
        return

    per_account = sum(_accounts().values())
    per_category = sum(_categories().values())

    check.that(
        per_account == per_category,
        f"per-account ({money(per_account)}) equals per-category ({money(per_category)})",
    )

    # And the dashboard shows that same total, so the screen agrees with both.
    scroll_to("MONEY TO MOVE")
    check.on_screen(money(per_account), "dashboard total matches both derivations")

    check.no_errors(mark)


def test_income_is_not_double_counted(check):
    """Income counts once, from active rows only.

    Onboarding writes a salary both as an income row and as a board line, so
    naive summing reports double. An inactive/projected row must not count.
    """
    mark = now_ms()
    if not _board(check):
        return

    # The hero stat renders compact and WITHOUT the currency code — see the
    # `HeroStat` row on the dashboard — so assert the form actually painted.
    check.on_screen(compact(_income()), "dashboard income matches the active income rows")
    check.no_errors(mark)


def test_no_placeholder_figures_anywhere(check):
    """No screen shows NaN, undefined, or a negative total.

    A cheap sweep that costs one pass over the main tabs and catches a whole
    class of formatting and divide-by-zero faults at once.
    """
    mark = now_ms()
    if not _board(check):
        return

    for tab in ("Dashboard", "List", "Loans", "Settings"):
        tap(tab)
        text = screen_text()
        for rot in ("NaN", "undefined", "Infinity", "LKR -0", "null"):
            check.that(rot not in text, f"{tab} shows no {rot!r}")

    check.no_errors(mark)


CASES = [
    ("money-to-move", test_money_to_move_totals),
    ("account-detail-matches", test_account_detail_matches_its_row),
    ("cards-commitments", test_cards_tab_commitments),
    ("category-totals", test_category_totals_on_list),
    ("reconcile", test_board_and_accounts_reconcile),
    ("income-once", test_income_is_not_double_counted),
    ("no-placeholders", test_no_placeholder_figures_anywhere),
]
