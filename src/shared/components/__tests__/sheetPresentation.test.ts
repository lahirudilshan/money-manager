import { describe, expect, it } from 'vitest';

/**
 * Never two sheets mounted at once.
 *
 * Every `BottomSheet` renders a native `pageSheet` Modal, and iOS SILENTLY
 * refuses to present a second one while another is up — no error, the sheet
 * simply never appears. That is the intermittent "the plan summary sometimes
 * doesn't open".
 *
 * An earlier attempt at this queued sheets behind a shared counter. It failed
 * on the simulator in the worst way: a sheet took a slot before it had actually
 * presented, never released it, and every later sheet was blocked FOREVER —
 * an intermittent bug turned into a permanent one. The counter is gone.
 *
 * The rule that survives is structural and much simpler: a screen renders at
 * most one sheet. With nothing to refuse, there is nothing to go wrong.
 */

/** What a screen decides to mount, given its open-sheet state. */
function mounted(state: { addingToCategory?: string | null; showingPlanDetail?: boolean }) {
  if (state.addingToCategory) return ['add-bill'];
  if (state.showingPlanDetail) return ['plan-details'];
  return [];
}

describe('a screen mounts at most one sheet', () => {
  it('mounts nothing when nothing is open', () => {
    expect(mounted({})).toEqual([]);
  });

  it('mounts the add-bill sheet on its own', () => {
    expect(mounted({ addingToCategory: 'cat-living' })).toEqual(['add-bill']);
  });

  it('mounts the plan-details sheet on its own', () => {
    expect(mounted({ showingPlanDetail: true })).toEqual(['plan-details']);
  });

  it('NEVER mounts both, even when both flags are set', () => {
    // The exact shape of the bug: two mounted Modals, the second discarded.
    expect(mounted({ addingToCategory: 'cat-living', showingPlanDetail: true })).toHaveLength(1);
  });

  it('frees the screen for the next sheet once the first closes', () => {
    // Closing add-bill clears its state, so plan-details can mount and present.
    expect(mounted({ addingToCategory: null, showingPlanDetail: true })).toEqual([
      'plan-details',
    ]);
  });

  it('is back to nothing once every sheet is closed', () => {
    expect(mounted({ addingToCategory: null, showingPlanDetail: false })).toEqual([]);
  });
});
