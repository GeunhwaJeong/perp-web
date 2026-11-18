import { describe, expect, it } from 'vitest';

import {
  IndexerAPITimeInForce,
  IndexerOrderSide,
  IndexerOrderStatus,
  IndexerOrderType,
} from '@/types/indexer/indexerApiGen';
import { IndexerCompositeOrderObject } from '@/types/indexer/indexerManual';

import { OrderStatus } from '../../types/summaryTypes';
import { calculateAllOrders, calculateOpenOrders, calculateOrderHistory } from '../orders';

const EXPIRY = '2026-11-18T07:02:33.000Z';

const limit = (over: Partial<IndexerCompositeOrderObject> = {}): IndexerCompositeOrderObject => ({
  id: 'order-1',
  clientId: '1',
  clobPairId: '0',
  side: IndexerOrderSide.BUY,
  size: '0.01',
  totalFilled: '0',
  price: '90000',
  type: IndexerOrderType.LIMIT,
  reduceOnly: false,
  orderFlags: '64',
  goodTilBlockTime: EXPIRY,
  createdAtHeight: '1400',
  clientMetadata: '0',
  timeInForce: IndexerAPITimeInForce.GTT,
  status: IndexerOrderStatus.OPEN,
  postOnly: false,
  ticker: 'BTC-USD',
  updatedAtHeight: '1400',
  subaccountNumber: 128,
  ...over,
});

// The chain's time, as the API and the node report it with their heights.
const at = (time: string) => ({ height: 1500, time });

const only = (order: IndexerCompositeOrderObject, time: string) => {
  const orders = calculateAllOrders({ [order.id]: order }, undefined, at(time));
  expect(orders).toHaveLength(1);
  return orders[0]!;
};

describe('an order that rests past its expiry', () => {
  it('is not expired one millisecond before its expiry', () => {
    const order = only(limit(), '2026-11-18T07:02:32.999Z');
    expect(order.expired).toBe(false);
    expect(order.status).toBe(OrderStatus.Open);
  });

  it('is expired from the moment the chain time reaches its expiry, as the engine has it', () => {
    expect(only(limit(), EXPIRY).expired).toBe(true);
    expect(only(limit(), '2026-11-18T07:03:27.171Z').expired).toBe(true);
  });

  it('stays an open order, so that it can still be canceled', () => {
    const order = only(limit(), '2026-11-18T07:03:27.171Z');
    expect(order.status).toBe(OrderStatus.Open);
    expect(calculateOpenOrders([order])).toHaveLength(1);
    expect(calculateOrderHistory([order])).toHaveLength(0);
  });

  it('is expired when part of it has filled', () => {
    const order = only(limit({ totalFilled: '0.004' }), '2026-11-18T07:03:27.171Z');
    expect(order.status).toBe(OrderStatus.PartiallyFilled);
    expect(order.expired).toBe(true);
  });

  it('is not expired without an expiry', () => {
    const order = only(limit({ goodTilBlockTime: null }), '2030-01-01T00:00:00.000Z');
    expect(order.expired).toBe(false);
  });

  it('is not expired once it is canceled or filled', () => {
    const late = '2026-11-18T07:03:27.171Z';
    expect(only(limit({ status: IndexerOrderStatus.CANCELED }), late).expired).toBe(false);
    expect(
      only(limit({ status: IndexerOrderStatus.FILLED, totalFilled: '0.01' }), late).expired
    ).toBe(false);
  });

  it('is not expired while no chain time is known', () => {
    // The selector's stand-in while neither height has loaded.
    expect(only(limit(), '1971-01-01T00:00:00Z').expired).toBe(false);
  });
});
