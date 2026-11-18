import BigNumber from 'bignumber.js';
import { describe, expect, it } from 'vitest';

import { IndexerOrderSide } from '@/types/indexer/indexerApiGen';

import { SubaccountOrder } from '../../types/summaryTypes';
import { getSubaccountOpenOrdersPriceMap } from '../orderbook';

const order = (side: IndexerOrderSide, price: number, size: number, expired = false) =>
  ({ side, price: BigNumber(price), size: BigNumber(size), expired }) as SubaccountOrder;

const levels = (orders: SubaccountOrder[]) => {
  const map = getSubaccountOpenOrdersPriceMap(orders, 1, 0);
  const sizes = (side: IndexerOrderSide) =>
    Object.fromEntries(Object.entries(map[side]).map(([price, size]) => [price, size.toNumber()]));
  return { bids: sizes(IndexerOrderSide.BUY), asks: sizes(IndexerOrderSide.SELL) };
};

describe("the levels of the book that hold the user's own orders", () => {
  it('are the prices of the open orders, by side', () => {
    expect(
      levels([
        order(IndexerOrderSide.BUY, 99900, 0.01),
        order(IndexerOrderSide.BUY, 99900, 0.02),
        order(IndexerOrderSide.SELL, 100100, 0.01),
      ])
    ).toEqual({ bids: { '99900': 0.03 }, asks: { '100100': 0.01 } });
  });

  it('leave out an order past its expiry, which the book no longer holds', () => {
    expect(
      levels([
        order(IndexerOrderSide.BUY, 99900, 0.01, true),
        order(IndexerOrderSide.BUY, 99975, 0.01, true),
        order(IndexerOrderSide.BUY, 99900, 0.02),
        order(IndexerOrderSide.SELL, 100100, 0.01, true),
      ])
    ).toEqual({ bids: { '99900': 0.02 }, asks: {} });
  });
});
