import { describe, expect, it } from 'vitest';
import { bandIndexFor, guideFor } from '~/features/health/logic/measureGuide';
import { readingStatus } from '~/features/health/logic/healthMetrics';

describe('measure guides', () => {
  it('has a guide for the common measures, each band explained', () => {
    for (const key of ['blood_pressure', 'fasting_blood_glucose', 'hba1c', 'total_cholesterol', 'ldl_cholesterol', 'hemoglobin', 'tsh']) {
      const guide = guideFor(key);
      expect(guide, key).not.toBeNull();
      for (const band of guide!.bands) {
        expect(band.meaning.length).toBeGreaterThan(5);
        expect(band.effects.length).toBeGreaterThan(5);
      }
    }
    expect(guideFor('made_up_test')).toBeNull();
  });

  it('marks the band the verdict falls in', () => {
    const bp = guideFor('blood_pressure')!;
    expect(bp.bands[bandIndexFor(bp, 'high')].name).toBe('High');
    expect(bp.bands[bandIndexFor(bp, 'borderline')].name).toBe('Elevated');
    expect(bandIndexFor(bp, 'unknown')).toBe(-1);
    // No borderline band: borderline sits with high.
    const ldlLess = guideFor('heart_rate')!;
    expect(ldlLess.bands[bandIndexFor(ldlLess, 'borderline')].status).toBe('high');
  });

  it('agrees with the verdicts the app gives home readings', () => {
    // The guide's printed bands and readingStatus must never contradict.
    expect(readingStatus('blood_pressure', 119, 79)).toBe('normal');
    expect(readingStatus('blood_pressure', 125, 79)).toBe('borderline');
    expect(readingStatus('blood_pressure', 130, 79)).toBe('high');
    expect(readingStatus('blood_pressure', 119, 80)).toBe('high');
    expect(readingStatus('fasting_blood_glucose', 99, null)).toBe('normal');
    expect(readingStatus('fasting_blood_glucose', 100, null)).toBe('borderline');
    expect(readingStatus('fasting_blood_glucose', 126, null)).toBe('high');
    expect(readingStatus('hba1c', 5.7, null)).toBe('borderline');
    expect(readingStatus('hba1c', 6.5, null)).toBe('high');
  });
});
