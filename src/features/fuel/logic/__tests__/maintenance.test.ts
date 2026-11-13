import { describe, expect, it } from 'vitest';
import {
  dailyDistance,
  describeDue,
  maintenancePlan,
  newlyDue,
  scheduleFor,
  serviceCovers,
  type MaintenanceVehicle,
} from '../maintenance';

const today = new Date(2026, 10, 13);
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);

const car = (patch: Partial<MaintenanceVehicle> = {}): MaintenanceVehicle => ({
  kind: 'car',
  fuelType: 'hybrid',
  condition: 'new',
  acquiredOdometer: 10,
  acquiredAt: daysAgo(60),
  createdAt: daysAgo(60),
  ...patch,
});

const find = (plan: ReturnType<typeof maintenancePlan>, key: string) =>
  plan.items.find((i) => i.item.key === key)!;

describe('scheduleFor', () => {
  it('gives a hybrid its battery filter and no timing belt', () => {
    const keys = scheduleFor('car', 'hybrid').map((i) => i.key);
    expect(keys).toContain('hybrid_battery_filter');
    expect(keys).toContain('inverter_coolant');
    expect(keys).not.toContain('timing_belt');
  });

  it('gives an electric car no engine oil or spark plugs', () => {
    const keys = scheduleFor('car', 'electric').map((i) => i.key);
    expect(keys).not.toContain('engine_oil');
    expect(keys).not.toContain('spark_plugs');
    expect(keys).toContain('brake_fluid');
  });

  it('gives a bike a chain and a three-wheeler a gearbox oil', () => {
    expect(scheduleFor('bike', 'petrol').map((i) => i.key)).toContain('bike_chain');
    expect(scheduleFor('three_wheeler', 'petrol').map((i) => i.key)).toContain('transmission_fluid');
  });

  it('never lists one key twice for a vehicle', () => {
    for (const kind of ['car', 'van', 'bike', 'three_wheeler', 'other'] as const) {
      for (const fuel of ['petrol', 'diesel', 'hybrid', 'electric'] as const) {
        const keys = scheduleFor(kind, fuel).map((i) => i.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });
});

describe('serviceCovers', () => {
  const oil = scheduleFor('car', 'petrol').find((i) => i.key === 'engine_oil')!;
  const svc = (title: string, itemNames: string[] = []) => ({
    servicedAt: today,
    odometer: 1,
    title,
    itemNames,
  });

  it('recognises an oil change from the title or a bill line', () => {
    expect(serviceCovers(oil, svc('Oil change'))).toBe(true);
    expect(serviceCovers(oil, svc('Full service', ['5W-30 x4', 'Labour']))).toBe(true);
  });

  it('does not count gear oil or brake oil as engine oil', () => {
    expect(serviceCovers(oil, svc('Gear oil change'))).toBe(false);
    expect(serviceCovers(oil, svc('Repair', ['Brake oil']))).toBe(false);
  });

  it('does not count a cabin filter as the engine air filter', () => {
    const air = scheduleFor('car', 'petrol').find((i) => i.key === 'air_filter')!;
    expect(serviceCovers(air, svc('Service', ['AC filter']))).toBe(false);
    expect(serviceCovers(air, svc('Service', ['Air filter']))).toBe(true);
  });
});

describe('dailyDistance', () => {
  it('needs two weeks of readings', () => {
    expect(dailyDistance([{ at: daysAgo(5), odometer: 100 }, { at: today, odometer: 300 }])).toBeNull();
    expect(dailyDistance([{ at: daysAgo(20), odometer: 100 }, { at: today, odometer: 900 }])).toBe(40);
  });
});

describe('maintenancePlan', () => {
  it('counts a new car from delivery, with the early first oil change', () => {
    const plan = maintenancePlan({
      vehicle: car(),
      marks: [],
      services: [],
      readings: [{ at: today, odometer: 950 }],
      today,
    });
    const oil = find(plan, 'engine_oil');
    expect(oil.dueOdometer).toBe(1_010);
    expect(oil.remainingKm).toBe(60);
    expect(oil.status).toBe('soon');
  });

  it('marks an item overdue once the distance passes', () => {
    const plan = maintenancePlan({
      vehicle: car(),
      marks: [],
      services: [{ servicedAt: daysAgo(30), odometer: 1_000, title: 'Oil change', itemNames: [] }],
      readings: [{ at: today, odometer: 6_200 }],
      today,
    });
    const oil = find(plan, 'engine_oil');
    expect(oil.lastDone?.source).toBe('service');
    expect(oil.remainingKm).toBe(-200);
    expect(oil.status).toBe('overdue');
    expect(describeDue(oil, 'km')).toBe('200 km overdue');
    expect(plan.items[0].status).toBe('overdue');
  });

  it('applies the time limit even when the car barely moves', () => {
    const plan = maintenancePlan({
      vehicle: car({ acquiredAt: daysAgo(800), createdAt: daysAgo(800) }),
      marks: [],
      services: [],
      readings: [{ at: today, odometer: 3_000 }],
      today,
    });
    expect(find(plan, 'brake_fluid').status).toBe('overdue');
  });

  it('does not invent history for a used car', () => {
    const plan = maintenancePlan({
      vehicle: car({ condition: 'used' }),
      marks: [],
      services: [],
      readings: [{ at: today, odometer: 85_000 }],
      today,
    });
    expect(find(plan, 'engine_oil').status).toBe('unknown');
    expect(find(plan, 'brake_fluid').status).toBe('unknown');
  });

  it('assumes original parts on a low-mileage used car, by distance only', () => {
    const plan = maintenancePlan({
      vehicle: car({ condition: 'used', fuelType: 'petrol' }),
      marks: [],
      services: [],
      readings: [{ at: today, odometer: 18_000 }],
      today,
    });
    const plugs = find(plan, 'spark_plugs');
    expect(plugs.lastDone?.source).toBe('factory');
    expect(plugs.remainingKm).toBe(82_000);
    expect(plugs.status).toBe('ok');
  });

  it('honours a manual mark and a not-applicable mark', () => {
    const plan = maintenancePlan({
      vehicle: car({ condition: 'used', fuelType: 'petrol' }),
      marks: [
        { itemKey: 'brake_fluid', action: 'done', doneAt: daysAgo(10), odometer: 80_000 },
        { itemKey: 'timing_belt', action: 'not_applicable', doneAt: daysAgo(10) },
      ],
      services: [],
      readings: [{ at: today, odometer: 85_000 }],
      today,
    });
    expect(find(plan, 'brake_fluid').status).toBe('ok');
    expect(find(plan, 'timing_belt').status).toBe('not_applicable');
  });

  it('projects a date from the usual daily distance', () => {
    const plan = maintenancePlan({
      vehicle: car(),
      marks: [],
      services: [{ servicedAt: daysAgo(30), odometer: 1_000, title: 'Oil change', itemNames: [] }],
      readings: [
        { at: daysAgo(30), odometer: 1_000 },
        { at: today, odometer: 2_500 },
      ],
      today,
    });
    const oil = find(plan, 'engine_oil');
    // Counted from delivery (10 km, 60 days ago): 2,490 km in 60 days = 41.5 a day,
    // so the 3,500 km left is about 84 days out.
    expect(plan.dailyDistance).toBe(41.5);
    expect(Math.round((oil.expectedDate!.getTime() - today.getTime()) / 86_400_000)).toBe(84);
  });
});

describe('newlyDue', () => {
  it('reports only the items that just crossed a threshold', () => {
    const base = {
      vehicle: car(),
      marks: [],
      services: [{ servicedAt: daysAgo(30), odometer: 1_000, title: 'Oil change', itemNames: [] }],
      today,
    };
    const before = maintenancePlan({ ...base, readings: [{ at: today, odometer: 5_000 }] });
    const after = maintenancePlan({ ...base, readings: [{ at: today, odometer: 5_600 }] });
    const keys = newlyDue(before, after).map((e) => e.item.key);
    expect(keys).toContain('engine_oil');
    expect(newlyDue(after, after)).toEqual([]);
  });
});
