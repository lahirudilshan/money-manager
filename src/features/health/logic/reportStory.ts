/**
 * What the reports really say, in simple English — the top of the health
 * home, for someone who has never read a lab report.
 *
 *   "Your blood sugar and cholesterol need work. Your other 12 results are normal."
 *
 *   NEEDS WORK
 *     ↑ Blood sugar is high — 142. It should be under 100.
 *       There is too much sugar in your blood.
 *       What to do: Eat less sugar and rice, and walk every day.
 *   GOOD NEWS
 *     ✓ Kidneys are working well
 *     ✓ Blood count is normal
 *
 * Built offline from the numbers and the measure guide, not from the AI's
 * prose: the same results always read the same way, and every sentence is
 * one a 12-year-old can follow.
 */

import { isOutOfRange, type LabStatusKey } from './labReports';
import { adviceFor } from './measureGuide';
import { normalRangeText } from './healthMetrics';
import { guideFor } from './measureGuide';
import { distancePastLimit, isMinor, isOrAre, plainMeaning, plainName, SLIGHT, tidyValue } from './plainTests';

export interface StorySeries {
  testKey: string;
  testName: string;
  category: string;
  latest: {
    status: LabStatusKey;
    value: number | null;
    valueText: string;
    unit: string | null;
    refLow: number | null;
    refHigh: number | null;
    measuredAt: Date;
  };
}

export interface NeedsWork {
  testKey: string;
  /** "Fasting blood sugar is high" */
  title: string;
  direction: 'high' | 'low' | 'other';
  /** Within 10% of the limit — nothing urgent. */
  slight: boolean;
  /** "142 mg/dL. It should be 70–99." */
  numbers: string;
  /** One plain sentence on what it means. */
  meaning: string | null;
  /** For drawing where it sits: below, inside or above normal. */
  value: number | null;
  refLow: number | null;
  refHigh: number | null;
  status: LabStatusKey;
  todo: string;
}

export interface AreaStatus {
  /** The lab category — "Blood count". */
  category: string;
  total: number;
  off: number;
}

export interface ReportStory {
  headline: string;
  /** Every body area tested, ones with something off first. */
  areas: AreaStatus[];
  needsWork: NeedsWork[];
  /** "Kidneys are working well" — one line per body area that is all normal. */
  goodNews: string[];
  /** The newest result's date — "from your results up to 3 Oct". */
  upTo: Date | null;
}

/** Plain short names, for the headline: "blood sugar", not "HbA1c (3-month sugar)". */
const PLAIN_TOPIC: Record<string, string> = {
  'Blood sugar': 'blood sugar',
  'Cholesterol & fats': 'cholesterol',
  Kidney: 'kidneys',
  Liver: 'liver',
  'Blood count': 'blood count',
  Thyroid: 'thyroid',
  'Vitamins & minerals': 'vitamins',
  Heart: 'heart',
  Urine: 'urine',
  'Infection & inflammation': 'infection signs',
  Hormones: 'hormones',
};

const GOOD_LINE: Record<string, string> = {
  'Blood sugar': 'Blood sugar is normal',
  'Cholesterol & fats': 'Cholesterol is normal',
  Kidney: 'Kidneys are working well',
  Liver: 'Liver is working well',
  'Blood count': 'Blood count is normal',
  Thyroid: 'Thyroid is working well',
  'Vitamins & minerals': 'Vitamins and minerals are normal',
  Heart: 'Heart and blood pressure are normal',
  Urine: 'Urine test is normal',
  'Infection & inflammation': 'No signs of infection',
  Hormones: 'Hormones are normal',
};

function topicFor(s: StorySeries): string {
  if (s.testKey === 'blood_pressure') return 'blood pressure';
  if (s.testKey === 'weight') return 'weight';
  return PLAIN_TOPIC[s.category] ?? s.testName.toLowerCase();
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The guide's normal band, when the lab printed no range: "below 5.7". */
function guideNormal(testKey: string): string | null {
  const band = guideFor(testKey)?.bands.find((b) => b.status === 'normal');
  return band ? band.range.charAt(0).toLowerCase() + band.range.slice(1) : null;
}

export function reportStory(series: readonly StorySeries[]): ReportStory {
  if (series.length === 0) return { headline: '', areas: [], needsWork: [], goodNews: [], upTo: null };

  /*
   * A high HDL is GOOD — it carries cholesterol away from the arteries
   * (higher is better, per the AHA). Labs still print it as above range, so
   * it is good news here, never "needs work".
   */
  const goodHigh = (s: StorySeries) => s.testKey === 'hdl_cholesterol' && s.latest.status === 'high';
  const off = series.filter((s) => isOutOfRange(s.latest.status) && !goodHigh(s));
  const normal = series.filter((s) => s.latest.status === 'normal' || goodHigh(s));

  /*
   * What matters most first: the measures with a full guide (sugar, pressure,
   * cholesterol, kidneys…), then other results, then ones that rarely matter
   * on their own (low eosinophils). Within each, furthest from normal first.
   */
  const weight = (s: StorySeries) => {
    if (guideFor(s.testKey)) return 2;
    const direction = s.latest.status === 'low' ? 'low' : 'high';
    return isMinor(s.testKey, s.testName, direction) ? 0 : 1;
  };
  const ranked = off
    .map((s) => ({ s, w: weight(s), past: distancePastLimit(s.latest.value, s.latest.refLow, s.latest.refHigh) }))
    .sort((a, b) => b.w - a.w || (b.past ?? 0.5) - (a.past ?? 0.5));

  const needsWork: NeedsWork[] = ranked.map(({ s, w, past }) => {
    const l = s.latest;
    const direction = l.status === 'low' ? 'low' : l.status === 'abnormal' ? 'other' : 'high';
    const slight = l.status === 'borderline' || (past !== null && past <= SLIGHT);
    const word =
      direction === 'other' ? 'not normal' : `${slight ? 'slightly ' : ''}${direction}`;
    const range =
      normalRangeText({ testKey: s.testKey, refLow: l.refLow, refHigh: l.refHigh }) ?? guideNormal(s.testKey);
    const value = `${tidyValue(l.valueText)}${l.unit ? ` ${l.unit}` : ''}`;
    const guided = guideFor(s.testKey) !== null;
    const name = plainName(s.testKey, s.testName, l.unit);
    const advice = adviceFor(s.testKey, l.status);
    return {
      testKey: s.testKey,
      title: `${name} ${isOrAre(name)} ${word}`,
      direction,
      slight,
      numbers: range ? `${value}. Normal is ${range}.` : `${value}.`,
      value: l.value,
      refLow: l.refLow,
      refHigh: l.refHigh,
      status: l.status,
      meaning: guided ? advice.meaning : plainMeaning(s.testKey, s.testName, direction),
      todo: guided
        ? advice.todo
        : w === 0
          ? 'Nothing to do on its own. Your doctor will read it with your other results.'
          : slight
            ? 'Nothing urgent. Mention it at your next check-up.'
            : advice.todo,
    };
  });

  // An area is good news only when NOTHING in it is off.
  const offAreas = new Set(off.map((s) => s.category));
  const goodNews = [
    ...new Set([
      ...series.filter(goodHigh).map(() => 'Good cholesterol (HDL) is high — that protects your heart'),
      ...normal
        .filter((s) => !offAreas.has(s.category))
        .filter((s) => !goodHigh(s))
        .map((s) => GOOD_LINE[s.category] ?? `${s.testName} is normal`),
    ]),
  ];

  const topics = [...new Set(ranked.map(({ s }) => topicFor(s)))];
  const others = series.length - off.length;
  const rest =
    others === 0 ? '' : others === 1 ? ' Your other result is normal.' : ` Your other ${others} results are normal.`;
  const allSlight = needsWork.every((n) => n.slight);
  const headline =
    off.length === 0
      ? series.length === 1
        ? 'Good news: your result is normal.'
        : `Good news: all ${series.length} of your results are normal.`
      : topics.length <= 3
        ? `${allSlight ? 'A few things are slightly off' : 'Some things need work'}: your ${joinWords(topics)}.${rest}`
        : `${topics.length} areas need work, mostly your ${joinWords(topics.slice(0, 2))}.${rest}`;

  const upTo = series.reduce<Date | null>(
    (latest, s) => (!latest || s.latest.measuredAt > latest ? s.latest.measuredAt : latest),
    null,
  );

  const areaMap = new Map<string, AreaStatus>();
  for (const s of series) {
    const area = areaMap.get(s.category) ?? { category: s.category, total: 0, off: 0 };
    area.total += 1;
    if (off.includes(s)) area.off += 1;
    areaMap.set(s.category, area);
  }
  const areas = [...areaMap.values()].sort((a, b) => b.off - a.off || b.total - a.total);

  return { headline, areas, needsWork, goodNews, upTo };
}
