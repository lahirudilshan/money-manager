import { describe, expect, it } from 'vitest';
import { SNAPSHOT_TABLES, tableInScope } from '../backup';

/**
 * The buddy-loans add-on's tables, in the backup.
 *
 * A new table that nobody adds to `SNAPSHOT_TABLES` is not a loud failure — it
 * simply never appears in a backup, and the loss is discovered on the day
 * someone restores a lost phone and finds the money they were owed is gone.
 * These assertions are the guard.
 */
describe('buddy loans in a backup', () => {
  it('backs both tables up', () => {
    expect(SNAPSHOT_TABLES).toContain('buddy_loans');
    expect(SNAPSHOT_TABLES).toContain('buddy_repayments');
  });

  it('orders loans before their repayments, which reference them', () => {
    const order = (t: string) => SNAPSHOT_TABLES.indexOf(t as never);
    expect(order('buddy_loans')).toBeLessThan(order('buddy_repayments'));
  });

  it('treats both as history, so a setup-only restore leaves them out', () => {
    /*
     * Unlike a vehicle or a family member, a debt is not reusable structure —
     * it is a specific sum lent on a specific day. Carrying "Nuwan owes you
     * 5,000" onto a deliberately-fresh board would put a stale debt in
     * someone's reminders.
     */
    expect(tableInScope('buddy_loans', 'setup')).toBe(false);
    expect(tableInScope('buddy_repayments', 'setup')).toBe(false);
  });

  it('restores both when the scope is everything', () => {
    expect(tableInScope('buddy_loans', 'everything')).toBe(true);
    expect(tableInScope('buddy_repayments', 'everything')).toBe(true);
  });
});
