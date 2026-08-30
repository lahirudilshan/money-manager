/**
 * Catalog of Sri Lankan licensed commercial banks, plus the non-bank wallets
 * and pots people actually keep money in.
 *
 * Every entry carries a brand colour and a short monogram, and that pair — not
 * the logo — is the guaranteed rendering: it works offline, scales to any size
 * and gives every bank identical visual weight. `url` is an upgrade layered on
 * top, and `BankLogo` drops back to the monogram the moment one fails to load,
 * so a bank whose artwork is missing, 404s or is offline still looks
 * deliberate rather than broken.
 *
 * `color` is the brand hue used as the card background, so `onColor` records
 * whether white or dark text stays legible on it — computed once here rather
 * than guessed per render.
 */

import { ImageSourcePropType } from "react-native";

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
  /**
   * The bank's mark. Two forms, deliberately:
   *
   *   - `require(...)` once the PNG is sitting in `assets/images/banks/` —
   *     bundled, instant, works with no network.
   *   - `{ uri: ... }` until then, pointing at the bank's own site.
   *
   * Both are `ImageSourcePropType`, so nothing downstream cares which a given
   * bank is on, and promoting one to a bundled asset is a one-line edit here.
   * A `require()` of a file that does not exist is a *bundler* error rather
   * than a runtime one, which is why the placeholders can't be require lines.
   */
  url?: ImageSourcePropType;
}

/**
 * Ordered alphabetically by `name`, with the non-bank entries ("Other", "Cash
 * in hand") deliberately last — they are the fallbacks, and a user scanning for
 * their bank should not trip over them mid-list. The UI groups on `kind`
 * anyway, so this only fixes the order *within* each group.
 */
export const BANKS: BankBrand[] = [
  {
    id: 'amana',
    name: 'Amãna Bank',
    shortName: 'Amãna',
    monogram: 'AM',
    color: '#055841',
    onColor: '#FFFFFF',
    kind: 'bank',
    url: require('../../../assets/images/banks/AM.png'),
  },
  {
    id: 'boc',
    name: 'Bank of Ceylon',
    shortName: 'BOC',
    monogram: 'BOC',
    color: '#FCC807',
    onColor: '#101828',
    kind: 'bank',
    url: require('../../../assets/images/banks/BOC.png'),
  },
  {
    id: 'cargills',
    name: 'Cargills Bank',
    shortName: 'Cargills',
    monogram: 'CG',
    color: '#F26E1D',
    onColor: '#101828',
    kind: 'bank',
    url: require('../../../assets/images/banks/CG.png'),
  },
  {
    id: 'commercial',
    name: 'Commercial Bank of Ceylon',
    shortName: 'ComBank',
    monogram: 'CB',
    color: '#006DB8',
    onColor: '#FFFFFF',
    kind: 'bank',
    url: require('../../../assets/images/banks/CB.png'),
  },
  {
    id: 'dfcc',
    name: 'DFCC Bank',
    shortName: 'DFCC',
    monogram: 'DF',
    color: '#DB0627',
    onColor: '#FFFFFF',
    kind: 'bank',
    url: require('../../../assets/images/banks/DFCC.png'),
  },
  {
    id: 'hnb',
    name: 'Hatton National Bank',
    shortName: 'HNB',
    monogram: 'HNB',
    color: '#00A6D8',
    onColor: '#101828',
    kind: 'bank',
    url: require('../../../assets/images/banks/HNB.png'),
  },
  {
    id: 'hsbc',
    name: 'HSBC Sri Lanka',
    shortName: 'HSBC',
    monogram: 'HS',
    color: '#DB0011',
    onColor: '#FFFFFF',
    kind: 'bank',
    url: require('../../../assets/images/banks/HS.png'),
  },
  {
    id: 'ndb',
    name: 'National Development Bank',
    shortName: 'NDB',
    monogram: 'NDB',
    color: '#D0043C',
    onColor: '#FFFFFF',
    kind: 'bank',
    // → assets/images/banks/NDB.png
    url: { uri: 'https://www.ndbbank.com/images/logo.png' },
  },
  {
    id: 'nsb',
    name: 'National Savings Bank',
    shortName: 'NSB',
    monogram: 'NSB',
    color: '#EA970B',
    onColor: '#101828',
    kind: 'bank',
    url: require('../../../assets/images/banks/NSB.png'),
  },
  {
    id: 'nations-trust',
    name: 'Nations Trust Bank',
    shortName: 'NTB',
    monogram: 'NTB',
    color: '#0F93D1',
    onColor: '#101828',
    kind: 'bank',
    url: require('../../../assets/images/banks/NTB.png'),
  },
  {
    id: 'pan-asia',
    name: 'Pan Asia Bank',
    shortName: 'Pan Asia',
    monogram: 'PA',
    color: '#E90D06',
    onColor: '#FFFFFF',
    kind: 'bank',
    url: require('../../../assets/images/banks/PA.png'),
  },
  {
    id: 'peoples',
    name: "People's Bank",
    shortName: "People's",
    monogram: 'PB',
    color: '#FDAC01',
    onColor: '#101828',
    kind: 'bank',
    url: require('../../../assets/images/banks/PB.png'),
  },
  {
    id: 'sampath',
    name: 'Sampath Bank',
    shortName: 'Sampath',
    monogram: 'SB',
    color: '#F27A24',
    onColor: '#101828',
    kind: 'bank',
    url: require('../../../assets/images/banks/SB.png'),
  },
  {
    id: 'seylan',
    name: 'Seylan Bank',
    shortName: 'Seylan',
    monogram: 'SL',
    color: '#DF0124',
    onColor: '#FFFFFF',
    kind: 'bank',
    url: require('../../../assets/images/banks/SL.png'),
  },
  {
    id: 'standard-chartered',
    name: 'Standard Chartered',
    shortName: 'StanChart',
    monogram: 'SC',
    color: '#0473EA',
    onColor: '#FFFFFF',
    kind: 'bank',
    url: require('../../../assets/images/banks/SC.png'),
  },
  {
    id: 'union',
    name: 'Union Bank',
    shortName: 'Union',
    monogram: 'UB',
    color: '#214893',
    onColor: '#FFFFFF',
    kind: 'bank',
    url: require('../../../assets/images/banks/UB.png'),
  },
  {
    id: 'cash',
    name: 'Cash in hand',
    shortName: 'Cash',
    monogram: 'Cash',
    color: '#5B6472',
    onColor: '#FFFFFF',
    kind: 'wallet'
  },
  {
    id: 'other',
    name: 'Other',
    shortName: 'Other',
    monogram: 'Other',
    color: '#5B6472',
    onColor: '#FFFFFF',
    kind: 'wallet'
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

/**
 * How an account reads everywhere in the app.
 *
 * An account has exactly two pieces of identity: the BANK it is at, and the
 * user's own name for it. There used to be a third — a free-text `name`
 * alongside the nickname — and the ranking here had to guess which of the two
 * the user meant as the headline, using string length as a proxy. Asking once
 * removed the guess:
 *
 *   - a nickname is set → it leads, with the bank beneath it. That is the whole
 *     reason to type one, and it is what tells three HNB accounts apart.
 *   - no nickname → the bank leads. For someone with one account per bank this
 *     is already unambiguous, which is why the nickname stays optional.
 *
 * Falls back to the neutral brand's name rather than an empty string, so a row
 * always renders something rather than collapsing.
 */
export function accountLabel(card: {
  bankId?: string | null;
  bankName?: string | null;
  nickname?: string | null;
}): { primary: string; secondary: string | null } {
  const brand = resolveBrand({ bankId: card.bankId, bankName: card.bankName });
  const bank = card.bankName ?? (brand.id !== 'other' ? brand.name : null);

  const nickname = card.nickname?.trim();
  if (nickname) return { primary: nickname, secondary: bank };

  return { primary: bank ?? brand.name, secondary: null };
}

/**
 * The single string to use where only one will fit — a list row, an alert
 * title, a chart label.
 *
 * `accountLabel().primary` with the bank appended when it is doing the
 * distinguishing work, which is the shape almost every caller of the old
 * `card.name` actually wanted.
 */
export function accountName(card: {
  bankId?: string | null;
  bankName?: string | null;
  nickname?: string | null;
}): string {
  return accountLabel(card).primary;
}

/**
 * The SHORT form — the bank's short name, or the nickname when one is set.
 *
 * For places with room for a word and not a phrase: the comma-separated bank
 * list on a category card, a loan row, a tile caption.
 */
export function accountShortName(card: {
  bankId?: string | null;
  bankName?: string | null;
  nickname?: string | null;
}): string {
  const nickname = card.nickname?.trim();
  if (nickname) return nickname;
  return resolveBrand({ bankId: card.bankId, bankName: card.bankName }).shortName;
}
