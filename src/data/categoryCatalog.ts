/**
 * The pick-list that drives onboarding step 2.
 *
 * Onboarding asks the user to *recognise* their expenses rather than invent
 * and type them, so this catalog aims for coverage of ordinary Sri Lankan
 * household spending. Every suggestion carries a sensible default due-day and
 * an `income` flag where relevant; amounts are deliberately absent — step 3
 * collects those, and a wrong prefilled number is worse than an empty field.
 */

import type { Ionicons } from '@expo/vector-icons';

export interface CatalogSubcategory {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  type?: 'income' | 'expense';
  /** Default day of month; step 3 lets the user change it. */
  dueDay?: number;
  frequency?: 'monthly' | 'one_time' | 'yearly';
  /** Preselected when its parent category is chosen — the common cases. */
  common?: boolean;
}

export interface CatalogCategory {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  blurb: string;
  subcategories: CatalogSubcategory[];
}

export const CATEGORY_CATALOG: CatalogCategory[] = [
  {
    id: 'income',
    name: 'Income',
    icon: 'trending-up-outline',
    color: '#0E9F6E',
    blurb: 'What comes in each month',
    subcategories: [
      { id: 'salary', name: 'Salary', icon: 'wallet-outline', type: 'income', dueDay: 25, common: true },
      { id: 'freelance', name: 'Freelance / side work', icon: 'laptop-outline', type: 'income' },
      { id: 'rent-income', name: 'Rent received', icon: 'key-outline', type: 'income' },
      { id: 'interest', name: 'Interest / dividends', icon: 'trending-up-outline', type: 'income' },
      { id: 'other-income', name: 'Other income', icon: 'add-circle-outline', type: 'income' },
    ],
  },
  {
    id: 'housing',
    name: 'Housing',
    icon: 'home-outline',
    color: '#0F6FDE',
    blurb: 'Rent, utilities, and the roof over your head',
    subcategories: [
      { id: 'rent', name: 'Rent / mortgage', icon: 'home-outline', dueDay: 1, common: true },
      { id: 'electricity', name: 'Electricity (CEB / LECO)', icon: 'flash-outline', dueDay: 10, common: true },
      { id: 'water', name: 'Water', icon: 'water-outline', dueDay: 10, common: true },
      { id: 'gas', name: 'Gas', icon: 'flame-outline', dueDay: 5 },
      { id: 'internet', name: 'Internet / broadband', icon: 'wifi-outline', dueDay: 5, common: true },
      { id: 'maintenance', name: 'Repairs & maintenance', icon: 'construct-outline' },
      { id: 'domestic-help', name: 'Domestic help', icon: 'people-outline', dueDay: 1 },
      { id: 'garbage', name: 'Garbage / municipal', icon: 'trash-outline' },
    ],
  },
  {
    id: 'living',
    name: 'Living',
    icon: 'basket-outline',
    color: '#B7791F',
    blurb: 'Day-to-day essentials',
    subcategories: [
      { id: 'groceries', name: 'Groceries', icon: 'basket-outline', dueDay: 1, common: true },
      { id: 'dining', name: 'Eating out', icon: 'restaurant-outline' },
      { id: 'household', name: 'Household items', icon: 'cube-outline' },
      { id: 'clothing', name: 'Clothing', icon: 'shirt-outline' },
      { id: 'personal-care', name: 'Personal care', icon: 'cut-outline' },
      { id: 'mobile', name: 'Mobile / phone bill', icon: 'phone-portrait-outline', dueDay: 5, common: true },
    ],
  },
  {
    id: 'transport',
    name: 'Transport',
    icon: 'car-sport-outline',
    color: '#0FA8A0',
    blurb: 'Getting around',
    subcategories: [
      { id: 'fuel', name: 'Fuel', icon: 'speedometer-outline', common: true },
      { id: 'vehicle-service', name: 'Service & repairs', icon: 'build-outline' },
      { id: 'vehicle-insurance', name: 'Vehicle insurance', icon: 'shield-outline', frequency: 'yearly' },
      { id: 'license', name: 'Revenue licence', icon: 'document-text-outline', frequency: 'yearly' },
      { id: 'parking', name: 'Parking & tolls', icon: 'car-outline' },
      { id: 'public-transport', name: 'Bus / train / taxi', icon: 'bus-outline' },
    ],
  },
  {
    id: 'loans',
    name: 'Loans & credit',
    icon: 'card-outline',
    color: '#DC2626',
    blurb: 'Instalments and repayments',
    subcategories: [
      { id: 'personal-loan', name: 'Personal loan', icon: 'cash-outline', dueDay: 5, common: true },
      { id: 'lease', name: 'Vehicle lease', icon: 'car-sport-outline', dueDay: 5 },
      { id: 'housing-loan', name: 'Housing loan', icon: 'home-outline', dueDay: 5 },
      { id: 'credit-card', name: 'Credit card payment', icon: 'card-outline', dueDay: 15, common: true },
      { id: 'pawning', name: 'Pawning', icon: 'diamond-outline' },
    ],
  },
  {
    id: 'family',
    name: 'Family',
    icon: 'people-outline',
    color: '#7C8A3D',
    blurb: 'Children, parents, and support',
    subcategories: [
      { id: 'school-fees', name: 'School fees', icon: 'school-outline', dueDay: 1 },
      { id: 'tuition', name: 'Tuition / classes', icon: 'book-outline', dueDay: 1 },
      { id: 'childcare', name: 'Childcare', icon: 'happy-outline' },
      { id: 'parents', name: 'Support to parents', icon: 'heart-outline', dueDay: 1 },
      { id: 'kids-extras', name: "Children's extras", icon: 'balloon-outline' },
    ],
  },
  {
    id: 'health',
    name: 'Health',
    icon: 'medkit-outline',
    color: '#0891B2',
    blurb: 'Medical and wellbeing',
    subcategories: [
      { id: 'health-insurance', name: 'Health insurance', icon: 'shield-checkmark-outline', dueDay: 1 },
      { id: 'medicine', name: 'Medicine', icon: 'medkit-outline' },
      { id: 'doctor', name: 'Doctor / channelling', icon: 'pulse-outline' },
      { id: 'gym', name: 'Gym / fitness', icon: 'barbell-outline', dueDay: 1 },
    ],
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: 'repeat-outline',
    color: '#2E6BB8',
    blurb: 'Recurring digital spend',
    subcategories: [
      { id: 'streaming', name: 'Streaming (Netflix etc.)', icon: 'play-circle-outline', dueDay: 1 },
      { id: 'music', name: 'Music', icon: 'musical-notes-outline', dueDay: 1 },
      { id: 'cloud', name: 'Cloud storage', icon: 'cloud-outline', dueDay: 1 },
      { id: 'software', name: 'Software / apps', icon: 'apps-outline', dueDay: 1 },
      { id: 'news', name: 'News / memberships', icon: 'newspaper-outline', dueDay: 1 },
    ],
  },
  {
    id: 'savings',
    name: 'Savings & goals',
    icon: 'shield-checkmark-outline',
    color: '#0E9F6E',
    blurb: 'Money you set aside on purpose',
    subcategories: [
      { id: 'emergency', name: 'Emergency fund', icon: 'umbrella-outline', dueDay: 25, common: true },
      { id: 'fixed-deposit', name: 'Fixed deposit', icon: 'lock-closed-outline', dueDay: 25 },
      { id: 'investments', name: 'Investments', icon: 'trending-up-outline', dueDay: 25 },
      { id: 'vehicle-fund', name: 'Vehicle fund', icon: 'car-sport-outline' },
      { id: 'travel-fund', name: 'Travel fund', icon: 'airplane-outline' },
      { id: 'retirement', name: 'Retirement', icon: 'hourglass-outline' },
    ],
  },
  {
    id: 'lifestyle',
    name: 'Lifestyle',
    icon: 'sparkles-outline',
    color: '#5B6472',
    blurb: 'The enjoyable extras',
    subcategories: [
      { id: 'entertainment', name: 'Entertainment', icon: 'film-outline' },
      { id: 'travel', name: 'Travel & trips', icon: 'airplane-outline' },
      { id: 'gifts', name: 'Gifts', icon: 'gift-outline' },
      { id: 'donations', name: 'Donations / dana', icon: 'heart-circle-outline' },
      { id: 'hobbies', name: 'Hobbies', icon: 'color-palette-outline' },
      { id: 'events', name: 'Weddings & events', icon: 'people-circle-outline' },
    ],
  },
];

/** Flat lookup so step 3 can resolve a picked id back to its definition. */
export const CATALOG_SUBCATEGORY_BY_ID = new Map<
  string,
  { category: CatalogCategory; subcategory: CatalogSubcategory }
>(
  CATEGORY_CATALOG.flatMap((category) =>
    category.subcategories.map(
      (subcategory) => [subcategory.id, { category, subcategory }] as const,
    ),
  ),
);
