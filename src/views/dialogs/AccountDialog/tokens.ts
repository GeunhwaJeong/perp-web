import { css } from 'styled-components';

/**
 * The account screens follow Uniswap's onboarding layout to the pixel (their Spore
 * tokens: spacing, radii, type scale, motion) while the colors stay Sigma's own: the
 * black-and-purple theme the rest of the app runs on. Every value that is theirs is
 * named here once so the screens read as layout, not numbers.
 */

export const spacing = {
  s2: '2px',
  s4: '4px',
  s6: '6px',
  s8: '8px',
  s12: '12px',
  s16: '16px',
  s20: '20px',
  s24: '24px',
  s32: '32px',
  s48: '48px',
  s60: '60px',
} as const;

export const radii = {
  r4: '4px',
  r8: '8px',
  r12: '12px',
  r16: '16px',
  r20: '20px',
  r24: '24px',
  r32: '32px',
  full: '9999px',
} as const;

/** Spore icon sizes. */
export const icons = { i12: 12, i16: 16, i20: 20, i24: 24, i28: 28, i40: 40, i48: 48 } as const;

/** Modal: 480 wide including the 32 of padding; the mobile sheet uses 24. */
export const modal = {
  maxWidth: '480px',
  padding: spacing.s32,
  sheetPadding: spacing.s24,
} as const;

/** Spore surface roles mapped onto the app theme. */
export const colors = {
  surface1: 'var(--color-layer-3)',
  surface2: 'var(--color-layer-4)',
  surface2Hovered: 'var(--color-layer-5)',
  surface3: 'var(--color-border)',
  neutral1: 'var(--color-text-2)',
  neutral2: 'var(--color-text-1)',
  neutral3: 'var(--color-text-0)',
  accent1: 'var(--color-accent)',
  accent2: 'var(--color-accent-more-faded)',
  accent2Hovered: 'var(--color-accent-faded)',
  critical: 'var(--color-error)',
  success: 'var(--color-success)',
  white: 'var(--color-white)',
} as const;

/** Basel's Book is 485 and Medium 535; Switzer is variable so the same numbers apply. */
export const weights = { book: 485, medium: 535 } as const;

const face = (size: number, lineHeight: number, weight: number, letterSpacing = '0') => css`
  font-family: var(--fontFamily-base);
  font-size: ${size}px;
  line-height: ${lineHeight}px;
  font-weight: ${weight};
  letter-spacing: ${letterSpacing};
`;

export const type = {
  heading2: face(36, 40, weights.book, '-0.01em'),
  heading3: face(24, 28, weights.book, '-0.005em'),
  subheading1: face(18, 24, weights.book),
  subheading2: face(16, 24, weights.book),
  body2: face(16, 22, weights.book),
  body3: face(14, 18, weights.book),
  body4: face(12, 16, weights.book),
  button1: face(18, 24, weights.medium),
  button2: face(16, 24, weights.medium),
  button3: face(14, 20, weights.medium),
  button4: face(12, 16, weights.medium),
} as const;

/** Spore's medium shadow, dark theme: two soft layers of the surface colour. */
export const shadowMedium = css`
  box-shadow:
    0px 10px 15px -3px rgba(0, 0, 0, 0.54),
    0px 4px 6px -2px rgba(0, 0, 0, 0.4);
`;

/** Spore motion curves, byte for byte. */
export const motion = {
  fast: '100ms cubic-bezier(0.17, 0.67, 0.45, 1)',
  quick: '200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  quickLong: '300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  pager: '120ms cubic-bezier(0.17, 0.67, 0.45, 1)',
} as const;

export const shadowShort = css`
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.12),
    0 1px 2px rgba(0, 0, 0, 0.24);
`;
