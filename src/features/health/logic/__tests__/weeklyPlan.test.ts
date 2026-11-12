import { describe, expect, it } from 'vitest';
import { buildWeeklyPlan, planDayIndex, planFocus, type PlanSeries } from '~/features/health/logic/weeklyPlan';

const s = (testKey: string, status: PlanSeries['latest']['status'], category = 'Other', value: number | null = null, valueSecondary: number | null = null): PlanSeries => ({
  testKey,
  category,
  latest: { status, value, valueSecondary },
});

const base = { age: 45, conditions: null, bmi: null };

describe('what the plan works on', () => {
  it('picks focuses from results that are off in the direction that matters', () => {
    expect(
      planFocus({
        ...base,
        series: [
          s('hba1c', 'high', 'Blood sugar'),
          s('ldl_cholesterol', 'borderline'),
          s('hdl_cholesterol', 'high'), // high HDL is good — no focus
          s('hemoglobin', 'low'),
          s('serum_creatinine', 'normal'),
        ],
      }),
    ).toEqual(['sugar', 'cholesterol', 'anaemia']);
  });

  it('counts low eGFR, high creatinine and low HDL as problems', () => {
    expect(planFocus({ ...base, series: [s('egfr', 'low')] })).toEqual(['kidney']);
    expect(planFocus({ ...base, series: [s('egfr', 'high')] })).toEqual([]);
    expect(planFocus({ ...base, series: [s('hdl_cholesterol', 'low')] })).toEqual(['cholesterol']);
  });

  it('adds known conditions and a high BMI', () => {
    expect(planFocus({ ...base, conditions: 'Type 2 diabetes, hypertension', bmi: 27, series: [] })).toEqual([
      'sugar',
      'pressure',
      'weight',
    ]);
  });
});

describe('the week', () => {
  it('meets the WHO weekly minimum with two strength days', () => {
    const plan = buildWeeklyPlan({ ...base, series: [] });
    expect(plan.days).toHaveLength(7);
    expect(plan.weeklyMinutes).toBeGreaterThanOrEqual(150);
    expect(plan.days.filter((d) => d.exercise.kind === 'strength')).toHaveLength(2);
    // ADA: never more than two days in a row without activity.
    expect(plan.days.filter((d) => d.exercise.kind === 'rest').length).toBeLessThanOrEqual(1);
    expect(plan.summary).toMatch(/normal/);
  });

  it('adds after-meal walks for sugar and balance work from 65', () => {
    const plan = buildWeeklyPlan({ ...base, age: 70, series: [s('fasting_blood_glucose', 'high')] });
    expect(plan.days.every((d) => d.extras.some((e) => /after lunch/.test(e)))).toBe(true);
    expect(plan.days.filter((d) => d.extras.some((e) => /Balance/.test(e)))).toHaveLength(3);
    expect(plan.cautions.some((c) => /diabetes medicine/.test(c.text))).toBe(true);
  });

  it('never tells someone with weak kidneys to eat more protein or potassium', () => {
    const plan = buildWeeklyPlan({ ...base, series: [s('serum_creatinine', 'high'), s('blood_pressure', 'high', 'Heart', 150, 95)] });
    const all = [...plan.rules.map((r) => r.text), ...plan.days.flatMap((d) => Object.values(d.meals))].join(' ');
    expect(all).not.toMatch(/(?<!not )\b(eat|add|increase) more (protein|bananas?|potassium)/i);
    expect(plan.rules.some((r) => r.focus === 'kidney' && /potassium/.test(r.text))).toBe(true);
    expect(plan.sources.some((src) => src.org === 'KDIGO')).toBe(true);
  });

  it('says to see a doctor first when blood pressure is in the crisis range', () => {
    const plan = buildWeeklyPlan({ ...base, series: [s('blood_pressure', 'high', 'Heart', 185, 100)] });
    expect(plan.cautions[0]).toMatchObject({ level: 'stop' });
  });

  it('keeps salt under the WHO limit and cites it', () => {
    const plan = buildWeeklyPlan({ ...base, series: [] });
    expect(plan.rules.some((r) => /1 teaspoon of salt/.test(r.text))).toBe(true);
    expect(plan.sources.map((x) => x.org)).toContain('World Health Organization');
  });

  it('starts the week on Monday', () => {
    expect(planDayIndex(new Date(2026, 10, 9))).toBe(0); // Monday
    expect(planDayIndex(new Date(2026, 10, 15))).toBe(6); // Sunday
  });
});
