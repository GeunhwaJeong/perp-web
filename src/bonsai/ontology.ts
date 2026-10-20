import type { PerpAccountFees, PerpFeeSchedule } from '@/haneul/perp';
import BigNumber from 'bignumber.js';

import { GroupingMultiplier } from '@/constants/orderbook';
import {
  IndexerFundingPaymentResponseObject,
  IndexerHistoricalBlockTradingReward,
} from '@/types/indexer/indexerApiGen';
import { IndexerOrderTicket, IndexerWsTradesUpdateObject } from '@/types/indexer/indexerManual';

import { type RootState } from '@/state/_store';
import { getCurrentMarketId } from '@/state/currentMarketSelectors';

import { RecordValueType } from '@/lib/typeUtils';

import { HistoricalFundingObject } from './calculators/funding';
import { AdjustIsolatedMarginFormFns } from './forms/adjustIsolatedMargin';
import { TradeFormFns } from './forms/trade/trade';
import { TriggerOrdersFormFns } from './forms/triggers/triggers';
import { Loadable, LoadableStatus } from './lib/loadable';
import { useCurrentMarketHistoricalFunding } from './rest/funding';
import { useFundingPayments } from './rest/fundingPayments';
import { SubaccountPnlTick, useParentSubaccountHistoricalPnls } from './rest/historicalPnl';
import {
  getCurrentMarketAccountFills,
  selectAccountBlockRewardsLoading,
  selectAccountBlockTradingRewards,
  selectAccountFills,
  selectAccountFillsLoading,
  selectAccountOrders,
  selectAccountOrdersLoading,
  selectAccountOrderTickets,
  selectAccountOrderTicketsLoading,
  selectAccountTradesWithLeverage,
  selectAccountTradeHistoryLoading,
  selectAccountTransfers,
  selectAccountTransfersLoading,
  selectChildSubaccountSummaries,
  selectCurrentMarketBuyingPower,
  selectCurrentMarketInfoRaw,
  selectCurrentMarketOpenOrders,
  selectCurrentMarketOrderHistory,
  selectActiveTWAPOrders,
  selectOpenOrders,
  selectOrderHistory,
  selectParentSubaccountOpenPositions,
  selectTWAPFills,
  selectTWAPOrderHistory,
  selectParentSubaccountOpenPositionsLoading,
  selectParentSubaccountSummary,
  selectParentSubaccountSummaryLoading,
  selectRelevantMarketsData,
  selectUnopenedIsolatedPositions,
} from './selectors/account';
import {
  selectParentSubaccountSummaryDeposit,
  selectParentSubaccountSummaryWithdrawal,
} from './selectors/accountActions';
import {
  selectApiState,
  selectLatestIndexerHeight,
  selectLatestValidatorHeight,
} from './selectors/apiStatus';
import {
  selectAllAssetsInfo,
  selectAllAssetsInfoLoading,
  selectAssetInfo,
  selectAssetLogo,
} from './selectors/assets';
import { selectAccountBalances } from './selectors/balances';
import {
  selectRawAccountFeesData,
  selectRawFeeScheduleData,
  selectRawIndexerHeightDataLoading,
  selectRawMarketsData,
  selectRawParentSubaccountData,
  selectRawSelectedMarketLeveragesData,
  selectRawValidatorHeightDataLoading,
} from './selectors/base';
import { selectCompliance, selectComplianceLoading } from './selectors/compliance';
import { selectCurrentMarketOrderbookLoading } from './selectors/markets';
import {
  selectCurrentMarketDepthChart,
  selectCurrentMarketMidPrice,
  selectCurrentMarketOrderbook,
} from './selectors/orderbook';
import {
  selectAllMarketSummaries,
  selectAllMarketSummariesLoading,
  selectAllMarketSummariesStable,
  selectCurrentMarketAssetId,
  selectCurrentMarketAssetLogoUrl,
  selectCurrentMarketAssetName,
  selectCurrentMarketEffectiveSelectedLeverage,
  selectCurrentMarketInfo,
  selectCurrentMarketInfoStable,
  selectEffectiveSelectedMarketLeverage,
  selectMarketSummaryById,
} from './selectors/summary';
import { selectClientInitializationError } from './socketSelectors';
import { DepositUsdcProps, WithdrawUsdcProps } from './types/operationTypes';
import { DepthChartData, OrderbookProcessedData } from './types/orderbookTypes';
import { MarketsData, ParentSubaccountDataBase } from './types/rawTypes';
import {
  AccountBalances,
  AllAssetData,
  ApiState,
  AssetData,
  ChildSubaccountSummaries,
  Compliance,
  GroupedSubaccountSummary,
  HeightResponse,
  PendingIsolatedPosition,
  PerpetualMarketSummaries,
  PerpetualMarketSummary,
  StablePerpetualMarketSummaries,
  StablePerpetualMarketSummary,
  SubaccountFill,
  SubaccountOrder,
  SubaccountPosition,
  SubaccountTrade,
  SubaccountTransfer,
  TWAPSubaccountOrder,
} from './types/summaryTypes';
import { useCurrentMarketTradesValue } from './websocket/trades';

type BasicSelector<Result, Args extends any[] = []> = (state: RootState, ...args: Args) => Result;

// all data should be accessed via selectors in this file
// no files outside bonsai should access anything within bonsai except this file
interface BonsaiCoreShape {
  account: {
    parentSubaccountSummary: {
      data: BasicSelector<GroupedSubaccountSummary | undefined>;
      loading: BasicSelector<LoadableStatus>;
    };
    parentSubaccountPositions: {
      data: BasicSelector<SubaccountPosition[] | undefined>;
      loading: BasicSelector<LoadableStatus>;
    };
    childSubaccountSummaries: {
      data: BasicSelector<ChildSubaccountSummaries | undefined>;
      loading: BasicSelector<LoadableStatus>;
    };
    openOrders: {
      data: BasicSelector<SubaccountOrder[]>;
      loading: BasicSelector<LoadableStatus>;
    };
    orderHistory: {
      data: BasicSelector<SubaccountOrder[]>;
      loading: BasicSelector<LoadableStatus>;
    };
    orderTickets: {
      data: BasicSelector<IndexerOrderTicket[]>;
      loading: BasicSelector<LoadableStatus>;
    };
    allOrders: {
      data: BasicSelector<SubaccountOrder[]>;
      loading: BasicSelector<LoadableStatus>;
    };
    activeTwapOrders: {
      data: BasicSelector<TWAPSubaccountOrder[]>;
    };
    twapOrderHistory: {
      data: BasicSelector<TWAPSubaccountOrder[]>;
    };
    twapFills: {
      data: BasicSelector<SubaccountFill[]>;
    };
    fills: {
      data: BasicSelector<SubaccountFill[]>;
      loading: BasicSelector<LoadableStatus>;
    };
    tradeHistory: {
      data: BasicSelector<SubaccountTrade[]>;
      loading: BasicSelector<LoadableStatus>;
    };
    transfers: {
      data: BasicSelector<SubaccountTransfer[]>;
      loading: BasicSelector<LoadableStatus>;
    };
    blockTradingRewards: {
      data: BasicSelector<IndexerHistoricalBlockTradingReward[]>;
      loading: BasicSelector<LoadableStatus>;
    };
    fees: {
      data: BasicSelector<PerpAccountFees | undefined>;
    };
    balances: {
      data: BasicSelector<AccountBalances>;
    };
  };
  markets: {
    currentMarketId: BasicSelector<string | undefined>;
    markets: {
      data: BasicSelector<PerpetualMarketSummaries | undefined>;
      stableData: BasicSelector<StablePerpetualMarketSummaries | undefined>;
      loading: BasicSelector<LoadableStatus>;
    };
    assets: {
      data: BasicSelector<AllAssetData | undefined>;
      loading: BasicSelector<LoadableStatus>;
    };
  };
  network: {
    indexerHeight: {
      data: BasicSelector<HeightResponse | undefined>;
      loading: BasicSelector<LoadableStatus>;
    };
    validatorHeight: {
      data: BasicSelector<HeightResponse | undefined>;
      loading: BasicSelector<LoadableStatus>;
    };
    apiState: BasicSelector<ApiState | undefined>;
    clientInitializationError: BasicSelector<boolean | undefined>;
  };
  configs: {
    feeSchedule: BasicSelector<PerpFeeSchedule | undefined>;
  };
  compliance: { data: BasicSelector<Compliance>; loading: BasicSelector<LoadableStatus> };
}

export const BonsaiCore: BonsaiCoreShape = {
  account: {
    parentSubaccountSummary: {
      data: selectParentSubaccountSummary,
      loading: selectParentSubaccountSummaryLoading,
    },
    parentSubaccountPositions: {
      data: selectParentSubaccountOpenPositions,
      loading: selectParentSubaccountOpenPositionsLoading,
    },
    childSubaccountSummaries: {
      data: selectChildSubaccountSummaries,
      loading: selectParentSubaccountSummaryLoading,
    },
    allOrders: {
      data: selectAccountOrders,
      loading: selectAccountOrdersLoading,
    },
    openOrders: {
      data: selectOpenOrders,
      loading: selectAccountOrdersLoading,
    },
    orderHistory: {
      data: selectOrderHistory,
      loading: selectAccountOrdersLoading,
    },
    orderTickets: {
      data: selectAccountOrderTickets,
      loading: selectAccountOrderTicketsLoading,
    },
    activeTwapOrders: {
      data: selectActiveTWAPOrders,
    },
    twapOrderHistory: {
      data: selectTWAPOrderHistory,
    },
    twapFills: {
      data: selectTWAPFills,
    },
    fills: {
      data: selectAccountFills,
      loading: selectAccountFillsLoading,
    },
    tradeHistory: {
      data: selectAccountTradesWithLeverage,
      loading: selectAccountTradeHistoryLoading,
    },
    transfers: {
      data: selectAccountTransfers,
      loading: selectAccountTransfersLoading,
    },
    blockTradingRewards: {
      data: selectAccountBlockTradingRewards,
      loading: selectAccountBlockRewardsLoading,
    },
    fees: {
      data: selectRawAccountFeesData,
    },
    balances: {
      data: selectAccountBalances,
    },
  },
  markets: {
    currentMarketId: getCurrentMarketId,
    markets: {
      data: selectAllMarketSummaries,
      stableData: selectAllMarketSummariesStable,
      loading: selectAllMarketSummariesLoading,
    },
    assets: {
      data: selectAllAssetsInfo,
      loading: selectAllAssetsInfoLoading,
    },
  },
  network: {
    indexerHeight: {
      data: selectLatestIndexerHeight,
      loading: selectRawIndexerHeightDataLoading,
    },
    validatorHeight: {
      data: selectLatestValidatorHeight,
      loading: selectRawValidatorHeightDataLoading,
    },
    clientInitializationError: selectClientInitializationError,
    apiState: selectApiState,
  },
  configs: {
    feeSchedule: selectRawFeeScheduleData,
  },
  compliance: { data: selectCompliance, loading: selectComplianceLoading },
};

interface BonsaiRawShape {
  parentSubaccountBase: BasicSelector<ParentSubaccountDataBase | undefined>;
  // DANGER: only the CURRENT relevant markets, so you cannot use if your operation might make MORE markets relevant
  // e.g. any place order
  parentSubaccountRelevantMarkets: BasicSelector<MarketsData | undefined>;
  selectedMarketLeverages: BasicSelector<{ [marketId: string]: number } | undefined>;
  currentMarket: BasicSelector<RecordValueType<MarketsData> | undefined>;
  // DANGER: updates a lot
  allMarkets: BasicSelector<MarketsData | undefined>;
}

export const BonsaiRaw: BonsaiRawShape = {
  parentSubaccountBase: selectRawParentSubaccountData,
  parentSubaccountRelevantMarkets: selectRelevantMarketsData,
  selectedMarketLeverages: selectRawSelectedMarketLeveragesData,
  currentMarket: selectCurrentMarketInfoRaw,
  allMarkets: selectRawMarketsData,
};

interface BonsaiHelpersShape {
  currentMarket: {
    marketInfo: BasicSelector<PerpetualMarketSummary | undefined>;
    // marketInfo but with only the properties that rarely change, for fewer rerenders
    stableMarketInfo: BasicSelector<StablePerpetualMarketSummary | undefined>;

    // direct helpers
    assetId: BasicSelector<string | undefined>;
    assetLogo: BasicSelector<string | undefined>;
    assetName: BasicSelector<string | undefined>;
    effectiveSelectedLeverage: BasicSelector<number>;

    account: {
      buyingPower: BasicSelector<BigNumber | undefined>;
      openOrders: BasicSelector<SubaccountOrder[]>;
      orderHistory: BasicSelector<SubaccountOrder[]>;
      fills: BasicSelector<SubaccountFill[]>;
      tradeHistory: BasicSelector<SubaccountTrade[]>;
    };
    orderbook: {
      selectGroupedData: BasicSelector<
        OrderbookProcessedData | undefined,
        [GroupingMultiplier | undefined]
      >;
      loading: BasicSelector<LoadableStatus>;
    };
    midPrice: {
      data: BasicSelector<BigNumber | undefined>;
      loading: BasicSelector<LoadableStatus>;
    };
    depthChart: {
      data: BasicSelector<DepthChartData | undefined>;
      loading: BasicSelector<LoadableStatus>;
    };
  };
  assets: {
    selectAssetInfo: BasicSelector<AssetData | undefined, [string | undefined]>;
    selectAssetLogo: BasicSelector<string | undefined, [string | undefined]>;
  };
  markets: {
    selectMarketSummaryById: BasicSelector<
      PerpetualMarketSummary | undefined,
      [string | undefined]
    >;
    selectEffectiveSelectedMarketLeverage: BasicSelector<number, [string | undefined]>;
  };
  forms: {
    deposit: {
      selectParentSubaccountSummary: BasicSelector<
        GroupedSubaccountSummary | undefined,
        [DepositUsdcProps]
      >;
    };
    withdraw: {
      selectParentSubaccountSummary: BasicSelector<
        GroupedSubaccountSummary | undefined,
        [WithdrawUsdcProps]
      >;
    };
  };
  unopenedIsolatedPositions: BasicSelector<PendingIsolatedPosition[] | undefined>;
}

export const BonsaiHelpers: BonsaiHelpersShape = {
  currentMarket: {
    marketInfo: selectCurrentMarketInfo,
    stableMarketInfo: selectCurrentMarketInfoStable,
    assetId: selectCurrentMarketAssetId,
    assetLogo: selectCurrentMarketAssetLogoUrl,
    assetName: selectCurrentMarketAssetName,
    effectiveSelectedLeverage: selectCurrentMarketEffectiveSelectedLeverage,
    orderbook: {
      selectGroupedData: selectCurrentMarketOrderbook,
      loading: selectCurrentMarketOrderbookLoading,
    },
    midPrice: {
      data: selectCurrentMarketMidPrice,
      loading: selectCurrentMarketOrderbookLoading,
    },
    depthChart: {
      data: selectCurrentMarketDepthChart,
      loading: selectCurrentMarketOrderbookLoading,
    },
    account: {
      buyingPower: selectCurrentMarketBuyingPower,
      openOrders: selectCurrentMarketOpenOrders,
      orderHistory: selectCurrentMarketOrderHistory,
      fills: getCurrentMarketAccountFills,
      tradeHistory: selectAccountTradesWithLeverage,
    },
  },
  assets: {
    // only use this for launchable assets, otherwise use market info
    selectAssetInfo,
    selectAssetLogo,
  },
  markets: {
    selectMarketSummaryById,
    selectEffectiveSelectedMarketLeverage,
  },
  forms: {
    deposit: {
      selectParentSubaccountSummary: selectParentSubaccountSummaryDeposit,
    },
    withdraw: {
      selectParentSubaccountSummary: selectParentSubaccountSummaryWithdrawal,
    },
  },
  unopenedIsolatedPositions: selectUnopenedIsolatedPositions,
};

interface BonsaiHooksShape {
  useCurrentMarketHistoricalFunding: () => Loadable<HistoricalFundingObject[]>;
  useCurrentMarketLiveTrades: () => Loadable<IndexerWsTradesUpdateObject>;
  useParentSubaccountHistoricalPnls: () => Loadable<SubaccountPnlTick[]>;
  useFundingPayments: () => Loadable<IndexerFundingPaymentResponseObject[]>;
}

export const BonsaiHooks: BonsaiHooksShape = {
  useCurrentMarketHistoricalFunding,
  useCurrentMarketLiveTrades: useCurrentMarketTradesValue,
  useFundingPayments,
  useParentSubaccountHistoricalPnls,
};

export const BonsaiForms = {
  TradeFormFns,
  TriggerOrdersFormFns,
  AdjustIsolatedMarginFormFns,
};
