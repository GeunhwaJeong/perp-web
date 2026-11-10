import { OrderStatus, OrderType } from '@/bonsai/types/summaryTypes';
import { describe, expect, it } from 'vitest';

import { PlaceOrderStatuses } from '@/constants/trade';

import { localOrdersSlice, placeOrderConfirmed, placeOrderSubmitted } from '@/state/localOrders';

import { placementConfirmation } from '../placements';

const submitted = (clientId: string, orderType: OrderType) =>
  localOrdersSlice.reducer(
    undefined,
    placeOrderSubmitted({ marketId: 'BTC-USD', clientId, orderType, subaccountNumber: 0 })
  );

describe('placementConfirmation', () => {
  it('gives an order that filled without posting its status, which no indexed order reports', () => {
    const state = localOrdersSlice.reducer(
      submitted('7', OrderType.MARKET),
      placeOrderConfirmed(placementConfirmation({ clientId: '7', filled: true }))
    );
    const order = state.localPlaceOrders['7']!;
    expect(order.submissionStatus).toBe(PlaceOrderStatuses.Filled);
    expect(order.orderId).toBeUndefined();
    expect(order.cachedData.status).toBe(OrderStatus.Filled);
  });

  it('leaves the status of an order that posted to its indexed order', () => {
    const state = localOrdersSlice.reducer(
      submitted('8', OrderType.LIMIT),
      placeOrderConfirmed(placementConfirmation({ clientId: '8', orderId: '42', filled: false }))
    );
    const order = state.localPlaceOrders['8']!;
    expect(order.submissionStatus).toBe(PlaceOrderStatuses.Placed);
    expect(order.orderId).toBe('42');
    expect(order.cachedData.status).toBeUndefined();
  });
});
