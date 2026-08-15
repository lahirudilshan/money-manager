#!/usr/bin/env python3
"""Run the end-to-end suite against a booted simulator.

    python3 e2e/run.py                    # everything
    python3 e2e/run.py regressions        # one file
    python3 e2e/run.py delete-subcategory # one case

Exits non-zero when any case fails, so it can gate a commit.
"""
import importlib.util
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
    return found


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

    total_checks = sum(len(c.passes) + len(c.failures) for _, _, c in results)
    print(f"\n  {len(results) - len(failed)}/{len(results)} cases, "
          f"{total_checks} checks, {int(time.time() - started)}s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
