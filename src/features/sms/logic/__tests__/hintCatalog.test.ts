import { describe, expect, it } from 'vitest';
import { CATEGORY_CATALOG } from '~/shared/data/categoryCatalog';
import {
  findGroupForProposal,
  findLineForHint,
  proposalForHint,
  type ExistingGroup,
  type ExistingLine,
} from '../hintCatalog';
import { HINT_META, type CategoryHint } from '../smsCategoryHints';

const ALL_HINTS = Object.keys(HINT_META) as CategoryHint[];

describe('proposalForHint', () => {
  it('maps every hint to a real catalog line', () => {
    // Guards the mapping against catalog edits: renaming or removing a catalog
    // entry would otherwise leave a hint silently proposing nothing, which
    // reads to the user as the create button randomly not appearing.
    for (const hint of ALL_HINTS) {
      const proposal = proposalForHint(hint);
      expect(proposal, `no proposal for "${hint}"`).not.toBeNull();

      const category = CATEGORY_CATALOG.find((c) => c.id === proposal!.category.id);
      expect(category, `category missing for "${hint}"`).toBeDefined();
      expect(
        category!.subcategories.some((s) => s.id === proposal!.subcategory.id),
        `line "${proposal!.subcategory.id}" not in "${category!.id}" for hint "${hint}"`,
      ).toBe(true);
    }
  });

  it('proposes the onboarding line a user would recognise', () => {
    expect(proposalForHint('loan')?.subcategory.name).toBe('Personal loan');
    expect(proposalForHint('loan')?.category.name).toBe('Loans & credit');
    expect(proposalForHint('electricity')?.subcategory.name).toBe('Electricity (CEB / LECO)');
    expect(proposalForHint('groceries')?.category.name).toBe('Living');
  });

  it('types an income hint as income, not an expense line', () => {
    // Creating "Salary" as an expense would land it on the wrong side of the
    // board and quietly corrupt every total that follows.
    expect(proposalForHint('income')?.type).toBe('income');
    expect(proposalForHint('loan')?.type).toBe('expense');
    expect(proposalForHint('atm')?.type).toBe('expense');
  });

  it('returns null for no hint', () => {
    expect(proposalForHint(null)).toBeNull();
  });
});

describe('findLineForHint', () => {
  const groups: ExistingGroup[] = [
    { id: 'g-housing', name: 'Housing' },
    { id: 'g-misc', name: 'Bits and pieces' },
  ];

  const line = (over: Partial<ExistingLine> & { id: string; name: string }): ExistingLine => ({
    type: 'expense',
    categoryId: 'g-housing',
    archivedAt: null,
    ...over,
  });

  it('matches an existing line by name, ignoring catalog parentheses', () => {
    const lines = [line({ id: 's1', name: 'Electricity' })];
    expect(findLineForHint('electricity', lines, groups)?.id).toBe('s1');
  });

  it('matches a hand-named line by keyword', () => {
    // "CEB bill" is in no catalog, but the reconciler already treats it as
    // electricity — the create button must not offer a duplicate beside it.
    const lines = [line({ id: 's2', name: 'CEB bill' })];
    expect(findLineForHint('electricity', lines, groups)?.id).toBe('s2');
  });

  it('matches via the group name when the line alone is ambiguous', () => {
    const lines = [line({ id: 's3', name: 'Monthly', categoryId: 'g-loans' })];
    const withLoans = [...groups, { id: 'g-loans', name: 'Loan repayments' }];
    expect(findLineForHint('loan', lines, withLoans)?.id).toBe('s3');
  });

  it('never resurrects an archived line', () => {
    const lines = [line({ id: 's4', name: 'Water', archivedAt: Date.now() })];
    expect(findLineForHint('water', lines, groups)).toBeNull();
  });

  it('ignores a same-named line of the wrong type', () => {
    // An income line called "Salary" must not satisfy an expense hint.
    const lines = [line({ id: 's5', name: 'Personal loan', type: 'income' })];
    expect(findLineForHint('loan', lines, groups)).toBeNull();
  });

  it('returns null when the board has nothing suitable', () => {
    const lines = [line({ id: 's6', name: 'Netflix' })];
    expect(findLineForHint('water', lines, groups)).toBeNull();
  });
});

describe('findGroupForProposal', () => {
  it('reuses an existing group with the catalog name', () => {
    const proposal = proposalForHint('electricity')!;
    const groups: ExistingGroup[] = [{ id: 'g1', name: 'Housing' }];
    expect(findGroupForProposal(proposal, groups)?.id).toBe('g1');
  });

  it('is case- and punctuation-insensitive', () => {
    const proposal = proposalForHint('loan')!;
    const groups: ExistingGroup[] = [{ id: 'g2', name: 'loans & credit' }];
    expect(findGroupForProposal(proposal, groups)?.id).toBe('g2');
  });

  it('returns null when no group matches, so the caller creates one', () => {
    const proposal = proposalForHint('fuel')!;
    const groups: ExistingGroup[] = [{ id: 'g3', name: 'Housing' }];
    expect(findGroupForProposal(proposal, groups)).toBeNull();
  });
});
