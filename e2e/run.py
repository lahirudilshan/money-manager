#!/usr/bin/env python3
"""Run the end-to-end suite against a booted simulator.

    python3 e2e/run.py                    # everything
    python3 e2e/run.py regressions        # one file
    python3 e2e/run.py delete-subcategory # one case

Exits non-zero when any case fails, so it can gate a commit.
"""
import importlib.util
import inspect
import os
import sys
import time
import traceback

# Unbuffered, so a redirected run shows progress as it happens rather than
# dumping everything at the end. A full pass takes ~20 minutes; watching it sit
# at zero bytes is indistinguishable from a hang.
try:
    sys.stdout.reconfigure(line_buffering=True)
except AttributeError:  # pragma: no cover - Python < 3.7
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import harness  # noqa: E402
from harness import Check, start_session, stop_session, screenshot  # noqa: E402


def load_cases():
    """Every (file, name, fn) the cases directory defines."""
    found = []
    case_dir = os.path.join(HERE, "cases")
    for filename in sorted(os.listdir(case_dir)):
        if not filename.startswith("test_") or not filename.endswith(".py"):
            continue
        spec = importlib.util.spec_from_file_location(
            filename[:-3], os.path.join(case_dir, filename))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        group = filename[5:-3]
        for name, fn in getattr(module, "CASES", []):
            found.append((group, name, fn))
    return _ordered(found)


def _wipes_device(fn):
    """Does this case wipe the database to test first-run behaviour?

    Read off the source rather than kept as a list, so a case that starts or
    stops calling `fresh_install()` is ordered correctly without anyone
    remembering to update a table here.

    Per CASE, not per file: four of the seven regression cases only want a
    board, and grouping by file alone pushed them behind the three that wipe —
    making each one restore again for no reason.
    """
    try:
        src = inspect.getsource(fn)
    except (OSError, TypeError):
        return True  # Unreadable: assume the expensive path and order it last.
    # `blank_slate()` is deliberately NOT a wipe for ordering purposes: it
    # restores a cached empty database rather than deleting one, so it costs
    # about the same as any other restore and need not be quarantined at the end.
    return "fresh_install(" in src


def _ordered(cases):
    """Board cases first, onboarding walks last.

    Ordering is a runtime decision, not a correctness one: every case builds its
    own state and passes in any order (see the README). But a case that wipes
    the device forces the NEXT board case to restore from disk, and running the
    files alphabetically interleaved the two — `screens` sat after three wipes
    and paid a full restore to get back a board that `amounts` had already had
    loaded minutes earlier.

    Grouping them means the board is restored once, reused by every case that
    wants it, and only then thrown away by the walks that must have it gone.
    """
    board_first = [c for c in cases if not _wipes_device(c[2])]
    walkers = [c for c in cases if _wipes_device(c[2])]
    return board_first + walkers


def main():
    wanted = sys.argv[1] if len(sys.argv) > 1 else None
    cases = load_cases()
    if wanted:
        cases = [c for c in cases if wanted in (c[0], c[1])]
        if not cases:
            print(f"No case matching {wanted!r}. Available:")
            for group, name, _ in load_cases():
                print(f"  {group}/{name}")
            return 2

    print(f"Starting Appium session…")
    try:
        start_session()
    except Exception as exc:
        print(f"\n  Could not start a session: {exc}")
        print("  Check e2e/README.md — a booted simulator and `appium` are required.")
        return 2

    results = []
    started = time.time()
    try:
        for group, name, fn in cases:
            print(f"\n[{group}] {name}")
            check = Check(name)
            case_started = time.time()
            try:
                fn(check)
            except Exception:
                check.failures.append("raised an exception")
                print("    FAIL  raised an exception")
                traceback.print_exc()
                try:
                    shot = screenshot(f"FAIL-{name}")
                    print(f"          screenshot: {shot}")
                except Exception:
                    pass
            check.seconds = time.time() - case_started
            results.append((group, name, check))
    finally:
        stop_session()

    print("\n" + "=" * 68)
    failed = [(g, n, c) for g, n, c in results if c.failures]
    for group, name, check in results:
        mark = "FAIL" if check.failures else "pass"
        print(f"  {mark}  {group}/{name}  "
              f"({len(check.passes)} passed, {len(check.failures)} failed)")
    for group, name, check in failed:
        for f in check.failures:
            print(f"        {group}/{name}: {f}")

    # Slowest cases first. Runtime is the reason this suite gets skipped, so it
    # is worth printing rather than timing by hand.
    slow = sorted(results, key=lambda r: -getattr(r[2], "seconds", 0))[:5]
    if slow:
        print("\n  slowest:")
        for group, name, check in slow:
            print(f"        {int(getattr(check, 'seconds', 0)):4d}s  {group}/{name}")

    total_checks = sum(len(c.passes) + len(c.failures) for _, _, c in results)
    print(f"\n  {len(results) - len(failed)}/{len(results)} cases, "
          f"{total_checks} checks, {int(time.time() - started)}s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
