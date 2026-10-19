/**
 * GameVerse design tokens. Dark theme first; the theme shape is a plain object so additional
 * themes can be added later without touching components.
 *
 * Direction: deep indigo / midnight navy foundations, with violet, electric-blue and coral accents
 * used sparingly. Contrast of every text/background pair is verified in tokens.spec.ts.
 */

export interface ThemeColors {
  /** App background. */
  background: string;
  /** Default card / sheet surface. */
  surface: string;
  /** Raised surface (modals, popovers, selected cards). */
  surfaceRaised: string;
  /** Subtle, DECORATIVE separators and card outlines only (not required to meet 3:1). */
  border: string;
  /** Boundaries of interactive controls (inputs, outlined buttons): WCAG 1.4.11 needs >= 3:1. */
  borderStrong: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Text placed on `primary` / `accentBlue` / `accentCoral` fills. */
  textOnAccent: string;

  /** Main brand action color (violet). */
  primary: string;
  primaryPressed: string;
  accentBlue: string;
  accentCoral: string;

  success: string;
  warning: string;
  danger: string;

  /** Presence indicator colors. */
  online: string;
  offline: string;
}

export const darkColors: ThemeColors = {
  background: '#0B0C24',
  surface: '#15173A',
  surfaceRaised: '#1E2150',
  border: '#33377A',
  borderStrong: '#6C71B8',

  textPrimary: '#F5F5FF',
  textSecondary: '#C3C6EE',
  textMuted: '#9DA2D6',
  textOnAccent: '#FFFFFF',

  primary: '#6A47F5',
  primaryPressed: '#5835DB',
  accentBlue: '#1F6FE0',
  accentCoral: '#C8352F',

  success: '#3DDC97',
  warning: '#FFC145',
  danger: '#FF6B6B',

  online: '#3DDC97',
  offline: '#6B6F9E',
};

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  fontFamily: {
    regular: 'System',
    medium: 'System',
    bold: 'System',
  },
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    display: 36,
  },
  lineHeight: {
    xs: 16,
    sm: 20,
    md: 24,
    lg: 26,
    xl: 30,
    xxl: 36,
    display: 44,
  },
  fontWeight: {
    regular: '400',
    medium: '600',
    bold: '700',
  },
} as const;

export const shadows = {
  none: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
} as const;

/** Restrained motion: short, purposeful. Respect the OS reduce-motion setting in components. */
export const motion = {
  duration: {
    instant: 80,
    fast: 150,
    normal: 250,
    slow: 400,
  },
  easing: {
    standard: [0.2, 0, 0, 1],
    decelerate: [0, 0, 0, 1],
    accelerate: [0.3, 0, 1, 1],
  },
} as const;

export const gradients = {
  /** Used selectively (hero headers, primary celebratory moments), never as a page background. */
  brand: ['#6A47F5', '#1F6FE0'],
  midnight: ['#0B0C24', '#15173A'],
} as const;

export const theme = {
  name: 'dark' as const,
  colors: darkColors,
  spacing,
  radii,
  typography,
  shadows,
  motion,
  gradients,
};

export type Theme = typeof theme;

/**
 * Ludo board colours. Player colours follow the rule numbering (top-left, top-right, bottom-right,
 * bottom-left = red, green, yellow, blue). A token is never told apart by colour alone: it carries
 * a dark outline and its number, and the legend names each colour.
 */
export const ludoColors = {
  /** Playing squares of the shared track. */
  track: '#FFFFFF',
  /** Outline of a square. */
  trackLine: '#CDD3E0',
  /** The marked star (safe) squares. */
  star: '#7A8196',
  /** Board background behind the cross. */
  boardBackground: '#FFFFFF',
  /** The dark frame around the board. */
  frame: '#1A1538',
  /** Player colours by board colour index 0-3. */
  players: ['#E5484D', '#2EB67D', '#F5C518', '#3E8BFF'],
  /** Soft tints of the same colours for bases and home columns. */
  tints: ['#F6B4B6', '#A6E3C8', '#FBE69A', '#B5D3FF'],
  /** Outline and numeral colour on a token. */
  tokenInk: '#0B0C24',
} as const;
