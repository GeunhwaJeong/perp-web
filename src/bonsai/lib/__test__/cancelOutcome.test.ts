import { describe, expect, it } from 'vitest';

import { OrderStatus } from '../../types/summaryTypes';
import { canceledOrders, ORDER_NO_LONGER_OPEN, ordersToCancel } from '../cancelOutcome';

describe('canceledOrders', () => {
  it('tells the orders the chain canceled from the ones the cancel passed over', () => {
    const wasCanceled = canceledOrders(['170141183460469231731687303715884105729', '42']);
    expect(wasCanceled('170141183460469231731687303715884105729')).toBe(true);
    expect(wasCanceled('42')).toBe(true);
    expect(wasCanceled('43')).toBe(false);
    expect(canceledOrders([])('42')).toBe(false);
  });

  it('compares the ids as numbers, however they are written', () => {
    const wasCanceled = canceledOrders(['0x2a', '007']);
    expect(wasCanceled('42')).toBe(true);
    expect(wasCanceled('7')).toBe(true);
  });

  it('takes an id that is not a number as it is', () => {
    const wasCanceled = canceledOrders(['42']);
    expect(wasCanceled('ticket:0x1:sl')).toBe(false);
    expect(canceledOrders(['ticket:0x1:sl'])('ticket:0x1:sl')).toBe(true);
  });

  it('says of a passed-over order that it was no longer open', () => {
    expect(ORDER_NO_LONGER_OPEN).toEqual({ errorMessage: 'The order was no longer open' });
  });
});

describe('ordersToCancel', () => {
  const order = (id: string, status: OrderStatus | undefined, marketId = 'BTC-USD') => ({
    id,
    status,
    marketId,
  });
  const ids = (orders: { id: string }[]) => orders.map((o) => o.id);

  it('names an order filled in part along with the ones not filled at all', () => {
    const orders = [
      order('open', OrderStatus.Open),
      order('part', OrderStatus.PartiallyFilled),
      order('filled', OrderStatus.Filled),
      order('canceled', OrderStatus.Canceled),
      order('part-canceled', OrderStatus.PartiallyCanceled),
      order('unknown', undefined),
    ];
    expect(ids(ordersToCancel(orders))).toEqual(['open', 'part']);
  });

  it('keeps to one market when given one', () => {
    const orders = [
      order('btc', OrderStatus.PartiallyFilled),
      order('eth', OrderStatus.PartiallyFilled, 'ETH-USD'),
    ];
    expect(ids(ordersToCancel(orders, 'ETH-USD'))).toEqual(['eth']);
    expect(ids(ordersToCancel(orders))).toEqual(['btc', 'eth']);
  });
});
