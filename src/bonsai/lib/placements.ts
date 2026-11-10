import { OrderStatus } from '@/bonsai/types/summaryTypes';

import { PlaceOrderStatuses } from '@/constants/trade';

/** An order of a session that executed: the ID it rests under, if it posted, and whether it filled. */
export type PlacedOrder = { clientId: string; orderId?: string; filled: boolean };

/**
 * What a session's order reports to the local order state once the session executed.
 *
 * An order that filled without posting has no indexed order to take its status from. The engine
 * reports what a session took from the book as a fill that names no order, and the order the
 * indexer makes for that fill carries no client ID. The status is therefore set here, from the
 * fill the transaction itself reported. An order that posted has an indexed order under its
 * client ID, which reports its status.
 */
export const placementConfirmation = (placed: PlacedOrder) => ({
  clientId: placed.clientId,
  orderId: placed.orderId,
  status: placed.filled ? PlaceOrderStatuses.Filled : PlaceOrderStatuses.Placed,
  cachedStatus: placed.filled ? OrderStatus.Filled : undefined,
});
