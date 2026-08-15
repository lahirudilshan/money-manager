/**
 * Turn three onboarding answers into a starting plan.
 *
 * ## The design constraint
 *
 * Onboarding must not feel like a form. Every question has to visibly change
 * what the user gets, or it is not worth asking — so this file exists to make
 * three answers do the work of a twenty-field questionnaire, by INFERRING
 * everything else rather than asking for it.
 *
 * What is asked:
 *   1. Who you look after — the single biggest driver of what a plan contains.
 *   2. Whether you drive — decides a whole category (fuel, service, insurance,
 *      licence) that is pure noise for someone who does not.
 *   3. Birth year — one number, from which life stage is derived.
 *
 * What is NOT asked, and why:
 *   - income amount: step 3 already collects amounts, and asking twice is the
 *     definition of a boring form;
 *   - rent vs own: inferable enough from age to be a reasonable default the
 *     user can change, and wrong far less often than an extra question costs;
 *   - marital status, job, city: none of them change which categories a
 *     household needs.
 *
 * Pure functions over plain answers, so the whole mapping is testable without
 * running onboarding.
 */

/** Who the user financially supports. The strongest single signal. */
export type Household =
  /** One income, one person. */
  | 'just_me'
  /** Two adults, shared costs. */
  | 'partner'
  /** Dependent children — school, childcare, and a bigger grocery line. */
  | 'kids'
  /** Supporting parents, often in another house. See core/houses.ts. */
  | 'parents';

/** Whether a vehicle category is worth creating at all. */
export type Transport = 'car' | 'bike' | 'none';

/** The three answers, exactly as onboarding collects them. */
export interface PersonaAnswers {
  /** Multi-select: someone can support both kids and parents. */
  household: Household[];
  /**
   * Multi-select: a household can run a car AND a motorbike, which is common
   * enough here that forcing the choice made one of the two vehicles invisible
   * to the plan. `none` is exclusive — it is the ABSENCE of a vehicle — and is
   * what an empty selection collapses to.
   */
  transport: Transport[];
  /** Four-digit year. Null when the user skipped it — nothing depends on it. */
  birthYear: number | null;
}

/**
 * Life stage, derived from age.
 *
 * Used to bias DEFAULTS, never to gate anything: a 22-year-old can have a
 * housing loan and a 60-year-old can be paying school fees. It shifts which
 * lines are pre-ticked, which is a nudge the user overrides in one tap.
 *
 * The bands are deliberately coarse — precise ages would imply a confidence
 * this has no basis for.
 */
export type LifeStage = 'student' | 'early_career' | 'established' | 'pre_retirement' | 'unknown';

/** Age in whole years, or null when no birth year was given. */
export function ageFrom(birthYear: number | null, now = new Date()): number | null {
  if (birthYear === null || !Number.isFinite(birthYear)) return null;

  const age = now.getFullYear() - birthYear;

  // Anything outside this is a typo (a 4-digit year entered as 2 digits, a
  // future year), and a wrong age silently skewing the plan is worse than
  // simply not using it.
  return age >= 13 && age <= 110 ? age : null;
}

export function lifeStageFrom(age: number | null): LifeStage {
  if (age === null) return 'unknown';
  if (age < 24) return 'student';
  if (age < 35) return 'early_career';
  if (age < 50) return 'established';
  return 'pre_retirement';
}

/**
 * The catalog lines a set of answers should pre-tick.
 *
 * Returns catalog subcategory ids (see data/categoryCatalog.ts), so onboarding
 * step 2 opens with a sensible plan already selected and the user edits rather
 * than builds. Everything remains togglable — this is a starting point, not a
 * decision made for them.
 */
export function suggestedLines(answers: PersonaAnswers): string[] {
  const lines = new Set<string>([
    // True for everyone, regardless of every answer.
    'salary',
    'groceries',
    /*
     * Eating out, for everyone.
     *
     * It used to be suggested only to people who answered "partner", which
     * quietly assumed that living alone means cooking every meal — the
     * opposite is usually true, and a single person ordering delivery is the
     * clearest case of all. Everyone buys food they did not cook.
     *
     * Suggesting it is also what makes the split work at all: groceries and
     * eating out only tell you something when BOTH lines exist. Whoever has no
     * board line for restaurant food ends up filing it under Groceries, and
     * the home-vs-outside comparison the split exists for is lost.
     */
    'dining',
    'electricity',
    'water',
    'mobile',
    'emergency',
  ]);

  const age = ageFrom(answers.birthYear);
  const stage = lifeStageFrom(age);

  /*
   * Housing.
   *
   * Only rent is suggested. A housing loan used to be pre-ticked for the older
   * stages, but loans are collected properly in step 5 — with the lender, rate
   * and term an installment actually needs — and the catalog's Loans category is
   * no longer offered in step 2 at all. Suggesting a line the picker will not
   * show is a promise the next screen cannot keep.
   */
  lines.add('rent');

  // `dining` is suggested to everyone now — see the base set above.
  if (answers.household.includes('partner')) {
    lines.add('internet');
  }

  if (answers.household.includes('kids')) {
    lines.add('school-fees');
    lines.add('tuition');
    lines.add('childcare');
    lines.add('kids-extras');
    lines.add('health-insurance');
  }

  if (answers.household.includes('parents')) {
    /*
     * A parent's HOUSE, not a "support to parents" line.
     *
     * Supporting parents almost always means paying a second household's bills,
     * and that is what the houses dimension models — the line accumulates
     * whatever those bills came to instead of a guessed monthly figure. The old
     * `parents` catalog line has been removed for exactly that reason; see
     * data/categoryCatalog.ts and core/houses.ts.
     */
    lines.add('house-own');
    lines.add('house-parents');
    lines.add('medicine');
  }

  /*
   * Vehicles are additive — a car and a motorbike in the same household share
   * the fuel and service lines, and the Set collapses the overlap, so these are
   * independent checks rather than a chain of else-ifs.
   *
   * Public transport is added when NO vehicle is owned, which is the honest
   * reading of "Neither": someone with a car still takes the occasional taxi,
   * but it is not a line worth pre-ticking for them.
   */
  const hasCar = answers.transport.includes('car');
  const hasBike = answers.transport.includes('bike');

  if (hasCar || hasBike) {
    lines.add('fuel');
    lines.add('vehicle-service');
  }
  if (hasCar) {
    // Insurance and the revenue licence are legally required for a car and are
    // a big enough annual figure to plan for; a motorbike's are small enough
    // that pre-ticking them adds noise more often than it helps.
    lines.add('vehicle-insurance');
    lines.add('license');
  }
  if (!hasCar && !hasBike) {
    lines.add('public-transport');
  }

  /*
   * Age-led additions, kept to the ones that genuinely track life stage rather
   * than taste.
   */
  if (stage === 'student' || stage === 'early_career') {
    lines.add('streaming');
  }
  if (stage === 'established' || stage === 'pre_retirement') {
    lines.add('investments');
    lines.add('health-insurance');
  }
  if (stage === 'pre_retirement') {
    lines.add('retirement');
  }

  return [...lines];
}

/**
 * How many houses the answers imply.
 *
 * Supporting parents usually means a SECOND property whose bills the user
 * pays — which is exactly the case the houses dimension was built for, and the
 * threshold at which its picker becomes visible (see `shouldAskForHouse`).
 * Everyone else starts with one.
 */
export function suggestedHouseCount(answers: PersonaAnswers): number {
  return answers.household.includes('parents') ? 2 : 1;
}

/**
 * A short, human summary of what the answers produced.
 *
 * Shown immediately after the questions so the user sees their answers had an
 * effect — which is what makes three questions feel worthwhile rather than
 * like a form they filled in for nothing.
 */
export function describePersona(answers: PersonaAnswers): string {
  const parts: string[] = [];

  if (answers.household.includes('kids')) parts.push('family with children');
  else if (answers.household.includes('partner')) parts.push('two-adult household');
  else parts.push('single household');

  if (answers.household.includes('parents')) parts.push('supporting parents');

  const hasCar = answers.transport.includes('car');
  const hasBike = answers.transport.includes('bike');
  if (hasCar && hasBike) parts.push('with a car and a bike');
  else if (hasCar) parts.push('with a car');
  else if (hasBike) parts.push('with a bike');

  return parts.join(', ');
}
