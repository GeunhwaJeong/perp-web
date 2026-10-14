import { useMemo } from 'react';

import { BonsaiCore } from '@/bonsai/ontology';

import { HIDDEN_MARKETS } from '@/constants/hiddenMarkets';
import {
  HiddenMarketFilterTags,
  MARKET_FILTER_OPTIONS,
  MarketFilters,
  type MarketData,
} from '@/constants/markets';
import { StatsigFlags } from '@/constants/statsig';

import { useStatsigGateValue } from '@/hooks/useStatsig';

import { useAppSelector } from '@/state/appTypes';

import { isTruthy } from '@/lib/isTruthy';
import { getMarketDataFromPerpetualMarketSummary } from '@/lib/marketsHelpers';
import { MustBigNumber } from '@/lib/numbers';
import { objectKeys } from '@/lib/objectHelpers';
import { matchesSearchFilter } from '@/lib/search';
import { orEmptyObj } from '@/lib/typeUtils';

const RWA_EXCLUSION_LIST = new Set(['LINK']);

const filterFunctions: Record<MarketFilters, (market: MarketData) => boolean | undefined> = {
  [MarketFilters.AI]: (market) => {
    return market.sectorTags?.includes(MarketFilters.AI);
  },
  [MarketFilters.ALL]: () => true,
  [MarketFilters.DEFI]: (market) => {
    return (
      !!market.sectorTags?.includes(MarketFilters.DEFI) ||
      !!market.sectorTags?.includes(HiddenMarketFilterTags.DEX)
    );
  },
  [MarketFilters.DEPIN]: (market) => {
    return market.sectorTags?.includes(MarketFilters.DEPIN);
  },
  [MarketFilters.FAVORITE]: (market) => {
    return market.isFavorite;
  },
  [MarketFilters.FX]: (market) => {
    return market.sectorTags?.includes(MarketFilters.FX);
  },
  [MarketFilters.GAMING]: (market) => {
    return market.sectorTags?.includes(MarketFilters.GAMING);
  },
  [MarketFilters.LAYER_1]: (market) => {
    return market.sectorTags?.includes(MarketFilters.LAYER_1);
  },
  [MarketFilters.LAYER_2]: (market) => {
    return market.sectorTags?.includes(MarketFilters.LAYER_2);
  },
  [MarketFilters.MEMES]: (market) => {
    return market.sectorTags?.includes(MarketFilters.MEMES);
  },
  [MarketFilters.NEW]: (market) => {
    return market.isNew;
  },
  [MarketFilters.PREDICTION_MARKET]: (market) => {
    return market.sectorTags?.includes(MarketFilters.PREDICTION_MARKET);
  },
  [MarketFilters.RWA]: (market) => {
    return (
      market.sectorTags?.includes(MarketFilters.RWA) && !RWA_EXCLUSION_LIST.has(market.assetId)
    );
  },
};

export const useMarketsData = ({
  filter = MarketFilters.ALL,
  searchFilter,
}: {
  filter: MarketFilters;
  searchFilter?: string;
}): {
  markets: MarketData[];
  filteredMarkets: MarketData[];
  marketFilters: MarketFilters[];
  hasMarketIds: boolean;
  hasResults: boolean;
} => {
  const perpetualMarkets = orEmptyObj(useAppSelector(BonsaiCore.markets.markets.data));

  const hasMarketIds = Object.keys(perpetualMarkets).length > 0;

  const shouldFilterHiddenMarkets = useStatsigGateValue(StatsigFlags.ffHideMarketsFilter);
  const shouldFilterOpenInterest = useStatsigGateValue(StatsigFlags.ffOpenInterestFilter);

  const markets: MarketData[] = useMemo(() => {
    const listOfMarkets = Object.values(perpetualMarkets)
      .filter(isTruthy)
      // filter out markets that cannot be traded
      .filter((m) => m.status !== 'FINAL_SETTLEMENT')
      // temporarily filter out markets with empty/0 oracle price and $0 open interest
      .filter((m) => MustBigNumber(m.oraclePrice).gt(0))
      // filter out markets with $0 open interest (when gate is enabled)
      .filter((m) => !shouldFilterOpenInterest || MustBigNumber(m.openInterestUSDC).gt(0))
      // filter out hidden markets (when gate is enabled)
      .filter((m) => !shouldFilterHiddenMarkets || !HIDDEN_MARKETS.has(m.assetId))
      .map(getMarketDataFromPerpetualMarketSummary);

    return listOfMarkets;
  }, [perpetualMarkets, shouldFilterOpenInterest, shouldFilterHiddenMarkets]);

  const filteredMarkets = useMemo(() => {
    const filtered = markets.filter((m) => filterFunctions[filter](m));

    if (searchFilter) {
      return filtered.filter(
        ({ assetId, id, name }) =>
          matchesSearchFilter(searchFilter, name) ||
          matchesSearchFilter(searchFilter, assetId) ||
          matchesSearchFilter(searchFilter, id)
      );
    }
    return filtered;
  }, [markets, searchFilter, filter]);

  const marketFilters = useMemo(
    () => [
      ...objectKeys(MARKET_FILTER_OPTIONS).filter((marketFilter) =>
        markets.some((market) => filterFunctions[marketFilter](market))
      ),
    ],
    [markets]
  );

  return {
    marketFilters,
    filteredMarkets,
    hasMarketIds,
    markets,
    hasResults: filteredMarkets.length > 0,
  };
};
