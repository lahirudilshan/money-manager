/**
 * Body measures worked out from height, weight, waist, age and sex — the
 * standard formulas, nothing invented.
 *
 *   - BMI = weight (kg) ÷ height (m)². Judged two ways, both shown:
 *       WHO adult cut-offs        <18.5 · 18.5–24.9 · 25–29.9 · 30+
 *       WHO Asian cut-offs (2004, used by Sri Lanka's Ministry of Health)
 *                                 <18.5 · 18.5–22.9 · 23–24.9 · 25+
 *     Asian bodies carry more risk at a lower BMI, so the same 24 is
 *     "healthy" by one and "overweight" by the other — the user should see
 *     both rather than have one picked for them.
 *   - Healthy weight for a height: the weights that give BMI 18.5–24.9
 *     (and 18.5–22.9 by the Asian cut-offs).
 *   - Resting calories (BMR): Mifflin–St Jeor (1990), the equation dietitians
 *     use by default: 10·kg + 6.25·cm − 5·age + 5 (men) / − 161 (women).
 *     Daily needs = BMR × 1.2 (desk job, little exercise) up to × 1.55
 *     (exercise 3–5 days a week).
 *   - Waist-to-height ratio: waist ÷ height. Under 0.5 is the NICE (2022)
 *     advice for everyone — "keep your waist under half your height";
 *     0.5–0.59 is increased risk, 0.6+ high.
 *
 * Adult formulas only. Under 18, BMI must be read against growth charts for
 * age and sex, so a category is not given; under 18 no BMR either.
 *
 * Pure — no database. Tested in bodyMeasures.test.ts.
 */

export type Sex = 'male' | 'female';

export type BmiBand = 'underweight' | 'healthy' | 'overweight' | 'obese';

export interface BodyInput {
  heightCm: number | null;
  weightKg: number | null;
  waistCm: number | null;
  age: number | null;
  sex: Sex | null;
}

export interface BmiResult {
  value: number;
  /** WHO adult band. Null for a child. */
  who: BmiBand | null;
  /** WHO class within obese: I (30–34.9), II (35–39.9), III (40+). */
  obeseClass: 1 | 2 | 3 | null;
  /** Asian cut-off band. Null for a child. */
  asian: BmiBand | null;
  isChild: boolean;
}

export interface BodyReport {
  bmi: BmiResult | null;
  /** Healthy weight range for this height, in kg. */
  healthyWeight: { low: number; high: number; asianHigh: number } | null;
  /** kg to lose (+) or gain (−) to reach the nearest edge of the healthy range; 0 inside it. */
  toHealthy: number | null;
  bmr: number | null;
  /** Daily calories: little exercise → moderate exercise. */
  dailyCalories: { low: number; high: number } | null;
  waistToHeight: { value: number; band: 'low' | 'healthy' | 'raised' | 'high' } | null;
  /** What is still needed for the parts that are missing, in words. */
  missing: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export function whoBand(value: number): BmiBand {
  if (value < 18.5) return 'underweight';
  if (value < 25) return 'healthy';
  if (value < 30) return 'overweight';
  return 'obese';
}

export function asianBand(value: number): BmiBand {
  if (value < 18.5) return 'underweight';
  if (value < 23) return 'healthy';
  if (value < 25) return 'overweight';
  return 'obese';
}

/** Mifflin–St Jeor resting energy, kcal/day. */
export function mifflinStJeor(weightKg: number, heightCm: number, age: number, sex: Sex): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

/** A plausible adult or child measure — rejects typos like 1750 cm or 7 kg for an adult. */
export function plausibleHeight(cm: number): boolean {
  return cm >= 40 && cm <= 250;
}
export function plausibleWeight(kg: number): boolean {
  return kg >= 2 && kg <= 350;
}
export function plausibleWaist(cm: number): boolean {
  return cm >= 30 && cm <= 250;
}

export function bodyReport(input: BodyInput): BodyReport {
  const { heightCm, weightKg, waistCm, age, sex } = input;
  const isChild = age !== null && age < 18;
  const height = heightCm !== null && plausibleHeight(heightCm) ? heightCm : null;
  const weight = weightKg !== null && plausibleWeight(weightKg) ? weightKg : null;
  const waist = waistCm !== null && plausibleWaist(waistCm) ? waistCm : null;

  const missing: string[] = [];
  if (height === null) missing.push('height');
  if (weight === null) missing.push('weight');

  let bmiResult: BmiResult | null = null;
  let healthyWeight: BodyReport['healthyWeight'] = null;
  let toHealthy: number | null = null;

  if (height !== null) {
    const m2 = (height / 100) ** 2;
    if (!isChild) {
      healthyWeight = {
        low: round1(18.5 * m2),
        high: round1(24.9 * m2),
        asianHigh: round1(22.9 * m2),
      };
    }
    if (weight !== null) {
      const value = round1(bmi(weight, height));
      const who = isChild ? null : whoBand(value);
      bmiResult = {
        value,
        who,
        obeseClass: who === 'obese' ? (value >= 40 ? 3 : value >= 35 ? 2 : 1) : null,
        asian: isChild ? null : asianBand(value),
        isChild,
      };
      if (healthyWeight) {
        toHealthy =
          weight > healthyWeight.high
            ? round1(weight - healthyWeight.high)
            : weight < healthyWeight.low
              ? round1(weight - healthyWeight.low)
              : 0;
      }
    }
  }

  let bmr: number | null = null;
  let dailyCalories: BodyReport['dailyCalories'] = null;
  if (height !== null && weight !== null && age !== null && sex !== null && !isChild) {
    bmr = Math.round(mifflinStJeor(weight, height, age, sex));
    dailyCalories = { low: Math.round((bmr * 1.2) / 10) * 10, high: Math.round((bmr * 1.55) / 10) * 10 };
  } else if (!isChild && height !== null && weight !== null) {
    if (age === null) missing.push('year of birth');
    if (sex === null) missing.push('sex');
  }

  let waistToHeight: BodyReport['waistToHeight'] = null;
  if (waist !== null && height !== null) {
    const value = Math.round((waist / height) * 100) / 100;
    waistToHeight = {
      value,
      band: value < 0.4 ? 'low' : value < 0.5 ? 'healthy' : value < 0.6 ? 'raised' : 'high',
    };
  } else if (height !== null) {
    missing.push('waist');
  }

  return { bmi: bmiResult, healthyWeight, toHealthy, bmr, dailyCalories, waistToHeight, missing };
}

export const BMI_BAND_LABEL: Record<BmiBand, string> = {
  underweight: 'Underweight',
  healthy: 'Healthy weight',
  overweight: 'Overweight',
  obese: 'Obese',
};

/** What a band means, plainly. */
export function bmiMeaning(band: BmiBand): string {
  switch (band) {
    case 'underweight':
      return 'Lighter than is healthy for your height. It can mean too few nutrients, weaker bones and lower immunity.';
    case 'healthy':
      return 'In the healthy range for your height.';
    case 'overweight':
      return 'Heavier than is healthy for your height. It raises the risk of diabetes, high blood pressure and heart disease — even a few kilos less helps.';
    case 'obese':
      return 'Well above a healthy weight for your height, with a clearly higher risk of diabetes, heart disease, joint problems and sleep apnoea. Worth talking to a doctor.';
  }
}

export const WAIST_BAND_LABEL = {
  low: 'Low',
  healthy: 'Healthy',
  raised: 'Raised risk',
  high: 'High risk',
} as const;

/* ------------------------------------------------------------------------ */
/* Units — stored in cm, typed and shown in cm or feet/inches.              */
/* ------------------------------------------------------------------------ */

export type LengthUnit = 'cm' | 'in';

export const CM_PER_INCH = 2.54;

export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

/** 170 cm → { feet: 5, inches: 7 } (inches rounded, 12 carried into feet). */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const total = Math.round(cmToInches(cm));
  return { feet: Math.floor(total / 12), inches: total % 12 };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return inchesToCm(feet * 12 + inches);
}

/** A height as the person reads it: "170 cm" or "5′ 7″". */
export function formatHeight(cm: number, unit: LengthUnit | null | undefined): string {
  if (unit === 'in') {
    const { feet, inches } = cmToFeetInches(cm);
    return `${feet}′ ${inches}″`;
  }
  return `${Math.round(cm)} cm`;
}

/** A waist as the person reads it: "82 cm" or "32″". */
export function formatWaist(cm: number, unit: LengthUnit | null | undefined): string {
  if (unit === 'in') return `${Number(cmToInches(cm).toFixed(1))}″`;
  return `${Number(cm.toFixed(1))} cm`;
}

/* ------------------------------------------------------------------------ */
/* The plain-words explanation shown when the body card is opened.          */
/* ------------------------------------------------------------------------ */

export interface BodyExplainPart {
  title: string;
  text: string;
}

/**
 * Everything on the body card, explained for someone who has never heard of
 * BMI or BMR: what each number is, how it was worked out from THEIR figures,
 * and what to do with it. No formula names, no acronyms without a meaning.
 */
export function explainBody(
  report: BodyReport,
  figures: { heightCm: number | null; weightKg: number | null; lengthUnit?: LengthUnit | null },
): BodyExplainPart[] {
  const parts: BodyExplainPart[] = [];
  const { bmi: b, healthyWeight, toHealthy, bmr, dailyCalories, waistToHeight } = report;
  const { heightCm, weightKg, lengthUnit } = figures;

  if (b && heightCm && weightKg) {
    const m = (heightCm / 100).toFixed(2);
    const asCm = lengthUnit === 'in' ? ` (${formatHeight(heightCm, 'in')} is ${m} m)` : '';
    parts.push({
      title: 'What is BMI?',
      text:
        `Body Mass Index — a quick check of whether your weight suits your height. ` +
        `Your weight is divided by your height, twice: ${weightKg.toFixed(1)} kg ÷ ${m} m ÷ ${m} m = ${b.value.toFixed(1)}${asCm}.`,
    });
  }

  if (b?.isChild) {
    parts.push({
      title: 'Under 18',
      text: 'Children are still growing, so adult BMI ranges do not apply. A doctor reads a child’s BMI against growth charts for their age.',
    });
  } else if (b?.who) {
    const stricter =
      b.asian && b.asian !== b.who
        ? ` By that stricter scale, your ${b.value.toFixed(1)} counts as “${BMI_BAND_LABEL[b.asian].toLowerCase()}”.`
        : '';
    parts.push({
      title: `What your ${b.value.toFixed(1)} means`,
      text:
        `${bmiMeaning(b.who)}\n\n` +
        `Under 18.5 is too light · 18.5 to 24.9 is healthy · 25 to 29.9 is overweight · 30 or more is obese.\n\n` +
        `Doctors in Sri Lanka and much of Asia use a stricter scale, because Asian bodies tend to carry more health risk at the same weight: healthy only up to 22.9, overweight from 23, obese from 25.${stricter}`,
    });
  }

  if (healthyWeight) {
    const where =
      toHealthy && toHealthy > 0
        ? ` You are ${toHealthy} kg above it.`
        : toHealthy && toHealthy < 0
          ? ` You are ${Math.abs(toHealthy)} kg below it.`
          : toHealthy === 0
            ? ' You are within it.'
            : '';
    parts.push({
      title: 'Healthy weight',
      text:
        `For your height, a healthy weight is ${Math.round(healthyWeight.low)} to ${Math.round(healthyWeight.high)} kg ` +
        `(up to ${Math.round(healthyWeight.asianHigh)} kg by the stricter Asian scale).${where} ` +
        `Losing or gaining slowly — about half a kilo a week — is the change that lasts.`,
    });
  }

  if (bmr && dailyCalories) {
    parts.push({
      title: 'Calories a day',
      text:
        `Even lying in bed all day, your body uses about ${bmr.toLocaleString()} calories just to keep running — breathing, heartbeat, staying warm. ` +
        `Moving around adds to that: about ${dailyCalories.low.toLocaleString()} a day if you mostly sit, ` +
        `about ${dailyCalories.high.toLocaleString()} if you exercise 3–5 days a week.\n\n` +
        `Eat about that much to stay the same weight. Around 500 calories less each day loses roughly half a kilo a week.`,
    });
  }

  if (waistToHeight) {
    parts.push({
      title: 'Waist and height',
      text:
        `Your waist is ${waistToHeight.value.toFixed(2)} of your height. The simple rule: keep your waist under half your height (below 0.50). ` +
        `Fat around the belly is the most harmful kind — it is linked to diabetes and heart disease even when BMI looks fine.` +
        (waistToHeight.band === 'raised' || waistToHeight.band === 'high'
          ? ' Yours is above that line, so trimming the waist is worth more than the number on the scale.'
          : ''),
    });
  }

  if (b) {
    parts.push({
      title: 'Good to know',
      text:
        'BMI is a guide, not a diagnosis. It cannot tell muscle from fat, so very muscular people can show as overweight. It does not apply during pregnancy. If something here worries you, talk to your doctor.',
    });
  }

  return parts;
}
