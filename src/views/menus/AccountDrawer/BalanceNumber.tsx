import styled from 'styled-components';

import { colors, icons, spacing, type } from '@/views/dialogs/AccountDialog/tokens';

import { CaretIcon } from './icons';

/**
 * `AnimatedNumber` + `RelativeChange`: the portfolio value in heading2 with tabular digits
 * and the decimals faded to neutral2, and a caret with the change in body3 underneath.
 */
const $Value = styled.div`
  ${type.heading2}
  color: ${colors.neutral1};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  > span {
    color: ${colors.neutral2};
  }
`;

const $Change = styled.div<{ $tone: 'up' | 'down' | 'flat' }>`
  display: flex;
  align-items: center;
  gap: ${spacing.s2};
  ${type.body3}
  color: ${({ $tone }) =>
    $tone === 'up' ? colors.success : $tone === 'down' ? colors.critical : colors.neutral2};

  > svg {
    width: ${icons.i16}px;
    height: ${icons.i16}px;
  }
`;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** "US$0.80" split so the cents can be faded: ["US$0", ".80"]. */
const splitDecimals = (value: number) => {
  const text = usd.format(value).replace('$', 'US$');
  const dot = text.lastIndexOf('.');
  return dot === -1 ? [text, ''] : [text.slice(0, dot), text.slice(dot)];
};

export const BalanceNumber = ({
  value,
  loading,
}: {
  value: number | undefined;
  loading?: boolean;
}) => {
  const [whole, decimals] = splitDecimals(loading ? 0 : (value ?? 0));
  return (
    <$Value aria-live="polite" style={loading ? { opacity: 0.4 } : undefined}>
      {whole}
      <span>{decimals}</span>
    </$Value>
  );
};

export const RelativeChange = ({
  absolute,
  percent,
}: {
  absolute: number | undefined;
  percent: number | undefined;
}) => {
  if (absolute == null || percent == null) return null;
  const tone = absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat';
  return (
    <$Change $tone={tone}>
      {tone !== 'flat' && <CaretIcon up={tone === 'up'} />}
      {usd.format(Math.abs(absolute)).replace('$', 'US$')} ({Math.abs(percent).toFixed(2)}%)
    </$Change>
  );
};
