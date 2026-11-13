import { describe, expect, it } from 'vitest';
import {
  describeRate,
  drivingRate,
  maintenancePlan,
  scheduleFor,
  serviceMilestones,
  vehicleSchedule,
} from '../maintenance';
import { describeModel, modelScheduleForm, proposalsFrom } from '../modelSchedule';
import { readForm } from '~/features/ai/logic/aiForm';

const today = new Date(2026, 10, 13);

describe('vehicleSchedule', () => {
  it('applies a model interval, turns an item off and adds a custom one', () => {
    const { items, turnedOff } = vehicleSchedule('car', 'petrol', [
      { itemKey: 'engine_oil', everyKm: 10_000, everyMonths: 12, recommended: '0W-20, 3.4 L', applies: true, source: 'ai' },
      { itemKey: 'timing_belt', applies: false, source: 'ai' },
      { itemKey: 'custom:cvt_strainer', title: 'CVT strainer', everyKm: 60_000, applies: true, source: 'ai', group: 'drivetrain', action: 'replace' },
      { itemKey: 'custom:broken', title: 'No interval', applies: true, source: 'ai' },
    ]);
    const oil = items.find((i) => i.key === 'engine_oil')!;
    expect(oil.everyKm).toBe(10_000);
    expect(oil.firstKm).toBe(1_000); // still earlier than the new interval
    expect(oil.recommended).toBe('0W-20, 3.4 L');
    expect(turnedOff.has('timing_belt')).toBe(true);
    const custom = items.find((i) => i.key === 'custom:cvt_strainer')!;
    expect(custom).toMatchObject({ custom: true, group: 'drivetrain', action: 'replace' });
    expect(custom.match?.test('CVT strainer replaced')).toBe(true);
    expect(items.some((i) => i.key === 'custom:broken')).toBe(false);
  });

  it('shows a turned-off item as not applying', () => {
    const plan = maintenancePlan({
      vehicle: { kind: 'car', fuelType: 'petrol', condition: 'new', createdAt: today },
      marks: [],
      services: [],
      readings: [{ at: today, odometer: 500 }],
      overrides: [{ itemKey: 'timing_belt', applies: false, source: 'ai' }],
      today,
    });
    expect(plan.items.find((i) => i.item.key === 'timing_belt')?.status).toBe('not_applicable');
  });
});

describe('serviceMilestones', () => {
  it('groups what falls due into visits by odometer', () => {
    const plan = maintenancePlan({
      vehicle: { kind: 'car', fuelType: 'petrol', condition: 'new', acquiredOdometer: 0, createdAt: today, acquiredAt: today },
      marks: [{ itemKey: 'engine_oil', action: 'done', doneAt: today, odometer: 1_000 }],
      services: [],
      readings: [{ at: today, odometer: 1_200 }],
      today,
    });
    const [first] = serviceMilestones(plan, 'car');
    // Oil at 6,000 and the oil filter's first at 1,000 → the filter is due now.
    expect(first.atOdometer).toBeNull();
    expect(first.items.map((i) => i.item.key)).toContain('oil_filter');
    // A visit is labelled with the reading its first job is due at — the oil at
    // 6,000, not rounded on to 10,000 — and jobs 2,000 km apart are separate visits.
    const all = serviceMilestones(plan, 'car', 6);
    const oilVisit = all.find((m) => m.items.some((i) => i.item.key === 'engine_oil'));
    expect(oilVisit?.atOdometer).toBe(6_000);
    const rotation = all.find((m) => m.items.some((i) => i.item.key === 'tyre_rotation'));
    expect(rotation?.atOdometer).toBe(10_000);
  });
});

describe('model lookup proposals', () => {
  const items = scheduleFor('car', 'hybrid');

  it('lists only what would change, each with what it replaces', () => {
    const { values } = readForm(modelScheduleForm(items), {
      known: true,
      modelNote: 'Timing chain.',
      items: [
        { itemKey: 'engine_oil', applies: true, everyKm: 5_000, everyMonths: 6, recommended: '0W-20, 3.7 L' },
        { itemKey: 'brake_fluid', applies: true, everyKm: 40_000, everyMonths: 24, recommended: null },
        { itemKey: 'spark_plugs', applies: true, everyKm: 120_000, everyMonths: null, recommended: 'Denso iridium' },
        { itemKey: 'power_steering_fluid', applies: false },
        { itemKey: 'not_a_key', applies: true, everyKm: 1 },
      ],
      extras: [{ title: 'Inverter pump check', action: 'inspect', group: 'electrical', everyKm: 40_000, everyMonths: null, detail: 'x' }],
    });
    const proposals = proposalsFrom(values, items, 'km');
    const keys = proposals.map((p) => p.key);
    // brake_fluid matches the default and is left out; the unknown key is dropped.
    expect(keys).toEqual(['engine_oil', 'spark_plugs', 'power_steering_fluid', 'custom:inverter_pump_check']);
    expect(proposals[2]).toMatchObject({ type: 'off', override: { applies: false } });
    const oil = proposals[0];
    expect(oil.before).toBeNull(); // interval unchanged, spec added
    expect(oil.after).toBe('0W-20, 3.7 L');
    expect(proposals[1].before).toMatch(/100,000/);
    expect(proposals[3].type).toBe('add');
  });

  it('names a model for the lookup', () => {
    expect(describeModel({ make: 'Toyota', model: 'Aqua', year: 2015, engine: '1NZ-FXE', transmission: 'cvt' })).toBe(
      'Toyota Aqua 2015 · 1NZ-FXE · CVT',
    );
    expect(describeModel({ make: null, model: null, year: null, engine: null, transmission: null })).toBeNull();
  });
});

describe('milestone estimates', () => {
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

  it('takes the usual driving from the last year when that is long enough', () => {
    const rate = drivingRate([
      { at: daysAgo(900), odometer: 0 }, // years of slow driving
      { at: daysAgo(100), odometer: 10_000 },
      { at: today, odometer: 15_000 }, // 50 km a day lately
    ]);
    expect(rate?.perDay).toBe(50);
    expect(rate?.since.getTime()).toBe(daysAgo(100).getTime());
    expect(describeRate(rate!, 'km')).toBe('about 1,500 km a month');
  });

  it('says how long until each reading, and what the parts cost last time', () => {
    const plan = maintenancePlan({
      vehicle: { kind: 'car', fuelType: 'petrol', condition: 'new', acquiredOdometer: 0, createdAt: daysAgo(100), acquiredAt: daysAgo(100) },
      marks: [
        { itemKey: 'engine_oil', action: 'done', doneAt: daysAgo(40), odometer: 3_000 },
        { itemKey: 'oil_filter', action: 'done', doneAt: daysAgo(40), odometer: 3_000 },
      ],
      services: [],
      readings: [
        { at: daysAgo(100), odometer: 0 },
        { at: daysAgo(60), odometer: 2_000 },
        { at: today, odometer: 5_000 }, // 50 km a day throughout
      ],
      today,
    });
    const oilVisit = serviceMilestones(plan, 'car', 6, {
      today,
      lastCosts: new Map([['engine_oil', 1_200_000], ['oil_filter', 240_000]]),
    }).find((m) => m.items.some((i) => i.item.key === 'engine_oil'))!;
    // Oil last at 3,000 → due at 8,000: 3,000 km to go at 50 km a day = 60 days.
    expect(oilVisit.byDate).toBe(false);
    expect(oilVisit.atOdometer).toBe(8_000);
    expect(oilVisit.kmAway).toBe(3_000);
    expect(oilVisit.daysAway).toBe(60);
    // The filter (every 10,000) is not due until 13,000 — a later visit, priced there.
    expect(oilVisit.items.map((i) => i.item.key)).not.toContain('oil_filter');
    expect(oilVisit.estimateMinor).toBe(1_200_000);
    expect(oilVisit.pricedItems).toBe(1);
  });

  it('leaves the date out when there is not enough history', () => {
    const plan = maintenancePlan({
      vehicle: { kind: 'car', fuelType: 'petrol', condition: 'new', acquiredOdometer: 0, createdAt: today, acquiredAt: today },
      marks: [],
      services: [],
      readings: [{ at: today, odometer: 200 }],
      today,
    });
    const ahead = serviceMilestones(plan, 'car', 5, { today }).filter((m) => m.atOdometer != null && !m.byDate);
    expect(ahead.every((m) => m.daysAway === null)).toBe(true);
  });
});

describe('trustworthyReadings (real phone data)', () => {
  it('drops backfill clusters and a misdated purchase reading', () => {
    const d = (s: string) => new Date(s);
    const rate = drivingRate([
      { at: d('2026-08-04T19:42:00Z'), odometer: 28 }, // "bought" = day added to the app
      { at: d('2026-07-06T18:30:00Z'), odometer: 1_499 }, // oil change
      { at: d('2026-09-06T15:15:00Z'), odometer: 2_792 },
      { at: d('2026-09-06T15:17:00Z'), odometer: 2_878 }, // typed 2 minutes later
      { at: d('2026-10-27T19:08:00Z'), odometer: 3_427 },
      { at: d('2026-10-27T19:25:00Z'), odometer: 3_770 },
      { at: d('2026-10-27T19:26:00Z'), odometer: 3_940 },
      { at: d('2026-11-08T06:18:00Z'), odometer: 4_173 },
    ]);
    // From the oil change: 2,674 km in ~124.5 days ≈ 21.5 km a day (~650 a month).
    expect(rate?.since.toISOString()).toBe('2026-07-06T18:30:00.000Z');
    expect(Math.round(rate!.perDay * 10) / 10).toBe(21.5);
  });
});

describe('regular services (a vehicle serviced every N km)', () => {
  const d = (s: string) => new Date(s);
  const venue = (km: number, months: number | null = null) =>
    maintenancePlan({
      vehicle: {
        kind: 'car',
        fuelType: 'petrol',
        condition: 'new',
        acquiredOdometer: 28,
        acquiredAt: d('2026-06-01T00:00:00Z'),
        createdAt: d('2026-06-01T00:00:00Z'),
        serviceIntervalKm: km,
        serviceIntervalMonths: months,
      },
      marks: [
        { itemKey: 'engine_oil', action: 'done', doneAt: d('2026-07-06T18:30:00Z'), odometer: 1_499 },
        { itemKey: 'oil_filter', action: 'done', doneAt: d('2026-07-06T18:30:00Z'), odometer: 1_499 },
      ],
      services: [],
      readings: [
        { at: d('2026-09-25T19:00:00Z'), odometer: 3_250 },
        { at: d('2026-11-08T06:18:00Z'), odometer: 4_173 },
      ],
      today: d('2026-11-13T12:00:00Z'),
    });

  it('makes the oil follow the service interval', () => {
    const oil = venue(10_000).items.find((i) => i.item.key === 'engine_oil')!;
    expect(oil.item.everyKm).toBe(10_000);
    expect(oil.dueOdometer).toBe(11_499);
  });

  it('plans the 5,000 / 10,000 km services with the jobs for each', () => {
    const plan = venue(5_000);
    const ms = serviceMilestones(plan, 'car', 4, {
      today: d('2026-11-13T12:00:00Z'),
      service: { km: 5_000, months: null, last: null },
    });
    const services = ms.filter((m) => m.type === 'service');
    expect(services[0].atOdometer).toBe(5_000);
    expect(services[1].atOdometer).toBe(10_000);
    // Oil last at 1,499 → due 6,499: done at the 5,000 km service, not on a
    // separate trip — and never left until after it falls due.
    const keysAt5k = services[0].items.map((i) => i.item.key);
    expect(keysAt5k).toContain('engine_oil');
    for (const m of services) {
      for (const e of m.items) {
        if (e.dueOdometer != null) expect(m.atOdometer!).toBeLessThanOrEqual(e.dueOdometer + 500);
      }
    }
    // 827 km at ~650 km a month — about five weeks.
    expect(services[0].kmAway).toBe(827);
    expect(services[0].daysAway).toBeGreaterThan(25);
    expect(services[0].daysAway).toBeLessThan(50);
  });

  it('counts from the last service and caps by months', () => {
    const plan = venue(5_000, 6);
    const [first] = serviceMilestones(plan, 'car', 3, {
      today: d('2026-11-13T12:00:00Z'),
      service: { km: 5_000, months: 6, last: { odometer: 3_900, date: d('2026-05-20T00:00:00Z') } },
    }).filter((m) => m.type === 'service');
    expect(first.atOdometer).toBe(8_900);
    // Six months after 20 May comes before 4,700 km of driving.
    expect(first.byDate).toBe(true);
  });
});
