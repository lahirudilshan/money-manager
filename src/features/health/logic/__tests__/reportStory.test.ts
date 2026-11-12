import { describe, expect, it } from 'vitest';
import { reportStory, type StorySeries } from '~/features/health/logic/reportStory';

const at = new Date('2026-10-03');
const row = (testKey: string, testName: string, category: string, status: StorySeries['latest']['status'], valueText = '1', refLow: number | null = null, refHigh: number | null = null): StorySeries => ({
  testKey,
  testName,
  category,
  latest: { status, value: Number(valueText), valueText, unit: 'mg/dL', refLow, refHigh, measuredAt: at },
});

describe('what the report says', () => {
  it('says all normal plainly', () => {
    const story = reportStory([row('serum_creatinine', 'Creatinine', 'Kidney', 'normal')]);
    expect(story.headline).toBe('Good news: your result is normal.');
    expect(story.goodNews).toEqual(['Kidneys are working well']);
  });

  it('names what needs work, with numbers and what to do', () => {
    const story = reportStory([
      row('fasting_blood_glucose', 'Fasting blood sugar', 'Blood sugar', 'high', '142', 70, 99),
      row('ldl_cholesterol', 'LDL cholesterol', 'Cholesterol & fats', 'borderline', '130', null, 100),
      row('total_cholesterol', 'Total cholesterol', 'Cholesterol & fats', 'normal'),
      row('serum_creatinine', 'Creatinine', 'Kidney', 'normal'),
    ]);
    expect(story.headline).toBe('Some things need work: your blood sugar and cholesterol. Your other 2 results are normal.');
    expect(story.needsWork[0]).toMatchObject({
      title: 'Fasting blood sugar is high',
      numbers: '142 mg/dL. Normal is 70–99.',
      direction: 'high',
    });
    expect(story.needsWork[0].todo).toMatch(/doctor/);
    expect(story.needsWork[1].title).toBe('LDL (“bad”) cholesterol is slightly high');
    expect(story.needsWork[0].title).toBe('Fasting blood sugar is high');
    // Cholesterol has something off, so it is not good news.
    expect(story.goodNews).toEqual(['Kidneys are working well']);
  });

  it('names a single area', () => {
    expect(reportStory([row('blood_pressure', 'Blood pressure', 'Heart', 'high', 'x')]).headline).toBe(
      'Some things need work: your blood pressure.',
    );
  });
});

describe('plain names for real lab printouts', () => {
  it('turns lab names into everyday words, and says how far off', () => {
    const story = reportStory([
      row('sgot_ast', 'SGOT ( AST )', 'Liver', 'high', '39', null, 37),
      row('eosinophil_absolute', 'EOSINOPHIL (Absolute)', 'Blood count', 'high', '800', 20, 500),
      row('fbs', 'Fasting blood sugar', 'Blood sugar', 'normal'),
    ]);
    // Furthest from normal first.
    expect(story.needsWork.map((n) => n.title)).toEqual([
      'Allergy cells (eosinophils) count is high',
      'Liver enzyme (AST) is slightly high',
    ]);
    expect(story.needsWork[1].meaning).toMatch(/liver may be under some stress/);
    expect(story.needsWork[1].todo).toBe('Nothing urgent. Mention it at your next check-up.');
    expect(story.headline).toBe('Some things need work: your blood count and liver. Your other result is normal.');
  });
});

import { plainName } from '~/features/health/logic/plainTests';
describe('plainName', () => {
  it('knows the common panel and tidies the rest', () => {
    expect(plainName('alt_sgpt', 'ALT (SGPT)')).toBe('Liver enzyme (ALT)');
    expect(plainName('urine_albumin', 'Urine albumin')).toBe('Protein in urine');
    expect(plainName('albumin', 'Albumin')).toBe('Albumin (blood protein)');
    expect(plainName('mchc', 'MCHC')).toBe('Red cell colour (MCHC)');
    expect(plainName('mch', 'MCH')).toBe('Haemoglobin in each red cell (MCH)');
    expect(plainName('hba1c', 'HbA1c')).toBe('HbA1c (3-month sugar)');
    expect(plainName('xyz', 'SOME TEST')).toBe('Some test');
    expect(plainName('fasting_blood_glucose', 'FBS')).toBe('Fasting blood sugar');
  });
});

describe('what matters most comes first', () => {
  it('puts a guided measure above a minor blood-cell count, and fills a missing range', () => {
    const story = reportStory([
      row('monocyte_absolute', 'MONOCYTE (Absolute)', 'Blood count', 'low', '67', 200, 1000),
      row('hba1c', 'HbA1c', 'Blood sugar', 'high', '6.5'),
    ]);
    expect(story.needsWork[0].title).toBe('HbA1c (3-month sugar) is high');
    expect(story.needsWork[0].numbers).toBe('6.5 mg/dL. Normal is below 5.7.');
    expect(story.needsWork[1].title).toBe('Immune cells (monocytes) count is low');
    expect(story.needsWork[1].todo).toMatch(/Nothing to do on its own/);
  });
});

describe('high HDL', () => {
  it('is good news, not a problem', () => {
    const story = reportStory([row('hdl_cholesterol', 'HDL', 'Cholesterol & fats', 'high', '80', 40, 60)]);
    expect(story.needsWork).toEqual([]);
    expect(story.goodNews[0]).toMatch(/protects your heart/);
    expect(story.headline).toMatch(/Good news/);
  });
});

import { tidyValue } from '~/features/health/logic/plainTests';
describe('count vs share, and tidy numbers', () => {
  it('tells a blood-cell count from its percentage', () => {
    expect(plainName('eosinophil_absolute', 'EOSINOPHIL (Absolute)', '/Cu mm')).toBe('Allergy cells (eosinophils) count');
    expect(plainName('eosinophil', 'EOSINOPHIL', '%')).toBe('Allergy cells (eosinophils) %');
    expect(plainName('wbc', 'WBC', '/Cu mm')).toBe('White blood cells');
    expect(plainName('alt', 'ALT', 'U/L')).toBe('Liver enzyme (ALT)');
  });
  it('drops lab padding from numbers', () => {
    expect(tidyValue('536.00')).toBe('536');
    expect(tidyValue('08')).toBe('8');
    expect(tidyValue('6.50')).toBe('6.5');
    expect(tidyValue('128/80')).toBe('128/80');
    expect(tidyValue('Nil')).toBe('Nil');
  });
});

describe('areas', () => {
  it('lists each body area with how many are off, worst first', () => {
    const story = reportStory([
      row('serum_creatinine', 'Creatinine', 'Kidney', 'normal'),
      row('fbs', 'Fasting blood sugar', 'Blood sugar', 'high', '130', 70, 99),
      row('hba1c', 'HbA1c', 'Blood sugar', 'normal'),
    ]);
    expect(story.areas).toEqual([
      { category: 'Blood sugar', total: 2, off: 1 },
      { category: 'Kidney', total: 1, off: 0 },
    ]);
  });
});
