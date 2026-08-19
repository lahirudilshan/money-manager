/**
 * Subscription tiers, and which features each one unlocks.
 *
 * Kept as pure data so a screen never hard-codes "is this allowed" — it asks
 * `canUse`, and adding a tier or moving a feature between tiers is one edit
 * here rather than a hunt through the UI.
 *
 * Only the entitlement lives in this app. There is no billing, receipt
 * validation or store integration yet: `plan` is a local setting, so treat the
 * gate as product shaping rather than a security boundary.
 */

export type PlanId = 'free' | 'premium';

/** Features that a plan can unlock. One per gated capability. */
export type Feature = 'smartDetect';

/** One line item on a plan card. */
export interface Perk {
  label: string;
  /** A short "why it matters", shown under the label on the plans screen. */
  detail?: string;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** One line under the name on the plans screen. */
  tagline: string;
  /** Display price. Empty for free. */
  price: string;
  /** Billing period, shown beside the price. Empty for free. */
  period: string;
  /**
   * What this tier adds *on top of the one before it*. A paid plan lists only
   * its own additions; the screen shows the inherited ones separately, so the
   * upgrade is read as "everything you have, plus these" rather than two
   * competing lists the user has to diff.
   */
  perks: Perk[];
  features: readonly Feature[];
}

export const PLANS: readonly PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'The whole plan, tracked by hand.',
    price: '',
    period: '',
    perks: [
      {
        label: 'Unlimited categories, bills and accounts',
        detail: 'No caps on how much of your plan you can track.',
      },
      {
        label: 'Loans with interest and payoff dates',
        detail: 'See what each installment clears and when the debt ends.',
      },
      { label: 'Monthly funding board and reminders' },
      {
        label: 'Everything stays on your device',
        detail: 'No account, no sync, no server holding your finances.',
      },
    ],
    features: [],
  },
  {
    id: 'premium',
    name: 'Premium',
    // Short enough to fit the Settings row without truncating — the old
    // "Let your bank messages do the typing." was cut to "…do the ty…" there.
    tagline: 'Bank SMS become drafts.',
    price: 'LKR 450',
    period: '/ month',
    perks: [
      {
        label: 'Smart Detect reads your bank SMS',
        detail: 'Each alert becomes a draft with the amount, merchant and account filled in.',
      },
      {
        label: 'Learns every merchant you correct',
        detail: 'Fix a match once and the same shop is recognised automatically after that.',
      },
      {
        label: 'One tap to log a detected payment',
        detail: 'Confirm from the dashboard without opening the bill.',
      },
    ],
    features: ['smartDetect'],
  },
];

/**
 * The perks a plan inherits from the tiers below it — what the plans screen
 * shows as "everything in Free, plus…".
 */
export function inheritedPerks(id: PlanId): Perk[] {
  const index = PLANS.findIndex((plan) => plan.id === id);
  if (index <= 0) return [];
  return PLANS.slice(0, index).flatMap((plan) => plan.perks);
}

/** The definition for a plan id, falling back to Free for an unknown value. */
export function planById(id: PlanId): PlanDefinition {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}

/** Whether a plan unlocks a feature. */
export function canUse(plan: PlanId, feature: Feature): boolean {
  return planById(plan).features.includes(feature);
}

/**
 * The tier a feature needs — for the upgrade prompt, so it can name the plan
 * rather than saying "a paid plan". Null when nothing offers it.
 */
export function planFor(feature: Feature): PlanDefinition | null {
  return PLANS.find((plan) => plan.features.includes(feature)) ?? null;
}
