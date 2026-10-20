import { OrderType } from '@/bonsai/types/summaryTypes';

/**
 * The order types the write path can place on the perpetuals engine: limit and market orders,
 * which become `place_limit_order` calls in one session. Everything else (TWAP, stop and
 * take-profit orders) needs the ticket keeper, which is not live yet. This is an allowlist on
 * purpose: a type it does not name would otherwise fall through to a plain resting limit order.
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
