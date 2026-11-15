import type { ErrorParams } from '@/constants/errors';

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
