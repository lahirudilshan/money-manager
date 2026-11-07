import { describe, expect, it } from 'vitest';
import {
  asianBand,
  bmi,
  bodyReport,
  cmToFeetInches,
  explainBody,
  feetInchesToCm,
  formatHeight,
  formatWaist,
  mifflinStJeor,
  whoBand,
} from '../bodyMeasures';

describe('BMI', () => {
  it('is weight over height squared', () => {
    expect(bmi(70, 175)).toBeCloseTo(22.86, 2);
  });

  it('uses the WHO adult cut-offs', () => {
    expect(whoBand(18.4)).toBe('underweight');
    expect(whoBand(18.5)).toBe('healthy');
    expect(whoBand(24.9)).toBe('healthy');
    expect(whoBand(25)).toBe('overweight');
    expect(whoBand(30)).toBe('obese');
  });

  it('uses the lower Asian cut-offs', () => {
    expect(asianBand(22.9)).toBe('healthy');
    expect(asianBand(23)).toBe('overweight');
    expect(asianBand(25)).toBe('obese');
  });

  it('can be healthy by WHO and overweight by the Asian cut-offs', () => {
    const r = bodyReport({ heightCm: 170, weightKg: 69, waistCm: null, age: 35, sex: 'male' });
    expect(r.bmi?.value).toBe(23.9);
    expect(r.bmi?.who).toBe('healthy');
    expect(r.bmi?.asian).toBe('overweight');
  });

  it('gives the obese class', () => {
    expect(bodyReport({ heightCm: 160, weightKg: 105, waistCm: null, age: 40, sex: 'female' }).bmi?.obeseClass).toBe(3);
  });

  it('gives no adult category for a child', () => {
    const r = bodyReport({ heightCm: 140, weightKg: 35, waistCm: null, age: 10, sex: 'female' });
    expect(r.bmi?.isChild).toBe(true);
    expect(r.bmi?.who).toBeNull();
    expect(r.healthyWeight).toBeNull();
    expect(r.bmr).toBeNull();
  });
});

describe('healthy weight', () => {
  it('is BMI 18.5–24.9 for the height', () => {
    const r = bodyReport({ heightCm: 175, weightKg: 90, waistCm: null, age: 30, sex: 'male' });
    expect(r.healthyWeight).toEqual({ low: 56.7, high: 76.3, asianHigh: 70.1 });
    expect(r.toHealthy).toBe(13.7);
  });
});

describe('resting calories', () => {
  it('follows Mifflin–St Jeor', () => {
    // 10·70 + 6.25·175 − 5·30 + 5 = 1648.75
    expect(mifflinStJeor(70, 175, 30, 'male')).toBeCloseTo(1648.75);
    // 10·60 + 6.25·160 − 5·40 − 161 = 1239
    expect(mifflinStJeor(60, 160, 40, 'female')).toBe(1239);
  });

  it('asks for what it needs', () => {
    const r = bodyReport({ heightCm: 175, weightKg: 70, waistCm: null, age: null, sex: null });
    expect(r.bmr).toBeNull();
    expect(r.missing).toEqual(expect.arrayContaining(['year of birth', 'sex', 'waist']));
  });
});

describe('waist-to-height', () => {
  it('flags a waist over half the height', () => {
    expect(bodyReport({ heightCm: 170, weightKg: 70, waistCm: 80, age: 30, sex: 'male' }).waistToHeight).toEqual({ value: 0.47, band: 'healthy' });
    expect(bodyReport({ heightCm: 170, weightKg: 70, waistCm: 95, age: 30, sex: 'male' }).waistToHeight?.band).toBe('raised');
  });
});

it('ignores an impossible height rather than reporting a BMI of 0.2', () => {
  expect(bodyReport({ heightCm: 1750, weightKg: 70, waistCm: null, age: 30, sex: 'male' }).bmi).toBeNull();
});

describe('units', () => {
  it('converts feet and inches to cm and back', () => {
    expect(feetInchesToCm(5, 7)).toBeCloseTo(170.18);
    expect(cmToFeetInches(170.18)).toEqual({ feet: 5, inches: 7 });
    // 11.6 inches rounds to 12 and carries into the feet.
    expect(cmToFeetInches(feetInchesToCm(5, 11.6))).toEqual({ feet: 6, inches: 0 });
  });

  it('shows the unit the person chose', () => {
    expect(formatHeight(170.18, 'in')).toBe('5′ 7″');
    expect(formatHeight(170.18, 'cm')).toBe('170 cm');
    expect(formatWaist(81.28, 'in')).toBe('32″');
    expect(formatWaist(82, null)).toBe('82 cm');
  });
});

describe('explainBody', () => {
  const figures = { heightCm: 170, weightKg: 75 };
  const report = bodyReport({ ...figures, waistCm: 90, age: 40, sex: 'male' });
  const parts = explainBody(report, figures);
  const text = parts.map((p) => `${p.title}\n${p.text}`).join('\n');

  it('shows the working with the person’s own figures', () => {
    expect(text).toContain('75.0 kg ÷ 1.70 m ÷ 1.70 m = 26');
  });

  it('explains every figure on the card in plain words', () => {
    expect(parts.map((p) => p.title)).toEqual([
      'What is BMI?',
      'What your 26.0 means',
      'Healthy weight',
      'Calories a day',
      'Waist and height',
      'Good to know',
    ]);
    expect(text).not.toMatch(/Mifflin|BMR|WHO/);
  });

  it('says how far from a healthy weight', () => {
    expect(text).toMatch(/You are [\d.]+ kg above it/);
  });

  it('gives a child the growth-chart note, not adult bands', () => {
    const child = bodyReport({ heightCm: 150, weightKg: 45, waistCm: null, age: 12, sex: 'female' });
    const titles = explainBody(child, { heightCm: 150, weightKg: 45 }).map((p) => p.title);
    expect(titles).toContain('Under 18');
    expect(titles).not.toContain('Healthy weight');
  });
});
