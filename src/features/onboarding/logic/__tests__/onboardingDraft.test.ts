import { describe, expect, it } from 'vitest';
import {
  DRAFT_VERSION,
  hasContent,
  normaliseTransport,
  parseStoredDraft,
  serialiseDraft,
  toStoredDraft,
} from '../onboardingDraft';
import type { StoredDraft } from '../onboardingDraft';
import type { DraftLine } from '../onboardingDraft';

const line = (id: string): DraftLine => ({
  id,
  name: 'Electricity',
  categoryId: 'housing',
  icon: 'flash-outline',
  type: 'expense',
  plannedMinor: 500_000,
  dueDay: 1,
  frequency: 'monthly',
  cardId: null,
  currency: 'local',
  foreignAmount: null,
  planTargetMinor: null,
  planDueDate: null,
});

const state = (
  ids: string[],
  extra: Partial<{ banks: string[]; answers: StoredDraft['answers'] }> = {},
) => ({
  banks: extra.banks ?? [],
  answers: extra.answers ?? null,
  picked: new Set(ids),
  lines: new Map(ids.map((id) => [id, line(id)])),
  order: ids,
});

describe('surviving JSON', () => {
  /*
   * The trap this module exists for.
   *
   * The store keeps `picked` as a Set and `lines` as a Map because that is what
   * the UI wants. `JSON.stringify` turns BOTH into `{}` without complaining, so
   * a naive save would write a draft that restores as empty — and the failure
   * is silent at exactly the moment the user needs their work back.
   */
  it('keeps a Set through a round trip', () => {
    const restored = parseStoredDraft(serialiseDraft(state(['a', 'b'])));
    expect(restored?.picked).toEqual(['a', 'b']);
  });

  it('keeps a Map through a round trip', () => {
    const restored = parseStoredDraft(serialiseDraft(state(['a'])));

    expect(restored?.lines).toHaveLength(1);
    expect(restored?.lines[0][1].plannedMinor).toBe(500_000);
  });

  it('proves a plain stringify would have lost them', () => {
    // The bug this guards against, stated as a test rather than a comment.
    const naive = JSON.parse(JSON.stringify(state(['a', 'b'])));

    expect(naive.picked).toEqual({});
    expect(naive.lines).toEqual({});
  });

  it('keeps the drag-and-drop order', () => {
    const restored = parseStoredDraft(serialiseDraft(state(['c', 'a', 'b'])));
    expect(restored?.order).toEqual(['c', 'a', 'b']);
  });
});

describe('refusing a draft it cannot trust', () => {
  /*
   * Every rejection returns null, because the caller does the same thing in
   * each case: start clean. A draft is a convenience — a damaged one must never
   * be the reason the app cannot open.
   */
  it('returns null for a missing key', () => {
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft('')).toBeNull();
  });

  it('returns null for text that is not JSON', () => {
    expect(parseStoredDraft('{ half-written')).toBeNull();
  });

  it('discards a draft from an older shape', () => {
    /*
     * A build whose `DraftLine` had different fields would restore lines
     * missing an amount or a due day. Asking the user to re-pick costs a
     * minute; restoring a wrong shape costs them a broken plan to unpick.
     */
    const old = JSON.stringify({ ...toStoredDraft(state(['a'])), version: DRAFT_VERSION - 1 });
    expect(parseStoredDraft(old)).toBeNull();
  });

  it('drops a malformed line pair rather than restoring it', () => {
    // A save interrupted mid-write can leave valid JSON with a broken pair in
    // it; `[id, undefined]` would restore a line the app then dereferences.
    const damaged = JSON.stringify({
      ...toStoredDraft(state(['a'])),
      lines: [['a', line('a')], ['b'], null, ['c', null]],
    });

    expect(parseStoredDraft(damaged)?.lines).toHaveLength(1);
  });
});

describe('hasContent', () => {
  it('is false for an empty selection', () => {
    /*
     * Onboarding saves on every change — including the change that empties the
     * selection. Resuming into an empty draft is indistinguishable from
     * starting fresh, so it must not count as "setup in progress".
     */
    expect(hasContent(parseStoredDraft(serialiseDraft(state([]))))).toBe(false);
  });

  it('is true once something is picked', () => {
    expect(hasContent(parseStoredDraft(serialiseDraft(state(['a']))))).toBe(true);
  });
});

describe('the whole flow, not just the picked lines', () => {
  /*
   * Steps 1 and 2 kept their state in each screen's own `useState`, so they
   * were the two things a mid-setup kill still lost: banks had to be re-ticked
   * and the three "about you" questions re-answered. Those are the steps that
   * feel worst to redo, because nothing on screen hints they were ever done.
   */
  it('keeps the bank ticks from step 1', () => {
    const restored = parseStoredDraft(serialiseDraft(state([], { banks: ['hnb', 'ndb'] })));
    expect(restored?.banks).toEqual(['hnb', 'ndb']);
  });

  it('keeps the answers from step 2', () => {
    const answers = { household: ['kids'], transport: 'car', birthYear: '1995' };
    const restored = parseStoredDraft(serialiseDraft(state([], { answers })));

    expect(restored?.answers).toEqual(answers);
  });

  it('counts banks alone as worth resuming', () => {
    /*
     * `hasContent` tested only picked lines while this covered step 3 — so a
     * user killed on step 1 with banks ticked restored as empty and started
     * over, which is precisely the case the feature was asked to fix.
     */
    expect(hasContent(parseStoredDraft(serialiseDraft(state([], { banks: ['hnb'] }))))).toBe(true);
  });

  it('counts answers alone as worth resuming', () => {
    const answers = { household: ['just_me'], transport: 'none', birthYear: '1988' };
    expect(hasContent(parseStoredDraft(serialiseDraft(state([], { answers }))))).toBe(true);
  });

  it('rejects a half-written answers block rather than restoring an empty one', () => {
    // `{}` would read as "answered, with nothing", overwriting real defaults.
    const damaged = JSON.stringify({ ...toStoredDraft(state(['a'])), answers: {} });
    expect(parseStoredDraft(damaged)?.answers).toBeNull();
  });
});

describe('a restore must return every field it saved', () => {
  /*
   * The bug this exists to prevent, found on the simulator and invisible to
   * every other test here.
   *
   * `banks` and `answers` were added to the store, the serialiser AND the
   * parser — but not to the `set()` inside `restore()`. So they saved
   * perfectly, parsed perfectly, and were then dropped on the way back into
   * the store. "A bit about you" came back blank while the answers sat intact
   * in the database, which reads as a broken SAVE and sends you looking in the
   * wrong place entirely.
   *
   * Asserting the round trip field-by-field is what makes a half-wired
   * pipeline fail loudly instead of silently.
   */
  it('round-trips every field, not just the picked lines', () => {
    const answers = { household: ['kids'], transport: 'car', birthYear: '1985' };
    const restored = parseStoredDraft(
      serialiseDraft(state(['electricity'], { banks: ['hnb'], answers })),
    );

    // Every key a caller can read back must survive — add one to StoredDraft
    // and this fails until the restore path carries it too.
    expect(Object.keys(restored!).sort()).toEqual(
      ['answers', 'banks', 'lines', 'order', 'picked', 'savedAt', 'version'].sort(),
    );

    expect(restored!.banks).toEqual(['hnb']);
    expect(restored!.answers).toEqual(answers);
    expect(restored!.picked).toEqual(['electricity']);
    expect(restored!.lines).toHaveLength(1);
    expect(restored!.order).toEqual(['electricity']);
  });
});

/**
 * Reading a `transport` answer written before the question became
 * multi-select.
 *
 * The field widened from a string to an array without bumping DRAFT_VERSION,
 * because bumping it would discard the user's entire half-finished setup over
 * one compatibly-widened key. That trade is only safe while the old shape is
 * still readable, which is what these pin down.
 */
describe('normaliseTransport', () => {
  it('lifts a legacy string answer into an array', () => {
    expect(normaliseTransport('car')).toEqual(['car']);
    expect(normaliseTransport('bike')).toEqual(['bike']);
  });

  it('passes a current array answer through', () => {
    expect(normaliseTransport(['car', 'bike'])).toEqual(['car', 'bike']);
  });

  /*
   * 'none' is the ABSENCE of a vehicle, so it never survives as a member —
   * `suggestedLines` reads "no car and no bike", and a stray 'none' in the
   * array would be a second encoding of the same answer.
   */
  it('drops the legacy "none" rather than keeping it as a vehicle', () => {
    expect(normaliseTransport('none')).toEqual([]);
    expect(normaliseTransport(['none'])).toEqual([]);
  });

  it('treats a missing or malformed answer as no vehicle', () => {
    expect(normaliseTransport(null)).toEqual([]);
    expect(normaliseTransport(undefined)).toEqual([]);
    expect(normaliseTransport([])).toEqual([]);
  });

  /* A draft written by a build between the two shapes must not crash the read. */
  it('ignores non-string members', () => {
    expect(normaliseTransport(['car', 42 as unknown as string, null as unknown as string])).toEqual([
      'car',
    ]);
  });
});
