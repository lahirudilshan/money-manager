/**
 * The currencies the app offers, and which one a device's region implies.
 *
 * Lifted out of the settings screen so it can be used where the choice is
 * actually made — onboarding, before any screen exists — and unit-tested.
 *
 * ## Why region, not network
 *
 * The country is read from the DEVICE's region setting rather than from an IP
 * lookup. A network guess switches a Sri Lankan user's entire board to AUD the
 * moment they land in Sydney, and back again a week later, silently restating
 * every figure they own. Region travels with the person, not the airport, needs
 * no permission and works offline on first launch — which is exactly when this
 * question is asked.
 *
 * The detection is a SUGGESTION. `defaultCurrencyForRegion` returns null when it
 * does not recognise a region, and the caller shows a picker rather than
 * inventing a currency — a wrong guess here mislabels every amount in the app.
 */

export interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
  flag: string;
}

/**
 * Currencies offered in the picker, with a symbol and full name.
 *
 * Deliberately a short curated list rather than all ~180 ISO codes: this is a
 * scrolling picker on a phone, and every entry here is one the app can also
 * plausibly fetch a rate for.
 */
export const CURRENCIES: readonly CurrencyOption[] = [
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee', flag: '🇱🇰' },
  { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', flag: '🇳🇿' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', flag: '🇦🇪' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', flag: '🇸🇬' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', flag: '🇨🇭' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', flag: '🇲🇾' },
  { code: 'QAR', symbol: 'ر.ق', name: 'Qatari Riyal', flag: '🇶🇦' },
  { code: 'SAR', symbol: 'ر.س', name: 'Saudi Riyal', flag: '🇸🇦' },
];

/** Look up an offered currency by code. */
export function findCurrency(code: string): CurrencyOption | undefined {
  const normalised = (code ?? '').trim().toUpperCase();
  return CURRENCIES.find((entry) => entry.code === normalised);
}

/**
 * ISO 3166 region → the currency spent there.
 *
 * Only regions whose currency the app offers, so detection can never select
 * something the picker cannot then display. The euro-zone entries are listed
 * individually rather than collapsed, because there is no region code for "the
 * euro area" — a device reports FR or DE, never EU.
 */
const REGION_CURRENCY: Readonly<Record<string, string>> = {
  LK: 'LKR',
  US: 'USD',
  GB: 'GBP',
  IN: 'INR',
  AU: 'AUD',
  NZ: 'NZD',
  AE: 'AED',
  SG: 'SGD',
  JP: 'JPY',
  CA: 'CAD',
  CH: 'CHF',
  MY: 'MYR',
  QA: 'QAR',
  SA: 'SAR',
  // Euro area.
  AT: 'EUR',
  BE: 'EUR',
  CY: 'EUR',
  DE: 'EUR',
  EE: 'EUR',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  GR: 'EUR',
  HR: 'EUR',
  IE: 'EUR',
  IT: 'EUR',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  MT: 'EUR',
  NL: 'EUR',
  PT: 'EUR',
  SI: 'EUR',
  SK: 'EUR',
};

/**
 * The currency a region implies, or null when the region is unrecognised.
 *
 * Null is a real answer, not a failure: it means "ask the user". Falling back to
 * a default here would silently label a Norwegian user's krone as dollars, and
 * every figure in the app would then be wrong in a way nothing on screen
 * explains.
 *
 * Accepts a bare region ("AU") or a full locale ("en-AU", "en_AU"), since
 * platforms report both shapes.
 */
export function defaultCurrencyForRegion(region: string | null | undefined): string | null {
  const raw = (region ?? '').trim();
  if (!raw) return null;

  // Take the last segment of a locale tag: "en-AU" -> "AU". A bare region is
  // unaffected, so both shapes go through one path.
  const segments = raw.split(/[-_]/);
  const candidate = segments[segments.length - 1].toUpperCase();
  if (candidate.length !== 2) return null;

  return REGION_CURRENCY[candidate] ?? null;
}
