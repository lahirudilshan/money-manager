#!/usr/bin/env python3
"""Personas 3 and 4 — the later life stage, and the foreign-currency earner.

Split from test_personas.py only to keep each file to a readable length; these
are the same kind of case. See docs/persona-test-plan.md.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import *  # noqa


def test_rohan_58_near_retirement(check):
    """Rohan, 58: children grown, house owned, a car, health his main concern.

    The mirror of Kasun. Where a 23-year-old must not be shown retirement
    savings, a 58-year-old must not be shown childcare or tuition — and the plan
    should lean toward the things that do track his stage.
    """
    mark = now_ms()
    fresh_install()

    tap("Bank of Ceylon", required=True)
    tap("Continue", required=True)

    # "Just me" is the default; he drives.
    tap("Car", required=True)
    tap("Choose birth year", required=True)
    check.that(scroll_to("1968", tries=12), "birth-year picker reaches 1968")
    tap("1968", required=True)

    check.on_screen("You're 58", "age derived for 1968")

    scroll_to("lines ready")
    plan = screen_text()

    for absurd in ("Childcare", "School fees", "Tuition"):
        check.that(absurd not in plan,
                   f"does not suggest {absurd!r} for someone with grown children")

    check.that("Retirement" in plan or "Investments" in plan,
               "leans toward retirement or investments at his stage")
    check.that("Health insurance" in plan, "suggests health cover")
    check.that("Fuel" in plan, "suggests fuel for a car owner")

    tap("Build my plan", required=True)
    check.no_errors(mark)


def test_dilini_29_usd_freelancer(check):
    """Dilini, 29: paid in USD, several dollar subscriptions.

    The currency case. Income arrives in dollars and so do half her bills, so
    the USD toggle has to be available on EXPENSE lines too — offering it only
    on income forced her to convert by hand at today's rate, and the figure then
    drifted every month.
    """
    mark = now_ms()
    fresh_install()

    tap("Commercial Bank of Ceylon", required=True)
    tap("Continue", required=True)
    tap("Build my plan", required=True)
    tap("Continue", required=True)
    check.on_screen("Set up your plan", "reached the plan step")

    # Income line: USD must be offered.
    salary = next((l for l in labels() if l.startswith("Salary")), None)
    if check.that(salary is not None, "found the income line"):
        tap(salary, required=True)
        time.sleep(1.5)
        text = screen_text()
        check.that("USD" in text, "income offers a USD toggle")
        check.that("PLAN AMOUNT" in text, "amount is labelled as a plan amount")
        tap("Done")
        time.sleep(1)

    # Expense line: USD must ALSO be offered — this is the actual fix.
    expense = next((l for l in labels()
                    if l.endswith(", LKR 0") and not l.startswith("Salary")), None)
    if check.that(expense is not None, "found an expense line"):
        tap(expense, required=True)
        time.sleep(1.5)
        text = screen_text()
        check.that("USD" in text,
                   "expense lines offer USD too, not just income")

        # Enter a dollar figure and confirm the conversion is explained.
        if tap("USD", partial=False):
            time.sleep(0.8)
            set_text(15)
            time.sleep(1.2)
            converted = screen_text()
            check.that("USD" in converted and ("at" in converted or "≈" in converted),
                       "shows the converted local amount and the rate used")
        tap("Done")
        time.sleep(1)

    check.no_errors(mark)


def test_frequency_options_and_saving_plan(check):
    """Every cadence a real bill can have, including a yearly save-up plan.

    Vehicle insurance is the case that drove this: a once-a-year figure the user
    would rather fund monthly. Onboarding has to offer that, or the plan built
    here has to be rebuilt line by line afterwards.
    """
    mark = now_ms()
    fresh_install()

    tap("Commercial Bank of Ceylon", required=True)
    tap("Continue", required=True)
    tap("Build my plan", required=True)
    tap("Continue", required=True)

    row = next((l for l in labels() if l.endswith(", LKR 0")), None)
    if not check.that(row is not None, "found a line to edit"):
        return

    tap(row, required=True)
    time.sleep(1.5)

    text = screen_text()
    for cadence in ("Monthly", "One-time", "Yearly", "Spending budget"):
        check.that(cadence in text, f"offers the {cadence!r} cadence")

    # A yearly line should offer to save toward it monthly.
    if tap("Yearly"):
        time.sleep(1.2)
        check.that("save" in screen_text().lower(),
                   "a yearly line offers a monthly save-up plan")

    # A spending budget has no single due day and no fixed amount.
    if tap("Spending budget"):
        time.sleep(1.2)
        budget_text = screen_text()
        check.that("MONTHLY BUDGET" in budget_text,
                   "a spending budget is labelled as a budget, not a plan amount")
        check.that("Optional" in budget_text,
                   "a spending budget does not demand a funding account")

    check.no_errors(mark)


CASES = [
    ("rohan-58", test_rohan_58_near_retirement),
    ("dilini-usd", test_dilini_29_usd_freelancer),
    ("frequencies", test_frequency_options_and_saving_plan),
]
