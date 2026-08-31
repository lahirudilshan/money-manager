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

#: Which snapshot the simulator's database currently holds, and whether a case
#: has written to it since.
#:
#: Restoring costs ~12s (kill the app, copy three files, relaunch, wait for the
#: board to load), and the suite was paying it before every case even when the
#: device already held that exact board and nothing had touched it. Remembering
#: what is loaded turns most of those restores into a no-op.
#:
#: `dirty` is the safety catch. A case that spends money or edits a line leaves
#: a board that is no longer the snapshot, so the NEXT request for that
#: snapshot must actually restore. Anything that mutates app data marks it —
#: see `mark_data_dirty`.
_device = {"snapshot": None, "dirty": True}


def mark_data_dirty():
    """Declare that the app's data no longer matches the snapshot it came from.

    Called by every helper that writes through the UI. A case that adds a
    transaction and one that only reads a screen are indistinguishable from
    here, so this errs toward marking: a needless restore costs 12 seconds, a
    missed one hands the next case a board with someone else's spending on it.
    """
    _device["dirty"] = True


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


#: Words that mean "write this to the database". A tap on one of these leaves
#: the board different from the snapshot it was restored from, so the next case
#: asking for that snapshot must get a real restore rather than the fast path.
#:
#: Matching on the LABEL rather than marking every tap is deliberate: almost
#: every tap is navigation, and marking those would make each case restore again
#: and give back the entire saving. The list errs long — a word here that turns
#: out not to write costs one needless restore, while a missing one leaks data
#: into the next case.
_COMMIT_WORDS = ("save", "done", "delete", "remove", "confirm", "mark",
                 "pay", "add", "create", "apply", "restore", "reset")


def _is_commit(label):
    return any(w in str(label).lower() for w in _COMMIT_WORDS)


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
            if _is_commit(label):
                mark_data_dirty()
            return True

    req("POST", f"/session/{sid()}/element/{e}/click", {})
    time.sleep(settle)
    invalidate_source()
    if _is_commit(label):
        mark_data_dirty()
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
    # Typing is always data entry, so the board no longer matches its snapshot.
    mark_data_dirty()
    return req("GET", f"/session/{sid()}/element/{e}/attribute/value").get("value")


def dismiss_keyboard(settle=0.8):
    """Close the software keyboard if it is up. Returns True if it was.

    The keyboard overlays the BOTTOM of the screen, which is exactly where the
    tab bar lives — its keys sit at the same y as Dashboard/List/Loans/Settings.
    A tap aimed at a tab while a field is focused therefore hits a key instead,
    and Appium reports a perfectly successful tap on the wrong thing.

    That produced a failure that looked nothing like its cause: the SMS case
    leaves a text field focused, so the NEXT case to want Settings tapped the
    keyboard, stayed on the dashboard, and failed with "settings shows no
    sections" — a screen it had never actually left the dashboard to reach.

    Same family as the dev-client gear `tap` already works around: something
    floating above the app swallowing a tap meant for it.
    """
    if not _keyboard_up():
        return False

    # `mobile: hideKeyboard` is the obvious call and it does NOT work here —
    # WebDriverAgent answers "Did not know how to dismiss the keyboard", because
    # a React Native TextInput offers it no Done/Return accessory to press.
    #
    # So dismiss it the way a person does: tap empty space above the keyboard.
    #
    # The point is picked from the keyboard's OWN top edge rather than a guessed
    # fraction of the screen, and only the gap between the nav bar and that edge
    # is used — a fixed fraction lands on a real control on any screen whose
    # content happens to reach it, and a stray tap that navigates somewhere is
    # far worse than a keyboard left up.
    top = _keyboard_top()
    win = req("GET", f"/session/{sid()}/window/rect").get("value") or {}
    w, h = win.get("width", 390), win.get("height", 844)
    if top is None:
        top = h * 0.55
    y = (60 + top) / 2          # midway between the nav bar and the keyboard
    if y < 60 or y >= top:      # no usable gap; leave it rather than tap blind
        return False
    tap_xy(w * 0.5, y)
    time.sleep(settle)
    invalidate_source()
    return not _keyboard_up()


def _keyboard_top():
    """The y of the keyboard's top edge, or None when it is not up."""
    res = req("POST", f"/session/{sid()}/elements",
              {"using": "-ios class chain", "value": "**/XCUIElementTypeKeyboard"})
    for el in (res.get("value") or []):
        eid = el.get("element-6066-11e4-a52e-4f735466cecf") or el.get("ELEMENT")
        r = req("GET", f"/session/{sid()}/element/{eid}/rect").get("value")
        if isinstance(r, dict):
            return r.get("y")
    return None


def _keyboard_up():
    """Is the software keyboard on screen?

    Asks for the keyboard element itself rather than looking for key labels in
    the tree: `Key` also matches ordinary words, and a false positive here costs
    a stray tap on every navigation.
    """
    res = req("POST", f"/session/{sid()}/elements",
              {"using": "-ios class chain", "value": "**/XCUIElementTypeKeyboard"})
    return bool(res.get("value"))


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


def built_board(bank="Commercial Bank of Ceylon", hint="Commercial Bank",
                amounts=None, cache=None, second_bank=None, second_hint=None):
    """A finished board with real amounts — walked once, then restored.

    Two case files each carried their own byte-identical copy of this walk, and
    every case calling one paid the full four minutes to rebuild a board the
    previous case had just built. That was over half the suite's runtime spent
    reproducing identical state.

    The board is only SQLite files, so the first call walks the flow properly
    and saves them; every later call — in this run or a later one — restores in
    seconds. Keyed by BANK, since that is the input which changes what the
    finished board contains; asking for a different bank builds and caches its
    own rather than silently handing back the wrong board.

    NOT for cases about onboarding ITSELF. Those must call `fresh_install()` and
    walk it, because the walk is the thing under test — a restored board would
    skip the very screens they exist to check. See `test_regressions.py`.
    """
    # The cache key names every input that changes what the finished board
    # contains, so a two-bank board never comes back when a one-bank board was
    # asked for (or the reverse).
    key = bank if not second_bank else f"{bank}+{second_bank}"
    cache = cache or f"board-{key.lower().replace(' ', '-')}"
    if has_snapshot(cache) and restore_db(cache):
        return True

    amounts = amounts or [50000, 12000, 3000, 2500, 8000, 25000, 4000, 1800, 6000]

    fresh_install()
    start_onboarding()
    tap(bank, required=True)
    if second_bank:
        tap(second_bank, required=True)
    tap("Continue", required=True)
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
        if second_bank:
            # Alternate, so BOTH accounts end up funding real bills — a board
            # with everything on one card cannot exercise a split transfer.
            tap(hint if i % 2 == 0 else (second_hint or second_bank), partial=True)
            time.sleep(0.4)
        elif "Required" in screen_text():
            tap(hint, partial=True)
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

    # Save what was just built so nothing walks this flow again — but only once
    # it is demonstrably a finished board.
    #
    # An unchecked save is how the two-bank fixture came to hold a copy of a
    # real phone's board: whatever was on the device at the time got written
    # under this name, and every later case restored it believing it had asked
    # for a freshly walked one. A snapshot is trusted for the rest of the
    # suite's life, so it is worth one query to confirm before writing it.
    if not db_query("SELECT 1 FROM subcategories LIMIT 1"):
        return False
    snapshot_db(cache)
    return True


#: The state a persona case actually needs: database wiped, app sitting on the
#: onboarding questions. Snapshotted like a board, because getting there costs a
#: 14s wipe plus a 12s cold launch through the welcome gate, and eight cases
#: each paid it to reach a screen that is byte-identical every time.
BLANK = "blank-onboarding"


def blank_slate(wait=2.0):
    """A wiped device sitting on the first onboarding question.

    `fresh_install()` deletes the database and waits out a cold launch; that is
    the correct thing to do and these cases genuinely need it, but the RESULT is
    always the same empty database. So it is cached exactly like a board: walk
    it once, restore it thereafter.

    The distinction that matters is between a wiped database and a MIGRATED one.
    A restored blank snapshot is a real empty database created by this app, so
    the migration bug in `test_fresh_install_can_finish_onboarding` still
    reproduces against it — but that case is about the wipe itself, so it keeps
    calling `fresh_install()` directly rather than coming through here.
    """
    had_snapshot = has_snapshot(BLANK)
    if had_snapshot and restore_db(BLANK):
        if _ready_for_banks(wait):
            return True
        # Restored, but not usable: iOS resumed the app deeper in, or the
        # previous case's bank tiles are still selected. Fall through to a real
        # wipe rather than hand back a dirty screen.
        relaunch()
        if _ready_for_banks(wait):
            return True

    fresh_install()
    if not _ready_for_banks(wait):
        return False

    # Save only the FIRST time. Re-saving on every fallthrough overwrote a good
    # snapshot with whatever was on screen at the time — once that was a
    # half-loaded app, and every later case restored the broken copy and failed
    # looking for a bank tile on a splash screen. The snapshot is a fixture: it
    # is written once and then only read.
    if not had_snapshot:
        snapshot_db(BLANK)
        # Saving relaunches the app, which lands back on the welcome gate.
        return _ready_for_banks(wait)
    return True


def _ready_for_banks(wait=2.0):
    """Wait for the bank question to be showing, with nothing selected.

    Both halves matter, and neither is instant: a relaunched app spends a second
    or two on its splash screen before any tile exists, so asking once answers
    "no tiles" for a screen that is merely still loading.
    """
    for _ in range(8):
        if start_onboarding(wait) and _no_banks_selected():
            return True
        time.sleep(1.0)
        invalidate_source()
    return False


def _no_banks_selected():
    """Is the bank question showing with nothing picked?

    The selection lives in React component state, NOT in the database: picking a
    bank writes no row (`cards` stays empty until the plan is committed), so
    restoring a blank database does not clear it and neither does relaunching —
    expo-router resumes the same screen with its state intact.

    That is how a persona case inherited the PREVIOUS persona's bank and saw "3
    accounts selected" after choosing two. Cheap to detect, and the caller wipes
    for real when it is true, so no case can start from a half-filled form.
    """
    return not any("account" in l and "selected" in l
                   for l in labels(refresh=True))


def start_onboarding(wait=2.0):
    """Get past the welcome gate to the first real onboarding question.

    A fresh install no longer opens on "Where do you bank?" — it opens on
    "Already using this app?", offering to restore a backup first, with
    "Set up a new plan" leading to the questions. Every case that walks
    onboarding hit that gate and failed looking for a bank tile one screen
    further in, which read as "the tile is missing" rather than "there is a
    screen in front of it".

    Idempotent: returns True when the bank question is already showing, so a
    caller need not know which screen it landed on.
    """
    if exists("Where do you bank?"):
        return True
    if exists("Set up a new plan"):
        tap("Set up a new plan", required=True)
        time.sleep(wait)
    return exists("Where do you bank?")


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
    # The database is gone, so no snapshot is loaded — the next request for one
    # must genuinely restore rather than trusting what was here before.
    _device.update(snapshot=None, dirty=True)


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
    # What was just saved is exactly what the device holds, so the case that
    # built it need not restore it back again.
    _device.update(snapshot=name, dirty=False)


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

    # Already loaded and untouched: there is nothing to copy. This is the whole
    # saving — most cases ask for the same board the previous case asked for,
    # and re-copying identical bytes then waiting 9s for a relaunch bought
    # nothing. `dirty` guarantees correctness: any case that wrote data cleared
    # this, so the restore below still runs when it matters.
    if _device["snapshot"] == name and not _device["dirty"]:
        return True

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
    _device.update(snapshot=name, dirty=False)
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
