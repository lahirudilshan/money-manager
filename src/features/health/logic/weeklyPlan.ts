/**
 * A week of exercise and meals that works on everything the results say needs
 * work — at once, without one goal fighting another.
 *
 * ## Why rules, not AI
 *
 * A diet and exercise plan given to someone with high sugar or weak kidneys
 * must be right every time. So it is built here from published guidelines,
 * offline, the same for everyone with the same results, and reviewable in one
 * file — never generated:
 *
 *   - WHO Guidelines on physical activity and sedentary behaviour (2020):
 *     150–300 min of moderate activity a week, muscle-strengthening on 2+
 *     days, balance training on 3+ days from age 65.
 *   - WHO salt guidance: under 5 g of salt a day (about one teaspoon).
 *   - American Heart Association, 2021 Dietary Guidance to Improve
 *     Cardiovascular Health: whole grains, plants, fish, less saturated fat,
 *     less added sugar and salt.
 *   - NHLBI DASH eating plan, for blood pressure.
 *   - American Diabetes Association, Standards of Care in Diabetes — the plate
 *     method, no sugary drinks, a short walk after meals, not more than two
 *     days in a row without activity.
 *   - KDIGO 2024 CKD guideline: do NOT raise protein (about 0.8 g/kg/day),
 *     under 2 g sodium a day, no protein powders; potassium only as the
 *     doctor advises.
 *   - NIH Office of Dietary Supplements, iron: vitamin C helps the body take
 *     up iron from plants; tea and coffee with a meal reduce it.
 *
 * ## One plan for everything
 *
 * The meals are written once to suit every focus together — red rice and
 * millet in small portions, dhal and fish for protein, leafy greens daily,
 * little coconut milk, nothing fried, no added sugar — so the plan never has
 * to choose between sugar and cholesterol. What differs per result is a short
 * list of extra rules and cautions, and where two clash (more potassium helps
 * blood pressure but can harm weak kidneys) the safer one wins.
 *
 * Foods are everyday Sri Lankan dishes, because a plan of foods nobody in the
 * house cooks is a plan nobody follows.
 */

import { isOutOfRange, type LabStatusKey } from './labReports';

export type Focus =
  | 'sugar'
  | 'pressure'
  | 'cholesterol'
  | 'triglycerides'
  | 'weight'
  | 'anaemia'
  | 'kidney'
  | 'liver'
  | 'uric_acid'
  | 'thyroid'
  | 'vitamin_d';

/** What each focus is called on screen, in plain words. */
export const FOCUS_LABEL: Record<Focus, string> = {
  sugar: 'Blood sugar',
  pressure: 'Blood pressure',
  cholesterol: 'Cholesterol',
  triglycerides: 'Blood fats',
  weight: 'Weight',
  anaemia: 'Low blood (iron)',
  kidney: 'Kidneys',
  liver: 'Liver',
  uric_acid: 'Uric acid',
  thyroid: 'Thyroid',
  vitamin_d: 'Vitamin D',
};

export interface PlanSeries {
  testKey: string;
  category: string;
  latest: { status: LabStatusKey; value: number | null; valueSecondary: number | null };
}

export interface PlanInput {
  series: readonly PlanSeries[];
  age: number | null;
  /** Long-term conditions as typed on the profile — "Type 2 diabetes". */
  conditions: string | null;
  bmi: number | null;
}

/** Which focus a result belongs to, when it is off in a direction that matters. */
function focusFor(s: PlanSeries): Focus | null {
  const { testKey: key, category } = s;
  const status = s.latest.status;
  const high = status === 'high' || status === 'borderline' || status === 'abnormal';
  const low = status === 'low';
  if (/glucose|hba1c|sugar/.test(key) || category === 'Blood sugar') return high ? 'sugar' : null;
  if (key === 'blood_pressure') return high ? 'pressure' : null;
  if (key === 'triglycerides') return high ? 'triglycerides' : null;
  if (key === 'hdl_cholesterol') return low ? 'cholesterol' : null;
  if (/cholesterol|ldl|lipid/.test(key)) return high ? 'cholesterol' : null;
  if (key === 'weight') return high ? 'weight' : null;
  if (/^(hemoglobin|haemoglobin|ferritin|serum_iron|iron)$/.test(key)) return low ? 'anaemia' : null;
  if (/uric/.test(key)) return high ? 'uric_acid' : null;
  if (/creatinine|urea|egfr|bun/.test(key)) {
    // eGFR is the one kidney figure where LOW is the bad direction.
    return /egfr/.test(key) ? (low ? 'kidney' : null) : high ? 'kidney' : null;
  }
  if (category === 'Liver' || /(^|_)(alt|ast|sgpt|sgot|ggt)(_|$)/.test(key)) {
    return high ? 'liver' : null;
  }
  if (/tsh|t3|t4|thyro/.test(key)) return isOutOfRange(status) ? 'thyroid' : null;
  if (/vitamin_d|25_oh|vit_d/.test(key)) return low ? 'vitamin_d' : null;
  return null;
}

/** The focuses a person's results and known conditions call for, most urgent first. */
export function planFocus(input: PlanInput): Focus[] {
  const found = new Set<Focus>();
  for (const s of input.series) {
    const focus = focusFor(s);
    if (focus) found.add(focus);
  }
  const conditions = (input.conditions ?? '').toLowerCase();
  if (/diabet|sugar/.test(conditions)) found.add('sugar');
  if (/hypertens|pressure/.test(conditions)) found.add('pressure');
  if (/cholesterol|lipid/.test(conditions)) found.add('cholesterol');
  if (/kidney|renal|ckd/.test(conditions)) found.add('kidney');
  if (/anaemi|anemi/.test(conditions)) found.add('anaemia');
  if (/thyroid/.test(conditions)) found.add('thyroid');
  if (input.bmi !== null && input.bmi >= 25) found.add('weight');
  const order: Focus[] = [
    'kidney',
    'sugar',
    'pressure',
    'cholesterol',
    'triglycerides',
    'weight',
    'liver',
    'anaemia',
    'uric_acid',
    'thyroid',
    'vitamin_d',
  ];
  return order.filter((f) => found.has(f));
}

/*
 * ---------------------------------------------------------------------------
 * The plan
 * ---------------------------------------------------------------------------
 */

export interface Exercise {
  title: string;
  detail: string;
  /** Moderate-activity minutes this counts for. */
  minutes: number;
  kind: 'walk' | 'strength' | 'active' | 'rest';
}

export interface Meals {
  breakfast: string;
  lunch: string;
  dinner: string;
  snack: string;
}

export interface DayPlan {
  day: string;
  short: string;
  exercise: Exercise;
  /** Added for this person's results — "Walk 10–15 minutes after lunch and dinner". */
  extras: string[];
  meals: Meals;
}

export interface PlanRule {
  text: string;
  /** The result this rule is for; null for everyone. */
  focus: Focus | null;
}

export interface PlanCaution {
  text: string;
  /** 'stop' = see a doctor before starting at all. */
  level: 'stop' | 'care';
}

export interface PlanSource {
  title: string;
  org: string;
}

export interface WeeklyPlan {
  focus: Focus[];
  /** One plain sentence: what the week is for. */
  summary: string;
  weeklyMinutes: number;
  days: DayPlan[];
  /** The daily food rules, everyone's first, then per result. */
  rules: PlanRule[];
  /** What to cut down on or avoid. */
  avoid: string[];
  cautions: PlanCaution[];
  sources: PlanSource[];
}

const BRISK = 'Walk fast enough to breathe harder, but still able to talk.';
const STRENGTH =
  '2–3 rounds: 10 sit-to-stands from a chair, 10 push-ups against a wall, 10 step-ups on a stair, then hold a plank on your knees for 20 seconds.';

const EXERCISE_WEEK: readonly Exercise[] = [
  { title: 'Brisk walk · 30 min', detail: BRISK, minutes: 30, kind: 'walk' },
  { title: 'Strength · 20 min + walk 10 min', detail: STRENGTH, minutes: 10, kind: 'strength' },
  { title: 'Brisk walk · 30 min', detail: BRISK, minutes: 30, kind: 'walk' },
  {
    title: 'Brisk walk or cycle · 30 min',
    detail: 'Walking, cycling or swimming — anything that makes you breathe a little harder.',
    minutes: 30,
    kind: 'walk',
  },
  { title: 'Strength · 20 min + walk 10 min', detail: STRENGTH, minutes: 10, kind: 'strength' },
  {
    title: 'Longer easy walk · 40 min',
    detail: 'Or something you enjoy: a game, dancing, gardening, cleaning the house.',
    minutes: 40,
    kind: 'active',
  },
  {
    title: 'Rest day',
    detail: 'Gentle stretching for 10 minutes. Rest helps muscles grow stronger.',
    minutes: 0,
    kind: 'rest',
  },
];

/**
 * Seven days of meals that suit every focus together — see the header.
 * Portions are on the plate rule, not the dish: half vegetables, a quarter
 * protein, a quarter rice or other starch.
 */
const MEAL_WEEK: readonly Meals[] = [
  {
    breakfast: 'Oats cooked in water or low-fat milk, with a few nuts. No sugar.',
    lunch: 'Red rice (1 cup), dhal, gotukola mallum, fish curry with little coconut milk.',
    dinner: '2 whole-wheat rotti, vegetable curry and a boiled egg.',
    snack: 'A guava.',
  },
  {
    breakfast: 'Boiled green gram (mung) with onion sambol.',
    lunch: 'Red rice (1 cup), skinless chicken curry, beans curry, cucumber salad.',
    dinner: 'Red-flour string hoppers with dhal curry.',
    snack: 'Plain yoghurt, no sugar.',
  },
  {
    breakfast: 'Kurakkan (finger millet) roti with tomato and onion sambol.',
    lunch: 'Red rice (1 cup), sardine (salaya) curry, kankun or murunga leaves, pumpkin curry.',
    dinner: 'Vegetable soup with chickpeas and a slice of whole-grain bread.',
    snack: 'An orange.',
  },
  {
    breakfast: '2 boiled eggs, a slice of whole-grain bread and tomato.',
    lunch: 'Red rice (1 cup), dhal, leafy green mallum, soya meat curry.',
    dinner: 'Kola kenda (herbal porridge) made with red rice and gotukola.',
    snack: 'A small handful of unsalted peanuts.',
  },
  {
    breakfast: 'Boiled chickpeas (kadala) with onion and green chilli.',
    lunch: 'Red rice (1 cup), mackerel (kumbalawa) curry, okra curry, green salad.',
    dinner: '2 whole-wheat rotti with dhal and vegetables.',
    snack: 'A slice of papaya.',
  },
  {
    breakfast: 'Kurakkan or oats porridge with a few nuts. No sugar.',
    lunch: 'Red rice (1 cup), chicken curry, brinjal curry (not fried), green beans.',
    dinner: 'Vegetable omelette with a slice of whole-grain bread.',
    snack: 'An apple or guava.',
  },
  {
    breakfast: 'Red-flour string hoppers with dhal and a little pol sambol.',
    lunch: 'Red rice (1 cup), fish ambul thiyal, dhal, leafy salad.',
    dinner: 'Lentil and vegetable soup.',
    snack: 'Plain yoghurt, no sugar.',
  },
];

const DAYS = [
  ['Monday', 'Mon'],
  ['Tuesday', 'Tue'],
  ['Wednesday', 'Wed'],
  ['Thursday', 'Thu'],
  ['Friday', 'Fri'],
  ['Saturday', 'Sat'],
  ['Sunday', 'Sun'],
] as const;

const EVERYONE_RULES: readonly string[] = [
  'Fill half your plate with vegetables, a quarter with fish, dhal, egg or chicken, and a quarter with rice or roti.',
  'Choose red rice, kurakkan, oats or whole-wheat instead of white rice and white bread.',
  'Less than 1 teaspoon of salt a day in total — that includes what is already in food.',
  'Drink water. No sugar in tea or coffee.',
  'Cook with a little oil. Boil, steam or curry instead of deep-frying.',
];

const FOCUS_RULES: Record<Focus, readonly string[]> = {
  sugar: [
    'Keep rice to 1 cup at a meal (about the size of your fist).',
    'Eat vegetables and protein first, rice last — it slows the rise in sugar.',
    'Eat whole fruit, 1–2 a day. No fruit juice, soft drinks or sweets.',
  ],
  pressure: [
    'Avoid the saltiest foods: dried fish, pickles, papadam, instant noodles, sausages and packet snacks.',
    'Taste food before adding salt. Use lime, garlic, pepper and curry leaves for flavour.',
  ],
  cholesterol: [
    'Eat fish 2 times a week — sardines and mackerel are best.',
    'Have oats, dhal, beans or chickpeas every day; their fibre lowers cholesterol.',
    'Use coconut milk thinly and rarely. Choose skinless chicken over red meat.',
  ],
  triglycerides: [
    'Cut sugar, sweets and white rice — the body turns extra sugar into blood fat.',
    'No alcohol, or very little.',
  ],
  weight: [
    'Eat a little less at each meal — about 500 calories less a day loses about half a kilo a week.',
    'No snacks between meals other than the fruit or yoghurt in the plan.',
  ],
  anaemia: [
    'Eat iron foods daily: green leaves, dhal, chickpeas, fish, eggs.',
    'Have a vitamin C fruit (guava, orange, lime) with meals — it helps the body take in iron.',
    'Drink tea or coffee 1 hour before or after a meal, not with it.',
  ],
  kidney: [
    'Do NOT eat more protein than the plan shows, and take no protein powders.',
    'Keep salt very low.',
    'Ask your doctor how much water to drink, and whether to limit bananas, oranges or other high-potassium foods.',
  ],
  liver: ['No alcohol.', 'Cut sugar and fried food; losing extra weight helps the liver most.'],
  uric_acid: [
    'Drink plenty of water, unless your doctor limits it.',
    'Avoid liver and other organ meat, prawns and crab, beer, and sugary drinks.',
  ],
  thyroid: [
    'Food alone does not fix the thyroid — take any thyroid medicine exactly as prescribed.',
    'Take thyroid tablets on an empty stomach, 30–60 minutes before breakfast.',
  ],
  vitamin_d: [
    'Get 15–20 minutes of sunlight on your arms most days, outside the hottest hours.',
    'Eat eggs and oily fish. Ask your doctor whether you need a supplement.',
  ],
};

const FOCUS_AVOID: Record<Focus, readonly string[]> = {
  sugar: ['Soft drinks and fruit juice', 'Sweets, cakes and biscuits', 'Large plates of white rice'],
  pressure: ['Dried fish, pickles and papadam', 'Instant noodles and packet snacks'],
  cholesterol: ['Deep-fried food', 'Butter, ghee and fatty meat', 'Thick coconut-milk curries'],
  triglycerides: ['Alcohol', 'Sugar and sweets'],
  weight: ['Fried snacks (rolls, patties, vadai)', 'Second helpings'],
  anaemia: ['Tea or coffee with meals'],
  kidney: ['Protein powders and herbal remedies', 'Painkillers like ibuprofen, unless your doctor says'],
  liver: ['Alcohol'],
  uric_acid: ['Organ meat, prawns and crab', 'Beer'],
  thyroid: [],
  vitamin_d: [],
};

const SOURCES: Record<string, PlanSource> = {
  who_activity: { title: 'Guidelines on physical activity and sedentary behaviour (2020)', org: 'World Health Organization' },
  who_salt: { title: 'Salt reduction: under 5 g a day', org: 'World Health Organization' },
  aha: { title: '2021 Dietary Guidance to Improve Cardiovascular Health', org: 'American Heart Association' },
  dash: { title: 'DASH eating plan', org: 'US National Heart, Lung, and Blood Institute' },
  ada: { title: 'Standards of Care in Diabetes', org: 'American Diabetes Association' },
  kdigo: { title: 'Clinical Practice Guideline for Chronic Kidney Disease (2024)', org: 'KDIGO' },
  ods_iron: { title: 'Iron fact sheet', org: 'US National Institutes of Health' },
};

const FOCUS_SOURCES: Record<Focus, readonly string[]> = {
  sugar: ['ada'],
  pressure: ['dash'],
  cholesterol: ['aha'],
  triglycerides: ['aha'],
  weight: ['who_activity'],
  anaemia: ['ods_iron'],
  kidney: ['kdigo'],
  liver: [],
  uric_acid: [],
  thyroid: [],
  vitamin_d: [],
};

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export function buildWeeklyPlan(input: PlanInput): WeeklyPlan {
  const focus = planFocus(input);
  const has = (f: Focus) => focus.includes(f);
  const older = input.age !== null && input.age >= 65;

  const days: DayPlan[] = DAYS.map(([day, short], index) => {
    const extras: string[] = [];
    // ADA: a short walk after meals lowers the rise in sugar.
    if (has('sugar')) extras.push('Walk 10–15 minutes after lunch and after dinner.');
    // WHO 2020: balance training on 3+ days from 65.
    if (older && (index === 0 || index === 2 || index === 5)) {
      extras.push('Balance: stand on one leg holding a chair, 30 seconds each side, 3 times.');
    }
    return { day, short, exercise: EXERCISE_WEEK[index], extras, meals: MEAL_WEEK[index] };
  });

  const rules: PlanRule[] = [
    ...EVERYONE_RULES.map((text) => ({ text, focus: null })),
    ...focus.flatMap((f) => FOCUS_RULES[f].map((text) => ({ text, focus: f }))),
  ];
  // Kidneys win over blood pressure on potassium: no "eat more bananas" rule
  // exists anywhere, and the kidney rule says to ask.
  const avoid = [...new Set(focus.flatMap((f) => FOCUS_AVOID[f]))];

  const cautions: PlanCaution[] = [];
  const bp = input.series.find((s) => s.testKey === 'blood_pressure')?.latest;
  if (bp && bp.value !== null && (bp.value >= 180 || (bp.valueSecondary ?? 0) >= 110)) {
    cautions.push({
      level: 'stop',
      text: 'Your blood pressure was very high. See a doctor before you start any exercise.',
    });
  }
  const lowSugar = input.series.some(
    (s) => /glucose|sugar/.test(s.testKey) && s.latest.status === 'low',
  );
  if (has('sugar') || lowSugar) {
    cautions.push({
      level: 'care',
      text: 'If you take diabetes medicine or insulin, carry something sweet when you exercise, and check your sugar if you feel shaky or sweaty.',
    });
  }
  if (has('kidney')) {
    cautions.push({
      level: 'care',
      text: 'With weak kidneys, follow your doctor’s food advice first — it comes before this plan.',
    });
  }
  cautions.push({
    level: 'care',
    text: 'New to exercise? Start with 10 minutes and add 5 minutes each week.',
  });
  cautions.push({
    level: 'care',
    text: 'Stop and get help if you feel chest pain, very short of breath, or dizzy.',
  });
  cautions.push({
    level: 'care',
    text: 'If you have heart disease, kidney disease or take diabetes medicine, show this plan to your doctor before starting.',
  });

  const sourceKeys = new Set(['who_activity', 'who_salt', ...focus.flatMap((f) => FOCUS_SOURCES[f])]);
  if (!sourceKeys.has('aha')) sourceKeys.add('aha');

  const labels = focus.map((f) => FOCUS_LABEL[f].toLowerCase());
  const summary =
    focus.length === 0
      ? 'Your results are normal. This week keeps them that way.'
      : `A week to help your ${joinWords(labels)}.`;

  return {
    focus,
    summary,
    weeklyMinutes: EXERCISE_WEEK.reduce((n, e) => n + e.minutes, 0),
    days,
    rules,
    avoid,
    cautions,
    sources: [...sourceKeys].map((k) => SOURCES[k]),
  };
}

/** Monday = 0 … Sunday = 6, for picking today's day out of the plan. */
export function planDayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}
