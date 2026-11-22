import { describe, expect, it } from 'vitest';

import { IndexerOrderSide, IndexerPositionSide } from '@/types/indexer/indexerApiGen';
import { IndexerCompositeFillObject } from '@/types/indexer/indexerManual';

import { calculateFills } from '../fills';

const fill = (over: Partial<IndexerCompositeFillObject>) =>
  ({
    id: '1',
    side: IndexerOrderSide.BUY,
    size: '0.001',
    price: '99950',
    fee: '0.01999',
    createdAt: '2026-11-22T12:10:00.000Z',
    createdAtHeight: '100',
    ...over,
  }) as IndexerCompositeFillObject;

const closedPnl = (over: Partial<IndexerCompositeFillObject>) =>
  calculateFills([fill(over)], undefined)[0]!.closedPnl;

describe('the closed profit of a fill', () => {
  it('is the profit of the size it closed, less the fee', () => {
    // A long of 0.01 BTC from 100,080, of which 0.01 sells at 99,927.
    const pnl = closedPnl({
      side: IndexerOrderSide.SELL,
      size: '0.01',
      price: '99927',
      fee: '0.499635',
      positionSideBefore: IndexerPositionSide.LONG,
      positionSizeBefore: '0.01',
      entryPriceBefore: '100080',
    });
    expect(pnl).toBeCloseTo(-1.53 - 0.499635, 6);
  });

  it('is none for a fill that adds to the position', () => {
    expect(
      closedPnl({
        positionSideBefore: IndexerPositionSide.LONG,
        positionSizeBefore: '0.01',
        entryPriceBefore: '100080',
      })
    ).toBeUndefined();
  });

  it('is none for a fill that opens the position', () => {
    expect(closedPnl({ positionSizeBefore: '0', entryPriceBefore: '0' })).toBeUndefined();
    expect(
      closedPnl({
        positionSideBefore: IndexerPositionSide.LONG,
        positionSizeBefore: '0',
        entryPriceBefore: '0',
      })
    ).toBeUndefined();
  });
});
