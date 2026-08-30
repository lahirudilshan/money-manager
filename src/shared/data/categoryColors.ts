/**
 * The category colour set, and how a colour is guessed from a typed name.
 *
 * ## Why a fixed set rather than a colour wheel
 *
 * Category colour is not decoration — it is how a category is recognised at a
 * glance on the board, in the funding bars, and on every chart. A free picker
 * lets the user choose two greens a shade apart, or a yellow that vanishes on
 * the light canvas and a navy that vanishes on the dark one, and the board is
 * then harder to read than it was with the default. A curated set is the
 * cheaper promise: every entry is distinguishable from every other, and every
 * entry has been checked against both themes.
 *
 * Each hue is a mid-tone (roughly 45–60% lightness). That band is the one that
 * holds contrast BOTH ways — dark enough to read as a solid fill behind white
 * text, light enough to stay visible as a stroke or a tint on a dark canvas —
 * which is what lets one value serve as icon tint, bar fill and chart key
 * without a per-theme variant.
 *
 * The order is a colour wheel, not a grouping by family, so the grid reads as a
 * spectrum and adjacent swatches are always visibly different.
 */

export interface CategoryColor {
  /** Hex, uppercase — compared by equality against `categories.color`. */
  value: string;
  /** Spoken name, for the accessibility label on each swatch. */
  label: string;
  /**
   * Words that suggest this colour from a category name.
   *
   * The associations are the obvious real-world ones — food is warm, water is
   * blue, plants and health are green, money is teal — because a suggestion is
   * only worth making when the user would have reached for the same colour.
   * A name that matches nothing keeps the default, which is deliberate: a
   * random colour for "Miscellaneous" is worse than a neutral one.
   */
  keywords: string[];
}

export const CATEGORY_COLORS: CategoryColor[] = [
  {
    value: '#E11D48',
    label: 'Rose',
    keywords: ['love', 'gift', 'gifts', 'wedding', 'donation', 'charity', 'alms'],
  },
  {
    value: '#DC2626',
    label: 'Red',
    keywords: ['debt', 'loan', 'loans', 'credit', 'lease', 'mortgage', 'emergency', 'urgent', 'overdue'],
  },
  {
    value: '#EA580C',
    label: 'Orange',
    keywords: ['food', 'dining', 'restaurant', 'eating', 'lunch', 'dinner', 'takeaway', 'meal', 'snack'],
  },
  {
    value: '#D97706',
    label: 'Amber',
    keywords: ['fuel', 'petrol', 'diesel', 'gas', 'lpg', 'cooking', 'energy', 'electricity', 'power', 'electric'],
  },
  {
    value: '#CA8A04',
    label: 'Gold',
    keywords: ['savings', 'save', 'gold', 'investment', 'invest', 'deposit', 'fixed deposit', 'wealth'],
  },
  {
    value: '#65A30D',
    label: 'Lime',
    keywords: ['grocery', 'groceries', 'market', 'supermarket', 'vegetables', 'fruit', 'garden', 'plants'],
  },
  {
    value: '#16A34A',
    label: 'Green',
    keywords: ['health', 'medical', 'medicine', 'doctor', 'hospital', 'pharmacy', 'fitness', 'gym', 'income', 'salary'],
  },
  {
    value: '#059669',
    label: 'Emerald',
    keywords: ['pet', 'pets', 'dog', 'cat', 'animal', 'vet', 'nature', 'eco'],
  },
  {
    value: '#0D9488',
    label: 'Teal',
    keywords: ['money', 'bank', 'banking', 'transfer', 'cash', 'budget', 'finance'],
  },
  {
    value: '#0891B2',
    label: 'Cyan',
    keywords: ['water', 'nwsdb', 'plumbing', 'laundry', 'cleaning', 'swimming'],
  },
  {
    value: '#0284C7',
    label: 'Sky',
    keywords: ['travel', 'flight', 'holiday', 'trip', 'vacation', 'transport', 'bus', 'train', 'taxi'],
  },
  {
    value: '#2563EB',
    label: 'Blue',
    keywords: ['internet', 'phone', 'mobile', 'data', 'broadband', 'wifi', 'telecom', 'dialog', 'slt', 'utility', 'utilities', 'bills'],
  },
  {
    value: '#4F46E5',
    label: 'Indigo',
    keywords: ['home', 'house', 'rent', 'housing', 'household', 'family'],
  },
  {
    value: '#7C3AED',
    label: 'Violet',
    keywords: ['entertainment', 'movie', 'movies', 'netflix', 'music', 'games', 'gaming', 'hobby', 'hobbies', 'streaming', 'subscription'],
  },
  {
    value: '#9333EA',
    label: 'Purple',
    keywords: ['education', 'school', 'tuition', 'course', 'books', 'study', 'learning', 'university', 'class'],
  },
  {
    value: '#C026D3',
    label: 'Fuchsia',
    keywords: ['shopping', 'clothes', 'clothing', 'fashion', 'beauty', 'salon', 'personal', 'grooming'],
  },
  {
    value: '#DB2777',
    label: 'Pink',
    keywords: ['kids', 'children', 'child', 'baby', 'school fees', 'toys'],
  },
  {
    value: '#57534E',
    label: 'Stone',
    keywords: ['other', 'misc', 'miscellaneous', 'general', 'admin', 'tax', 'taxes', 'insurance', 'legal'],
  },
  {
    value: '#475569',
    label: 'Slate',
    keywords: ['work', 'office', 'business', 'tools', 'equipment', 'vehicle', 'car', 'bike', 'repair', 'service'],
  },
];

/**
 * The colour a category starts on when nothing is known about it.
 *
 * Indigo, matching the schema default, so a category created before this
 * feature existed and one created without touching the picker look identical.
 */
export const DEFAULT_CATEGORY_COLOR = '#4F46E5';

/**
 * Guess a colour from a typed category name.
 *
 * Scored exactly like `suggestCategoryIcon`, and for the same reason: the first
 * loose substring hit is usually the wrong one ("card" inside "cardiology"), so
 * every keyword that relates to the name is scored and the most specific match
 * wins. Sharing the shape also means the two suggestions move together as the
 * user types rather than one lagging the other.
 *
 * Returns null when nothing meaningfully matches, so the caller can leave the
 * user's own choice — or the default — in place rather than assigning a colour
 * at random.
 */
export function suggestCategoryColor(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return null;

  let best: { value: string; score: number } | null = null;

  for (const entry of CATEGORY_COLORS) {
    let score = 0;
    for (const keyword of entry.keywords) {
      const k = keyword.toLowerCase();
      // Two-character noise ("to", "at") would match half the alphabet.
      if (k.length < 3) continue;

      if (k.includes(' ')) {
        // Multi-word phrase ("fixed deposit"): match as a substring.
        if (n.includes(k)) score = Math.max(score, 6 + k.length);
        continue;
      }

      for (const word of words) {
        if (word === k) {
          score = Math.max(score, 10 + k.length); // exact whole-word match
        } else if (word.startsWith(k) || k.startsWith(word)) {
          // Prefix either way — "groc" ↔ "grocery", "electricity" ↔ "electric".
          if (word.length >= 3) score = Math.max(score, 6 + Math.min(k.length, word.length));
        } else if (word.length >= 4 && k.includes(word)) {
          score = Math.max(score, 3 + word.length);
        }
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { value: entry.value, score };
    }
  }

  return best?.value ?? null;
}
