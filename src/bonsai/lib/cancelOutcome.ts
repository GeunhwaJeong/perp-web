import type { ErrorParams } from '@/constants/errors';

import { getSimpleOrderStatus } from '../calculators/orders';
import { OrderStatus } from '../types/summaryTypes';

/**
 * What became of each order of a cancel that names several. The transaction passes over an
 * order that is no longer on the book (it filled, expired or was canceled before), so the chain's
 * `CanceledOrder` events, not the transaction's success, tell which orders were canceled.
 */

/** What such a cancel says of an order it passed over. */
export const ORDER_NO_LONGER_OPEN: ErrorParams = { errorMessage: 'The order was no longer open' };

// Order ids are u128 values that the indexer and the events write in decimal.
const key = (orderId: string) => {
  try {
    return BigInt(orderId).toString();
  } catch {
    return orderId;
  }
};

/** A test for whether an order is among the ones the chain reported canceled. */
export const canceledOrders = (canceled: readonly string[]) => {
  const keys = new Set(canceled.map(key));
  return (orderId: string) => keys.has(key(orderId));
};

/**
 * The orders a cancel of all orders names, of one market or of all. An order filled in part
 * rests on the book with what is left of it, so it is one of them, as it is for the Cancel All
 * button.
 */
export const ordersToCancel = <T extends { status?: OrderStatus; marketId: string }>(
  orders: readonly T[],
  marketId?: string
): T[] =>
  orders.filter(
    (o) =>
      o.status != null &&
      getSimpleOrderStatus(o.status) === OrderStatus.Open &&
      (marketId == null || o.marketId === marketId)
  );
