import BigNumber from 'bignumber.js';
import { describe, expect, it } from 'vitest';

import {
  IndexerOrderSide,
  IndexerPerpetualPositionResponseObject,
  IndexerPositionSide,
} from '@/types/indexer/indexerApiGen';
import { IndexerWsBaseMarketObject } from '@/types/indexer/indexerManual';

import { calculateParentSubaccountPositions } from '../../calculators/subaccount';
import {
  AdjustIsolatedMarginFormFns,
  AdjustIsolatedMarginInputType,
  AdjustIsolatedMarginType,
} from '../../forms/adjustIsolatedMargin';
import { ChildSubaccountData, ParentSubaccountDataBase } from '../../types/rawTypes';
import { OrderStatus, SubaccountOrder } from '../../types/summaryTypes';
import { calculatePositionMargin } from '../positionMargin';

// Localnet, 2026-10-17: BTC-USD at a mark of 100,000, a 10x market.
const markets = {
  'BTC-USD': {
    ticker: 'BTC-USD',
    oraclePrice: '100000',
    initialMarginFraction: '0.1',
    maintenanceMarginFraction: '0.05',
  } as unknown as IndexerWsBaseMarketObject,
};

const usdc = (subaccountNumber: number, balance: number) =>
  ({
    USDC: {
      symbol: 'USDC',
      side: balance >= 0 ? IndexerPositionSide.LONG : IndexerPositionSide.SHORT,
      size: String(Math.abs(balance)),
      assetId: '0',
      subaccountNumber,
    },
  }) as ChildSubaccountData['assetPositions'];

const long = (size: string, entryPrice: string) =>
  ({
    market: 'BTC-USD',
    status: 'OPEN',
    side: IndexerPositionSide.LONG,
    size,
    maxSize: size,
    entryPrice,
    realizedPnl: '0',
    createdAt: '2026-10-16T15:00:00.000Z',
    createdAtHeight: '1',
    sumOpen: size,
    sumClose: '0',
    netFunding: '0',
    unrealizedPnl: '0',
    subaccountNumber: 128,
  }) as unknown as IndexerPerpetualPositionResponseObject;

// A long in the market's subaccount 128, with `balance` as its quote balance (collateral less
// the entry notional), so that its margin at the mark is `balance + size * 100,000`.
const account = (size: string, entryPrice: string, balance: number): ParentSubaccountDataBase => ({
  address: '0x431e',
  parentSubaccount: 0,
  childSubaccounts: {
    0: {
      address: '0x431e',
      subaccountNumber: 0,
      openPerpetualPositions: {},
      assetPositions: usdc(0, 20),
    },
    128: {
      address: '0x431e',
      subaccountNumber: 128,
      openPerpetualPositions: { 'BTC-USD': long(size, entryPrice) },
      assetPositions: usdc(128, balance),
    },
  },
});

const order = (side: IndexerOrderSide, size: string, status = OrderStatus.Open) =>
  ({
    marketId: 'BTC-USD',
    subaccountNumber: 128,
    side,
    status,
    size: new BigNumber(size),
    remainingSize: new BigNumber(size),
  }) as unknown as SubaccountOrder;

const position = (parent: ParentSubaccountDataBase, leverages: Record<string, number> = {}) =>
  calculateParentSubaccountPositions(parent, markets, leverages)[0]!;

// 0.002 BTC long from 100,010 (a $0.02 loss at the mark) with $30.00 of margin: the 10x margin
// of the position and of a 0.001 BTC bid resting beside it, as the engine allocated them.
const withBid = account('0.002', '100010', -170);

describe('calculatePositionMargin', () => {
  it('counts the margin of a resting bid with the position, as the engine does', () => {
    const margin = calculatePositionMargin(position(withBid), [
      order(IndexerOrderSide.BUY, '0.001'),
    ]);

    expect(margin.required.toNumber()).toBeCloseTo(30, 9);
    expect(margin.leverage?.toNumber()).toBeCloseTo(10, 9);
    // The positions table used to show $200 over $30.00: 7x.
    expect(position(withBid).leverage?.toNumber()).toBeCloseTo(6.667, 3);
  });

  it('leaves out an order that only reduces the position', () => {
    const margin = calculatePositionMargin(position(withBid), [
      order(IndexerOrderSide.SELL, '0.001'),
    ]);

    expect(margin.required.toNumber()).toBeCloseTo(20, 9);
    expect(margin.leverage?.toNumber()).toBeCloseTo(200 / 30, 9);
  });

  it('leaves out stop orders waiting off the book', () => {
    const margin = calculatePositionMargin(position(withBid), [
      order(IndexerOrderSide.BUY, '0.001', OrderStatus.Untriggered),
    ]);

    expect(margin.required.toNumber()).toBeCloseTo(20, 9);
  });

  it("holds the position to its own ratio when it is higher than the market's", () => {
    const margin = calculatePositionMargin(
      position(account('0.002', '100000', -160), { 'BTC-USD': 5 }),
      []
    );

    expect(margin.required.toNumber()).toBeCloseTo(40, 9);
    expect(margin.leverage?.toNumber()).toBeCloseTo(5, 9);
  });

  it('counts losses toward what can be taken out, never profit', () => {
    // 0.002 BTC from 90,000: $20 of profit at the mark on $20 of collateral.
    const profit = calculatePositionMargin(position(account('0.002', '90000', -160)), []);
    expect(profit.withdrawable.toNumber()).toBeCloseTo(20, 9);

    const loss = calculatePositionMargin(position(withBid), []);
    expect(loss.withdrawable.toNumber()).toBeCloseTo(30, 9);
  });
});

describe('the margin dialog', () => {
  const removable = (
    parent: ParentSubaccountDataBase,
    openOrders: SubaccountOrder[],
    leverages = {}
  ) =>
    Number(
      AdjustIsolatedMarginFormFns.calculateSummary(
        {
          type: AdjustIsolatedMarginType.REMOVE,
          amountInput: { type: AdjustIsolatedMarginInputType.AMOUNT, amount: '1' },
          childSubaccountNumber: 128,
        },
        {
          rawParentSubaccountData: parent,
          rawRelevantMarkets: markets,
          selectedMarketLeverages: leverages,
          openOrders,
        }
      ).inputs.maxAmount
    );

  it('offers nothing to take out of margin a resting order needs', () => {
    // It used to offer $9.80, which the engine refuses (EInsufficientFreeCollateral).
    expect(removable(withBid, [order(IndexerOrderSide.BUY, '0.001')])).toBe(0);
  });

  it("offers nothing below a 5x position's own margin", () => {
    // It used to count the market's 10x and offer $19.80.
    expect(removable(account('0.002', '100000', -160), [], { 'BTC-USD': 5 })).toBe(0);
  });

  it('offers no unrealized profit', () => {
    // It used to offer $19.80 of the $20 profit.
    expect(removable(account('0.002', '90000', -160), [])).toBe(0);
  });

  it('offers what is above the margin, less the buffer for the mark', () => {
    expect(removable(account('0.002', '100000', -150), [])).toBeCloseTo(50 - 20 / 0.99, 9);
  });
});
