/**
 * The form AI fills from a fill-up photo — the pump display, the pump
 * receipt, or the dashboard odometer. Any one of them fills what it shows.
 */

import { field, type FormValues } from '~/features/ai/logic/aiForm';
import { FUEL_STATIONS } from './fuelStations';

export const FUEL_PHOTO_FORM = {
  date: field.date('The date printed on the fuel receipt. Null for a pump display or dashboard photo.'),
  odometer: field.number(
    'The total distance on the dashboard odometer (ODO), if the photo shows the dashboard. Not the trip meter (TRIP A/B) or the fuel range.',
    { min: 1, max: 2_000_000 },
  ),
  litres: field.number('Litres of fuel pumped, from the pump display or receipt.', { min: 0.1, max: 500 }),
  total: field.number('The amount paid for the fuel, from the pump display or receipt.', { min: 0 }),
  station: field.choice(
    'The fuel company, from the receipt header or the pump branding.',
    FUEL_STATIONS.map((s) => s.name),
  ),
} as const;

export type FuelPhotoValues = FormValues<typeof FUEL_PHOTO_FORM>;

/** "Read the odometer, litres and price" — what came back, for the note. */
export function describeFuelRead(values: FuelPhotoValues): string {
  const found = [
    values.odometer != null ? 'odometer' : null,
    values.litres != null ? 'litres' : null,
    values.total != null ? 'price' : null,
    values.station ? 'station' : null,
  ].filter(Boolean) as string[];
  if (found.length === 0) return 'Nothing readable on it.';
  const text = found.length === 1 ? found[0] : `${found.slice(0, -1).join(', ')} and ${found[found.length - 1]}`;
  return `Read the ${text}.`;
}
