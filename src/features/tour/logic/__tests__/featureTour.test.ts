import { describe, expect, it } from 'vitest';
import { MINI_APPS } from '~/shared/lib/miniApps';
import { TOUR } from '../featureTour';

describe('feature tour', () => {
  it('has a slide for every add-on — add one when you add an add-on', () => {
    const keys = new Set(TOUR.map((s) => s.key));
    const missing = MINI_APPS.map((app) => app.id).filter((id) => !keys.has(id));
    expect(missing).toEqual([]);
  });

  it('keeps every slide short enough to read at a glance', () => {
    for (const slide of TOUR) {
      expect(slide.title.length, slide.key).toBeLessThanOrEqual(24);
      expect(slide.line.length, slide.key).toBeLessThanOrEqual(70);
      expect(slide.example.length, slide.key).toBeLessThanOrEqual(45);
    }
  });

  it('has unique keys', () => {
    expect(new Set(TOUR.map((s) => s.key)).size).toBe(TOUR.length);
  });
});
