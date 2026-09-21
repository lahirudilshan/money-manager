import { describe, expect, it } from 'vitest';
import { describeRateAge } from '~/features/rates/logic/bankRates';

/**
 * How old the rate is, beside the figure the user is about to transfer.
 *
 * The dollar total on the dashboard is the number retyped into a bank app, and
 * it carried no indication of which rate produced it or when that rate was
 * observed — so "is this today's?" could not be answered from the screen. This
 * is the wording of that answer.
 */
describe('describeRateAge', () => {
  // Local components throughout: the function buckets by LOCAL calendar day,
  // so a UTC fixture would assert a different thing in a different timezone.
  const now = new Date(2026, 8, 21, 17, 0, 0);
  const daysBefore = (n: number, hour = 8) =>
    new Date(2026, 8, 21 - n, hour, 0, 0).toISOString();

  it('calls a rate from earlier today "today"', () => {
    expect(describeRateAge(daysBefore(0, 4), now)).toBe('today');
  });

  /*
   * Calendar days in the DEVICE's timezone, not elapsed hours.
   *
   * Constructed from local components rather than UTC strings, because the
   * boundary being tested is the local one: the same two UTC instants are a
   * day apart in London and the same day in Colombo, so a UTC fixture would
   * assert something different depending on where the suite runs.
   */
  it('calls yesterday "yesterday", however few hours ago', () => {
    const lateYesterday = new Date(2026, 8, 20, 23, 0, 0);
    const earlyToday = new Date(2026, 8, 21, 1, 0, 0);
    expect(describeRateAge(lateYesterday.toISOString(), earlyToday)).toBe('yesterday');
  });

  it('counts days within the week', () => {
    expect(describeRateAge(daysBefore(3), now)).toBe('3 days ago');
  });

  it('rounds to weeks beyond that', () => {
    expect(describeRateAge(daysBefore(12), now)).toBe('last week');
    // The real staleness found on the device: 2 September against 21 September.
    expect(describeRateAge(daysBefore(19), now)).toBe('2 weeks ago');
  });

  /*
   * A future timestamp is clock skew, not a prediction. It reads as "today"
   * rather than "in 2 days", which would be nonsense for an observation.
   */
  it('treats a future timestamp as today', () => {
    expect(describeRateAge(daysBefore(-2), now)).toBe('today');
  });

  it('says so when the timestamp cannot be read', () => {
    expect(describeRateAge('not a date', now)).toBe('date unknown');
    expect(describeRateAge('', now)).toBe('date unknown');
  });
});
