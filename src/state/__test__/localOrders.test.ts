import { OrderStatus, OrderType } from '@/bonsai/types/summaryTypes';
import { describe, expect, it } from 'vitest';

import { PlaceOrderStatuses } from '@/constants/trade';

import {
  localOrdersSlice,
  orderTicketCanceled,
  placeOrderConfirmed,
  placeOrderSubmitted,
} from '../localOrders';

const { reducer } = localOrdersSlice;

const placedTicket = (clientId: string, ticketCommitment: string) => [
  placeOrderSubmitted({
    marketId: 'BTC-USD',
    clientId,
    orderType: OrderType.STOP_MARKET,
    subaccountNumber: 0,
  }),
  placeOrderConfirmed({
    clientId,
    status: PlaceOrderStatuses.Placed,
    cachedStatus: OrderStatus.Untriggered,
    ticketCommitment,
  }),
];

describe('the submission that created an order ticket', () => {
  it('reads Untriggered once the ticket is placed', () => {
    const state = placedTicket('7', 'aa11').reduce(reducer, undefined);
    const order = state!.localPlaceOrders['7']!;
    expect(order.ticketCommitment).toBe('aa11');
    expect(order.cachedData.status).toBe(OrderStatus.Untriggered);
  });

  it('reads Canceled once that ticket is canceled, and no other does', () => {
    const state = [
      ...placedTicket('7', 'aa11'),
      ...placedTicket('8', 'bb22'),
      orderTicketCanceled({ commitment: 'aa11' }),
    ].reduce(reducer, undefined);
    expect(state!.localPlaceOrders['7']!.cachedData.status).toBe(OrderStatus.Canceled);
    expect(state!.localPlaceOrders['8']!.cachedData.status).toBe(OrderStatus.Untriggered);
  });

  it('is left alone by the cancel of a ticket no submission here created', () => {
    const before = placedTicket('7', 'aa11').reduce(reducer, undefined);
    const after = reducer(before, orderTicketCanceled({ commitment: 'cc33' }));
    expect(after.localPlaceOrders).toEqual(before!.localPlaceOrders);
  });
});
