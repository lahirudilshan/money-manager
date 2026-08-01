import 'server-only';

/**
 * Keyword-based hint inference — the shipped half of detection.
 *
 * This moved here from the device so the rules can be corrected without
 * shipping an app update: a bank renames itself, a new supermarket chain opens,
 * a keyword turns out to fire too broadly, and today that is a deploy rather
 * than a release cycle and a wait for users to update.
 *
 * The device still PARSES the message — the text never leaves it. What arrives
 * here is the merchant string and the transaction's shape, and what goes back is
 * a decided category. That split is deliberate: inference benefits from being
 * central, parsing does not, and parsing is the part that touches the raw SMS.
 *
 * The lists are the Sri Lankan bank/utility wording that real alerts use.
 * Extending: add a keyword, add a case to e2e.mjs, deploy.
 */

import type { Hint } from './contract';

/**
 * Keyword patterns per hint. The ORDER OF ENTRIES is the tie-break when a
 * message matches more than one — utilities and loans win over the broad
 * transfer/income buckets, because "transfer" appears in a great many alerts
 * that are really about something more specific.
 */
const HINT_KEYWORDS: [Hint, RegExp[]][] = [
  ['water', [/\bwater\b/i, /\bnwsdb\b/i, /national water supply/i, /water board/i]],
  [
    'electricity',
    [/\belectricity\b/i, /\bceb\b/i, /\bleco\b/i, /ceylon electricity/i, /electricity board/i],
  ],
  [
    'telecom',
    [
      /\bdialog\b/i,
      /\bmobitel\b/i,
      /\bhutch\b/i,
      /\bairtel\b/i,
      /\bslt\b/i,
      /axiata/i,
      /\breload\b/i,
      /\bpostpaid\b/i,
      /\bprepaid\b/i,
    ],
  ],
  [
    'groceries',
    [
      /\bkeells\b/i,
      /\bcargills\b/i,
      /\bfood city\b/i,
      /\barpico\b/i,
      /\bglomark\b/i,
      /\bsupermarket\b/i,
      /\bsuper\b/i,
      /\bfresh\b/i,
      /\bmart\b/i,
    ],
  ],
  [
    'fuel',
    [/\bfuel\b/i, /\bpetrol\b/i, /\bdiesel\b/i, /\bceypetco\b/i, /\bioc\b/i, /filling station/i],
  ],
  [
    'subscription',
    [
      /\bsubscription\b/i,
      /\bnetflix\b/i,
      /\bspotify\b/i,
      /\byoutube\b/i,
      /\banthropic\b/i,
      /\bclaude\b/i,
      /\bopenai\b/i,
      /\bgoogle\b/i,
      /\bicloud\b/i,
      /\bapple\.com\b/i,
    ],
  ],
  ['loan', [/\bloan\b/i, /\blease\b/i, /\binstal?ment\b/i, /Reason\s*:\s*MB:loan/i]],
  ['transfer', [/\btransfer\b/i, /\bcefts\b/i, /\bslips\b/i, /\bctb\b/i]],
  ['atm', [/\batm\b/i, /\bwithdrawal\b/i, /cash withdrawal/i]],
  ['income', [/\bsalary\b/i, /\bpayroll\b/i, /\bdividend\b/i, /\brefund\b/i]],
];

/**
 * The single best hint for a piece of text, or null when nothing matches.
 *
 * `text` is the MERCHANT and any label the device extracted — never the raw
 * message. The endpoint enforces that; this function simply cannot tell the
 * difference, which is why the check lives at the boundary.
 */
export function inferHint(text: string): Hint | null {
  if (!text) return null;
  for (const [hint, patterns] of HINT_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(text))) return hint;
  }
  return null;
}

/**
 * Words a line may use to name a hint's own category.
 *
 * The keyword lists above are tuned to recognise MESSAGES, where the useful
 * signals are merchant and biller names. Board LINES are named the other way
 * round — after the category itself — and several hints had no pattern for
 * their own name, so a line called "Groceries" did not match the groceries
 * hint while "Electricity" matched electricity purely by coincidence of
 * appearing in both roles.
 *
 * That asymmetry silently cost the strongest ranking signal (worth 0.45) on
 * exactly the plainly-named lines most users create.
 */
const HINT_SELF_WORDS: Record<Hint, RegExp[]> = {
  water: [/\bwater\b/i],
  electricity: [/\belectric(?:ity)?\b/i, /\bpower\b/i],
  telecom: [/\bphone\b/i, /\bmobile\b/i, /\binternet\b/i, /\bbroadband\b/i, /\btelecom\b/i],
  groceries: [/\bgrocer(?:y|ies)\b/i, /\bfood\b/i, /\bshopping\b/i],
  fuel: [/\bfuel\b/i, /\bpetrol\b/i, /\bdiesel\b/i, /\bgas\b/i],
  subscription: [/\bsubscription(?:s)?\b/i, /\bstreaming\b/i],
  loan: [/\bloan(?:s)?\b/i, /\blease\b/i, /\bdebt\b/i, /\bcredit\b/i],
  transfer: [/\btransfer(?:s)?\b/i, /\bcash\b/i],
  atm: [/\batm\b/i, /\bcash\b/i, /\bwithdrawal\b/i],
  income: [/\bsalary\b/i, /\bincome\b/i, /\bwage(?:s)?\b/i, /\bpay\b/i],
};

/**
 * Whether a board line plausibly belongs to a hint, by running both the message
 * keywords and the category's own names against the line's name and group.
 *
 * Two ways to match, and both matter: the keywords recognise a hand-named "CEB
 * bill" as electricity without it appearing in any catalog, and the self-words
 * recognise a plainly-named "Groceries".
 */
export function lineMatchesHint(hint: Hint, lineText: string): boolean {
  const keywords = HINT_KEYWORDS.find(([candidate]) => candidate === hint)?.[1] ?? [];
  if (keywords.some((pattern) => pattern.test(lineText))) return true;

  return HINT_SELF_WORDS[hint].some((pattern) => pattern.test(lineText));
}
