import { Loadable, LoadableError, loadableIdle, LoadableSuccess } from '@/bonsai/lib/loadable';
// eslint-disable-next-line no-restricted-imports
import {
  AssetInfos,
  MarketsData,
  OrderbookData,
  OrdersData,
  ParentSubaccountData,
} from '@/bonsai/types/rawTypes';
import {
  ComplianceResponse,
  GeoState,
  HeightResponse,
  PerpetualMarketFeeDiscount,
} from '@/bonsai/types/summaryTypes';
import type { PerpAccountFees, PerpFeeSchedule } from '@/haneul/perp';
import { Coin } from '@cosmjs/proto-signing';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { WritableDraft } from 'immer';

import { DydxNetwork } from '@/constants/networks';
import { timeUnits } from '@/constants/time';
import {
  IndexerHistoricalBlockTradingRewardsResponse,
  IndexerParentSubaccountTransferResponse,
} from '@/types/indexer/indexerApiGen';
import {
  IndexerCompositeFillResponse,
  IndexerCompositeTradeHistoryResponse,
  IndexerSparklineResponseObject,
  IndexerOrderTicket,
} from '@/types/indexer/indexerManual';

import { calc } from '@/lib/do';

import { autoBatchAllReducers } from './autoBatchHelpers';

interface NetworkState {
  indexerClientReady: boolean;
  errorInitializing: boolean;
}

export type GeoHeaders = {
  status: string | 'restricted' | undefined;
  region: string | undefined;
  country: string | undefined;
  lastUpdated: string; // ISO timestamp of when this was stored
};

export type HeightEntry = {
  requestTime: string;
  receivedTime: string;
  // always undefined if Loadable is error
  response: HeightResponse | undefined;
};

export type HeightState = {
  latest: Loadable<HeightEntry>;
  // latest in front, will contain latest IFF latest is successful or error
  lastFewResults: Array<LoadableSuccess<HeightEntry> | LoadableError<HeightEntry>>;
};

export type ComplianceErrors = {
  errors?: any[];
};

export type ComplianceState = {
  geoHeaders: Loadable<GeoHeaders | undefined>;
  geo: Loadable<GeoState | undefined>;
  sourceAddressScreenV2: Loadable<ComplianceResponse & ComplianceErrors>;
};

export interface RawDataState {
  markets: {
    allMarkets: Loadable<MarketsData>;
    feeDiscounts: Loadable<PerpetualMarketFeeDiscount | undefined>;
    assets: Loadable<AssetInfos>;
    orderbooks: { [marketId: string]: Loadable<OrderbookData> };
    sparklines: Loadable<{
      [period: string]: IndexerSparklineResponseObject | undefined;
    }>;
    selectedMarketLeverages: Loadable<{ [marketId: string]: number }>;
  };
  account: {
    balances: Loadable<Coin[]>;
    fees: Loadable<PerpAccountFees | undefined>;
    parentSubaccount: Loadable<ParentSubaccountData>;
    fills: Loadable<IndexerCompositeFillResponse>;
    orders: Loadable<OrdersData>;
    orderTickets: Loadable<IndexerOrderTicket[]>;
    tradeHistory: Loadable<IndexerCompositeTradeHistoryResponse>;
    transfers: Loadable<IndexerParentSubaccountTransferResponse>;
    blockTradingRewards: Loadable<IndexerHistoricalBlockTradingRewardsResponse>;
  };
  network: {
    [networkId: string]: NetworkState;
  };
  heights: {
    indexerHeight: HeightState;
    validatorHeight: HeightState;
  };
  feeSchedule: Loadable<PerpFeeSchedule | undefined>;
  compliance: ComplianceState;
}

const initialState: RawDataState = {
  markets: {
    allMarkets: loadableIdle(),
    feeDiscounts: loadableIdle(),
    assets: loadableIdle(),
    orderbooks: {},
    sparklines: loadableIdle(),
    // TODO: this should actually be idle eventually, not success with empty data
    selectedMarketLeverages: { status: 'success', data: {} },
  },
  account: {
    parentSubaccount: loadableIdle(),
    balances: loadableIdle(),
    fees: loadableIdle(),
    fills: loadableIdle(),
    orders: loadableIdle(),
    orderTickets: loadableIdle(),
    tradeHistory: loadableIdle(),
    transfers: loadableIdle(),
    blockTradingRewards: loadableIdle(),
  },
  network: {},
  heights: {
    indexerHeight: { lastFewResults: [], latest: loadableIdle() },
    validatorHeight: { lastFewResults: [], latest: loadableIdle() },
  },
  feeSchedule: loadableIdle(),
  compliance: {
    geoHeaders: loadableIdle(),
    geo: loadableIdle(),
    sourceAddressScreenV2: loadableIdle(),
  },
};

export const rawSlice = createSlice({
  name: 'Raw data',
  initialState,
  reducers: {
    ...autoBatchAllReducers<RawDataState>()({
      setAllAssetsRaw: (state, action: PayloadAction<Loadable<AssetInfos>>) => {
        state.markets.assets = action.payload;
      },
      setSparklines: (
        state,
        action: PayloadAction<
          Loadable<{
            [period: string]: IndexerSparklineResponseObject | undefined;
          }>
        >
      ) => {
        state.markets.sparklines = action.payload;
      },
      setParentSubaccountRaw: (state, action: PayloadAction<Loadable<ParentSubaccountData>>) => {
        state.account.parentSubaccount = action.payload;
      },
      setAccountBalancesRaw: (state, action: PayloadAction<Loadable<Coin[]>>) => {
        state.account.balances = action.payload;
      },
      setAccountFeesRaw: (state, action: PayloadAction<Loadable<PerpAccountFees | undefined>>) => {
        state.account.fees = action.payload;
      },
      setFeeScheduleRaw: (state, action: PayloadAction<Loadable<PerpFeeSchedule | undefined>>) => {
        state.feeSchedule = action.payload;
      },
      setAccountFillsRaw: (
        state,
        action: PayloadAction<Loadable<IndexerCompositeFillResponse>>
      ) => {
        state.account.fills = action.payload;
      },
      setAccountTradesRaw: (
        state,
        action: PayloadAction<Loadable<IndexerCompositeTradeHistoryResponse>>
      ) => {
        state.account.tradeHistory = action.payload;
      },
      setAccountTransfersRaw: (
        state,
        action: PayloadAction<Loadable<IndexerParentSubaccountTransferResponse>>
      ) => {
        state.account.transfers = action.payload;
      },
      setAccountBlockTradingRewardsRaw: (
        state,
        action: PayloadAction<Loadable<IndexerHistoricalBlockTradingRewardsResponse>>
      ) => {
        state.account.blockTradingRewards = action.payload;
      },
      setAccountOrdersRaw: (state, action: PayloadAction<Loadable<OrdersData>>) => {
        state.account.orders = action.payload;
      },
      setAccountOrderTicketsRaw: (state, action: PayloadAction<Loadable<IndexerOrderTicket[]>>) => {
        state.account.orderTickets = action.payload;
      },
      setIndexerHeightRaw: (state, action: PayloadAction<Loadable<HeightEntry>>) => {
        appendToHeight(state.heights.indexerHeight, action.payload);
      },
      setValidatorHeightRaw: (state, action: PayloadAction<Loadable<HeightEntry>>) => {
        appendToHeight(state.heights.validatorHeight, action.payload);
      },
      setComplianceGeoRaw: (state, action: PayloadAction<Loadable<GeoState | undefined>>) => {
        state.compliance.geo = action.payload;
      },
      setComplianceGeoHeadersRaw: (
        state,
        action: PayloadAction<
          Loadable<Omit<GeoHeaders, 'lastUpdated'> | undefined> & { force?: boolean }
        >
      ) => {
        const now = Date.now();
        const lastUpdated = state.compliance.geoHeaders.data?.lastUpdated;

        // Update if forced, no data exists, or if it's been more than an hour since last update
        const shouldUpdate =
          action.payload.force === true ||
          !state.compliance.geoHeaders.data ||
          !lastUpdated ||
          now - new Date(lastUpdated).getTime() > timeUnits.hour;

        if (shouldUpdate && action.payload.status === 'success') {
          state.compliance.geoHeaders = {
            ...action.payload,
            data: action.payload.data
              ? {
                  ...action.payload.data,
                  lastUpdated: new Date().toISOString(),
                }
              : undefined,
          };
        }
      },
      setSourceAddressScreenV2Raw: (
        state,
        action: PayloadAction<Loadable<ComplianceResponse & ComplianceErrors>>
      ) => {
        state.compliance.sourceAddressScreenV2 = action.payload;
      },
      setSelectedMarketLeverage: (
        state,
        action: PayloadAction<{ marketId: string; leverage: number }>
      ) => {
        const { marketId, leverage } = action.payload;
        if (state.markets.selectedMarketLeverages.status === 'success') {
          state.markets.selectedMarketLeverages.data[marketId] = leverage;
        }
      },
      setSelectedMarketLeverages: (
        state,
        action: PayloadAction<Loadable<{ [marketId: string]: number }>>
      ) => {
        state.markets.selectedMarketLeverages = action.payload;
      },
    }),
    // orderbook is throttled separately for fine-grained control
    setOrderbookRaw: (
      state,
      action: PayloadAction<{ marketId: string; data: Loadable<OrderbookData> }>
    ) => {
      state.markets.orderbooks[action.payload.marketId] = action.payload.data;
    },
    setAllMarketsRaw: (state, action: PayloadAction<Loadable<MarketsData>>) => {
      state.markets.allMarkets = action.payload;
    },
    setNetworkStateRaw: (
      state,
      action: PayloadAction<{ networkId: DydxNetwork; stateToMerge: Partial<NetworkState> }>
    ) => {
      const { networkId, stateToMerge } = action.payload;
      state.network[networkId] = {
        ...(state.network[networkId] ?? {
          indexerClientReady: false,
          errorInitializing: false,
        }),
        ...stateToMerge,
      };
    },
    setMarketsFeeDiscountsRaw: (
      state,
      action: PayloadAction<Loadable<PerpetualMarketFeeDiscount | undefined>>
    ) => {
      state.markets.feeDiscounts = action.payload;
    },
  },
});

const HEIGHTS_BUFFER_LENGTH = 12;

function appendToHeight(height: WritableDraft<HeightState>, response: Loadable<HeightEntry>) {
  height.latest = response;

  // only want to append results with a different request time
  // we can get duplicates because of how the react query lifecycle works
  const matchesMostRecentSaved = calc(() => {
    const latest = height.lastFewResults[0];
    return (
      latest?.data?.requestTime != null && latest.data.requestTime === response.data?.requestTime
    );
  });
  if (matchesMostRecentSaved) {
    return;
  }
  if (response.status === 'error' || response.status === 'success') {
    height.lastFewResults.unshift(response);
  }
  if (height.lastFewResults.length > HEIGHTS_BUFFER_LENGTH) {
    height.lastFewResults.pop();
  }
}

export const {
  setOrderbookRaw,
  setAllMarketsRaw,
  setAllAssetsRaw,
  setSparklines,
  setParentSubaccountRaw,
  setAccountBalancesRaw,
  setAccountFeesRaw,
  setAccountFillsRaw,
  setAccountTradesRaw,
  setAccountOrdersRaw,
  setAccountOrderTicketsRaw,
  setAccountTransfersRaw,
  setAccountBlockTradingRewardsRaw,
  setNetworkStateRaw,
  setIndexerHeightRaw,
  setValidatorHeightRaw,
  setMarketsFeeDiscountsRaw,
  setFeeScheduleRaw,
  setComplianceGeoRaw,
  setComplianceGeoHeadersRaw,
  setSourceAddressScreenV2Raw,
  setSelectedMarketLeverage,
  setSelectedMarketLeverages,
} = rawSlice.actions;
