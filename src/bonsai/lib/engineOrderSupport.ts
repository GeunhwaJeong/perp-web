import { OrderType } from '@/bonsai/types/summaryTypes';

/**
 * The order types the write path can place on the perpetuals engine: limit and market orders,
 * which become `place_limit_order` calls in one session, and stop, take profit and TWAP orders,
 * which become order tickets the keeper executes (see `placeTicketOrder`). A TWAP's suborders
 * are the keeper's chunks, never placed from here. This is an allowlist on purpose: a type it
 * does not name would otherwise fall through to a plain resting limit order.
 *
 * Returns why `type` cannot be placed, or `undefined` when it can.
 */
export const unsupportedOrderTypeReason = (type: OrderType): string | undefined => {
  switch (type) {
    case OrderType.LIMIT:
    case OrderType.MARKET:
    case OrderType.STOP_LIMIT:
    case OrderType.STOP_MARKET:
    case OrderType.TAKE_PROFIT_LIMIT:
    case OrderType.TAKE_PROFIT_MARKET:
    case OrderType.TWAP:
      return undefined;
    case OrderType.TWAP_SUBORDER:
      return 'TWAP suborders are placed by the keeper';
    default:
      return 'This order type is not available';
  }
};
