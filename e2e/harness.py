#!/usr/bin/env python3
"""Appium/XCUITest harness for the money-manager end-to-end suite.

## Why this exists

The unit tests (`vitest`) cover pure logic and cannot see the app. Several of
the worst defects found so far were invisible to them by construction:

  - a fresh install could not commit an onboarding plan at all, because a
    migration ran before the table it migrates existed;
  - the dashboard reported "Nothing due right now" on a board full of unpaid
    bills, because its filter dropped everything more than 7 days out;
  - the last card on five onboarding screens sat permanently under the pinned
    footer, unreachable no matter how far the user scrolled.

Each needed a real app, on a real screen, driven like a person. That is what
this is for.

## Why XCUITest rather than coordinates

Taps address elements by ACCESSIBILITY LABEL, so a test says `tap("Continue")`
and keeps working when the layout moves. Earlier attempts used AppleScript
clicks at pixel coordinates; they broke the moment the Simulator window moved to
a second display, and AppleScript's `scroll` is a wheel event the Simulator
never forwards into the guest — so scrolling silently did nothing and looked
exactly like an app that refused to scroll.

## Running

    python3 e2e/run.py              # everything
    python3 e2e/run.py smoke        # one case

See e2e/README.md for the simulator/Appium prerequisites.
"""
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request

BASE = os.environ.get("APPIUM_URL", "http://127.0.0.1:4723")
UDID = os.environ.get("SIM_UDID", "")
BUNDLE = os.environ.get("APP_BUNDLE", "com.anonymous.moneymanager")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS = os.path.join(REPO, "e2e", "artifacts")
SNAPSHOTS = os.path.join(REPO, "e2e", "artifacts", "snapshots")

_session = {"id": None}


# ----------------------------------------------------------------- transport


def req(method, path, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"value": None}
    except Exception:
        return {"value": None}


def sid():
    return _session["id"]


def start_session(udid=None):
    """Attach to the simulator, building WebDriverAgent on first run."""
    udid = udid or UDID or _first_booted_sim()
    if not udid:
        raise RuntimeError("No booted simulator. Boot one with `xcrun simctl boot <udid>`.")

    res = req("POST", "/session", {"capabilities": {"alwaysMatch": {
        "platformName": "iOS",
        "appium:automationName": "XCUITest",
        "appium:udid": udid,
        "appium:bundleId": BUNDLE,
        "appium:noReset": True,
        "appium:newCommandTimeout": 900,
        "appium:wdaLaunchTimeout": 240000,
    }, "firstMatch": [{}]}}, timeout=420)

    value = res.get("value") or {}
    if "sessionId" not in value:
        raise RuntimeError(f"Could not start an Appium session: {str(value)[:400]}")

    _session["id"] = value["sessionId"]
    globals()["UDID"] = udid
    return value["sessionId"]


def stop_session():
    if _session["id"]:
        req("DELETE", f"/session/{_session['id']}")
        _session["id"] = None


def _first_booted_sim(auto_boot=True):
    """The booted simulator's UDID, booting one if none is running.

    Simulators shut themselves down after a period of inactivity, which turned a
    long suite into "Could not start a session" partway through — a failure that
    says nothing about the app. Booting on demand keeps a run recoverable.
    """
    def booted():
        out = subprocess.run(["xcrun", "simctl", "list", "devices", "booted"],
                             capture_output=True, text=True).stdout
        m = re.search(r"\(([0-9A-F-]{36})\) \(Booted\)", out)
        return m.group(1) if m else None

    udid = booted()
    if udid or not auto_boot:
        return udid

    # Prefer whichever device already has the app installed; otherwise the
    # first iPhone available.
    listing = subprocess.run(["xcrun", "simctl", "list", "devices", "available"],
                             capture_output=True, text=True).stdout
    candidate = re.search(r"iPhone [^(]*\(([0-9A-F-]{36})\) \(Shutdown\)", listing)
    if not candidate:
        return None

    print("  No simulator booted — booting one…")
    subprocess.run(["xcrun", "simctl", "boot", candidate.group(1)], capture_output=True)
    for _ in range(20):
        time.sleep(3)
        if booted():
            return booted()
    return None


# ------------------------------------------------------------------ querying


"""Cached page source.

`GET /source` serialises the entire accessibility tree and costs ~6 SECONDS on
this app — it is by far the most expensive thing the harness does, and
`labels()`, `screen_text()` and every `check.on_screen()` call it. A case that
reads the screen ten times was paying a minute for information that had not
changed between reads.

So the XML is cached and invalidated by anything that could alter the screen: a
tap, a text write, a swipe, a relaunch. Reads in between are free.

`_source_dirty` starts True so the first read of a session always fetches.
"""
_source_cache = {"xml": "", "dirty": True}


def invalidate_source():
    """Mark the cached tree stale. Called by every mutating helper."""
    _source_cache["dirty"] = True


def source(refresh=False):
    if refresh or _source_cache["dirty"]:
        v = req("GET", f"/session/{sid()}/source").get("value")
        _source_cache["xml"] = v if isinstance(v, str) else ""
        _source_cache["dirty"] = False
    return _source_cache["xml"]


def labels(refresh=False):
    """Every distinct accessibility label currently on screen."""
    out, seen = [], set()
    for n in re.findall(r'(?:name|label)="([^"]{1,120})"', source(refresh)):
        n = (n.replace("&amp;", "&").replace("&quot;", '"')
              .replace("&apos;", "'").replace("&#10;", " "))
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def screen_text(refresh=False):
    return " ".join(labels(refresh))


def _element_id(res):
    v = res.get("value")
    if isinstance(v, dict):
        return v.get("element-6066-11e4-a52e-4f735466cecf") or v.get("ELEMENT")
    return None


def find(label, partial=False):
    if not partial:
        e = _element_id(req("POST", f"/session/{sid()}/element",
                            {"using": "accessibility id", "value": label}))
        if e:
            return e
    safe = label.replace("'", "\\'")
    return _element_id(req("POST", f"/session/{sid()}/element",
                           {"using": "-ios class chain",
                            "value": f"**/XCUIElementTypeAny[`label CONTAINS[c] '{safe}'`]"}))


def exists(label, partial=True):
    """Is this label on screen?

    Deliberately asks Appium directly rather than consulting the cached tree.

    An earlier version answered from the cache, which was much faster and
    quietly wrong: reading `screen_text()` REFILLS the cache and clears its
    dirty flag, so a later `tap` could resolve against a snapshot taken before
    the screen had settled. Three regression cases started failing on elements
    that were plainly present.

    The cache still pays for itself on `labels()` and `screen_text()`, which are
    reads with no such side effect. Membership tests stay honest.
    """
    return find(label, partial) is not None


def rect(label, partial=False):
    e = find(label, partial)
    return req("GET", f"/session/{sid()}/element/{e}/rect").get("value") if e else None


# ---------------------------------------------------------------- interaction


_gear_rect_cache = {"value": "unset"}


def _dev_menu_rect():
    """The Expo dev-client gear, which floats ABOVE the app in dev builds.

    It is not part of the app and never ships, but it swallows taps beneath it —
    a bank tile it happened to cover looked exactly like a tile that refused to
    select, which cost a false bug report. Taps that would land in its halo are
    aimed elsewhere within the same element instead.

    Cached for the whole session: the gear is fixed chrome that never moves, and
    looking it up cost two round trips on EVERY tap — the single most frequent
    operation in the suite.
    """
    if _gear_rect_cache["value"] == "unset":
        g = find("gearshape.fill")
        _gear_rect_cache["value"] = (
            req("GET", f"/session/{sid()}/element/{g}/rect").get("value") if g else None
        )
    return _gear_rect_cache["value"]


def tap_xy(x, y):
    req("POST", f"/session/{sid()}/actions", {"actions": [{
        "type": "pointer", "id": "finger", "parameters": {"pointerType": "touch"},
        "actions": [{"type": "pointerMove", "duration": 0, "x": int(x), "y": int(y)},
                    {"type": "pointerDown", "button": 0},
                    {"type": "pause", "duration": 60},
                    {"type": "pointerUp", "button": 0}]}]})


def tap(label, partial=False, settle=1.6, required=False):
    """Tap an element. With `required`, a miss raises instead of returning False."""
    e = find(label, partial)
    if not e:
        if required:
            raise AssertionError(f"element not found: {label!r}")
        return False

    r = req("GET", f"/session/{sid()}/element/{e}/rect").get("value")
    gear = _dev_menu_rect()
    if isinstance(r, dict) and isinstance(gear, dict):
        cx, cy = r["x"] + r["width"] / 2, r["y"] + r["height"] / 2
        pad = 40
        if (gear["x"] - pad <= cx <= gear["x"] + gear["width"] + pad
                and gear["y"] - pad <= cy <= gear["y"] + gear["height"] + pad):
            tap_xy(cx, r["y"] + r["height"] * 0.2)
            # Settle FIRST, then mark stale. Invalidating before the sleep let a
            # read refetch mid-animation, capture the pre-tap screen, and then
            # trust that snapshot as current — losing the change the tap made.
            time.sleep(settle)
            invalidate_source()
            return True

    req("POST", f"/session/{sid()}/element/{e}/click", {})
    time.sleep(settle)
    invalidate_source()
    return True


def set_text(value, index=0, settle=1.4):
    """Type into the Nth text field on screen.

    Money fields are bare TextInputs with no accessibility label of their own,
    so they are addressed by position within the open sheet — stable, because a
    line editor only ever shows one or two.
    """
    res = req("POST", f"/session/{sid()}/elements",
              {"using": "-ios class chain", "value": "**/XCUIElementTypeTextField"})
    vals = res.get("value") or []
    if len(vals) <= index:
        raise AssertionError(f"no text field at index {index}")
    e = vals[index].get("element-6066-11e4-a52e-4f735466cecf") or vals[index].get("ELEMENT")
    req("POST", f"/session/{sid()}/element/{e}/click", {})
    time.sleep(0.35)
    # Clear first — the field keeps what was typed before, so setting 50000 over
    # an existing 5 produced "5" plus stray digits.
    req("POST", f"/session/{sid()}/element/{e}/clear", {})
    time.sleep(0.25)
    req("POST", f"/session/{sid()}/element/{e}/value", {"text": str(value)})
    time.sleep(settle)
    invalidate_source()
    return req("GET", f"/session/{sid()}/element/{e}/attribute/value").get("value")


def swipe(direction="up", settle=1.1):
    req("POST", f"/session/{sid()}/execute/sync",
        {"script": "mobile: swipe", "args": [{"direction": direction}]})
    time.sleep(settle)
    invalidate_source()


def scroll_to(label, tries=10, partial=True):
    for _ in range(tries):
        if exists(label, partial):
            return True
        swipe("up")
    return False


def wait_for_text(text, tries=12, delay=0.75):
    """Poll until `text` appears anywhere on screen.

    Screens that recompute as you type — the loan preview above all — are not
    settled when the write that triggered them returns. A single read a fixed
    moment later catches the card mid-update and reports a figure as missing
    when it arrives a beat afterwards. Polling is both faster in the common case
    and not flaky.
    """
    for _ in range(tries):
        # `refresh=True`: the whole point is to observe a screen that is still
        # changing, so this is the one reader that must never trust the cache.
        if text in screen_text(refresh=True):
            return True
        time.sleep(delay)
    return False


# ------------------------------------------------------------ app lifecycle


def relaunch(wait=8):
    req("POST", f"/session/{sid()}/execute/sync",
        {"script": "mobile: terminateApp", "args": [{"bundleId": BUNDLE}]})
    time.sleep(2)
    req("POST", f"/session/{sid()}/execute/sync",
        {"script": "mobile: launchApp", "args": [{"bundleId": BUNDLE}]})
    time.sleep(wait)
    invalidate_source()


def fresh_install(wait=14):
    """Delete the database and relaunch — the state a new user starts from.

    This is what caught the migration bug: the app worked perfectly on any
    device that had been upgraded, and could not finish setup on a new one.
    """
    req("POST", f"/session/{sid()}/execute/sync",
        {"script": "mobile: terminateApp", "args": [{"bundleId": BUNDLE}]})
    time.sleep(2)
    container = subprocess.run(
        ["xcrun", "simctl", "get_app_container", UDID, BUNDLE, "data"],
        capture_output=True, text=True).stdout.strip()
    if container:
        subprocess.run(
            f'rm -f "{container}/Library/Application Support/money-manager.db"*',
            shell=True, capture_output=True)
    req("POST", f"/session/{sid()}/execute/sync",
        {"script": "mobile: launchApp", "args": [{"bundleId": BUNDLE}]})
    time.sleep(wait)
    invalidate_source()


def _db_path():
    container = subprocess.run(
        ["xcrun", "simctl", "get_app_container", UDID, BUNDLE, "data"],
        capture_output=True, text=True).stdout.strip()
    return os.path.join(container, "Library", "Application Support", "money-manager.db")


def snapshot_db(name):
    """Copy the app's database aside, so a board can be restored in seconds.

    Walking onboarding takes 90-120 seconds, and the suite was doing it ~24
    times — over half the total runtime spent rebuilding identical state. A
    board is just three SQLite files; saving them once and restoring per case is
    the same state at a fraction of the cost.
    """
    req("POST", f"/session/{sid()}/execute/sync",
        {"script": "mobile: terminateApp", "args": [{"bundleId": BUNDLE}]})
    time.sleep(1.5)
    os.makedirs(SNAPSHOTS, exist_ok=True)
    db = _db_path()

    # Fold the write-ahead log into the main file BEFORE copying.
    #
    # The app runs in WAL mode, so a freshly built board leaves a 4KB .db beside
    # a 2.4MB -wal. Copying all three preserved the data but not the speed:
    # every restore then had to replay that log on launch, which cost as much as
    # the onboarding walk it was meant to replace.
    subprocess.run(["sqlite3", db, "PRAGMA wal_checkpoint(TRUNCATE);"],
                   capture_output=True)

    for suffix in ("", "-wal", "-shm"):
        src = f"{db}{suffix}"
        if os.path.exists(src):
            subprocess.run(["cp", src, os.path.join(SNAPSHOTS, f"{name}.db{suffix}")],
                           capture_output=True)
    req("POST", f"/session/{sid()}/execute/sync",
        {"script": "mobile: launchApp", "args": [{"bundleId": BUNDLE}]})
    time.sleep(6)
    invalidate_source()


def has_snapshot(name):
    return os.path.exists(os.path.join(SNAPSHOTS, f"{name}.db"))


def restore_db(name, wait=9):
    """Put a saved board back and relaunch. Returns False when none is saved.

    All three SQLite files are handled together: `-wal` holds committed
    transactions not yet folded into the main file, so restoring `.db` alone can
    resurrect a board missing its most recent writes.
    """
    if not has_snapshot(name):
        return False

    req("POST", f"/session/{sid()}/execute/sync",
        {"script": "mobile: terminateApp", "args": [{"bundleId": BUNDLE}]})
    time.sleep(1.5)

    db = _db_path()
    subprocess.run(f'rm -f "{db}"*', shell=True, capture_output=True)
    for suffix in ("", "-wal", "-shm"):
        src = os.path.join(SNAPSHOTS, f"{name}.db{suffix}")
        if os.path.exists(src):
            subprocess.run(["cp", src, f"{db}{suffix}"], capture_output=True)

    req("POST", f"/session/{sid()}/execute/sync",
        {"script": "mobile: launchApp", "args": [{"bundleId": BUNDLE}]})
    time.sleep(wait)
    invalidate_source()
    return True


def db_query(sql):
    """Read the app's SQLite directly — for asserting on what was WRITTEN.

    Some guarantees are invisible on screen: that bank charges are stored with
    no funding account, say. Checking the database is the only honest way to
    assert those.
    """
    container = subprocess.run(
        ["xcrun", "simctl", "get_app_container", UDID, BUNDLE, "data"],
        capture_output=True, text=True).stdout.strip()
    db = os.path.join(container, "Library", "Application Support", "money-manager.db")
    out = subprocess.run(["sqlite3", db, sql], capture_output=True, text=True)
    return [line for line in out.stdout.strip().split("\n") if line]


def screenshot(name):
    os.makedirs(ARTIFACTS, exist_ok=True)
    path = os.path.join(ARTIFACTS, f"{name}.png")
    subprocess.run(["xcrun", "simctl", "io", UDID, "screenshot", path],
                   capture_output=True)
    return path


def runtime_errors_since(mark_ms):
    """Errors the app logged to Metro since `mark_ms`.

    A screen can look perfectly correct while the app is throwing underneath —
    so every case asserts on this as well as on what is visible.
    """
    out = []
    log = os.path.join(REPO, ".expo", "dev", "logs", "start.log")
    try:
        with open(log) as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if d.get("_t", 0) < mark_ms or d.get("_e") != "metro:client_log":
                    continue
                if d.get("level") == "error":
                    out.append(" ".join(str(x) for x in d.get("data", []))[:400])
    except FileNotFoundError:
        pass
    return out


def now_ms():
    return int(time.time() * 1000)


# --------------------------------------------------------------- assertions


class Check:
    """Collects assertions so one failure does not hide the rest of a case."""

    def __init__(self, case):
        self.case = case
        self.failures = []
        self.passes = []

    def that(self, condition, description):
        if condition:
            self.passes.append(description)
            print(f"    PASS  {description}")
        else:
            self.failures.append(description)
            print(f"    FAIL  {description}")
        return bool(condition)

    def on_screen(self, text, description=None):
        return self.that(text in screen_text(), description or f"screen shows {text!r}")

    def not_on_screen(self, text, description=None):
        return self.that(text not in screen_text(),
                         description or f"screen does NOT show {text!r}")

    def no_errors(self, mark_ms):
        errs = runtime_errors_since(mark_ms)
        ok = self.that(not errs, "no runtime errors")
        for e in errs[:5]:
            print(f"          {e[:220]}")
        return ok
