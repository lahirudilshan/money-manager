/**
 * Reference-stable extraction of the function-valued half of a store state.
 *
 * Lives apart from useAppStore.ts so it can be unit-tested: importing the store
 * pulls in react-native, whose Flow-typed index.js cannot be parsed by the
 * node-based test runner (which is also why the suite covers logic, not
 * screens). Keeping the caching rule here means the part that can silently
 * regress — returning a fresh object and re-rendering every consumer — is the
 * part under test.
 */

/** The function-valued keys of `T`. */
export type ActionsOf<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: T[K];
};

/**
 * Build a `selectActions(state)` whose result is compared by reference.
 *
 * zustand re-renders when a selector returns a new reference, so this returns
 * the SAME object for as long as the underlying functions are unchanged —
 * which, for a store whose actions are created once, is forever.
 */
export function createActionsSelector<T extends object>(): (state: T) => ActionsOf<T> {
  // Kept as the raw record the loop fills, alongside the typed view handed to
  // callers: comparing against `snapshot` needs index access that ActionsOf<T>
  // (whose keys are a filtered subset) does not permit without an unsound cast.
  let cache: { snapshot: Partial<Record<keyof T, unknown>>; value: ActionsOf<T> } | null = null;

  return (state: T): ActionsOf<T> => {
    if (cache) {
      const entries = Object.keys(cache.snapshot) as (keyof T)[];
      const unchanged = entries.every((key) => state[key] === cache?.snapshot[key]);
      if (unchanged) return cache.value;
    }

    const snapshot: Partial<Record<keyof T, unknown>> = {};
    for (const key of Object.keys(state) as (keyof T)[]) {
      if (typeof state[key] === 'function') snapshot[key] = state[key];
    }
    // The single unavoidable assertion: `snapshot` was built by keeping exactly
    // the function-valued keys, which is what ActionsOf<T> selects, but the
    // compiler cannot follow a `typeof` check through a dynamic key.
    const value = snapshot as unknown as ActionsOf<T>;
    cache = { snapshot, value };
    return value;
  };
}
