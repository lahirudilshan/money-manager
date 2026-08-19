import { describe, expect, it } from 'vitest';
import { createActionsSelector } from '~/store/selectActions';

describe('createActionsSelector', () => {
  it('picks only the function-valued keys', () => {
    const select = createActionsSelector<{ n: number; go: () => void }>();
    const go = () => {};
    const actions = select({ n: 1, go });
    expect(Object.keys(actions)).toEqual(['go']);
    expect(actions.go).toBe(go);
  });

  it('returns the SAME reference when the actions are unchanged', () => {
    const select = createActionsSelector<{ n: number; go: () => void }>();
    const go = () => {};
    const first = select({ n: 1, go });
    // A new state object with the same functions — what every `set()` produces.
    const second = select({ n: 2, go });
    expect(second).toBe(first);
  });

  it('rebuilds when an action identity actually changes', () => {
    const select = createActionsSelector<{ go: () => void }>();
    const first = select({ go: () => {} });
    const second = select({ go: () => {} });
    expect(second).not.toBe(first);
  });

  it('is stable across many reads, so a consumer never re-renders on data changes', () => {
    const select = createActionsSelector<{ tick: number; go: () => void }>();
    const go = () => {};
    const baseline = select({ tick: 0, go });
    for (let tick = 1; tick < 50; tick += 1) {
      expect(select({ tick, go })).toBe(baseline);
    }
  });
});
