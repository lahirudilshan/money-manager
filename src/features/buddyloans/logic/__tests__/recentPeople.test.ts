import { describe, expect, it } from 'vitest';
import { outstandingForPerson, recentPeople, type BuddyLoanLike, type BuddyRepayment } from '../buddyLoans';

const day = (offset: number) => {
  const d = new Date('2026-09-01T12:00:00');
  d.setDate(d.getDate() + offset);
  return d;
};

const loan = (over: Partial<BuddyLoanLike> & { id: string }): BuddyLoanLike => ({
  personName: 'Nuwan',
  amountMinor: 500_000,
  direction: 'lent',
  lentOn: day(-10),
  dueOn: null,
  status: 'outstanding',
  ...over,
});

describe('recentPeople', () => {
  it('offers the people lent to before, most recent first', () => {
    const loans = [
      loan({ id: 'a', personName: 'Kasun', lentOn: day(-30) }),
      loan({ id: 'b', personName: 'Nuwan', lentOn: day(-2) }),
      loan({ id: 'c', personName: 'Amma', lentOn: day(-10) }),
    ];
    expect(recentPeople(loans)).toEqual(['Nuwan', 'Amma', 'Kasun']);
  });

  it('lists a person ONCE however many loans they have', () => {
    const loans = [
      loan({ id: 'a', personName: 'Kasun', lentOn: day(-1) }),
      loan({ id: 'b', personName: 'Kasun', lentOn: day(-20) }),
      loan({ id: 'c', personName: 'Kasun', lentOn: day(-40) }),
    ];
    expect(recentPeople(loans)).toEqual(['Kasun']);
  });

  it('treats differing capitalisation as the same person', () => {
    const loans = [
      loan({ id: 'a', personName: 'nuwan', lentOn: day(-1) }),
      loan({ id: 'b', personName: 'Nuwan', lentOn: day(-5) }),
    ];
    // One entry, and it keeps the spelling from the most recent loan rather
    // than normalising a name the user chose how to write.
    expect(recentPeople(loans)).toEqual(['nuwan']);
  });

  it('includes people from settled and written-off loans', () => {
    // You lend to the same friend again after squaring up — that history is
    // exactly what makes them a likely suggestion.
    const loans = [
      loan({ id: 'a', personName: 'Dilan', status: 'paid', lentOn: day(-3) }),
      loan({ id: 'b', personName: 'Sanjeewa', status: 'written_off', lentOn: day(-8) }),
    ];
    expect(recentPeople(loans)).toEqual(['Dilan', 'Sanjeewa']);
  });

  it('skips blank names rather than offering an empty chip', () => {
    const loans = [loan({ id: 'a', personName: '   ', lentOn: day(-1) })];
    expect(recentPeople(loans)).toEqual([]);
  });

  it('caps the list so the row cannot grow without bound', () => {
    const loans = Array.from({ length: 20 }, (_, i) =>
      loan({ id: `l${i}`, personName: `P${i}`, lentOn: day(-i) }),
    );
    expect(recentPeople(loans)).toHaveLength(6);
    expect(recentPeople(loans, 3)).toHaveLength(3);
  });

  it('is empty on a fresh book', () => {
    expect(recentPeople([])).toEqual([]);
  });
});

describe('outstandingForPerson', () => {
  const reps = new Map<string, BuddyRepayment[]>([
    ['b', [{ id: 'r', amountMinor: 200_000, paidOn: day(-1) }]],
  ]);

  const loans = [
    loan({ id: 'a', personName: 'Kasun', amountMinor: 500_000 }),
    loan({ id: 'b', personName: 'Kasun', amountMinor: 300_000 }),
    loan({ id: 'c', personName: 'Kasun', amountMinor: 900_000, status: 'paid' }),
    loan({ id: 'd', personName: 'Nuwan', amountMinor: 700_000 }),
  ];

  it('sums every open loan for that person, net of repayments', () => {
    // 5,000 + (3,000 - 2,000) = 6,000. The settled 9,000 is not owed.
    expect(outstandingForPerson(loans, reps, 'Kasun')).toBe(600_000);
  });

  it('matches regardless of capitalisation', () => {
    expect(outstandingForPerson(loans, reps, 'kasun')).toBe(600_000);
  });

  it('is zero for someone with no open loans', () => {
    expect(outstandingForPerson(loans, reps, 'Amma')).toBe(0);
  });

  it('ignores money the user BORROWED from them', () => {
    // "Ruwan owes you nothing" is true even while you owe Ruwan — the
    // suggestion chip is about what they owe, not a net position.
    const withBorrowed = [loan({ id: 'x', personName: 'Ruwan', direction: 'borrowed' })];
    expect(outstandingForPerson(withBorrowed, new Map(), 'Ruwan')).toBe(0);
  });
});
