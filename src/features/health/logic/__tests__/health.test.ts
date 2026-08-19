import { describe, expect, it } from 'vitest';
import {
  describeDaysAway,
  healthStory,
  formatReading,
  groupTimelineByDay,
  healthTimeline,
  trend,
  upcoming,
  type TimelineReading,
  type TimelineVisit,
} from '../health';

const at = (iso: string) => new Date(iso);

describe('healthTimeline', () => {
  const visit: TimelineVisit = {
    id: 'v1',
    personId: 'p1',
    visitedAt: at('2026-03-10T09:00:00'),
    kind: 'consultation',
    doctor: 'Dr Perera',
    facility: 'Nawaloka',
    diagnosis: 'Chest infection',
    costMinor: 350000,
  };

  it('merges every record type onto one axis, newest first', () => {
    const entries = healthTimeline({
      visits: [visit],
      documents: [
        {
          id: 'd1',
          personId: 'p1',
          title: 'X-ray report',
          kind: 'report',
          documentDate: at('2026-03-12T10:00:00'),
        },
      ],
      readings: [
        {
          id: 'r1',
          personId: 'p1',
          metric: 'blood_pressure',
          value: 128,
          valueSecondary: 84,
          unit: 'mmHg',
          measuredAt: at('2026-03-11T08:00:00'),
        },
      ],
    });

    expect(entries.map((entry) => entry.kind)).toEqual(['document', 'reading', 'visit']);
    expect(entries[0]!.title).toBe('X-ray report');
  });

  it('prefers the diagnosis as a visit title, falling back to the reason', () => {
    const [withDiagnosis] = healthTimeline({ visits: [visit] });
    expect(withDiagnosis!.title).toBe('Chest infection');
    expect(withDiagnosis!.detail).toBe('Dr Perera · Nawaloka');

    const [withReason] = healthTimeline({
      visits: [{ ...visit, diagnosis: null, reason: 'Persistent cough' }],
    });
    expect(withReason!.title).toBe('Persistent cough');
  });

  it('puts a prescription on the timeline at the date it started', () => {
    const [entry] = healthTimeline({
      medicines: [
        {
          id: 'm1',
          personId: 'p1',
          name: 'Amlodipine',
          dosage: '5 mg',
          instructions: 'One at night',
          startedOn: at('2026-03-10T09:00:00'),
        },
      ],
    });

    expect(entry!.kind).toBe('medicine');
    expect(entry!.title).toBe('Amlodipine');
    // Dose and instructions together — what you would read off the label.
    expect(entry!.detail).toBe('5 mg · One at night');
  });

  it('shows what a report SAYS, not what kind of file it is', () => {
    const [entry] = healthTimeline({
      documents: [
        {
          id: 'd1',
          personId: 'p1',
          title: 'Lipid profile',
          kind: 'report',
          summary: 'Cholesterol slightly high',
          documentDate: at('2026-03-12T10:00:00'),
        },
      ],
    });

    // The detail line used to be the raw enum ("report"), which restated the
    // icon beside it and told the reader nothing.
    expect(entry!.detail).toBe('Cholesterol slightly high');
    // The kind travels separately so the row can badge it properly.
    expect(entry!.documentKind).toBe('report');
  });

  it('leaves the detail empty when a report has no summary', () => {
    const [entry] = healthTimeline({
      documents: [
        {
          id: 'd1',
          personId: 'p1',
          title: 'Scan',
          kind: 'scan',
          summary: '   ',
          documentDate: at('2026-03-12T10:00:00'),
        },
      ],
    });

    // Whitespace is not a summary — the row shows the badge alone rather than
    // an empty gap where text should be.
    expect(entry!.detail).toBeUndefined();
  });

  it('interleaves prescriptions with visits by date', () => {
    const entries = healthTimeline({
      visits: [visit],
      medicines: [
        {
          id: 'm1',
          personId: 'p1',
          name: 'Amlodipine',
          startedOn: at('2026-03-11T09:00:00'),
        },
      ],
    });

    // The prescription is a day later, so it leads.
    expect(entries.map((entry) => entry.kind)).toEqual(['medicine', 'visit']);
  });
});

describe('groupTimelineByDay', () => {
  it('buckets entries under midnight-local headers, newest day first', () => {
    const days = groupTimelineByDay(
      healthTimeline({
        readings: [
          { id: 'r1', personId: 'p1', metric: 'weight', value: 70, measuredAt: at('2026-03-10T08:00:00') },
          { id: 'r2', personId: 'p1', metric: 'weight', value: 71, measuredAt: at('2026-03-10T20:00:00') },
          { id: 'r3', personId: 'p1', metric: 'weight', value: 72, measuredAt: at('2026-03-12T08:00:00') },
        ],
      }),
    );

    expect(days).toHaveLength(2);
    expect(days[0]!.date.getDate()).toBe(12);
    expect(days[1]!.entries).toHaveLength(2);
    expect(days[0]!.date.getHours()).toBe(0);
  });
});

describe('trend', () => {
  const readings: TimelineReading[] = [
    { id: 'r1', personId: 'p1', metric: 'blood_sugar', value: 110, measuredAt: at('2026-03-01T08:00:00'), context: 'fasting' },
    { id: 'r2', personId: 'p1', metric: 'blood_sugar', value: 180, measuredAt: at('2026-03-02T14:00:00'), context: 'post_meal' },
    { id: 'r3', personId: 'p1', metric: 'blood_sugar', value: 120, measuredAt: at('2026-03-03T08:00:00'), context: 'fasting' },
    { id: 'r4', personId: 'p1', metric: 'weight', value: 70, measuredAt: at('2026-03-03T08:00:00') },
  ];

  it('filters by metric and plots oldest first', () => {
    const result = trend(readings, { metric: 'blood_sugar' });

    expect(result.points).toHaveLength(3);
    expect(result.points[0]!.value).toBe(110);
    expect(result.latest!.value).toBe(120);
  });

  it('separates contexts, because fasting and post-meal are different measurements', () => {
    const result = trend(readings, { metric: 'blood_sugar', context: 'fasting' });

    expect(result.points).toHaveLength(2);
    expect(result.average).toBe(115);
    expect(result.change).toBe(10);
    expect(result.direction).toBe('up');
  });

  it('reports no direction for a single reading', () => {
    const result = trend(readings, { metric: 'weight' });

    expect(result.points).toHaveLength(1);
    expect(result.change).toBeNull();
    expect(result.direction).toBeNull();
  });

  it('is empty-safe', () => {
    const result = trend([], { metric: 'weight' });

    expect(result.points).toEqual([]);
    expect(result.latest).toBeNull();
    expect(result.average).toBeNull();
  });
});

describe('formatReading', () => {
  it('pairs blood pressure and drops trailing zeros', () => {
    expect(
      formatReading({ metric: 'blood_pressure', value: 120, valueSecondary: 80, unit: 'mmHg' }),
    ).toBe('120/80 mmHg');
    expect(formatReading({ metric: 'weight', value: 70.5, valueSecondary: null, unit: 'kg' })).toBe(
      '70.5 kg',
    );
    expect(formatReading({ metric: 'other', value: 5, valueSecondary: null, unit: null })).toBe('5');
  });
});

describe('upcoming', () => {
  const now = at('2026-03-10T12:00:00');

  const visit = (id: string, followUpOn: Date | null): TimelineVisit & { followUpOn: Date | null } => ({
    id,
    personId: 'p1',
    visitedAt: at('2026-03-01T09:00:00'),
    kind: 'consultation',
    doctor: 'Dr Perera',
    followUpOn,
  });

  it('lists follow-ups soonest first and skips visits without one', () => {
    const items = upcoming(
      [visit('v1', at('2026-03-20T09:00:00')), visit('v2', at('2026-03-14T09:00:00')), visit('v3', null)],
      now,
    );

    expect(items.map((item) => item.refId)).toEqual(['v2', 'v1']);
    expect(items[0]!.daysAway).toBe(4);
  });

  it('keeps a recently overdue follow-up, which matters more than an upcoming one', () => {
    const items = upcoming([visit('v1', at('2026-03-05T09:00:00'))], now);

    expect(items).toHaveLength(1);
    expect(items[0]!.daysAway).toBe(-5);
  });

  it('drops follow-ups long past or beyond the horizon', () => {
    const items = upcoming(
      [visit('v1', at('2026-01-01T09:00:00')), visit('v2', at('2027-01-01T09:00:00'))],
      now,
    );

    expect(items).toEqual([]);
  });
});

describe('describeDaysAway', () => {
  it('reads naturally either side of today', () => {
    expect(describeDaysAway(0)).toBe('Today');
    expect(describeDaysAway(1)).toBe('Tomorrow');
    expect(describeDaysAway(-1)).toBe('Yesterday');
    expect(describeDaysAway(-5)).toBe('5 days ago');
    expect(describeDaysAway(3)).toBe('In 3 days');
    expect(describeDaysAway(21)).toBe('In 3 weeks');
  });
});

describe('healthStory', () => {
  const visit: TimelineVisit = {
    id: 'v1',
    personId: 'p1',
    visitedAt: at('2026-03-10T09:00:00'),
    kind: 'consultation',
    doctor: 'Dr Perera',
    diagnosis: 'Hypertension',
  };

  const homeReading = (id: string, day: string, value: number) => ({
    id,
    personId: 'p1',
    metric: 'blood_pressure',
    value,
    valueSecondary: 80,
    unit: 'mmHg',
    measuredAt: at(`2026-03-${day}T08:00:00`),
    visitId: null,
  });

  it('folds a consultation and everything it produced into one episode', () => {
    const blocks = healthStory(
      healthTimeline({
        visits: [visit],
        medicines: [
          {
            id: 'm1',
            personId: 'p1',
            name: 'Amlodipine',
            startedOn: at('2026-03-10T09:00:00'),
            visitId: 'v1',
          },
        ],
        documents: [
          {
            id: 'd1',
            personId: 'p1',
            title: 'Lipid profile',
            kind: 'report',
            documentDate: at('2026-03-14T10:00:00'),
            visitId: 'v1',
          },
        ],
      }),
    );

    expect(blocks).toHaveLength(1);
    const episode = blocks[0]!;
    expect(episode.kind).toBe('episode');
    if (episode.kind !== 'episode') throw new Error('expected an episode');
    expect(episode.records).toHaveLength(2);
    // The episode sits at the CONSULTATION's date, not the later report's —
    // otherwise it would float out of sequence with what surrounds it.
    expect(episode.at).toEqual(visit.visitedAt);
  });

  it('collapses a run of routine readings into one block', () => {
    const blocks = healthStory(
      healthTimeline({
        readings: [
          homeReading('r1', '02', 148),
          homeReading('r2', '04', 140),
          homeReading('r3', '06', 132),
          homeReading('r4', '08', 129),
        ],
      }),
    );

    expect(blocks).toHaveLength(1);
    const run = blocks[0]!;
    if (run.kind !== 'readings') throw new Error('expected a readings run');
    expect(run.entries).toHaveLength(4);
    // Oldest first, so "first → latest" reads in the direction of time.
    expect(run.entries[0]!.title).toContain('148');
    expect(run.entries[3]!.title).toContain('129');
  });

  it('leaves one or two readings as their own rows', () => {
    const blocks = healthStory(
      healthTimeline({ readings: [homeReading('r1', '02', 148), homeReading('r2', '04', 140)] }),
    );

    // Two is not a run worth hiding — collapsing costs more than it saves.
    expect(blocks.every((block) => block.kind === 'single')).toBe(true);
    expect(blocks).toHaveLength(2);
  });

  it('does not merge readings of different metrics into one run', () => {
    const blocks = healthStory(
      healthTimeline({
        readings: [
          homeReading('r1', '02', 148),
          homeReading('r2', '04', 140),
          homeReading('r3', '06', 132),
          { ...homeReading('w1', '07', 70), metric: 'weight', valueSecondary: null },
        ],
      }),
    );

    const runs = blocks.filter((b) => b.kind === 'readings');
    expect(runs).toHaveLength(1);
    expect(blocks.filter((b) => b.kind === 'single')).toHaveLength(1);
  });

  it('keeps a record whose visit is missing rather than losing it', () => {
    // A dangling visitId must not swallow the row — deleting a visit sets the
    // link null in the database, but a stale in-memory list must be safe too.
    const blocks = healthStory(
      healthTimeline({
        documents: [
          {
            id: 'd1',
            personId: 'p1',
            title: 'Orphan report',
            kind: 'report',
            documentDate: at('2026-03-12T10:00:00'),
            visitId: 'gone',
          },
        ],
      }),
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('single');
  });

  it('breaks a reading run where a visit interrupts it', () => {
    const blocks = healthStory(
      healthTimeline({
        visits: [{ ...visit, visitedAt: at('2026-03-05T09:00:00') }],
        readings: [
          homeReading('r1', '02', 150),
          homeReading('r2', '03', 148),
          homeReading('r3', '04', 146),
          homeReading('r4', '07', 132),
          homeReading('r5', '08', 130),
          homeReading('r6', '09', 129),
        ],
      }),
    );

    // Before and after a consultation are different stretches, so the run is
    // split rather than spanning the visit.
    expect(blocks.filter((b) => b.kind === 'readings')).toHaveLength(2);
    expect(blocks.filter((b) => b.kind === 'episode')).toHaveLength(1);
  });
});
