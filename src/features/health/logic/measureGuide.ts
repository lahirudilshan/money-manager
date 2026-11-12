/**
 * What each level of a common measure means, in plain words — offline.
 *
 * ## Why this is written here, not asked of the AI
 *
 * "What does high blood pressure do?" has a standard answer that does not
 * change from person to person, so it belongs in the app: available offline,
 * instantly, identical every time, and reviewable in one file. The AI explains
 * a person's OWN report (see labReports.ts); this explains the measure.
 *
 * Ranges are the widely published adult reference figures — American Heart
 * Association for blood pressure, American Diabetes Association for sugar,
 * NCEP ATP III for cholesterol. Labs print their own ranges, which can differ
 * slightly; a lab result is always judged against the range on its paper.
 * Every screen showing this carries the see-your-doctor note.
 *
 * Pure data and lookup, so it is tested and has no React.
 */

import type { LabStatusKey } from './labReports';

export interface GuideBand {
  status: LabStatusKey;
  /** The band's name as people say it — "Elevated", "Prediabetes range". */
  name: string;
  /** The numbers, as text — "120–129 and below 80". */
  range: string;
  /** What being in this band means. */
  meaning: string;
  /** What it does to the body, and signs someone might notice. */
  effects: string;
  /** What to do about it, in one or two plain sentences anyone can follow. */
  todo: string;
}

export interface MeasureGuide {
  title: string;
  /** What the measure is, in one or two sentences. */
  what: string;
  unit: string;
  bands: GuideBand[];
  /** Everyday things that help keep it in range. */
  helps: string[];
  /** When not to wait for an appointment. */
  urgent?: string;
}

const GUIDES: Record<string, MeasureGuide> = {
  blood_pressure: {
    title: 'Blood pressure',
    what:
      'How hard your blood pushes on the walls of your arteries. The top number (systolic) is the push when your heart beats; the bottom number (diastolic) is the pressure between beats.',
    unit: 'mmHg',
    bands: [
      {
        status: 'low',
        name: 'Low',
        range: 'Below 90 / 60',
        meaning: 'Lower than usual. Often harmless if you feel well — some healthy people simply run low.',
        effects:
          'Can cause dizziness or light-headedness when standing up, blurred vision, tiredness, or fainting. Dehydration and some medicines can cause it.',
        todo: 'If you feel fine, nothing to do. If you feel dizzy, sit or lie down and drink water. If it keeps happening, see your doctor.',
      },
      {
        status: 'normal',
        name: 'Normal',
        range: 'Below 120 / 80',
        meaning: 'Healthy. Your heart and blood vessels are not under extra strain.',
        effects: 'No effect. Keep checking now and then.',
        todo: 'Nothing to do. Keep checking now and then.',
      },
      {
        status: 'borderline',
        name: 'Elevated',
        range: '120–129 / below 80',
        meaning: 'A little higher than ideal. Not high blood pressure yet, but likely to become it without changes.',
        effects: 'Usually no symptoms. This is the stage where lifestyle changes work best.',
        todo: 'Eat less salt and walk every day. Check again in a few weeks.',
      },
      {
        status: 'high',
        name: 'High',
        range: '130 / 80 and above',
        meaning:
          'High blood pressure (hypertension). Stage 1 is 130–139 or 80–89; stage 2 is 140 / 90 or more.',
        effects:
          'Usually no symptoms — which is why it is called the "silent killer". Over years it strains the heart, blood vessels, kidneys, eyes and brain, raising the risk of heart attack, stroke and kidney disease.',
        todo: 'Rest for 5 minutes and check again. If it is high on most days, see your doctor. Take your medicine as prescribed.',
      },
    ],
    helps: [
      'Less salt — packaged food, pickles and sauces carry the most.',
      'Regular walking or other activity, about 30 minutes most days.',
      'Keeping a healthy weight, limiting alcohol, not smoking.',
      'Measure at the same time of day, seated and rested for 5 minutes.',
    ],
    urgent:
      'Above 180 / 120, especially with chest pain, shortness of breath, a bad headache, weakness or trouble speaking: get emergency help.',
  },

  fasting_blood_glucose: {
    title: 'Fasting blood sugar',
    what:
      'The sugar (glucose) in your blood after not eating for at least 8 hours. It shows how well your body controls sugar on its own.',
    unit: 'mg/dL',
    bands: [
      {
        status: 'low',
        name: 'Low',
        range: 'Below 70',
        meaning: 'Low blood sugar (hypoglycaemia). Most common in people on diabetes medicine.',
        effects:
          'Shakiness, sweating, fast heartbeat, hunger, confusion or irritability. Very low levels can cause fainting. Eat or drink something sugary right away.',
        todo: 'Eat or drink something sweet now — juice, sugar or a sweet. Check again in 15 minutes. Tell your doctor if it happens often.',
      },
      {
        status: 'normal',
        name: 'Normal',
        range: '70–99',
        meaning: 'Healthy. Your body is handling sugar well.',
        effects: 'No effect.',
        todo: 'Nothing to do. Keep checking as your doctor advised.',
      },
      {
        status: 'borderline',
        name: 'Prediabetes range',
        range: '100–125',
        meaning: 'Higher than normal but not diabetes. A warning sign — and often reversible.',
        effects: 'Usually no symptoms. Without changes, many people move on to type 2 diabetes within a few years.',
        todo: 'Eat less sugar and rice, and walk every day. Check again in 3 months.',
      },
      {
        status: 'high',
        name: 'Diabetes range',
        range: '126 and above',
        meaning: 'In the diabetes range. A doctor confirms diabetes with a repeat test or HbA1c.',
        effects:
          'Can cause thirst, passing urine often, tiredness, blurred vision and slow-healing wounds. Over years, high sugar damages the eyes, kidneys, nerves, heart and blood vessels.',
        todo: 'See your doctor soon. Do not start or stop any medicine on your own.',
      },
    ],
    helps: [
      'Fewer sugary drinks and sweets; smaller portions of rice, bread and other starch.',
      'More vegetables, pulses and whole grains.',
      'A walk after meals — even 10–15 minutes lowers sugar.',
      'Losing even a little weight makes a real difference.',
    ],
    urgent:
      'Very high readings (over 300) with vomiting, confusion or heavy breathing, or a low you cannot bring up: get urgent help.',
  },

  post_meal_blood_glucose: {
    title: 'After-meal blood sugar',
    what: 'Blood sugar about 2 hours after starting a meal. Shows how well your body clears the sugar from food.',
    unit: 'mg/dL',
    bands: [
      {
        status: 'normal',
        name: 'Normal',
        range: 'Below 140',
        meaning: 'Healthy. Your body cleared the meal’s sugar well.',
        effects: 'No effect.',
        todo: 'Nothing to do.',
      },
      {
        status: 'borderline',
        name: 'Prediabetes range',
        range: '140–199',
        meaning: 'The body is slower than it should be at clearing sugar.',
        effects: 'Usually no symptoms. A sign to cut back on sugar and starch and move more.',
        todo: 'Eat smaller portions of rice and sweets, and walk after meals. Mention it to your doctor.',
      },
      {
        status: 'high',
        name: 'Diabetes range',
        range: '200 and above',
        meaning: 'In the diabetes range. Talk to your doctor.',
        effects: 'Thirst, frequent urination and tiredness are common. Long-term, damages eyes, kidneys, nerves and heart.',
        todo: 'See your doctor soon.',
      },
    ],
    helps: [
      'Smaller servings of rice, bread, noodles and sweets.',
      'Eat vegetables and protein first, starch last.',
      'A short walk after eating.',
    ],
  },

  random_blood_glucose: {
    title: 'Blood sugar',
    what: 'Blood sugar measured at any time, whatever you last ate.',
    unit: 'mg/dL',
    bands: [
      {
        status: 'low',
        name: 'Low',
        range: 'Below 70',
        meaning: 'Low blood sugar.',
        effects: 'Shakiness, sweating, hunger, confusion. Eat or drink something sugary right away.',
        todo: 'Eat or drink something sweet now — juice, sugar or a sweet. Check again in 15 minutes.',
      },
      {
        status: 'normal',
        name: 'Usual',
        range: '70–139',
        meaning: 'Within the usual range.',
        effects: 'No effect.',
        todo: 'Nothing to do.',
      },
      {
        status: 'borderline',
        name: 'Higher than usual',
        range: '140–199',
        meaning: 'Can be normal soon after a meal. Worth a fasting test to be sure.',
        effects: 'Usually none.',
        todo: 'Check again in the morning before breakfast to be sure.',
      },
      {
        status: 'high',
        name: 'High',
        range: '200 and above',
        meaning: 'High at any time of day — especially with thirst or weight loss — suggests diabetes.',
        effects: 'Thirst, frequent urination, tiredness, blurred vision.',
        todo: 'See your doctor soon, especially if you feel very thirsty or are losing weight.',
      },
    ],
    helps: ['For a clearer picture, check fasting (before breakfast) or 2 hours after a meal.'],
  },

  hba1c: {
    title: 'HbA1c (3-month sugar)',
    what:
      'Your average blood sugar over the last 2–3 months, as a percentage. One number that does not depend on what you ate today.',
    unit: '%',
    bands: [
      {
        status: 'normal',
        name: 'Normal',
        range: 'Below 5.7',
        meaning: 'Healthy average sugar.',
        effects: 'No effect.',
        todo: 'Nothing to do. Check again once a year.',
      },
      {
        status: 'borderline',
        name: 'Prediabetes range',
        range: '5.7–6.4',
        meaning: 'Average sugar is higher than it should be. Often reversible.',
        effects: 'Usually no symptoms, but the risk of diabetes and heart disease is higher.',
        todo: 'Eat less sugar and starch, and move more. Check again in 3 to 6 months.',
      },
      {
        status: 'high',
        name: 'Diabetes range',
        range: '6.5 and above',
        meaning:
          'In the diabetes range. For people already treated for diabetes, many doctors aim to keep it below about 7.',
        effects: 'The higher it stays, the greater the long-term damage to eyes, kidneys, nerves and heart.',
        todo: 'See your doctor. Check again every 3 months.',
      },
    ],
    helps: [
      'Small, steady changes in food and activity lower it over 3 months.',
      'Recheck every 3–6 months to see the trend.',
    ],
  },

  total_cholesterol: {
    title: 'Total cholesterol',
    what: 'All the cholesterol (a fatty substance) in your blood. The "good" and "bad" kinds together.',
    unit: 'mg/dL',
    bands: [
      { status: 'normal', name: 'Desirable', range: 'Below 200', meaning: 'Healthy level.', effects: 'No effect.', todo: 'Nothing to do. Check again every few years.' },
      {
        status: 'borderline',
        name: 'Borderline high',
        range: '200–239',
        meaning: 'A little high. Look at LDL and HDL for the full picture.',
        effects: 'No symptoms. Raises heart risk over time.',
        todo: 'Eat less fried and fatty food. Check again in 6 to 12 months.',
      },
      {
        status: 'high',
        name: 'High',
        range: '240 and above',
        meaning: 'High cholesterol.',
        effects:
          'No symptoms, but cholesterol builds up in artery walls over years, narrowing them — raising the risk of heart attack and stroke.',
        todo: 'Talk to your doctor at your next visit. Eat less fried and fatty food.',
      },
    ],
    helps: [
      'Less fried food, fatty meat, butter, ghee and coconut-milk-heavy dishes.',
      'More fibre: oats, pulses, vegetables, fruit.',
      'Regular exercise and a healthy weight.',
    ],
  },

  ldl_cholesterol: {
    title: 'LDL (“bad”) cholesterol',
    what: 'The kind of cholesterol that builds up in artery walls. Lower is better.',
    unit: 'mg/dL',
    bands: [
      { status: 'normal', name: 'Optimal', range: 'Below 100', meaning: 'Healthy.', effects: 'No effect.', todo: 'Nothing to do.' },
      {
        status: 'borderline',
        name: 'Near optimal to borderline',
        range: '100–159',
        meaning: 'Higher than ideal. How much it matters depends on your other risks.',
        effects: 'No symptoms; slowly adds to artery build-up.',
        todo: 'Eat less fried food and fatty meat, and move more.',
      },
      {
        status: 'high',
        name: 'High',
        range: '160 and above',
        meaning: 'High. Your doctor may suggest diet changes or medicine.',
        effects: 'Narrows arteries over years, raising heart attack and stroke risk. No symptoms until then.',
        todo: 'Talk to your doctor. You may need medicine.',
      },
    ],
    helps: ['Cut saturated fat (fatty meat, butter, fried food).', 'Eat more fibre and move more.'],
  },

  hdl_cholesterol: {
    title: 'HDL (“good”) cholesterol',
    what: 'The kind that carries cholesterol away from arteries. Higher is better.',
    unit: 'mg/dL',
    bands: [
      {
        status: 'low',
        name: 'Low',
        range: 'Below 40 (men) / 50 (women)',
        meaning: 'Lower than ideal — less protection for your heart.',
        effects: 'No symptoms; heart risk is higher.',
        todo: 'Exercise regularly and stop smoking — both raise it.',
      },
      {
        status: 'normal',
        name: 'Good',
        range: '40–59 (men) / 50–59 (women)',
        meaning: 'Healthy.',
        effects: 'No effect.',
        todo: 'Nothing to do.',
      },
      {
        status: 'normal',
        name: 'Protective',
        range: '60 and above',
        meaning: 'Very good — helps protect against heart disease.',
        effects: 'Protective.',
        todo: 'Nothing to do.',
      },
    ],
    helps: ['Regular exercise raises HDL.', 'Not smoking, and healthy fats (fish, nuts) help.'],
  },

  triglycerides: {
    title: 'Triglycerides',
    what: 'Fat in the blood from food, especially sugar, starch and alcohol.',
    unit: 'mg/dL',
    bands: [
      { status: 'normal', name: 'Normal', range: 'Below 150', meaning: 'Healthy.', effects: 'No effect.', todo: 'Nothing to do.' },
      {
        status: 'borderline',
        name: 'Borderline high',
        range: '150–199',
        meaning: 'A little high.',
        effects: 'No symptoms; adds to heart risk.',
        todo: 'Cut down on sugar, white rice and alcohol.',
      },
      {
        status: 'high',
        name: 'High',
        range: '200 and above',
        meaning: 'High. Very high levels (500+) can inflame the pancreas.',
        effects: 'Raises heart risk; very high levels can cause pancreatitis (severe stomach pain).',
        todo: 'Talk to your doctor. Cut down on sugar, white rice and alcohol.',
      },
    ],
    helps: ['Less sugar, sweets, white rice and alcohol.', 'Exercise and weight loss lower it quickly.'],
  },

  heart_rate: {
    title: 'Heart rate',
    what: 'How many times your heart beats in a minute, measured at rest.',
    unit: 'bpm',
    bands: [
      {
        status: 'low',
        name: 'Slow',
        range: 'Below 60',
        meaning: 'Slow heart rate. Normal for many fit people and during sleep.',
        effects: 'If you also feel dizzy, faint, short of breath or very tired, see a doctor.',
        todo: 'If you feel fine, nothing to do. If you feel dizzy or faint, see a doctor.',
      },
      { status: 'normal', name: 'Normal', range: '60–100', meaning: 'Healthy resting rate.', effects: 'No effect.', todo: 'Nothing to do.' },
      {
        status: 'high',
        name: 'Fast',
        range: 'Above 100',
        meaning: 'Fast at rest. Can come from fever, anxiety, caffeine, dehydration or a heart rhythm problem.',
        effects: 'Palpitations, breathlessness, dizziness. If it stays high at rest, see a doctor.',
        todo: 'Sit still for 5 minutes and check again. If it stays above 100 at rest, see a doctor.',
      },
    ],
    helps: ['Measure after sitting still for 5 minutes.', 'Regular exercise lowers resting heart rate over time.'],
    urgent: 'A racing heart with chest pain, fainting or severe breathlessness: get emergency help.',
  },

  oxygen: {
    title: 'Oxygen (SpO₂)',
    what: 'How much oxygen your blood is carrying, as a percentage.',
    unit: '%',
    bands: [
      {
        status: 'low',
        name: 'Low',
        range: 'Below 95',
        meaning: '90–94 is lower than ideal; below 90 is low and needs medical attention.',
        effects: 'Breathlessness, fast breathing, confusion, bluish lips.',
        todo: 'Warm your hand and check again. If it is still below 95, or you are short of breath, see a doctor today.',
      },
      { status: 'normal', name: 'Normal', range: '95–100', meaning: 'Healthy.', effects: 'No effect.', todo: 'Nothing to do.' },
    ],
    helps: ['Cold fingers or nail polish can give a falsely low reading — warm your hand and try again.'],
    urgent: 'Below 90, or any low reading with breathlessness or confusion: get urgent help.',
  },

  temperature: {
    title: 'Temperature',
    what: 'Your body temperature.',
    unit: '°C',
    bands: [
      {
        status: 'low',
        name: 'Low',
        range: 'Below 35',
        meaning: 'Too cold (hypothermia).',
        effects: 'Shivering, confusion, slow breathing. Warm up and get help.',
        todo: 'Get warm with blankets and warm drinks. If the person is confused or very sleepy, get help.',
      },
      { status: 'normal', name: 'Normal', range: '36.1–37.2', meaning: 'Healthy.', effects: 'No effect.', todo: 'Nothing to do.' },
      {
        status: 'borderline',
        name: 'Slightly raised',
        range: '37.3–37.9',
        meaning: 'A little warm — can be normal later in the day or after activity.',
        effects: 'Usually none.',
        todo: 'Rest and drink water. Check again later.',
      },
      {
        status: 'high',
        name: 'Fever',
        range: '38 and above',
        meaning: 'A fever — usually the body fighting an infection.',
        effects: 'Chills, aches, headache, tiredness. Rest and fluids help.',
        todo: 'Rest and drink plenty of water. See a doctor if it lasts more than 3 days.',
      },
    ],
    helps: ['Drink plenty of fluids and rest when feverish.'],
    urgent: '39.4 °C or higher, a fever lasting more than 3 days, or fever with a stiff neck, rash or confusion: see a doctor urgently.',
  },

  hemoglobin: {
    title: 'Haemoglobin',
    what: 'The part of red blood cells that carries oxygen around your body.',
    unit: 'g/dL',
    bands: [
      {
        status: 'low',
        name: 'Low (anaemia)',
        range: 'Below 13.5 (men) / 12 (women)',
        meaning: 'Anaemia — your blood carries less oxygen. Often from low iron.',
        effects: 'Tiredness, weakness, pale skin, breathlessness, dizziness, cold hands and feet.',
        todo: 'Eat iron-rich food and talk to your doctor — you may need iron tablets.',
      },
      {
        status: 'normal',
        name: 'Normal',
        range: '13.5–17.5 (men) / 12–15.5 (women)',
        meaning: 'Healthy.',
        effects: 'No effect.',
        todo: 'Nothing to do.',
      },
      {
        status: 'high',
        name: 'High',
        range: 'Above the normal range',
        meaning: 'Can come from dehydration, smoking, living at altitude, or lung or blood conditions.',
        effects: 'Often none; very high levels thicken the blood.',
        todo: 'Drink enough water and mention it to your doctor.',
      },
    ],
    helps: ['Iron-rich food: green leaves, pulses, meat, fish, eggs — with vitamin C (fruit) to absorb it.'],
  },

  serum_creatinine: {
    title: 'Creatinine (kidneys)',
    what: 'A waste product your kidneys filter out. It shows how well your kidneys are working.',
    unit: 'mg/dL',
    bands: [
      {
        status: 'low',
        name: 'Low',
        range: 'Below about 0.6',
        meaning: 'Usually not a concern — often from low muscle mass.',
        effects: 'None in itself.',
        todo: 'Usually nothing to do.',
      },
      {
        status: 'normal',
        name: 'Normal',
        range: 'About 0.7–1.3 (men) / 0.6–1.1 (women)',
        meaning: 'Kidneys are filtering well.',
        effects: 'No effect.',
        todo: 'Nothing to do.',
      },
      {
        status: 'high',
        name: 'High',
        range: 'Above the normal range',
        meaning: 'Kidneys may not be filtering as well as they should. Dehydration can raise it too.',
        effects: 'Often no early symptoms; later swelling, tiredness and changes in urine. Your doctor may check eGFR.',
        todo: 'Drink enough water and see your doctor. Avoid painkillers like ibuprofen unless your doctor says so.',
      },
    ],
    helps: [
      'Drink enough water.',
      'Keep blood pressure and sugar under control — the two main causes of kidney damage.',
      'Avoid regular painkillers like ibuprofen without advice.',
    ],
  },

  tsh: {
    title: 'TSH (thyroid)',
    what: 'A hormone that tells your thyroid gland how hard to work. The thyroid controls your energy and metabolism.',
    unit: 'mIU/L',
    bands: [
      {
        status: 'low',
        name: 'Low',
        range: 'Below about 0.4',
        meaning: 'May mean an overactive thyroid (hyperthyroidism).',
        effects: 'Weight loss, fast heartbeat, feeling hot, anxiety, shaky hands, poor sleep.',
        todo: 'See your doctor. They may do more thyroid tests.',
      },
      { status: 'normal', name: 'Normal', range: 'About 0.4–4.0', meaning: 'Thyroid is working normally.', effects: 'No effect.', todo: 'Nothing to do.' },
      {
        status: 'high',
        name: 'High',
        range: 'Above about 4.0',
        meaning: 'May mean an underactive thyroid (hypothyroidism).',
        effects: 'Tiredness, weight gain, feeling cold, dry skin, constipation, low mood.',
        todo: 'See your doctor. This is very treatable.',
      },
    ],
    helps: ['Thyroid problems are very treatable — your doctor may repeat the test or check T3/T4.'],
  },

  weight: {
    title: 'Weight',
    what:
      'Your body weight. On its own it says little — what matters is weight for your height (BMI) and the trend over time.',
    unit: 'kg',
    bands: [
      {
        status: 'low',
        name: 'Underweight',
        range: 'BMI below 18.5',
        meaning: 'Lower than healthy for your height.',
        effects: 'Low energy, weaker immunity, weaker bones.',
        todo: 'Eat regular, filling meals. Tell your doctor if you are losing weight without trying.',
      },
      { status: 'normal', name: 'Healthy', range: 'BMI 18.5–24.9', meaning: 'Healthy for your height.', effects: 'No effect.', todo: 'Nothing to do. Keep it steady.' },
      {
        status: 'borderline',
        name: 'Overweight',
        range: 'BMI 25–29.9',
        meaning: 'Above healthy for your height. (Many Asian guidelines use 23 as the start of this band.)',
        effects: 'Raises the risk of diabetes, high blood pressure and joint pain.',
        todo: 'Eat smaller portions and walk every day. Lose weight slowly.',
      },
      {
        status: 'high',
        name: 'Obese',
        range: 'BMI 30 and above',
        meaning: 'Well above healthy for your height.',
        effects: 'Strongly raises the risk of diabetes, heart disease, sleep apnoea and joint problems.',
        todo: 'Talk to your doctor about a plan. Small, steady changes work best.',
      },
    ],
    helps: ['BMI = weight (kg) ÷ height (m)². Slow, steady change lasts longest.'],
  },
};

/** The guide for a measure, by canonical key (see healthMetrics.ts), or null. */
export function guideFor(key: string): MeasureGuide | null {
  return GUIDES[key] ?? null;
}

/**
 * Which band a status falls in, for the "you are here" mark.
 *
 * By status, because the status is already worked out against the right
 * range (the lab's printed one, or the typical one for a home reading); the
 * band's numbers are shown for reference, not re-compared here.
 */
export function bandIndexFor(guide: MeasureGuide, status: LabStatusKey): number {
  if (status === 'unknown' || status === 'abnormal') return -1;
  const exact = guide.bands.findIndex((b) => b.status === status);
  if (exact !== -1) return exact;
  // A guide with no borderline band: borderline sits with high.
  if (status === 'borderline') return guide.bands.findIndex((b) => b.status === 'high');
  return -1;
}

/**
 * Plain words for one result: what it means and what to do — for screens
 * written for someone who has never read a lab report.
 *
 * The offline guide's band when the measure has one; otherwise the AI's own
 * "if high / if low" words for this test, and a safe generic next step. Never
 * a guessed diagnosis: without either, it only says which side of normal the
 * value is on and to ask the doctor.
 */
export interface PlainAdvice {
  /** "Normal", "High", "Prediabetes range" — the level's everyday name. */
  levelName: string;
  meaning: string | null;
  /** What it can do to the body. Null when normal or unknown. */
  effects: string | null;
  todo: string;
  /** When not to wait — only for a result that is off. */
  urgent: string | null;
}

export function adviceFor(
  key: string,
  status: LabStatusKey,
  ai: { ifHigh?: string | null; ifLow?: string | null } = {},
): PlainAdvice {
  const guide = guideFor(key);
  const off = status !== 'normal' && status !== 'unknown';
  const band = guide ? guide.bands[bandIndexFor(guide, status)] : undefined;
  if (guide && band) {
    return {
      levelName: band.name,
      meaning: band.meaning,
      effects: off ? band.effects : null,
      todo: band.todo,
      urgent: off ? (guide.urgent ?? null) : null,
    };
  }
  const aiEffect =
    status === 'high' || status === 'borderline'
      ? (ai.ifHigh ?? null)
      : status === 'low'
        ? (ai.ifLow ?? null)
        : null;
  return {
    levelName: GENERIC_NAME[status],
    meaning: GENERIC_MEANING[status],
    effects: aiEffect,
    todo: GENERIC_TODO[status],
    urgent: null,
  };
}

const GENERIC_NAME: Record<LabStatusKey, string> = {
  normal: 'Normal',
  high: 'High',
  low: 'Low',
  borderline: 'A little high',
  abnormal: 'Not normal',
  unknown: 'No range given',
};

const GENERIC_MEANING: Record<LabStatusKey, string> = {
  normal: 'This is in the normal range.',
  high: 'This is above the normal range.',
  low: 'This is below the normal range.',
  borderline: 'This is just above the normal range.',
  abnormal: 'The lab marked this as not normal.',
  unknown: 'The report did not say what is normal for this test.',
};

const GENERIC_TODO: Record<LabStatusKey, string> = {
  normal: 'Nothing to do.',
  high: 'Show this result to your doctor at your next visit.',
  low: 'Show this result to your doctor at your next visit.',
  borderline: 'Keep an eye on it and mention it at your next check-up.',
  abnormal: 'Show this result to your doctor soon.',
  unknown: 'Ask your doctor what this result means for you.',
};
