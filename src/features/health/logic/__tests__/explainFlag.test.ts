import { describe, expect, it } from 'vitest';
import { shouldBe } from '~/features/health/logic/healthMetrics';

const bp = (value: number, valueSecondary: number) => ({
  testKey: 'blood_pressure',
  value,
  valueSecondary,
  unit: 'mmHg',
  refLow: 90,
  refHigh: 119,
});

describe('shouldBe', () => {
  it('names the blood-pressure number that is off, with only its range', () => {
    expect(shouldBe(bp(128, 50))).toBe('The bottom number should be 60–79');
    expect(shouldBe(bp(85, 70))).toBe('The top number should be 90–119');
    expect(shouldBe(bp(135, 70))).toBe('The top number should be under 120');
    expect(shouldBe(bp(115, 85))).toBe('The bottom number should be under 80');
    expect(shouldBe(bp(110, 70))).toBeNull();
  });

  it('gives the normal range for other measures', () => {
    const row = { testKey: 'fasting_blood_glucose', value: 130, valueSecondary: null, unit: 'mg/dL' };
    expect(shouldBe({ ...row, refLow: 70, refHigh: 99 })).toBe('Should be 70–99 mg/dL');
    expect(shouldBe({ ...row, refLow: null, refHigh: 200 })).toBe('Should be under 200 mg/dL');
    expect(shouldBe({ ...row, refLow: 40, refHigh: null })).toBe('Should be above 40 mg/dL');
    expect(shouldBe({ ...row, refLow: null, refHigh: null })).toBeNull();
  });
});
