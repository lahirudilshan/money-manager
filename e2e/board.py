#!/usr/bin/env python3
"""Build a finished board — the precondition for any case about the app proper.

Cases that exercise Settings, the List screen, loans or backups all need a board
to exist first. Sharing one builder here keeps that setup in one place, and
means a case cannot accidentally depend on what a PREVIOUS case happened to
leave behind: the suite runs its files alphabetically, so `data_safety` and
`features` execute before any persona has completed onboarding, and inheriting
state made them fail on an empty screen rather than on anything real.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *  # noqa

DEFAULT_AMOUNTS = [50000, 12000, 3000, 2500, 8000, 25000, 4000, 1800, 6000]


def _settle_on_dashboard(tries=3):
    """Leave the app on the dashboard, whatever screen it resumed on.

    Restoring the database does not reset NAVIGATION: iOS resumes the app where
    it was, so a case that finished inside Settings handed the next one a
    Settings screen and every subsequent case failed with "could not reach a
    board". The data was fine; only the location was wrong.

    Sheets are dismissed first — a modal presented over the tab bar swallows the
    tab tap underneath it.
    """
    for _ in range(tries):
        # Close any sheet FIRST, before looking for the dashboard.
        #
        # A sheet is presented OVER the dashboard, which stays in the tree
        # behind it — so "BALANCE" is on screen while the board is completely
        # unreachable, and checking for it first declared victory without
        # noticing the sheet. The tab bar underneath then swallowed every tap:
        # the SMS case left "Paste a message" open, and the next case to want
        # Settings tapped a keyboard key instead and asserted against the
        # dashboard it had never left.
        #
        # Closing is therefore unconditional, and cheap when there is nothing to
        # close (`tap` simply finds no such element).
        if tap("Close") or tap("Go back"):
            time.sleep(1.2)
            continue

        # The keyboard also overlays the tab bar, and outlives the sheet that
        # raised it.
        if dismiss_keyboard():
            continue

        if "BALANCE" in screen_text():
            return True

        if tap("Dashboard"):
            time.sleep(2)
            continue

        relaunch()

    return "BALANCE" in screen_text() and not _sheet_is_open()


def _sheet_is_open():
    """Is a modal sheet covering the board?

    `BALANCE` alone cannot answer this — the dashboard renders behind any sheet.
    A "Close" affordance is what actually distinguishes the two: the dashboard
    has none, and every sheet in this app does.
    """
    return exists("Close", partial=False) or exists("Go back", partial=False)


#: Distinguishes "caller said nothing" from an explicit `snapshot=None`, which
#: means "walk onboarding for real" and must keep working — see `build`.
_UNSET = object()


def build(bank="Commercial Bank of Ceylon", hint="Commercial Bank",
          second_bank=None, second_hint=None, amounts=None, snapshot=_UNSET):
    """Get to a finished board — from a saved snapshot when one exists.

    Walking onboarding costs 90-120 seconds, and the suite needs a board roughly
    two dozen times; doing it the long way each time was over half the total
    runtime, spent rebuilding identical state.

    So the first build of a session walks it properly and saves the database;
    every later call restores those files in a few seconds. Pass
    `snapshot=None` to force the full walk — the onboarding cases themselves
    must, since the flow IS what they are testing.

    With nothing passed, `E2E_SNAPSHOT` chooses the board, so the same cases can
    run against a real one pulled off a phone (see `pull_device_db.py`). A
    fixture board is necessarily small and tidy; the shapes that break the money
    code — a line overriding its category's account, a category with no account
    at all — only appear once someone has actually used the app for a while.
    """
    if snapshot is _UNSET:
        snapshot = os.environ.get("E2E_SNAPSHOT", "default")

    if snapshot and restore_db(snapshot):
        return _settle_on_dashboard()

    amounts = amounts or DEFAULT_AMOUNTS

    fresh_install()
    # A fresh install opens on the restore/welcome gate, not on the first
    # question — see `start_onboarding`.
    if not start_onboarding():
        return False

    tap(bank, required=True)
    if second_bank:
        tap(second_bank)
    tap("Continue", required=True)

    # Step 2 keeps its defaults; step 3 keeps the suggested lines.
    tap("Build my plan", required=True)
    tap("Continue", required=True)

    seen, i = set(), 0
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
            # Alternate accounts when a second bank was asked for, so both end
            # up funding real bills.
            target = hint
            if second_hint and i % 2 == 1:
                target = second_hint
            tap(target, partial=True)
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

    reached = _settle_on_dashboard()

    # Save the finished board so the next case restores it in seconds rather
    # than walking onboarding again. Only a COMPLETE board is worth saving —
    # snapshotting a half-built one would hand every later case broken state.
    if reached and snapshot:
        snapshot_db(snapshot)

    return reached


def open_settings():
    """Reach Settings from wherever the app currently is.

    The tab bar only exists once onboarding is done, so this reports failure
    rather than raising — a case can then say "could not reach Settings", which
    is a far more useful failure than a traceback inside `tap`.
    """
    # A focused text field puts the keyboard over the tab bar; tapping Settings
    # then hits a key and silently leaves the app where it was.
    dismiss_keyboard()

    if not exists("Settings"):
        return False
    tap("Settings")
    time.sleep(2)

    # Verify arrival rather than trusting the tap. This returned True
    # unconditionally, so a swallowed tap was reported as success and the case
    # went on to assert against the dashboard — failing with "settings shows no
    # sections", which pointed at the app instead of at the tap.
    if "PREFERENCES" in screen_text(refresh=True):
        return True

    # One retry: whatever ate the tap is usually gone by now.
    dismiss_keyboard()
    tap("Settings")
    time.sleep(2)
    return "PREFERENCES" in screen_text(refresh=True)
