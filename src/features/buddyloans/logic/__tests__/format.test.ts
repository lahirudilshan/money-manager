import { describe, expect, it } from 'vitest';
import { describeAge, describeDue, directionHeading, directionOwes, directionVerb, statusTone, urgencyTone } from '../format';

describe('describeDue', () => {
  it('speaks the way a person would about the near term', () => {
    expect(describeDue(0)).toBe('due today');
    expect(describeDue(1)).toBe('due tomorrow');
    expect(describeDue(3)).toBe('due in 3 days');
  });

  it('states lateness in days rather than as a negative', () => {
    expect(describeDue(-1)).toBe('a day late');
    expect(describeDue(-9)).toBe('9 days late');
  });

  it('collapses long horizons to months', () => {
    expect(describeDue(31)).toBe('due in a month');
    expect(describeDue(90)).toBe('due in 3 months');
  });
});

describe('describeAge', () => {
  it('describes when the money went out', () => {
    expect(describeAge(0)).toBe('today');
    expect(describeAge(1)).toBe('yesterday');
    expect(describeAge(12)).toBe('12 days ago');
    expect(describeAge(60)).toBe('2 months ago');
  });
});

describe('direction wording', () => {
  it('states the direction from the phone owner\'s side', () => {
    /*
     * "Borrowed LKR 7,500" does not say WHO borrowed it, and the book holds
     * both kinds — so the two were easy to mix up at a glance. Gave and took
     * cannot be read the wrong way round.
     */
    expect(directionVerb('lent')).toBe('I gave');
    expect(directionVerb('borrowed')).toBe('I took');
  });

  it('finishes a row with who is waiting for the money', () => {
    expect(directionOwes('lent')).toBe('owes me');
    expect(directionOwes('borrowed')).toBe('I owe them');
  });

  it('heads a group of records', () => {
    expect(directionHeading('lent')).toBe('Money I gave');
    expect(directionHeading('borrowed')).toBe('Money I took');
  });
});

describe('tones', () => {
  it('marks a settled debt good and a written-off one muted', () => {
    expect(statusTone('paid')).toBe('good');
    expect(statusTone('written_off')).toBe('muted');
    expect(statusTone('outstanding')).toBe('warn');
  });

  it('escalates an overdue debt', () => {
    expect(urgencyTone('overdue')).toBe('bad');
    expect(urgencyTone('due_soon')).toBe('warn');
    expect(urgencyTone('upcoming')).toBe('muted');
  });
});
