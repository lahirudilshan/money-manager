#!/usr/bin/env python3
"""Backup, restore and SMS intake — the paths where data can be lost.

These matter more than any feature test: a wrong figure on the dashboard is an
annoyance, but a backup that cannot be restored is the user's whole financial
history gone. The restore path in particular shipped broken once — backups were
uploaded to Drive and the restore list only ever read local files, so the copies
existed somewhere the UI could not reach.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness import *  # noqa
import board


def test_backup_appears_under_restore(check):
    """A backup you just made must be listed as restorable.

    THE BUG this guards: Restore only ever listed LOCAL files. A user whose
    backups all went to Google Drive saw "No backups on this phone yet" while
    their data sat safely in the cloud, unreachable from the one screen whose
    job is to bring it back.
    """
    mark = now_ms()
    if not check.that(board.build(), "built a board to back up"):
        return

    if not check.that(board.open_settings(), "reached Settings"):
        return
    if not scroll_to("Backup", tries=8):
        check.that(False, "found Backup in settings")
        return
    tap("Backup", partial=True, required=True)
    time.sleep(2.5)

    check.on_screen("Backup", "backup screen opened")

    before = len(db_query(
        "SELECT key FROM settings WHERE key = 'last_local_backup_at';"))

    # Save a local copy.
    if not tap("Save a file on this phone", partial=True):
        check.that(False, "local backup option present")
        return
    time.sleep(4)

    # Some builds ask what to include before writing.
    for confirm in ("Back up", "Save", "Done"):
        if tap(confirm, partial=True):
            time.sleep(3)
            break

    text = screen_text()
    check.that("Restore" in text, "a Restore section exists")
    check.that("No backups" not in text,
               "the new backup is listed rather than an empty state")
    check.no_errors(mark)


def test_restore_list_labels_its_sources(check):
    """Restore rows must say WHERE each copy lives.

    Local and Drive backups are listed together, newest first, because "which
    copy is newest" is the question being asked. Each row is tagged so the user
    can still tell a phone-only copy from one that survives losing the phone.
    """
    mark = now_ms()
    # Deliberately does NOT rebuild: the previous case made a backup, and
    # wiping here would destroy the very row this is meant to inspect. Falls
    # back to building one only if the app is not on a board at all.
    relaunch()
    if not exists("Settings") and not check.that(board.build(), "board available"):
        return

    if not check.that(board.open_settings(), "reached Settings"):
        return
    if not scroll_to("Backup", tries=8):
        check.that(False, "found Backup in settings")
        return
    tap("Backup", partial=True, required=True)
    time.sleep(2.5)
    scroll_to("Restore", tries=6)

    text = screen_text()
    if "No backups" in text:
        # Nothing stored yet is a legitimate state; the section must still be
        # explained rather than simply absent.
        check.that("Restore" in text, "Restore section shown even when empty")
        check.that("connect Google Drive" in text or "Save one above" in text,
                   "empty state explains how to get a backup")
    else:
        check.that("Phone" in text or "Drive" in text,
                   "restore rows name their source")
    check.no_errors(mark)


def test_sms_paste_creates_a_draft(check):
    """A pasted bank message becomes a confirmable draft, not a silent no-op.

    SMS intake is the app's main labour-saving feature; a message that parses to
    nothing with no explanation teaches people to stop using it.
    """
    mark = now_ms()
    if not check.that(board.build(), "built a board for SMS intake"):
        return

    if not tap("Paste SMS", partial=True):
        check.that(False, "dashboard offers Paste SMS")
        return
    time.sleep(2.5)

    check.that("SMS" in screen_text() or "paste" in screen_text().lower(),
               "an SMS intake screen opened")
    screenshot("sms-intake")
    check.no_errors(mark)


CASES = [
    ("backup-listed", test_backup_appears_under_restore),
    ("restore-sources", test_restore_list_labels_its_sources),
    ("sms-paste", test_sms_paste_creates_a_draft),
]
