import { describe, expect, it } from 'vitest';

import {
  IndexerPerpetualPositionResponseObject,
  IndexerPositionSide,
} from '@/types/indexer/indexerApiGen';
import { IndexerWsBaseMarketObject } from '@/types/indexer/indexerManual';

import { SubaccountOperations } from '../../types/operationTypes';
import { ChildSubaccountData, ParentSubaccountDataBase } from '../../types/rawTypes';
import { applyOperationsToSubaccount, createBatchedOperations } from '../accountActions';
import { calculateParentSubaccountPositions } from '../subaccount';

const markets = {
  'BTC-USD': {
    ticker: 'BTC-USD',
    oraclePrice: '82044',
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

const long = (liquidationPrice?: string) =>
  ({
    market: 'BTC-USD',
    status: 'OPEN',
    side: IndexerPositionSide.LONG,
    size: '0.001',
    maxSize: '0.001',
    entryPrice: '82093',
    realizedPnl: '0',
    createdAt: '2026-10-16T06:33:54.366Z',
    createdAtHeight: '1',
    sumOpen: '0.001',
    sumClose: '0',
    netFunding: '0',
    unrealizedPnl: '0',
    subaccountNumber: 128,
    liquidationPrice,
  }) as unknown as IndexerPerpetualPositionResponseObject;

// Mainnet, 2026-10-16: 11.522813 in the balance and 0.001 BTC long in the market's subaccount,
// for which the indexer reported a liquidation price of 77,507.61.
const account = (liquidationPrice?: string): ParentSubaccountDataBase => ({
  address: '0xadf3',
  parentSubaccount: 0,
  childSubaccounts: {
    0: {
      address: '0xadf3',
      subaccountNumber: 0,
      openPerpetualPositions: {},
      assetPositions: usdc(0, 11.522813),
    },
    128: {
      address: '0xadf3',
      subaccountNumber: 128,
      openPerpetualPositions: { 'BTC-USD': long(liquidationPrice) },
      assetPositions: usdc(128, -73.6322316),
    },
  },
});

const liquidationPrice = (parent: ParentSubaccountDataBase) => {
  const position = calculateParentSubaccountPositions(parent, markets, {})[0]!;
  return {
    price: position.liquidationPrice?.toNumber(),
    fromIndexer: position.liquidationPriceFromIndexer,
  };
};

const transfer = (from: number, to: number, amount: string) =>
  createBatchedOperations(
    SubaccountOperations.SubaccountTransfer({
      senderSubaccountNumber: from,
      recipientSubaccountNumber: to,
      amount,
    })
  );

describe('applyOperationsToSubaccount', () => {
  it("keeps the indexer's liquidation price while nothing changes", () => {
    expect(liquidationPrice(account('77507.61'))).toEqual({ price: 77507.61, fromIndexer: true });
  });

  it('estimates the liquidation price afresh once margin leaves the position', () => {
    const estimateBefore = liquidationPrice(account()).price!;
    const after = liquidationPrice(
      applyOperationsToSubaccount(account('77507.61'), transfer(128, 0, '0.12'))
    );

    expect(after.fromIndexer).toBe(false);
    // less collateral behind a long liquidates it at a higher price
    expect(after.price!).toBeGreaterThan(estimateBefore);
    expect(after.price!).not.toBe(77507.61);
  });

  it('and once margin is added to it', () => {
    const estimateBefore = liquidationPrice(account()).price!;
    const after = liquidationPrice(
      applyOperationsToSubaccount(account('77507.61'), transfer(0, 128, '5'))
    );

    expect(after.fromIndexer).toBe(false);
    expect(after.price!).toBeLessThan(estimateBefore);
  });
});
