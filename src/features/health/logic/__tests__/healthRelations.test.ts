import { describe, expect, it } from 'vitest';
import {
  BLOOD_GROUPS,
  isBloodGroup,
  PERSON_RELATION_LABEL,
  PERSON_RELATIONS,
  relationLabel,
} from '~/db/schema';

/**
 * The relation list, and the label derived from it.
 *
 * The repository half of this — keeping `isSelf` in step with a `self` relation
 * — needs a live SQLite database and is covered by the SQL check in the build
 * verification rather than here, since these tests are pure.
 */
describe('person relations', () => {
  it('offers "Myself" first, because it is usually the first person added', () => {
    expect(PERSON_RELATIONS[0]).toBe('self');
    expect(PERSON_RELATION_LABEL.self).toBe('Myself');
  });

  it('names every option in the enum', () => {
    for (const relation of PERSON_RELATIONS) {
      expect(PERSON_RELATION_LABEL[relation]).toBeTruthy();
    }
  });

  it('includes an escape hatch for relations the list does not name', () => {
    expect(PERSON_RELATIONS).toContain('other');
  });
});

describe('blood groups', () => {
  it('offers exactly the eight real groups', () => {
    expect(BLOOD_GROUPS).toHaveLength(8);
    expect(BLOOD_GROUPS).toEqual(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
  });

  it('recognises a stored value that is one of them', () => {
    expect(isBloodGroup('O+')).toBe(true);
    expect(isBloodGroup('AB-')).toBe(true);
  });

  it('rejects the typos a free-text box used to allow', () => {
    // The reason this became a picker: "0+" is a zero, not the letter O.
    expect(isBloodGroup('0+')).toBe(false);
    expect(isBloodGroup('O+ve')).toBe(false);
    expect(isBloodGroup('o positive')).toBe(false);
  });

  it('treats an unset value as not a group, so the form shows nothing', () => {
    expect(isBloodGroup(null)).toBe(false);
    expect(isBloodGroup(undefined)).toBe(false);
    expect(isBloodGroup('')).toBe(false);
  });
});

describe('relationLabel', () => {
  it('reads the picked relation back as its label', () => {
    expect(relationLabel({ relation: 'mother', relationLabel: null })).toBe('Mother');
    expect(relationLabel({ relation: 'self', relationLabel: null })).toBe('Myself');
  });

  it("uses the user's own word for 'other'", () => {
    expect(relationLabel({ relation: 'other', relationLabel: 'Mother-in-law' })).toBe(
      'Mother-in-law',
    );
  });

  it('shows nothing rather than the word "Other" when no word was given', () => {
    // "Other" as a subtitle reads as a category the user chose, when in fact
    // they skipped the follow-up question.
    expect(relationLabel({ relation: 'other', relationLabel: null })).toBeNull();
    expect(relationLabel({ relation: 'other', relationLabel: '   ' })).toBeNull();
  });

  it('shows nothing when the relation was never set', () => {
    expect(relationLabel({ relation: null, relationLabel: null })).toBeNull();
  });
});
