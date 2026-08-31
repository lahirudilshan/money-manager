#!/usr/bin/env python3
"""Breadth coverage — every screen opens, renders and does not throw.

The suite grew depth-first around onboarding, because that is where the bugs
were. But onboarding is a one-off; the screens below are where a user actually
lives, and several had NO coverage at all — the cards tab, the transaction
editors, the SMS screens, the fuel add-on, category editing.

These are deliberately shallow. A case here answers "does this screen work at
all" — it opens, shows what it should, and logs no runtime error. Deep
behavioural checks belong in the feature and persona files. Shallow is the
point: it is what makes covering twenty-nine screens affordable.

All of them restore a saved board rather than walking onboarding, so the whole
file costs about as much as one old case.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import *  # noqa
import board


def _board(check):
    """Shared precondition: a finished board, restored from snapshot."""
    if not board.build():
        check.that(False, "could not reach a board")
        return False
    return True


def test_cards_tab(check):
    """The accounts/cards screen — balances and per-account detail."""
    mark = now_ms()
    if not _board(check):
        return

    if not check.that(board.open_settings(), "reached Settings"):
        return
    if not check.that(scroll_to("Accounts", tries=8), "Accounts is reachable"):
        return
    tap("Accounts", required=True)
    time.sleep(2)

    text = screen_text()
    # Derived from the database, not hardcoded: this case must pass on whatever
    # board is loaded — the fixture's ComBank, or a real one restored through
    # `E2E_SNAPSHOT` whose accounts are named something else entirely.
    names = [n for n in db_query(
        "SELECT COALESCE(NULLIF(nickname,''), bank_name) FROM cards") if n]
    check.that(bool(names) and any(n in text for n in names),
               f"an account from the board is listed ({len(names)} exist)")
    check.no_errors(mark)


def test_add_transaction_screen(check):
    """The add-transaction sheet — the most-used editor in the app."""
    mark = now_ms()
    if not _board(check):
        return

    if not check.that(tap("Add transaction", partial=True),
                      "the add-transaction control is reachable"):
        return
    time.sleep(2.5)

    text = screen_text()
    check.that("AMOUNT" in text, "asks for an amount")
    check.that("WHAT WAS IT FOR?" in text or "CATEGORY" in text,
               "asks which line it belongs to")
    check.that("PAID FROM" in text, "asks which account it came from")
    check.that("Save transaction" in text, "offers to save")
    check.no_errors(mark)


def test_category_detail_and_edit(check):
    """Opening a category, and its edit screen."""
    mark = now_ms()
    if not _board(check):
        return

    tap("List", required=True)
    time.sleep(2)

    editor = next((l for l in labels() if l.startswith("Edit ")), None)
    if not check.that(editor is not None, "a category offers an edit control"):
        return
    tap(editor, required=True)
    time.sleep(2.5)

    text = screen_text()
    # Assert the editor is OPEN and offers its real actions, rather than looking
    # for a "NAME" caption: `NameWithIconField` renders its label through a
    # styled `Label`, and the row's own accessibility label shadows the input's,
    # so neither reaches the tree. Checking for the caption tested the chrome
    # and failed on an editor that works perfectly.
    check.that("Edit category" in text, "the category editor opened")
    check.that("Delete category" in text, "the editor offers its destructive action")
    check.no_errors(mark)


def test_new_category_screen(check):
    """Creating a category after setup."""
    mark = now_ms()
    if not _board(check):
        return

    tap("List", required=True)
    time.sleep(2)
    if not check.that(tap("New category", partial=True), "New category opens"):
        return
    time.sleep(2.5)

    text = screen_text()
    check.that("NAME" in text or "Name" in text, "asks for a name")
    check.no_errors(mark)


def test_income_screen_opens(check):
    """The income list, reached from settings."""
    mark = now_ms()
    if not _board(check):
        return

    if not check.that(board.open_settings(), "reached Settings"):
        return
    if not check.that(scroll_to("Income", tries=8), "Income is reachable"):
        return
    tap("Income", required=True)
    time.sleep(2)

    check.that("Income" in screen_text(), "the income screen opened")
    check.no_errors(mark)


def test_sms_screens(check):
    """SMS intake — the app's main labour-saving feature."""
    mark = now_ms()
    if not _board(check):
        return

    if not check.that(tap("Paste SMS", partial=True), "Paste SMS is on the dashboard"):
        return
    time.sleep(2.5)

    text = screen_text()
    check.that("SMS" in text or "paste" in text.lower(),
               "an SMS intake screen opened")
    check.no_errors(mark)


def test_settings_screen(check):
    """Settings itself — every section should render."""
    mark = now_ms()
    if not _board(check):
        return

    if not check.that(board.open_settings(), "reached Settings"):
        return

    text = screen_text()
    for section in ("YOUR MONEY", "PREFERENCES", "APPEARANCE", "SECURITY"):
        check.that(section in text, f"settings shows the {section} section")
    check.no_errors(mark)


def test_fuel_addon(check):
    """The fuel & vehicles add-on, which is off by default."""
    mark = now_ms()
    if not _board(check):
        return

    if not check.that(board.open_settings(), "reached Settings"):
        return
    if not check.that(scroll_to("Fuel & vehicles", tries=8),
                      "the fuel add-on is listed in settings"):
        return

    check.that("off" in screen_text().lower(),
               "the add-on is off until the user turns it on")
    check.no_errors(mark)


def test_dashboard_sections(check):
    """The dashboard's own sections, which are the app's front page."""
    mark = now_ms()
    if not _board(check):
        return

    text = screen_text()
    check.that("BALANCE" in text, "shows the balance hero")
    check.that("INCOME" in text, "shows income")
    check.that("PLANNED" in text, "shows planned spend")
    check.that("MONEY TO MOVE" in text or "COMING UP" in text,
               "shows what to act on")
    check.no_errors(mark)


def test_list_screen_filters(check):
    """The list screen's All / To pay / Paid filters."""
    mark = now_ms()
    if not _board(check):
        return

    tap("List", required=True)
    time.sleep(2)

    text = screen_text()
    for chip in ("All", "To pay", "Paid"):
        check.that(chip in text, f"the {chip!r} filter is offered")

    # Switching filter must not throw or empty the screen unexpectedly.
    if tap("To pay"):
        time.sleep(1.5)
        check.that(len(labels()) > 5, "the 'To pay' filter renders")
    check.no_errors(mark)


CASES = [
    ("dashboard", test_dashboard_sections),
    ("list-filters", test_list_screen_filters),
    ("cards", test_cards_tab),
    ("add-transaction", test_add_transaction_screen),
    ("category-edit", test_category_detail_and_edit),
    ("category-new", test_new_category_screen),
    ("income", test_income_screen_opens),
    ("sms", test_sms_screens),
    ("settings", test_settings_screen),
    ("fuel-addon", test_fuel_addon),
]
