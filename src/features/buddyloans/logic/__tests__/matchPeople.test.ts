import { describe, expect, it } from 'vitest';
import { findPerson, matchPeople } from '~/features/buddyloans/logic/buddyLoans';

const PEOPLE = ['Nuwan Perera', 'Kasun', 'Nimal Kalpage', 'Amma'];

describe('picking an existing person while typing', () => {
  it('ranks name-starts above word-starts above substrings', () => {
    expect(matchPeople(PEOPLE, 'ka')).toEqual(['Kasun', 'Nimal Kalpage']);
    expect(matchPeople(PEOPLE, 'per')).toEqual(['Nuwan Perera']);
    expect(matchPeople(PEOPLE, 'mm')).toEqual(['Amma']);
  });

  it('ignores case, and shows recent people for an empty box', () => {
    expect(matchPeople(PEOPLE, 'NUW')).toEqual(['Nuwan Perera']);
    expect(matchPeople(PEOPLE, '', 2)).toEqual(['Nuwan Perera', 'Kasun']);
    expect(matchPeople(PEOPLE, 'zz')).toEqual([]);
  });

  it('recognises an existing person however it is typed', () => {
    expect(findPerson(PEOPLE, '  kasun ')).toBe('Kasun');
    expect(findPerson(PEOPLE, 'nuwan  perera')).toBe('Nuwan Perera');
    expect(findPerson(PEOPLE, 'Kasunx')).toBeNull();
    expect(findPerson(PEOPLE, '')).toBeNull();
  });
});

import { groupLoansByPerson } from '~/features/buddyloans/logic/buddyLoans';

describe('one row per person', () => {
  it('groups a person’s loans, in the list’s order', () => {
    const groups = groupLoansByPerson([
      { id: 1, personName: 'Kavindu' },
      { id: 2, personName: 'Chamara' },
      { id: 3, personName: 'kavindu ' },
    ]);
    expect(groups.map((g) => [g.name, g.loans.map((l) => l.id)])).toEqual([
      ['Kavindu', [1, 3]],
      ['Chamara', [2]],
    ]);
  });
});
