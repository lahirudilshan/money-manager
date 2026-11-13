import { describe, expect, it } from 'vitest';
import { field, formInstruction, MATCHES_KEY, readForm, schemaFor } from '../aiForm';

const today = new Date(2026, 10, 13);
const form = {
  odometer: field.number('Mileage.', { min: 1, max: 2_000_000 }),
  date: field.date('Invoice date.'),
  garage: field.text('Garage name.'),
  kind: field.choice('Kind.', ['part', 'labour'] as const),
  lines: field.list('Lines.', { name: field.text('Name.'), price: field.number('Price.', { min: 0 }) }),
};

describe('schemaFor', () => {
  it('asks for every field, nullable, with its description and choices', () => {
    const schema = schemaFor(form, 'an invoice') as {
      required: string[];
      properties: Record<string, { type: unknown; enum?: unknown[]; description?: string; items?: unknown }>;
    };
    expect(schema.required).toEqual([MATCHES_KEY, 'odometer', 'date', 'garage', 'kind', 'lines']);
    expect(schema.properties.odometer.type).toEqual(['number', 'null']);
    expect(schema.properties.odometer.description).toMatch(/^Mileage\./);
    expect(schema.properties.date.description).toMatch(/YYYY-MM-DD/);
    expect(schema.properties.kind.enum).toEqual(['part', 'labour', null]);
    expect(schema.properties.lines.type).toBe('array');
    expect(schema.properties[MATCHES_KEY].description).toMatch(/an invoice/);
  });

  it('tells the model never to guess', () => {
    expect(formInstruction({ purpose: 'x', documentKind: 'a receipt' })).toMatch(/Never guess/);
  });
});

describe('readForm', () => {
  it('keeps what is valid and drops what is not', () => {
    const { matches, values } = readForm(
      form,
      {
        [MATCHES_KEY]: true,
        odometer: '48,200 km',
        date: '2031-01-01',
        garage: '  AB Motors ',
        kind: 'tyres',
        lines: [{ name: 'Oil', price: -5 }, 'junk', { name: '', price: '2,400' }],
      },
      today,
    );
    expect(matches).toBe(true);
    expect(values.odometer).toBe(48_200);
    expect(values.date).toBeNull(); // in the future
    expect(values.garage).toBe('AB Motors');
    expect(values.kind).toBeNull(); // not one of ours
    expect(values.lines).toEqual([
      { name: 'Oil', price: null },
      { name: null, price: 2_400 },
    ]);
  });

  it('rejects an impossible date and reports a wrong document', () => {
    expect(readForm(form, { date: '2026-02-31' }, today).values.date).toBeNull();
    expect(readForm(form, { [MATCHES_KEY]: false }, today).matches).toBe(false);
    expect(readForm(form, null, today).values.lines).toEqual([]);
  });
});
