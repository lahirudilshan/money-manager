import type { Ionicons } from '@expo/vector-icons';

/**
 * The single category icon set for the whole app — used by both "create
 * category" and "edit category" so the two never offer different icons. Each
 * entry carries the keywords that auto-suggest it from a typed name; more
 * specific words are listed earlier so the first match wins.
 */
export const CATEGORY_ICONS: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  keywords: string[];
}[] = [
  {
    icon: 'home-outline',
    label: 'Home',
    keywords: [
      'home', 'house', 'rent', 'housing', 'mortgage', 'lease', 'apartment', 'flat',
      'accommodation', 'landlord', 'boarding', 'household', 'maintenance', 'repair',
      'furniture', 'appliance', 'cleaning',
    ],
  },
  {
    icon: 'flash-outline',
    label: 'Electricity',
    keywords: ['electric', 'electricity', 'utility', 'utilities', 'power', 'energy', 'ceb', 'leco', 'bill', 'current'],
  },
  { icon: 'water-outline', label: 'Water', keywords: ['water', 'nwsdb', 'sewer', 'plumbing'] },
  { icon: 'flame-outline', label: 'Gas', keywords: ['gas', 'lpg', 'litro', 'laugfs', 'cooking', 'cylinder', 'heating'] },
  {
    icon: 'basket-outline',
    label: 'Groceries',
    keywords: [
      'grocery', 'groceries', 'market', 'supermarket', 'keells', 'cargills', 'arpico',
      'provisions', 'vegetables', 'fruit', 'rice', 'kitchen', 'pantry', 'household items',
    ],
  },
  {
    icon: 'restaurant-outline',
    label: 'Dining',
    keywords: ['dining', 'dine', 'eat', 'eating', 'restaurant', 'lunch', 'dinner', 'breakfast', 'meal', 'takeaway', 'food court', 'hotel'],
  },
  { icon: 'cafe-outline', label: 'Coffee', keywords: ['coffee', 'cafe', 'tea', 'snack', 'bakery'] },
  {
    icon: 'car-sport-outline',
    label: 'Vehicle',
    keywords: ['car', 'vehicle', 'transport', 'auto', 'motor', 'bike', 'motorbike', 'scooter', 'service', 'parking', 'toll'],
  },
  { icon: 'flame-outline', label: 'Fuel', keywords: ['fuel', 'petrol', 'diesel', 'gasoline', 'ioc', 'ceypetco', 'filling'] },
  { icon: 'bus-outline', label: 'Transport', keywords: ['bus', 'train', 'commute', 'travel pass', 'pickme', 'uber', 'taxi', 'tuk', 'three wheel', 'fare'] },
  {
    /*
     * A CARD keeps the card icon, and sits above the general debt entry so it
     * wins the match — "Credit card" contains "credit", and without this it
     * would fall through to the debt mark below.
     */
    icon: 'card-outline',
    label: 'Credit card',
    keywords: ['credit card', 'card', 'visa', 'mastercard', 'amex'],
  },
  {
    // Debt in general, matching the Debt category in the catalog. A card is one
    // PRODUCT among several here; these keywords cover leases, EMIs and pawning.
    icon: 'cash-outline',
    label: 'Debt',
    keywords: ['loan', 'debt', 'lease', 'leasing', 'installment', 'instalment', 'credit', 'emi', 'repayment', 'finance', 'hire purchase', 'pawning'],
  },
  {
    icon: 'medkit-outline',
    label: 'Health',
    keywords: ['health', 'medical', 'medicine', 'doctor', 'hospital', 'pharmacy', 'channeling', 'dental', 'dentist', 'clinic', 'lab', 'checkup'],
  },
  { icon: 'shield-checkmark-outline', label: 'Insurance', keywords: ['insurance', 'policy', 'premium', 'cover', 'life', 'aia', 'ceylinco'] },
  { icon: 'fitness-outline', label: 'Fitness', keywords: ['gym', 'fitness', 'workout', 'exercise', 'yoga', 'sport', 'sports'] },
  {
    icon: 'school-outline',
    label: 'Education',
    keywords: ['education', 'school', 'tuition', 'class', 'course', 'college', 'university', 'exam', 'stationery', 'kids school', 'daycare', 'montessori'],
  },
  { icon: 'book-outline', label: 'Books', keywords: ['book', 'books', 'reading', 'study', 'library'] },
  {
    icon: 'repeat-outline',
    label: 'Subscriptions',
    keywords: ['sub', 'subscription', 'subscriptions', 'recurring', 'membership', 'plan'],
  },
  { icon: 'tv-outline', label: 'Streaming', keywords: ['netflix', 'spotify', 'streaming', 'youtube', 'prime', 'disney', 'iflix', 'entertainment'] },
  {
    icon: 'wifi-outline',
    label: 'Internet',
    keywords: ['internet', 'wifi', 'broadband', 'fibre', 'fiber', 'router', 'slt', 'peotv', 'adsl'],
  },
  {
    icon: 'call-outline',
    label: 'Phone',
    keywords: ['phone', 'mobile', 'telecom', 'dialog', 'mobitel', 'hutch', 'airtel', 'reload', 'recharge', 'data', 'prepaid', 'postpaid'],
  },
  { icon: 'airplane-outline', label: 'Travel', keywords: ['travel', 'trip', 'flight', 'holiday', 'vacation', 'tour', 'ticket', 'visa', 'abroad'] },
  { icon: 'gift-outline', label: 'Gifts', keywords: ['gift', 'gifts', 'present', 'donation', 'charity', 'dana', 'offering', 'wedding', 'birthday'] },
  { icon: 'paw-outline', label: 'Pets', keywords: ['pet', 'pets', 'dog', 'cat', 'vet', 'animal', 'pet food'] },
  {
    icon: 'shirt-outline',
    label: 'Clothing',
    keywords: ['clothing', 'clothes', 'shirt', 'apparel', 'fashion', 'dress', 'shoes', 'garment', 'laundry'],
  },
  { icon: 'bag-handle-outline', label: 'Shopping', keywords: ['shopping', 'shop', 'purchase', 'mall', 'online', 'daraz', 'amazon'] },
  { icon: 'cut-outline', label: 'Grooming', keywords: ['salon', 'haircut', 'grooming', 'barber', 'spa', 'beauty', 'cosmetics'] },
  { icon: 'happy-outline', label: 'Kids', keywords: ['kids', 'child', 'children', 'baby', 'toys', 'diapers', 'milk powder'] },
  { icon: 'people-outline', label: 'Family', keywords: ['family', 'parents', 'household support', 'allowance'] },
  { icon: 'game-controller-outline', label: 'Games', keywords: ['game', 'games', 'gaming', 'playstation', 'xbox'] },
  { icon: 'wallet-outline', label: 'Savings', keywords: ['saving', 'savings', 'emergency', 'fund', 'fixed deposit', 'fd', 'invest', 'investment'] },
  { icon: 'cash-outline', label: 'Income', keywords: ['salary', 'income', 'wage', 'pay', 'bonus', 'freelance', 'business'] },
  { icon: 'construct-outline', label: 'Repairs', keywords: ['repairs', 'tools', 'diy', 'hardware', 'renovation'] },
  { icon: 'leaf-outline', label: 'Garden', keywords: ['garden', 'plants', 'nature', 'landscaping'] },
  { icon: 'albums-outline', label: 'Other', keywords: [] },
];

/** The default category icon when nothing is chosen or suggested. */
export const DEFAULT_CATEGORY_ICON: keyof typeof Ionicons.glyphMap = 'albums-outline';

/**
 * The full searchable icon catalog for the "more icons" modal — a broad,
 * recognisable set spanning the things people budget for. `label` is what the
 * search box matches against (plus the icon name itself). The quick-pick set
 * above is a curated subset shown inline.
 */
export const ALL_ICONS: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: 'home-outline', label: 'Home house rent housing mortgage' },
  { icon: 'bed-outline', label: 'Bedroom furniture' },
  { icon: 'flash-outline', label: 'Electricity utilities power energy' },
  { icon: 'water-outline', label: 'Water' },
  { icon: 'bulb-outline', label: 'Lighting idea' },
  { icon: 'flame-outline', label: 'Gas heating' },
  { icon: 'wifi-outline', label: 'Wifi internet broadband' },
  { icon: 'call-outline', label: 'Phone mobile telecom' },
  { icon: 'basket-outline', label: 'Groceries market shopping' },
  { icon: 'cart-outline', label: 'Cart shopping' },
  { icon: 'restaurant-outline', label: 'Dining eating restaurant food' },
  { icon: 'cafe-outline', label: 'Coffee cafe tea' },
  { icon: 'fast-food-outline', label: 'Fast food takeaway' },
  { icon: 'pizza-outline', label: 'Pizza food' },
  { icon: 'wine-outline', label: 'Wine drinks alcohol' },
  { icon: 'car-sport-outline', label: 'Car vehicle transport' },
  { icon: 'car-outline', label: 'Car taxi ride' },
  { icon: 'bus-outline', label: 'Bus public transport' },
  { icon: 'train-outline', label: 'Train rail' },
  { icon: 'bicycle-outline', label: 'Bicycle bike cycling' },
  { icon: 'airplane-outline', label: 'Travel flight holiday vacation' },
  { icon: 'boat-outline', label: 'Boat ferry' },
  { icon: 'card-outline', label: 'Loan debt credit card' },
  { icon: 'cash-outline', label: 'Cash money' },
  { icon: 'wallet-outline', label: 'Wallet money savings' },
  { icon: 'trending-up-outline', label: 'Investment income growth' },
  { icon: 'business-outline', label: 'Business office bank' },
  { icon: 'briefcase-outline', label: 'Work job briefcase' },
  { icon: 'medkit-outline', label: 'Health medical doctor pharmacy' },
  { icon: 'fitness-outline', label: 'Fitness gym exercise' },
  { icon: 'heart-outline', label: 'Health love charity' },
  { icon: 'school-outline', label: 'Education school tuition' },
  { icon: 'book-outline', label: 'Books reading study' },
  { icon: 'library-outline', label: 'Library books' },
  { icon: 'repeat-outline', label: 'Subscription recurring' },
  { icon: 'tv-outline', label: 'TV streaming entertainment' },
  { icon: 'game-controller-outline', label: 'Games gaming' },
  { icon: 'musical-notes-outline', label: 'Music streaming' },
  { icon: 'film-outline', label: 'Movies cinema film' },
  { icon: 'gift-outline', label: 'Gift present donation' },
  { icon: 'paw-outline', label: 'Pet dog cat vet' },
  { icon: 'shirt-outline', label: 'Clothes shopping apparel' },
  { icon: 'cut-outline', label: 'Haircut salon grooming' },
  { icon: 'sparkles-outline', label: 'Beauty cosmetics' },
  { icon: 'construct-outline', label: 'Repairs maintenance tools' },
  { icon: 'hammer-outline', label: 'Tools repair diy' },
  { icon: 'shield-checkmark-outline', label: 'Insurance protection' },
  { icon: 'people-outline', label: 'Family people' },
  { icon: 'happy-outline', label: 'Kids children fun' },
  { icon: 'football-outline', label: 'Sports football' },
  { icon: 'basketball-outline', label: 'Sports basketball' },
  { icon: 'leaf-outline', label: 'Garden plants nature' },
  { icon: 'phone-portrait-outline', label: 'Phone device gadget' },
  { icon: 'laptop-outline', label: 'Laptop computer tech' },
  { icon: 'camera-outline', label: 'Camera photography' },
  { icon: 'earth-outline', label: 'Travel world abroad' },
  { icon: 'umbrella-outline', label: 'Insurance rainy day emergency' },
  { icon: 'ellipsis-horizontal-outline', label: 'Miscellaneous other' },
  { icon: 'albums-outline', label: 'Other general category' },
];

/**
 * Suggest an icon from a category name by scoring every icon's keywords against
 * the typed words, so a name maps to the best-fitting icon rather than the first
 * loose substring hit. Returns null when nothing meaningfully matches.
 *
 * Scoring, per keyword that relates to the name:
 *  - a whole typed word equals the keyword → strongest (exact word)
 *  - a typed word starts with / contains the keyword as a word part → strong
 *  - a multi-word keyword phrase appears in the name → strong
 * Longer keywords beat shorter ones on ties (more specific), and single-letter
 * or 2-char noise is ignored so "a"/"to" can't trigger a match.
 */
export function suggestCategoryIcon(name: string): keyof typeof Ionicons.glyphMap | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return null;

  let best: { icon: keyof typeof Ionicons.glyphMap; score: number } | null = null;

  for (const entry of CATEGORY_ICONS) {
    let score = 0;
    for (const keyword of entry.keywords) {
      const k = keyword.toLowerCase();
      if (k.length < 3) continue;

      if (k.includes(' ')) {
        // Multi-word phrase (e.g. "fixed deposit"): match as a substring.
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
      best = { icon: entry.icon, score };
    }
  }

  return best?.icon ?? null;
}
