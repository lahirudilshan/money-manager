import { describe, expect, it } from 'vitest';
import { CATALOG_SUBCATEGORY_BY_ID } from '../../data/categoryCatalog';
import {
  ageFrom,
  describePersona,
  lifeStageFrom,
  suggestedHouseCount,
  suggestedLines,
  type PersonaAnswers,
} from '../personas';

/**
 * Three onboarding answers have to do the work of a long questionnaire.
 *
 * The tests that matter are the ones proving each answer CHANGES the outcome —
 * a question whose answer makes no difference is a question not worth asking,
 * and onboarding must not feel like a form.
 */

const NOW = new Date('2026-08-04T00:00:00Z');

function answers(over: Partial<PersonaAnswers> = {}): PersonaAnswers {
  return { household: ['just_me'], transport: 'none', birthYear: 1991, ...over };
}

describe('every suggested line exists in the catalog', () => {
  /*
   * The silent failure this guards. A typo'd id is not an error anywhere — the
   * line simply never gets created, and onboarding quietly produces a plan
   * missing the very category the user's answer asked for.
   */
  const CASES: PersonaAnswers[] = [
    answers({ household: ['just_me'], transport: 'none', birthYear: 2004 }),
    answers({ household: ['kids', 'parents'], transport: 'car' }),
    answers({ household: ['partner'], transport: 'bike', birthYear: 1981 }),
    answers({ household: ['just_me'], transport: 'car', birthYear: 1971 }),
    answers({ birthYear: null }),
  ];

  for (const [index, input] of CASES.entries()) {
    it(`case ${index + 1} yields only real catalog ids`, () => {
      for (const id of suggestedLines(input)) {
        expect(CATALOG_SUBCATEGORY_BY_ID.has(id), `unknown catalog id: ${id}`).toBe(true);
      }
    });
  }
});

describe('each answer changes the plan', () => {
  it('kids add school, childcare and insurance', () => {
    const withKids = suggestedLines(answers({ household: ['kids'] }));
    const without = suggestedLines(answers({ household: ['just_me'] }));

    expect(withKids).toContain('school-fees');
    expect(withKids).toContain('childcare');
    expect(without).not.toContain('school-fees');
  });

  it('supporting parents adds the parent-support line', () => {
    // The line a second household's costs land on — see core/houses.ts.
    expect(suggestedLines(answers({ household: ['parents'] }))).toContain('parents');
    expect(suggestedLines(answers({ household: ['just_me'] }))).not.toContain('parents');
  });

  it('a car adds the whole vehicle group; no vehicle adds public transport', () => {
    const car = suggestedLines(answers({ transport: 'car' }));
    expect(car).toContain('fuel');
    expect(car).toContain('vehicle-insurance');
    expect(car).toContain('license');

    const none = suggestedLines(answers({ transport: 'none' }));
    expect(none).not.toContain('fuel');
    expect(none).toContain('public-transport');
  });

  it('a bike gets fuel but not the car-only paperwork', () => {
    const bike = suggestedLines(answers({ transport: 'bike' }));
    expect(bike).toContain('fuel');
    expect(bike).not.toContain('vehicle-insurance');
    expect(bike).not.toContain('license');
  });

  it('age shifts the savings emphasis', () => {
    const young = suggestedLines(answers({ birthYear: 2004 }));
    const older = suggestedLines(answers({ birthYear: 1971 }));

    expect(young).toContain('streaming');
    expect(young).not.toContain('retirement');
    expect(older).toContain('retirement');
    expect(older).toContain('investments');
  });

  it('combines several answers rather than picking one', () => {
    // The user's real situation: children AND parents AND a car. A
    // single-persona model would force them to choose.
    const combined = suggestedLines(answers({ household: ['kids', 'parents'], transport: 'car' }));

    expect(combined).toContain('school-fees');
    expect(combined).toContain('parents');
    expect(combined).toContain('fuel');
  });
});

describe('age handling', () => {
  it('computes whole years', () => {
    expect(ageFrom(1991, NOW)).toBe(35);
  });

  it('ignores an implausible year rather than skewing the plan', () => {
    // A 2-digit typo or a future year. A wrong age silently biasing every
    // default is worse than not using age at all.
    expect(ageFrom(91, NOW)).toBeNull();
    expect(ageFrom(2030, NOW)).toBeNull();
    expect(ageFrom(1800, NOW)).toBeNull();
  });

  it('treats a skipped birth year as unknown, not as zero', () => {
    expect(ageFrom(null, NOW)).toBeNull();
    expect(lifeStageFrom(null)).toBe('unknown');
  });

  it('still produces a usable plan with no birth year', () => {
    // Nothing may DEPEND on age — it only biases defaults.
    const lines = suggestedLines(answers({ birthYear: null }));
    expect(lines).toContain('salary');
    expect(lines).toContain('groceries');
    expect(lines.length).toBeGreaterThan(5);
  });
});

describe('houses', () => {
  it('implies a second house when supporting parents', () => {
    // Two houses is the threshold at which the house picker appears at all.
    expect(suggestedHouseCount(answers({ household: ['parents'] }))).toBe(2);
    expect(suggestedHouseCount(answers({ household: ['just_me'] }))).toBe(1);
  });
});

describe('describePersona', () => {
  it('reflects the answers back so they visibly mattered', () => {
    expect(describePersona(answers({ household: ['kids', 'parents'], transport: 'car' }))).toBe(
      'family with children, supporting parents, with a car',
    );
    expect(describePersona(answers({ household: ['just_me'], transport: 'none' }))).toBe(
      'single household',
    );
  });
});
