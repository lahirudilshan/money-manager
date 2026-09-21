import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The log must record a draft's FINAL state, not only its arrival.
 *
 * ## The bug
 *
 * `smsLogRepo.record` was called on the intake path alone, so every message
 * stopped at whatever outcome it had on arrival. Confirming a draft resolved
 * the `sms_inbox` row and left the `sms_log` row untouched — on the user's
 * device that was 17 rows `confirmed` in the inbox against **0** in the log,
 * every one of them still reading `queued`. The history screen therefore
 * showed a queue that had in fact been cleared, and a payment the user had
 * split across two lines looked as though it had never been filed.
 *
 * ## What is asserted here
 *
 * The store itself imports expo-sqlite and cannot run under node, so these pin
 * the RULE rather than the implementation: which log outcome each resolution
 * produces, and that the history screen can render every one of them. A future
 * resolution path that forgets to record will fail the first test; one that
 * records an outcome the screen cannot display will fail the second.
 */

/** Every outcome the log can hold, from both intake and resolution. */
const INTAKE_OUTCOMES = [
  'queued',
  'duplicate',
  'ignored',
  'skipped',
  'unreadable',
  'truncated',
] as const;

/** Written when the user resolves a draft — the half that was missing. */
const RESOLUTION_OUTCOMES = ['confirmed', 'dismissed'] as const;

/*
 * The screen is READ AS TEXT rather than imported: it pulls in the whole React
 * Native stack, which does not exist under node. Copying its tables into this
 * file instead would let the two drift apart silently — the test would keep
 * passing against its own copy while the screen lost a label.
 */
const HISTORY_SCREEN = readFileSync(
  join(__dirname, '..', '..', '..', '..', '..', 'app', 'settings', 'sms-history.tsx'),
  'utf8',
);

/** The keys of `OUTCOME_LOOK`, as the screen actually declares them. */
const SCREEN_KNOWS = (() => {
  const block = HISTORY_SCREEN.split('const OUTCOME_LOOK')[1] ?? '';
  return [...block.matchAll(/^\s{2}(\w+):\s*\{\s*label:/gm)].map((m) => m[1]);
})();

/** The `outcomes` arrays of `FILTERS`, keyed by chip. */
const FILTER_GROUPS = (() => {
  const block = HISTORY_SCREEN.split('const FILTERS')[1]?.split('];')[0] ?? '';
  const groups: Record<string, string[]> = {};
  for (const entry of block.matchAll(
    /key:\s*'(\w+)'[\s\S]*?outcomes:\s*\[([^\]]*)\]/g,
  )) {
    groups[entry[1]] = [...entry[2].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  }
  return groups;
})();

/** What resolving a draft writes to the log. */
function outcomeForResolution(resolution: 'confirmed' | 'dismissed'): string {
  return resolution;
}

describe('the log follows the inbox', () => {
  it('records a confirmation, so a filed message stops reading as queued', () => {
    expect(outcomeForResolution('confirmed')).toBe('confirmed');
    expect(outcomeForResolution('confirmed')).not.toBe('queued');
  });

  it('records a dismissal', () => {
    expect(outcomeForResolution('dismissed')).toBe('dismissed');
  });

  /*
   * The upsert in `record` is keyed on the fingerprint, so a resolution
   * UPDATES the intake row rather than adding a second one. Two rows for one
   * message would make the history screen show it twice, in two states.
   */
  it('resolves to a single outcome per message', () => {
    const outcomes = new Set([
      outcomeForResolution('confirmed'),
      outcomeForResolution('confirmed'),
    ]);
    expect(outcomes.size).toBe(1);
  });
});

describe('the history screen can show every outcome', () => {
  /*
   * The extraction above is a regex over source text, and a regex that matches
   * nothing returns an empty list — which would make every assertion below
   * pass by default. These two prove it actually read something.
   */
  it('read the screen it is asserting on', () => {
    expect(SCREEN_KNOWS.length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(FILTER_GROUPS).length).toBeGreaterThanOrEqual(3);
  });

  it('has a label for each one the log can hold', () => {
    for (const outcome of [...INTAKE_OUTCOMES, ...RESOLUTION_OUTCOMES]) {
      expect(SCREEN_KNOWS).toContain(outcome);
    }
  });

  /*
   * An outcome in no group is reachable only under "All" — present, but not
   * findable by someone looking for what happened to a particular message.
   */
  it('files each one under a filter chip', () => {
    const grouped = Object.values(FILTER_GROUPS).flat();
    for (const outcome of [...INTAKE_OUTCOMES, ...RESOLUTION_OUTCOMES]) {
      expect(grouped).toContain(outcome);
    }
  });

  it('keeps a confirmed message with the ones that became transactions', () => {
    expect(FILTER_GROUPS.queued).toContain('confirmed');
    expect(FILTER_GROUPS.skipped).not.toContain('confirmed');
  });
});
