import { setUpCancelOrphanedTriggerOrdersLifecycle } from './lifecycles/cancelTriggerOrdersLifecycle';
import { setUpLocalOrdersOrdersSync } from './lifecycles/localOrders';
import { setUpReclaimChildSubaccountBalancesLifecycle } from './lifecycles/reclaimChildSubaccountBalancesLifecycle';
import { setUpAssetsQuery } from './rest/assets';
import { setUpBlockTradingRewardsQuery } from './rest/blockTradingRewards';
import {
  setUpIndexerLocalAddressScreenV2Query,
  setUpIndexerSolanaAddressScreenQuery,
  setUpIndexerSourceAddressScreenV2Query,
} from './rest/compliance';
import { setUpConfigTiersQuery } from './rest/configTiers';
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
import {
  setUpAccountBalancesQuery,
  setUpCompositeClientAccountCacheQuery,
} from './rest/validatorAccountMetadata';
import { setUpMarketsFeeDiscountQuery } from './rest/validatorMarketsMetadata';
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
  setUpCompositeClientAccountCacheQuery,
  setUpConfigTiersQuery,
  setUpFeeScheduleQuery,
  setUpLocalOrdersOrdersSync,
  setUpGeoQuery,
  setUpIndexerSourceAddressScreenV2Query,
  setUpIndexerLocalAddressScreenV2Query,
  setUpIndexerSolanaAddressScreenQuery,
  setUpCancelOrphanedTriggerOrdersLifecycle,
  setUpReclaimChildSubaccountBalancesLifecycle,
  setUpMarketsFeeDiscountQuery,
] as const;
