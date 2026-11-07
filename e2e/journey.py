#!/usr/bin/env python3
"""One app session, one everyday journey, balances checked to the cent.

    SIM_UDID=<uuid> python3 e2e/journey.py

The full suite (`run.py`) restarts the app for every case so each starts from a
known state — thorough, and about 45 minutes. This is the quick check: the app
is launched ONCE on a fresh board, and a user's ordinary money flow is driven
through the real screens in a single sitting:

    set the account's balance  →  pay by hand  →  get a refund
    →  a bank SMS arrives and is confirmed  →  pay a bill from the plan

After every step the Accounts screen must show exactly the balance the step
implies, and the run ends on the account's statement. A few minutes, start to end.
"""
import os
import sys
import time
import urllib.parse
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *  # noqa
from harness import _element_id, invalidate_source, mark_data_dirty  # noqa

SCHEME = "exp+dayly://"
STARTED = time.time()
RESULTS = []


def check(ok, what):
    RESULTS.append((bool(ok), what))
    print(f"    {'PASS' if ok else 'FAIL'}  {what}", flush=True)
    return ok


def open_route(path, settle=2.5):
    """Navigate inside the running app — no relaunch."""
    subprocess.run(["xcrun", "simctl", "openurl", UDID, SCHEME + path], capture_output=True)
    time.sleep(settle)
    invalidate_source()


def field(name):
    """A text field by its label or placeholder."""
    safe = name.replace("'", "\\'")
    res = req("POST", f"/session/{sid()}/element", {
        "using": "-ios predicate string",
        "value": f"type == 'XCUIElementTypeTextField' AND "
                 f"(label == '{safe}' OR placeholderValue == '{safe}')",
    })
    return _element_id(res)


def fill(name, text):
    e = field(name)
    if not e:
        raise AssertionError(f"no field {name!r}")
    req("POST", f"/session/{sid()}/element/{e}/click", {})
    time.sleep(0.3)
    req("POST", f"/session/{sid()}/element/{e}/clear", {})
    req("POST", f"/session/{sid()}/element/{e}/value", {"text": str(text)})
    time.sleep(0.6)
    invalidate_source()


def account_balance(account_id):
    """The figure the account page shows under "Holds now", in rupees."""
    open_route(f"account/{account_id}")
    items = labels(refresh=True)
    tap("Close")
    time.sleep(0.8)
    for i, item in enumerate(items):
        if item == "Holds now" and i + 1 < len(items):
            return parse_lkr(items[i + 1])
    return None


def parse_lkr(text):
    import re
    m = re.search(r"LKR\s*(-?)([\d,]+(?:\.\d+)?)", text or "")
    return None if not m else float(m.group(2).replace(",", "")) * (-1 if m.group(1) else 1)


def expect_balance(account_id, rupees, step):
    got = account_balance(account_id)
    return check(got is not None and abs(got - rupees) < 0.005,
                 f"{step}: account holds LKR {rupees:,.2f} (shows {got})")


def tap_top(label, settle=0.8):
    """Tap the TOPMOST element with exactly this label.

    A sheet sits over the screen that opened it, and both are in the tree: the
    dashboard behind the add-transaction sheet also says "Living". The sheet's
    elements come last, so the last visible match is the one on top.
    """
    safe = label.replace("'", "\\'")
    res = req("POST", f"/session/{sid()}/elements", {
        "using": "-ios predicate string",
        "value": f"label == '{safe}' AND visible == 1",
    })
    found = res.get("value") or []
    if not found:
        raise AssertionError(f"element not found: {label!r}")
    e = found[-1].get("element-6066-11e4-a52e-4f735466cecf") or found[-1].get("ELEMENT")
    req("POST", f"/session/{sid()}/element/{e}/click", {})
    time.sleep(settle)
    invalidate_source()
    mark_data_dirty()


def close_keyboard_on(label):
    """Close the keyboard by tapping a plain heading.

    The harness's generic `dismiss_keyboard` taps midway above the keyboard,
    which on this sheet is the money in/out chips — it would flip the
    direction. A heading is inert, so the tap only blurs the field.
    """
    safe = label.replace("'", "\\'")
    res = req("POST", f"/session/{sid()}/element",
              {"using": "-ios predicate string",
               "value": f"type == 'XCUIElementTypeStaticText' AND label ==[c] '{safe}' AND visible == 1"})
    e = _element_id(res)
    if e:
        r = req("GET", f"/session/{sid()}/element/{e}/rect").get("value") or {}
        tap_xy(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
        time.sleep(0.8)
        invalidate_source()


def add_transaction(amount, category, line, money_in=False):
    open_route("transaction/new", settle=2)
    fill("Amount", amount)
    close_keyboard_on("Amount")
    if money_in:
        tap_top("Money in (refund)")
    tap_top(category)
    tap_top(line)
    if not exists("Save transaction"):
        scroll_to("Save transaction", tries=4)
    tap_top("Save transaction", settle=1.5)


def main():
    print("Starting ONE app session…", flush=True)
    start_session()
    restore_db("default")  # the only launch: a fresh, finished board
    account_id = db_query("SELECT id FROM cards WHERE is_card = 0 LIMIT 1")[0].strip()

    print("\n[1] Set the account to what the bank shows", flush=True)
    open_route(f"account/{account_id}")
    tap("Edit details", required=True)
    time.sleep(2)
    fill("e.g. 100200300456", "8001234567")
    fill("Current balance (LKR)", "100000")
    dismiss_keyboard()
    scroll_to("Save changes", tries=4)
    tap("Save changes", required=True)
    time.sleep(1.5)
    expect_balance(account_id, 100_000, "balance set")

    print("\n[2] Pay for groceries by hand", flush=True)
    add_transaction(2500, "Living", "Groceries")
    expect_balance(account_id, 97_500, "manual payment")

    print("\n[3] A refund comes back", flush=True)
    add_transaction(500, "Living", "Groceries", money_in=True)
    expect_balance(account_id, 98_000, "refund")

    print("\n[4] The bank texts about a card payment; Smart Detect confirms it", flush=True)
    # The bank's moment is NOW: its balance includes everything recorded so far.
    when = datetime.now()
    sms = (f"LKR 1,200.00 debited from AC XXXXXX4567 as POS TXN on {when:%d %b %Y %H:%M} "
           f"at KEELLS SUPER KELANIYA. Avl Bal 96,800.00 Call 94112448888 for info")
    open_route("sms?text=" + urllib.parse.quote(sms), settle=3)
    draft = db_query("SELECT id FROM sms_inbox WHERE status = 'pending' AND raw LIKE '%KEELLS SUPER KELANIYA%' LIMIT 1")
    if check(bool(draft), "the bank message became a Smart Detect draft"):
        open_route(f"sms/{draft[0].strip()}", settle=2.5)
        check("Groceries" in screen_text(refresh=True), "Smart Detect suggests Groceries")
        # Confident suggestions offer a one-tap "Yes, that's right"; others "Log it".
        tap_top("Yes, that's right" if exists("Yes, that's right", partial=False) else "Log it", settle=1.5)
    expect_balance(account_id, 96_800, "SMS payment")

    print("\n[5] Pay a bill from the plan (tick it paid)", flush=True)
    # A bank figure stands for its whole minute, so the bill is ticked after it.
    time.sleep(max(0, 61 - datetime.now().second))
    water = db_query("SELECT id FROM subcategories WHERE name = 'Water' LIMIT 1")[0].strip()
    open_route(f"subcategory/{water}")
    tap_top("Mark as paid. Currently Pending.")
    # Paid/pending is an edit like any other on the sheet: it is kept on Save.
    tap_top("Save changes", settle=1.5)
    expect_balance(account_id, 94_300, "water bill paid (2,500)")

    print("\n[6] The statement adds up", flush=True)
    open_route(f"account/{account_id}")
    items = labels(refresh=True)
    def after(name):
        for i, it in enumerate(items):
            if it == name and i + 1 < len(items):
                return parse_lkr(items[i + 1])
    start, inn, out, holds = after("Start of month"), after("Money in"), after("Money out"), after("Holds now")
    check(None not in (start, inn, out, holds) and abs(start + inn - out - holds) < 0.005,
          f"start {start} + in {inn} − out {out} = now {holds}")
    screenshot("journey-statement")

    stop_session()
    failed = [w for ok, w in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed in "
          f"{time.time() - STARTED:.0f}s, one app launch.", flush=True)
    for w in failed:
        print(f"  FAIL  {w}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
