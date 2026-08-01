# Shared merchant catalog

The community half of transaction detection: a Next.js 16 JSON API over Neon
Postgres.

The app keeps its own `merchant_rules` table for **personal** mappings — which
of *your* budget lines a merchant belongs to. That is local-only and always will
be: a subcategory id means nothing on another device, and your line names are
your business.

What generalises is the semantic bucket and the shape of the transaction around
it. "keells" is groceries for everyone; a DIALOG debit of ~2k is a phone bill
while ~90k is a handset. This service stores those signals, one vote per device,
so a correction one user makes becomes a suggestion for everyone.

## Why an API instead of connecting to Postgres directly

The connection string cannot ship inside the app — anyone can unzip an APK or
IPA and read it, and the role can write, so one leaked build would let a stranger
rewrite the hints every user receives. The app holds only
`EXPO_PUBLIC_HINTS_API`, a public base URL that grants nothing on its own.
`lib/db.ts` is marked `server-only`, so importing it anywhere reachable from a
client bundle is a build error rather than a leak found later.

## What crosses the network

Uploaded, and nothing else:

```json
{
  "deviceId": "<random uuid>",
  "observations": [
    { "merchant": "keells", "hint": "groceries",
      "sender": "HNB", "direction": "debit", "amountBucket": "2k_10k" }
  ]
}
```

**Never uploaded**: message text in any form (raw, redacted or templated), exact
amounts, balances, card or account numbers, reference ids, dates, or your
category and line names.

That is enforced, not just documented. The payload schema is `.strict()`, so an
unknown field is a **400**, not a silently dropped one — a future client bug
cannot quietly start leaking message contents. Nine tests in `e2e.mjs` assert
exactly this, one per field someone might be tempted to add.

`amountBucket` is a coarse band (six of them), never the amount: the amount is a
personal detail and, across a few transactions, a fingerprint. A band still
separates "phone bill" from "new handset", which is all the ranking needs.

`sender` is the bank's public short code, never the user's number — the schema
rejects anything shaped like a phone number.

`deviceId` is a random UUID in the device keystore, tied to no account, phone
number or hardware id. Its only job is stopping one device voting a hundred
times. Turning sharing off in Settings discards it.

## Layout

Each file has one job, so a change has one obvious home:

| File | Responsibility |
|---|---|
| `lib/contract.ts` | Wire schemas. `.strict()` here **is** the privacy boundary. |
| `lib/repository.ts` | Every SQL statement, and nothing else. |
| `lib/score.ts` | Pure ranking — the weights, readable without SQL. |
| `lib/catalog.ts` | Caching over repository + score. |
| `lib/hints.ts` | Keyword inference. |
| `lib/rank.ts` | Pure board ranking. |
| `lib/http.ts` | CORS, JSON, validation, error handling. |
| `app/api/*/route.ts` | Validate → delegate → respond. Nothing else. |

Routes are thin because the plumbing every one repeated — parse body, run
schema, shape a 400, catch, log, 500 — lives in `readJson`/`readQuery`/`guard`.
That is exactly the code that drifts apart until one endpoint validates
differently from the others.

## Where detection lives

Detection is **server-side**; parsing is **on-device**. The split is deliberate:

- **parsing** (`src/core/smsParser.ts`) stays local because it is the only part
  that touches the raw SMS, with its balances, account numbers and reference
  ids. That text never leaves the phone.
- **inference and ranking** (`lib/hints.ts`, `lib/rank.ts`) live here, so a
  keyword that fires too broadly or a weight that mis-ranks is a deploy rather
  than an app release and a wait for users to update.

The app is **local-first**. It mirrors the whole catalog into SQLite at launch
(`/api/hints`), and every message after that is categorised **on-device with no
network call at all**.

That is not an optimisation, it is the requirement: an SMS arrives when a
transaction happens — at a fuel pump, in a supermarket queue, on a bus — which
is exactly where signal is worst. A per-transaction round trip would fail the
feature precisely when it is needed.

The economics back it up. At ~30 bytes per merchant the entire catalog is
**~28 KB gzipped at 1,000 users** and ~78 KB at 100,000, and pulls are
incremental after the first. Mirroring costs far less than one API call per
transaction, for both the user's data plan and your Neon bill.

Precedence on-device, strongest first:

1. the user's **own** learned rule — never overwritten by any sync
2. the **mirrored** crowd catalog — hint only, never a budget line
3. the **shipped** keywords — the floor, works from first install

`/api/detect` still exists but is **not on the app's path** — see below.

`src/core/__tests__/merchantKeyParity.test.ts` pins the duplicated pieces
(`merchantKey`, the amount bands, the hint self-words) so the two cannot drift —
if they did, the same message would be categorised differently depending on
whether the network happened to be up.

## Endpoints

### `POST /api/detect` — not used by the mobile app

Server-side detection: one call answers "what is this, and which of your lines
does it belong to?". Combines the shipped keywords, the crowd catalog, and the
caller's board (sent with the request, used once, never stored).

The app does not call this — it detects locally from the mirror. Kept as the
entry point for a client with no local database (a web dashboard, an
integration), and because its tests are what guard `lib/hints.ts` and
`lib/rank.ts`, whose keyword quality the mirrored catalog depends on.

```json
{ "hint": "groceries", "lineId": "l-groceries",
  "matches": [{ "lineId": "l-groceries", "score": 0.64 }],
  "suggestions": [{ "hint": "groceries", "confidence": 1, "reason": "merchant-amount" }] }
```

Merchant lookup is exact-then-**containment**, because POS text appends branches
and cities: `F L I TRADING GALLE` normalises to `fli trading galle`, which is not
equal to the `fli trading` the crowd voted on. A length floor stops short keys
("ceb", "ioc") firing on any merchant that happens to contain those letters.

### `GET /api/hints?since=<cursor>&limit=<n>`

The winning hint per merchant, changed since the cursor. Used by the background
sync at launch.

```json
{
  "rules": [{ "merchant": "keells", "hint": "groceries", "votes": 42, "source": "seed", "margin": 40 }],
  "nextSince": "2026-08-01T09:02:05.984692Z|138",
  "hasMore": false
}
```

`margin` is the winner's lead over the runner-up. The client ignores anything
below `MIN_MARGIN` — a 40-vs-39 split is a coin flip and must not reach devices
looking settled. Ranking runs over *all* candidates and the popularity floor is
applied afterwards; filtering first would hide the runner-up and report a
contested merchant as unanimous.

The cursor is `"<microsecond iso>|<id>"`, not a bare timestamp. Postgres stores
microseconds and a JS `Date` holds milliseconds, so round-tripping through a Date
truncates `.984692` to `.984` — which sorts *before* the row it came from,
serving that row forever and hanging a paging client. The id breaks ties when two
rows share a timestamp.

### `GET /api/suggest?merchant=&sender=&direction=&amountBucket=`

Up to three ranked suggestions for one transaction — the dashboard row shows the
top one, the detail sheet shows the alternatives.

```json
{ "suggestions": [{ "hint": "groceries", "confidence": 0.82, "reason": "merchant" }] }
```

Three evidence sources, strongest first: the merchant's vote tally; the same
narrowed by direction and amount band (`reason: "merchant-amount"`); and the
sender's overall distribution, consulted only when the merchant is unknown, so a
first-ever DIALOG message still suggests telecom.

Confidence is a *share* of the evidence, not a raw count — 8 of 10 votes is 0.8
whether a merchant has ten votes or ten thousand, which is what makes the number
comparable between rows.

### `POST /api/contribute`

Records observations. One **vote** per device per merchant: re-voting is
idempotent and changing a vote *moves* it, re-tallying the hint it abandoned.
Tallies are recomputed from the votes table rather than incremented, so a retry
can never drift a count every user reads.

**Signals** are counted per observation rather than deduplicated — how *often* a
shape occurs is the signal, and one device shopping weekly is genuine evidence.
The winner-picking vote stays deduplicated, so this cannot swing the top
suggestion.

## Performance and cost

Neon bills compute time, and every device pulls on every launch, so caching is
the main cost lever:

- reads go through `use cache` + `cacheLife('minutes')` + `cacheTag`, turning
  "one query per user per launch" into a handful an hour;
- a contribution calls `revalidateTag(CATALOG_TAG, 'max')` — stale-while-
  revalidate, so a correction propagates promptly and **no reader ever blocks on
  a rebuild**;
- `/api/suggest` also sets `s-maxage`/`stale-while-revalidate` so a CDN absorbs
  repeat lookups for the same shop;
- writes are rate-limited per **observation**, not per request — a request may
  carry 100, so a request-based ceiling would let one caller do a hundred times
  the work for the same budget.

On the device, none of this blocks the UI: the sync is fired un-awaited at
launch, suggestions are fetched after the draft is already on screen (2.5s
timeout, falling back to local keywords), and contributions are fire-and-forget.

## Setup

```bash
cd server
npm install

export DATABASE_URL='postgresql://...'   # or put it in server/.env (gitignored)

npm run schema     # create tables (idempotent)
npm run seed       # load the shipped merchant catalog (idempotent)

npm run build && npm start &
npm run test:e2e   # 49 end-to-end tests against the real database
```

To run the app against it, put the backend's **LAN** address in the app's
`.env` — a simulator or phone resolves `127.0.0.1` to itself, so a localhost URL
silently fails every catalog call:

```
EXPO_PUBLIC_HINTS_API=http://192.168.1.96:3210
```

Deploy and point the app at it:

```bash
npx vercel deploy --prod
npx vercel env add DATABASE_URL production
```

In the app's `.env`:

```
EXPO_PUBLIC_HINTS_API=https://your-deployment.vercel.app
```

With that unset the feature is off — sync no-ops, the Settings rows are hidden,
and detection falls back to local keywords. A fresh clone runs with no backend.

## Adding merchants

Add to the right hint in `seed-catalog.ts`, lowercase, using the form the *bank*
prints rather than the shop's legal name. Then `npm run seed` — existing rows and
every vote are untouched.

## Tests

`npm run test:e2e` (49 tests) covers what only exists in SQL and the route
layer: vote tallying, winner/margin ranking, keyset paging, cache invalidation,
suggestion scoring, merchant containment, and the strict validation above.

Every bug it has caught lived there and none were visible by reading the code:
an inflated margin that hid a contested merchant, a truncated cursor that served
one row forever, a rate limit that counted requests instead of work, a hint that
failed to match a line named after its own category, and exact-only merchant
matching that could not recognise a shop with a branch suffix.

The pure merge logic is unit-tested on the app side in
`src/core/__tests__/catalogSync.test.ts`.

`src/core/__tests__/fullstack.integration.test.ts` runs the app's REAL parser
over real SMS samples and sends the result here — the thing that catches
contract drift between the two halves. It skips unless `HINTS_API` is set, so
`yarn test` stays a fast offline suite:

```bash
HINTS_API=http://127.0.0.1:3210 yarn test
```

`src/core/__tests__/merchantKeyParity.test.ts` pins `merchantKey` **and** the
amount bands against the app's copies. They are duplicated because the two
deploy separately; if they drift, the server stores keys under one spelling while
devices look them up under another, so nothing matches and detection silently
stops improving.

## Moderation

```sql
-- Take a merchant out of circulation (spam, bad seed). Blocked rather than
-- deleted, so re-contribution cannot resurrect it.
UPDATE merchant_hints SET blocked = TRUE WHERE merchant = 'whatever';

-- What the crowd currently thinks.
SELECT merchant, hint, votes, source FROM merchant_hints
 WHERE blocked = FALSE ORDER BY votes DESC LIMIT 50;

-- Contested merchants, worth a look.
SELECT merchant, array_agg(hint || ':' || votes ORDER BY votes DESC) AS split
  FROM merchant_hints WHERE blocked = FALSE
 GROUP BY merchant HAVING count(*) > 1 ORDER BY sum(votes) DESC LIMIT 20;
```
