import { describe, expect, it } from 'vitest';
import {
  askInstruction,
  buildLifeContext,
  buildMoneyContext,
  combineContext,
  scopeForPath,
} from '~/features/ask/logic/askScope';

describe('where a question comes from', () => {
  it('maps screens to scopes', () => {
    expect(scopeForPath('/')).toBe('global');
    expect(scopeForPath('/settings')).toBe('global');
    expect(scopeForPath('/list')).toBe('money');
    expect(scopeForPath('/loans')).toBe('money');
    expect(scopeForPath('/mini/buddyloans')).toBe('money');
    expect(scopeForPath('/mini/health/labs')).toBe('health');
    expect(scopeForPath('/mini/fuel')).toBe('life');
    expect(scopeForPath('/mini/documents/folder')).toBe('life');
  });
});

describe('money is summaries only', () => {
  const text = buildMoneyContext({
    period: '2026-11',
    currency: 'LKR',
    incomeMinor: 50_000_000,
    plannedMinor: 30_000_000,
    paidMinor: 10_000_000,
    outstandingMinor: 20_000_000,
    categories: [
      {
        name: 'Home',
        plannedMinor: 20_000_000,
        actualMinor: 10_000_000,
        lines: [
          { name: 'Rent', plannedMinor: 10_000_000, actualMinor: 10_000_000, status: 'paid', dueDay: 5, type: 'expense' },
          { name: 'Power', plannedMinor: 1_000_000, actualMinor: null, status: 'pending', dueDay: 20, type: 'expense' },
        ],
      },
    ],
    accounts: [{ label: 'BOC · Salary', balanceMinor: 12_345_600, currency: 'LKR' }],
    monthly: [{ period: '2026-10', spentMinor: 25_000_000 }],
    loans: [{ name: 'Car loan', installmentMinor: 4_500_000, remainingMinor: 90_000_000, paidCount: 12, termMonths: 60 }],
    buddy: { lentCount: 2, lentMinor: 3_000_000, borrowedCount: 0, borrowedMinor: 0, overdueCount: 1 },
  });

  it('carries the plan, balances and loans', () => {
    expect(text).toContain('Month on screen: 2026-11');
    expect(text).toContain('Rent');
    expect(text).toContain('Power');
    expect(text).toMatch(/pending, due on the 20/);
    expect(text).toContain('BOC · Salary');
    expect(text).toMatch(/Car loan: .* 12 of 60 paid/);
    expect(text).toMatch(/others owe the user .*\(2\).*1 overdue/);
  });
});

describe('life and combining', () => {
  it('summarises vehicles, trackers and folders', () => {
    const text = buildLifeContext({
      currency: 'LKR',
      today: new Date('2026-11-12'),
      vehicles: [{ name: 'Axio', kind: 'car', fills30d: 3, spent30dMinor: 4_500_000, lastFill: new Date('2026-11-01') }],
      trackers: [{ name: 'Gas cylinder', unit: null, expectedDays: 40, lastRefill: null }],
      folders: [{ name: 'Insurance', files: 4 }],
    });
    expect(text).toMatch(/Axio \(car\): 3 fill-ups/);
    expect(text).toContain('Gas cylinder, lasts about 40 days, never refilled');
    expect(text).toContain('Insurance (4)');
  });

  it('says what was not shared, so the model never guesses', () => {
    const text = combineContext([{ area: 'health', text: 'H' }], ['money']);
    expect(text).toContain('## HEALTH RECORDS\nH');
    expect(text).toMatch(/NOT SHARED[\s\S]*Money[\s\S]*Settings → AI features/);
  });

  it('adds health and money rules only when those areas are in play', () => {
    expect(askInstruction('money', ['money'])).toMatch(/investment, tax or legal/);
    expect(askInstruction('money', ['money'])).not.toMatch(/emergency/);
    expect(askInstruction('global', ['health', 'money'])).toMatch(/emergency[\s\S]*investment/);
  });
});
