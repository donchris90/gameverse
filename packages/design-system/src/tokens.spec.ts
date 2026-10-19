import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb } from './contrast.js';
import { darkColors, gameGradients, ludoColors, radii, spacing } from './tokens.js';

const AA_NORMAL_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe('contrast helper', () => {
  it('matches known WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThan(4.5);
  });

  it('rejects malformed colors', () => {
    expect(() => hexToRgb('#abc')).toThrow();
    expect(() => hexToRgb('red')).toThrow();
  });
});

describe('dark theme accessibility', () => {
  const textColors = ['textPrimary', 'textSecondary', 'textMuted'] as const;
  const surfaces = ['background', 'surface', 'surfaceRaised'] as const;

  for (const text of textColors) {
    for (const surface of surfaces) {
      it(`${text} on ${surface} meets WCAG AA (4.5:1)`, () => {
        expect(contrastRatio(darkColors[text], darkColors[surface])).toBeGreaterThanOrEqual(
          AA_NORMAL_TEXT,
        );
      });
    }
  }

  for (const fill of ['primary', 'primaryPressed', 'accentBlue', 'accentCoral'] as const) {
    it(`textOnAccent on ${fill} meets WCAG AA (4.5:1)`, () => {
      expect(contrastRatio(darkColors.textOnAccent, darkColors[fill])).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
    });
  }

  for (const status of ['success', 'warning', 'danger'] as const) {
    it(`${status} is legible as text on the surface (4.5:1)`, () => {
      expect(contrastRatio(darkColors[status], darkColors.surface)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
    });
  }

  for (const surface of surfaces) {
    it(`borderStrong (control boundaries) on ${surface} meets WCAG 1.4.11 (3:1)`, () => {
      expect(contrastRatio(darkColors.borderStrong, darkColors[surface])).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    });
  }

  it('decorative border is still perceptible against the background (>= 1.5:1)', () => {
    // Decorative outlines are exempt from 3:1, but must not vanish entirely.
    expect(contrastRatio(darkColors.border, darkColors.background)).toBeGreaterThanOrEqual(1.5);
  });

  it('presence dots are distinguishable from surfaces (3:1)', () => {
    expect(contrastRatio(darkColors.online, darkColors.surface)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
    expect(contrastRatio(darkColors.offline, darkColors.surface)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });
});

describe('scale tokens', () => {
  it('spacing and radii scales are strictly increasing', () => {
    const spaces = Object.values(spacing);
    expect([...spaces].sort((a, b) => a - b)).toEqual(spaces);
    const radiusValues = Object.values(radii);
    expect([...radiusValues].sort((a, b) => a - b)).toEqual(radiusValues);
  });
});

describe('ludo board colours', () => {
  it('has four distinct player colours, tints and nothing else in their place', () => {
    expect(new Set(ludoColors.players).size).toBe(4);
    expect(new Set(ludoColors.tints).size).toBe(4);
  });

  it('keeps the numeral on every token readable (4.5:1 against its fill)', () => {
    for (const fill of ludoColors.players) {
      expect(contrastRatio(ludoColors.tokenInk, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps a token visible on the track and the board: its outline contrasts 3:1 with both', () => {
    expect(contrastRatio(ludoColors.tokenInk, ludoColors.track)).toBeGreaterThanOrEqual(3);
    for (const tint of ludoColors.tints) {
      expect(contrastRatio(ludoColors.tokenInk, tint)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the star squares visible on the track', () => {
    expect(contrastRatio(ludoColors.star, ludoColors.track)).toBeGreaterThanOrEqual(3);
  });
});

describe('Game Center gradients', () => {
  for (const [name, stops] of Object.entries(gameGradients)) {
    for (const stop of stops) {
      it(`${name} stop ${stop} keeps white text at 4.5:1`, () => {
        expect(contrastRatio('#FFFFFF', stop)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }
});
