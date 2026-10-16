import { describe, expect, it } from 'vitest';

import {
  IndexerPerpetualPositionResponseObject,
  IndexerPositionSide,
} from '@/types/indexer/indexerApiGen';
import { IndexerWsBaseMarketObject } from '@/types/indexer/indexerManual';

import { ChildSubaccountData, ParentSubaccountDataBase } from '../../types/rawTypes';
import { calculateParentSubaccountSummary } from '../subaccount';

const MARK = 82_044;

const markets = {
  'BTC-USD': {
    ticker: 'BTC-USD',
    oraclePrice: String(MARK),
    initialMarginFraction: '0.1',
    maintenanceMarginFraction: '0.05',
  } as unknown as IndexerWsBaseMarketObject,
};

const usdc = (subaccountNumber: number, balance: number) => ({
  USDC: {
    symbol: 'USDC',
    side: balance >= 0 ? IndexerPositionSide.LONG : IndexerPositionSide.SHORT,
    size: String(Math.abs(balance)),
    assetId: '0',
    subaccountNumber,
  },
});

const child = (
  subaccountNumber: number,
  balance: number,
  positions: IndexerPerpetualPositionResponseObject[] = []
): ChildSubaccountData => ({
  address: '0xadf3',
  subaccountNumber,
  openPerpetualPositions: Object.fromEntries(positions.map((p) => [p.market, p])),
  assetPositions: usdc(subaccountNumber, balance) as ChildSubaccountData['assetPositions'],
});

const long = (size: number, entry: number) =>
  ({
    market: 'BTC-USD',
    status: 'OPEN',
    side: IndexerPositionSide.LONG,
    size: String(size),
    maxSize: String(size),
    entryPrice: String(entry),
    realizedPnl: '0',
    createdAt: '2026-10-16T06:33:54.366Z',
    createdAtHeight: '1',
    sumOpen: String(size),
    sumClose: '0',
    netFunding: '0',
    unrealizedPnl: '0',
    subaccountNumber: 128,
  }) as unknown as IndexerPerpetualPositionResponseObject;

const account = (...children: ChildSubaccountData[]): ParentSubaccountDataBase => ({
  address: '0xadf3',
  parentSubaccount: 0,
  childSubaccounts: Object.fromEntries(children.map((c) => [c.subaccountNumber, c])),
});

describe('calculateParentSubaccountSummary', () => {
  // Mainnet, 2026-10-16: 11.522813 left in the balance and 0.001 BTC long at 82,093 in the
  // market's subaccount, whose 8.4607684 of collateral the indexer shows as 82.093 - 73.6322316.
  const withPosition = account(child(0, 11.522813), child(128, -73.6322316, [long(0.001, 82_093)]));

  it('counts the isolated position in the account-wide usage and leverage', () => {
    const summary = calculateParentSubaccountSummary(withPosition, markets, {});
    const equity = 11.522813 + (0.001 * MARK - 73.6322316);

    expect(summary.equity.toNumber()).toBeCloseTo(equity, 9);
    expect(summary.accountMarginUsage!.toNumber()).toBeCloseTo(1 - 11.522813 / equity, 9);
    expect(summary.accountMarginUsage!.toNumber()).toBeCloseTo(0.422, 3);
    expect(summary.accountLeverage!.toNumber()).toBeCloseTo((0.001 * MARK) / equity, 9);
    expect(summary.accountLeverage!.toNumber()).toBeCloseTo(4.116, 3);
  });

  it("keeps the parent's own figures, which the order checks read, on the balance alone", () => {
    const summary = calculateParentSubaccountSummary(withPosition, markets, {});

    expect(summary.freeCollateral.toNumber()).toBeCloseTo(11.522813, 9);
    expect(summary.parentSubaccountEquity.toNumber()).toBeCloseTo(11.522813, 9);
    expect(summary.marginUsage!.toNumber()).toBe(0);
    expect(summary.leverage!.toNumber()).toBe(0);
  });

  it('shows nothing in use while the account holds no position', () => {
    const summary = calculateParentSubaccountSummary(account(child(0, 20)), markets, {});

    expect(summary.accountMarginUsage!.toNumber()).toBe(0);
    expect(summary.accountLeverage!.toNumber()).toBe(0);
  });

  it('leaves the account-wide figures empty for an account with nothing in it', () => {
    const summary = calculateParentSubaccountSummary(account(child(0, 0)), markets, {});

    expect(summary.accountMarginUsage).toBeNull();
    expect(summary.accountLeverage).toBeNull();
  });
});
