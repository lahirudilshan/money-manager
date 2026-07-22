/**
 * Design tokens — calm fintech direction.
 *
 * The subject is a monthly funding plan: money moving from income into
 * buckets, then out to bills. A deep blue->teal gradient carries the hero
 * figure and primary actions — trustworthy and calm rather than loud, the way
 * a real banking app reads. Status keeps its own three-step hue family
 * (orange/blue/green) so state never rides on the brand accent, and group
 * tiles are tinted solid so the board stays scannable at a glance.
 */

export const palette = {
  light: {
    // Grounds — cool near-white; the colour is meant to come from the
    // content (gradient hero, tinted tiles), not the canvas.
    canvas: '#F7F9FB',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#EEF2F6',
    hairline: '#E3E9EF',
    hairlineStrong: '#CDD6E0',

    ink: '#101828',
    inkSecondary: '#5B6472',
    inkMuted: '#8A93A0',
    inkInverse: '#FFFFFF',

    // Gradient accent — the two stops driving the hero card, chips and the
    // nav's centre action. Kept as named stops rather than a single hex so
    // every gradient usage in the app draws from the same pair.
    accent: '#0F6FDE',
    accentSoft: '#E8F1FD',
    accentInk: '#0A5BC4',
    gradientStart: '#0F6FDE',
    gradientEnd: '#0FA8A0',

    // Status progression: pending -> transferred -> completed. Full-strength
    // marks; the Soft pairs are tints for chip backgrounds. Distinct from the
    // brand accent so state never rides on it.
    pending: '#B7791F',
    pendingSoft: '#FBF1DE',
    transferred: '#0F6FDE',
    transferredSoft: '#E8F1FD',
    completed: '#0E9F6E',
    completedSoft: '#E3F9F0',

    // Reserved semantics, never reused as category colour.
    danger: '#DC2626',
    dangerSoft: '#FCE8E8',
    positive: '#0E9F6E',

    overlay: 'rgba(16, 24, 40, 0.45)',
  },
  dark: {
    canvas: '#0B1220',
    surface: '#141B2C',
    surfaceRaised: '#1B2438',
    surfaceSunken: '#0F1729',
    hairline: '#243046',
    hairlineStrong: '#334158',

    ink: '#F3F6FA',
    inkSecondary: '#A7B1C2',
    inkMuted: '#6B7688',
    inkInverse: '#0B1220',

    accent: '#4A9BF5',
    accentSoft: '#16273F',
    accentInk: '#7DBBFF',
    gradientStart: '#1E7FE0',
    gradientEnd: '#1FBFAE',

    pending: '#E3A94F',
    pendingSoft: '#2E240F',
    transferred: '#5CA8FA',
    transferredSoft: '#16263C',
    completed: '#3FD79A',
    completedSoft: '#0F2A20',

    danger: '#F0645F',
    dangerSoft: '#331717',
    positive: '#3FD79A',

    overlay: 'rgba(0, 0, 0, 0.65)',
  },
} as const;

/**
 * Categorical hues for groups — used only as an internal, auto-assigned
 * decorative tint (icon chips, board tiles); never a user-facing choice.
 * Kept away from pink/violet so nothing competes with the brand gradient.
 * Assigned in fixed order, never cycled by rank.
 */
export const groupColors = [
  '#0F6FDE',
  '#0E9F6E',
  '#B7791F',
  '#0FA8A0',
  '#5B6472',
  '#2E6BB8',
  '#7C8A3D',
  '#0891B2',
] as const;

/** Paired tile backgrounds for each group colour — used by the board grid. */
export const groupTints: Record<string, string> = {
  '#0F6FDE': '#E8F1FD',
  '#0E9F6E': '#E3F9F0',
  '#B7791F': '#FBF1DE',
  '#0FA8A0': '#E1F6F4',
  '#5B6472': '#EEF1F4',
  '#2E6BB8': '#E9F1FA',
  '#7C8A3D': '#F1F5E4',
  '#0891B2': '#E1F4F8',
};

/** 4px base grid. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

/**
 * Type scale. Money figures use tabular numerals so columns align and digits
 * do not jitter as values change. Heroes push heavier weight than the
 * previous pass to read as a fintech headline rather than a report figure.
 */
const tabular = { fontVariant: ['tabular-nums'] as const };

export const type = {
  hero: { fontSize: 40, fontWeight: '800' as const, letterSpacing: -1.4, ...tabular },
  display: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.9, ...tabular },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.5 },
  heading: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodyStrong: { fontSize: 15, fontWeight: '700' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  /** Money in lists and rows. */
  figure: { fontSize: 15, fontWeight: '700' as const, ...tabular },
  figureLarge: { fontSize: 19, fontWeight: '800' as const, letterSpacing: -0.3, ...tabular },
  /** Uppercase micro-label. */
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
  caption: { fontSize: 12, fontWeight: '500' as const },
} as const;

export const shadow = {
  none: {},
  card: {
    shadowColor: '#1A1625',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  lifted: {
    shadowColor: '#1A1625',
    shadowOpacity: 0.14,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  /** Stronger lift for the floating nav action button. */
  glow: {
    shadowColor: '#0F6FDE',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
} as const;

export type ThemeMode = 'light' | 'dark';

/** Colour roles widened to string so both palettes satisfy one shape. */
export type ThemeColors = { readonly [K in keyof typeof palette.light]: string };

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  shadow: typeof shadow;
  groupColors: typeof groupColors;
}

export function buildTheme(mode: ThemeMode): Theme {
  return {
    mode,
    colors: palette[mode],
    space,
    radius,
    type,
    shadow,
    groupColors,
  };
}

/** Every status value across both levels, so shared components can take any. */
export type StatusKey = 'pending' | 'paid' | 'transferred';

interface StatusVisual {
  fg: string;
  bg: string;
  label: string;
  icon: string;
}

/**
 * Colour pair + label + icon for a status. Status is never encoded by colour
 * alone — the icon and word always ride along.
 *
 * Two levels share this: a subcategory (bill) is pending/paid; a category
 * (bulk transfer) is pending/transferred. `paid` reuses the green "completed"
 * role, `transferred` the blue one.
 */
export function statusStyle(status: StatusKey, colors: ThemeColors): StatusVisual {
  switch (status) {
    case 'paid':
      return { fg: colors.completed, bg: colors.completedSoft, label: 'Paid', icon: 'checkmark-circle' };
    case 'transferred':
      return {
        fg: colors.transferred,
        bg: colors.transferredSoft,
        label: 'Transferred',
        icon: 'arrow-forward-circle',
      };
    default:
      return { fg: colors.pending, bg: colors.pendingSoft, label: 'Pending', icon: 'ellipse-outline' };
  }
}

export const STATUS_ICON: Record<StatusKey, string> = {
  pending: 'ellipse-outline',
  paid: 'checkmark-circle',
  transferred: 'arrow-forward-circle',
};

/** Tinted tile background for a group colour, falling back to a neutral. */
export function tintFor(color: string, colors: ThemeColors): string {
  return groupTints[color] ?? colors.surfaceSunken;
}

/**
 * Lighten (positive amount) or darken (negative) a #RRGGBB hex toward the
 * corresponding extreme. Bank brands carry a single hue, so this derives the
 * second gradient stop and the soft tints from it rather than storing a pair.
 */
export function shadeHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;

  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16);
    if (!Number.isFinite(value)) return 0;
    const target = amount < 0 ? 0 : 255;
    const shifted = Math.round(value + (target - value) * Math.abs(amount));
    return Math.max(0, Math.min(255, shifted));
  });

  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Low-alpha wash of a brand colour, for tinted row/section backgrounds. */
export function washFor(color: string, mode: ThemeMode): string {
  return shadeHex(color, mode === 'dark' ? -0.72 : 0.86);
}
