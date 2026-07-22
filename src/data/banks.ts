/**
 * Catalog of Sri Lankan licensed commercial banks, plus the non-bank wallets
 * and pots people actually keep money in.
 *
 * Each entry carries a brand colour and a short monogram rather than a logo
 * asset: bank marks are trademarked and can't be bundled, and a monogram on
 * the brand colour is instantly recognisable, renders offline, scales to any
 * size, and gives every bank identical visual weight.
 *
 * `color` is the brand hue used as the card background, so `onColor` records
 * whether white or dark text stays legible on it — computed once here rather
 * than guessed per render.
 */

export interface BankBrand {
  id: string;
  /** Full display name. */
  name: string;
  /** Short name for tight spaces — card faces, loan rows. */
  shortName: string;
  /** 2–4 character monogram drawn on the card face. */
  monogram: string;
  color: string;
  /** Text/icon colour that stays legible on `color`. */
  onColor: '#FFFFFF' | '#101828';
  kind: 'bank' | 'wallet' | 'savings';
}

export const BANKS: BankBrand[] = [
  {
    id: 'boc',
    name: 'Bank of Ceylon',
    shortName: 'BOC',
    monogram: 'BOC',
    color: '#F5A623',
    onColor: '#101828',
    kind: 'bank',
  },
  {
    id: 'peoples',
    name: "People's Bank",
    shortName: "People's",
    monogram: 'PB',
    color: '#00843D',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'commercial',
    name: 'Commercial Bank of Ceylon',
    shortName: 'ComBank',
    monogram: 'CB',
    color: '#003883',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'hnb',
    name: 'Hatton National Bank',
    shortName: 'HNB',
    monogram: 'HNB',
    color: '#8B1A2B',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'sampath',
    name: 'Sampath Bank',
    shortName: 'Sampath',
    monogram: 'SB',
    color: '#F58220',
    onColor: '#101828',
    kind: 'bank',
  },
  {
    id: 'nsb',
    name: 'National Savings Bank',
    shortName: 'NSB',
    monogram: 'NSB',
    color: '#00539F',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'seylan',
    name: 'Seylan Bank',
    shortName: 'Seylan',
    monogram: 'SL',
    color: '#00A651',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'ndb',
    name: 'National Development Bank',
    shortName: 'NDB',
    monogram: 'NDB',
    color: '#005BAA',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'dfcc',
    name: 'DFCC Bank',
    shortName: 'DFCC',
    monogram: 'DF',
    color: '#00539B',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'nations-trust',
    name: 'Nations Trust Bank',
    shortName: 'NTB',
    monogram: 'NTB',
    color: '#00AEEF',
    onColor: '#101828',
    kind: 'bank',
  },
  {
    id: 'pan-asia',
    name: 'Pan Asia Bank',
    shortName: 'Pan Asia',
    monogram: 'PA',
    color: '#005DAA',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'union',
    name: 'Union Bank',
    shortName: 'Union',
    monogram: 'UB',
    color: '#0067B1',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'amana',
    name: 'Amãna Bank',
    shortName: 'Amãna',
    monogram: 'AM',
    color: '#00A0A0',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'cargills',
    name: 'Cargills Bank',
    shortName: 'Cargills',
    monogram: 'CG',
    color: '#00713C',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'hsbc',
    name: 'HSBC Sri Lanka',
    shortName: 'HSBC',
    monogram: 'HS',
    color: '#DB0011',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  {
    id: 'standard-chartered',
    name: 'Standard Chartered',
    shortName: 'StanChart',
    monogram: 'SC',
    color: '#0473EA',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
  // Non-bank pots — money lives here too, and the board funds from them.
  {
    id: 'ezcash',
    name: 'eZ Cash',
    shortName: 'eZ Cash',
    monogram: 'EZ',
    color: '#E4002B',
    onColor: '#FFFFFF',
    kind: 'wallet',
  },
  {
    id: 'frimi',
    name: 'FriMi',
    shortName: 'FriMi',
    monogram: 'FM',
    color: '#7A1FA2',
    onColor: '#FFFFFF',
    kind: 'wallet',
  },
  {
    id: 'cash',
    name: 'Cash in hand',
    shortName: 'Cash',
    monogram: 'CA',
    color: '#5B6472',
    onColor: '#FFFFFF',
    kind: 'wallet',
  },
  {
    id: 'other',
    name: 'Other account',
    shortName: 'Other',
    monogram: '••',
    color: '#334158',
    onColor: '#FFFFFF',
    kind: 'bank',
  },
];

const BY_ID = new Map(BANKS.map((bank) => [bank.id, bank]));

/** Look up a brand by id. Returns undefined for cards added before the catalog. */
export function bankById(id: string | null | undefined): BankBrand | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/**
 * Best-effort brand for a card that has no `bankId` — matches on the stored
 * bank/card name so pre-catalog and hand-typed accounts still pick up a colour.
 */
export function bankByName(name: string | null | undefined): BankBrand | undefined {
  if (!name) return undefined;
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return BANKS.find(
    (bank) =>
      bank.id === needle ||
      bank.name.toLowerCase() === needle ||
      bank.shortName.toLowerCase() === needle ||
      needle.includes(bank.shortName.toLowerCase()),
  );
}

/**
 * The brand to paint a card with, given whatever identity it happens to carry.
 * Falls back to the neutral "other" entry so callers never handle undefined.
 */
export function resolveBrand(input: {
  bankId?: string | null;
  bankName?: string | null;
  name?: string | null;
}): BankBrand {
  return (
    bankById(input.bankId) ??
    bankByName(input.bankName) ??
    bankByName(input.name) ??
    BY_ID.get('other')!
  );
}
