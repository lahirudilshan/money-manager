#!/usr/bin/env python3
"""Persona cases — the app as different people actually use it.

These are not feature tests. Each one asks whether the app makes sense FOR THIS
PERSON: whether it asks them something they cannot answer, suggests a line that
is absurd for their life, or hides a number they need. That class of defect is
invisible to unit tests and is what makes a real user abandon setup.

See docs/persona-test-plan.md for the personas in full.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import *  # noqa


def test_kasun_23_no_dependants(check):
    """Kasun, 23, first job, no vehicle, no dependants.

    The absurdity check: nothing about children, vehicles or retirement should
    appear for him. A plan full of lines he cannot use is the fastest way to
    lose a first-time user.
    """
    mark = now_ms()
    blank_slate()

    tap("Commercial Bank of Ceylon", required=True)
    check.on_screen("1 account selected", "bank selection registers")
    tap("Continue", required=True)

    # Defaults are already "Just me" + "Neither"; add his birth year.
    tap("Choose birth year", required=True)
    check.that(scroll_to("2003", tries=8), "birth-year picker reaches 2003")
    tap("2003", required=True)

    check.on_screen("You're 23", "age is derived from the birth year")

    scroll_to("lines ready")
    plan = screen_text()
    for absurd in ("Childcare", "School fees", "Retirement",
                   "Vehicle insurance", "Revenue licence"):
        check.that(absurd not in plan, f"does not suggest {absurd!r} for him")
    check.that("Bus / train / taxi" in plan,
               "suggests public transport for someone with no vehicle")

    tap("Build my plan", required=True)
    cats = screen_text()
    check.that("Loans & credit" not in cats,
               "Loans category is not in the picker (step 5 collects loans)")
    check.no_errors(mark)


def test_nilanthi_41_family_car_parents(check):
    """Nilanthi, 41: partner, children, a car, and parents she supports.

    The dense case. Checks that supporting parents produces a HOUSE rather than
    a flat "support" line — a second household's costs are the sum of its bills,
    not a guessed monthly figure, and having both meant the same money could be
    counted twice.
    """
    mark = now_ms()
    blank_slate()

    tap("Sampath Bank", required=True)
    tap("Hatton National Bank", required=True)
    check.on_screen("2 accounts selected", "both banks selected")
    tap("Continue", required=True)

    tap("Partner", required=True)
    tap("Children", required=True)
    tap("Parents", required=True)
    tap("Car", required=True)
    tap("Choose birth year", required=True)
    if scroll_to("1985", tries=10):
        tap("1985")

    check.on_screen("You're 41", "age derived for 1985")

    scroll_to("lines ready")
    plan = screen_text()
    check.that("Support to parents" not in plan,
               "the old flat 'Support to parents' line is gone")
    check.that("parent" in plan.lower() and "home" in plan.lower(),
               "parents are modelled as a house")
    check.that("School fees" in plan, "suggests school fees for a parent")

    # The preview card names only the first few lines and collapses the rest to
    # "+N more", so a chip being absent here proves nothing about the plan. The
    # vehicle lines are asserted on the NEXT screen, where every line is listed.
    tap("Build my plan", required=True)
    cats = screen_text()
    check.that("Houses" in cats, "Houses category offered")
    check.that("Loans & credit" not in cats, "Loans still absent from the picker")

    # Transport must have picked up the car's lines.
    transport = next((l for l in labels() if l.startswith("Transport,")), "")
    check.that("of" in transport and not transport.startswith("Transport, 0 of"),
               f"a car pre-selects transport lines ({transport!r})")
    check.no_errors(mark)


def test_multi_account_transfers_split(check):
    """Two accounts, bills on each — the dashboard must split the transfers.

    "How much do I move where" is the board's whole purpose, so a household
    running two banks has to see a separate figure per account.
    """
    mark = now_ms()
    # The two-bank board is CACHED, like every other board here: this case is
    # about what the dashboard does with two funded accounts, not about walking
    # onboarding to produce them. Building it by hand cost four minutes to reach
    # the single assertion below.
    built_board(bank="Sampath Bank", hint="Sampath",
                second_bank="Hatton National Bank", second_hint="Hatton")

    moves = [l for l in labels() if "Mark money moved" in l]
    check.that(len(moves) >= 2,
               f"one transfer row per funded account (found {len(moves)})")
    check.no_errors(mark)


def test_mark_transfer_and_pay_a_bill(check):
    """The monthly loop: move the money, then tick the bills off.

    Builds its own board rather than reusing whatever the previous case left
    behind. Depending on prior state made this fail for the wrong reason — the
    dashboard was simply empty, which says nothing about whether marking a bill
    paid works.
    """
    mark = now_ms()
    _build_board()

    moves = [l for l in labels() if "Mark money moved" in l]
    if check.that(bool(moves), "an account has money to move"):
        tap(moves[0], required=True)
        time.sleep(2)
        check.that(len(labels()) > 5, "marking a transfer did not break the screen")

    relaunch()
    bills = [l for l in labels() if ", In " in l and "LKR" in l]
    if check.that(bool(bills), "a bill is listed as coming up"):
        tap(bills[0], required=True)
        time.sleep(2.5)
        text = screen_text()
        check.that("Mark as paid" in text or "Paid" in text,
                   "the bill screen offers a paid control")
        check.that("Change account" in text,
                   "the funding account can be changed from the bill screen")
    check.no_errors(mark)


def _build_board(bank="Commercial Bank of Ceylon", hint="Commercial Bank"):
    """A finished board with real amounts.

    Delegates to the shared, CACHED walk in the harness. This was a full
    onboarding walk duplicated here and in `test_regressions.py`; each copy cost
    about four minutes and produced an identical board, so the suite spent most
    of its time rebuilding state it already had.
    """
    return built_board(bank=bank, hint=hint)


CASES = [
    ("kasun-23", test_kasun_23_no_dependants),
    ("nilanthi-41", test_nilanthi_41_family_car_parents),
    ("multi-account", test_multi_account_transfers_split),
    ("monthly-loop", test_mark_transfer_and_pay_a_bill),
]
