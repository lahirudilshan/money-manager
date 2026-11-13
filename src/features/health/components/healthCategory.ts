import type { Ionicons } from '@expo/vector-icons';

/**
 * How each group of tests looks: an everyday title, an icon and a category
 * colour from the design system — so "Blood count" and "Blood sugar" read as
 * places on a body, not database labels.
 */
export interface CategoryLook {
  title: string;
  /** Two words at most, for a small tile — "Sugar", "Kidneys". */
  short: string;
  /** What a report of this kind is called — "Full blood count". */
  reportName: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const LOOKS: Record<string, CategoryLook> = {
  'Blood sugar': { short: 'Sugar', reportName: 'Blood sugar test', title: 'Blood sugar', icon: 'water', color: '#D97706' },
  'Cholesterol & fats': { short: 'Cholesterol', reportName: 'Cholesterol test', title: 'Cholesterol and blood fats', icon: 'heart-half', color: '#E11D48' },
  Kidney: { short: 'Kidneys', reportName: 'Kidney test', title: 'Kidneys', icon: 'funnel', color: '#0D9488' },
  Liver: { short: 'Liver', reportName: 'Liver test', title: 'Liver', icon: 'leaf', color: '#16A34A' },
  'Blood count': { short: 'Blood count', reportName: 'Full blood count', title: 'Blood count', icon: 'color-fill', color: '#DC2626' },
  Thyroid: { short: 'Thyroid', reportName: 'Thyroid test', title: 'Thyroid', icon: 'pulse', color: '#4F46E5' },
  'Vitamins & minerals': { short: 'Vitamins', reportName: 'Vitamin and mineral test', title: 'Vitamins and minerals', icon: 'nutrition', color: '#EA580C' },
  Heart: { short: 'Heart', reportName: 'Heart test', title: 'Heart and blood pressure', icon: 'heart', color: '#DB2777' },
  Urine: { short: 'Urine', reportName: 'Urine test', title: 'Urine', icon: 'beaker', color: '#0891B2' },
  'Infection & inflammation': { short: 'Infection', reportName: 'Infection test', title: 'Infection and swelling', icon: 'shield-checkmark', color: '#7C3AED' },
  Hormones: { short: 'Hormones', reportName: 'Hormone test', title: 'Hormones', icon: 'flask', color: '#9333EA' },
};

export function categoryLook(category: string): CategoryLook {
  return LOOKS[category] ?? { short: category || 'Other', reportName: 'Lab test', title: category || 'Other tests', icon: 'ellipsis-horizontal-circle', color: '#475569' };
}

/**
 * The health screens' own kinds, each pinned to a design-system category
 * colour so no screen invents a hex: a reading is pink, a report or photo is
 * violet, blood is red, weight is teal. Used as a solid fill behind a white
 * icon, or as an icon tint — never as body text.
 */
export const HEALTH_TINT = {
  reading: '#DB2777',
  report: '#7C3AED',
  blood: '#DC2626',
  weight: '#0D9488',
  waist: '#7C3AED',
} as const;

/** White type on a filled category colour — the same in both themes. */
export const ON_FILL = '#FFFFFF';
