#!/usr/bin/env python3
"""Regressions — one case per bug already found and fixed.

Every test here failed against a real build. They exist so the same defect
cannot come back quietly, and each names the specific mistake it guards.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import *  # noqa


def test_fresh_install_can_finish_onboarding(check):
    """A brand-new device must be able to commit a plan.

    THE BUG: `subcategories` was missing `house_scoped`, so committing the plan
    threw "table subcategories has no column named house_scoped" and setup died
    on its last step. `ensureAdditiveColumns()` ran BEFORE the CREATE TABLE DDL,
    so on a new device every table-exists guard was false and the pass did
    nothing; the DDL then built the table without the column.

    Upgraded devices were unaffected — which is exactly why it survived. Only a
    genuinely fresh install reproduces it, so this test wipes the database.
    """
    mark = now_ms()
    fresh_install()

    check.on_screen("Where do you bank?", "onboarding starts on a fresh install")
    tap("Commercial Bank of Ceylon", required=True)
    tap("Continue", required=True)
    tap("Build my plan", required=True)      # step 2 -> categories
    tap("Continue", required=True)           # categories -> plan

    check.on_screen("Set up your plan", "reached the plan step")

    # Give every line an account; amounts stay blank on purpose (see below).
    _assign_accounts("Commercial Bank")

    tap("Build my plan", required=True)
    time.sleep(3)

    check.that(scroll_to("loans or leases", tries=6),
               "plan committed and reached the loans step")
    check.no_errors(mark)

    cols = db_query("PRAGMA table_info(subcategories);")
    names = [c.split("|")[1] for c in cols if "|" in c]
    check.that("house_scoped" in names, "subcategories.house_scoped exists")
    check.that("house_id" in names, "subcategories.house_id exists")


def test_plan_amount_is_optional(check):
    """Setup must complete with no plan amounts entered.

    THE BUG (design): every line was required to carry a figure. Some lines have
    no plannable amount at all — a spending budget accumulates whatever its
    entries come to — and a user who does not know their water bill yet is
    forced to invent one, which then looks like a real budget forever.

    The ACCOUNT is still required for ordinary bills: the per-account transfer
    rows are built by grouping lines by it, so a line with none is silently left
    out of the total.
    """
    mark = now_ms()
    fresh_install()

    tap("Commercial Bank of Ceylon", required=True)
    tap("Continue", required=True)
    tap("Build my plan", required=True)
    tap("Continue", required=True)

    _assign_accounts("Commercial Bank")

    text = screen_text()
    check.that("still need an account" not in text,
               "account requirement satisfied")
    check.that("without a plan amount" in text,
               "footer reports missing amounts as informational")
    check.that("you can add these later" in text,
               "footer says amounts can wait")

    tap("Build my plan", required=True)
    time.sleep(3)
    check.that(scroll_to("loans or leases", tries=6),
               "finished setup with zero plan amounts")
    check.no_errors(mark)


def test_dashboard_lists_upcoming_bills(check):
    """"Coming up" must show bills that are coming up.

    THE BUG: the section listed only overdue + due-within-7-days. On any day
    more than a week before the month's bills fall due, a board full of unpaid
    rent rendered a green "Nothing due right now" — the most reassuring possible
    way to be wrong.
    """
    mark = now_ms()
    _complete_onboarding_with_amounts()

    check.on_screen("COMING UP", "dashboard has a Coming up section")
    check.not_on_screen("Nothing due right now",
                        "does not claim nothing is due while bills are unpaid")

    rows = [l for l in labels() if ", In " in l and "LKR" in l]
    check.that(len(rows) > 0, f"lists actual bills ({len(rows)} shown)")
    check.no_errors(mark)


def test_delete_subcategory_does_not_crash(check):
    """Deleting a line must not take the app down.

    THE BUG: a `useMemo` sat BELOW the "not found" early return. Deleting the
    subcategory flipped that guard on, React counted fewer hooks than the
    previous render, and the app crashed with "Rendered fewer hooks than
    expected" — on an action every user eventually performs.
    """
    mark = now_ms()
    _complete_onboarding_with_amounts()

    tap("List", required=True)
    time.sleep(2.5)

    target = next((l for l in labels() if "Open detail." in l), None)
    check.that(target is not None, "found a line to delete")
    if not target:
        return

    before = len(db_query("SELECT id FROM subcategories;"))
    tap(target, required=True)
    time.sleep(2)

    if not tap(", Delete subcategory", partial=True):
        check.that(False, "delete control present on the line screen")
        return
    time.sleep(1.5)
    tap("Delete", required=True)
    time.sleep(3)

    check.that(len(labels()) > 5, "app is still alive after the delete")
    after = len(db_query("SELECT id FROM subcategories;"))
    check.that(after == before - 1, f"one line removed ({before} -> {after})")
    check.no_errors(mark)


def test_bank_charges_has_no_account(check):
    """Bank fees belong to no single account.

    THE BUG (design): the auto-created bank-charges line was funded from the
    dominant account. Fees are levied by WHICHEVER bank charged them, so pinning
    them to one card piles every fee into that account's transfer total and
    hides the rest.

    Asserted against the database, because "no account" is not visible on screen.
    """
    mark = now_ms()
    _complete_onboarding_with_amounts()

    rows = db_query(
        "SELECT s.name, COALESCE(s.card_id,'(none)'), COALESCE(c.card_id,'(none)') "
        "FROM subcategories s JOIN categories c ON c.id = s.category_id "
        "WHERE s.name LIKE '%charge%';")
    check.that(len(rows) == 1, f"bank-charges line was created automatically ({rows})")
    if rows:
        _, line_card, cat_card = rows[0].split("|")
        check.that(line_card == "(none)", "the line names no account")
        check.that(cat_card == "(none)", "its category names no account either")
    check.no_errors(mark)


def test_onboarding_scrolls_clear_of_pinned_footer(check):
    """The last card on an onboarding step must be reachable.

    THE BUG: `PinnedFooter` overlays the ScrollView rather than sitting below
    it, and five screens padded `space.lg` (16pt) against a footer 100-140pt
    tall. On step 2 that permanently hid the preview card naming the lines the
    user's answers had produced — the entire payoff for answering the questions.
    """
    mark = now_ms()
    fresh_install()

    tap("Commercial Bank of Ceylon", required=True)
    tap("Continue", required=True)
    check.on_screen("A bit about you", "on the about step")

    check.that(scroll_to("lines ready", tries=8),
               "the preview card can be scrolled to")
    check.that(scroll_to("You can add or remove anything", tries=4),
               "the card's caption is reachable, not clipped by the footer")
    check.no_errors(mark)


# --------------------------------------------------------------------- helpers


def _assign_accounts(bank_hint):
    """Give every line an account, leaving plan amounts blank."""
    seen = set()
    for _ in range(30):
        rows = [l for l in labels() if l.endswith(", LKR 0") and l not in seen]
        if not rows:
            break
        row = rows[0]
        seen.add(row)
        if not tap(row):
            continue
        time.sleep(1.0)
        if "Required" in screen_text():
            tap(bank_hint, partial=True)
            time.sleep(0.4)
        tap("Done")
        time.sleep(0.9)


def _complete_onboarding_with_amounts(bank="Commercial Bank of Ceylon",
                                      hint="Commercial Bank"):
    """A finished board with real figures — the starting point for board tests."""
    fresh_install()
    tap(bank, required=True)
    tap("Continue", required=True)
    tap("Build my plan", required=True)
    tap("Continue", required=True)

    seen = set()
    amounts = [50000, 12000, 3000, 2500, 8000, 25000, 4000, 1800, 6000]
    i = 0
    for _ in range(30):
        rows = [l for l in labels() if l.endswith(", LKR 0") and l not in seen]
        if not rows:
            break
        row = rows[0]
        seen.add(row)
        if not tap(row):
            continue
        time.sleep(1.0)
        set_text(amounts[i % len(amounts)])
        if "Required" in screen_text():
            tap(hint, partial=True)
            time.sleep(0.4)
        tap("Done")
        time.sleep(0.9)
        i += 1

    tap("Build my plan", required=True)
    time.sleep(3)
    if scroll_to("loans or leases", tries=6):
        tap("Skip — no loans")
        time.sleep(2)
    if scroll_to("Go to Dashboard", tries=6):
        tap("Go to Dashboard")
        time.sleep(3)


def test_new_loan_shows_zero_payments_made(check):
    """A loan added today has made NO payments.

    THE BUG: `paymentsElapsed` credited an installment as soon as the
    day-of-month was reached, which on the start date compares a date to itself
    and is trivially true. Every brand-new loan therefore reported one payment
    already made, and its remaining balance was a month short.

    Also guards the Loans tab's Edit control, which did not exist: a loan could
    only be corrected by deleting it, taking its board line and payment history
    with it.
    """
    import board

    mark = now_ms()
    if not check.that(board.build(), "built a board"):
        return

    tap("Loans", required=True)
    time.sleep(2.5)
    opened = (tap("Add your first loan", partial=True)
              or tap("Add a loan", partial=True))
    if not check.that(opened, "opened the add-loan form"):
        return
    time.sleep(2.5)

    set_text("7200000", index=1)
    set_text("11.5", index=2)
    set_text("5", index=3)
    # Flat is the default, so this is the figure the preview settles on.
    wait_for_text("189,000", tries=12)
    set_text("Test loan", index=0)
    time.sleep(1.0)
    tap("Add loan", partial=True)
    time.sleep(3)

    text = screen_text()
    check.that("0 of 60 payments made" in text,
               "a loan added today reports 0 payments made, not 1")
    check.that(any(l.startswith("Edit ") for l in labels()),
               "the loan can be edited rather than only deleted")
    check.no_errors(mark)


CASES = [
    ("fresh-install-onboarding", test_fresh_install_can_finish_onboarding),
    ("new-loan-zero-payments", test_new_loan_shows_zero_payments_made),
    ("plan-amount-optional", test_plan_amount_is_optional),
    ("dashboard-coming-up", test_dashboard_lists_upcoming_bills),
    ("delete-subcategory", test_delete_subcategory_does_not_crash),
    ("bank-charges-no-account", test_bank_charges_has_no_account),
    ("footer-clearance", test_onboarding_scrolls_clear_of_pinned_footer),
]
