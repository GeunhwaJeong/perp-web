import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import styled, { css, keyframes } from 'styled-components';

import { LoadingDots } from '@/components/Loading/LoadingDots';

import { ArrowLeftIcon, CloseIcon } from './icons';
import { colors, motion, radii, spacing, type } from './tokens';

/* ------------------------------------------------------------------ layout */

export const Column = styled.div<{ $gap?: string; $center?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap }) => $gap ?? '0'};
  ${({ $center }) =>
    $center &&
    css`
      align-items: center;
    `}
  width: 100%;
  min-width: 0;
`;

export const Row = styled.div<{ $gap?: string; $justify?: string; $align?: string }>`
  display: flex;
  flex-direction: row;
  align-items: ${({ $align }) => $align ?? 'center'};
  justify-content: ${({ $justify }) => $justify ?? 'flex-start'};
  gap: ${({ $gap }) => $gap ?? '0'};
  width: 100%;
  min-width: 0;
`;

/* ---------------------------------------------------------------- typography */

export const Heading = styled.h2`
  ${type.heading3}
  color: ${colors.neutral1};
  margin: 0;
  text-align: center;
`;

export const Subtext = styled.p<{ $maxWidth?: number }>`
  ${type.body2}
  color: ${colors.neutral2};
  margin: 0;
  text-align: center;
  ${({ $maxWidth }) =>
    $maxWidth &&
    css`
      max-width: ${$maxWidth}px;
    `}
`;

export const Label = styled.span`
  ${type.body3}
  color: ${colors.neutral2};
`;

export const Fine = styled.p`
  ${type.body4}
  color: ${colors.neutral3};
  margin: 0;
  text-align: center;

  a {
    color: inherit;
    text-decoration: underline;
  }
`;

export const ErrorText = styled.p<{ $indent?: number }>`
  ${type.body3}
  color: ${colors.critical};
  margin: 0;
  padding-left: ${({ $indent }) => ($indent ? `${$indent}px` : '0')};
`;

/* ------------------------------------------------------------------ buttons */

type BrandedButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'large' | 'medium';
  variant?: 'primary' | 'secondary' | 'surface';
  loading?: boolean;
  icon?: ReactNode;
};

const brandedVariants = {
  primary: css`
    background: ${colors.accent1};
    color: ${colors.white};

    &:hover:not(:disabled) {
      filter: brightness(0.92);
    }
  `,
  secondary: css`
    background: ${colors.accent2};
    color: ${colors.accent1};

    &:hover:not(:disabled) {
      background: ${colors.accent2Hovered};
    }
  `,
  surface: css`
    background: ${colors.surface2};
    color: ${colors.neutral1};

    &:hover:not(:disabled) {
      background: ${colors.surface2Hovered};
    }
  `,
};

const $BrandedButton = styled.button<{
  $size: 'large' | 'medium';
  $variant: keyof typeof brandedVariants;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing.s8};
  width: 100%;
  height: ${({ $size }) => ($size === 'large' ? '56px' : '48px')};
  padding: 0 ${spacing.s16};
  border: 0;
  border-radius: ${radii.full};
  ${({ $size }) => ($size === 'large' ? type.button1 : type.button2)}
  cursor: pointer;
  transition:
    background ${motion.fast},
    filter ${motion.fast},
    opacity ${motion.fast};
  ${({ $variant }) => brandedVariants[$variant]}

  &:disabled {
    cursor: default;
    background: ${colors.surface3};
    color: ${colors.neutral2};
    filter: none;
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent1};
    outline-offset: 2px;
  }
`;

export const BrandedButton = forwardRef<HTMLButtonElement, BrandedButtonProps>(
  ({ size = 'medium', variant = 'primary', loading, icon, children, disabled, ...props }, ref) => (
    <$BrandedButton
      ref={ref}
      type="button"
      $size={size}
      $variant={variant}
      disabled={(disabled ?? false) || (loading ?? false)}
      {...props}
    >
      {loading ? (
        <LoadingDots size={3} />
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </$BrandedButton>
  )
);
BrandedButton.displayName = 'BrandedButton';

/** A link-styled action: "Log in", "Forgot password?". */
export const TextButton = styled.button<{ $muted?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.s4};
  padding: ${spacing.s4} 0;
  border: 0;
  background: none;
  ${type.button2}
  color: ${({ $muted }) => ($muted ? colors.neutral2 : colors.accent1)};
  cursor: pointer;
  transition: opacity ${motion.fast};

  &:hover:not(:disabled) {
    opacity: 0.8;
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const $IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: -4px;
  padding: 0;
  border: 0;
  border-radius: ${radii.r8};
  background: none;
  color: ${colors.neutral2};
  cursor: pointer;
  transition: color ${motion.fast};

  &:hover {
    color: ${colors.neutral1};
  }
`;

export const BackButton = (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <$IconButton type="button" aria-label="Back" {...props}>
    <ArrowLeftIcon size={20} />
  </$IconButton>
);

export const CloseButton = (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <$IconButton type="button" aria-label="Close" {...props}>
    <CloseIcon size={20} />
  </$IconButton>
);

/* ----------------------------------------------------------------- options */

/** The rounded group the wallet rows sit in; the 2px gaps read as separators. */
export const OptionGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  border-radius: ${radii.r16};
  overflow: hidden;
`;

export const OptionRow = styled.button`
  display: flex;
  align-items: center;
  gap: ${spacing.s12};
  width: 100%;
  min-height: 64px;
  padding: ${spacing.s12};
  border: 0;
  background: ${colors.surface2};
  color: ${colors.neutral1};
  text-align: left;
  cursor: pointer;
  transition: background ${motion.fast};

  &:hover:not(:disabled) {
    background: ${colors.surface2Hovered};
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`;

export const OptionIcon = styled.div<{ $tint?: boolean; $size?: number }>`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: ${({ $size }) => $size ?? 40}px;
  height: ${({ $size }) => $size ?? 40}px;
  border-radius: ${radii.r8};
  overflow: hidden;
  ${({ $tint }) =>
    $tint &&
    css`
      background: ${colors.accent2};
      color: ${colors.accent1};
    `}

  img,
  svg {
    width: 100%;
    height: 100%;
  }
`;

export const OptionLabel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;

  > span:first-child {
    ${type.body2}
    color: ${colors.neutral1};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  > span + span {
    ${type.body4}
    color: ${colors.neutral2};
  }
`;

export const OptionDetail = styled.div`
  display: flex;
  align-items: center;
  flex: none;
  color: ${colors.neutral3};
`;

/* ----------------------------------------------------------------- dividers */

const $Divider = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.s16};
  width: 100%;
  padding: ${spacing.s4} ${spacing.s12};

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: ${colors.surface3};
  }

  span {
    ${type.body4}
    color: ${colors.neutral3};
  }
`;

export const OrDivider = ({ label = 'or' }: { label?: string }) => (
  <$Divider>
    <span>{label}</span>
  </$Divider>
);

/* ------------------------------------------------------------- screen frame */

const $Frame = styled.div<{ $gap?: string }>`
  display: flex;
  flex-direction: column;
  width: 100%;
`;

const $TopRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-height: 20px;
`;

const $Body = styled.div<{ $gap: string }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ $gap }) => $gap};
  width: 100%;
`;

const $HeaderBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${spacing.s24};
  width: 100%;
`;

const $Titles = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${spacing.s12};
  width: 100%;
`;

/**
 * One account screen: a top row with back and close, a header illustration, title and
 * subtext, the screen's own content, then a footer. The gaps are the Spore modal's
 * (16 between blocks, 24 under the header, 12 under the title).
 */
export const ScreenFrame = ({
  title,
  subtext,
  header,
  footer,
  goBack,
  onClose,
  gap = spacing.s16,
  children,
}: {
  title: ReactNode;
  subtext?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  goBack?: () => void;
  onClose?: () => void;
  gap?: string;
  children?: ReactNode;
}) => (
  <$Frame>
    <$TopRow>
      <div>{goBack && <BackButton onClick={goBack} />}</div>
      <div>{onClose && <CloseButton onClick={onClose} />}</div>
    </$TopRow>
    <$Body $gap={gap}>
      <$HeaderBlock>
        {header}
        <$Titles>
          <Heading>{title}</Heading>
          {typeof subtext === 'string' ? <Subtext>{subtext}</Subtext> : subtext}
        </$Titles>
      </$HeaderBlock>
      {children}
    </$Body>
    {footer}
  </$Frame>
);

/* ------------------------------------------------------------ illustrations */

/** Σ in a rounded tile, the stand-in for the Uniswap unicorn card. */
export const BrandTile = styled.div<{ $size?: number }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${({ $size }) => $size ?? 64}px;
  height: ${({ $size }) => $size ?? 64}px;
  border-radius: ${radii.r16};
  background: ${colors.accent2};
  color: ${colors.accent1};
`;

const $IconPair = styled.div`
  position: relative;
  width: 80px;
  height: 48px;
`;

const $PairTile = styled.div<{ $side: 'left' | 'right' }>`
  position: absolute;
  top: 0;
  ${({ $side }) => ($side === 'left' ? 'left: 0;' : 'right: 0;')}
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${spacing.s12};
  border-radius: ${radii.r16};
  background: ${colors.surface2};
  color: ${colors.neutral1};
  ${({ $side }) =>
    $side === 'left'
      ? css`
          transform: rotate(-15deg) translateY(-5px);
        `
      : css`
          transform: rotate(15deg);
          border: 2px solid ${colors.surface1};
        `}
`;

/** Two tilted tiles, the header of the create screen. */
export const IconPairHeader = ({ left, right }: { left: ReactNode; right: ReactNode }) => (
  <$IconPair>
    <$PairTile $side="left">{left}</$PairTile>
    <$PairTile $side="right">{right}</$PairTile>
  </$IconPair>
);

/* ----------------------------------------------------------------- keyframes */

export const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;
