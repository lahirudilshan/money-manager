/**
 * The fuel retailers a Sri Lankan driver actually fills up at.
 *
 * A short fixed list rather than a free-text box, because the station is only
 * useful if it is written the same way every time — "Ceypetco", "CEYPETCO" and
 * "ceypetco " are three different strings to any future grouping or filter, and
 * that is exactly the sort of drift a typed field accumulates over a year of
 * weekly fill-ups.
 *
 * Just the three retailers with real coverage. Tapping the selected pill clears
 * it, so a fill at an unlisted pump is recorded with the station left blank
 * rather than forced into a wrong one — which is why there is no "Other".
 */

export interface FuelStation {
  id: string;
  /** What the user sees and what is stored. */
  name: string;
}

export const FUEL_STATIONS: FuelStation[] = [
  { id: 'ceypetco', name: 'Ceypetco' },
  { id: 'ioc', name: 'Lanka IOC' },
  { id: 'sinopec', name: 'Sinopec' },
];
