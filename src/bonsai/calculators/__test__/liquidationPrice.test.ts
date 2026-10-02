import BigNumber from 'bignumber.js';
import { describe, expect, it } from 'vitest';

import { IndexerOrderSide } from '@/types/indexer/indexerApiGen';

import type { SubaccountOrder, SubaccountPosition } from '../../types/summaryTypes';
import { applyRestingOrdersToLiquidationPrices } from '../subaccount';

const MMF = 0.05;
const MARK = 100_000;

/**
 * An isolated position the way the summary sees it: `value` at the mark, `equity` its margin
 * there, and the liquidation price the summary computed without resting orders.
 */
const position = (size: number, entry: number, collateral: number) => {
  const value = size * MARK;
  const equity = collateral + size * (MARK - entry);
  const denominator = size > 0 ? size - size * MMF : size + size * MMF;
  return {
    market: 'BTC-USD',
    subaccountNumber: 128,
    marginMode: 'ISOLATED',
    signedSize: new BigNumber(size),
    value: new BigNumber(value),
    marginValueMaintenance: new BigNumber(equity),
    adjustedMmf: new BigNumber(MMF),
    liquidationPrice: new BigNumber(value - equity).div(denominator),
  } as unknown as SubaccountPosition;
};

const order = (side: IndexerOrderSide, remaining: number, subaccountNumber = 128) =>
  ({
    marketId: 'BTC-USD',
    subaccountNumber,
    side,
    remainingSize: new BigNumber(remaining),
  }) as unknown as SubaccountOrder;

/** The engine's formula (af-iperps `Position::liquidation_price`, in USD instead of ifixed). */
const engine = (size: number, entry: number, collateral: number, bids: number, asks: number) => {
  const quote = size * entry;
  const net = Math.max(Math.abs(size + bids), Math.abs(size - asks));
  return (collateral - quote) / (net * MMF - size);
};

const liq = (p: SubaccountPosition, orders: SubaccountOrder[]) =>
  applyRestingOrdersToLiquidationPrices([p], orders)[0]!.liquidationPrice?.toNumber();

describe('applyRestingOrdersToLiquidationPrices', () => {
  it('leaves a position without resting orders as the summary computed it', () => {
    const p = position(1, 100_000, 10_000);
    expect(applyRestingOrdersToLiquidationPrices([p], [])[0]).toBe(p);
    expect(p.liquidationPrice!.toNumber()).toBeCloseTo(engine(1, 100_000, 10_000, 0, 0), 6);
  });

  it('moves a long toward the mark when bids rest that would grow it', () => {
    const p = position(1, 100_000, 10_000);
    const with2Bids = liq(p, [order(IndexerOrderSide.BUY, 2)]);
    expect(with2Bids).toBeCloseTo(engine(1, 100_000, 10_000, 2, 0), 6);
    expect(with2Bids!).toBeGreaterThan(p.liquidationPrice!.toNumber());
  });

  it('keeps a long where it was when only reducing asks rest', () => {
    const p = position(1, 100_000, 10_000);
    expect(liq(p, [order(IndexerOrderSide.SELL, 0.5)])).toBeCloseTo(
      p.liquidationPrice!.toNumber(),
      6
    );
  });

  it('moves a short toward the mark when asks rest that would grow it', () => {
    const p = position(-2, 101_000, 15_000);
    const got = liq(p, [order(IndexerOrderSide.SELL, 1), order(IndexerOrderSide.BUY, 0.5)]);
    expect(got).toBeCloseTo(engine(-2, 101_000, 15_000, 0.5, 1), 6);
    expect(got!).toBeLessThan(p.liquidationPrice!.toNumber());
  });

  it('counts a flip the bids would cause at its full size', () => {
    const p = position(-1, 100_000, 8_000);
    expect(liq(p, [order(IndexerOrderSide.BUY, 3)])).toBeCloseTo(
      engine(-1, 100_000, 8_000, 3, 0),
      6
    );
  });

  it('ignores orders of another subaccount and filled orders', () => {
    const p = position(1, 100_000, 10_000);
    const got = liq(p, [order(IndexerOrderSide.BUY, 2, 256), order(IndexerOrderSide.BUY, 0)]);
    expect(got).toBeCloseTo(p.liquidationPrice!.toNumber(), 6);
  });

  it('reports no price when the position cannot be liquidated', () => {
    // So much collateral that the formula lands below zero.
    const p = position(1, 100_000, 200_000);
    expect(liq(p, [order(IndexerOrderSide.BUY, 1)])).toBeUndefined();
  });
});
