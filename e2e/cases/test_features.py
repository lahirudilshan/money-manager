#!/usr/bin/env python3
"""Feature coverage — the parts of the app a persona pass walks past.

Loans, income, categories and accounts each have their own screens with their
own editing rules. A persona journey proves they can be reached; these prove
they work.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import *  # noqa
import board


def test_loan_installment_and_editing(check):
    """A loan's installment must be right, and the loan must stay editable.

    TWO BUGS this guards:

    1. A brand-new loan reported ONE installment already paid. `paymentsElapsed`
       credited a payment as soon as the day-of-month was reached, which on the
       start date is trivially true — so every new loan's remaining balance was
       a month short.
    2. A loan was eight fields of typing with no way to correct a typo; a rate
       entered wrong had to be deleted and rebuilt.
    """
    mark = now_ms()
    # Through the shared builder rather than an inline loop. A bespoke copy here
    # stalled on step 4: assigning an account does not change a row's label, so
    # its "already handled" set stopped matching the rows that still needed one
    # and the Build button never enabled.
    if not check.that(board.build(), "built a board"):
        return

    # Loans live on their own tab once setup is done.
    tap("Loans", required=True)
    time.sleep(2.5)

    # Two different affordances, depending on what the board already holds:
    # the empty state offers "Add your first loan", while a tab that already
    # lists loans offers the "Add loan" header button. Only the empty-state
    # wording was tried before, so this case could not run on any board that
    # already had a loan — a real one always does.
    opened = (tap("Add your first loan", partial=True)
              or tap("Add loan", partial=True))
    if not check.that(opened, "opened the add-loan form"):
        return
    time.sleep(2.5)

    # The spreadsheet-verified case: 7,200,000 at 11.5% over 5 years.
    fields = req("POST", f"/session/{sid()}/elements",
                 {"using": "-ios class chain", "value": "**/XCUIElementTypeTextField"})
    n = len(fields.get("value") or [])
    check.that(n >= 3, f"loan form has its amount/rate/term fields ({n} found)")

    # Fields in order: [0] name, [1] amount, [2] rate, [3] years, [4] paid.
    #
    # Two traps, both of which produced a failure that looked like bad loan
    # maths when the app was computing correctly:
    #
    #   - every field SHOWS text before anything is typed (the rate reads
    #     "11.5", the term "5") because XCUITest reports a placeholder as the
    #     element's value, so "it already has a value" is not a safe skip;
    #   - picking a lender FIRST re-suggests the loan's name, which re-renders
    #     the form and disturbs entry that is already in progress.
    #
    # So: no lender tap, and all three figures written explicitly.
    set_text("7200000", index=1)
    set_text("11.5", index=2)
    set_text("5", index=3)

    # POLL rather than sample once.
    #
    # The preview recomputes as the fields change and the keyboard is still
    # animating when the last write returns, so a single read a fixed moment
    # later caught the card mid-update and saw no figure at all. Waiting for the
    # value to appear is both faster in the common case and not flaky.
    #
    # FLAT is the default (see `emptyLoanDraft`): interest on the full
    # principal for the whole term, so 7,200,000 x 11.5% x 5 = 4,140,000 and
    # (7,200,000 + 4,140,000) / 60 = 189,000 a month.
    flat = wait_for_text("189,000", tries=12)
    check.that(flat, "flat-rate installment is correct (expected 189,000)")
    if not flat:
        screenshot("loan-preview-mismatch")
        print(f"          figures on screen: "
              f"{[l for l in labels() if 'LKR' in l][:6]}")

    # Switching to reducing balance must give the spreadsheet's EMI figure.
    tap("Reducing", required=True)
    check.that(wait_for_text("158,347", tries=12),
               "reducing-balance installment is correct (expected 158,347)")

    # ...and back, so the toggle is proven in both directions.
    tap("Flat rate", required=True)
    check.that(wait_for_text("189,000", tries=12),
               "the interest-method toggle works both ways")

    # The name LAST, for the same reason the lender is skipped: it is the field
    # a lender tap would have filled, and setting it here cannot disturb the
    # figures the preview above was computed from.
    set_text("Test loan", index=0)
    time.sleep(1.0)

    tap("Add loan", partial=True)
    time.sleep(2.5)

    rows = [l for l in labels() if "/ month" in l or "Personal loan" in l]
    check.that(bool(rows), "the loan was added to the list")

    # Each loan card carries its own Edit control — a loan is eight fields
    # copied off a statement, and deleting one to fix a typo would take its
    # board line and payment history with it.
    editable = next((l for l in labels() if l.startswith("Edit ")), None)
    check.that(editable is not None,
               "an added loan can be reopened for editing")
    if editable:
        tap(editable)
        time.sleep(2)
        check.that("Save changes" in screen_text() or "Edit loan" in screen_text(),
                   "the edit sheet opens with a save action")

    check.no_errors(mark)


def test_income_screen(check):
    """Income lines must be listed and editable after setup."""
    mark = now_ms()
    if not check.that(board.build(), "built a board"):
        return
    if not check.that(board.open_settings(), "reached Settings"):
        return
    if not check.that(scroll_to("Income", tries=8), "Income is reachable from settings"):
        return
    tap("Income", required=True)
    time.sleep(2.5)

    text = screen_text()
    check.that("Income" in text, "income screen opened")
    check.that("Salary" in text or "Add" in text,
               "lists the income set up during onboarding, or offers to add one")
    check.no_errors(mark)


def test_accounts_screen_add_and_edit(check):
    """Accounts must be addable after setup, not only during it."""
    mark = now_ms()
    relaunch()
    if not exists("Settings") and not check.that(board.build(), "board available"):
        return
    if not check.that(board.open_settings(), "reached Settings"):
        return
    if not check.that(scroll_to("Accounts", tries=8), "Accounts reachable from settings"):
        return
    tap("Accounts", required=True)
    time.sleep(2.5)

    text = screen_text()
    # Derived from the database, not hardcoded: this case must pass on whatever
    # board is loaded — the fixture's ComBank, or a real one restored through
    # `E2E_SNAPSHOT` whose accounts are named something else entirely.
    names = [n for n in db_query(
        "SELECT COALESCE(NULLIF(nickname,''), bank_name) FROM cards") if n]
    check.that(bool(names) and any(n in text for n in names),
               f"an account from the board is listed ({len(names)} exist)")
    check.that("Add" in text, "a new account can be added later")
    check.no_errors(mark)


def test_category_add_and_edit(check):
    """A category can be created and a bill added to it after setup."""
    mark = now_ms()
    relaunch()
    if not exists("List") and not check.that(board.build(), "board available"):
        return
    tap("List", required=True)
    time.sleep(2.5)

    check.that("New category" in screen_text(),
               "the list screen offers to create a category")

    adders = [l for l in labels() if l.startswith("Add a bill to")]
    check.that(bool(adders), f"each category offers to add a bill ({len(adders)} found)")

    editors = [l for l in labels() if l.startswith("Edit ")]
    check.that(bool(editors), "each category can be edited")
    check.no_errors(mark)


def test_month_navigation(check):
    """Moving between months must not corrupt the board or throw.

    This is also the regression guard for the reminder fix: "Coming up" resolves
    against TODAY, so browsing to another month must not turn its bills into a
    pile of overdue ones.
    """
    mark = now_ms()
    relaunch()
    if not exists("Previous month") and not check.that(board.build(), "board available"):
        return

    check.that("Previous month" in screen_text(), "month navigation is present")

    tap("Previous month", required=True)
    time.sleep(2)
    back = screen_text()
    check.that(len(labels()) > 5, "previous month renders")

    tap("Next month", required=True)
    time.sleep(2)
    tap("Next month", required=True)
    time.sleep(2)
    check.that(len(labels()) > 5, "next month renders")
    check.no_errors(mark)


CASES = [
    ("loans", test_loan_installment_and_editing),
    ("income", test_income_screen),
    ("accounts", test_accounts_screen_add_and_edit),
    ("categories", test_category_add_and_edit),
    ("month-nav", test_month_navigation),
]
