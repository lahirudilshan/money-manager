/**
 * End-to-end tests for the catalog API, against a running server and a real
 * database.
 *
 * The pure merge logic is unit-tested on the app side
 * (src/core/__tests__/catalogSync.test.ts). What CANNOT be tested there is
 * everything that only exists in SQL and in the route layer: vote tallying,
 * winner/margin ranking, keyset paging, suggestion scoring, and the strict
 * payload validation that keeps message text out of a shared database. Every
 * bug this file has caught lived there.
 *
 * Usage:
 *   npm run build && npm start &        # or: npm run dev
 *   DATABASE_URL=... node e2e.mjs       # override with BASE=http://…
 *
 * Safe against the live catalog: it creates uniquely-named test merchants and
 * deletes exactly those at the end.
 */

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) {
    failures++;
    if (detail !== undefined) console.log('       ', JSON.stringify(detail));
  }
}

const dev = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** One observation with sensible defaults, so tests state only what matters. */
function obs(merchant, hint, extra = {}) {
  return { merchant, hint, direction: 'debit', amountBucket: '2k_10k', ...extra };
}

/**
 * Read /api/hints once the write cache has caught up.
 *
 * `revalidateTag(tag, 'max')` is stale-while-revalidate by design: the reader
 * that arrives immediately after a write is served the EXISTING cache while a
 * fresh one builds behind it. That is the behaviour production wants — no
 * reader ever blocks on a rebuild — so these tests wait for convergence rather
 * than asserting a consistency the API deliberately does not promise.
 *
 * `predicate` describes the state being waited for, so a genuine failure still
 * fails (after the timeout) instead of hanging.
 */
async function hintsWhen(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await get('/api/hints');
    if (predicate(last.body.rules)) return last;
    if (Date.now() > deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

// ---------------------------------------------------------------- pull ----

const all = await get('/api/hints');
check('pull returns the seeded catalog', all.body.rules.length > 100, all.body.rules?.length);
check(
  'pull returns keells as groceries',
  all.body.rules.find((r) => r.merchant === 'keells')?.hint === 'groceries',
  all.body.rules.find((r) => r.merchant === 'keells'),
);
check('pull provides a cursor', typeof all.body.nextSince === 'string', all.body.nextSince);

const repeat = await get(`/api/hints?since=${encodeURIComponent(all.body.nextSince)}`);
check('cursor pull returns no repeats', repeat.body.rules.length === 0, repeat.body.rules.length);

// Paging must terminate. A cursor that truncates sub-millisecond precision
// sorts before the row it came from, so that row is served forever.
let cursor = null;
let pages = 0;
let drained = 0;
for (; pages < 30; pages++) {
  const page = await get(
    `/api/hints?limit=50${cursor ? `&since=${encodeURIComponent(cursor)}` : ''}`,
  );
  drained += page.body.rules.length;
  if (page.body.rules.length === 0) break;
  cursor = page.body.nextSince;
  if (!page.body.hasMore) break;
}
check('paged sync drains the catalog without looping', pages < 29 && drained >= 138, {
  pages,
  drained,
});

// ---------------------------------------------------------- contribute ----

const MERCH = `zzztest${Date.now()}`;

for (const n of [1, 2]) {
  await post('/api/contribute', { deviceId: dev(n), observations: [obs(MERCH, 'groceries')] });
}
let served = await get('/api/hints');
check(
  'merchant below the vote threshold is NOT served',
  !served.body.rules.some((r) => r.merchant === MERCH),
);

const third = await post('/api/contribute', {
  deviceId: dev(3),
  observations: [obs(MERCH, 'groceries')],
});
check('third vote accepted', third.body.accepted === 1, third.body);

served = await hintsWhen((rules) => rules.some((r) => r.merchant === MERCH));
const row = served.body.rules.find((r) => r.merchant === MERCH);
check('merchant served after 3 votes', row?.hint === 'groceries', row);
check('votes tallied to 3', row?.votes === 3, row);

// One device cannot stuff the ballot.
for (let i = 0; i < 5; i++) {
  await post('/api/contribute', { deviceId: dev(1), observations: [obs(MERCH, 'groceries')] });
}
served = await get('/api/hints');
check(
  'repeat votes from one device do not inflate the tally',
  served.body.rules.find((r) => r.merchant === MERCH)?.votes === 3,
  served.body.rules.find((r) => r.merchant === MERCH),
);

// A device changing its mind MOVES its vote: groceries drops to 2, below the
// serving floor, so the merchant leaves the catalog entirely.
await post('/api/contribute', { deviceId: dev(1), observations: [obs(MERCH, 'fuel')] });
served = await hintsWhen((rules) => !rules.some((r) => r.merchant === MERCH));
check(
  'a moved vote re-tallies the hint it abandoned',
  !served.body.rules.some((r) => r.merchant === MERCH),
  served.body.rules.find((r) => r.merchant === MERCH),
);

// Margin must be computed over ALL candidates, not just those above the floor:
// a 4-vs-3 split has to arrive as margin 1 so the client sees it is contested.
const CONTESTED = `contested${Date.now()}`;
for (let i = 20; i <= 23; i++) {
  await post('/api/contribute', { deviceId: dev(i), observations: [obs(CONTESTED, 'groceries')] });
}
for (let i = 30; i <= 32; i++) {
  await post('/api/contribute', { deviceId: dev(i), observations: [obs(CONTESTED, 'fuel')] });
}
const contested = await hintsWhen((rules) => rules.some((r) => r.merchant === CONTESTED));
const crow = contested.body.rules.find((r) => r.merchant === CONTESTED);
check(
  'a contested merchant reports its true margin (4 vs 3 -> 1)',
  crow?.hint === 'groceries' && crow?.votes === 4 && crow?.margin === 1,
  crow,
);

// Merchant keys are normalised server-side, so letter-spaced POS text and the
// plain spelling land on one key.
const NORM = `nrm${Date.now()}`;
for (let i = 10; i <= 12; i++) {
  await post('/api/contribute', {
    deviceId: dev(i),
    observations: [obs(`${NORM.toUpperCase()} PVT LTD`, 'fuel')],
  });
}
const normalised = await hintsWhen((rules) => rules.some((r) => r.merchant === NORM));
check(
  'merchant normalised server-side',
  normalised.body.rules.some((r) => r.merchant === NORM),
  normalised.body.rules.filter((r) => r.merchant.startsWith('nrm')).slice(0, 3),
);

// A contribution must invalidate the read cache. Without the revalidateTag
// call, a correction would stay invisible until the cacheLife TTL expired.
const CACHED = `cachetest${Date.now()}`;
for (let i = 50; i <= 52; i++) {
  await post('/api/contribute', { deviceId: dev(i), observations: [obs(CACHED, 'fuel')] });
}
const converged = await hintsWhen((rules) => rules.some((r) => r.merchant === CACHED));
check(
  'a contribution invalidates the read cache',
  converged.body.rules.some((r) => r.merchant === CACHED),
  converged.body.rules.filter((r) => r.merchant.startsWith('cachetest')),
);

// ------------------------------------------------------------- suggest ----

const sug = await get(`/api/suggest?merchant=${encodeURIComponent(CONTESTED)}&amountBucket=2k_10k`);
check('suggest returns ranked suggestions', sug.body.suggestions.length >= 2, sug.body);
check('suggest ranks the winner first', sug.body.suggestions[0]?.hint === 'groceries', sug.body);
check('suggest caps at three', sug.body.suggestions.length <= 3, sug.body.suggestions?.length);
check(
  'suggest confidences are 0-1 and descending',
  sug.body.suggestions.every((s) => s.confidence >= 0 && s.confidence <= 1) &&
    sug.body.suggestions.every((s, i, a) => i === 0 || a[i - 1].confidence >= s.confidence),
  sug.body.suggestions,
);

// An unknown merchant on a known sender still gets a guess from the sender.
const SENDER = `TSTBNK${Date.now() % 100000}`;
for (let i = 40; i <= 43; i++) {
  await post('/api/contribute', {
    deviceId: dev(i),
    observations: [obs(`sendertest${i}`, 'telecom', { sender: SENDER })],
  });
}
const bySender = await get(
  `/api/suggest?merchant=${encodeURIComponent(`never seen shop ${Date.now()}`)}&sender=${SENDER}`,
);
check(
  'unknown merchant falls back to the sender distribution',
  bySender.body.suggestions[0]?.hint === 'telecom' &&
    bySender.body.suggestions[0]?.reason === 'sender',
  bySender.body,
);

const unknown = await get(
  `/api/suggest?merchant=${encodeURIComponent(`utterly unknown ${Date.now()}`)}`,
);
check(
  'a wholly unknown merchant yields no suggestions',
  unknown.body.suggestions.length === 0,
  unknown.body,
);

// -------------------------------------------------------------- detect ----

/** A small board, shaped as the device flattens it. */
const board = [
  { id: 'l-groceries', name: 'Groceries', type: 'expense', plannedMinor: 4_000_00, groupName: 'Living' },
  { id: 'l-elec', name: 'Electricity', type: 'expense', plannedMinor: 6_000_00, groupName: 'Housing' },
  { id: 'l-salary', name: 'Salary', type: 'income', plannedMinor: 250_000_00, groupName: 'Income' },
  { id: 'l-loan', name: 'Personal loan', type: 'expense', plannedMinor: 25_000_00, groupName: 'Debt', isLoan: true },
];

function detectBody(extra = {}) {
  return {
    merchant: 'KEELLS SUPER',
    direction: 'debit',
    kind: 'purchase',
    amountMinor: 4_320_00,
    account: '4150',
    lines: board,
    ...extra,
  };
}

const detected = await post('/api/detect', detectBody());
check('detect infers a hint from keywords', detected.body.hint === 'groceries', detected.body);
check('detect picks the matching line', detected.body.lineId === 'l-groceries', detected.body);
check('detect returns ranked matches', detected.body.matches.length > 0, detected.body.matches);

// A credit must never be matched to an expense line, however well the text fits.
const credit = await post(
  '/api/detect',
  detectBody({ merchant: 'SALARY TRANSFER', direction: 'credit', kind: 'transfer_in', amountMinor: 250_000_00 }),
);
check(
  'detect keeps a credit off expense lines',
  credit.body.matches.every((m) => m.lineId === 'l-salary'),
  credit.body.matches,
);

// A loan payment settles the loan line rather than whatever text matches.
const loan = await post(
  '/api/detect',
  detectBody({ merchant: 'MB:loan installment', kind: 'loan_payment', amountMinor: 25_000_00 }),
);
check('detect routes a loan payment to the loan line', loan.body.lineId === 'l-loan', loan.body);

// An electricity alert with no board card still finds the utility line.
const elec = await post(
  '/api/detect',
  detectBody({ merchant: 'CEB ELECTRICITY BILL', amountMinor: 6_100_00, account: '' }),
);
check('detect matches a utility by hint', elec.body.lineId === 'l-elec', elec.body);

// An unrecognisable merchant must not be force-fitted onto a line.
const vague = await post(
  '/api/detect',
  detectBody({ merchant: 'QQQ ZZZ 999', amountMinor: 77_77 }),
);
check('detect leaves an unknown merchant unassigned', vague.body.lineId === '', vague.body);

/*
 * Every hint must match a line named after its own category.
 *
 * This is the bug the suite caught: the keyword lists are tuned for MESSAGES
 * (merchant and biller names), but lines are named after the category, so
 * "Groceries" scored nothing while "Electricity" matched by coincidence. The
 * hint is worth 0.45 of the score, so the gap silently broke ranking on exactly
 * the plainly-named lines most users create.
 */
const selfNamed = [
  ['Groceries', 'Living', 'KEELLS SUPER', 'groceries'],
  ['Electricity', 'Housing', 'CEB BILL', 'electricity'],
  ['Water', 'Housing', 'NWSDB', 'water'],
  ['Mobile', 'Living', 'DIALOG RELOAD', 'telecom'],
  ['Fuel', 'Transport', 'CEYPETCO', 'fuel'],
  ['Streaming', 'Subscriptions', 'NETFLIX.COM', 'subscription'],
];
for (const [lineName, groupName, merchant, expected] of selfNamed) {
  const result = await post('/api/detect', {
    merchant,
    direction: 'debit',
    kind: 'purchase',
    amountMinor: 5_000_00,
    account: '',
    lines: [{ id: 'l-self', name: lineName, type: 'expense', plannedMinor: 5_000_00, groupName }],
  });
  check(
    `detect matches a line plainly named "${lineName}"`,
    result.body.hint === expected && result.body.lineId === 'l-self',
    result.body,
  );
}

/*
 * A known shop must still be recognised when POS text appends a branch or city.
 *
 * This is the bug the simulator caught: "F L I TRADING KANDY" normalises to
 * `fli trading kandy`, which is not EQUAL to the `fli trading` the crowd voted
 * on, so exact-only matching failed on a merchant the catalog knew perfectly
 * well. The device's own matcher has always done containment; the server did
 * not, so moving detection here quietly lost it.
 */
const BRANCHED = `branchtest${Date.now()}`;
for (let i = 60; i <= 62; i++) {
  await post('/api/contribute', { deviceId: dev(i), observations: [obs(BRANCHED, 'groceries')] });
}
const branched = await post('/api/detect', {
  merchant: `${BRANCHED} KANDY CITY`,
  direction: 'debit',
  kind: 'purchase',
  amountMinor: 4_320_00,
  account: '',
  lines: [{ id: 'l-groceries', name: 'Groceries', type: 'expense', plannedMinor: 4_000_00, groupName: 'Living' }],
});
check(
  'detect recognises a known shop with a branch suffix',
  branched.body.hint === 'groceries' && branched.body.lineId === 'l-groceries',
  branched.body,
);

// The reverse direction: a bare key when the catalog holds the longer one.
const bare = await post('/api/detect', {
  merchant: BRANCHED,
  direction: 'debit',
  kind: 'purchase',
  amountMinor: 4_320_00,
  account: '',
  lines: [{ id: 'l-groceries', name: 'Groceries', type: 'expense', plannedMinor: 4_000_00, groupName: 'Living' }],
});
check('detect still matches the bare merchant key', bare.body.hint === 'groceries', bare.body);

// Containment must not fire on a short key that happens to appear inside text.
const shortKey = await post('/api/detect', {
  merchant: 'iocm consulting services',
  direction: 'debit',
  kind: 'purchase',
  amountMinor: 4_320_00,
  account: '',
  lines: [{ id: 'l-fuel', name: 'Fuel', type: 'expense', plannedMinor: 10_000_00, groupName: 'Transport' }],
});
check(
  'short catalog keys do not fire on unrelated merchants',
  shortKey.body.hint !== 'fuel',
  shortKey.body,
);

// The privacy boundary: detection must be impossible to hand the raw message.
const withRaw = await post('/api/detect', detectBody({ raw: 'Your a/c 4150 debited LKR 4,320 bal 91,234' }));
check('detect rejects raw SMS text', withRaw.status === 400, { got: withRaw.status });

const withBalance = await post('/api/detect', detectBody({ balance: 91_234_00 }));
check('detect rejects a balance field', withBalance.status === 400, { got: withBalance.status });

const withFullCard = await post(
  '/api/detect',
  detectBody({ lines: [{ ...board[0], cardLast4: '4111111111111111' }] }),
);
check('detect rejects a full card number', withFullCard.status === 400, { got: withFullCard.status });

const longAccount = await post('/api/detect', detectBody({ account: '12345678901234' }));
check('detect rejects an over-long account', longAccount.status === 400, { got: longAccount.status });

// ---------------------------------------------------------- validation ----

const rejects = [
  [
    'rejects raw SMS text',
    { deviceId: dev(1), observations: [{ ...obs('x', 'fuel'), raw: 'acct 4150 bal 5000' }] },
  ],
  [
    'rejects an exact amount',
    { deviceId: dev(1), observations: [{ ...obs('x', 'fuel'), amount: 4320 }] },
  ],
  [
    'rejects a balance field',
    { deviceId: dev(1), observations: [{ ...obs('x', 'fuel'), balance: 91234 }] },
  ],
  [
    'rejects an account number',
    { deviceId: dev(1), observations: [{ ...obs('x', 'fuel'), account: '4150' }] },
  ],
  ['rejects an unknown hint', { deviceId: dev(1), observations: [obs('x', 'crypto')] }],
  ['rejects a non-uuid deviceId', { deviceId: 'device-1', observations: [obs('x', 'fuel')] }],
  ['rejects empty observations', { deviceId: dev(1), observations: [] }],
  [
    'rejects a phone number as sender',
    { deviceId: dev(1), observations: [obs('x', 'fuel', { sender: '+94771234567' })] },
  ],
  [
    'rejects an invalid amount bucket',
    { deviceId: dev(1), observations: [{ ...obs('x', 'fuel'), amountBucket: '4320' }] },
  ],
];
for (const [name, payload] of rejects) {
  const res = await post('/api/contribute', payload);
  check(name, res.status === 400, { got: res.status, body: res.body });
}

// ------------------------------------------------------------- cleanup ----

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const testMerchants = [
  MERCH,
  CONTESTED,
  NORM,
  CACHED,
  BRANCHED,
  ...Array.from({ length: 4 }, (_, i) => `sendertest${40 + i}`),
];
await sql`DELETE FROM merchant_votes WHERE merchant = ANY(${testMerchants})`;
await sql`DELETE FROM merchant_hints WHERE merchant = ANY(${testMerchants})`;
await sql`DELETE FROM merchant_signals WHERE merchant = ANY(${testMerchants})`;
const [{ count }] = await sql`SELECT count(*)::int AS count FROM merchant_hints`;
console.log(`\ncleaned up; catalog back to ${count} rows`);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
