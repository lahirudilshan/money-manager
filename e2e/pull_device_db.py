#!/usr/bin/env python3
"""Copy the real board off a connected iPhone and install it as an e2e snapshot.

## Why

The suite's `default` snapshot is a board the tests built themselves, and it is
deliberately small — one bank, a handful of lines, a salary typed as "5". That is
fine for "does this screen open", and it is close to useless for "is this figure
right": the shapes that actually break the money code are the ones a real board
grows into and a fixture never does —

  - a line whose account OVERRIDES its category's (the bug that made an account
    show as funding nothing);
  - a category carrying no account at all, reached only through those overrides;
  - budgets sitting next to dated bills on one account;
  - a yearly line with a saving plan, whose planned amount is already monthly.

Every one of those is in the real board and none were in the fixture.

## Usage

    python3 e2e/pull_device_db.py            # from the first paired device
    python3 e2e/pull_device_db.py --name mine

Then run any case against it:

    E2E_SNAPSHOT=device python3 e2e/run.py amounts

## Safety

This only ever READS from the phone. `devicectl copy from` cannot write, and
nothing here touches the device's own database — the copy lands in
`e2e/artifacts/snapshots/`, which is gitignored, so a real board never reaches
the repository.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOTS = os.path.join(HERE, "artifacts", "snapshots")
BUNDLE = "com.anonymous.moneymanager"
# The app moved its database out of Documents (which file sharing exposes) into
# Application Support — see `DATABASE_DIRECTORY` in src/db/client.ts.
REMOTE_DIR = "Library/Application Support"


def first_device():
    """The UDID of a paired device, or None."""
    out = subprocess.run(
        ["xcrun", "devicectl", "list", "devices"],
        capture_output=True, text=True,
    ).stdout
    for line in out.splitlines():
        # Columns are name / hostname / UDID / state; a paired phone says
        # "available". Anything unpaired or disconnected is skipped.
        if "available" in line:
            parts = line.split()
            for part in parts:
                if len(part) == 36 and part.count("-") == 4:
                    return part
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="device", help="snapshot name (default: device)")
    parser.add_argument("--udid", help="device UDID; defaults to the first paired one")
    args = parser.parse_args()

    udid = args.udid or first_device()
    if not udid:
        print("No paired device found. Connect the iPhone and trust this Mac.")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        print(f"Pulling {REMOTE_DIR} from {udid}…")
        result = subprocess.run(
            [
                "xcrun", "devicectl", "device", "copy", "from",
                "--device", udid,
                "--domain-type", "appDataContainer",
                "--domain-identifier", BUNDLE,
                "--source", REMOTE_DIR,
                "--destination", tmp,
            ],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(result.stderr.strip()[:400])
            return 1

        src = None
        for root, _dirs, files in os.walk(tmp):
            if "money-manager.db" in files:
                src = os.path.join(root, "money-manager.db")
                break
        if not src:
            print("No money-manager.db in the copied container.")
            return 1

        os.makedirs(SNAPSHOTS, exist_ok=True)
        dest = os.path.join(SNAPSHOTS, f"{args.name}.db")
        shutil.copy(src, dest)

        # Fold the write-ahead log in, then drop it: the phone's -wal holds
        # writes the main file has not absorbed yet, and copying the .db alone
        # would silently lose the most recent edits. Checkpointing here means
        # the snapshot is one self-contained file.
        for suffix in ("-wal", "-shm"):
            side = f"{src}{suffix}"
            if os.path.exists(side):
                shutil.copy(side, f"{dest}{suffix}")
        subprocess.run(["sqlite3", dest, "PRAGMA wal_checkpoint(TRUNCATE);"],
                       capture_output=True)
        for suffix in ("-wal", "-shm"):
            side = f"{dest}{suffix}"
            if os.path.exists(side):
                os.remove(side)

    counts = subprocess.run(
        ["sqlite3", dest,
         "SELECT (SELECT COUNT(*) FROM cards) || ' accounts, ' || "
         "(SELECT COUNT(*) FROM categories) || ' categories, ' || "
         "(SELECT COUNT(*) FROM subcategories) || ' lines, ' || "
         "(SELECT COUNT(*) FROM transactions) || ' transactions'"],
        capture_output=True, text=True).stdout.strip()

    print(f"Saved {dest}")
    print(f"  {counts}")
    print(f"\nRun against it:  E2E_SNAPSHOT={args.name} python3 e2e/run.py amounts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
