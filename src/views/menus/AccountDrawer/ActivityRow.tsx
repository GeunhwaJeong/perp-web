import styled from 'styled-components';

import { AssetIcon } from '@/components/AssetIcon';
import { colors, icons, motion, radii, spacing, type } from '@/views/dialogs/AccountDialog/tokens';

import { ArrowDownCircleIcon, ArrowUpCircleIcon, SendIcon } from './icons';
import type { ActivityItem } from './useRecentActivity';

/**
 * `TransactionSummaryLayout`: a 40 logo with a 16 status badge at its bottom-right corner,
 * the title in body2 neutral2 over the caption in body2 neutral1, and the time in body3
 * neutral3 on the right. Padding 8, rounded 16, surface2 on hover.
 */
const $Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${spacing.s12};
  padding: ${spacing.s8};
  border-radius: ${radii.r16};
  transition: background-color ${motion.fast};

  &:hover {
    background: ${colors.surface2};
  }
`;

const $Logo = styled.div`
  position: relative;
  flex: none;
  width: ${icons.i40}px;
  height: ${icons.i40}px;

  > .asset {
    width: 100%;
    height: 100%;
    --asset-icon-size: ${icons.i40}px;
  }
`;

// The collateral has no logo of its own (the app's TUSD icon is TrueUSD's), so it shows as a
// lettered disc, the way the app shows any asset without one.
const $Collateral = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  border-radius: ${radii.full};
  background: ${colors.surface2};
  color: ${colors.neutral1};
  ${type.subheading2}
`;

const $Status = styled.div<{ $tone: 'up' | 'down' | 'neutral' }>`
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: flex;
  width: ${icons.i20}px;
  height: ${icons.i20}px;
  align-items: center;
  justify-content: center;
  border-radius: ${radii.full};
  background: ${colors.surface1};
  color: ${({ $tone }) =>
    $tone === 'up' ? colors.success : $tone === 'down' ? colors.critical : colors.neutral2};

  > svg {
    width: ${icons.i16}px;
    height: ${icons.i16}px;
  }
`;

const $Text = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${spacing.s2};
  min-width: 0;

  > span {
    ${type.body2}
    color: ${colors.neutral2};
  }
  > strong {
    ${type.body2}
    font-weight: inherit;
    color: ${colors.neutral1};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const $Time = styled.span`
  flex: none;
  align-self: flex-start;
  ${type.body3}
  color: ${colors.neutral3};
`;

const month = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const badge = (kind: ActivityItem['kind']) => {
  switch (kind) {
    case 'deposit':
    case 'buy':
      return { tone: 'up' as const, icon: <ArrowDownCircleIcon /> };
    case 'withdrawal':
    case 'sell':
      return { tone: 'down' as const, icon: <ArrowUpCircleIcon /> };
    default:
      return { tone: 'neutral' as const, icon: <SendIcon /> };
  }
};

export const ActivityRow = ({ item }: { item: ActivityItem }) => {
  const { tone, icon } = badge(item.kind);
  return (
    <$Row>
      <$Logo>
        {item.kind === 'buy' || item.kind === 'sell' ? (
          <AssetIcon symbol={item.symbol} className="asset" />
        ) : (
          <$Collateral>{item.symbol.charAt(0)}</$Collateral>
        )}
        <$Status $tone={tone}>{icon}</$Status>
      </$Logo>
      <$Text>
        <span>{item.title}</span>
        <strong>{item.caption}</strong>
      </$Text>
      <$Time>{item.at ? month.format(item.at) : ''}</$Time>
    </$Row>
  );
};
