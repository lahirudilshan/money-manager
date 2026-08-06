import { describe, expect, it } from 'vitest';
import {
  ALL_PARTS,
  buildSnapshot,
  describeParts,
  partsOf,
  SETUP_PARTS,
  tablesForParts,
  describeScope,
  describeSnapshot,
  isSnapshotFilename,
  parseSnapshot,
  serialiseSnapshot,
  summariseSnapshot,
  SNAPSHOT_TABLES,
  SNAPSHOT_VERSION,
  snapshotFilename,
  tableInScope,
  tablesForScope,
  validateSnapshot,
} from '../backup';

/**
 * A backup is the only copy of the user's data that exists off the device, and
 * restoring one REPLACES their live board. So the tests here are mostly about
 * refusing to restore something damaged — a corrupt file that is detected is a
 * bad afternoon, one that is not is every transaction they ever recorded.
 */

const META = { appVersion: '1.0.0', now: new Date('2026-08-04T12:00:00Z') };

describe('buildSnapshot', () => {
  it('includes every table, even the empty ones', () => {
    // A reader must never have to tell "no rows" apart from "this version did
    // not have that table".
    const snapshot = buildSnapshot({ cards: [{ id: 'c1' }] }, META);

    for (const table of SNAPSHOT_TABLES) {
      expect(snapshot.tables[table]).toBeDefined();
    }
    expect(snapshot.tables.houses).toEqual([]);
  });

  it('records counts alongside the rows', () => {
    const snapshot = buildSnapshot({ cards: [{ id: 'c1' }, { id: 'c2' }] }, META);
    expect(snapshot.counts.cards).toBe(2);
  });

  it('never includes the SMS queue', () => {
    /*
     * `sms_inbox` holds raw bank message text — the most sensitive thing the
     * app touches — and restoring it would re-present drafts already resolved
     * on the old phone.
     */
    expect(SNAPSHOT_TABLES).not.toContain('sms_inbox');
  });

  it('stamps the version and time', () => {
    const snapshot = buildSnapshot({}, META);
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(snapshot.createdAt).toBe('2026-08-04T12:00:00.000Z');
  });
});

describe('validateSnapshot refuses damaged files', () => {
  it('accepts a well-formed snapshot', () => {
    const result = validateSnapshot(buildSnapshot({ cards: [{ id: 'c1' }] }, META));
    expect(result.ok).toBe(true);
    expect(result.rowCount).toBe(1);
  });

  it('rejects a truncated table', () => {
    /*
     * The integrity check that matters. A partial upload or download yields
     * fewer rows than the file declares, and without this the restore would
     * happily wipe the board and write half the data.
     */
    const snapshot = buildSnapshot({ cards: [{ id: 'c1' }, { id: 'c2' }] }, META);
    snapshot.tables.cards = [{ id: 'c1' }];

    const result = validateSnapshot(snapshot);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/incomplete/i);
  });

  it('rejects a file from a NEWER app rather than partly reading it', () => {
    // The unknown parts are exactly the ones that would be dropped, and a
    // restore that silently discards data is the worst available outcome.
    const snapshot = { ...buildSnapshot({}, META), version: SNAPSHOT_VERSION + 1 };
    const result = validateSnapshot(snapshot);

    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/newer version/i);
  });

  it('rejects things that are not backups at all', () => {
    expect(validateSnapshot(null).ok).toBe(false);
    expect(validateSnapshot('a string').ok).toBe(false);
    expect(validateSnapshot({}).ok).toBe(false);
    expect(validateSnapshot({ version: 1 }).ok).toBe(false);
  });

  it('rejects a table that is not a list of rows', () => {
    const snapshot = buildSnapshot({}, META);
    (snapshot.tables as Record<string, unknown>).cards = 'not rows';
    expect(validateSnapshot(snapshot).ok).toBe(false);
  });
});

describe('round trip', () => {
  it('survives serialise then parse unchanged', () => {
    const snapshot = buildSnapshot(
      { cards: [{ id: 'c1', name: 'HNB', last4: null, is_card: 0 }] },
      META,
    );

    const restored = parseSnapshot(serialiseSnapshot(snapshot));
    expect(restored).toEqual(snapshot);
    expect(validateSnapshot(restored).ok).toBe(true);
  });

  it('returns null for a file that is not JSON', () => {
    expect(parseSnapshot('<html>error</html>')).toBeNull();
    expect(parseSnapshot('')).toBeNull();
  });
});

describe('filenames', () => {
  it('is timestamped so a backup never overwrites the previous one', () => {
    // A "backup" that replaces the only good copy with a corrupt one is not a
    // backup.
    const a = snapshotFilename(new Date('2026-08-04T12:00:00Z'));
    const b = snapshotFilename(new Date('2026-08-05T12:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('sorts newest-last by name, so ordering needs no parsing', () => {
    const a = snapshotFilename(new Date('2026-08-04T12:00:00Z'));
    const b = snapshotFilename(new Date('2026-08-05T12:00:00Z'));
    expect([b, a].sort()).toEqual([a, b]);
  });

  it('recognises our own files and ignores others', () => {
    expect(isSnapshotFilename(snapshotFilename())).toBe(true);
    expect(isSnapshotFilename('holiday-photo.jpg')).toBe(false);
    expect(isSnapshotFilename('notes.json')).toBe(false);
  });
});

describe('describeSnapshot', () => {
  it('summarises what restoring would bring back', () => {
    const snapshot = buildSnapshot(
      { transactions: [{ id: 't1' }, { id: 't2' }], subcategories: [{ id: 's1' }] },
      META,
    );
    expect(describeSnapshot(snapshot)).toBe('1 bill · 2 transactions');
  });
});

describe('restore scope — setup only vs everything', () => {
  /*
   * Two restores exist because they are wanted for different reasons:
   * recovering a lost phone wants everything, while reusing a plan on a fresh
   * board wants the STRUCTURE without inheriting transactions that would make
   * every total wrong from day one.
   */
  const SNAPSHOT = buildSnapshot(
    {
      cards: [{ id: 'c1' }, { id: 'c2' }],
      houses: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
      categories: [{ id: 'g1' }],
      subcategories: [{ id: 's1' }, { id: 's2' }],
      loans: [{ id: 'l1' }],
      merchant_rules: [{ id: 'm1' }],
      transactions: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      subcategory_states: [{ id: 'st1' }],
      fuel_entries: [{ id: 'f1' }],
    },
    META,
  );

  it('keeps the structure in a setup-only restore', () => {
    // Exactly what the user asked for: "category + account & card + house etc
    // without data".
    for (const table of ['cards', 'houses', 'categories', 'subcategories', 'loans', 'settings']) {
      expect(tableInScope(table, 'setup'), table).toBe(true);
    }
  });

  it('leaves out every record of money moving', () => {
    for (const table of [
      'transactions',
      'subcategory_states',
      'category_states',
      'fundings',
      'fuel_entries',
    ]) {
      expect(tableInScope(table, 'setup'), table).toBe(false);
    }
  });

  it('keeps learned merchant rules, which are knowledge rather than history', () => {
    /*
     * A judgement call worth stating: `merchant_rules` records that "KEELLS is
     * groceries", not that money moved. Dropping it would make a restored board
     * forget everything the user taught it, and re-learning costs them a
     * correction per merchant for nothing.
     */
    expect(tableInScope('merchant_rules', 'setup')).toBe(true);
  });

  it('restores everything under the full scope', () => {
    expect(tablesForScope('everything')).toEqual([...SNAPSHOT_TABLES]);
  });

  it('preserves dependency order after filtering', () => {
    // Restore inserts in this order, so a filtered list that reordered tables
    // would point a foreign key at a row not yet written.
    const setup = tablesForScope('setup');
    const full = tablesForScope('everything');
    const positions = setup.map((table) => full.indexOf(table));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('describes what each option would actually bring back', () => {
    // Shown at the moment of choosing, so the difference is visible up front
    // rather than discovered afterwards.
    expect(describeScope(SNAPSHOT, 'setup')).toBe('2 accounts · 3 houses · 2 bills · 1 loan');
    expect(describeScope(SNAPSHOT, 'everything')).toBe(
      '2 accounts · 3 houses · 2 bills · 1 loan · 3 transactions',
    );
  });
});

describe('describeSnapshot drives the restore list', () => {
  /*
   * The restore rows used to read "1 KB", which is not a basis for choosing
   * between two restore points. `listBackups` now reads each file and shows
   * this, so the user picks by CONTENT rather than by file size.
   */
  it('says what a backup holds, not how big it is', () => {
    const snapshot = buildSnapshot(
      {
        subcategories: [{ id: 's1' }, { id: 's2' }],
        transactions: Array.from({ length: 42 }, (_, i) => ({ id: `t${i}` })),
      },
      META,
    );

    expect(describeSnapshot(snapshot)).toBe('2 bills · 42 transactions');
  });

  it('stays readable for an empty board', () => {
    // A brand-new user's first backup is genuinely empty, and "0 bills · 0
    // transactions" is honest rather than alarming.
    expect(describeSnapshot(buildSnapshot({}, META))).toBe('0 bills · 0 transactions');
  });
});

describe('selectable backup parts', () => {
  /*
   * The `setup` / `everything` split was too coarse to express "my accounts and
   * categories, but not last year's transactions" — which is exactly what
   * someone starting a fresh year or handing a plan to a family member wants.
   */
  it('always includes the required parts, ticked or not', () => {
    // A restore whose bills point at accounts that were not restored is a
    // broken board, so `core` travels with every selection.
    expect(tablesForParts([])).toContain('cards');
    expect(tablesForParts([])).toContain('settings');
  });

  it('leaves history out when it is not selected', () => {
    const tables = tablesForParts(SETUP_PARTS);

    expect(tables).toContain('subcategories');
    expect(tables).not.toContain('transactions');
    expect(tables).not.toContain('subcategory_states');
  });

  it('preserves dependency order after filtering', () => {
    // Restore inserts in this order, so a filtered list that reordered tables
    // would point a foreign key at a row not yet written.
    const selected = tablesForParts(ALL_PARTS);
    const positions = selected.map((table) => SNAPSHOT_TABLES.indexOf(table));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('records the parts and label on the snapshot', () => {
    const snapshot = buildSnapshot({}, {
      appVersion: '1.0.0',
      parts: SETUP_PARTS,
      label: 'before 2027 reset',
    });

    expect(snapshot.label).toBe('before 2027 reset');
    expect(snapshot.parts).toEqual(SETUP_PARTS);
  });

  it('reads a pre-selective snapshot as holding everything', () => {
    /*
     * Snapshots written before this feature carry no `parts` field. They always
     * held everything, so treating an absent field as "nothing" would make
     * every old backup look empty and unrestorable.
     */
    const old = buildSnapshot({ cards: [{ id: 'c1' }] }, { appVersion: '1.0.0' });
    delete old.parts;

    expect(partsOf(old)).toEqual(ALL_PARTS);
  });

  it('describes only what the selection would bring back', () => {
    const snapshot = buildSnapshot(
      {
        cards: [{ id: 'c1' }],
        subcategories: [{ id: 's1' }, { id: 's2' }],
        transactions: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      },
      { appVersion: '1.0.0' },
    );

    expect(describeParts(snapshot, SETUP_PARTS)).not.toContain('transaction');
    expect(describeParts(snapshot, ALL_PARTS)).toContain('3 transactions');
  });
});

describe('summariseSnapshot', () => {
  /*
   * What a restore file HOLDS, part by part.
   *
   * `describeSnapshot` answers this in six words, which is right for a list row
   * but useless for choosing between two backups taken a day apart — and
   * restoring replaces the whole board. This is what the details panel shows.
   */
  it('totals every table in a part', () => {
    const snapshot = buildSnapshot(
      { categories: [{ id: 'c1' }], subcategories: [{ id: 's1' }, { id: 's2' }], incomes: [{ id: 'i1' }] },
      META,
    );

    const plan = summariseSnapshot(snapshot).find((part) => part.key === 'plan');
    // categories + subcategories + incomes all roll into "Categories & bills".
    expect(plan?.count).toBe(4);
  });

  it('names parts in the user\'s words, not table names', () => {
    const labels = summariseSnapshot(buildSnapshot({}, META)).map((part) => part.label);

    expect(labels).toContain('Transactions & history');
    expect(labels.join(' ')).not.toMatch(/subcategory_states|merchant_rules/);
  });

  it('reports a part the file does NOT carry rather than hiding it', () => {
    /*
     * The omissions are the most important thing about a selective backup:
     * "this one has no transactions" is exactly what someone needs to see
     * before restoring it over a board that does. Dropping those rows would
     * leave them to notice an absence, which nobody does reliably.
     */
    const setupOnly = buildSnapshot({}, { ...META, parts: SETUP_PARTS });

    const history = summariseSnapshot(setupOnly).find((part) => part.key === 'history');
    expect(history?.included).toBe(false);
  });

  it('always marks the required part as included', () => {
    // `core` travels with every selection, so it is never absent.
    const historyOnly = buildSnapshot({}, { ...META, parts: ['history'] });

    expect(summariseSnapshot(historyOnly).find((part) => part.key === 'core')?.included).toBe(true);
  });

  it('reads a pre-selective backup as holding everything', () => {
    // Snapshots written before `parts` existed always held it all; treating an
    // absent field as "nothing" would make every old backup look empty.
    const legacy = buildSnapshot({}, META);
    delete (legacy as { parts?: unknown }).parts;

    expect(summariseSnapshot(legacy).every((part) => part.included)).toBe(true);
  });
});
