import styled from 'styled-components';

import { colors, radii } from '@/views/dialogs/AccountDialog/tokens';

import { SigmaBadgeIcon } from './icons';

/**
 * `StatusIcon`: a round account image with a hairline ring and, for a Sigma account, the
 * 16 badge tucked past the bottom-right edge by a quarter of its size. The image itself is
 * derived from the address (Uniswap draws a Unicon): two hues from the address bytes.
 */
const hue = (address: string, offset: number) => {
  const slice = address.slice(2 + offset, 2 + offset + 6);
  return Math.trunc(parseInt(slice || '0', 16) % 360);
};

const $Root = styled.div<{ $size: number }>`
  position: relative;
  flex: none;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
`;

const $Disc = styled.div<{ $size: number; $a: number; $b: number }>`
  width: 100%;
  height: 100%;
  border-radius: ${radii.full};
  background: linear-gradient(
    135deg,
    hsl(${({ $a }) => $a} 70% 62%),
    hsl(${({ $b }) => $b} 72% 48%)
  );
  outline: 1px solid ${colors.surface3};
  outline-offset: -1px;
`;

const $Badge = styled.div<{ $size: number }>`
  position: absolute;
  right: ${({ $size }) => -$size / 4}px;
  bottom: ${({ $size }) => -$size / 4}px;
  display: flex;
  border-radius: ${radii.r4};
  outline: 2px solid ${colors.surface1};
`;

export const Avatar = ({
  address,
  size = 48,
  badge = true,
}: {
  address: string;
  size?: number;
  badge?: boolean;
}) => (
  <$Root $size={size}>
    <$Disc $size={size} $a={hue(address, 0)} $b={hue(address, 24)} />
    {badge && (
      <$Badge $size={16}>
        <SigmaBadgeIcon size={16} />
      </$Badge>
    )}
  </$Root>
);
