#!/usr/bin/env python3
"""Account balances and Smart Detect, checked on the real screens.

The money logic is proven in node (`src/__tests__/everydayMoney.integration
.test.ts` reconciles three months against a bank statement). What node cannot
see is the screen: whether the figures render, whether the statement on the
account sheet adds up as displayed, and whether the controls that feed the
ledger (the "Current balance" field, the money in/out switch) are there and
work. These cases run against the user's REAL board — `device-oct`, pulled off
the phone — because that is where accounts have history.
"""
import sys
import os
import re
import subprocess
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import *  # noqa
import board

SNAPSHOT = os.environ.get("E2E_LEDGER_SNAPSHOT", "device-oct")
MONEY = re.compile(r"(-?)LKR\s*(-?)([\d,]+(?:\.\d+)?)")


def _real_board(check):
    ok = board.build(snapshot=SNAPSHOT)
    return check.that(ok, f"the {SNAPSHOT} board is loaded")


def _amount(text):
    """'LKR 63,800' / '+ LKR 1,250' / '− LKR 500' / 'LKR -22,870' → rupees."""
    m = MONEY.search(text or "")
    if not m:
        return None
    value = float(m.group(3).replace(",", ""))
    negative = bool(m.group(1) or m.group(2))
    return -value if negative else value


def _figure_after(label_text):
    """The money figure that follows a row label in screen order."""
    items = labels(refresh=True)
    for i, item in enumerate(items):
        if item == label_text:
            for nxt in items[i + 1:i + 4]:
                value = _amount(nxt)
                if value is not None:
                    return value
    return None


def _accounts_screen(check):
    tap("Settings", required=True)
    if not check.that(scroll_to("Accounts", tries=10), "Accounts is reachable"):
        return False
    tap("Accounts", required=True)
    return check.that(wait_for_text("TOTAL ACROSS ACCOUNTS"), "Accounts screen opened")


def _account_names():
    return [n for (n,) in [r.split("|") for r in db_query(
        "SELECT nickname FROM cards WHERE is_card = 0 AND archived_at IS NULL AND nickname IS NOT NULL ORDER BY sort_order"
    )] if n.strip()]


def test_accounts_show_balances(check):
    """Every account row carries a balance figure, and the screen says what it is."""
    mark = now_ms()
    if not _real_board(check) or not _accounts_screen(check):
        return
    check.on_screen("what they hold", "header explains the total is today's holdings")
    text = screen_text(refresh=True)
    for name in _account_names():
        # The row's accessibility label is "<name>, LKR <balance>…".
        check.that(re.search(rf"{re.escape(name)}, -?LKR", text) is not None,
                   f"{name} shows its balance")
    screenshot("ledger-accounts")
    check.no_errors(mark)


def test_statement_adds_up(check):
    """The account sheet's month reads as a statement whose lines add up."""
    mark = now_ms()
    if not _real_board(check) or not _accounts_screen(check):
        return
    names = _account_names()
    if not check.that(bool(names), "the board has a named account"):
        return
    tap(names[0], partial=True, required=True)
    if not check.that(wait_for_text("Holds now"), "account sheet shows its balance"):
        return
    for heading in ("Start of month", "Money in", "Money out"):
        check.on_screen(heading, f"statement shows {heading}")

    start = _figure_after("Start of month")
    money_in = _figure_after("Money in")
    money_out = _figure_after("Money out")
    holds = _figure_after("Holds now")
    # The current month's closing IS the balance now — the harness lists each
    # label once, so the "Now" row's identical figure is read from "Holds now".
    end = holds
    check.that(None not in (start, money_in, money_out, end, holds),
               f"all statement figures render ({start}, {money_in}, {money_out}, {end}, {holds})")
    if None not in (start, money_in, money_out, end):
        check.that(abs(start + money_in - money_out - end) < 0.01,
                   f"start {start:,.2f} + in {money_in:,.2f} − out {money_out:,.2f} = {end:,.2f}")
    if None not in (end, holds):
        check.that(abs(end - holds) < 0.01, "this month's closing equals what the account holds now")
    screenshot("ledger-statement")
    check.no_errors(mark)


def test_current_balance_sets_the_balance(check):
    """Typing the bank's figure makes the account hold exactly that."""
    mark = now_ms()
    if not _real_board(check) or not _accounts_screen(check):
        return
    name = _account_names()[0]
    tap(name, partial=True, required=True)
    wait_for_text("Holds now")
    tap("Edit details", required=True)
    if not check.that(scroll_to("Current balance", tries=8), "form offers Current balance"):
        return
    screenshot("ledger-current-balance-field")
    field = None
    for i, item in enumerate(labels(refresh=True)):
        if item.startswith("Current balance"):
            field = i
            break
    # The field is the text input right after its label; set_text targets
    # inputs by index, so find which input that is.
    inputs = req("POST", f"/session/{sid()}/elements",
                 {"using": "class name", "value": "XCUIElementTypeTextField"})["value"]
    target = None
    for idx, element in enumerate(inputs):
        eid = element.get("ELEMENT") or list(element.values())[0]
        value = req("GET", f"/session/{sid()}/element/{eid}/attribute/placeholderValue")["value"] or ""
        if "banking app" in value or "As your" in value:
            target = idx
    if not check.that(target is not None, "Current balance input found"):
        return
    # Clear and type the bank's figure.
    eid = inputs[target].get("ELEMENT") or list(inputs[target].values())[0]
    req("POST", f"/session/{sid()}/element/{eid}/clear", {})
    set_text("54321.50", index=target)
    mark_data_dirty()
    dismiss_keyboard()
    tap("Save", required=True)
    time.sleep(1.5)
    tap(name, partial=True)
    wait_for_text("Holds now")
    holds = _figure_after("Holds now")
    check.that(holds is not None and abs(holds - 54321.5) < 0.01,
               f"{name} now holds LKR 54,321.50 (shows {holds})")
    screenshot("ledger-after-current-balance")
    check.no_errors(mark)


def test_money_direction_switch(check):
    """Add transaction offers money out and money in (a refund)."""
    mark = now_ms()
    if not _real_board(check):
        return
    if not (tap("Add transaction") or tap("Add")):
        check.that(False, "Add transaction is reachable from the tab bar")
        return
    check.that(wait_for_text("Money out"), "Money out option shown")
    check.on_screen("Money in (refund)", "refund option shown")
    tap("Money in (refund)", partial=True)
    time.sleep(0.6)
    check.on_screen("Received into", "account picker reads 'Received into' for money in")
    screenshot("ledger-money-direction")
    tap("Close")
    check.no_errors(mark)


def _open_draft(fragment):
    """Open the review sheet of the pending draft whose message contains `fragment`."""
    rows = db_query(
        f"SELECT id FROM sms_inbox WHERE status = 'pending' AND raw LIKE '%{fragment}%' LIMIT 1"
    )
    if not rows:
        return False
    subprocess.run(["xcrun", "simctl", "openurl", UDID,
                    f"exp+money-manager://sms/{rows[0].strip()}"], capture_output=True)
    time.sleep(3)
    invalidate_source()
    return True


def test_smart_detect_suggestions(check):
    """Each draft's review sheet offers the corrected suggestion."""
    mark = now_ms()
    if not _real_board(check):
        return
    for fragment, expected, why in (
        ("11,000.00 debited from AC XXXXXXXX6796 on 02 Oct", "Samadhi", "the 11,000 transfer is matched by its amount"),
        ("122,867.00", "NDB Lease", "the 122,867 lease is matched"),
        ("Ayana Medicals", "Medicine", "the Ayana Medicals purchase is health"),
    ):
        if not check.that(_open_draft(fragment), f"the {expected} draft is in the queue"):
            continue
        check.that(expected in screen_text(refresh=True), f"Smart Detect suggests {expected}: {why}")
        screenshot(f"ledger-draft-{expected.replace(' ', '-').lower()}")
        tap("Close")
        time.sleep(1)
    check.no_errors(mark)


CASES = [
    ("ledger-accounts", test_accounts_show_balances),
    ("ledger-statement", test_statement_adds_up),
    ("ledger-money-direction", test_money_direction_switch),
    ("ledger-smart-detect", test_smart_detect_suggestions),
    ("ledger-current-balance", test_current_balance_sets_the_balance),
]
