import { setUpLocalOrdersOrdersSync } from './lifecycles/localOrders';
import { setUpAssetsQuery } from './rest/assets';
import { setUpBlockTradingRewardsQuery } from './rest/blockTradingRewards';
import { setUpIndexerSourceAddressScreenV2Query } from './rest/compliance';
import { setUpAccountFeesQuery, setUpFeeScheduleQuery } from './rest/fees';
import { setUpFillsQuery } from './rest/fills';
import { setUpGeoQuery } from './rest/geo';
import { setUpIndexerHeightQuery, setUpValidatorHeightQuery } from './rest/height';
import { setUpUserLeverageParamsQuery } from './rest/leverage';
import { alwaysUseCurrentNetworkClient } from './rest/lib/compositeClientManager';
import { setUpOrderTicketsQuery } from './rest/orderTickets';
import { setUpOrdersQuery } from './rest/orders';
import { setUpSparklinesQuery } from './rest/sparklines';
import { setUpTradeHistoryQuery } from './rest/tradeHistory';
import { setUpTransfersQuery } from './rest/transfers';
import { setUpAccountBalancesQuery } from './rest/validatorAccountMetadata';
import { setUpMarkets } from './websocket/markets';
import { setUpOrderbook } from './websocket/orderbook';
import { setUpParentSubaccount } from './websocket/parentSubaccount';

export const storeLifecycles = [
  alwaysUseCurrentNetworkClient,
  setUpMarkets,
  setUpAssetsQuery,
  setUpParentSubaccount,
  setUpFillsQuery,
  setUpUserLeverageParamsQuery,
  setUpOrdersQuery,
  setUpOrderTicketsQuery,
  setUpTradeHistoryQuery,
  setUpTransfersQuery,
  setUpBlockTradingRewardsQuery,
  setUpOrderbook,
  setUpSparklinesQuery,
  setUpIndexerHeightQuery,
  setUpValidatorHeightQuery,
  setUpAccountBalancesQuery,
  setUpAccountFeesQuery,
  setUpFeeScheduleQuery,
  setUpLocalOrdersOrdersSync,
  setUpGeoQuery,
  setUpIndexerSourceAddressScreenV2Query,
] as const;
