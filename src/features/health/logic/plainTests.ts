/**
 * Everyday names and one-line meanings for the lab tests people actually get
 * — "SGOT ( AST )" becomes "Liver enzyme (AST)", and a high one says why it
 * matters in words, not "This is above the normal range".
 *
 * Matched on the test's key AND its printed name, because labs print the same
 * test a dozen ways ("SGPT", "ALT (SGPT)", "Alanine aminotransferase").
 * The 16 measures with a full guide (measureGuide.ts) keep that guide's title;
 * this covers the rest of a typical full blood count, liver, kidney, lipid,
 * urine and vitamin panel.
 *
 * Meanings state the common, benign-first causes and never a diagnosis; the
 * screens pair each with "what to do".
 */

import { guideFor } from './measureGuide';

export interface PlainTest {
  name: string;
  high?: string;
  low?: string;
}

const TESTS: readonly { match: RegExp; test: PlainTest }[] = [
  // Urine first: "urine albumin" must not read as blood albumin.
  { match: /pus.?cell/, test: { name: 'Pus cells in urine', high: 'Can be a sign of a urine infection.' } },
  { match: /urine.*(protein|albumin)|(protein|albumin).*urine|microalbumin/, test: { name: 'Protein in urine', high: 'Can be an early sign of kidney strain.' } },
  { match: /urine.*(sugar|glucose)|(sugar|glucose).*urine/, test: { name: 'Sugar in urine', high: 'Usually means blood sugar is high.' } },
  { match: /\b(ast|sgot)\b|aspartate/, test: { name: 'Liver enzyme (AST)', high: 'Your liver may be under some stress. Common reasons: fatty liver, alcohol, some medicines, or hard exercise in the last few days.' } },
  { match: /\b(alt|sgpt)\b|alanine/, test: { name: 'Liver enzyme (ALT)', high: 'Your liver may be under some stress. Fatty liver is the most common reason.' } },
  { match: /\bggt\b|gamma.?glutamyl/, test: { name: 'Liver enzyme (GGT)', high: 'Often from alcohol, fatty liver or some medicines.' } },
  { match: /\balp\b|alkaline.?phosphatase/, test: { name: 'Liver and bone enzyme (ALP)', high: 'Can come from the liver or the bones. Your doctor can tell which.' } },
  { match: /bilirubin/, test: { name: 'Bilirubin (yellow pigment)', high: 'Too much can turn skin or eyes yellow. A little high is often harmless.' } },
  { match: /albumin(?!.*urine)|\balb\b/, test: { name: 'Albumin (blood protein)', low: 'Low protein in the blood. Can come from poor diet, or the liver or kidneys.' } },
  { match: /globulin/, test: { name: 'Globulin (blood protein)', high: 'Can rise with long-lasting infection or inflammation.', low: 'Can be low with some immune or liver problems.' } },
  { match: /eosinophil/, test: { name: 'Allergy cells (eosinophils)', high: 'Often from allergies, asthma, skin problems or worms.', low: 'Usually not a concern.' } },
  { match: /neutrophil/, test: { name: 'Infection-fighting cells (neutrophils)', high: 'Often a sign the body is fighting an infection.', low: 'Fewer infection-fighting cells. Can follow a virus or some medicines.' } },
  { match: /lymphocyte/, test: { name: 'Immune cells (lymphocytes)', high: 'Often during or after a viral infection.', low: 'Can drop during illness or stress.' } },
  { match: /monocyte/, test: { name: 'Immune cells (monocytes)', high: 'Often during or after an infection.', low: 'Usually not a concern.' } },
  { match: /basophil/, test: { name: 'Immune cells (basophils)', high: 'Can come with allergies.', low: 'Usually not a concern.' } },
  { match: /\b(wbc|tlc|white.?(blood)?.?cell|leu[ck]ocyte)/, test: { name: 'White blood cells', high: 'The body may be fighting an infection or inflammation.', low: 'Fewer white cells. The body may fight infections less well.' } },
  { match: /platelet|\bplt\b/, test: { name: 'Platelets (clotting cells)', high: 'Can come with infection, inflammation or low iron.', low: 'You may bruise or bleed more easily. Dengue can lower platelets — see a doctor if you have a fever.' } },
  { match: /\brbc\b|red.?(blood)?.?cell.?count|erythrocyte.?count/, test: { name: 'Red blood cells', high: 'Can come from not drinking enough water, smoking, or some lung problems.', low: 'Fewer red cells to carry oxygen — a sign of anaemia.' } },
  { match: /\b(pcv|hct)\b|haematocrit|hematocrit|packed.?cell/, test: { name: 'Red cell share (PCV)', high: 'Can come from not drinking enough water.', low: 'Less of your blood is red cells — a sign of anaemia.' } },
  { match: /\bmchc\b/, test: { name: 'Red cell colour (MCHC)', low: 'Pale red cells, often from low iron.', high: 'Usually not a concern on its own.' } },
  { match: /\bmch\b/, test: { name: 'Haemoglobin in each red cell (MCH)', low: 'Often from low iron, or a thalassaemia trait.', high: 'Often from low vitamin B12 or folate.' } },
  { match: /\bmcv\b/, test: { name: 'Red cell size (MCV)', low: 'Small red cells, often from low iron or a thalassaemia trait.', high: 'Large red cells, often from low vitamin B12 or folate, or alcohol.' } },
  { match: /\brdw\b/, test: { name: 'Red cell size mix (RDW)', high: 'Red cells of mixed sizes, often an early sign of low iron or B12.' } },
  { match: /\besr\b|sedimentation/, test: { name: 'ESR (swelling in the body)', high: 'Some inflammation in the body — from an infection, an injury or other causes.' } },
  { match: /\bcrp\b|c.?reactive/, test: { name: 'CRP (swelling in the body)', high: 'Some inflammation in the body, often from an infection.' } },
  { match: /\begfr\b|filtration/, test: { name: 'Kidney filter rate (eGFR)', low: 'Your kidneys are filtering less than normal.' } },
  { match: /\burea\b|\bbun\b/, test: { name: 'Urea (kidneys)', high: 'Can come from not drinking enough water, a high-protein diet, or the kidneys.', low: 'Usually not a concern.' } },
  { match: /uric/, test: { name: 'Uric acid', high: 'Too much can cause gout (painful joints) and kidney stones.' } },
  { match: /sodium|\bna\b/, test: { name: 'Sodium (salt balance)', high: 'Your body’s salt and water balance is off — often from not drinking enough.', low: 'Your body’s salt and water balance is off. Some medicines can cause it.' } },
  { match: /potassium|\bk\b/, test: { name: 'Potassium', high: 'Can affect your heartbeat. Your doctor should see this soon.', low: 'Can cause weakness, cramps or an uneven heartbeat.' } },
  { match: /vitamin.?d|25.?oh|vit.?d/, test: { name: 'Vitamin D', low: 'Can cause tiredness, weak bones and aching muscles.' } },
  { match: /b.?12|cobalamin/, test: { name: 'Vitamin B12', low: 'Can cause tiredness, pins and needles, and anaemia.' } },
  { match: /ferritin/, test: { name: 'Iron stores (ferritin)', low: 'Your body’s iron stores are low.', high: 'Can come with inflammation, or too much iron.' } },
  { match: /\bvldl\b/, test: { name: 'VLDL (blood fat)', high: 'A blood fat that rises with sugar, starch and alcohol.' } },
  { match: /non.?hdl/, test: { name: 'Non-HDL cholesterol', high: 'Cholesterol that can build up in your arteries.' } },
  { match: /(chol|tc).*hdl.*ratio|hdl.*ratio/, test: { name: 'Cholesterol ratio', high: 'A sign of higher heart risk.' } },
];

/** "fasting_blood_glucose", "SGOT ( AST )" → one lowercase haystack with spaces. */
function haystack(testKey: string, testName: string): string {
  return ` ${testKey} ${testName} `.toLowerCase().replace(/[_()\-/]/g, ' ').replace(/\s+/g, ' ');
}

export function plainTest(testKey: string, testName: string): PlainTest | null {
  const guide = guideFor(testKey);
  if (guide) return { name: guide.title };
  const text = haystack(testKey, testName);
  return TESTS.find((t) => t.match.test(text))?.test ?? null;
}

/** The everyday name, else the printed one tidied: "EOSINOPHIL" → "Eosinophil". */
export function plainName(testKey: string, testName: string, unit?: string | null): string {
  const known = plainTest(testKey, testName)?.name;
  if (known) {
    /*
     * A blood count prints most cell types twice — as a count and as a share
     * of all white cells. Same name twice reads as a duplicate, so say which.
     */
    if (!/cells/i.test(known)) return known;
    const text = haystack(testKey, testName);
    if (/%|percent/.test(`${text} ${unit ?? ''}`.toLowerCase())) return `${known} %`;
    if (/\b(absolute|abs|count)\b/.test(text) || /cu.?mm|µl|ul|10\^|x10|\/l/i.test(unit ?? '')) {
      return /white blood cells|red blood cells/i.test(known) ? known : `${known} count`;
    }
    return known;
  }
  const tidy = testName.replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')').trim();
  return tidy === tidy.toUpperCase() ? tidy.charAt(0) + tidy.slice(1).toLowerCase() : tidy;
}

/** What it means that this test is off, in one plain sentence — or null. */
export function plainMeaning(
  testKey: string,
  testName: string,
  direction: 'high' | 'low' | 'other',
): string | null {
  const test = plainTest(testKey, testName);
  if (!test) return null;
  return direction === 'low' ? (test.low ?? null) : direction === 'high' ? (test.high ?? null) : null;
}

/**
 * How far past the limit a value is, as a share of the limit: 0.05 = 5% over.
 * Null when there is no limit on that side to compare against.
 */
export function distancePastLimit(
  value: number | null,
  refLow: number | null,
  refHigh: number | null,
): number | null {
  if (value === null) return null;
  if (refHigh !== null && value > refHigh && refHigh > 0) return (value - refHigh) / refHigh;
  if (refLow !== null && value < refLow && refLow > 0) return (refLow - value) / refLow;
  return null;
}

/** Within 10% of the limit — "slightly", and nothing urgent. */
export const SLIGHT = 0.1;

/** "Platelets (clotting cells)" → "are"; "Liver enzyme (AST)" → "is". */
export function isOrAre(name: string): 'is' | 'are' {
  if (/ (count|%)$/.test(name)) return 'is';
  const head = name.split(/ \(| in /)[0].trim();
  return /s$/.test(head) && !/(ss|us|is)$/.test(head) ? 'are' : 'is';
}

const MINOR = 'Usually not a concern.';

/** A result that is off in a direction that rarely matters on its own (low eosinophils). */
export function isMinor(testKey: string, testName: string, direction: 'high' | 'low' | 'other'): boolean {
  return plainMeaning(testKey, testName, direction) === MINOR;
}

/** The first sentence of a longer text — "simple and short". */
export function firstSentence(text: string | null | undefined): string | null {
  if (!text) return null;
  // Never cut inside an inline glossary "[…]".
  const match = /^(?:[^[.!?]|\[[^\]]*\])*[.!?](?=\s|$)/.exec(text.trim());
  return (match ? match[0] : text.trim()) || null;
}

/**
 * What low and high mean for one test, one short sentence each: the guide for
 * the common measures, the everyday table for a standard panel, else the AI's
 * own words for this test cut to their first sentence.
 */
export function lowHighMeaning(
  testKey: string,
  testName: string,
  ai: { ifLow?: string | null; ifHigh?: string | null } = {},
): { low: string | null; high: string | null } {
  const guide = guideFor(testKey);
  if (guide) {
    const band = (status: 'low' | 'high') =>
      guide.bands.find((b) => b.status === status) ??
      (status === 'high' ? guide.bands.find((b) => b.status === 'borderline') : undefined);
    return {
      low: firstSentence(band('low')?.meaning),
      high: firstSentence(band('high')?.meaning),
    };
  }
  const test = plainTest(testKey, testName);
  return {
    low: test?.low ?? firstSentence(ai.ifLow),
    high: test?.high ?? firstSentence(ai.ifHigh),
  };
}

/** "536.00" → "536", "08" → "8", "6.50" → "6.5"; anything not a plain number is left as printed. */
export function tidyValue(valueText: string): string {
  const t = valueText.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? String(Number(t)) : t;
}
