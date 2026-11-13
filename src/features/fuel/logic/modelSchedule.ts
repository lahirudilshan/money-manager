/**
 * "What does MY model's manual say?" — the AI lookup that tailors the
 * schedule to an exact make, model, year and engine.
 *
 * The answer is never applied as is. It becomes a list of proposals — change
 * this interval, this model has none of that, add this item — each shown with
 * what it replaces, and only the ones the user keeps are written as
 * `maintenance_overrides` (source 'ai').
 */

import { field, type FormValues } from '~/features/ai/logic/aiForm';
import {
  CUSTOM_PREFIX,
  describeInterval,
  type MaintenanceItem,
  type ScheduleOverrideInput,
} from './maintenance';

export interface ModelDetails {
  make: string | null;
  model: string | null;
  year: number | null;
  engine: string | null;
  transmission: 'automatic' | 'manual' | 'cvt' | null;
  kind: string;
  fuelType: string;
}

export function modelScheduleForm(items: readonly MaintenanceItem[]) {
  return {
    known: field.boolean(
      'True only if you know the manufacturer maintenance schedule for this exact model and engine (or the same model sold in Japan).',
    ),
    modelNote: field.text(
      'One or two plain sentences on what matters most when maintaining this model — for example "timing chain, no belt", "CVT needs CVT FE fluid only", "clean the hybrid battery fan".',
    ),
    items: field.list(
      "For each listed item where this model's schedule differs from or adds detail to the given default. Leave out items you have no model-specific information for.",
      {
        itemKey: field.choice('Which item.', items.map((i) => i.key)),
        applies: field.boolean(
          'False if this model does not have it at all — a timing chain instead of a belt, electric power steering, no separate differential, an in-tank fuel filter.',
        ),
        everyKm: field.number('Interval in km under SEVERE conditions (heat, dust, short trips, stop-and-go). Null if the manual gives none.', {
          min: 500,
          max: 300_000,
        }),
        everyMonths: field.number('Interval in months under severe conditions. Null if none.', { min: 1, max: 180 }),
        recommended: field.text(
          'The exact spec for this model: oil grade and capacity with filter, spark plug type, tyre size, battery size, fluid type. Null if not known.',
        ),
      },
    ),
    extras: field.list(
      "Important items in this model's own schedule that are NOT in the given list. At most five.",
      {
        title: field.text('Short name, e.g. "Hybrid inverter coolant pump check".'),
        action: field.choice('What is done.', ['replace', 'inspect', 'service'] as const),
        group: field.choice('Area.', ['engine', 'brakes', 'tyres', 'drivetrain', 'electrical', 'body'] as const),
        everyKm: field.number('Interval in km, severe conditions.', { min: 500, max: 300_000 }),
        everyMonths: field.number('Interval in months.', { min: 1, max: 180 }),
        detail: field.text('One plain sentence: what it is and why it matters.'),
      },
    ),
  } as const;
}

export type ModelScheduleValues = FormValues<ReturnType<typeof modelScheduleForm>>;

/** "Toyota Aqua 2015 · 1NZ-FXE · CVT" */
export function describeModel(d: Pick<ModelDetails, 'make' | 'model' | 'year' | 'engine' | 'transmission'>): string | null {
  const name = [d.make, d.model, d.year].filter(Boolean).join(' ');
  if (!name) return null;
  return [name, d.engine, d.transmission === 'cvt' ? 'CVT' : d.transmission].filter(Boolean).join(' · ');
}

export function modelScheduleContext(details: ModelDetails, items: readonly MaintenanceItem[], unit: string): string {
  return [
    `Vehicle: ${describeModel(details) ?? 'unknown model'}. Type: ${details.kind.replace('_', '-')}, ${details.fuelType}.`,
    'Driven in Sri Lanka: hot, humid, dusty, heavy stop-and-go traffic — use the severe-conditions schedule. Many are Japanese-market imports.',
    `Odometer unit: ${unit}.`,
    '',
    "Dayly's default schedule for this vehicle (itemKey: title — default interval):",
    ...items.map((i) => `${i.key}: ${i.title} — ${describeInterval(i, unit)}`),
  ].join('\n');
}

export interface ScheduleProposal {
  key: string;
  title: string;
  type: 'change' | 'off' | 'add';
  /** What it says now, for the "from → to" line. */
  before: string | null;
  after: string;
  override: ScheduleOverrideInput;
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

/** The AI answer as reviewable proposals — only what would actually change. */
export function proposalsFrom(
  values: ModelScheduleValues,
  items: readonly MaintenanceItem[],
  unit: string,
): ScheduleProposal[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const out: ScheduleProposal[] = [];
  const seen = new Set<string>();

  for (const row of values.items) {
    const item = row.itemKey ? byKey.get(row.itemKey) : undefined;
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    const override: ScheduleOverrideInput = {
      itemKey: item.key,
      applies: row.applies !== false,
      everyKm: row.everyKm != null ? Math.round(row.everyKm) : null,
      everyMonths: row.everyMonths != null ? Math.round(row.everyMonths) : null,
      recommended: row.recommended,
      source: 'ai',
    };
    if (!override.applies) {
      out.push({ key: item.key, title: item.title, type: 'off', before: null, after: "This model doesn't have it", override });
      continue;
    }
    const proposed: MaintenanceItem = {
      ...item,
      everyKm: override.everyKm ?? item.everyKm,
      everyMonths: override.everyMonths ?? item.everyMonths,
      firstKm: undefined,
    };
    const before = describeInterval({ ...item, firstKm: undefined }, unit);
    const after = describeInterval(proposed, unit);
    const intervalChanged = before !== after;
    if (!intervalChanged && !override.recommended) continue;
    out.push({
      key: item.key,
      title: item.title,
      type: 'change',
      before: intervalChanged ? before : null,
      after: [intervalChanged ? after : null, override.recommended].filter(Boolean).join(' · '),
      override,
    });
  }

  for (const extra of values.extras.slice(0, 5)) {
    if (!extra.title || (extra.everyKm == null && extra.everyMonths == null)) continue;
    const key = `${CUSTOM_PREFIX}${slug(extra.title)}`;
    if (seen.has(key) || byKey.has(key)) continue;
    seen.add(key);
    const override: ScheduleOverrideInput = {
      itemKey: key,
      title: extra.title,
      action: extra.action,
      group: extra.group,
      applies: true,
      everyKm: extra.everyKm != null ? Math.round(extra.everyKm) : null,
      everyMonths: extra.everyMonths != null ? Math.round(extra.everyMonths) : null,
      detail: extra.detail,
      source: 'ai',
    };
    out.push({
      key,
      title: extra.title,
      type: 'add',
      before: null,
      after: describeInterval(
        {
          key,
          title: extra.title,
          action: extra.action ?? 'inspect',
          group: extra.group ?? 'body',
          everyKm: override.everyKm ?? undefined,
          everyMonths: override.everyMonths ?? undefined,
          detail: '',
        },
        unit,
      ),
      override,
    });
  }
  return out;
}
