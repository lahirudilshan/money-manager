import { describe, expect, it } from 'vitest';
import { unlockMethod } from '~/shared/lib/lockPolicy';

describe('unlockMethod', () => {
  it('prefers a biometric whenever one is enrolled', () => {
    expect(unlockMethod(true, false)).toBe('biometric');
    expect(unlockMethod(true, true)).toBe('biometric');
  });

  it('falls back to the PIN when one is stored', () => {
    expect(unlockMethod(false, true)).toBe('pin');
  });

  /*
   * The restore case: `app_lock` travels in the database, the PIN does not.
   * Reporting 'pin' here would show a keypad that rejects every entry.
   */
  it('reports unsatisfiable when there is no biometric and no stored PIN', () => {
    expect(unlockMethod(false, false)).toBe('unsatisfiable');
  });
});
