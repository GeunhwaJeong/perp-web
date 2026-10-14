import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import styled, { css } from 'styled-components';

import {
  colors,
  icons,
  motion,
  radii,
  spacing,
  type,
  weights,
} from '@/views/dialogs/AccountDialog/tokens';

import { ArrowLeftIcon, ArrowRightIcon, ChevronRightIcon } from './icons';

/*
 * The drawer's building blocks follow Uniswap's AccountDrawer to the pixel (Spore tokens:
 * 368 wide, rounded 20, padding 16/20, type scale) with Sigma's colours. Each block names
 * the Uniswap component it mirrors.
 */

/** `IconButton size="small" emphasis="text-only"`: a 32 round hit area around a 24 icon. */
export const RoundIconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: ${radii.r32};
  color: ${colors.neutral2};
  background: transparent;
  transition: background-color ${motion.fast};

  &:hover {
    background: ${colors.surface2};
  }
`;

/** `ActionTile`: accent2 fill, rounded 16, padding 12, icon above a buttonLabel2 label. */
export const ActionTile = styled.button`
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: ${spacing.s12};
  padding: ${spacing.s12};
  border: 1px solid transparent;
  border-radius: ${radii.r16};
  background: ${colors.accent2};
  color: ${colors.accent1};
  ${type.button2}
  text-align: left;
  user-select: none;
  transition:
    background-color ${motion.fast},
    opacity ${motion.fast};

  &:hover:not(:disabled) {
    background: ${colors.accent2Hovered};
  }
  &:disabled {
    cursor: default;
    opacity: 0.6;
  }

  > svg {
    width: ${icons.i24}px;
    height: ${icons.i24}px;
    transition: transform ${motion.quick};
  }
  &:hover:not(:disabled) > svg {
    transform: rotate(-8deg) scale(1.08);
  }
`;

const pill = css<{ $fullWidth?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing.s8};
  width: ${({ $fullWidth }) => ($fullWidth ? '100%' : 'max-content')};
  padding: ${spacing.s8} ${spacing.s16};
  border: 1px solid ${colors.surface3};
  border-radius: ${radii.full};
  background: transparent;
  color: ${colors.neutral1};
  ${type.button3}
  transition:
    background-color ${motion.fast},
    border-color ${motion.fast};

  &:hover {
    background: ${colors.surface2};
  }

  > svg {
    width: ${icons.i20}px;
    height: ${icons.i20}px;
  }
`;

const $Pill = styled.button<{ $fullWidth?: boolean }>`
  ${pill}
`;

/** `ViewAllButton`: a small tertiary pill with the arrow after the label. */
export const ViewAllButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { fullWidth?: boolean }
>(({ fullWidth, children, ...props }, ref) => (
  <$Pill ref={ref} type="button" $fullWidth={fullWidth} {...props}>
    {children}
    <ArrowRightIcon />
  </$Pill>
));

/** `Button size="medium" emphasis="secondary"`: padding 12, rounded 16, surface3 border. */
export const SecondaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${spacing.s8};
  width: 100%;
  padding: ${spacing.s12};
  border: 1px solid ${colors.surface3};
  border-radius: ${radii.r16};
  background: transparent;
  color: ${colors.neutral1};
  ${type.button2}
  transition: border-color ${motion.fast};

  &:hover {
    border-color: ${colors.neutral3};
  }
  > svg {
    width: ${icons.i20}px;
    height: ${icons.i20}px;
    color: ${colors.neutral2};
  }
`;

/** `SectionHeader`: subheading2 in neutral2, 12 above and 4 below. */
export const SectionHeader = styled.div`
  padding: ${spacing.s12} 0 ${spacing.s4};
  ${type.subheading2}
  color: ${colors.neutral2};
`;

/**
 * `SettingsButton`: icon 24 + subheading2 title, state in body3 and a chevron on the right;
 * the row bleeds 12 past the column so its hover reaches the panel's edge.
 */
const $SettingsRow = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% + ${spacing.s24});
  margin: 0 -${spacing.s12};
  padding: ${spacing.s12};
  border-radius: ${radii.r12};
  background: transparent;
  color: ${colors.neutral1};
  text-align: left;
  transition: background-color ${motion.fast};

  &:hover {
    background: ${colors.surface2};
  }
`;

const $RowLead = styled.span`
  display: flex;
  align-items: center;
  gap: ${spacing.s12};
  ${type.subheading2}

  > svg {
    width: ${icons.i24}px;
    height: ${icons.i24}px;
    color: ${colors.neutral2};
    flex: none;
  }
`;

const $RowTrail = styled.span`
  display: flex;
  align-items: center;
  gap: ${spacing.s4};
  ${type.body3}
  color: ${colors.neutral2};
  white-space: nowrap;

  > svg {
    width: ${icons.i20}px;
    height: ${icons.i20}px;
    color: ${colors.neutral3};
  }
`;

export const SettingsRow = ({
  icon,
  title,
  state,
  showArrow = true,
  onClick,
}: {
  icon: ReactNode;
  title: ReactNode;
  state?: ReactNode;
  showArrow?: boolean;
  onClick: () => void;
}) => (
  <$SettingsRow type="button" onClick={onClick}>
    <$RowLead>
      {icon}
      {title}
    </$RowLead>
    <$RowTrail>
      {state}
      {showArrow && <ChevronRightIcon />}
    </$RowTrail>
  </$SettingsRow>
);

/** `Switch variant="branded"`: a 60 by 32 track with a 24 thumb and 4 of padding. */
const $Track = styled.button<{ $on: boolean }>`
  position: relative;
  flex: none;
  width: 60px;
  height: 32px;
  border-radius: ${radii.full};
  background: ${({ $on }) => ($on ? colors.accent1 : colors.neutral3)};
  transition: background-color 80ms ease-in-out;

  &::after {
    content: '';
    position: absolute;
    top: 4px;
    left: 4px;
    width: 24px;
    height: 24px;
    border-radius: ${radii.full};
    background: ${colors.white};
    transform: translateX(${({ $on }) => ($on ? '28px' : '0')});
    transition: transform 80ms ease-in-out;
  }
`;

export const Switch = ({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) => (
  <$Track
    type="button"
    role="switch"
    aria-checked={checked}
    $on={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  />
);

/** `SettingsToggle`: subheading2 title (body3 description) with the switch on the right. */
const $ToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${spacing.s12} 0;
`;

const $ToggleLead = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.s12};
  max-width: 80%;

  > svg {
    width: ${icons.i24}px;
    height: ${icons.i24}px;
    color: ${colors.neutral2};
    flex: none;
  }
`;

const $ToggleText = styled.div`
  display: flex;
  flex-direction: column;

  > strong {
    ${type.subheading2}
    font-weight: ${weights.book};
    color: ${colors.neutral1};
  }
  > span {
    ${type.body3}
    color: ${colors.neutral2};
  }
`;

export const SettingsToggle = ({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) => (
  <$ToggleRow>
    <$ToggleLead>
      {icon}
      <$ToggleText>
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </$ToggleText>
    </$ToggleLead>
    <Switch checked={checked} onChange={onChange} disabled={disabled} />
  </$ToggleRow>
);

/** `SegmentedControl` (default size): a 4 padded, rounded 20 track of rounded-full options. */
const $Segments = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.s8};
  min-height: 34px;
  padding: ${spacing.s4};
  border: 1px solid ${colors.surface3};
  border-radius: ${radii.r20};
  background: transparent;
`;

const $Segment = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: ${spacing.s2} ${spacing.s8};
  border-radius: ${radii.full};
  background: ${({ $active }) => ($active ? colors.surface3 : 'transparent')};
  color: ${({ $active }) => ($active ? colors.neutral1 : colors.neutral2)};
  ${type.button4}
  transition: background-color ${motion.fast};

  > svg {
    width: ${icons.i20}px;
    height: ${icons.i20}px;
  }
`;

export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (next: T) => void;
}) => (
  <$Segments role="radiogroup">
    {options.map((option) => (
      <$Segment
        key={option.value}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        $active={option.value === value}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </$Segment>
    ))}
  </$Segments>
);

/** `SlideOutMenu`: back arrow (15% column), centred subheading1 title, 24 below. */
const $SlideOut = styled.div`
  display: flex;
  flex-direction: column;
  margin-top: ${spacing.s4};
  padding: ${spacing.s12};
`;

const $SlideOutHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${spacing.s24};

  > button,
  > span {
    width: 15%;
  }
  > h3 {
    margin: 0;
    ${type.subheading1}
    color: ${colors.neutral1};
  }
`;

const $Back = styled.button`
  display: flex;
  align-items: center;
  color: ${colors.neutral2};
  background: transparent;

  > svg {
    width: ${icons.i24}px;
    height: ${icons.i24}px;
  }
`;

export const SlideOut = ({
  title,
  onBack,
  rightSlot,
  children,
}: {
  title: ReactNode;
  onBack: () => void;
  rightSlot?: ReactNode;
  children: ReactNode;
}) => (
  <$SlideOut>
    <$SlideOutHeader>
      <$Back type="button" aria-label="Back" onClick={onBack}>
        <ArrowLeftIcon />
      </$Back>
      <h3>{title}</h3>
      <span>{rightSlot}</span>
    </$SlideOutHeader>
    {children}
  </$SlideOut>
);
