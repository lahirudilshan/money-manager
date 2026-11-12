import { useMemo } from 'react';
import type { HealthPerson } from '~/db/schema';
import { bodyReport } from '~/features/health/logic/bodyMeasures';
import { buildWeeklyPlan, type WeeklyPlan } from '~/features/health/logic/weeklyPlan';
import type { PersonHealth } from './usePersonHealth';

/** Whole years since a date. */
function yearsSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (365.25 * 86_400_000));
}

/** This person's weekly plan, from their latest results, conditions and BMI. */
export function useWeeklyPlan(person: HealthPerson | undefined, health: PersonHealth): WeeklyPlan {
  return useMemo(() => {
    const age = person?.bornOn ? yearsSince(person.bornOn) : null;
    const weight = health.series.find((s) => s.testKey === 'weight')?.latest;
    const weightKg =
      weight?.value != null ? (/lb/i.test(weight.unit ?? '') ? weight.value * 0.453592 : weight.value) : null;
    const body = bodyReport({
      heightCm: person?.heightCm ?? null,
      weightKg,
      waistCm: person?.waistCm ?? null,
      age,
      sex: person?.sex ?? null,
    });
    return buildWeeklyPlan({
      series: health.series,
      age,
      conditions: person?.conditions ?? null,
      bmi: body.bmi && !body.bmi.isChild ? body.bmi.value : null,
    });
  }, [person, health.series]);
}
