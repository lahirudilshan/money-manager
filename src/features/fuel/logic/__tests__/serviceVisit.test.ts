import { describe, expect, it } from 'vitest';
import {
  autoTitle,
  coveredKeys,
  detectPart,
  maintenanceHistory,
  invoiceForm,
  invoiceFromForm,
  suggestItemKey,
  type DraftLine,
} from '../serviceVisit';
import { maintenancePlan, scheduleFor } from '../maintenance';
import { guideFor, partFor } from '../maintenanceGuide';
import { readForm } from '~/features/ai/logic/aiForm';

const parseInvoice = (data: unknown, vehicle: typeof car, now: Date) => {
  const form = readForm(invoiceForm(scheduleFor(vehicle.kind, vehicle.fuelType)), data, now);
  return form.matches ? invoiceFromForm(form.values, vehicle) : { ok: false as const, error: 'not an invoice' };
};

const today = new Date(2026, 10, 13);
const car = { kind: 'car', fuelType: 'hybrid' } as const;
const items = scheduleFor('car', 'hybrid');

const line = (patch: Partial<DraftLine>): DraftLine => ({
  name: 'x',
  quantity: 1,
  unitPriceMinor: 0,
  kind: 'part',
  itemKey: '',
  brand: '',
  spec: '',
  ...patch,
});

describe('suggestItemKey / detectPart', () => {
  it('maps bill lines to schedule items by name', () => {
    expect(suggestItemKey(items, 'Oil filter')).toBe('oil_filter');
    expect(suggestItemKey(items, 'Oil & filter change')).toBe('engine_oil');
    expect(suggestItemKey(items, 'Mobil 0W-20 4L')).toBe('engine_oil');
    expect(suggestItemKey(items, 'AC filter')).toBe('cabin_filter');
    expect(suggestItemKey(items, 'Labour')).toBe('');
  });

  it('finds the brand and grade in a line', () => {
    expect(detectPart('engine_oil', 'car', 'hybrid', 'Mobil Super 0W20 4L')).toEqual({
      brand: 'Mobil',
      spec: '0W-20',
    });
    expect(detectPart('spark_plugs', 'car', 'petrol', 'NGK iridium plug x4')).toEqual({
      brand: 'NGK',
      spec: 'Iridium',
    });
    // "Genuine" is only claimed when the bill says it.
    expect(detectPart('air_filter', 'car', 'petrol', 'Air filter').brand).toBe('');
  });
});

describe('parseInvoice', () => {
  it('turns the AI reply into checked lines', () => {
    const result = parseInvoice(
      {
        isInvoice: true,
        garage: 'AB Motors',
        date: '2026-11-02',
        odometer: 48200,
        total: 18500,
        lines: [
          { name: 'Castrol 0W-20 4L', quantity: 1, unitPrice: 9600, kind: 'fluid', itemKey: 'engine_oil' },
          { name: 'Oil filter', lineTotal: 2400, kind: 'part', itemKey: 'made_up_key' },
          { name: 'Labour', unitPrice: 6500, kind: 'labour', itemKey: '' },
        ],
      },
      car,
      today,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { invoice } = result;
    expect(invoice.odometer).toBe(48200);
    expect(invoice.totalMinor).toBe(1_850_000);
    expect(invoice.date?.getDate()).toBe(2);
    expect(invoice.lines[0]).toMatchObject({ itemKey: 'engine_oil', brand: 'Castrol', spec: '0W-20', unitPriceMinor: 960_000 });
    // An unknown key falls back to the name match.
    expect(invoice.lines[1]).toMatchObject({ itemKey: 'oil_filter', unitPriceMinor: 240_000 });
    expect(invoice.lines[2].itemKey).toBe('');
  });

  it('refuses a photo that is not an invoice and drops a future date', () => {
    expect(parseInvoice({ isInvoice: false, lines: [] }, car, today).ok).toBe(false);
    const r = parseInvoice({ isInvoice: true, date: '2030-01-01', lines: [{ name: 'Wash', kind: 'other', itemKey: '' }] }, car, today);
    expect(r.ok && r.invoice.date).toBe(null);
  });
});

describe('a visit on the schedule', () => {
  it('covers mapped lines plus ticked extras, once each', () => {
    const lines = [line({ itemKey: 'engine_oil' }), line({ itemKey: 'engine_oil' }), line({})];
    expect(coveredKeys(lines, ['tyre_rotation', 'engine_oil'])).toEqual(['engine_oil', 'tyre_rotation']);
    expect(autoTitle('service', items.filter((i) => i.key === 'engine_oil'))).toBe('Service · engine oil');
  });

  it('a confirmed visit ignores the name match the user corrected', () => {
    const service = { servicedAt: today, odometer: 40_000, title: 'Oil change', itemNames: [] };
    const base = { vehicle: { ...car, condition: 'used' as const, createdAt: today }, marks: [], readings: [], today };
    expect(maintenancePlan({ ...base, services: [service] }).items.find((i) => i.item.key === 'engine_oil')?.lastDone?.source).toBe('service');
    expect(maintenancePlan({ ...base, services: [{ ...service, confirmed: true }] }).items.find((i) => i.item.key === 'engine_oil')?.status).toBe('unknown');
  });

  it('builds one history: visits with what they covered, plus standalone marks', () => {
    const history = maintenanceHistory({
      ...car,
      services: [
        { id: 's1', servicedAt: new Date(2026, 9, 1), odometer: 40_000, title: 'Full service', kind: 'service', costMinor: 100, lines: [{ name: '5W-30 x4', itemKey: null }] },
        { id: 's2', servicedAt: new Date(2026, 10, 1), odometer: 45_000, title: 'Service', kind: 'service', costMinor: 100, lines: [{ name: 'Oil', itemKey: '' }] },
      ],
      marks: [
        { id: 'm1', itemKey: 'wipers', action: 'done', doneAt: new Date(2026, 10, 5), odometer: null, serviceId: null, brand: 'Bosch' },
        { id: 'm2', itemKey: 'brake_fluid', action: 'done', doneAt: new Date(2026, 10, 1), odometer: 45_000, serviceId: 's2' },
      ],
    });
    expect(history.map((h) => h.id)).toEqual(['m1', 's2', 's1']);
    const s1 = history.find((h) => h.id === 's1');
    const s2 = history.find((h) => h.id === 's2');
    // Old record: matched by name. Confirmed record: only what the user kept.
    expect(s1?.type === 'visit' && s1.covered.map((i) => i.key)).toEqual(['engine_oil']);
    expect(s2?.type === 'visit' && s2.covered.map((i) => i.key)).toEqual(['brake_fluid']);
  });
});

describe('guide', () => {
  it('explains every item on every schedule, in plain words', () => {
    for (const kind of ['car', 'van', 'bike', 'three_wheeler', 'other'] as const) {
      for (const fuel of ['petrol', 'diesel', 'hybrid', 'electric'] as const) {
        for (const item of scheduleFor(kind, fuel)) {
          const g = guideFor(item.key);
          expect(g.what, item.key).not.toBe('A regular check on your vehicle.');
          expect(g.why.length).toBeGreaterThan(20);
        }
      }
    }
  });

  it('suggests hybrid oil grades for a hybrid', () => {
    expect(partFor('engine_oil', 'car', 'hybrid')?.hint).toMatch(/0W-20/);
    expect(partFor('bike_chain', 'bike')?.brands).toContain('Motul');
    expect(partFor('valve_clearance', 'bike')).toBeNull();
  });
});

describe('autoTitle', () => {
  const pick = (...keys: string[]) => items.filter((i) => keys.includes(i.key));

  it('names a service by its odometer, listing what was done before what was checked', () => {
    expect(
      autoTitle('service', pick('engine_oil', 'oil_filter', 'brake_inspect'), { odometer: 47_820 }),
    ).toBe('48,000 km service · engine oil, oil filter');
    expect(autoTitle('service', pick('brake_inspect'), { odometer: 9_900 })).toBe(
      '10,000 km service · brake pads, discs & shoes',
    );
  });

  it('falls back to the bill lines, then the kind', () => {
    expect(
      autoTitle('repair', [], {
        lines: [
          { name: 'Radiator fan motor', kind: 'part' },
          { name: 'Labour', kind: 'labour' },
        ],
      }),
    ).toBe('Repair · radiator fan motor');
    expect(autoTitle('repair', [])).toBe('Repair');
    expect(autoTitle('insurance', [])).toBe('Insurance renewal');
  });

  it('names new tyres by brand and size', () => {
    expect(
      autoTitle('tyres', pick('tyres'), {
        lines: [{ name: 'Tyre', itemKey: 'tyres', brand: 'Bridgestone', spec: '175/65 R15' }],
      }),
    ).toBe('New tyres · Bridgestone 175/65 R15');
  });
});
