/**
 * The shipped merchant → hint catalog, and the source of truth for seeding the
 * shared database.
 *
 * `src/core/smsCategoryHints.ts` holds the *regex* keyword list that reads whole
 * SMS messages. This is the other shape: plain normalised merchant names matched
 * by equality/containment against the merchant field alone. The two overlap but
 * are not interchangeable — a generic word like "super" is a fine message
 * keyword and a terrible merchant rule, because containment matching would fire
 * it on half the supermarkets in the country.
 *
 * Everything here is a real Sri Lankan biller, chain, or well-known global
 * service that appears in bank SMS. Entries are lowercase and unpunctuated
 * because `merchantKey()` normalises both sides before comparing; writing them
 * pre-normalised keeps the seed honest about what will actually match.
 *
 * Adding a merchant: put it under the right hint, keep it lowercase, and prefer
 * the form the BANK prints (POS text, not the shop's legal name). Re-running the
 * seed script picks it up; existing votes are untouched.
 */

/** Must stay in sync with CategoryHint in src/core/smsCategoryHints.ts. */
export type SeedHint =
  | 'water'
  | 'electricity'
  | 'telecom'
  | 'groceries'
  | 'fuel'
  | 'subscription'
  | 'loan'
  | 'transfer'
  | 'atm'
  | 'income';

export const SEED_CATALOG: Record<SeedHint, string[]> = {
  water: [
    'nwsdb',
    'national water supply',
    'water board',
    'national water supply and drainage board',
    'waterboard',
    'jalasampada',
  ],

  electricity: [
    'ceb',
    'leco',
    'ceylon electricity board',
    'ceylon electricity',
    'lanka electricity',
    'lanka electricity company',
    'electricity board',
  ],

  telecom: [
    // Mobile networks
    'dialog',
    'dialog axiata',
    'mobitel',
    'sri lanka telecom',
    'slt',
    'sltmobitel',
    'slt mobitel',
    'hutch',
    'hutchison',
    'airtel',
    'bharti airtel',
    'etisalat',
    // Fixed line / broadband / pay TV
    'lanka bell',
    'dialog broadband',
    'dialog tv',
    'peo tv',
    'peotv',
    'dish tv',
    'sirasa tv',
  ],

  groceries: [
    // Supermarket chains
    'keells',
    'keells super',
    'jaykay marketing',
    'cargills',
    'cargills food city',
    'food city',
    'arpico',
    'arpico supercentre',
    'richard pieris',
    'glomark',
    'laughs',
    'laughs super',
    'sathosa',
    'lanka sathosa',
    'spar',
    'softlogic glomark',
    // Bakeries / food retail that show up as grocery spend
    'perera and sons',
    'fab',
    'bread talk',
    'sponge',
    // Online grocery
    'daraz',
    'pickme food',
    'uber eats',
    'ubereats',
    'pickme',
  ],

  fuel: [
    'ceypetco',
    'ceylon petroleum',
    'ioc',
    'lanka ioc',
    'indian oil',
    'sinopec',
    'rm parks',
    'filling station',
    'fuel station',
    'service station',
    'petrol shed',
  ],

  subscription: [
    // Streaming / media
    'netflix',
    'spotify',
    'youtube',
    'youtube premium',
    'disney',
    'disney plus',
    'hbo',
    'prime video',
    'amazon prime',
    'apple music',
    'apple tv',
    // Cloud / software
    'icloud',
    'apple com bill',
    'google',
    'google storage',
    'google one',
    'microsoft',
    'office 365',
    'microsoft 365',
    'adobe',
    'dropbox',
    'canva',
    'notion',
    'figma',
    'slack',
    'zoom',
    'github',
    'linkedin',
    // AI services
    'anthropic',
    'claude ai',
    'openai',
    'chatgpt',
    'midjourney',
    'perplexity',
    'cursor',
  ],

  loan: [
    'lolc',
    'lolc finance',
    'central finance',
    'commercial credit',
    'senkadagala',
    'people leasing',
    'peoples leasing',
    'lb finance',
    'siyapatha',
    'singer finance',
    'mercantile investments',
    'nation lanka',
    'softlogic finance',
    'hnb finance',
    'sanasa',
    'vallibel finance',
    'abans finance',
  ],

  transfer: [
    'cefts',
    'slips',
    'ctb',
    'lankapay',
    'justpay',
    'fund transfer',
    'own account transfer',
  ],

  atm: ['atm', 'cash withdrawal', 'cdm', 'cash deposit machine'],

  income: ['salary', 'payroll', 'dividend', 'epf', 'etf', 'bonus', 'commission'],
};

/** Flattened `[merchant, hint]` pairs, the shape the seeder inserts. */
export function seedPairs(): [string, SeedHint][] {
  return (Object.entries(SEED_CATALOG) as [SeedHint, string[]][]).flatMap(([hint, merchants]) =>
    merchants.map((merchant) => [merchant, hint] as [string, SeedHint]),
  );
}
