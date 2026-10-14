import { BonsaiHelpers } from '@/bonsai/ontology';
import styled from 'styled-components';

import { layoutMixins } from '@/styles/layoutMixins';

import { VerticalSeparator } from '@/components/Separator';
import { MarketStatsDetails } from '@/views/MarketStatsDetails';
import { MarketsDropdown } from '@/views/MarketsDropdown';

import { useAppSelector } from '@/state/appTypes';
import { getCurrentMarketDisplayId } from '@/state/perpetualsSelectors';

import { getAssetFromMarketId } from '@/lib/assetUtils';

export const MarketSelectorAndStats = ({ className }: { className?: string }) => {
  const imageUrl = useAppSelector(BonsaiHelpers.currentMarket.assetLogo);
  const marketId = useAppSelector(getCurrentMarketDisplayId) ?? '';

  return (
    <$Container className={className}>
      <MarketsDropdown
        currentMarketId={marketId}
        logoUrl={imageUrl}
        assetId={getAssetFromMarketId(marketId)}
      />

      <VerticalSeparator fullHeight />

      <MarketStatsDetails />
    </$Container>
  );
};
const $Container = styled.div`
  ${layoutMixins.container}
  ${layoutMixins.scrollAreaFadeEnd}
  
  display: grid;

  grid-template:
    var(--market-info-row-height)
    / auto;

  grid-auto-flow: column;
  justify-content: start;
  align-items: stretch;
`;
