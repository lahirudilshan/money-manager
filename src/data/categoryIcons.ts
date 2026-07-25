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
  { icon: 'home-outline', label: 'Home', keywords: ['home', 'house', 'rent', 'housing', 'mortgage'] },
  { icon: 'flash-outline', label: 'Utilities', keywords: ['electric', 'utility', 'utilities', 'power', 'ceb'] },
  { icon: 'water-outline', label: 'Water', keywords: ['water', 'nwsdb'] },
  { icon: 'basket-outline', label: 'Groceries', keywords: ['grocery', 'groceries', 'food', 'market', 'keells'] },
  { icon: 'restaurant-outline', label: 'Dining', keywords: ['dining', 'eat', 'restaurant', 'lunch', 'dinner'] },
  { icon: 'car-sport-outline', label: 'Vehicle', keywords: ['car', 'vehicle', 'fuel', 'petrol', 'transport'] },
  { icon: 'card-outline', label: 'Loans', keywords: ['loan', 'debt', 'lease', 'installment', 'credit'] },
  { icon: 'medkit-outline', label: 'Health', keywords: ['health', 'medical', 'doctor', 'pharmacy', 'insurance'] },
  { icon: 'school-outline', label: 'Education', keywords: ['education', 'school', 'tuition', 'class', 'course'] },
  { icon: 'repeat-outline', label: 'Subscriptions', keywords: ['sub', 'subscription', 'netflix', 'spotify', 'streaming'] },
  { icon: 'call-outline', label: 'Phone', keywords: ['phone', 'mobile', 'internet', 'dialog', 'telecom', 'wifi'] },
  { icon: 'airplane-outline', label: 'Travel', keywords: ['travel', 'trip', 'flight', 'holiday', 'vacation'] },
  { icon: 'gift-outline', label: 'Gifts', keywords: ['gift', 'present', 'donation', 'charity'] },
  { icon: 'paw-outline', label: 'Pets', keywords: ['pet', 'dog', 'cat', 'vet'] },
  { icon: 'shirt-outline', label: 'Shopping', keywords: ['shopping', 'clothes', 'shirt', 'apparel'] },
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

/** Suggest an icon from a category name; null when nothing matches. */
export function suggestCategoryIcon(name: string): keyof typeof Ionicons.glyphMap | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  for (const entry of CATEGORY_ICONS) {
    if (entry.keywords.some((k) => n.includes(k))) return entry.icon;
  }
  return null;
}
