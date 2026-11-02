import { OrderType } from '@/bonsai/types/summaryTypes';

/**
 * The order types the write path can place on the perpetuals engine as orders: limit and market
 * orders, which become `place_limit_order` calls in one session. A position's take profit and
 * stop loss go through the triggers form as an order ticket the keeper executes (see
 * `placeCompoundOrder`); standalone stop and TWAP orders are not wired to tickets yet. This is
 * an allowlist on purpose: a type it does not name would otherwise fall through to a plain
 * resting limit order.
 *
 * Returns why `type` cannot be placed, or `undefined` when it can.
 */
export const unsupportedOrderTypeReason = (type: OrderType): string | undefined => {
  switch (type) {
    case OrderType.LIMIT:
    case OrderType.MARKET:
      return undefined;
    case OrderType.TWAP:
    case OrderType.TWAP_SUBORDER:
      return 'TWAP orders are not available yet';
    default:
      return 'Conditional orders are not available yet';
  }
};
